"""Does a page filter help recognition? Measured, not guessed.

For each filter, the test pages' scans are filtered (a copy), the approved test lines are
recognised from the filtered scan with their own geometry (so line finding is the same for
every filter, and only the image differs), and CER/WER are computed against the approved
text. Test pages never go into training; nothing is written to the manuscript.
"""

from __future__ import annotations

import json
import tempfile
import time
from pathlib import Path

from . import filters, pagejson as pj
from .calibrate import _write_alto, evaluate, load_json


def run(ms_dir: Path, models: dict[str, Path], names=("original",) + filters.FILTERS, threads: int = 2) -> dict:
    manuscript = load_json(ms_dir / "manuscript.json", {})
    test_pages = (manuscript.get("split") or {}).get("test") or []
    if not test_pages:
        raise ValueError("no test pages: calibrate once first")
    out = {"slug": ms_dir.name, "test_pages": test_pages, "results": []}
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        for name in names:
            t0 = time.monotonic()
            altos = []
            for n in test_pages:
                page = load_json(ms_dir / "pages" / f"{n:04d}.json")
                tp = pj.training_page(page)
                if not tp["lines"]:
                    continue
                src = ms_dir / "pages" / page["image"]["file"]
                img = tmp / f"{name}-{n:04d}.jpg"
                filters.apply_file(str(src), str(img), name)
                altos.append(_write_alto(tp, img, tmp / f"{name}-{n:04d}.xml"))
            for label, model in models.items():
                score = evaluate(model, altos, tmp / f"eval-{name}-{label}", threads)
                out["results"].append({"filter": name, "model": label, **score,
                                       "seconds": round(time.monotonic() - t0, 1)})
                print(json.dumps(out["results"][-1], ensure_ascii=False), flush=True)
    return out
