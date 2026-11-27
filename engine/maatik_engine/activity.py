"""Who did what in the editor, and statistics per user.

Events are appended to JSONL files (one file per month and per container, so two
containers never write the same file). Kinds:
    login         a successful login
    active        one minute of real work in the editor (sent by the editor while
                  the person types or clicks; idle time is not counted)
    save          a page save, with what changed (see save_diff)
    train_start   "improve the model" started
    recognize_all recognition of all unproofread pages started
    upload        a page scan uploaded (photographed in the app, or from a file)
    create_manuscript  a new manuscript created
"""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

KINDS = ("login", "active", "save", "train_start", "recognize_all", "upload", "create_manuscript")


def save_diff(old_lines: list[dict], new_lines: list[dict]) -> dict:
    """What a save changed, line by line."""
    old = {l["id"]: l for l in old_lines}
    new = {l["id"]: l for l in new_lines}
    d = dict(approved=0, unapproved=0, corrected=0, edited=0, added=0, deleted=0, region=0)
    for i, l in new.items():
        o = old.get(i)
        if o is None:
            d["added"] += 1
            if l["status"] == "approved":
                d["approved"] += 1
            continue
        if l["text"] != o["text"]:
            d["edited"] += 1
        if l["region"] != o["region"]:
            d["region"] += 1
        if o["status"] != "approved" and l["status"] == "approved":
            d["approved"] += 1
            # Approved with a reading different from the engine's: the person corrected it.
            if l.get("source") == "engine" and l["text"] != l.get("engine_text", l["text"]):
                d["corrected"] += 1
        elif o["status"] == "approved" and l["status"] != "approved":
            d["unapproved"] += 1
    d["deleted"] = sum(1 for i in old if i not in new)
    return d


def append(root: Path, event: dict, *, writer: str) -> Path:
    """Append one event. `writer` names the container, so files are never shared."""
    ts = event.setdefault("ts", datetime.now(timezone.utc).isoformat(timespec="seconds"))
    month = ts[:7]
    path = root / month / f"{writer}.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(event, ensure_ascii=False) + "\n")
    return path


def read(root: Path, since: datetime) -> list[dict]:
    out = []
    if not root.exists():
        return out
    first_month = since.strftime("%Y-%m")
    for month_dir in sorted(p for p in root.iterdir() if p.is_dir() and p.name >= first_month):
        for f in month_dir.glob("*.jsonl"):
            for line in f.read_text(encoding="utf-8").splitlines():
                try:
                    e = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if e.get("ts", "") >= since.isoformat(timespec="seconds"):
                    out.append(e)
    return sorted(out, key=lambda e: e["ts"])


def summarize(events: list[dict], trainings: list[dict] | None = None) -> dict:
    """Statistics per user. `trainings` are model versions (metrics.json) with started_by."""
    users: dict[str, dict] = {}
    minutes_seen: dict[str, set] = defaultdict(set)
    pages: dict[str, set] = defaultdict(set)

    def u(name: str) -> dict:
        if name not in users:
            users[name] = dict(user=name, active_minutes=0, days=set(), logins=0, first_seen=None, last_seen=None,
                               lines_approved=0, lines_corrected=0, lines_edited=0, lines_added=0, lines_deleted=0,
                               lines_unapproved=0, pages=0, manuscripts=set(), trainings_started=0, pages_uploaded=0,
                               per_day=defaultdict(lambda: {"minutes": 0, "approved": 0}))
        return users[name]

    for e in events:
        name = e.get("user")
        if not name or e.get("kind") not in KINDS:
            continue
        s = u(name)
        day = e["ts"][:10]
        s["days"].add(day)
        s["first_seen"] = s["first_seen"] or e["ts"]
        s["last_seen"] = e["ts"]
        if e.get("slug"):
            s["manuscripts"].add(e["slug"])
        kind = e["kind"]
        if kind == "login":
            s["logins"] += 1
        elif kind == "active":
            minute = e["ts"][:16]
            if minute not in minutes_seen[name]:
                minutes_seen[name].add(minute)
                s["active_minutes"] += 1
                s["per_day"][day]["minutes"] += 1
        elif kind == "save":
            c = e.get("changes", {})
            s["lines_approved"] += c.get("approved", 0)
            s["lines_corrected"] += c.get("corrected", 0)
            s["lines_edited"] += c.get("edited", 0)
            s["lines_added"] += c.get("added", 0)
            s["lines_deleted"] += c.get("deleted", 0)
            s["lines_unapproved"] += c.get("unapproved", 0)
            s["per_day"][day]["approved"] += c.get("approved", 0)
            pages[name].add((e.get("slug"), e.get("page")))
        elif kind == "train_start":
            s["trainings_started"] += 1
        elif kind == "upload":
            s["pages_uploaded"] += 1

    by_user_trainings: dict[str, list] = defaultdict(list)
    for t in trainings or []:
        if t.get("started_by"):
            by_user_trainings[t["started_by"]].append({
                "slug": t.get("slug"), "version": t["version"], "created_at": t["created_at"],
                "promoted": t["promoted"], "train_lines": t.get("train_lines"),
                "cer_before": (t.get("before") or {}).get("cer"), "cer_after": (t.get("after") or {}).get("cer"),
            })

    out = []
    for name, s in users.items():
        s["pages"] = len(pages[name])
        s["days"] = len(s["days"])
        s["manuscripts"] = sorted(s["manuscripts"])
        s["per_day"] = [{"day": d, **v} for d, v in sorted(s["per_day"].items())]
        hours = s["active_minutes"] / 60
        s["approved_per_hour"] = round(s["lines_approved"] / hours, 1) if hours >= 0.25 else None
        s["trainings"] = sorted(by_user_trainings.get(name, []), key=lambda t: t["created_at"])
        out.append(s)
    return {"users": sorted(out, key=lambda s: s["last_seen"] or "", reverse=True)}


def empty_stats(name: str) -> dict:
    """A user with no activity in the period (so an admin sees everyone)."""
    return dict(user=name, active_minutes=0, days=0, logins=0, first_seen=None, last_seen=None, lines_approved=0,
                lines_corrected=0, lines_edited=0, lines_added=0, lines_deleted=0, lines_unapproved=0, pages=0,
                manuscripts=[], trainings_started=0, pages_uploaded=0, per_day=[], approved_per_hour=None, trainings=[])


def since_days(days: int) -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=days)
