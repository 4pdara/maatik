"""Page JSON <-> ALTO: round trip without loss, and ketos can read what we write.

Uses a small synthetic Kraken-style ALTO; no manuscript content.
"""

import importlib.util
import json

import pytest

from maatik_engine import pagejson as pj

KRAKEN_ALTO = """<?xml version="1.0" encoding="UTF-8"?>
<alto xmlns="http://www.loc.gov/standards/alto/ns-v4#">
  <Description><MeasurementUnit>pixel</MeasurementUnit></Description>
  <Tags>
    <OtherTag ID="TYPE_1" TYPE="type" LABEL="default"/>
    <OtherTag ID="TYPE_2" TYPE="type" LABEL="text"/>
  </Tags>
  <Layout><Page WIDTH="800" HEIGHT="600" ID="page_0"><PrintSpace HPOS="0" VPOS="0" WIDTH="800" HEIGHT="600">
    <TextBlock ID="b1" TAGREFS="TYPE_2" HPOS="10" VPOS="10" WIDTH="780" HEIGHT="200">
      <TextLine ID="k1" BASELINE="700 60 100 62" TAGREFS="TYPE_1" BASEDIRECTION="rtl" HPOS="100" VPOS="20" WIDTH="600" HEIGHT="50">
        <Shape><Polygon POINTS="700 20 700 70 100 70 100 20"/></Shape>
        <String ID="s1" CONTENT="שלום" HPOS="600" VPOS="22" WIDTH="100" HEIGHT="45" WC="0.93"/>
        <String ID="s2" CONTENT="עליכם" HPOS="450" VPOS="22" WIDTH="120" HEIGHT="45" WC="0.41"/>
      </TextLine>
      <TextLine ID="k2" BASELINE="700 140 100 141" TAGREFS="TYPE_1" BASEDIRECTION="rtl" HPOS="100" VPOS="100" WIDTH="600" HEIGHT="50">
        <Shape><Polygon POINTS="700 100 700 150 100 150 100 100"/></Shape>
        <String ID="s3" CONTENT="ב&quot;ה" HPOS="650" VPOS="102" WIDTH="50" HEIGHT="45" WC="0.77"/>
      </TextLine>
    </TextBlock>
  </PrintSpace></Page></Layout>
</alto>"""


@pytest.fixture
def page():
    p = pj.from_kraken_alto(KRAKEN_ALTO, "0001.jpg", "base:ppocrv6-small")
    # Make it look like a page someone has worked on.
    p["revision"] = 7
    l0, l1 = p["lines"]
    l0["text"] = "שלום עליכם"
    l0["status"] = "approved"
    l0["words"][1]["alternatives"] = ["עליכן", "עליהם"]
    l1["text"] = 'ב"ה'
    l1["region"] = "margin"
    l1["words"][0]["doubtful"] = True
    l1["llm"] = {"word": 0, "suggested": 'ב"ה', "original": 'ב"ה', "reverted": False}
    p["lines"].append({
        "id": pj.new_line_id(), "order": 2, "region": "interlinear",
        "baseline": [[500, 90], [300, 91]], "boundary": [[500, 80], [500, 95], [300, 95], [300, 80]],
        "text": "תוספת", "words": [{"text": "תוספת", "confidence": None, "box": None,
                                     "alternatives": [], "doubtful": False}],
        "engine_text": "", "llm": None, "source": "manual", "status": "approved",
        "model_version": None,
    })
    return p


def test_from_kraken_reads_lines_words_and_geometry():
    p = pj.from_kraken_alto(KRAKEN_ALTO, "0001.jpg", "base:ppocrv6-small")
    assert p["schema_version"] == 1
    assert p["image"] == {"file": "0001.jpg", "width": 800, "height": 600}
    assert [l["text"] for l in p["lines"]] == ["שלום עליכם", 'ב"ה']
    l0 = p["lines"][0]
    assert l0["engine_text"] == l0["text"]
    assert l0["baseline"] == [[700, 60], [100, 62]]
    assert l0["boundary"][0] == [700, 20]
    assert [w["confidence"] for w in l0["words"]] == [0.93, 0.41]
    assert l0["words"][1]["box"] == [450, 22, 120, 45]
    assert all(l["status"] == "pending" and l["source"] == "engine" for l in p["lines"])
    assert len({l["id"] for l in p["lines"]}) == 2


def test_round_trip_is_lossless(page):
    back = pj.from_alto(pj.to_alto(page))
    assert json.dumps(back, sort_keys=True, ensure_ascii=False) == json.dumps(page, sort_keys=True, ensure_ascii=False)


def test_round_trip_twice_is_stable(page):
    once = pj.to_alto(page)
    assert pj.to_alto(pj.from_alto(once)) == once


def test_training_page_keeps_only_approved(page):
    t = pj.training_page(page)
    assert [l["text"] for l in t["lines"]] == ["שלום עליכם", "תוספת"]
    assert len(page["lines"]) == 3  # original untouched


@pytest.mark.skipif(importlib.util.find_spec("kraken") is None, reason="kraken not installed")
def test_kraken_parses_our_alto(page, tmp_path):
    from kraken.lib.xml import XMLPage

    f = tmp_path / "0001.xml"
    f.write_text(pj.to_alto(pj.training_page(page)), encoding="utf-8")
    parsed = XMLPage(f, filetype="alto")
    lines = list(parsed.lines.values()) if isinstance(parsed.lines, dict) else list(parsed.lines)
    texts = sorted(l.text for l in lines)
    assert texts == sorted(["שלום עליכם", "תוספת"])
    first = next(l for l in lines if l.text == "שלום עליכם")
    assert [list(p) for p in first.baseline] == [[700, 60], [100, 62]]
