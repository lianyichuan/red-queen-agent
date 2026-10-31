# 红后半身四帧后期：绿幕抠图 → 轻度全息处理（保留电影红裙配色）→ assets
import os

from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..')

FRAMES = ['idle', 'greet', 'talk', 'talk-open']


def chroma_key(im):
    """绿幕抠图：greenness 连续 alpha + 去绿边"""
    im = im.convert('RGBA')
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            greenness = (g - max(r, b)) / 255.0
            if greenness > 0.06:
                alpha = max(0.0, 1.0 - (greenness - 0.06) / 0.10)
                if alpha < 1.0:
                    # 去绿溢出：把 g 压到 max(r,b)
                    g2 = int(max(r, b) + (g - max(r, b)) * alpha)
                    px[x, y] = (r, g2, b, int(a * alpha))
            elif g > r and g > b:
                # 边缘轻微去绿
                px[x, y] = (r, max(r, b), b, a)
    return im


def hologram(im):
    """轻度全息：红调叠加 + 扫描线 + 底部淡出（顺带清掉底部残留）"""
    im = im.convert('RGBA')
    px = im.load()
    w, h = im.size
    for y in range(h):
        scan = 0.82 if (y % 4 == 0) else 1.0  # 每 4 行一条扫描线
        # 底部 12% 渐变淡出 → 透明（半身像底缘全息消散）
        yn = y / h
        fade = 1.0
        if yn > 0.88:
            fade = max(0.0, (1.0 - yn) / 0.12)
        for x in range(w):
            r, g, b, a = px[x, y]
            if a > 0:
                r2 = int(r * 0.88 + 255 * 0.12)
                g2 = int(g * 0.88 + 60 * 0.12)
                b2 = int(b * 0.88 + 60 * 0.12)
                px[x, y] = (r2, g2, b2, int(a * scan * fade))
    return im


# 第一步：全部抠图
keyed = {}
for name in FRAMES:
    src = os.path.join(ROOT, 'design', f'raw2-{name}.png')
    keyed[name] = chroma_key(Image.open(src))

# 第二步：统一裁剪框 = 四帧可见内容的并集边界（保证动画帧不抖动）
from PIL import ImageChops

def alpha_bbox(im):
    # 阈值化：只算明确可见（alpha>60）的像素，避免半透明边缘把框撑大
    return im.getchannel('A').point(lambda a: 255 if a > 60 else 0).getbbox()

boxes = [alpha_bbox(keyed[n]) for n in FRAMES]
box = (
    min(b[0] for b in boxes),
    min(b[1] for b in boxes),
    max(b[2] for b in boxes),
    max(b[3] for b in boxes),
)
# 四边留 4% 边距
w, h = box[2] - box[0], box[3] - box[1]
mx, my = int(w * 0.04), int(h * 0.04)
box = (max(0, box[0] - mx), max(0, box[1] - my), box[2] + mx, box[3] + my)
print(f'统一裁剪框: {box}')

# 第三步：裁剪 + 全息处理 + 保存
for name in FRAMES:
    dst = os.path.join(ROOT, 'assets', f'sprite-{name}.png')
    im = hologram(keyed[name].crop(box))
    im.save(dst)
    p = list(im.getdata())
    vis = sum(1 for q in p if q[3] > 40)
    print(f'{name}: {im.size}, 透明 {100 - vis / len(p) * 100:.0f}% → {dst}')

print('✓ 四帧后期完成（统一裁剪+全息+底部淡出）')
