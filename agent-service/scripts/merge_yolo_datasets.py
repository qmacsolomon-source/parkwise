"""
Merge YOLO plate-detection datasets into data/merged as a single-class
(license_plate) dataset.

- Prefixes filenames per source dataset
- Skips exact duplicate images by SHA256 hash
- Skips images with no whole-plate boxes
- Converts polygon labels to YOLO xywh boxes
- If a dataset has no test split, holds out ~10% of its images for test
- Never places the same image in two splits
"""
from __future__ import annotations

import argparse
import hashlib
import random
import shutil
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Set, Tuple

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
PLATE_NAME_HINTS = (
    "license_plate",
    "license-plate",
    "licenseplate",
    "plate-number",
    "platenumber",
    "plate_number",
    "number_plate",
    "number-plate",
    "licence_plate",
    "licence-plate",
    "plate",
)
CHAR_LIKE = set("abcdefghijklmnopqrstuvwxyz0123456789")

SplitName = str  # train | valid | test


def compute_file_hash(filepath: Path) -> str:
    sha256_hash = hashlib.sha256()
    with open(filepath, "rb") as f:
        for byte_block in iter(lambda: f.read(65536), b""):
            sha256_hash.update(byte_block)
    return sha256_hash.hexdigest()


def polygon_to_bbox(coords: List[float]) -> List[float]:
    xs = coords[0::2]
    ys = coords[1::2]
    x_min, x_max = min(xs), max(xs)
    y_min, y_max = min(ys), max(ys)
    width = max(0.0, x_max - x_min)
    height = max(0.0, y_max - y_min)
    x_center = (x_min + x_max) / 2
    y_center = (y_min + y_max) / 2
    return [x_center, y_center, width, height]


