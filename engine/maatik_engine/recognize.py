"""Segment and recognise one page with the Kraken CLI, and summarise the result."""

from __future__ import annotations

import importlib.metadata
import statistics
import subprocess
import time
import xml.etree.ElementTree as ET
from pathlib import Path

UNSURE_BELOW = 0.8  # word confidence under this counts as "not sure"


def recognize_page(
    image: Path,
    out_alto: Path,
    model: Path,
    *,
    threads: int = 2,
    device: str = "cpu",
    seg_model: Path | None = None,
) -> dict:
    """Run baseline segmentation + recognition on one page image, write ALTO."""
    out_alto.parent.mkdir(parents=True, exist_ok=True)
    seg = ["segment", "-bl", "-d", "horizontal-rl"]
    if seg_model is not None:
        seg += ["-i", str(seg_model)]
    cmd = [
        "kraken", "-r", "-d", device, "--threads", str(threads), "-a",
        "-i", str(image), str(out_alto),
        *seg,
        "ocr", "-m", str(model), "--base-dir", "R",
    ]
    t0 = time.monotonic()
    proc = subprocess.run(cmd, capture_output=True, text=True)
    seconds = round(time.monotonic() - t0, 2)
    if proc.returncode != 0 or not out_alto.exists():
        raise RuntimeError(
            f"kraken failed (exit {proc.returncode}): {proc.stderr[-2000:] or proc.stdout[-2000:]}"
        )
    summary = summarize_alto(out_alto)
    summary.update(
        seconds=seconds,
        kraken_version=importlib.metadata.version("kraken"),
        torch_version=importlib.metadata.version("torch"),
        model=model.name,
    )
    return summary


def summarize_alto(path: Path, sample_lines: int = 5) -> dict:
    root = ET.parse(path).getroot()
    ns = {"a": root.tag.split("}")[0][1:]} if root.tag.startswith("{") else {"a": ""}
    lines = root.findall(".//a:TextLine", ns)
    confs: list[float] = []
    sample: list[str] = []
    for line in lines:
        words = line.findall("a:String", ns)
        confs += [float(w.get("WC")) for w in words if w.get("WC") is not None]
        if len(sample) < sample_lines:
            sample.append(" ".join(w.get("CONTENT", "") for w in words))
    return {
        "lines": len(lines),
        "words": len(confs),
        "mean_word_confidence": round(statistics.mean(confs), 3) if confs else None,
        "words_unsure": sum(c < UNSURE_BELOW for c in confs),
        "sample_lines": sample,
    }
