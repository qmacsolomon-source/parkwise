from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    # Supabase
    supabase_url: str
    supabase_anon_key: str
    supabase_service_role_key: str
    
    # Agent Configuration
    grace_period_seconds: int = 60
    overstay_check_interval_seconds: int = 30
    fuzzy_match_threshold: float = 0.85
    max_retry_attempts: int = 3
    frame_storage_bucket: str = "frames"
    
    # Model Configuration
    # Pretrained license-plate detector (YOLOv5m fine-tuned on plates), not
    # a generic COCO yolov5s - see models/README.md for where it came from.
    yolo_model_path: str = "models/plate_detector.pt"
    ocr_gpu: bool = True
    
    # Server Configuration
    host: str = "0.0.0.0"
    port: int = 8000
    log_level: str = "INFO"
    
    class Config:
        env_file = ".env"
        case_sensitive = False


settings = Settings()
