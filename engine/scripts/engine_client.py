"""Small HTTPS client for the engine API (works through the cloud session's proxy).

Env:  MAATIK_ENGINE_URL  e.g. https://<workspace>--maatik-engine-api.modal.run
      MODAL_TOKEN_SECRET used only to derive the API token; never printed.

    python engine/scripts/engine_client.py health
    python engine/scripts/engine_client.py upload SLUG PAGE FILE.jpg
    python engine/scripts/engine_client.py recognize SLUG PAGE [--model ppocrv6-medium] [--out FILE.alto.xml]
    python engine/scripts/engine_client.py feasibility-c [--model ppocrv6-medium] [--lines 60] [--epochs 2]
    python engine/scripts/engine_client.py runs SLUG
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from maatik_engine.auth import derive_api_token  # noqa: E402


def session() -> tuple[requests.Session, str]:
    base = os.environ["MAATIK_ENGINE_URL"].rstrip("/")
    s = requests.Session()
    s.headers["Authorization"] = "Bearer " + derive_api_token(os.environ["MODAL_TOKEN_SECRET"])
    return s, base


def main() -> None:
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("health")
    u = sub.add_parser("upload")
    u.add_argument("slug"); u.add_argument("page", type=int); u.add_argument("file", type=Path)
    r = sub.add_parser("recognize")
    r.add_argument("slug"); r.add_argument("page", type=int); r.add_argument("--out", type=Path)
    r.add_argument("--wait", type=int, default=1800)
    r.add_argument("--model", default="ppocrv6-small")
    f = sub.add_parser("feasibility-c")
    f.add_argument("--model", default="ppocrv6-small")
    f.add_argument("--lines", type=int, default=60)
    f.add_argument("--epochs", type=int, default=2)
    f.add_argument("--wait", type=int, default=3600)
    n = sub.add_parser("runs")
    n.add_argument("slug")
    a = p.parse_args()
    s, base = session()

    if a.cmd == "health":
        resp = s.get(f"{base}/v1/health", timeout=120)
    elif a.cmd == "upload":
        resp = s.put(f"{base}/v1/manuscripts/{a.slug}/pages/{a.page}/image",
                     data=a.file.read_bytes(), timeout=300,
                     headers={"Content-Type": "image/jpeg"})
    elif a.cmd == "runs":
        resp = s.get(f"{base}/v1/manuscripts/{a.slug}/runs", timeout=120)
        resp.raise_for_status(); print(resp.text, end=""); return
    else:
        t0 = time.monotonic()
        if a.cmd == "feasibility-c":
            resp = s.post(f"{base}/v1/feasibility/c", timeout=120,
                          params={"model": a.model, "lines": a.lines, "epochs": a.epochs})
        else:
            resp = s.post(f"{base}/v1/manuscripts/{a.slug}/pages/{a.page}/recognize",
                          params={"model": a.model}, timeout=120)
        resp.raise_for_status()
        job = resp.json()["job_id"]
        print(f"job {job}", file=sys.stderr)
        while True:
            resp = s.get(f"{base}/v1/jobs/{job}", timeout=120)
            resp.raise_for_status()
            if resp.json()["status"] != "running" or time.monotonic() - t0 > a.wait:
                break
            time.sleep(5)
        out = resp.json()
        out["client_wall_seconds"] = round(time.monotonic() - t0, 1)
        print(json.dumps(out, ensure_ascii=False, indent=2))
        if getattr(a, "out", None) and out.get("status") == "done":
            alto = s.get(f"{base}/v1/manuscripts/{a.slug}/pages/{a.page}/alto",
                         params={"model": a.model}, timeout=120)
            alto.raise_for_status()
            a.out.write_bytes(alto.content)
        return
    resp.raise_for_status()
    print(json.dumps(resp.json(), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
