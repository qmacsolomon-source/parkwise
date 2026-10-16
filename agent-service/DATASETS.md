# ParkWise Agent Service - Datasets

## Dataset Inventory

### 1. plate_number_v2
- **Source**: Roboflow (https://universe.roboflow.com/helmet-detection-wuotk/plate-number-j8ar9)
- **License**: CC BY 4.0
- **Format**: YOLO v5 PyTorch
- **Class**: 'Plate-Number' (class id 0)
- **Image Counts**:
  - Train: 85 images
  - Valid: 11 images
  - Test: 0 images
- **Annotation Format**: Polygon annotations (many points per box) - NOT standard YOLO bounding boxes
- **Notes**: Uses detailed polygon annotations that need conversion to bounding boxes. Will convert polygon to bounding box during merge.
- **Usage**: Detection training (after polygon-to-bbox conversion)

### 2. philippine_plates_v1
- **Source**: Roboflow (https://universe.roboflow.com/arpee-arruejo-qati4/philippine-license-plates-ggaea)
- **License**: CC BY 4.0
- **Format**: YOLO v5 PyTorch
- **Class**: 'license-plate' (class id 0)
- **Image Counts**:
  - Train: 135 images
  - Valid: 12 images
  - Test: 6 images
- **Annotation Format**: Standard YOLO bounding box (class x_center y_center width height)
- **Notes**: Philippine-specific plates, suitable for detection training.
- **Usage**: Detection training

### 3. kaggle_archive (plateOCR)
- **Source**: Kaggle Philippines Plate Number OCR
- **License**: Unknown (assumed dataset license)
- **Format**: PaddleOCR format (cropped plate images)
- **Character Set**: A-Z, 0-9 (36 characters in custom_dict.txt)
- **Image Counts**:
  - Train: 373 images
  - Valid: 83 images
  - Test: 62 images
- **Annotation Format**: label.txt files with format "filename\tplate_text"
- **Notes**: Pre-cropped license plate images with text labels. Designed for OCR training (SVTR architecture). Not YOLO format.
- **Usage**: OCR evaluation and potential OCR fine-tuning. NOT for detection training.

## Dataset Usage Plan

### Detection Training (YOLOv5)
- **Input**: philippine_plates_v1 + plate_number_v2 (after polygon-to-bbox conversion)
- **Output**: Merged dataset in `data/merged/`
- **Class**: Single class 'license_plate' (class id 0)
- **Split Strategy**: 80% train, 20% test (skipping duplicates by hash)

### OCR Evaluation
- **Input**: kaggle_archive/plateOCR/test
- **Purpose**: Evaluate EasyOCR accuracy on Philippine plates
- **Metrics**: Exact match accuracy, character accuracy

### Local Evaluation
- **Input**: data/local/ (day, night, wet conditions)
- **Purpose**: End-to-end pipeline evaluation on real deployment conditions
- **Format**: plates.csv with columns: filename, condition, plate_text

## Important Notes

1. **No Data Mixing**: The local evaluation set (data/local) will NEVER be mixed into training data.
2. **Polygon Conversion**: plate_number_v2 uses polygon annotations that must be converted to bounding boxes.
3. **Single Class**: All detection datasets merged to single class 'license_plate' (id 0).
4. **Duplicate Prevention**: Images with identical file hashes will not appear in both train and test splits.
5. **OCR vs Detection**: kaggle_archive is OCR-only (cropped plates), not suitable for detection training.
