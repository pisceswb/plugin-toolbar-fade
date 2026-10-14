"""生成集市用的预览图 preview.png（1024x768）。

画面构成：
  - 左：思源编辑器示意（选中一段文字 → 浮动工具条弹出，完全不透明，鼠标就在旁边）
  - 右：把鼠标移远后的三种距离对应不同不透明度，说明「越远越淡，超过 200px 直接关闭」
  - 底部：一段简短的文字说明

按钮名称取自思源工具栏的真实条目（block-type / block-ref / bold / italic …），
所以看起来和实际一致。不依赖外部素材，可随时重新生成。
"""
from PIL import Image, ImageDraw, ImageFont

W, H = 1024, 768
SCALE = 2                      # 放大绘制后缩小，边缘更干净
w, h = W * SCALE, H * SCALE

BG = (243, 244, 246)
PANEL = (255, 255, 255)
BORDER = (224, 226, 230)
TEXT = (36, 39, 43)
TEXT_DIM = (110, 116, 124)
ACCENT = (74, 108, 247)
SEL_BG = (198, 216, 255)
TOOLBAR_BG = (255, 255, 255)
SHADOW = (206, 210, 218)

FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\Deng.ttf",
    r"C:\Windows\Fonts\simhei.ttf",
]


def font(size, bold=False):
    paths = ([r"C:\Windows\Fonts\msyhbd.ttc", r"C:\Windows\Fonts\Dengb.ttf"] if bold else []) + FONT_CANDIDATES
    for path in paths:
        try:
            return ImageFont.truetype(path, size * SCALE)
        except OSError:
            continue
    return ImageFont.load_default()


img = Image.new("RGB", (w, h), BG)
draw = ImageDraw.Draw(img)

f_title = font(27, True)
f_label = font(15, True)
f_body = font(17)
f_small = font(14)
f_btn = font(15)
f_num = font(30, True)
f_pct = font(15, True)

# ────────────────────────── 左：编辑器 + 工具条 ──────────────────────────
LX, LY, LW, LH = 44, 96, 496, 470
draw.rounded_rectangle([LX * SCALE, LY * SCALE, (LX + LW) * SCALE, (LY + LH) * SCALE],
                       radius=10 * SCALE, fill=PANEL, outline=BORDER, width=1 * SCALE)

# 文档标题
draw.text(((LX + 26) * SCALE, (LY + 24) * SCALE), "植物纤维研究方法", font=f_label, fill=TEXT)

# 正文两行，其中一段为选中态
line_y = LY + 66
sel_x0, sel_x1 = LX + 26, LX + 306
draw.rounded_rectangle([sel_x0 * SCALE, (line_y - 3) * SCALE, sel_x1 * SCALE, (line_y + 30) * SCALE],
                       radius=3 * SCALE, fill=SEL_BG)
draw.text((sel_x0 * SCALE, line_y * SCALE), "纤维素含量采用硝酸乙醇法测定", font=f_body, fill=TEXT)
draw.text(((LX + 26) * SCALE, (line_y + 40) * SCALE), "，每组重复三次并取平均值。", font=f_body, fill=TEXT)
draw.text(((LX + 26) * SCALE, (line_y + 92) * SCALE), "半纤维素与木质素分别用", font=f_body, fill=TEXT_DIM)
draw.text(((LX + 26) * SCALE, (line_y + 124) * SCALE), "DNS 法与 Klason 法测定。", font=f_body, fill=TEXT_DIM)

# 浮动工具条（紧贴选区上方）
TB_W, TB_H = 396, 38
TB_X = LX + 22
TB_Y = line_y - 56
# 阴影
draw.rounded_rectangle([(TB_X + 3) * SCALE, (TB_Y + 4) * SCALE, (TB_X + TB_W + 3) * SCALE, (TB_Y + TB_H + 4) * SCALE],
                       radius=6 * SCALE, fill=SHADOW)
draw.rounded_rectangle([TB_X * SCALE, TB_Y * SCALE, (TB_X + TB_W) * SCALE, (TB_Y + TB_H) * SCALE],
                       radius=6 * SCALE, fill=TOOLBAR_BG, outline=BORDER, width=1 * SCALE)

# 工具条内容：块类型 + 分隔 + 常用行内样式 + 链接 + 引用
# 只用能可靠渲染的字符（中文/拉丁/基本符号），避免出现「豆腐块」
buttons = ["H", "B", "I", "U", "S", "c", "x²", "a", "''"]
x = TB_X + 12
for index, label in enumerate(buttons):
    if index in (1, 8):
        x += 6
        draw.line([x * SCALE, (TB_Y + 9) * SCALE, x * SCALE, (TB_Y + TB_H - 9) * SCALE], fill=BORDER, width=1 * SCALE)
        x += 7
    box = 26
    if label in ("B", "I", "U", "S"):
        draw.rounded_rectangle([x * SCALE, (TB_Y + 6) * SCALE, (x + box) * SCALE, (TB_Y + 6 + box) * SCALE],
                              radius=4 * SCALE, fill=(238, 241, 248))
    color = TEXT if index < 6 else TEXT_DIM
    bbox = draw.textbbox((0, 0), label, font=f_btn)
    draw.text((x * SCALE + (box - (bbox[2] - bbox[0]) / SCALE) * SCALE / 2,
               (TB_Y + 6) * SCALE + (box - (bbox[3] - bbox[1]) / SCALE) * SCALE / 2),
              label, font=f_btn, fill=color)
    x += box + 5

