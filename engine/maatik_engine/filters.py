"""Page filters from DocScan (4pdara/DocScan, imaging/OriginalFilters.kt, the owner's own
code), ported to Python with the same OpenCV steps and constants.

Only the filters that might help reading manuscripts are here:
    paper      "ניקוי נייר"  - white paper, dark text, colours kept (illumination division)
    no_shadow  "ללא צללים"   - shadows and uneven light removed, the paper keeps its tone
    magic      "צבע קסם"     - bright page, deeper text, livelier colour, sharper
    pro        "מקצועי"      - strongest clean-up: denoise, white background, crisp ink

The stored scan is never changed: a filter makes a copy. Whether a filter is used for
recognition is decided by measurement (see filter_experiment in modal_app.py).
Images are RGB uint8 arrays.
"""

from __future__ import annotations

import cv2
import numpy as np

FILTERS = ("paper", "no_shadow", "magic", "pro")
BACKGROUND_EDGE = 900.0
PAPER_LIGHTNESS = 128.0


def apply(rgb: np.ndarray, name: str) -> np.ndarray:
    if name == "original":
        return rgb.copy()
    if name == "paper":
        return _clean_paper(rgb)
    if name == "no_shadow":
        return _remove_shadows(rgb)
    if name == "magic":
        return _magic_color(rgb) if _is_paper(rgb) else _rich_colour(rgb)
    if name == "pro":
        return _pro(rgb) if _is_paper(rgb) else _rich_colour(rgb)
    raise ValueError(f"unknown filter {name}")


def apply_file(src_path: str, dst_path: str, name: str, quality: int = 92) -> None:
    bgr = cv2.imread(src_path, cv2.IMREAD_COLOR)
    if bgr is None:
        raise FileNotFoundError(src_path)
    out = apply(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB), name)
    cv2.imwrite(dst_path, cv2.cvtColor(out, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, quality])


# ------------------------------------------------------------------ the filters

def _clean_paper(rgb):
    bg, _ = _paper_background(rgb)
    out = _divide(rgb, bg, 255.0)
    return _levels(out, black=_black_point(out), white=238.0, gamma=1.15)


def _remove_shadows(rgb):
    bg, tone = _paper_background(rgb)
    bg = np.maximum(bg, 1)
    chans = [cv2.divide(rgb[:, :, c], bg[:, :, c], scale=min(255.0, tone[c] * 1.02)) for c in range(3)]
    return cv2.merge(chans)


def _magic_color(rgb):
    bg, _ = _paper_background(rgb)
    out = _divide(rgb, bg, 255.0)
    out = _levels(out, black=_black_point(out) * .8, white=232.0, gamma=1.1)
    out = _saturate(out, 1.4)
    out = _s_curve(out, .35)
    return _sharpen(out, sigma=1.2, amount=.55)


def _pro(rgb):
    bg, _ = _paper_background(rgb)
    den = cv2.medianBlur(rgb, 3)
    out = _divide(den, bg, 255.0)
    out = _levels(out, black=_black_point(out), white=226.0, gamma=1.2)
    out = _saturate(out, 1.2)
    out = _whiten_paper(out)
    return _sharpen(out, sigma=1.0, amount=.7)


def _rich_colour(rgb):
    small = _resize_max(rgb, 600.0)
    gray = cv2.cvtColor(small, cv2.COLOR_RGB2GRAY)
    low, high = _percentile(gray, .005), _percentile(gray, .995)
    out = _levels(rgb.copy(), black=low * .7, white=max(high, low + 60.0), gamma=1.0)
    out = _saturate(out, 1.15)
    out = _s_curve(out, .2)
    return _sharpen(out, sigma=1.2, amount=.5)


