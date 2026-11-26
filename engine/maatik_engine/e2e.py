"""End-to-end pipeline check on a synthetic manuscript with known ground truth.

Renders pages from CC0 text, writes page JSON with the exact line geometry
(Kraken's segmentation model fragments clean printed lines, and this check is
about calibration, not segmentation), lets the base model read every line,
approves every line with its true text (standing in for the proofreader), then
calibrates. Proves the mechanism, not accuracy on real handwriting.
"""

from __future__ import annotations

import json
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path

from . import pagejson as pj
from .calibrate import calibrate, save_json
from .synth import render_page


def _read_words(alto_xml: str) -> dict[str, list[dict]]:
    out = {}
    for tl in ET.fromstring(alto_xml).iter():
        if not tl.tag.endswith("TextLine"):
            continue
        words = []
        for s in tl:
            if s.tag.endswith("String"):
                wc = s.get("WC")
                words.append({
                    "text": pj._nfc(s.get("CONTENT", "")),
                    "confidence": round(float(wc), 4) if wc is not None else None,
                    "box": [int(float(s.get(k))) for k in ("HPOS", "VPOS", "WIDTH", "HEIGHT")]
                    if s.get("HPOS") is not None else None,
                    "alternatives": [],
                    "doubtful": False,
                })
        out[tl.get("ID")] = words
    return out


def build(ms_dir: Path, text_lines: list[str], font: Path, base_model: Path, *,
          pages: int = 8, lines_per_page: int = 12, threads: int = 2, font_size: int = 40) -> dict:
    pdir = ms_dir / "pages"
    pdir.mkdir(parents=True, exist_ok=True)
    save_json(ms_dir / "manuscript.json", {
        "slug": ms_dir.name, "name": "Synthetic pages from Tsel HaOlam (CC0)",
        "source": f"HeOCR htext tsel-haolam-v1, Zenodo 24521432, rendered in {font.stem}",
        "synthetic": True, "split": None, "active_model": None,
    })
    report = {"pages": [], "approved_lines": 0}
    pool = [l for l in text_lines if len(l.split()) >= 3]
    for n in range(1, pages + 1):
        img = pdir / f"{n:04d}.jpg"
        drawn = render_page(pool[(n - 1) * lines_per_page: n * lines_per_page], img, font, seed=n,
                            size=font_size, leading=int(font_size * 1.9))
        from PIL import Image
        W, H = Image.open(img).size
        page = {
            "schema_version": pj.SCHEMA_VERSION, "revision": 1,
            "image": {"file": img.name, "width": W, "height": H},
            "lines": [{
                "id": pj.new_line_id(), "order": i, "region": "main",
                "baseline": d["baseline"], "boundary": d["boundary"],
                "text": "", "words": [], "engine_text": "", "llm": None,
                "source": "engine", "status": "pending", "model_version": "base",
            } for i, d in enumerate(drawn)],
        }
        # Let the base model read the given lines.
        src = pdir / f"{n:04d}.input.alto.xml"
        out = pdir / f"{n:04d}.engine.alto.xml"
        src.write_text(pj.to_alto(dict(page, image=dict(page["image"], file=str(img)))), encoding="utf-8")
        proc = subprocess.run(["kraken", "-r", "-d", "cpu", "--threads", str(threads), "-f", "alto", "-a",
                               "-i", str(src), str(out), "ocr", "-m", str(base_model), "--base-dir", "R"],
                              capture_output=True, text=True)
        if proc.returncode != 0:
            raise RuntimeError(proc.stderr[-1500:])
        read = _read_words(out.read_text(encoding="utf-8"))
        for line, d in zip(page["lines"], drawn):
            line["words"] = read.get(line["id"], [])
            line["engine_text"] = " ".join(w["text"] for w in line["words"])
            line["text"] = d["text"]          # the proofreader's correction
            line["status"] = "approved"
        report["approved_lines"] += len(drawn)
        save_json(pdir / f"{n:04d}.json", page)
        report["pages"].append({"page": n, "lines": len(drawn)})
    return report


def run(ms_dir: Path, text_lines: list[str], font: Path, base_model: Path, *,
        pages: int = 8, n_test: int = 2, epochs: int = 10, threads: int = 2,
        font_size: int = 40) -> dict:
    report = build(ms_dir, text_lines, font, base_model, pages=pages, threads=threads,
                   font_size=font_size)
    report["calibration"] = calibrate(ms_dir, base_model, n_test=n_test, epochs=epochs, threads=threads)
    (ms_dir / "e2e_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    return report
