"""Calibrate a manuscript's recognition model from its approved lines.

Manuscript directory layout (docs/SPEC.md):
    manuscript.json          name, source, split, active_model
    pages/<nnnn>.jpg         original scan
    pages/<nnnn>.json        page JSON (source of truth)
    models/v<k>/             one directory per training run, with metrics.json

Rules kept here (CLAUDE.md):
- 4: only this manuscript's approved lines are used.
- 5: every run makes a new version; it becomes active only if its CER on the
     test pages is lower than the active model's. Otherwise the old one stays.
- 6: test pages never go into training; the split is made once and stored.
"""

from __future__ import annotations

import json
import subprocess
import tempfile
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

from . import pagejson as pj
from .metrics import score
from .split import ensure_split
from .train import best_weights, finetune


def load_json(p: Path, default=None):
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else default


def save_json(p: Path, data) -> None:
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(p)


def page_numbers(ms_dir: Path) -> list[int]:
    return sorted(int(p.stem) for p in (ms_dir / "pages").glob("[0-9][0-9][0-9][0-9].json"))


def active_model_path(ms_dir: Path, manuscript: dict, base_model: Path) -> tuple[Path, str]:
    v = manuscript.get("active_model")
    if v:
        w = best_weights(ms_dir / "models" / v)
        if w:
            return w, v
    return base_model, "base"


def _write_alto(page: dict, image: Path, dest: Path) -> Path:
    p = dict(page)
    p["image"] = dict(page["image"], file=str(image))
    dest.write_text(pj.to_alto(p), encoding="utf-8")
    return dest


def evaluate(model: Path, test_altos: list[Path], work: Path, threads: int = 2) -> dict:
    """Recognise the approved test lines (their own geometry) and score against their text."""
    pairs = []
    work.mkdir(parents=True, exist_ok=True)
    for src in test_altos:
        out = work / src.name
        cmd = ["kraken", "-r", "-d", "cpu", "--threads", str(threads), "-f", "alto", "-a",
               "-i", str(src), str(out), "ocr", "-m", str(model), "--base-dir", "R"]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode != 0:
            raise RuntimeError(f"kraken failed on {src.name}: {proc.stderr[-1500:]}")
        truth = {l["id"]: l["text"] for l in pj.from_alto(src.read_text(encoding="utf-8"))["lines"]}
        got = _texts_by_line_id(out.read_text(encoding="utf-8"))
        for lid, ref in truth.items():
            pairs.append((got.get(lid, ""), ref))
    return score(pairs)


def _texts_by_line_id(alto_xml: str) -> dict[str, str]:
    root = ET.fromstring(alto_xml)
    out = {}
    for tl in root.iter():
        if tl.tag.endswith("TextLine"):
            words = [s.get("CONTENT", "") for s in tl if s.tag.endswith("String")]
            out[tl.get("ID")] = " ".join(words)
    return out


def calibrate(
    ms_dir: Path,
    base_model: Path,
    *,
    n_test: int = 3,
    epochs: int = 30,
    min_epochs: int = 3,
    lag: int = 3,
    lrate: float = 0.0001,
    threads: int = 2,
) -> dict:
    t0 = time.monotonic()
    mpath = ms_dir / "manuscript.json"
    manuscript = load_json(mpath, {})
    pages = page_numbers(ms_dir)
    split = ensure_split(manuscript, pages, n_test=n_test)
    save_json(mpath, manuscript)

    current_model, current_name = active_model_path(ms_dir, manuscript, base_model)
    versions = [int(p.name[1:]) for p in (ms_dir / "models").glob("v*") if p.name[1:].isdigit()]
    version = f"v{max(versions, default=0) + 1}"
    out = ms_dir / "models" / version

    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        (tmp / "train").mkdir()
        (tmp / "test").mkdir()
        train_files, test_files, train_lines, test_lines = [], [], 0, 0
        for n in pages:
            page = load_json(ms_dir / "pages" / f"{n:04d}.json")
            tp = pj.training_page(page)
            if not tp["lines"]:
                continue
            img = ms_dir / "pages" / page["image"]["file"]
            if n in split["test"]:
                test_files.append(_write_alto(tp, img, tmp / "test" / f"{n:04d}.xml"))
                test_lines += len(tp["lines"])
            else:
                train_files.append(_write_alto(tp, img, tmp / "train" / f"{n:04d}.xml"))
                train_lines += len(tp["lines"])
        if not train_files:
            raise ValueError("no approved lines on training pages yet")
        if not test_files:
            raise ValueError("no approved lines on test pages yet; approve test pages first")

        before = evaluate(current_model, test_files, tmp / "eval-before", threads)
        # ketos validates on a slice of the training pages, never on test pages.
        result = finetune(current_model, train_files, out, fmt="alto", epochs=epochs,
                          min_epochs=min_epochs, lag=lag, lrate=lrate, threads=threads)
        new_model = best_weights(out)
        after = evaluate(new_model, test_files, tmp / "eval-after", threads) if new_model else None

    promoted = bool(after and after["cer"] is not None and before["cer"] is not None
                    and after["cer"] < before["cer"])
    metrics = {
        "version": version,
        "trained_from": current_name,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "train_pages": [n for n in pages if n not in split["test"]],
        "test_pages": split["test"],
        "train_lines": train_lines,
        "test_lines": test_lines,
        "before": before,
        "after": after,
        "promoted": promoted,
        "training": result,
        "seconds": round(time.monotonic() - t0, 2),
    }
    save_json(out / "metrics.json", metrics)
    if promoted:
        manuscript["active_model"] = version
        save_json(mpath, manuscript)
    return metrics
