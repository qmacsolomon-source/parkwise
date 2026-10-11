"""
Evaluation script for plate recognition accuracy.
Tests on a folder of labeled plate images.
"""
import os
import cv2
import json
from pathlib import Path
from typing import List, Dict, Tuple
from datetime import datetime
from plate_recognition import PlateRecognizer, get_plate_recognizer
from matching import fuzzy_match
from logger import get_logger

logger = get_logger(__name__)


class PlateEvaluator:
    """Evaluate plate recognition accuracy."""
    
    def __init__(self, test_images_dir: str):
        self.test_images_dir = Path(test_images_dir)
        self.recognizer = get_plate_recognizer()
        self.results = []
    
    def load_test_data(self) -> List[Tuple[str, str]]:
        """
        Load test images and labels.
        Expects images in test_images_dir/ with corresponding .txt label files.
        Label file should contain the ground truth plate number.
        """
        test_data = []
        
        for image_file in self.test_images_dir.glob("*.jpg"):
            label_file = image_file.with_suffix('.txt')
            
            if label_file.exists():
                with open(label_file, 'r') as f:
                    ground_truth = f.read().strip()
                test_data.append((str(image_file), ground_truth))
                logger.info("Loaded test image", image=image_file.name, ground_truth=ground_truth)
            else:
                logger.warning("No label file found for image", image=image_file.name)
        
        return test_data
    
    def evaluate(self, test_data: List[Tuple[str, str]]) -> Dict:
        """
        Evaluate recognition on test data.
        Returns accuracy metrics.
        """
        correct = 0
        total = len(test_data)
        confidences = []
        similarities = []
        
        for image_path, ground_truth in test_data:
            # Load image
            image = cv2.imread(image_path)
            if image is None:
                logger.error("Failed to load image", image=image_path)
                continue
            
            # Recognize plate
            detected, confidence = self.recognizer.recognize(image)
            
            # Compute similarity
            similarity = fuzzy_match(detected, ground_truth)
            
            # Check if correct (exact match or high similarity)
            is_correct = detected == ground_truth or similarity >= 0.9
            
            if is_correct:
                correct += 1
            
            # Store results
            self.results.append({
                'image': os.path.basename(image_path),
                'ground_truth': ground_truth,
                'detected': detected,
                'confidence': confidence,
                'similarity': similarity,
                'correct': is_correct
            })
            
            confidences.append(confidence)
            similarities.append(similarity)
            
            logger.info("Evaluated image", image=os.path.basename(image_path),
                       detected=detected, ground_truth=ground_truth,
                       similarity=similarity, correct=is_correct)
        
        # Calculate metrics
        accuracy = correct / total if total > 0 else 0
        avg_confidence = sum(confidences) / len(confidences) if confidences else 0
        avg_similarity = sum(similarities) / len(similarities) if similarities else 0
        
        metrics = {
            'total': total,
            'correct': correct,
            'accuracy': accuracy,
            'avg_confidence': avg_confidence,
            'avg_similarity': avg_similarity,
            'results': self.results
        }
        
        logger.info("Evaluation complete", total=total, correct=correct, 
                   accuracy=accuracy, avg_confidence=avg_confidence)
        
        return metrics
    
    def save_results(self, metrics: Dict, output_file: str):
        """Save evaluation results to JSON file."""
        with open(output_file, 'w') as f:
            json.dump(metrics, f, indent=2, default=str)
        logger.info("Results saved", file=output_file)
    
    def generate_report(self, metrics: Dict) -> str:
        """Generate human-readable report."""
        report = f"""
Plate Recognition Evaluation Report
====================================
Date: {datetime.now().isoformat()}
Total Images: {metrics['total']}
Correct: {metrics['correct']}
Accuracy: {metrics['accuracy']:.2%}
Average Confidence: {metrics['avg_confidence']:.2%}
Average Similarity: {metrics['avg_similarity']:.2%}

Detailed Results:
-----------------
"""
        
        for result in metrics['results']:
            status = "✓" if result['correct'] else "✗"
            report += f"{status} {result['image']}: {result['detected']} (expected: {result['ground_truth']})\n"
            report += f"   Confidence: {result['confidence']:.2%}, Similarity: {result['similarity']:.2%}\n"
        
        return report


def main():
    """Main evaluation function."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Evaluate plate recognition accuracy")
    parser.add_argument("--test-dir", required=True, help="Directory containing test images")
    parser.add_argument("--output", default="evaluation_results.json", help="Output file for results")
    parser.add_argument("--report", default="evaluation_report.txt", help="Output file for report")
    
    args = parser.parse_args()
    
    # Initialize logger
    from logger import configure_logger
    configure_logger()
    
    # Run evaluation
    evaluator = PlateEvaluator(args.test_dir)
    test_data = evaluator.load_test_data()
    
    if not test_data:
        logger.error("No test data found", test_dir=args.test_dir)
        return
    
    metrics = evaluator.evaluate(test_data)
    
    # Save results
    evaluator.save_results(metrics, args.output)
    
    # Generate and save report
    report = evaluator.generate_report(metrics)
    with open(args.report, 'w') as f:
        f.write(report)
    
    print(report)


if __name__ == "__main__":
    main()
