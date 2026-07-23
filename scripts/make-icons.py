#!/usr/bin/env python3
"""Render Kinetik icon PNGs at the sizes Chrome uses.

Drawn directly with Pillow rather than rasterising SVG: exact pixel control,
real alpha, and no dependence on a browser viewport behaving itself.
Everything is drawn at 8x then downsampled with LANCZOS for clean antialiasing.

Usage:  pip install pillow && python3 scripts/make-icons.py
Writes: public/icons/{16,32,48,96,128}.png, which WXT auto-detects into the
        manifest — no config needed.
"""
from pathlib import Path
from PIL import Image, ImageDraw

# Relative to this script, so the repo can live anywhere.
OUT = Path(__file__).resolve().parent.parent / "public" / "icons"
OUT.mkdir(parents=True, exist_ok=True)

INDIGO = (79, 70, 229, 255)   # #4F46E5
WHITE = (255, 255, 255, 255)
SS = 8                        # supersample factor
BASE = 128                    # design canvas

# Design coordinates on a 128x128 canvas.
CORNER_RADIUS = 28
# Motion streaks: x, y, width, height, opacity — longer and fainter downward.
STREAKS = [
    (19, 31, 21, 10, 0.60),
    (13, 51, 28, 10, 0.45),
    (6, 71, 36, 10, 0.28),
]
TRIANGLE_FULL = [(51, 24), (105, 64), (51, 104)]
# Tiny sizes drop the streaks (they'd be ~1px tall and turn to mush) and use a
# slightly larger triangle so the mark still fills the square.
TRIANGLE_SMALL = [(44, 26), (106, 64), (44, 102)]


def draw_icon(size: int, with_streaks: bool) -> Image.Image:
    canvas = BASE * SS
    img = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    def s(v: float) -> float:
        return v * SS

    draw.rounded_rectangle(
        [0, 0, canvas - 1, canvas - 1],
        radius=s(CORNER_RADIUS),
        fill=INDIGO,
    )

    if with_streaks:
        for x, y, w, h, opacity in STREAKS:
            # Streaks are drawn on their own layer so their alpha composites
            # against the indigo instead of punching through it.
            layer = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
            ImageDraw.Draw(layer).rounded_rectangle(
                [s(x), s(y), s(x + w), s(y + h)],
                radius=s(h / 2),
                fill=(255, 255, 255, int(255 * opacity)),
            )
            img.alpha_composite(layer)

    points = TRIANGLE_FULL if with_streaks else TRIANGLE_SMALL
    # Sharp corners on purpose: faking a round join with circles at the
    # vertices made them protrude as visible nubs, reading like connected
    # nodes rather than a play button.
    draw.polygon([(s(x), s(y)) for x, y in points], fill=WHITE)

    return img.resize((size, size), Image.LANCZOS)


SIZES = {16: False, 32: False, 48: True, 96: True, 128: True}

for size, with_streaks in SIZES.items():
    path = OUT / f"{size}.png"
    draw_icon(size, with_streaks).save(path)
    print(f"wrote {path} ({path.stat().st_size} bytes)")
