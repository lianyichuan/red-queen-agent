# 生成保护伞 logo 的内联 SVG（贝塞尔内凹扇区，可逐扇区驱动动画）
# 输出两份：app 内联用 / 独立测试页
import math

R = 110.0
CTRL = 0.78 * R
CX = CY = 120.0
RED = '#BA0C12'
WHITE = '#FFFFFF'
STROKE = '#000000'
LW = 4.0

paths = []
for i in range(8):
    a_s = math.radians(22.5 + i * 45)
    a_e = math.radians(67.5 + i * 45)
    a_m = math.radians(45 + i * 45)
    # y 轴翻转（SVG y 向下），保持红扇区在上/下/左/右
    x0, y0 = CX + R * math.cos(a_s), CY - R * math.sin(a_s)
    x1, y1 = CX + R * math.cos(a_e), CY - R * math.sin(a_e)
    xc, yc = CX + CTRL * math.cos(a_m), CY - CTRL * math.sin(a_m)
    color = RED if i % 2 == 1 else WHITE
    cls = 'sector red' if i % 2 == 1 else 'sector'
    paths.append(
        f'<path class="{cls}" data-i="{i}" d="M{CX},{CY} L{x0:.1f},{y0:.1f} Q{xc:.1f},{yc:.1f} {x1:.1f},{y1:.1f} Z" '
        f'fill="{color}" stroke="{STROKE}" stroke-width="{LW}" stroke-linejoin="round"/>'
    )

svg = ('<svg id="logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" '
       'fill="none">\n  ' + '\n  '.join(paths) + '\n</svg>')

with open('assets/umbrella-inline.svg', 'w') as f:
    f.write(svg)
print('✓ assets/umbrella-inline.svg 生成（8 扇区，4 红 4 白，可逐扇区动画）')

# 独立测试页（本地起服务用浏览器实测动画）
html = '''<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
body { background:#111; display:flex; align-items:center; justify-content:center; height:100vh; margin:0; }
#logo-wrap { width:280px; animation: breath 4.2s ease-in-out infinite; }
#logo { width:100%; animation: spin 3.2s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes breath { 0%,100% { transform: scale(1); } 50% { transform: scale(1.12); } }
</style></head><body>
<div id="logo-wrap">''' + svg.replace('id="logo" ', 'id="logo" ') + '''</div>
<script>
// 红色扇区随机闪烁（Web Animations API，丝滑插值）
const reds = [...document.querySelectorAll('.sector.red')];
function flashLoop() {
  const el = reds[Math.floor(Math.random() * reds.length)];
  el.animate(
    [{ filter: 'brightness(1)' }, { filter: 'brightness(2.6)' }, { filter: 'brightness(1)' }],
    { duration: 380 + Math.random() * 250, easing: 'ease-out' }
  );
  setTimeout(flashLoop, 240 + Math.random() * 420);
}
flashLoop();
window.__test = { redCount: reds.length, sectorCount: document.querySelectorAll('.sector').length };
</script></body></html>'''
with open('test/logo-anim.html', 'w') as f:
    f.write(html)
print('✓ test/logo-anim.html 测试页生成')
