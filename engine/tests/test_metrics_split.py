import pytest

from maatik_engine.metrics import edit_distance, normalize, score
from maatik_engine.split import ensure_split, is_test_page, make_split


def test_normalize_only_nfc_and_whitespace():
    assert normalize("  שלום   עליכם \n") == "שלום עליכם"
    # Gershayim, final letters and spelling stay as they are.
    assert normalize('רמב"ם ך') == 'רמב"ם ך'
    # NFD -> NFC
    assert normalize("é") == "é"


def test_edit_distance():
    assert edit_distance("", "") == 0
    assert edit_distance("abc", "abc") == 0
    assert edit_distance("abc", "abd") == 1
    assert edit_distance("kitten", "sitting") == 3
    assert edit_distance(["a", "b"], ["a", "c", "b"]) == 1


def test_score_cer_wer():
    s = score([("שלום עליכם", "שלום עליכם"), ("היקר דרב", "היקר הרב")])
    assert s["lines"] == 2
    assert s["chars"] == len("שלום עליכם") + len("היקר הרב")
    assert s["cer"] == round(1 / s["chars"], 4)
    assert s["wer"] == round(1 / 4, 4)


def test_split_is_spread_and_disjoint():
    sp = make_split(list(range(1, 13)), n_test=3)
    assert len(sp["test"]) == 3
    assert not set(sp["test"]) & set(sp["train"])
    assert sorted(sp["test"] + sp["train"]) == list(range(1, 13))
    assert sp["test"] != [1, 2, 3]


def test_split_never_reshuffles():
    m = {}
    first = ensure_split(m, list(range(1, 11)))
    again = ensure_split(m, list(range(1, 11)))
    assert again == first
    grown = ensure_split(m, list(range(1, 16)))
    assert grown["test"] == first["test"]
    assert set(range(11, 16)) <= set(grown["train"])
    assert is_test_page(m, first["test"][0])


def test_split_needs_enough_pages():
    with pytest.raises(ValueError):
        make_split([1, 2, 3], n_test=3)