def _is_paper(rgb) -> bool:
    """Light, and once the print is closed over mostly one even tint (DocScan's isPaper)."""
    small = _resize_max(rgb, 400.0)
    h, w = small.shape[:2]
    mx, my = w // 10, h // 10
    inner = small[my:my + max(1, h - 2 * my), mx:mx + max(1, w - 2 * mx)]
    gray = cv2.cvtColor(inner, cv2.COLOR_RGB2GRAY)
    if _percentile(gray, .75) < PAPER_LIGHTNESS:
        return False
    k = max(3, int(min(inner.shape[1], inner.shape[0]) * .04) | 1)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (k, k))
    surface = cv2.morphologyEx(inner, cv2.MORPH_CLOSE, kernel)
    surface = cv2.medianBlur(surface, k)
    lab = cv2.cvtColor(surface, cv2.COLOR_RGB2Lab).reshape(-1, 3).astype(int)
    n = len(lab)
    ls = np.sort(lab[:, 0])
    bright = ls[min(int(n * .7), n - 1)]
    top = ls[min(int(n * .9), n - 1)]
    sel = lab[lab[:, 0] >= bright]
    ta, tb = float(np.sort(sel[:, 1])[len(sel) // 2]), float(np.sort(sel[:, 2])[len(sel) // 2])
    if np.hypot(ta - 128, tb - 128) > 30:
        return False
    even = np.sum((lab[:, 0] >= top - 45) & (np.hypot(lab[:, 1] - ta, lab[:, 2] - tb) <= 8))
    return bool(even >= .5 * n)


# ------------------------------------------------------------------ building blocks

def _odd(v: int) -> int:
    return v + 1 if v % 2 == 0 else v


def _resize_max(img, edge: float):
    h, w = img.shape[:2]
    s = min(1.0, edge / max(w, h))
    if s >= 1.0:
        return img.copy()
    return cv2.resize(img, (max(1, int(w * s)), max(1, int(h * s))), interpolation=cv2.INTER_AREA)


def _smooth_background(src):
    """The unprinted paper: closing (dilation of the light paper) removes text, a median the rest."""
    small = _resize_max(src, BACKGROUND_EDGE)
    short = min(small.shape[0], small.shape[1])
    k = _odd(int(np.clip(short // 45, 5, 31)))
    small = cv2.dilate(small, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    small = cv2.medianBlur(small, _odd(int(np.clip(short // 30, 5, 41))))
    small = cv2.GaussianBlur(small, (0, 0), max(2.0, short / 120.0))
    return cv2.resize(small, (src.shape[1], src.shape[0]), interpolation=cv2.INTER_LINEAR)


def _paper_background(rgb):
    bg = _smooth_background(rgb)
    small = _resize_max(bg, 400.0)
    tone = [_percentile(small[:, :, c], .9) for c in range(3)]
    floor = np.array([max(1.0, t * .42) for t in tone])
    bg = np.maximum(bg, floor.round().astype(np.uint8))
    return bg, tone


def _divide(src, bg, scale):
    return cv2.divide(src, np.maximum(bg, 1), scale=scale)


def _lut(img, curve):
    table = np.array([int(np.clip(round(curve(v)), 0, 255)) for v in range(256)], dtype=np.uint8)
    return cv2.LUT(img, table)


def _levels(img, black, white, gamma):
    low = float(np.clip(black, 0.0, 120.0))
    high = max(low + 40.0, white)
    return _lut(img, lambda v: 255.0 * float(np.clip((v - low) / (high - low), 0.0, 1.0)) ** gamma)


def _s_curve(img, strength):
    def f(v):
        x = v / 255.0
        s = x * x * (3 - 2 * x)
        return 255.0 * (x + (s - x) * strength)
    return _lut(img, f)


def _saturate(rgb, factor):
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    hsv[:, :, 1] = cv2.convertScaleAbs(hsv[:, :, 1], alpha=factor)
    return cv2.cvtColor(hsv, cv2.COLOR_HSV2RGB)


def _sharpen(rgb, sigma, amount):
    blur = cv2.GaussianBlur(rgb, (0, 0), sigma)
    return cv2.addWeighted(rgb, 1.0 + amount, blur, -amount, 0.0)


def _whiten_paper(rgb):
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    mask = (hsv[:, :, 2] > 232) & (hsv[:, :, 1] <= 28)
    out = rgb.copy()
    out[mask] = 255
    return out


def _black_point(rgb):
    gray = cv2.cvtColor(_resize_max(rgb, 600.0), cv2.COLOR_RGB2GRAY)
    return min(90.0, _percentile(gray, .005))


def _percentile(single, fraction):
    """DocScan's histogram percentile: the first value whose cumulative count passes n*fraction."""
    hist = np.bincount(single.ravel(), minlength=256)
    target = int(single.size * fraction)
    idx = np.searchsorted(np.cumsum(hist), target, side="right")
    return float(min(idx, 255))
