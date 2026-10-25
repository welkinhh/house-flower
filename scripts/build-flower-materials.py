"""Build lightweight Mini Program sprites from the preserved transparent PNG source set."""

from collections import Counter
from pathlib import Path
import colorsys
import json

from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "flower-assets" / "materials" / "source"
MINI_ASSET_DIR = ROOT / "miniprogram" / "assets" / "materials-ui"
DATA_DIR = ROOT / "miniprogram" / "data"
MAX_SIZE = (160, 240)

FLOWER_NAMES = {
    "carnation": ("康乃馨", "secondary"),
    "dahlia": ("大丽花", "main"),
    "daisy": ("雏菊", "secondary"),
    "gerbera": ("非洲菊", "main"),
    "hydrangea": ("绣球", "secondary"),
    "lily": ("百合", "main"),
    "lisianthus": ("洋桔梗", "secondary"),
    "peony": ("芍药", "main"),
    "rose": ("玫瑰", "main"),
    "stock": ("紫罗兰", "secondary"),
    "sunflower": ("向日葵", "main"),
    "sweet_pea": ("香豌豆", "secondary"),
    "tulip": ("郁金香", "main"),
}
GENERIC_NAMES = {
    "filler": ("配花", "filler", "束"),
    "greenery": ("叶材", "foliage", "枝"),
    "packaging": ("包装", "packaging", "份"),
}
CATEGORY_ORDER = {"main": 0, "secondary": 1, "filler": 2, "foliage": 3, "packaging": 4}
SPECIES_ORDER = {
    "rose": 0, "tulip": 1, "peony": 2, "sunflower": 3, "dahlia": 4,
    "gerbera": 5, "lily": 6, "carnation": 0, "lisianthus": 1,
    "stock": 2, "hydrangea": 3, "sweet_pea": 4, "daisy": 5,
}


def dominant_swatch(image: Image.Image, category: str) -> str:
    sample = image.convert("RGBA")
    focus_ratio = 0.48 if category in ("main", "secondary") else 0.7 if category == "filler" else 0.82
    sample = sample.crop((0, 0, sample.width, max(1, int(sample.height * focus_ratio))))
    sample.thumbnail((64, 64), Image.Resampling.BILINEAR)
    counts: Counter[tuple[int, int, int]] = Counter()
    bright_neutrals: Counter[tuple[int, int, int]] = Counter()
    pixels = sample.get_flattened_data() if hasattr(sample, "get_flattened_data") else sample.getdata()
    for red, green, blue, alpha in pixels:
        if alpha < 110:
            continue
        hue, saturation, value = colorsys.rgb_to_hsv(red / 255, green / 255, blue / 255)
        hue *= 360
        if category not in ("foliage", "packaging") and 64 <= hue <= 165 and saturation > 0.18:
            continue
        key = (round(red / 24) * 24, round(green / 24) * 24, round(blue / 24) * 24)
        if saturation > 0.14:
            counts[key] += 1
        elif value > 0.68:
            bright_neutrals[key] += 1
        else:
            counts[key] += 1
    if not counts:
        counts = bright_neutrals
    if not counts:
        return "#a9ad9e"
    red, green, blue = counts.most_common(1)[0][0]
    values = tuple(max(0, min(255, channel)) for channel in (red, green, blue))
    return "#" + "".join(f"{value:02x}" for value in values)


def build() -> None:
    if not SOURCE_DIR.is_dir():
        raise SystemExit(f"Missing source library: {SOURCE_DIR}")
    MINI_ASSET_DIR.mkdir(parents=True, exist_ok=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    sources = sorted(SOURCE_DIR.glob("*.png"), key=lambda path: path.name.lower())
    if not sources:
        raise SystemExit(f"No transparent PNG assets found in {SOURCE_DIR}")

    variant_counts: Counter[str] = Counter(path.stem.rsplit("_", 1)[0] for path in sources)
    catalog = []
    for source in sources:
        prefix, variant = source.stem.rsplit("_", 1)
        if prefix in FLOWER_NAMES:
            name, category = FLOWER_NAMES[prefix]
            unit = "支"
        else:
            name, category, unit = GENERIC_NAMES[prefix]
        if variant_counts[prefix] > 1:
            name = f"{name} {variant}"

        with Image.open(source) as image:
            image = ImageOps.exif_transpose(image).convert("RGBA")
            alpha_bounds = image.getchannel("A").getbbox()
            if alpha_bounds:
                image = image.crop(alpha_bounds)
            source_width, source_height = image.size
            swatch = dominant_swatch(image, category)
            image.thumbnail(MAX_SIZE, Image.Resampling.LANCZOS)
            if image.mode == "RGBA":
                background = Image.new("RGB", image.size, (255, 253, 249))
                background.paste(image, mask=image.getchannel("A"))
                image = background
            target = MINI_ASSET_DIR / f"{source.stem}.jpg"
            image.save(target, "JPEG", quality=58, optimize=True)

        catalog.append({
            "id": source.stem,
            "name": name,
            "category": category,
            "unit": unit,
            "swatch": swatch,
            "glyph": name[0],
            "assetPath": f"/assets/materials-ui/{source.stem}.jpg",
            "sourcePath": f"flower-assets/materials/source/{source.name}",
            "sourceWidth": source_width,
            "sourceHeight": source_height,
        })

    catalog.sort(key=lambda entry: (
        CATEGORY_ORDER[entry["category"]],
        SPECIES_ORDER.get(entry["id"].rsplit("_", 1)[0], 99),
        entry["id"],
    ))
    manifest = ROOT / "flower-assets" / "materials" / "catalog.json"
    manifest.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    category_type = "'main' | 'secondary' | 'filler' | 'foliage' | 'packaging'"
    lines = [
        "// Generated by scripts/build-flower-materials.py; edit the source manifest, not this file.",
        f"export type FlowerMaterialCategory = {category_type}",
        "export type FlowerMaterial = { id: string; name: string; category: FlowerMaterialCategory; unit: string; swatch: string; glyph: string; assetPath: string; sourceWidth: number; sourceHeight: number }",
        "export const FLOWER_MATERIALS: FlowerMaterial[] = [",
    ]
    for entry in catalog:
        lines.append("  " + json.dumps({key: value for key, value in entry.items() if key != "sourcePath"}, ensure_ascii=False) + ",")
    lines.extend(["]", ""])
    (DATA_DIR / "flower-catalog.ts").write_text("\n".join(lines), encoding="utf-8")

    total_bytes = sum(path.stat().st_size for path in MINI_ASSET_DIR.glob("*.jpg"))
    print(f"Built {len(catalog)} JPEG materials ({total_bytes / 1024 / 1024:.2f} MB).")
    print(f"Source catalog: {manifest}")
    print(f"Mini Program assets: {MINI_ASSET_DIR}")


if __name__ == "__main__":
    build()
