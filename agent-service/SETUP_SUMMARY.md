# ParkWise Agent Service - Setup Summary

## Overview
This document summarizes the plate detection and OCR pipeline setup for the ParkWise agent service.

## Files Created

### Documentation
- **DATASETS.md** - Dataset inventory and usage plan
- **SETUP_SUMMARY.md** - This file

### Scripts
- **scripts/merge_yolo_datasets.py** - Merges YOLO datasets with polygon-to-bbox conversion
- **scripts/check_gpu.py** - Checks GPU availability for training
- **scripts/train_plate_detector.py** - Training script (CPU with confirmation, or Colab recommendation)
- **scripts/train_plate_detector_colab.ipynb** - Google Colab notebook for GPU training
- **scripts/evaluate_ocr.py** - Evaluates OCR accuracy on kaggle_archive test set
- **scripts/evaluate_pipeline.py** - Evaluates full detection+OCR pipeline on local photos
- **scripts/test_pipeline.py** - Tests pipeline with sample image

### Folders Created
- **scripts/** - Utility scripts
- **models/** - Trained model storage
- **data/merged/** - Merged detection dataset
- **data/local/** - Local evaluation photos (with day/night/wet subfolders)

### Modified Files
- **.gitignore** - Added data/, models/*.pt, third_party/, runs/
- **plate_recognition.py** - Updated to load local models, handle missing models gracefully

## Dataset Summary

### plate_number_v2 (Roboflow)
- Class: 'Plate-Number' (id 0)
- Format: YOLO v5 PyTorch with polygon annotations
- Images: 85 train, 11 valid, 0 test
- License: CC BY 4.0
- Notes: Polygon annotations converted to bounding boxes during merge

### philippine_plates_v1 (Roboflow)
- Class: 'license-plate' (id 0)
- Format: YOLO v5 PyTorch (standard bbox)
- Images: 135 train, 12 valid, 6 test
- License: CC BY 4.0
- Notes: Philippine-specific plates

### kaggle_archive (plateOCR)
- Format: PaddleOCR format (cropped plates)
- Images: 373 train, 83 valid, 62 test
- Character set: A-Z, 0-9
- Notes: OCR-only dataset, not for detection training

### Merged Dataset (data/merged)
- Total unique images: 131 (111 train, 20 test)
- Class: 'license_plate' (id 0)
- Single-class YOLO format
- Duplicates removed by file hash

## PowerShell Commands

### 1. Merge Datasets
```powershell
cd C:\Users\PC\Downloads\PARKWISE\agent-service
python scripts/merge_yolo_datasets.py --datasets data/raw/philippine_plates_v1 data/raw/plate_number_v2 --output data/merged
```

### 2. Check GPU Availability
```powershell
cd C:\Users\PC\Downloads\PARKWISE\agent-service
python scripts/check_gpu.py
```

### 3. Train Plate Detector (GPU)
If you have a GPU:
```powershell
cd C:\Users\PC\Downloads\PARKWISE\agent-service
python scripts/train_plate_detector.py --data data/merged/data.yaml --epochs 100 --batch 16 --device 0
```

### 4. Train Plate Detector (Google Colab - Recommended for CPU)
If no GPU detected:
1. Open `scripts/train_plate_detector_colab.ipynb` in Google Colab
2. Upload zipped `data/merged` folder
3. Run cells in order
4. Download `best.pt` and save as `models/plate_detector.pt`

### 5. Evaluate OCR
```powershell
cd C:\Users\PC\Downloads\PARKWISE\agent-service
python scripts/evaluate_ocr.py --test-dir data/raw/kaggle_archive/plateOCR/test --output ocr_evaluation_results.csv --report ocr_evaluation_report.txt
```

### 6. Evaluate Full Pipeline on Local Photos
First, add your photos:
```powershell
# Add photos to data/local/images/{day,night,wet}/
# Update data/local/plates.csv with: filename,condition,plate_text
```

Then run evaluation:
```powershell
cd C:\Users\PC\Downloads\PARKWISE\agent-service
python scripts/evaluate_pipeline.py --model models/plate_detector.pt --local-dir data/local --output-csv evaluation_results.csv --output-md evaluation_summary.md
```

### 7. Test Pipeline
```powershell
cd C:\Users\PC\Downloads\PARKWISE\agent-service
python scripts/test_pipeline.py
```

## Manual Steps Required

### 1. Create .env File
The agent-service requires `.env` file with Supabase credentials. Create it manually:
```powershell
cd C:\Users\PC\Downloads\PARKWISE\agent-service
# Create .env with:
# SUPABASE_URL=your_supabase_url
# SUPABASE_ANON_KEY=your_anon_key
# SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### 2. Train Model
- Without GPU: Use Google Colab notebook (scripts/train_plate_detector_colab.ipynb)
- With GPU: Run local training script
- Copy trained `best.pt` to `models/plate_detector.pt`

### 3. Add Local Evaluation Photos
```powershell
# Structure:
data/local/
  images/
    day/     (photos with good lighting)
    night/   (photos in low light)
    wet/     (photos in rain/wet conditions)
  labels/    (not used for this pipeline)
  plates.csv (format: filename,condition,plate_text)
```

### 4. Install Python Dependencies
```powershell
cd C:\Users\PC\Downloads\PARKWISE\agent-service
pip install torch torchvision easyocr opencv-python pyyaml pydantic pydantic-settings fastapi uvicorn python-multipart supabase python-dotenv aiofiles structlog thefuzz httpx
```

## Training/Expected Results

### Training (GPU)
- Estimated time: 1-2 hours on GPU
- Target metrics: mAP@0.5 > 0.85

### Training (CPU)
- Estimated time: 10-20 hours
- Recommendation: Use Google Colab instead

### OCR Evaluation
- Target: Exact match accuracy > 70% on kaggle_archive test set
- If < 70%, consider OCR fine-tuning with kaggle_archive train set

### Pipeline Evaluation
- Target: Detection rate > 90%, exact match > 85% on local photos
- Metrics per condition: day, night, wet

## Integration Notes

### plate_recognition.py
- Updated to load local models from `models/plate_detector.pt`
- Falls back to torch.hub if local model not found
- Handles missing models gracefully (logs warning, doesn't crash)
- Supports both local DetectMultiBackend and hub loading paths

### Config Settings
Update `config.py` or `.env`:
```python
yolo_model_path = "models/plate_detector.pt"  # Your trained model
ocr_gpu = True  # Set to False if no GPU
```

## Troubleshooting

### No GPU Detected
- Use Google Colab notebook for training
- Pipeline can still run on CPU (slower)

### EasyOCR Download Error
- First run downloads models (~300MB)
- Subsequent runs use cached models

### Dataset Merge Issues
- Some images from plate_number_v2 skipped due to invalid polygon annotations
- This is expected - 131 images is sufficient for initial training

### Model Loading Errors
- Ensure `models/plate_detector.pt` exists
- If not, train model first or use pre-trained yolov5s.pt from hub

## Next Steps

1. **Train Model**: Use Colab notebook or local GPU
2. **Evaluate OCR**: Run OCR evaluation to check if fine-tuning is needed
3. **Add Local Photos**: Prepare your 500+ photo evaluation set
4. **Evaluate Pipeline**: Run full pipeline evaluation on local photos
5. **Deploy**: Integration with agent service endpoints

## Important Notes

- **Never mix local evaluation photos into training data**
- **Never commit images, model weights, or .env files**
- **Always validate Philippine plate format (3 letters + 3-4 digits)**
- **Use CPU training only if Colab is unavailable (very slow)**
