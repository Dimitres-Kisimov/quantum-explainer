"""Rasterize the Quantum Explainer app icon to PNG.

Pillow cannot render SVG, so this script redraws the exact geometry of
icons/icon.svg (a Bloch sphere with a state vector) with 4x supersampling
for clean anti-aliasing, then downscales.

Run from the repo root:  python tools/make_icons.py
Outputs: icons/icon-512.png, icon-192.png, icon-180.png, maskable-512.png
"""
import os

from PIL import Image, ImageDraw

BG = (14, 22, 49, 255)        # #0e1631
RING = (199, 210, 254, 255)   # #c7d2fe
RING_SOFT = (199, 210, 254, 128)
ACCENT = (76, 201, 240, 255)  # #4cc9f0
SS = 4                        # supersampling factor

# Geometry from icons/icon.svg, as fractions of the 512 canvas.
CORNER = 112 / 512
SPHERE_R = 168 / 512
SPHERE_W = 13 / 512
EQ_RY = 60 / 512
EQ_W = 9 / 512
ARROW = (96 / 512, -116 / 512)   # tip offset from centre
ARROW_W = 22 / 512
TIP_R = 27 / 512
DOT_R = 13 / 512


def draw_icon(size, content_scale=1.0, rounded=True):
    S = size * SS
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * CORNER), fill=BG)
    else:
        d.rectangle([0, 0, S - 1, S - 1], fill=BG)

    c = S / 2
    k = S * content_scale  # content unit
    r = SPHERE_R * k

    # sphere outline
    w = max(1, round(SPHERE_W * k))
    d.ellipse([c - r, c - r, c + r, c + r], outline=RING, width=w)
    # equator ellipse
    ry = EQ_RY * k
    d.ellipse([c - r, c - ry, c + r, c + ry], outline=RING_SOFT, width=max(1, round(EQ_W * k)))
    # state vector
    tip = (c + ARROW[0] * k, c + ARROW[1] * k)
    d.line([c, c, tip[0], tip[1]], fill=ACCENT, width=max(1, round(ARROW_W * k)))
    tr = TIP_R * k
    d.ellipse([tip[0] - tr, tip[1] - tr, tip[0] + tr, tip[1] + tr], fill=ACCENT)
    # centre dot
    dr = DOT_R * k
    d.ellipse([c - dr, c - dr, c + dr, c + dr], fill=RING)

    return img.resize((size, size), Image.LANCZOS)


def main():
    out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "icons")
    os.makedirs(out, exist_ok=True)
    jobs = [
        ("icon-512.png", 512, dict(content_scale=1.0, rounded=True)),
        ("icon-192.png", 192, dict(content_scale=1.0, rounded=True)),
        # apple-touch-icon: iOS applies its own corner mask; ship full-bleed.
        ("icon-180.png", 180, dict(content_scale=1.0, rounded=False)),
        # maskable: full-bleed with content inside the ~80% safe zone.
        ("maskable-512.png", 512, dict(content_scale=0.78, rounded=False)),
    ]
    for name, size, kw in jobs:
        path = os.path.join(out, name)
        draw_icon(size, **kw).save(path, "PNG")
        print("wrote", path, os.path.getsize(path), "bytes")


if __name__ == "__main__":
    main()