def parse_yaml_simple(path: Path) -> Dict:
    """Minimal YAML reader for Roboflow data.yaml (no extra dependency)."""
    try:
        import yaml

        with open(path, "r", encoding="utf-8") as f:
            return yaml.safe_load(f) or {}
    except Exception:
        pass

    data: Dict = {}
    names: List[str] = []
    in_names = False
    with open(path, "r", encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#"):
                in_names = False
                continue
            if line.startswith("names:"):
                rest = line.split(":", 1)[1].strip()
                if rest.startswith("[") and rest.endswith("]"):
                    inner = rest[1:-1]
                    data["names"] = [p.strip().strip("'\"") for p in inner.split(",") if p.strip()]
                    in_names = False
                else:
                    in_names = True
                    names = []
                continue
            if in_names and line.startswith("-"):
                names.append(line[1:].strip().strip("'\""))
                data["names"] = names
                continue
            in_names = False
            if ":" in line and not line.startswith("-"):
                key, val = line.split(":", 1)
                key, val = key.strip(), val.strip()
                if key == "nc":
                    try:
                        data["nc"] = int(val)
                    except ValueError:
                        data["nc"] = val
                elif key in ("train", "val", "test"):
                    data[key] = val
    return data


def class_names(config: Dict) -> List[str]:
    names = config.get("names", [])
    if isinstance(names, dict):
        return [names[k] for k in sorted(names, key=lambda x: int(x))]
    if isinstance(names, list):
        return [str(n) for n in names]
    return []


def plate_class_ids(names: List[str]) -> Set[int]:
    """Keep whole-plate classes; drop per-character classes."""
    if not names:
        return {0}

    ids: Set[int] = set()
    for i, raw in enumerate(names):
        name = str(raw).strip().lower().replace(" ", "-")
        if name in CHAR_LIKE or (len(name) == 1 and name.isalnum()):
            continue
        compact = name.replace("_", "-")
        if any(hint in compact or compact == hint for hint in PLATE_NAME_HINTS):
            ids.add(i)

    if not ids and len(names) == 1:
        ids.add(0)
    return ids


def find_images(images_dir: Path) -> List[Path]:
    if not images_dir.is_dir():
        return []
    files = [p for p in images_dir.iterdir() if p.is_file() and p.suffix.lower() in IMAGE_EXTS]
    return sorted(files)


def extract_plate_boxes(label_path: Path, keep_ids: Set[int]) -> List[List[float]]:
    if not label_path.exists():
        return []
    boxes: List[List[float]] = []
    text = label_path.read_text(encoding="utf-8", errors="ignore")
    for line in text.splitlines():
        parts = line.strip().split()
        if len(parts) < 5:
            continue
        try:
            class_id = int(float(parts[0]))
            coords = [float(x) for x in parts[1:]]
        except ValueError:
            continue
        if class_id not in keep_ids:
            continue
        if len(coords) == 4:
            box = coords
        elif len(coords) >= 6 and len(coords) % 2 == 0:
            box = polygon_to_bbox(coords)
        else:
            continue
        _, _, w, h = box
        if w <= 0 or h <= 0:
            continue
        boxes.append(box)
    return boxes


def write_label(path: Path, boxes: List[List[float]]) -> None:
    lines = []
    for box in boxes:
        coords = " ".join(f"{v:.6f}" for v in box)
        lines.append(f"0 {coords}\n")
    path.write_text("".join(lines), encoding="utf-8")


def write_data_yaml(output_dir: Path) -> None:
    train = (output_dir / "train" / "images").resolve().as_posix()
    val = (output_dir / "valid" / "images").resolve().as_posix()
    test = (output_dir / "test" / "images").resolve().as_posix()
    content = (
        f"path: {output_dir.resolve().as_posix()}\n"
        f"train: {train}\n"
        f"val: {val}\n"
        f"test: {test}\n"
        "nc: 1\n"
        "names: ['license_plate']\n"
    )
    (output_dir / "data.yaml").write_text(content, encoding="utf-8")


def prepare_output_dirs(output_dir: Path) -> None:
    if output_dir.exists():
        for child in output_dir.iterdir():
            if child.is_dir():
                shutil.rmtree(child)
            else:
                child.unlink()
    for split in ("train", "valid", "test"):
        (output_dir / split / "images").mkdir(parents=True, exist_ok=True)
        (output_dir / split / "labels").mkdir(parents=True, exist_ok=True)


def collect_dataset_samples(
    dataset_path: Path,
    keep_ids: Set[int],
) -> Dict[SplitName, List[Tuple[Path, Path, List[List[float]]]]]:
    by_split: Dict[SplitName, List[Tuple[Path, Path, List[List[float]]]]] = {
        "train": [],
        "valid": [],
        "test": [],
    }
    for split in ("train", "valid", "test"):
        images_dir = dataset_path / split / "images"
        labels_dir = dataset_path / split / "labels"
        if not images_dir.exists():
            continue
        for image_file in find_images(images_dir):
            label_file = labels_dir / f"{image_file.stem}.txt"
            boxes = extract_plate_boxes(label_file, keep_ids)
            by_split[split].append((image_file, label_file, boxes))
    return by_split


def assign_missing_test(
    by_split: Dict[SplitName, List],
    fraction: float,
    rng: random.Random,
) -> None:
    if by_split["test"]:
        return
    total = sum(len(by_split[s]) for s in ("train", "valid", "test"))
    if total == 0:
        return
    n_test = max(1, int(round(total * fraction)))
    n_test = min(n_test, total - 1) if total > 1 else 0
    if n_test <= 0:
        return

    # Prefer holding out from train so valid stays a true validation set.
    pool_split = "train" if len(by_split["train"]) >= n_test else (
        "train" if by_split["train"] else "valid"
    )
    pool = by_split[pool_split]
    if len(pool) < n_test:
        combined = by_split["train"] + by_split["valid"]
        rng.shuffle(combined)
        by_split["test"] = combined[:n_test]
        remain = combined[n_test:]
        n_valid = min(len(by_split["valid"]), max(0, len(remain) // 10))
        by_split["valid"] = remain[:n_valid] if n_valid else []
        by_split["train"] = remain[n_valid:] if n_valid else remain
        return

    indices = list(range(len(pool)))
    rng.shuffle(indices)
    take = set(indices[:n_test])
    test_items = [pool[i] for i in range(len(pool)) if i in take]
    keep_items = [pool[i] for i in range(len(pool)) if i not in take]
    by_split[pool_split] = keep_items
    by_split["test"] = test_items


def unique_stem(prefix: str, image_file: Path, used: Set[str]) -> str:
    base = f"{prefix}_{image_file.stem}"
    stem = base
    n = 2
    while stem in used:
        stem = f"{base}_{n}"
        n += 1
    used.add(stem)
    return stem


def merge_datasets(
    datasets: List[Path],
    output_dir: Path,
    test_fraction: float = 0.10,
    seed: int = 42,
) -> None:
    rng = random.Random(seed)
    prepare_output_dirs(output_dir)

    seen_hashes: Set[str] = set()
    used_stems: Set[str] = set()
    counts = {"train": 0, "valid": 0, "test": 0}
    skipped_dup = 0
    skipped_empty = 0

    for dataset_path in datasets:
        print(f"\nProcessing dataset: {dataset_path.name}")
        config_path = dataset_path / "data.yaml"
        if not config_path.exists():
            print(f"  SKIP: no data.yaml (not treated as a YOLO detector set)")
            continue

        config = parse_yaml_simple(config_path)
        names = class_names(config)
        keep_ids = plate_class_ids(names)
        print(f"  Classes: {names}")
        print(f"  nc: {config.get('nc', len(names))}")
        print(f"  Keeping whole-plate class ids: {sorted(keep_ids)} as license_plate (0)")
        if len(names) > 1:
            dropped = [f"{i}:{n}" for i, n in enumerate(names) if i not in keep_ids]
            print(f"  Dropped classes: {dropped}")

        by_split = collect_dataset_samples(dataset_path, keep_ids)
        print(
            "  Source images: "
            f"train={len(by_split['train'])} valid={len(by_split['valid'])} test={len(by_split['test'])}"
        )
        if not by_split["test"]:
            assign_missing_test(by_split, test_fraction, rng)
            print(
                "  No test split; held out ~10% for test -> "
                f"train={len(by_split['train'])} valid={len(by_split['valid'])} test={len(by_split['test'])}"
            )

        prefix = dataset_path.name
        for split in ("train", "valid", "test"):
            for image_file, _label_file, boxes in by_split[split]:
                if not boxes:
                    skipped_empty += 1
                    print(f"  Skip (no plate boxes): {image_file.name}")
                    continue
                file_hash = compute_file_hash(image_file)
                if file_hash in seen_hashes:
                    skipped_dup += 1
                    print(f"  Skip duplicate: {image_file.name}")
                    continue
                seen_hashes.add(file_hash)

                stem = unique_stem(prefix, image_file, used_stems)
                dst_img = output_dir / split / "images" / f"{stem}{image_file.suffix.lower()}"
                dst_lbl = output_dir / split / "labels" / f"{stem}.txt"
                shutil.copy2(image_file, dst_img)
                write_label(dst_lbl, boxes)
                counts[split] += 1

    write_data_yaml(output_dir)

    print("\n========== Merged dataset ==========")
    print(f"Output: {output_dir.resolve()}")
    print(f"train: {counts['train']}")
    print(f"valid: {counts['valid']}")
    print(f"test:  {counts['test']}")
    print(f"total: {sum(counts.values())}")
    print(f"skipped duplicates: {skipped_dup}")
    print(f"skipped no plate boxes: {skipped_empty}")
    print(f"Wrote {output_dir / 'data.yaml'}")


def default_yolo_datasets(raw_root: Path) -> List[Path]:
    datasets = []
    for child in sorted(raw_root.iterdir()):
        if not child.is_dir():
            continue
        if (child / "data.yaml").exists():
            datasets.append(child)
        else:
            print(f"Not a YOLO detector dataset (skipped): {child.name}")
    return datasets


def main() -> None:
    parser = argparse.ArgumentParser(description="Merge YOLO plate datasets")
    parser.add_argument(
        "--datasets",
        nargs="+",
        default=None,
        help="YOLO dataset roots (must contain data.yaml). Default: data/raw/* with data.yaml",
    )
    parser.add_argument("--output", default="data/merged", help="Output directory")
    parser.add_argument("--test-fraction", type=float, default=0.10)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[1]
    output_path = Path(args.output)
    if not output_path.is_absolute():
        output_path = root / output_path

    if args.datasets:
        dataset_paths = [Path(d) if Path(d).is_absolute() else root / d for d in args.datasets]
    else:
        dataset_paths = default_yolo_datasets(root / "data" / "raw")

    print("Datasets to merge:")
    for p in dataset_paths:
        print(f"  - {p}")

    merge_datasets(dataset_paths, output_path, test_fraction=args.test_fraction, seed=args.seed)


if __name__ == "__main__":
    main()
