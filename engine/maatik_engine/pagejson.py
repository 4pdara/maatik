"""Page JSON (the source of truth, schema_version 1) and ALTO conversion.

See docs/SPEC.md, "מבנה הנתונים". Three conversions:

- from_kraken_alto(): engine output (Kraken ALTO) -> new page JSON.
- to_alto(): page JSON -> ALTO 4. Kraken/ketos can train from it, and it
  carries every page-JSON field, so from_alto(to_alto(p)) == p (tested).
- from_alto(): ALTO written by to_alto() -> page JSON.

Fields that ALTO has no place for (line id, status, source, engine text, word
alternatives, LLM suggestion, ...) travel in one ALTO <OtherTag TYPE="maatik">
per line, as compact JSON in its DESCRIPTION, referenced from the line's TAGREFS.
"""

from __future__ import annotations

import json
import unicodedata
import uuid
import xml.etree.ElementTree as ET
from copy import deepcopy

SCHEMA_VERSION = 1
ALTO_NS = "http://www.loc.gov/standards/alto/ns-v4#"
REGIONS = ("main", "margin", "interlinear")
UNSURE_BELOW = 0.8

ET.register_namespace("", ALTO_NS)
_N = "{%s}" % ALTO_NS


def new_line_id() -> str:
    return "l_" + uuid.uuid4().hex[:12]


def _pairs(points: str) -> list[list[int]]:
    v = [int(round(float(t))) for t in points.replace(",", " ").split()]
    return [[v[i], v[i + 1]] for i in range(0, len(v) - 1, 2)]


def _flat(pairs: list[list[int]]) -> str:
    return " ".join(f"{x} {y}" for x, y in pairs)


def _bbox(pairs: list[list[int]]) -> tuple[int, int, int, int]:
    xs = [p[0] for p in pairs]
    ys = [p[1] for p in pairs]
    return min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)


def _nfc(s: str) -> str:
    return unicodedata.normalize("NFC", s)


# ---------------------------------------------------------------- from Kraken


def from_kraken_alto(alto_xml: str | bytes, image_file: str, model_version: str) -> dict:
    """Build a fresh page from Kraken's recognition ALTO. Every line is pending."""
    root = ET.fromstring(alto_xml)
    page = root.find(f".//{_N}Page")
    lines = []
    for order, tl in enumerate(root.iter(f"{_N}TextLine")):
        poly = tl.find(f"./{_N}Shape/{_N}Polygon")
        words = []
        for s in tl.findall(f"{_N}String"):
            wc = s.get("WC")
            box = None
            if s.get("HPOS") is not None:
                box = [int(float(s.get(k))) for k in ("HPOS", "VPOS", "WIDTH", "HEIGHT")]
            words.append({
                "text": _nfc(s.get("CONTENT", "")),
                "confidence": round(float(wc), 4) if wc is not None else None,
                "box": box,
                "alternatives": [],
                "doubtful": False,
            })
        text = " ".join(w["text"] for w in words)
        lines.append({
            "id": new_line_id(),
            "order": order,
            "region": "main",
            "baseline": _pairs(tl.get("BASELINE", "")),
            "boundary": _pairs(poly.get("POINTS", "")) if poly is not None else [],
            "text": text,
            "words": words,
            "engine_text": text,
            "llm": None,
            "source": "engine",
            "status": "pending",
            "model_version": model_version,
        })
    return {
        "schema_version": SCHEMA_VERSION,
        "revision": 1,
        "image": {
            "file": image_file,
            "width": int(float(page.get("WIDTH"))),
            "height": int(float(page.get("HEIGHT"))),
        },
        "lines": lines,
    }


# ---------------------------------------------------------------- to ALTO


_LINE_META = ("id", "order", "region", "engine_text", "llm", "source", "status", "model_version")


