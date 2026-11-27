"""Page layout helpers that need nothing but the standard library.

- column_order(): reading order on pages with two side-by-side columns.
- furniture_lines(): running heads, page numbers and catchwords.
- reading_order(): the order the engine stores, using column_order().
"""

from __future__ import annotations


def column_order(lines: list[dict], full_width: float = 0.75) -> list[dict]:
    """Reading order for pages with two columns, right column first (RTL).

    Kraken orders lines top to bottom, which interleaves side-by-side columns.
    A run of narrow lines (between full-width lines) is a column block: its
    right-column lines come first, then its left-column lines, each top to bottom.
    """
    if not lines:
        return []

    def xr(l):
        pts = l["boundary"] or l["baseline"]
        xs = [p[0] for p in pts]
        return min(xs), max(xs)

    def ytop(l):
        return min(p[1] for p in l["baseline"])

    lefts = sorted(xr(l)[0] for l in lines)
    rights = sorted(xr(l)[1] for l in lines)
    text_left = lefts[len(lefts) // 10]
    text_right = rights[(len(rights) * 9) // 10]
    width = max(text_right - text_left, 1)
    mid = (text_left + text_right) / 2

    def kind(l):
        a, b = xr(l)
        if (b - a) >= full_width * width:
            return "full"
        return "right" if (a + b) / 2 >= mid else "left"

    ordered, block = [], []

    def flush():
        ordered.extend(sorted((l for l in block if kind(l) == "right"), key=ytop))
        ordered.extend(sorted((l for l in block if kind(l) == "left"), key=ytop))
        block.clear()

    for l in sorted(lines, key=ytop):
        if kind(l) == "full":
            flush()
            ordered.append(l)
        else:
            block.append(l)
    flush()
    return ordered


def furniture_lines(lines: list[dict], narrow: float = 0.3) -> set[str]:
    """Ids of page furniture: running head, page number, catchword.

    Narrow lines above the first wide line or below the last wide line. A
    transcription usually leaves them out (the catchword repeats the first word
    of the next page), so they are kept out of the alignment.
    """
    if not lines:
        return set()

    def xr(l):
        pts = l["boundary"] or l["baseline"]
        xs = [p[0] for p in pts]
        return min(xs), max(xs)

    def y(l):
        return min(p[1] for p in l["baseline"])

    lefts = sorted(xr(l)[0] for l in lines)
    rights = sorted(xr(l)[1] for l in lines)
    width = max(rights[(len(rights) * 9) // 10] - lefts[len(lefts) // 10], 1)
    wide = [l for l in lines if (xr(l)[1] - xr(l)[0]) >= 0.6 * width]
    if not wide:
        return set()
    top, bottom = min(y(l) for l in wide), max(y(l) for l in wide)
    return {l["id"] for l in lines
            if (xr(l)[1] - xr(l)[0]) < narrow * width and (y(l) < top or y(l) > bottom)}


def reading_order(lines: list[dict]) -> list[dict]:
    """Return the lines in reading order with their "order" field renumbered.

    Kraken orders lines top to bottom, which interleaves two columns; this puts
    the right column before the left one. Lines without geometry keep their
    relative place at the end.
    """
    placed = [l for l in lines if (l.get("boundary") or l.get("baseline")) and l.get("baseline")]
    rest = [l for l in lines if l not in placed]
    ordered = column_order(placed) + rest
    for i, l in enumerate(ordered):
        l["order"] = i
    return ordered
