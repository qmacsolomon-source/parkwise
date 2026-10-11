import torch
import cv2
import numpy as np
from easyocr import Reader
from typing import Tuple, Optional, List
from config import settings
from logger import get_logger

logger = get_logger(__name__)


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
            # Load YOLOv5 model
            self.yolo_model = torch.hub.load('ultralytics/yolov5', 'custom', 
                                             path=settings.yolo_model_path, 
                                             device=self.device)
            self.yolo_model.conf = 0.5  # Confidence threshold
            self.yolo_model.iou = 0.45  # NMS IOU threshold
            logger.info("YOLOv5 model loaded")
            
            # Load EasyOCR
            self.ocr_reader = Reader(['en'], gpu=settings.ocr_gpu)
            logger.info("EasyOCR model loaded")
            
        except Exception as e:
            logger.error("Failed to load models", error=str(e))
            raise
    
    def detect_plate(self, image: np.ndarray) -> Optional[Tuple[int, int, int, int]]:
        """
        Detect license plate in image using YOLOv5.
        Returns (x1, y1, x2, y2) bounding box or None.
        """
        try:
            results = self.yolo_model(image)
            
            # Get detections
            detections = results.pandas().xyxy[0]
            
            # Filter for license plate class (assuming class 0 is license plate)
            # You may need to adjust based on your trained model
            plate_detections = detections[detections['name'] == 'license_plate']
            
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
