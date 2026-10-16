import torch
import sys
from pathlib import Path

# Add YOLOv5 to path
yolov5_path = Path(__file__).parent.parent / "third_party" / "yolov5"
sys.path.insert(0, str(yolov5_path))

from models.common import DetectMultiBackend
from utils.dataloaders import create_dataloader
from utils.general import check_dataset, colorstr
from utils.torch_utils import select_device
from utils.plots import Annotator, colors, save_one_box
import argparse
import yaml


def train_plate_detector(
    data_yaml: str,
    epochs: int = 100,
    batch_size: int = 16,
    img_size: int = 640,
    weights: str = "yolov5s.pt",
    device: str = "",
    project: str = "runs/train",
    name: str = "plate_detector"
):
    """
    Train YOLOv5 on plate detection dataset.
    """
    import subprocess

    # Select device
    device = select_device(device)
    print(f"Using device: {device}")

    # Construct train command
    cmd = [
        "python",
        str(yolov5_path / "train.py"),
        "--img", str(img_size),
        "--batch", str(batch_size),
        "--epochs", str(epochs),
        "--data", data_yaml,
        "--weights", weights,
        "--device", device,
        "--project", project,
        "--name", name,
        "--exist-ok",  # Overwrite existing runs
        "--patience", "50",  # Early stopping patience
        "--single-cls",  # Single class dataset
    ]

    print(f"Training command: {' '.join(cmd)}")

    # Run training
    result = subprocess.run(cmd, cwd=str(yolov5_path))
    return result.returncode


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train plate detector")
    parser.add_argument("--data", default="data/merged/data.yaml", help="Path to data.yaml")
    parser.add_argument("--epochs", type=int, default=100, help="Number of epochs")
    parser.add_argument("--batch", type=int, default=16, help="Batch size")
    parser.add_argument("--img", type=int, default=640, help="Image size")
    parser.add_argument("--weights", default="yolov5s.pt", help="Pre-trained weights")
    parser.add_argument("--device", default="", help="Device (empty for auto, 0 for cpu, 0,1 for cuda)")

    args = parser.parse_args()

    # Check GPU availability
    if not torch.cuda.is_available():
        print("=" * 60)
        print("WARNING: No GPU detected!")
        print("=" * 60)
        print(f"Training on CPU with {args.epochs} epochs, batch size {args.batch}")
        print("Estimated time: 10-20 hours (may vary)")
        print("")
        print("RECOMMENDATION: Use Google Colab for faster training")
        print("The Colab notebook is saved as scripts/train_plate_detector_colab.ipynb")
        print("=" * 60)
        print("")
        response = input("Continue with CPU training? (yes/no): ")
        if response.lower() != 'yes':
            print("Training cancelled.")
            sys.exit(0)

    return_code = train_plate_detector(
        data_yaml=args.data,
        epochs=args.epochs,
        batch_size=args.batch,
        img_size=args.img,
        weights=args.weights,
        device=args.device
    )

    if return_code == 0:
        print("\nTraining completed successfully!")
        print(f"Best weights saved to: runs/train/plate_detector/weights/best.pt")
        print("\nCopy best weights to models/plate_detector.pt")
    else:
        print(f"\nTraining failed with return code: {return_code}")
        sys.exit(1)
