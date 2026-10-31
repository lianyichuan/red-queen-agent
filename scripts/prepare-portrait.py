"""Turn the generated black-background portrait into a clean hologram texture.

Usage: python3 scripts/prepare-portrait.py source.png output.png
The source is kept intact. Scanlines and motion belong to the live renderer.
"""
import argparse
from pathlib import Path

from PIL import Image


def prepare(source, output):
    image = Image.open(source).convert('RGBA')
    pixels = []
    for r, g, b, original_alpha in image.getdata():
        signal = max(r, g, b)
        # A soft black matte keeps the red hair rim without a rectangular plate.
        amount = max(0.0, min(1.0, (signal - 3) / 25.0))
        amount = amount * amount * (3 - 2 * amount)
        pixels.append((r, g, b, round(original_alpha * amount)))
    image.putdata(pixels)
    bounds = image.getchannel('A').point(lambda value: 255 if value > 50 else 0).getbbox()
    if not bounds:
        raise ValueError('Source portrait has no visible subject.')
    left, top, right, bottom = bounds
    margin = round((right - left) * .055)
    image = image.crop((max(0, left - margin), max(0, top - margin), min(image.width, right + margin), min(image.height, bottom + margin)))
    image.thumbnail((900, 1400), Image.Resampling.LANCZOS)
    Path(output).parent.mkdir(parents=True, exist_ok=True)
    image.save(output, optimize=True)
    print(f'Prepared {image.width}×{image.height} RGBA portrait: {output}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source')
    parser.add_argument('output')
    args = parser.parse_args()
    prepare(args.source, args.output)