def to_alto(page: dict) -> str:
    """Page JSON -> ALTO 4 string. Lines are written in reading order."""
    alto = ET.Element(f"{_N}alto")
    desc = ET.SubElement(alto, f"{_N}Description")
    ET.SubElement(desc, f"{_N}MeasurementUnit").text = "pixel"
    src = ET.SubElement(desc, f"{_N}sourceImageInformation")
    ET.SubElement(src, f"{_N}fileName").text = page["image"]["file"]
    ET.SubElement(desc, f"{_N}Processing", ID="maatik").append(
        _el("processingStepDescription", f"maatik page schema {page['schema_version']} revision {page['revision']}")
    )

    tags = ET.SubElement(alto, f"{_N}Tags")
    ET.SubElement(tags, f"{_N}OtherTag", ID="TYPE_line", TYPE="type", LABEL="default")
    for r in REGIONS:
        ET.SubElement(tags, f"{_N}OtherTag", ID=f"REGION_{r}", TYPE="region", LABEL=r)

    layout = ET.SubElement(alto, f"{_N}Layout")
    W, H = page["image"]["width"], page["image"]["height"]
    pg = ET.SubElement(layout, f"{_N}Page", ID="page_0", WIDTH=str(W), HEIGHT=str(H), PHYSICAL_IMG_NR="1")
    ps = ET.SubElement(pg, f"{_N}PrintSpace", HPOS="0", VPOS="0", WIDTH=str(W), HEIGHT=str(H))

    lines = sorted(page["lines"], key=lambda l: l["order"])
    for region in REGIONS:
        members = [l for l in lines if l["region"] == region]
        if not members:
            continue
        allpts = [p for l in members for p in (l["boundary"] or l["baseline"])]
        x, y, w, h = _bbox(allpts)
        block = ET.SubElement(ps, f"{_N}TextBlock", ID=f"block_{region}", HPOS=str(x), VPOS=str(y),
                              WIDTH=str(w), HEIGHT=str(h), TAGREFS=f"REGION_{region}")
        for l in members:
            meta = {k: l[k] for k in _LINE_META}
            meta["words"] = [{k: wd[k] for k in ("alternatives", "doubtful")} for wd in l["words"]]
            meta["word_boxes"] = [wd["box"] for wd in l["words"]]
            meta["word_conf"] = [wd["confidence"] for wd in l["words"]]
            meta["word_text"] = [wd["text"] for wd in l["words"]]
            meta["text"] = l["text"]
            tag_id = f"META_{l['id']}"
            ET.SubElement(tags, f"{_N}OtherTag", ID=tag_id, TYPE="maatik", LABEL="line",
                          DESCRIPTION=json.dumps(meta, ensure_ascii=False, separators=(",", ":")))
            bx, by, bw, bh = _bbox(l["boundary"] or l["baseline"])
            tl = ET.SubElement(block, f"{_N}TextLine", ID=l["id"], HPOS=str(bx), VPOS=str(by),
                               WIDTH=str(bw), HEIGHT=str(bh), BASELINE=_flat(l["baseline"]),
                               TAGREFS=f"TYPE_line {tag_id}", BASEDIRECTION="rtl")
            shape = ET.SubElement(tl, f"{_N}Shape")
            ET.SubElement(shape, f"{_N}Polygon", POINTS=_flat(l["boundary"]))
            # One String with the whole line text: this is what ketos trains on.
            ET.SubElement(tl, f"{_N}String", ID=f"{l['id']}_s", CONTENT=l["text"],
                          HPOS=str(bx), VPOS=str(by), WIDTH=str(bw), HEIGHT=str(bh))
    ET.indent(alto)
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(alto, encoding="unicode")


def _el(name: str, text: str) -> ET.Element:
    e = ET.Element(f"{_N}{name}")
    e.text = text
    return e


# ---------------------------------------------------------------- from ALTO


def from_alto(alto_xml: str | bytes) -> dict:
    """ALTO written by to_alto() -> page JSON (lossless)."""
    root = ET.fromstring(alto_xml)
    metas = {t.get("ID"): json.loads(t.get("DESCRIPTION"))
             for t in root.iter(f"{_N}OtherTag") if t.get("TYPE") == "maatik"}
    proc = root.find(f".//{_N}Processing[@ID='maatik']/{_N}processingStepDescription").text.split()
    page = root.find(f".//{_N}Page")
    lines = []
    for tl in root.iter(f"{_N}TextLine"):
        tag = next(t for t in tl.get("TAGREFS", "").split() if t.startswith("META_"))
        m = metas[tag]
        poly = tl.find(f"./{_N}Shape/{_N}Polygon")
        words = [
            {"text": t, "confidence": c, "box": b, "alternatives": w["alternatives"], "doubtful": w["doubtful"]}
            for t, c, b, w in zip(m["word_text"], m["word_conf"], m["word_boxes"], m["words"])
        ]
        line = {k: m[k] for k in _LINE_META}
        line.update(
            baseline=_pairs(tl.get("BASELINE", "")),
            boundary=_pairs(poly.get("POINTS", "")) if poly is not None else [],
            text=tl.find(f"{_N}String").get("CONTENT", ""),
            words=words,
        )
        lines.append(line)
    lines.sort(key=lambda l: l["order"])
    key_order = ("id", "order", "region", "baseline", "boundary", "text", "words",
                 "engine_text", "llm", "source", "status", "model_version")
    return {
        "schema_version": int(proc[3]),
        "revision": int(proc[5]),
        "image": {
            "file": root.find(f".//{_N}sourceImageInformation/{_N}fileName").text,
            "width": int(page.get("WIDTH")),
            "height": int(page.get("HEIGHT")),
        },
        "lines": [{k: l[k] for k in key_order} for l in lines],
    }


# ---------------------------------------------------------------- helpers


def approved_lines(page: dict) -> list[dict]:
    return [l for l in page["lines"] if l["status"] == "approved" and l["text"].strip()]


def training_page(page: dict) -> dict:
    """Copy of the page holding only approved lines: what ketos may learn from."""
    p = deepcopy(page)
    p["lines"] = approved_lines(p)
    return p
