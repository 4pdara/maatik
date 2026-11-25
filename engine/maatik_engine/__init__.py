"""maatik recognition engine.

Plain Python package around Kraken. Modal (modal_app.py) is only a thin
wrapper around it, so the engine can move to a regular server unchanged.
"""

# Base recognition models in Kraken format, each pinned to a commit and file hash.
BASE_MODELS = {
    "ppocrv6-small": {
        "repo": "small-models-for-glam/kraken-ppocrv6-small",
        "revision": "49c249bf81d95ab2c5f699638d066f7935da6f16",
        "filename": "small.safetensors",
        "sha256": "3108259779f5abfed3908a1c9eafba64d17e4a2a169368c539ecfeff04c018f3",
    },
    "ppocrv6-medium": {
        "repo": "small-models-for-glam/kraken-ppocrv6-medium",
        "revision": "f7fd70f3fd22b615f41bada4674ac2462f938339",
        "filename": "medium.safetensors",
        "sha256": "15313b51ace64cbfa81f8f6ef25ad64f04e5a6fb7f7823e67b107527bc081ac9",
    },
}
DEFAULT_MODEL = "ppocrv6-small"