# 鼠标位置（就在选区旁边 → 工具条完全清晰）
mx, my = LX + 352, line_y + 8
draw.polygon([(mx * SCALE, my * SCALE), (mx * SCALE, (my + 20) * SCALE), ((mx + 6) * SCALE, (my + 14) * SCALE),
              ((mx + 14) * SCALE, (my + 20) * SCALE), ((mx + 17) * SCALE, (my + 15) * SCALE),
              ((mx + 9) * SCALE, (my + 9) * SCALE), ((mx + 16) * SCALE, (my + 7) * SCALE)],
             fill=(255, 255, 255), outline=(40, 44, 52))

draw.text(((LX + 26) * SCALE, (LY + LH - 46) * SCALE), "不透明度 1.0 · 完全清晰", font=f_small, fill=(60, 130, 80))

# ────────────────────────── 右：距离 → 不透明度 ──────────────────────────
RX = 588
draw.text((RX * SCALE, (LY - 34) * SCALE), "鼠标离得越远，工具条越淡（默认 80 / 200）", font=f_label, fill=TEXT)

samples = [(40, 1.0), (140, 0.70), (185, 0.48)]
row_y = LY + 8
for distance, alpha in samples:
    draw.text((RX * SCALE, row_y * SCALE), f"{distance} px", font=f_num, fill=ACCENT)
    bx, by, bw, bh = RX + 108, row_y + 6, 250, 38
    # 底色板（不用 alpha 圆角矩形，改用逐像素混合）
    pad = Image.new("RGB", ((bw + 8) * SCALE, (bh + 8) * SCALE), BG)
    pdraw = ImageDraw.Draw(pad)
    pdraw.rounded_rectangle([4 * SCALE, 4 * SCALE, (bw + 4) * SCALE, (bh + 4) * SCALE],
                            radius=6 * SCALE, fill=SHADOW)
    pdraw.rounded_rectangle([0, 0, bw * SCALE, bh * SCALE], radius=6 * SCALE, fill=TOOLBAR_BG, outline=BORDER,
                            width=1 * SCALE)
    for i in range(6):
        cx = (10 + i * 40) * SCALE
        pdraw.rounded_rectangle([cx, 8 * SCALE, cx + 28 * SCALE, (bh - 8) * SCALE],
                                radius=4 * SCALE, fill=(226, 230, 238))
    img.paste(Image.blend(pad, Image.new("RGB", pad.size, BG), 1 - alpha), (bx * SCALE, by * SCALE))
    draw.text(((bx + bw + 14) * SCALE, (row_y + 14) * SCALE), f"{alpha:.2f}", font=f_pct, fill=TEXT_DIM)
    row_y += 84

# 关闭状态
draw.text((RX * SCALE, row_y * SCALE), ">200 px", font=f_num, fill=(214, 69, 69))
draw.rounded_rectangle([(RX + 108) * SCALE, (row_y + 6) * SCALE, (RX + 108 + 250) * SCALE, (row_y + 6 + 38) * SCALE],
                       radius=6 * SCALE, outline=(214, 69, 69), width=1 * SCALE)
bb = draw.textbbox((0, 0), "立即关闭", font=f_pct)
draw.text(((RX + 108 + 125) * SCALE - (bb[2] - bb[0]) / 2, (row_y + 14) * SCALE), "立即关闭", font=f_pct,
          fill=(214, 69, 69))

# ────────────────────────── 标题与底部说明 ──────────────────────────
draw.text((44 * SCALE, 40 * SCALE), "工具条淡出", font=f_title, fill=TEXT)
draw.text((206 * SCALE, 48 * SCALE), "Toolbar Fade", font=f_label, fill=TEXT_DIM)

foot_y = 604
draw.line([44 * SCALE, foot_y * SCALE, (W - 44) * SCALE, foot_y * SCALE], fill=BORDER, width=1 * SCALE)
lines = [
    "选中文字后，工具条随鼠标远离逐渐变淡；鼠标移回即刻恢复。",
    "超过「立即关闭的距离」后直接关闭，不延时、不残留；关闭后再移动鼠标不会自己冒出来。",
    "两项距离均可在插件设置里调整，改动实时生效。",
]
for index, line in enumerate(lines):
    draw.text((44 * SCALE, (foot_y + 18 + index * 28) * SCALE), line, font=f_small, fill=TEXT_DIM)

img = img.resize((W, H), Image.LANCZOS)
img.save("preview.png", "PNG", optimize=True)
print(f"preview.png written: {img.size[0]}x{img.size[1]}")
