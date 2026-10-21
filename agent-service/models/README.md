# Models

This folder is gitignored (`*.pt` in `.gitignore`) - model weights don't belong in git. Anyone else setting up `agent-service` needs to get `plate_detector.pt` themselves:

```bash
curl -L -o models/plate_detector.pt https://huggingface.co/keremberke/yolov5m-license-plate/resolve/main/best.pt
```

This is a pretrained YOLOv5m model fine-tuned specifically for license plate detection (not the generic COCO `yolov5s.pt` the code falls back to if this file is missing) - reported at 98.8% mAP@0.5 on its own validation set. No training was done for this project; this is used as-is.

- Model card: https://huggingface.co/keremberke/yolov5m-license-plate
- License: not stated on the model card - fine for a school project, but check before any other use.

`config.py`'s `yolo_model_path` default already points here (`models/plate_detector.pt`). EasyOCR (the plate-*reading* half of the pipeline, in `plate_recognition.py`) is also pretrained and needs no setup beyond `pip install -r requirements.txt` - it downloads its own weights automatically on first use.
