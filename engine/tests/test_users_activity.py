from datetime import datetime, timezone

from maatik_engine import activity, users


def test_password_hash_round_trip_and_salt():
    h1, h2 = users.hash_password("long-enough-pw"), users.hash_password("long-enough-pw")
    assert h1 != h2  # salted
    assert users.check_password("long-enough-pw", h1)
    assert not users.check_password("long-enough-pX", h1)
    assert not users.check_password("x", "garbage")


def test_new_user_validation_and_public_view():
    assert users.validate_new("uriel", "אוריאל", "0123456789", "admin") is None
    assert users.validate_new("Uriel", "אוריאל", "0123456789", "admin")  # upper case not allowed
    assert users.validate_new("uriel", "אוריאל", "short", "admin")
    assert users.validate_new("uriel", "", "0123456789", "admin")
    assert users.validate_new("uriel", "אוריאל", "0123456789", "owner")
    u = users.new_user("uriel", "אוריאל", "  0123456789 \n", "admin", None)
    assert users.check_password("0123456789", u["password_hash"])  # spaces around do not count
    assert "password_hash" not in users.public(u)


def _l(i, text, status="pending", engine=None, region="main", source="engine"):
    return {"id": i, "text": text, "status": status, "engine_text": engine if engine is not None else text,
            "region": region, "source": source}


def test_save_diff_counts_each_kind_of_change():
    old = [_l("a", "x"), _l("b", "y"), _l("c", "z", status="approved"), _l("d", "w")]
    new = [_l("a", "x", status="approved"),                      # approved as read
           _l("b", "Y", status="approved", engine="y"),          # corrected and approved
           _l("c", "z", status="pending"),                       # approval withdrawn
           _l("e", "new", status="approved", engine="", source="manual")]  # added; d deleted
    d = activity.save_diff(old, new)
    assert d == {"approved": 3, "unapproved": 1, "corrected": 1, "edited": 1, "added": 1, "deleted": 1, "region": 0}


def test_summary_counts_minutes_once_and_joins_trainings(tmp_path):
    root = tmp_path / "activity"
    ev = [
        {"ts": "2026-11-27T10:00:05+00:00", "user": "uriel", "kind": "login"},
        {"ts": "2026-11-27T10:01:00+00:00", "user": "uriel", "kind": "active", "slug": "ms"},
        {"ts": "2026-11-27T10:01:30+00:00", "user": "uriel", "kind": "active", "slug": "ms"},  # same minute
        {"ts": "2026-11-27T10:02:00+00:00", "user": "uriel", "kind": "active", "slug": "ms"},
        {"ts": "2026-11-27T10:02:10+00:00", "user": "uriel", "kind": "save", "slug": "ms", "page": 4,
         "changes": {"approved": 5, "corrected": 2, "edited": 2, "added": 1, "deleted": 0, "unapproved": 0}},
        {"ts": "2026-11-27T10:03:00+00:00", "user": "uriel", "kind": "train_start", "slug": "ms"},
        {"ts": "2026-11-27T11:00:00+00:00", "user": "dina", "kind": "active", "slug": "ms"},
        {"ts": "2026-11-27T11:01:00+00:00", "user": "dina", "kind": "upload", "slug": "ms", "page": 12},
    ]
    for i, e in enumerate(ev):
        activity.append(root, dict(e), writer=f"w{i % 2}")
    got = activity.read(root, datetime(2026, 11, 1, tzinfo=timezone.utc))
    assert len(got) == len(ev)
    trainings = [{"slug": "ms", "version": "v3", "created_at": "2026-11-27T12:00:00+00:00", "promoted": True,
                  "train_lines": 300, "before": {"cer": 0.03}, "after": {"cer": 0.025}, "started_by": "uriel"}]
    s = {x["user"]: x for x in activity.summarize(got, trainings)["users"]}
    assert s["uriel"]["active_minutes"] == 2
    assert s["uriel"]["lines_approved"] == 5 and s["uriel"]["lines_corrected"] == 2
    assert s["uriel"]["pages"] == 1 and s["uriel"]["logins"] == 1 and s["uriel"]["trainings_started"] == 1
    assert s["uriel"]["trainings"][0]["version"] == "v3"
    assert s["dina"]["active_minutes"] == 1 and s["dina"]["lines_approved"] == 0
    assert s["dina"]["pages_uploaded"] == 1 and s["uriel"]["pages_uploaded"] == 0


def test_empty_stats_has_every_summary_field():
    full = activity.summarize([{"ts": "2026-11-27T10:00:00+00:00", "user": "a", "kind": "login"}])["users"][0]
    assert set(activity.empty_stats("b")) == set(full)
