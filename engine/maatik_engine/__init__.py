"""maatik recognition engine.

Plain Python package around Kraken. Modal (modal_app.py) is only a thin
wrapper around it, so the engine can move to a regular server unchanged.
"""

# Base recognition model: PP-OCRv6 small in Kraken format, pinned to a commit.
PPOCRV6_SMALL = {
    "repo": "small-models-for-glam/kraken-ppocrv6-small",
    "revision": "49c249bf81d95ab2c5f699638d066f7935da6f16",
    "filename": "small.safetensors",
    "sha256": "3108259779f5abfed3908a1c9eafba64d17e4a2a169368c539ecfeff04c018f3",
}
