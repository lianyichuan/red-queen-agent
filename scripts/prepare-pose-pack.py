"""Normalize generated film stills on a common projection canvas."""
from pathlib import Path
from PIL import Image, ImageDraw
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/poses'
OUT.mkdir(parents=True, exist_ok=True)
# Measured head centre, eye line, chin height; uniform transform preserves anatomy.
landmarks = {'idle': (512,448,730), 'scrutiny': (490,426,700), 'command': (500,430,700), 'takeover': (535,393,650), 'speaking': (512,442,730)}
for name, (cx, eye, chin) in landmarks.items():
    source = ROOT / ('output/imagegen/redqueen-cinematic-v3.png' if name == 'idle' else f'output/imagegen/pose-pack/{name}.png')
    im = Image.open(source).convert('RGBA')
    scale = 282 / (chin - eye)
    tx, ty = 512 - cx * scale, 448 - eye * scale
    im = im.transform((1024,1536), Image.Transform.AFFINE, (1/scale,0,-tx/scale,0,1/scale,-ty/scale), Image.Resampling.BICUBIC)
    pixels = []
    for r,g,b,alpha in im.getdata():
        amount = max(0.,min(1.,(max(r,g,b)-3)/25.))
        amount = amount*amount*(3-2*amount)
        pixels.append((r,g,b,round(alpha*amount)))
    im.putdata(pixels)
    im = im.crop((0,100,1024,1536)).resize((768,1077), Image.Resampling.LANCZOS)
    im.save(OUT/f'{name}.png', optimize=True)
sheet = Image.new('RGB',(1500,500),'#0c0b10'); draw=ImageDraw.Draw(sheet)
labels=['01 / STANDBY','02 / SCRUTINY','03 / COMMAND','04 / OVERRIDE','05 / VOICE']
for i,(name,label) in enumerate(zip(landmarks,labels)):
    im=Image.open(OUT/f'{name}.png'); im.thumbnail((280,430))
    sheet.paste(im,(i*300+(300-im.width)//2,20),im)
    draw.text((i*300+30,466),label,fill='#e997a2')
sheet.save(ROOT/'design/pose-pack/poses.jpg',quality=94)
print('Prepared five aligned RGBA poses and contact sheet.')
