from maatik_engine.align import align_lines, column_order, furniture_lines, prepare_transcription


def test_prepare_strips_bracketed_interlinear_words():
    main, notes = prepare_transcription("עלה אלהים בתרועה [מלכות] ה' בקול שופר.")
    assert main == "עלה אלהים בתרועה ה' בקול שופר."
    assert notes == ["מלכות"]


def test_align_splits_running_text_across_lines():
    truth = ["אחר קריאת התורה יכין כל אדם", "את עצמו לקיים מצות עשה של", "תקיעת שופר שכתוב בתורה"]
    engine = ["אחר קריאת התורה יכין כל אדס", "את עצמו לקיים מצות עשה שר", "תקיעת שופר שכתוב בתורה"]
    res = align_lines(engine, " ".join(truth))
    assert [r.text for r in res] == truth
    assert all(r.confident for r in res)


def test_unmatched_engine_line_gets_no_text():
    truth = ["אחר קריאת התורה יכין כל אדם", "את עצמו לקיים מצות עשה"]
    engine = [truth[0], "שחרית של ר\"ה", truth[1]]
    res = align_lines(engine, " ".join(truth))
    assert res[0].text == truth[0] and res[2].text == truth[1]
    assert not res[1].confident


def _line(lid, x0, x1, y):
    return {"id": lid, "baseline": [[x0, y], [x1, y]], "boundary": [[x0, y - 20], [x1, y - 20], [x1, y + 5], [x0, y + 5]]}


def test_column_order_reads_right_column_first():
    lines = [
        _line("full1", 100, 1000, 100),
        _line("L1", 100, 450, 200), _line("R1", 600, 1000, 205),
        _line("L2", 100, 450, 240), _line("R2", 600, 1000, 245),
        _line("full2", 100, 1000, 300),
    ]
    assert [l["id"] for l in column_order(lines)] == ["full1", "R1", "R2", "L1", "L2", "full2"]


def test_furniture_is_narrow_lines_outside_the_text_block():
    lines = [
        _line("head", 450, 650, 50), _line("pageno", 100, 160, 52),
        _line("t1", 100, 1000, 100), _line("t2", 100, 1000, 140),
        _line("catch", 100, 200, 220),
    ]
    assert furniture_lines(lines) == {"head", "pageno", "catch"}
