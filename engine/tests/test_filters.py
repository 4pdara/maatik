import numpy as np
import pytest

cv2 = pytest.importorskip("cv2")
from maatik_engine import filters  # noqa: E402


def _page(shadow=True):
    """Cream paper with dark strokes and a shadow on one side."""
    img = np.full((400, 300, 3), (225, 215, 190), np.uint8)
    for y in range(40, 380, 30):
        img[y:y + 6, 30:270] = (60, 45, 35)
    if shadow:
        ramp = np.linspace(0.55, 1.0, 300)[None, :, None]
        img = (img * ramp).astype(np.uint8)
    return img


def test_every_filter_keeps_size_and_type():
    img = _page()
    for name in ("original",) + filters.FILTERS:
        out = filters.apply(img, name)
        assert out.shape == img.shape and out.dtype == np.uint8


def test_paper_is_detected_and_shadow_is_evened_out():
    img = _page()
    assert filters._is_paper(_page(shadow=False))
    out = filters.apply(img, "no_shadow")
    paper = out[20:30, :, :].mean(axis=(0, 2))  # a strip of paper between lines
    assert paper[:50].mean() > 0.9 * paper[-50:].mean()  # the dark side is lifted to the light side
    assert img[20:30, :50].mean() < 0.75 * img[20:30, -50:].mean()  # it was darker before


def test_unknown_filter_is_refused():
    with pytest.raises(ValueError):
        filters.apply(_page(), "sepia")
