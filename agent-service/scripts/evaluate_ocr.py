"""
Evaluate OCR accuracy on kaggle_archive test set.
"""
import os
import cv2
from pathlib import Path
from typing import List, Tuple, Dict
from datetime import datetime
from easyocr import Reader


class OCREvaluator:
    """Evaluate OCR accuracy on Philippine plates."""

    def __init__(self, test_dir: str, use_gpu: bool = False):
        self.test_dir = Path(test_dir)
        self.reader = Reader(['en'], gpu=use_gpu)
        self.results = []

    def load_test_data(self) -> List[Tuple[str, str]]:
        """
        Load test images and labels from kaggle_archive format.
        Expects label.txt with format: filename\\tplate_text
        """
        label_file = self.test_dir / "label.txt"
        if not label_file.exists():
            raise FileNotFoundError(f"No label.txt found in {self.test_dir}")

        test_data = []
        with open(label_file, 'r') as f:
            for line in f:
                parts = line.strip().split('\t')
                if len(parts) >= 2:
                    filename, plate_text = parts[0], parts[1]
                    image_path = self.test_dir / filename
                    if image_path.exists():
                        test_data.append((str(image_path), plate_text))

        print(f"Loaded {len(test_data)} test images")
        return test_data

    def normalize_plate(self, text: str) -> str:
        """
        Normalize plate text to Philippine format.
        - Uppercase
        - Remove spaces
        - Fix common OCR confusions
        """
        if not text:
            return ""

        # Uppercase and remove spaces
        normalized = text.upper().replace(" ", "")

        # Fix common confusions
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
        """
        Validate Philippine plate format.
        Expected: 3 letters + 3-4 digits (e.g., ABC1234, ABCD1234)
        """
        if not text:
            return False

        # Length: 6-8 characters
        if len(text) < 6 or len(text) > 8:
            return False

        # Alphanumeric only
        if not text.isalnum():
            return False

        return True

    def evaluate(self, test_data: List[Tuple[str, str]]) -> Dict:
        """
        Evaluate OCR on test data.
        Returns metrics including exact match and character accuracy.
        """
        exact_matches = 0
        total = len(test_data)
        total_chars = 0
        correct_chars = 0
        confidences = []

        for image_path, ground_truth in test_data:
            # Load image
            image = cv2.imread(image_path)
            if image is None:
                print(f"Failed to load: {image_path}")
                continue

            # Run OCR
            results = self.reader.readtext(image)

            if not results:
                self.results.append({
                    'image': os.path.basename(image_path),
                    'ground_truth': ground_truth,
                    'detected': '',
                    'confidence': 0.0,
                    'exact_match': False,
                    'char_accuracy': 0.0
                })
                continue

            # Get best result
            best_result = max(results, key=lambda x: x[2])
            detected_text = best_result[0]
            confidence = float(best_result[2])

            # Normalize
            normalized = self.normalize_plate(detected_text)

            # Check exact match
            is_exact = normalized == ground_truth
            if is_exact:
                exact_matches += 1

            # Calculate character accuracy
            max_len = max(len(ground_truth), len(normalized))
            if max_len > 0:
                matches = sum(1 for a, b in zip(ground_truth, normalized) if a == b)
                char_acc = matches / max_len
            else:
                char_acc = 0.0

            total_chars += max_len
            correct_chars += matches

            # Store results
            self.results.append({
                'image': os.path.basename(image_path),
                'ground_truth': ground_truth,
                'detected': normalized,
                'raw_detected': detected_text,
                'confidence': confidence,
                'exact_match': is_exact,
                'char_accuracy': char_acc
            })

            confidences.append(confidence)

        # Calculate metrics
        exact_accuracy = exact_matches / total if total > 0 else 0
        char_accuracy = correct_chars / total_chars if total_chars > 0 else 0
        avg_confidence = sum(confidences) / len(confidences) if confidences else 0

        metrics = {
            'total': total,
            'exact_matches': exact_matches,
            'exact_accuracy': exact_accuracy,
            'char_accuracy': char_accuracy,
            'avg_confidence': avg_confidence,
            'results': self.results
        }

        return metrics

    def save_results(self, metrics: Dict, output_file: str):
        """Save results to CSV."""
        import csv

        with open(output_file, 'w', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=[
                'image', 'ground_truth', 'detected', 'raw_detected',
                'confidence', 'exact_match', 'char_accuracy'
            ])
            writer.writeheader()
            writer.writerows(metrics['results'])

        print(f"Results saved to {output_file}")

    def generate_report(self, metrics: Dict) -> str:
        """Generate human-readable report."""
        report = f"""
OCR Evaluation Report
====================
Date: {datetime.now().isoformat()}
Test Set: kaggle_archive/plateOCR/test
Total Images: {metrics['total']}
Exact Matches: {metrics['exact_matches']}
Exact Accuracy: {metrics['exact_accuracy']:.2%}
Character Accuracy: {metrics['char_accuracy']:.2%}
Average Confidence: {metrics['avg_confidence']:.2%}

Conclusion:
"""
        if metrics['exact_accuracy'] >= 0.9:
            report += "OCR performance is excellent. No fine-tuning needed.\n"
        elif metrics['exact_accuracy'] >= 0.7:
            report += "OCR performance is good. Fine-tuning may provide marginal improvements.\n"
        else:
            report += "OCR performance is poor. Consider fine-tuning with kaggle_archive train set.\n"

        return report


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Evaluate OCR accuracy")
    parser.add_argument("--test-dir", default="data/raw/kaggle_archive/plateOCR/test",
                       help="Directory containing test images")
    parser.add_argument("--output", default="ocr_evaluation_results.csv",
                       help="Output CSV file")
    parser.add_argument("--report", default="ocr_evaluation_report.txt",
                       help="Output report file")
    parser.add_argument("--gpu", action="store_true", help="Use GPU for OCR")

    args = parser.parse_args()

    # Run evaluation
    evaluator = OCREvaluator(args.test_dir, use_gpu=args.gpu)
    test_data = evaluator.load_test_data()

    if not test_data:
        print("No test data found")
        return

    metrics = evaluator.evaluate(test_data)

    # Save results
    evaluator.save_results(metrics, args.output)

    # Generate report
    report = evaluator.generate_report(metrics)
    with open(args.report, 'w') as f:
        f.write(report)

    print(report)


if __name__ == "__main__":
    main()
