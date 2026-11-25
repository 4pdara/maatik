"""Render text lines into line images for training (kraken `path` format).

Each line becomes NNNNN.png plus NNNNN.gt.txt. Used for the ketos feasibility
test and, later, for synthetic pre-training material. Hebrew is shaped right to
left with Pillow's raqm layout when available.
"""

from __future__ import annotations

import random
import unicodedata
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, features


def render_lines(
    lines: list[str],
    out_dir: Path,
    font_path: Path,
    *,
    size: int = 48,
    seed: int = 0,
) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    font = ImageFont.truetype(str(font_path), size)
    rtl = features.check("raqm")
    rng = random.Random(seed)
    written = []
    for i, text in enumerate(lines):
        text = unicodedata.normalize("NFC", " ".join(text.split()))
        if not text:
            continue
        kw = {"direction": "rtl", "language": "he"} if rtl else {}
        shown = text if rtl else text[::-1]
        x0, y0, x1, y1 = font.getbbox(shown, **kw)
        pad = size // 2
        w, h = x1 - x0 + 2 * pad, y1 - y0 + 2 * pad
        bg = rng.randint(225, 250)
        img = Image.new("L", (w, h), bg)
        ImageDraw.Draw(img).text((pad - x0, pad - y0), shown, font=font, fill=rng.randint(10, 60), **kw)
        stem = out_dir / f"{i:05d}"
        img.save(stem.with_suffix(".png"))
        stem.with_suffix(".gt.txt").write_text(text + "\n", encoding="utf-8")
        written.append(stem.with_suffix(".png"))
    return written
