from maatik_engine import pagejson as pj
from maatik_engine.layout import reading_order


def _line(lid, x0, x1, y, order):
    return {"id": lid, "order": order, "baseline": [[x0, y], [x1, y]],
            "boundary": [[x0, y - 20], [x1, y - 20], [x1, y + 5], [x0, y + 5]]}


def test_reading_order_puts_right_column_first_and_renumbers():
    # Top to bottom (Kraken's order) interleaves the two columns.
    lines = [_line("full1", 100, 900, 100, 0), _line("R1", 520, 900, 200, 1), _line("L1", 100, 480, 205, 2),
             _line("R2", 520, 900, 240, 3), _line("L2", 100, 480, 245, 4), _line("full2", 100, 900, 340, 5)]
    out = reading_order(lines)
    assert [l["id"] for l in out] == ["full1", "R1", "R2", "L1", "L2", "full2"]
    assert [l["order"] for l in out] == list(range(6))


def _manual(**kw):
    line = {"id": "l_0123456789ab", "order": 3, "region": "margin", "status": "approved", "source": "manual",
            "text": "שורה", "baseline": [[10, 50], [200, 50]],
            "boundary": [[10, 30], [200, 30], [200, 55], [10, 55]]}
    line.update(kw)
    return line


def test_check_line_accepts_a_drawn_line():
    assert pj.check_line(_manual(), 1000, 1000) is None


def test_check_line_rejects_bad_input():
    assert pj.check_line(_manual(id="x"), 1000, 1000) == "bad id"
    assert pj.check_line(_manual(region="body"), 1000, 1000) == "bad region"
    assert pj.check_line(_manual(baseline=[[10, 50]]), 1000, 1000) == "bad baseline"
    assert pj.check_line(_manual(boundary=[[10, 30], [2000, 30], [10, 55]]), 1000, 1000) == "bad boundary point"
    assert pj.check_line(_manual(source="llm"), 1000, 1000) == "bad source"


def test_manual_line_has_every_field_and_round_trips_through_alto():
    line = pj.manual_line(_manual())
    assert line["engine_text"] == "" and line["words"] == [] and line["source"] == "manual"
    page = {"schema_version": 1, "revision": 2, "image": {"file": "0001.jpg", "width": 1000, "height": 1000},
            "lines": [line]}
    assert pj.from_alto(pj.to_alto(page)) == page


def test_page_text_in_reading_order():
    page = {"lines": [dict(_manual(), order=1, text="שני", status="pending"), dict(_manual(), order=0, text="ראשון")]}
    assert pj.page_text(page) == "ראשון\nשני"
    assert pj.page_text(page, approved_only=True) == "ראשון"
