"""Train/test page split. Decided once per manuscript and stored (CLAUDE.md rule 6).

Test pages never go into training. Once a split exists it is never changed;
pages added later are training pages.
"""

from __future__ import annotations


def make_split(pages: list[int], n_test: int = 3) -> dict:
    """Spread test pages evenly through the manuscript (not just the first ones)."""
    pages = sorted(set(pages))
    if len(pages) < n_test + 1:
        raise ValueError(f"need at least {n_test + 1} pages to split, have {len(pages)}")
    step = len(pages) / n_test
    test = sorted({pages[int(step * i + step / 2)] for i in range(n_test)})
    return {"test": test, "train": [p for p in pages if p not in test]}


def ensure_split(manuscript: dict, pages: list[int], n_test: int = 3) -> dict:
    """Return the stored split, creating it only if there is none. Never reshuffles."""
    split = manuscript.get("split")
    if split:
        known = set(split["test"]) | set(split["train"])
        new = sorted(p for p in pages if p not in known)
        if new:
            split = {"test": split["test"], "train": sorted(split["train"] + new)}
            manuscript["split"] = split
        return split
    manuscript["split"] = make_split(pages, n_test)
    return manuscript["split"]


def is_test_page(manuscript: dict, page: int) -> bool:
    split = manuscript.get("split") or {}
    return page in split.get("test", [])
