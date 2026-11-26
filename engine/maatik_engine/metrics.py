"""CER and WER, as defined in docs/SPEC.md ("מדידה").

Normalisation before comparing: Unicode NFC, runs of whitespace to one space,
no leading/trailing spaces. Nothing else: geresh/gershayim, final letters and
spelling stay as they are.
"""

from __future__ import annotations

import re
import unicodedata

_WS = re.compile(r"\s+")


def normalize(s: str) -> str:
    return _WS.sub(" ", unicodedata.normalize("NFC", s)).strip()


def edit_distance(a, b) -> int:
    """Levenshtein distance between two sequences (characters or words)."""
    if len(a) < len(b):
        a, b = b, a
    prev = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        cur = [i]
        for j, y in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x != y)))
        prev = cur
    return prev[-1]


def score(pairs: list[tuple[str, str]]) -> dict:
    """pairs: (engine_text, approved_text) per line. Returns CER/WER over all lines."""
    ce = cn = we = wn = 0
    for hyp, ref in pairs:
        h, r = normalize(hyp), normalize(ref)
        ce += edit_distance(h, r)
        cn += len(r)
        hw, rw = h.split(" ") if h else [], r.split(" ") if r else []
        we += edit_distance(hw, rw)
        wn += len(rw)
    return {
        "cer": round(ce / cn, 4) if cn else None,
        "wer": round(we / wn, 4) if wn else None,
        "lines": len(pairs),
        "chars": cn,
        "words": wn,
    }
