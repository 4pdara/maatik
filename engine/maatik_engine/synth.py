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


def render_page(
    lines: list[str],
    out_jpg: Path,
    font_path: Path,
    *,
    width: int = 1400,
    size: int = 40,
    leading: int = 78,
    margin: int = 80,
    seed: int = 0,
) -> list[dict]:
    """Render a synthetic page (right-aligned Hebrew lines).

    Returns one dict per drawn line: text, baseline and boundary (pixel points).
    Lines too wide for the page are dropped, so the result is the true page.
    """
    font = ImageFont.truetype(str(font_path), size)
    rtl = features.check("raqm")
    kw = {"direction": "rtl", "language": "he"} if rtl else {}
    rng = random.Random(seed)
    kept = []
    for text in lines:
        text = unicodedata.normalize("NFC", " ".join(text.split()))
        shown = text if rtl else text[::-1]
        if text and font.getlength(shown, **kw) <= width - 2 * margin:
            kept.append(text)
    height = 2 * margin + leading * len(kept)
    img = Image.new("L", (width, height), rng.randint(228, 245))
    draw = ImageDraw.Draw(img)
    ascent, descent = font.getmetrics()
    drawn = []
    for i, text in enumerate(kept):
        shown = text if rtl else text[::-1]
        w = int(font.getlength(shown, **kw))
        x, y = width - margin - w, margin + i * leading
        draw.text((x, y), shown, font=font, fill=rng.randint(15, 50), **kw)
        x0, x1, base = x - 6, width - margin + 6, y + ascent
        top, bottom = y - 4, y + ascent + descent + 4
        drawn.append({
            "text": text,
            "baseline": [[x0, base], [x1, base]],  # Kraken: baselines run left to right, also for RTL
            "boundary": [[x1, top], [x1, bottom], [x0, bottom], [x0, top]],
        })
    out_jpg.parent.mkdir(parents=True, exist_ok=True)
    img.convert("RGB").save(out_jpg, quality=92)
    return drawn
