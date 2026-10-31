"""Build a transparent red/white Umbrella mark, without an app tile or matte."""
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import xml.etree.ElementTree as ET
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / 'build'
BACKUP = BUILD / 'before-umbrella-transparent'
BACKUP.mkdir(parents=True, exist_ok=True)
LAUNCHER = Path.home() / 'Desktop/Red Queen.app'
if not LAUNCHER.exists():
    LAUNCHER = Path.home() / 'Desktop/Javis.app'
for source, name in [(BUILD / 'icon.png', 'icon.png'), (BUILD / 'javis.icns', 'javis.icns'),
                     (ROOT / 'assets/redqueen-mark.png', 'redqueen-mark.png'),
                     (LAUNCHER / 'Contents/Info.plist', 'launcher-Info.plist'),
                     (LAUNCHER / 'Contents/Resources/javis.icns', 'launcher-javis.icns')]:
    if source.exists() and not (BACKUP / name).exists():
        shutil.copy2(source, BACKUP / name)

# Reuse the project's established eight-panel vector. Remove every outline and
# background rather than trying to erase a matte from a generated raster image.
original = ET.parse(ROOT / 'assets/umbrella-inline.svg').getroot()
paths = [(element.attrib['d'], '#E31B2B' if 'red' in element.attrib.get('class', '').split() else '#FFFFFF')
         for element in original if element.tag.rsplit('}', 1)[-1] == 'path']
assert len(paths) == 8
svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240">\n'
svg += ''.join(f'  <path d="{data}" fill="{color}"/>\n' for data, color in paths) + '</svg>\n'
(ROOT / 'assets/umbrella-mark.svg').write_text(svg)

# Supersample the existing M/L/Q/Z paths. No extra rasterizer dependency needed.
size, supersample = 1024, 4
scale = size * supersample / 240
image = Image.new('RGBA', (size * supersample, size * supersample), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
for data, color in paths:
    tokens = re.findall(r'[MLQZ]|-?\d+(?:\.\d+)?', data)
    index, points, current = 0, [], (0, 0)
    while index < len(tokens):
        command = tokens[index]
        index += 1
        if command in ('M', 'L'):
            current = (float(tokens[index]), float(tokens[index + 1]))
            index += 2
            points.append(current)
        elif command == 'Q':
            control = (float(tokens[index]), float(tokens[index + 1]))
            end = (float(tokens[index + 2]), float(tokens[index + 3]))
            index += 4
            start = current
            for step in range(1, 65):
                t = step / 64
                points.append(tuple((1 - t) ** 2 * start[axis] + 2 * (1 - t) * t * control[axis] + t ** 2 * end[axis] for axis in (0, 1)))
            current = end
        elif command != 'Z':
            raise ValueError(f'Unsupported path command: {command}')
    draw.polygon([(round(x * scale), round(y * scale)) for x, y in points], fill=color)
image = image.resize((size, size), Image.Resampling.LANCZOS)
image.save(BUILD / 'icon.png', optimize=True)
image.save(ROOT / 'assets/umbrella.png', optimize=True)
image.resize((128, 128), Image.Resampling.LANCZOS).save(ROOT / 'assets/redqueen-mark.png')
iconset = BUILD / 'umbrella-transparent.iconset'
iconset.mkdir(exist_ok=True)
for logical in [16, 32, 128, 256, 512]:
    for factor in [1, 2]:
        suffix = '@2x' if factor == 2 else ''
        image.resize((logical * factor, logical * factor), Image.Resampling.LANCZOS).save(iconset / f'icon_{logical}x{logical}{suffix}.png')
subprocess.run(['/usr/bin/iconutil', '-c', 'icns', str(iconset), '-o', str(BUILD / 'javis.icns')], check=True)

# A new resource name lets Finder invalidate the former tile icon naturally.
plist = LAUNCHER / 'Contents/Info.plist'
if plist.exists():
    resource = LAUNCHER / 'Contents/Resources/umbrella-transparent.icns'
    shutil.copy2(BUILD / 'javis.icns', resource)
    with plist.open('rb') as stream:
        info = plistlib.load(stream)
    info['CFBundleIconFile'] = 'umbrella-transparent'
    with plist.open('wb') as stream:
        plistlib.dump(info, stream)
    LAUNCHER.touch()

alpha = image.getchannel('A')
assert alpha.getextrema() == (0, 255)
assert all(image.getpixel(point)[3] == 0 for point in [(0, 0), (512, 0), (1023, 1023), (0, 512)])
print('Built transparent Umbrella PNG / SVG / ICNS, header mark and desktop launcher. No tile, outer border, shadow or matte.')
