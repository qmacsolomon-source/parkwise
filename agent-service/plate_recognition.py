import torch
import cv2
import numpy as np
from easyocr import Reader
from typing import Tuple, Optional, List
from config import settings
from logger import get_logger
from pathlib import Path
import sys

logger = get_logger(__name__)

# Add YOLOv5 to path for local model loading
yolov5_path = Path(__file__).parent.parent / "third_party" / "yolov5"
if yolov5_path.exists():
    sys.path.insert(0, str(yolov5_path))


class PlateRecognizer:
    """License plate recognition using YOLOv5 + EasyOCR."""

    def __init__(self):
        self.yolo_model = None
        self.ocr_reader = None
        self.device = 'cuda' if settings.ocr_gpu and torch.cuda.is_available() else 'cpu'
        logger.info("Initializing plate recognizer", device=self.device)
        self._load_models()

    def _load_models(self):
        """Load YOLOv5 and EasyOCR models."""
        try:
            # Load YOLOv5 model from local file if available, otherwise from hub
            model_path = Path(settings.yolo_model_path)
            if model_path.exists():
                logger.info(f"Loading local YOLOv5 model from {model_path}")
                try:
                    from models.common import DetectMultiBackend
                    self.yolo_model = DetectMultiBackend(
                        str(model_path),
                        device=self.device,
                        dnn=False,
                        fp16=False
                    )
                    self.yolo_model.half() if self.device == 'cuda' else None
                    self.yolo_model.eval()
                    logger.info("Local YOLOv5 model loaded successfully")
                except Exception as e:
                    logger.warning(f"Failed to load local model, falling back to hub: {e}")
                    self.yolo_model = torch.hub.load('ultralytics/yolov5', 'custom',
                                                     path=str(model_path),
                                                     device=self.device)
            else:
                logger.info(f"Model file not found at {model_path}, using yolov5s.pt from hub")
                self.yolo_model = torch.hub.load('ultralytics/yolov5', 'custom',
                                                 path='yolov5s.pt',
                                                 device=self.device)

            self.yolo_model.conf = 0.5  # Confidence threshold
            self.yolo_model.iou = 0.45  # NMS IOU threshold
            logger.info("YOLOv5 model loaded")

            # Load EasyOCR
            self.ocr_reader = Reader(['en'], gpu=settings.ocr_gpu)
            logger.info("EasyOCR model loaded")

        except Exception as e:
            logger.error("Failed to load models", error=str(e))
            # Don't raise - allow the service to start without models
            logger.warning("Plate recognition will not be available")
    
    def detect_plate(self, image: np.ndarray) -> Optional[Tuple[int, int, int, int]]:
        """
        Detect license plate in image using YOLOv5.
        Returns (x1, y1, x2, y2) bounding box or None.
        """
        if self.yolo_model is None:
            logger.warning("YOLOv5 model not loaded")
            return None

        try:
            # Convert BGR to RGB
            img = image[..., ::-1]
            img = np.ascontiguousarray(img)

            # Run inference
            if hasattr(self.yolo_model, 'forward'):
                # Local model loading path
                img = torch.from_numpy(img).to(self.device).float() / 255.0
                if img.ndimension() == 3:
                    img = img.unsqueeze(0)

                # Inference
                pred = self.yolo_model(img, augment=False, visualize=False)

                # Process predictions
                from utils.general import non_max_suppression, scale_boxes
                pred = non_max_suppression(pred, 0.5, 0.45, None, False, max_det=1000)

                if pred is not None and len(pred):
                    for det in pred:
                        if det is not None and len(det):
                            # Scale boxes back to original image
                            det[:, :4] = scale_boxes(img.shape[2:], det[:, :4], img.shape).round()

                            # Get highest confidence detection
                            best_det = det[det[:, 4].argmax()]
                            x1, y1, x2, y2 = best_det[:4].tolist()

                            logger.debug("Plate detected", bbox=(x1, y1, x2, y2),
                                        confidence=float(best_det[4]))
                            return (int(x1), int(y1), int(x2), int(y2))
            else:
                # Hub model loading path
                results = self.yolo_model(image)

                # Get detections
                detections = results.pandas().xyxy[0]

                # Filter for license plate class (class 0)
                plate_detections = detections[detections['class'] == 0]

                if len(plate_detections) == 0:
                    logger.debug("No plate detected")
                    return None

                # Get the highest confidence detection
                best_detection = plate_detections.loc[plate_detections['confidence'].idxmax()]

                x1, y1, x2, y2 = int(best_detection['xmin']), int(best_detection['ymin']), \
                                 int(best_detection['xmax']), int(best_detection['ymax'])

                logger.debug("Plate detected", bbox=(x1, y1, x2, y2),
                            confidence=float(best_detection['confidence']))
                return (x1, y1, x2, y2)

            logger.debug("No plate detected")
            return None

        except Exception as e:
            logger.error("Plate detection failed", error=str(e))
            return None
    
    def crop_plate(self, image: np.ndarray, bbox: Tuple[int, int, int, int]) -> np.ndarray:
        """Crop plate region from image."""
        x1, y1, x2, y2 = bbox
        return image[y1:y2, x1:x2]
    
    def read_plate(self, plate_image: np.ndarray) -> Tuple[str, float]:
        """
        Read license plate text using EasyOCR.
        Returns (text, confidence).
        """
        if self.ocr_reader is None:
            logger.warning("EasyOCR not loaded")
            return "", 0.0

        try:
            results = self.ocr_reader.readtext(plate_image)

            if not results:
                logger.debug("No text detected in plate region")
                return "", 0.0

            # Get the highest confidence result
            best_result = max(results, key=lambda x: x[2])
            text = best_result[0]
            confidence = float(best_result[2])

            logger.debug("Plate text detected", text=text, confidence=confidence)
            return text, confidence

        except Exception as e:
            logger.error("Plate reading failed", error=str(e))
            return "", 0.0
    
    def normalize_plate(self, text: str) -> str:
        """
        Normalize plate text.
        - Convert to uppercase
        - Remove spaces
        - Fix common OCR confusions (O/0, I/1)
        """
        if not text:
            return ""
        
        # Convert to uppercase and remove spaces
        normalized = text.upper().replace(" ", "")
        
        # Fix common confusions
        replacements = {
            'O': '0',  # Letter O to digit 0
            'I': '1',  # Letter I to digit 1
            'S': '5',  # Letter S to digit 5
            'Z': '2',  # Letter Z to digit 2
            'B': '8',  # Letter B to digit 8
        }
        
        # Only replace if it makes sense (e.g., in positions where digits are expected)
        # This is a simple heuristic - you may need to adjust based on your plate format
        for old, new in replacements.items():
            normalized = normalized.replace(old, new)
        
        logger.debug("Plate normalized", original=text, normalized=normalized)
        return normalized
    
    def is_valid_plate_format(self, text: str) -> bool:
        """
        Validate plate format.
        Reject motorcycle plates (typically shorter).
        Only accept standard 4-wheeler plates.
        """
        if not text:
            return False
        
        # Philippine plate format: typically 7-8 characters (e.g., ABC1234, ABCD1234)
        # Motorcycle plates are typically shorter (e.g., AB1234)
        if len(text) < 6 or len(text) > 8:
            logger.debug("Invalid plate length", text=text, length=len(text))
            return False
        
        # Should be alphanumeric
        if not text.isalnum():
            logger.debug("Plate contains non-alphanumeric characters", text=text)
            return False
        
        return True
    
    def recognize(self, image: np.ndarray) -> Tuple[str, float]:
        """
        Full recognition pipeline: detect -> crop -> read -> normalize.
        Returns (normalized_plate_text, confidence).
        """
        # Detect plate
        bbox = self.detect_plate(image)
        if bbox is None:
            return "", 0.0

        # Crop plate
        plate_image = self.crop_plate(image, bbox)

        # Read plate
        text, confidence = self.read_plate(plate_image)
        if not text:
            return "", 0.0

        # Normalize
        normalized = self.normalize_plate(text)

        # Validate format
        if not self.is_valid_plate_format(normalized):
            logger.warning("Invalid plate format detected", text=normalized)
            return "", 0.0

        logger.info("Plate recognized", text=normalized, confidence=confidence)
        return normalized, confidence


# Singleton instance
_plate_recognizer: Optional[PlateRecognizer] = None


def get_plate_recognizer() -> PlateRecognizer:
    """Get plate recognizer singleton."""
    global _plate_recognizer
    if _plate_recognizer is None:
        _plate_recognizer = PlateRecognizer()
    return _plate_recognizer
