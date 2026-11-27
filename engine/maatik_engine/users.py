"""Site users: who may log in, with what role. Stored as one JSON file on the volume.

Passwords are kept only as scrypt hashes (salted). Roles:
    admin   manages users and sees everyone's statistics
    editor  proofreads and may start training
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets
from datetime import datetime, timezone

ROLES = ("admin", "editor")
USERNAME_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{1,31}$")
MIN_PASSWORD = 10
_N, _R, _P = 2 ** 14, 8, 1


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=32)
    return "scrypt$" + base64.b64encode(salt).decode() + "$" + base64.b64encode(digest).decode()


def check_password(password: str, stored: str) -> bool:
    try:
        kind, salt_b64, digest_b64 = stored.split("$")
        if kind != "scrypt":
            return False
        salt, digest = base64.b64decode(salt_b64), base64.b64decode(digest_b64)
    except ValueError:
        return False
    got = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=len(digest))
    return hmac.compare_digest(got, digest)


def clean_password(password: str) -> str:
    """Spaces around a password do not count (they get pasted in by mistake)."""
    return password.strip()


def validate_new(username: str, display_name: str, password: str, role: str) -> str | None:
    if not USERNAME_RE.match(username or ""):
        return "שם משתמש: 2 עד 32 תווים, אותיות באנגלית קטנות, ספרות, נקודה, מקף או קו תחתון"
    if not isinstance(display_name, str) or not (1 <= len(display_name.strip()) <= 60):
        return "שם לתצוגה: 1 עד 60 תווים"
    if not isinstance(password, str) or len(clean_password(password)) < MIN_PASSWORD:
        return f"סיסמה: לפחות {MIN_PASSWORD} תווים"
    if role not in ROLES:
        return "תפקיד לא מוכר"
    return None


def public(user: dict) -> dict:
    """A user without the password hash."""
    return {k: v for k, v in user.items() if k != "password_hash"}


def new_user(username: str, display_name: str, password: str, role: str, created_by: str | None) -> dict:
    return {
        "username": username,
        "display_name": display_name.strip(),
        "role": role,
        "disabled": False,
        "password_hash": hash_password(clean_password(password)),
        "created_at": now_iso(),
        "created_by": created_by,
        "password_changed_at": now_iso(),
    }
