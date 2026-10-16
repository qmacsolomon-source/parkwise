"""
Evaluate full detection + OCR pipeline on local photos.
Runs detect, crop, OCR, normalize and compares with ground truth.
"""
import os
import sys
import cv2
import pandas as pd
from pathlib import Path
from typing import Dict, List
from datetime import datetime
import torch
from easyocr import Reader

# Add YOLOv5 to path
yolov5_path = Path(__file__).parent.parent / "third_party" / "yolov5"
sys.path.insert(0, str(yolov5_path))

from models.common import DetectMultiBackend
from utils.general import non_max_suppression, scale_boxes
import numpy as np


class PipelineEvaluator:
    """Evaluate full detection + OCR pipeline."""

    def __init__(self, model_path: str, local_dir: str, use_gpu: bool = False):
        self.model_path = model_path
        self.local_dir = Path(local_dir)
        self.device = 'cuda' if use_gpu and torch.cuda.is_available() else 'cpu'
        self.results = []

        # Load models
        self._load_models()

    def _load_models(self):
        """Load YOLOv5 and EasyOCR models."""
        print(f"Loading models on device: {self.device}")

        # Load YOLOv5
        try:
            self.yolo_model = DetectMultiBackend(
                self.model_path,
                device=self.device,
                dnn=False,
                fp16=False
            )
            self.yolo_model.half() if self.device == 'cuda' else None
            self.yolo_model.eval()
            print("YOLOv5 model loaded")
        except Exception as e:
            print(f"Warning: Failed to load YOLOv5 model: {e}")
            self.yolo_model = None

        # Load EasyOCR
        try:
            self.ocr_reader = Reader(['en'], gpu=self.device == 'cuda')
            print("EasyOCR model loaded")
        except Exception as e:
            print(f"Warning: Failed to load EasyOCR: {e}")
            self.ocr_reader = None

    def normalize_plate(self, text: str) -> str:
        """Normalize plate text."""
        if not text:
            return ""

        normalized = text.upper().replace(" ", "")

        replacements = {
            'O': '0',
            'I': '1',
            'S': '5',
            'Z': '2',
            'B': '8',
        }

        for old, new in replacements.items():
            normalized = normalized.replace(old, new)

        return normalized

    def is_valid_philippine_plate(self, text: str) -> bool:
        """Validate Philippine plate format."""
        if not text:
            return False

        if len(text) < 6 or len(text) > 8:
            return False

        if not text.isalnum():
            return False

        return True

    def detect_plate(self, image: np.ndarray) -> List:
        """Detect license plate using YOLOv5."""
        if self.yolo_model is None:
            return []

        try:
            # Preprocess
            img = image.copy()
            img = img[..., ::-1]  # BGR to RGB
            img = np.ascontiguousarray(img)

            # Inference
            img = torch.from_numpy(img).to(self.device).float() / 255.0
            if img.ndimension() == 3:
                img = img.unsqueeze(0)

            # Predict
            pred = self.yolo_model(img, augment=False, visualize=False)

            # NMS
            pred = non_max_suppression(pred, 0.5, 0.45, None, False, max_det=1000)

            # Process predictions
            detections = []
            for det in pred:
                if det is not None and len(det):
                    # Scale boxes
                    det[:, :4] = scale_boxes(img.shape[2:], det[:, :4], img.shape).round()

                    for *xyxy, conf, cls in reversed(det):
                        detections.append({
                            'bbox': [int(x) for x in xyxy],
                            'confidence': float(conf),
                            'class': int(cls)
                        })

            return detections

        except Exception as e:
            print(f"Detection error: {e}")
            return []

    def crop_plate(self, image: np.ndarray, bbox: List[int]) -> np.ndarray:
        """Crop plate region."""
        x1, y1, x2, y2 = bbox
        return image[y1:y2, x1:x2]

    def read_plate(self, plate_image: np.ndarray) -> Tuple[str, float]:
        """Read plate text using EasyOCR."""
        if self.ocr_reader is None:
            return "", 0.0

        try:
            results = self.ocr_reader.readtext(plate_image)

            if not results:
                return "", 0.0

            best_result = max(results, key=lambda x: x[2])
            text = best_result[0]
            confidence = float(best_result[2])

            return text, confidence

        except Exception as e:
            print(f"OCR error: {e}")
            return "", 0.0

    def evaluate_condition(self, condition: str) -> Dict:
        """Evaluate pipeline on specific condition (day/night/wet)."""
        # Load plates.csv
        csv_file = self.local_dir / "plates.csv"
        if not csv_file.exists():
            print(f"plates.csv not found in {self.local_dir}")
            return {}

        df = pd.read_csv(csv_file)
        condition_df = df[df['condition'] == condition]

        if len(condition_df) == 0:
            print(f"No images found for condition: {condition}")
            return {}

        results = []
        detected_count = 0
        exact_matches = 0
        total_chars = 0
        correct_chars = 0

        for _, row in condition_df.iterrows():
            filename = row['filename']
            ground_truth = row['plate_text']
            image_path = self.local_dir / "images" / condition / filename

            if not image_path.exists():
                print(f"Image not found: {image_path}")
                continue

            # Load image
            image = cv2.imread(str(image_path))
            if image is None:
                print(f"Failed to load: {image_path}")
                continue

            # Detect plate
            detections = self.detect_plate(image)

            if not detections:
                results.append({
                    'filename': filename,
                    'ground_truth': ground_truth,
                    'detected': '',
                    'confidence': 0.0,
                    'exact_match': False,
                    'char_accuracy': 0.0,
                    'detected_plate': False
                })
                continue

            # Get best detection
            best_detection = max(detections, key=lambda x: x['confidence'])
            bbox = best_detection['bbox']

            # Crop and read
            plate_image = self.crop_plate(image, bbox)
            detected_text, confidence = self.read_plate(plate_image)

            # Normalize
            normalized = self.normalize_plate(detected_text)

            # Validate
            if not self.is_valid_philippine_plate(normalized):
                normalized = ""

            detected_count += 1

            # Check exact match
            is_exact = normalized == ground_truth
            if is_exact:
                exact_matches += 1

            # Character accuracy
            max_len = max(len(ground_truth), len(normalized))
            if max_len > 0:
                matches = sum(1 for a, b in zip(ground_truth, normalized) if a == b)
                char_acc = matches / max_len
            else:
                char_acc = 0.0

            total_chars += max_len
            correct_chars += matches

            results.append({
                'filename': filename,
                'ground_truth': ground_truth,
                'detected': normalized,
                'raw_detected': detected_text,
                'confidence': confidence,
                'exact_match': is_exact,
                'char_accuracy': char_acc,
                'detected_plate': True
            })

        total = len(condition_df)
        detection_rate = detected_count / total if total > 0 else 0
        exact_accuracy = exact_matches / total if total > 0 else 0
        char_accuracy = correct_chars / total_chars if total_chars > 0 else 0

        return {
            'condition': condition,
            'total': total,
            'detected': detected_count,
            'detection_rate': detection_rate,
            'exact_matches': exact_matches,
            'exact_accuracy': exact_accuracy,
            'char_accuracy': char_accuracy,
            'results': results
        }

    def evaluate_all(self) -> Dict:
        """Evaluate on all conditions."""
        conditions = ['day', 'night', 'wet']
        all_results = {}

        for condition in conditions:
            print(f"\nEvaluating condition: {condition}")
            condition_results = self.evaluate_condition(condition)
            if condition_results:
                all_results[condition] = condition_results

        return all_results

    def save_results(self, all_results: Dict, output_csv: str, output_md: str):
        """Save evaluation results."""
        # Save CSV
        all_rows = []
        for condition, data in all_results.items():
            for row in data['results']:
                row['condition'] = condition
                all_rows.append(row)

        df = pd.DataFrame(all_rows)
        df.to_csv(output_csv, index=False)
        print(f"Results saved to {output_csv}")

        # Save Markdown report
        with open(output_md, 'w') as f:
            f.write("# Pipeline Evaluation Report\n\n")
            f.write(f"Date: {datetime.now().isoformat()}\n\n")

            # Overall summary
            total_images = sum(d['total'] for d in all_results.values())
            total_detected = sum(d['detected'] for d in all_results.values())
            total_exact = sum(d['exact_matches'] for d in all_results.values())

            f.write("## Overall Summary\n\n")
            f.write(f"- Total Images: {total_images}\n")
            f.write(f"- Plates Detected: {total_detected} ({total_detected/total_images:.1%})\n")
            f.write(f"- Exact Matches: {total_exact} ({total_exact/total_images:.1%})\n\n")

            # Per-condition breakdown
            f.write("## Per-Condition Results\n\n")
            for condition, data in all_results.items():
                f.write(f"### {condition.capitalize()}\n\n")
                f.write(f"- Total: {data['total']}\n")
                f.write(f"- Detection Rate: {data['detection_rate']:.1%}\n")
                f.write(f"- Exact Accuracy: {data['exact_accuracy']:.1%}\n")
                f.write(f"- Character Accuracy: {data['char_accuracy']:.1%}\n\n")

        print(f"Report saved to {output_md}")


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Evaluate full pipeline on local photos")
    parser.add_argument("--model", default="models/plate_detector.pt",
                       help="Path to trained YOLOv5 model")
    parser.add_argument("--local-dir", default="data/local",
                       help="Directory with local test photos")
    parser.add_argument("--output-csv", default="evaluation_results.csv",
                       help="Output CSV file")
    parser.add_argument("--output-md", default="evaluation_summary.md",
                       help="Output Markdown report")
    parser.add_argument("--gpu", action="store_true", help="Use GPU")

    args = parser.parse_args()

    # Check if model exists
    if not Path(args.model).exists():
        print(f"Model not found: {args.model}")
        print("Please train the model first or download pre-trained weights")
        print("For now, you can test with yolov5s.pt from torch.hub")
        print("\nTo use pre-trained weights, run:")
        print("python scripts/evaluate_pipeline.py --model yolov5s.pt")
        return

    # Run evaluation
    evaluator = PipelineEvaluator(args.model, args.local_dir, use_gpu=args.gpu)

    # Check if local data exists
    csv_file = Path(args.local_dir) / "plates.csv"
    if not csv_file.exists():
        print(f"\nNo local evaluation data found in {args.local_dir}")
        print("\nTo add your local photos:")
        print("1. Add photos to data/local/images/{day,night,wet}/")
        print("2. Update data/local/plates.csv with filename, condition, plate_text")
        print("3. Run this script again")
        return

    all_results = evaluator.evaluate_all()

    if not all_results:
        print("No evaluation results")
        return

    # Save results
    evaluator.save_results(all_results, args.output_csv, args.output_md)

    print("\nEvaluation complete!")
    print(f"Results: {args.output_csv}")
    print(f"Report: {args.output_md}")


if __name__ == "__main__":
    main()
