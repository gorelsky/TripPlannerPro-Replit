from pathlib import Path

from PIL import Image, ImageChops


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "attached_assets" / "Средний_лого_1773929015411.png"
OUTPUT = ROOT / "client" / "public"


def trim(image: Image.Image) -> Image.Image:
    background = Image.new("RGB", image.size, "white")
    bounds = ImageChops.difference(image.convert("RGB"), background).getbbox()
    if not bounds:
        raise RuntimeError("Logo image is empty")
    return image.crop(bounds)


def make_icon(mark: Image.Image, size: int, filename: str, padding: float) -> None:
    canvas = Image.new("RGB", (size, size), "white")
    available = int(size * (1 - padding * 2))
    scale = min(available / mark.width, available / mark.height)
    resized = mark.resize((round(mark.width * scale), round(mark.height * scale)), Image.Resampling.LANCZOS)
    offset = ((size - resized.width) // 2, (size - resized.height) // 2)
    canvas.paste(resized, offset)
    canvas.save(OUTPUT / filename, "PNG", optimize=True)


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    logo = Image.open(SOURCE).convert("RGB")
    # The upper part contains the SLS mark; the lower part is small text at phone icon sizes.
    mark = trim(logo.crop((0, 0, logo.width, round(logo.height * 0.62))))

    make_icon(mark, 48, "favicon.png", 0.14)
    make_icon(mark, 180, "apple-touch-icon.png", 0.14)
    make_icon(mark, 192, "icon-192.png", 0.14)
    make_icon(mark, 512, "icon-512.png", 0.14)
    make_icon(mark, 512, "icon-512-maskable.png", 0.22)


if __name__ == "__main__":
    main()
