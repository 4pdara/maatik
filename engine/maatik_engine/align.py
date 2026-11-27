"""Split a continuous transcription across the lines the engine found.

Transcriptions often come as running text per page, or for a whole manuscript,
without line breaks. We align that text, character by character, with the
engine's reading of all lines in order (one global alignment), map each line's
start to a position in the transcription, and snap it to a word boundary.

A line is only marked "approved" (usable for training and measurement) when the
alignment around it is solid. Everything else stays "pending" for a person to
check: a wrong split would teach the model text that is not on the line.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

from rapidfuzz.distance import Levenshtein

from .layout import column_order, furniture_lines  # noqa: F401 (re-exported)
from .metrics import edit_distance, normalize

_BRACKETED = re.compile(r"\s*\[[^\]]*\]\s*")
SEP = " "  # line separator inside the engine string; never in the transcription


def prepare_transcription(text: str) -> tuple[str, list[str]]:
    """Return (main text, bracketed notes). Bracketed words, e.g. the sefirot names
    written above the line, are interlinear and are not part of the main line."""
    text = unicodedata.normalize("NFC", text)
    notes = [m.strip(" []") for m in re.findall(r"\[[^\]]*\]", text)]
    main = _BRACKETED.sub(" ", text)
    return normalize(main), notes


@dataclass
class LineMatch:
    index: int            # position in the input list of lines
    text: str             # transcription chunk assigned to the line ("" if none)
    cer: float | None     # engine reading vs chunk
    start_solid: bool     # alignment exact around the line start
    end_solid: bool       # alignment exact around the line end
    confident: bool


def _h2r_map(h: str, r: str) -> list[int]:
    """For every position in h (0..len(h)), the aligned position in r."""
    m = [0] * (len(h) + 1)
    for tag, i1, i2, j1, j2 in Levenshtein.opcodes(h, r):
        if tag in ("equal", "replace"):
            for k in range(i2 - i1):
                m[i1 + k] = j1 + min(k, max(j2 - j1 - 1, 0)) if tag == "replace" else j1 + k
        else:  # delete (in h only) or insert (in r only)
            for k in range(i1, i2):
                m[k] = j1
    m[len(h)] = len(r)
    return m


def _solid(ops_equal: list[bool], pos: int, before: int, after: int) -> bool:
    lo, hi = max(0, pos - before), min(len(ops_equal), pos + after)
    window = ops_equal[lo:hi]
    return bool(window) and sum(window) / len(window) >= 0.75


def _snap(r: str, j: int, window: int = 10) -> int:
    """Nearest word boundary in r to position j."""
    if j <= 0 or j >= len(r):
        return max(0, min(j, len(r)))
    best = None
    for d in range(window + 1):
        for cand in (j - d, j + d):
            if 0 < cand < len(r) and r[cand - 1] == " ":
                return cand
            if cand in (0, len(r)):
                best = cand
    return best if best is not None else j


def align_lines(engine_lines: list[str], transcription: str, *, max_cer: float = 0.35) -> list[LineMatch]:
    lines = [normalize(l) for l in engine_lines]
    r = normalize(transcription)
    h = SEP.join(lines)
    starts, pos = [], 0
    for l in lines:
        starts.append(pos)
        pos += len(l) + 1
    m = _h2r_map(h, r)

    # Which positions of h are aligned exactly (for boundary solidity).
    eq = [False] * len(h)
    for tag, i1, i2, _, _ in Levenshtein.opcodes(h, r):
        if tag == "equal":
            for k in range(i1, i2):
                eq[k] = True

    bounds = [_snap(r, m[s]) for s in starts] + [len(r)]
    # A line whose engine text maps entirely to nothing (header, page number,
    # catchword, a line missing from the transcription) gets an empty chunk.
    out = []
    for i, line in enumerate(lines):
        a, b = bounds[i], bounds[i + 1]
        if b < a:
            b = a
        chunk = r[a:b].strip()
        s, e = starts[i], starts[i] + len(line)
        start_solid = _solid(eq, s, 0, 6) if line else False
        end_solid = _solid(eq, e, 6, 0) if line else False
        cer = edit_distance(line, chunk) / len(chunk) if chunk else None
        confident = bool(chunk) and cer is not None and cer <= max_cer and start_solid and end_solid
        out.append(LineMatch(i, chunk, round(cer, 4) if cer is not None else None,
                             start_solid, end_solid, confident))
    return out
