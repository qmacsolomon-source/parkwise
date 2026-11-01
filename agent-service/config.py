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
    # If no real OCR match happens within this many seconds of the attendant
    # clicking Accept, _verify_plate() auto-verifies against expected_plate
    # anyway - trusting that the attendant already visually confirmed the
    # vehicle, rather than leaving the slot stuck forever (or raising an
    # alert) on a camera that can't get a clean read (bad angle/lighting,
    # or in testing, a screen-photo target). Logged as its own
    # 'timeout_override' verification_events.result, not 'match', so
    # History/Reports can tell a real camera match apart from this
    # fallback. confirm_vehicle() (the attendant's manual override) is
    # still available the whole time for anyone who doesn't want to wait
    # out the window.
    auto_pass_after_seconds: int = 30
    # A matched plate only auto-verifies without an attendant if the OCR read
    # was at least this confident. Below it, the frame still gets shown live
    # on the attendant's screen (photo + detected text) - they confirm it by
    # eye via POST /agents/{slot_id}/confirm instead of the agent trusting a
    # shaky read on its own.
    auto_verify_confidence_threshold: float = 0.6
    # If a confidently-read plate doesn't match the expected one, how many
    # consecutive frames before declaring an intruder alert.
    intruder_alert_after_frames: int = 3
    frame_storage_bucket: str = "frames"
    
    # ESP32-CAM hardware
    # When true, a frame arriving for an IDLE slot auto-arms the agent from that
    # slot's live reservation (expected plate = reserved vehicle's plate), so the
    # camera works without an attendant pressing "accept" first.
    auto_arm_frames: bool = False

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
