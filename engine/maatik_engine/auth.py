"""Engine API token.

Prototype scheme: the API token is derived from MODAL_TOKEN_SECRET, so it
exists only where that secret already exists (the GitHub Actions secret, the
cloud session's environment variable, and a Modal secret written by the deploy
workflow). Rotating the Modal token rotates the API token. Never log it.
"""

import hashlib
import hmac

_CONTEXT = b"maatik-engine-api-v1"


def derive_api_token(modal_token_secret: str) -> str:
    if not modal_token_secret:
        raise ValueError("MODAL_TOKEN_SECRET is empty")
    return hmac.new(modal_token_secret.encode(), _CONTEXT, hashlib.sha256).hexdigest()


def token_matches(presented: str, expected: str) -> bool:
    return hmac.compare_digest(presented.encode(), expected.encode())
