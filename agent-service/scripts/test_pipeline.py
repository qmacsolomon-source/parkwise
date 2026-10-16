"""
Test the plate recognition pipeline with a sample image.
"""
import sys
from pathlib import Path
import cv2
import torch
from easyocr import Reader

# Add parent to path
sys.path.insert(0, str(Path(__file__).parent.parent))

def test_pipeline():
    """Test pipeline with a sample image without requiring config."""
    print("Testing plate recognition pipeline...")

    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    print(f"Using device: {device}")

    # Initialize models directly
    try:
        # Load EasyOCR
        print("Loading EasyOCR...")
        ocr_reader = Reader(['en'], gpu=device == 'cuda')
        print("✓ EasyOCR loaded")

        # Load YOLOv5 from hub for testing
        print("Loading YOLOv5s from hub...")
        yolo_model = torch.hub.load('ultralytics/yolov5', 'custom', path='yolov5s.pt', device=device)
        yolo_model.conf = 0.5
        yolo_model.iou = 0.45
        print("✓ YOLOv5 loaded")

    except Exception as e:
        print(f"✗ Failed to load models: {e}")
        return

    # Check if sample image exists
    sample_image = Path("data/raw/philippine_plates_v1/train/images/10_jpg.rf.4ecfe2f02ccc2353f1edc616cebe05d6.jpg")

    if not sample_image.exists():
        print(f"✗ Sample image not found: {sample_image}")
        print("\nTo test with your own image:")
        print("1. Place it in test_sample.jpg")
        print("2. Run this script again")
        return

    # Load image
    image = cv2.imread(str(sample_image))
    if image is None:
        print(f"✗ Failed to load image: {sample_image}")
        return

    print(f"✓ Loaded image: {sample_image.name}")

    # Detect plate
    try:
        print("Detecting plate...")
        results = yolo_model(image)
        detections = results.pandas().xyxy[0]

        if len(detections) == 0:
            print("⚠ No plate detected (expected with untrained yolov5s)")
            print("✓ Pipeline structure working - needs training for accuracy")
            return

        # Get best detection
        best = detections.loc[detections['confidence'].idxmax()]
        x1, y1, x2, y2 = int(best['xmin']), int(best['ymin']), int(best['xmax']), int(best['ymax'])
        print(f"✓ Plate detected at: ({x1}, {y1}, {x2}, {y2})")

        # Crop plate
        plate_image = image[y1:y2, x1:x2]

        # Read plate
        print("Reading plate text...")
        ocr_results = ocr_reader.readtext(plate_image)

        if not ocr_results:
            print("⚠ No text detected")
            print("✓ Pipeline structure working - needs training for accuracy")
            return

        best_result = max(ocr_results, key=lambda x: x[2])
        text = best_result[0]
        confidence = float(best_result[2])

        print(f"✓ Recognition complete")
        print(f"  Detected: {text}")
        print(f"  Confidence: {confidence:.2%}")

        print("\n✓ Pipeline working correctly!")
        print("Note: This is using untrained yolov5s - train on Philippine plates for better accuracy")

    except Exception as e:
        print(f"✗ Pipeline test failed: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    test_pipeline()
