"""生成插件图标 icon.png（160x160）。

设计：**浮动工具栏**（主题蓝圆角条 + 排成一排的按钮圆点，越靠右越淡）
      + **鼠标指针**（位于右下方，表示鼠标正在移开 → 工具栏随之淡出）
      + 柔和投影（体现"浮动"）+ 浅蓝渐变背景（深浅主题下都看得清）

不依赖外部素材，可随时重新生成：python tools/make-icon.py
"""
from PIL import Image, ImageDraw, ImageFilter

S, K = 160, 4
BG_TOP = (204, 220, 250)
BG_BOTTOM = (176, 196, 244)
PILL = (74, 108, 247)          # 思源主题蓝
PILL_EDGE = (58, 88, 219)
DOT = (255, 255, 255)
SHADOW = (52, 76, 150)
CURSOR_FILL = (255, 255, 255)
CURSOR_EDGE = (46, 54, 74)


def gradient(top, bottom):
    img = Image.new("RGB", (S * K, S * K), top)
    g = Image.new("L", (1, S * K))
    for y in range(S * K):
        g.putpixel((0, y), int(255 * y / (S * K)))
    return Image.composite(Image.new("RGB", (S * K, S * K), bottom), img,
                           g.resize((S * K, S * K))).convert("RGBA")


def rounded(size, radius, fill, outline=None, width=1):
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    draw.rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], radius=radius, fill=fill)
    if outline:
        draw.rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], radius=radius, outline=outline, width=width)
    return layer


img = gradient(BG_TOP, BG_BOTTOM)

# ── 浮动工具栏 ────────────────────────────────────────────────
# 整体略偏左上，给右下角的鼠标指针留出位置（指针不能被画布裁掉）
pw, ph, radius = int(112 * K), int(40 * K), int(14 * K)
px, py = (S * K - pw) // 2 - int(10 * K), int(50 * K)

# 投影：让它看起来是「浮」在内容之上
shadow = Image.new("RGBA", (pw + 44 * K, ph + 44 * K), (0, 0, 0, 0))
ImageDraw.Draw(shadow).rounded_rectangle(
    [22 * K, 22 * K, 22 * K + pw, 22 * K + ph], radius=radius, fill=(*SHADOW, 170))
img.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(9 * K)), (px - 22 * K, py - 14 * K))

img.alpha_composite(rounded((pw, ph), radius, (*PILL, 255), outline=(*PILL_EDGE, 255), width=int(1.4 * K)), (px, py))

# 按钮圆点：从左到右逐渐变淡（这就是「淡出」）。数量控制在 4 个，
# 太少不像工具栏，太多在小尺寸（集市列表约 40px）下会糊成一团。
dot = int(17 * K)
count = 4
inner = pw - 2 * int(15 * K)
gap = int(inner / count)
for i in range(count):
    alpha = int(255 * (1 - i / (count + 0.2)))
    cx = px + int(15 * K) + i * gap + (gap - dot) // 2
    cy = py + (ph - dot) // 2
    layer = Image.new("RGBA", (dot, dot), (0, 0, 0, 0))
    ImageDraw.Draw(layer).ellipse([0, 0, dot - 1, dot - 1], fill=(*DOT, alpha))
    img.alpha_composite(layer, (cx, cy))

# ── 鼠标指针（右下方，表示鼠标正在移开）────────────────────────
cursor_shape = [(0, 0), (0, 27), (7, 20), (12, 31), (18, 28), (13, 17), (22, 16)]
cx0 = px + pw - int(18 * K)
cy0 = py + ph + int(5 * K)
cursor_layer = Image.new("RGBA", (30 * K, 38 * K), (0, 0, 0, 0))
cursor_pts = [(a * K, b * K) for a, b in cursor_shape]
ImageDraw.Draw(cursor_layer).polygon(cursor_pts, fill=(*CURSOR_FILL, 255))
ImageDraw.Draw(cursor_layer).line(cursor_pts + [cursor_pts[0]],
                                  fill=(*CURSOR_EDGE, 255), width=int(1.3 * K), joint="curve")
img.alpha_composite(cursor_layer, (cx0, cy0))

final = img.convert("RGB").resize((S, S), Image.LANCZOS)
final.save("icon.png", "PNG", optimize=True)
print(f"icon.png written: {final.size[0]}x{final.size[1]}")

# 小尺寸 + 深色底色的辨析度检查
small = [final.resize((n, n), Image.LANCZOS) for n in (40, 56, 72)]
sheet = Image.new("RGB", (40 + 56 + 72 + 140, 120), (250, 250, 252))
x = 20
for s in small:
    sheet.paste(s, (x, 24))
    x += s.size[0] + 10
dark = Image.new("RGB", (120, 120), (32, 36, 46))
dark.paste(final.resize((72, 72), Image.LANCZOS), (24, 24))
sheet.paste(dark, (x, 0))
sheet.save("_icon_preview.png", "PNG", optimize=True)
print("_icon_preview.png written（40/56/72px 与深色底对比）")
