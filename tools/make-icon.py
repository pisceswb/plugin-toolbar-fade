"""生成插件图标 icon.png（160x160）。

画面：一条工具条，从左到右逐渐变淡消失 —— 对应插件的功能本身。
不依赖外部素材，只用 Pillow 画出来，便于以后重新生成。
"""
from PIL import Image, ImageDraw, ImageFilter

SIZE = 160
SCALE = 4                      # 先放大 4 倍画，再缩小，边缘更干净
W, H = SIZE * SCALE, SIZE * SCALE

BG_TOP = (74, 108, 247)        # 思源主题蓝（渐变起点）
BG_BOTTOM = (124, 92, 232)     # 渐变终点
BAR = (255, 255, 255)

img = Image.new("RGB", (W, H), BG_TOP)

# 背景做一点竖向渐变，避免看起来太扁平
gradient = Image.new("L", (1, H))
for y in range(H):
    gradient.putpixel((0, y), int(255 * y / H))
img = Image.composite(Image.new("RGB", (W, H), BG_BOTTOM), img, gradient.resize((W, H)))

# 工具条：四段白色圆角矩形，透明度依次降低，形成「逐渐变淡」的意象
# 段之间留足空隙，避免外发光把它们糊成一团
bar_h = int(H * 0.26)
bar_y = int(H * 0.37)
gap = int(W * 0.03)
segments = []
left = int(W * 0.12)
for width_ratio, alpha in [(0.21, 1.00), (0.19, 0.68), (0.17, 0.42), (0.15, 0.22)]:
    width = int(W * width_ratio)
    segments.append((left, left + width, alpha))
    left += width + gap

layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
draw = ImageDraw.Draw(layer)
radius = int(bar_h * 0.38)
for left, right, alpha in segments:
    draw.rounded_rectangle(
        [left, bar_y, right, bar_y + bar_h],
        radius=radius,
        fill=(*BAR, int(255 * alpha)),
    )

# 轻微外发光（强度压到 45%），让工具条在背景上更醒目但不糊
glow = layer.filter(ImageFilter.GaussianBlur(radius=bar_h // 3))
glow.putalpha(glow.getchannel("A").point(lambda value: int(value * 0.45)))
img = Image.alpha_composite(img.convert("RGBA"), glow)
img = Image.alpha_composite(img, layer)

img = img.convert("RGB").resize((SIZE, SIZE), Image.LANCZOS)
img.save("icon.png", "PNG", optimize=True)
print(f"icon.png written: {img.size[0]}x{img.size[1]}")
