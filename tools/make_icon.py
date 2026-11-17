"""Draws assets/icon.ico (glowing lyric wave on a dark rounded square)."""
import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

S = 1024
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=230, fill=255)

bg = Image.new("RGBA", (S, S))
px = bg.load()
for y in range(S):
    for x in range(S):
        t = (x + y) / (2 * S)
        px[x, y] = (int(28 + 30 * t), int(14 + 6 * t), int(48 + 30 * (1 - t)), 255)
img.paste(bg, (0, 0), mask)

def wave_layer(width, blur):
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    pts = [(x, S * 0.55 - math.sin((x - 150) / 724 * math.pi * 2.2) * S * 0.16 * (0.4 + 0.6 * math.sin((x - 150) / 724 * math.pi)))
           for x in range(150, 875, 1)]
    n = len(pts)
    for i in range(n - 1):
        t = i / n
        c = (int(255 - 120 * t), int(90 + 60 * t), int(200 + 55 * t), 255)
        r = width / 2
        d.ellipse([pts[i][0] - r, pts[i][1] - r, pts[i][0] + r, pts[i][1] + r], fill=c)
    for p in (pts[0], pts[-1]):
        d.ellipse([p[0] - width / 2, p[1] - width / 2, p[0] + width / 2, p[1] + width / 2], fill=(255, 255, 255, 255))
    return layer.filter(ImageFilter.GaussianBlur(blur)) if blur else layer

glow = wave_layer(110, 50)
img = Image.alpha_composite(img, Image.composite(glow, Image.new("RGBA", (S, S), (0, 0, 0, 0)), mask))
img = Image.alpha_composite(img, wave_layer(64, 0))
dot = ImageDraw.Draw(img)
dot.ellipse([680, 230, 780, 330], fill=(255, 255, 255, 235))

out = Path(__file__).resolve().parent.parent / "assets"
img.resize((256, 256), Image.LANCZOS).save(out / "icon.png")
img.save(out / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print("icon written")
