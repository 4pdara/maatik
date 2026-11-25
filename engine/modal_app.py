"""Thin Modal wrapper around maatik_engine.

Deployed by .github/workflows/deploy-engine.yml (the cloud session cannot
reach Modal's gRPC API). After deployment everything goes through the HTTPS
API below, with `Authorization: Bearer <token>` (see maatik_engine/auth.py).

Storage: one Modal Volume, mounted at /data:
    /data/manuscripts/<slug>/pages/<nnnn>.jpg        original scan, never changed
    /data/manuscripts/<slug>/pages/<nnnn>.alto.xml   engine output (feasibility stage)
    /data/manuscripts/<slug>/runs.jsonl              every run: kind, duration, estimated cost
"""

import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path

import modal

from maatik_engine import PPOCRV6_SMALL

APP_NAME = "maatik-engine"
VOLUME_NAME = "maatik-data"
API_SECRET_NAME = "maatik-engine-api"
DATA = Path("/data")
MODEL_DIR = Path("/models/ppocrv6-small")

# Recognition worker size. Prices from modal.com/pricing, read 25.11.2026:
# CPU $0.0000131 per physical core per second, memory $0.00000222 per GiB per second.
WORKER_CPU = 2.0
WORKER_MEMORY_MIB = 4096
USD_PER_CORE_SEC = 0.0000131
USD_PER_GIB_SEC = 0.00000222

image = (
    modal.Image.debian_slim(python_version="3.12")
    .uv_pip_install(
        "torch==2.14.0",
        "torchvision==0.29.1",
        index_url="https://download.pytorch.org/whl/cpu",
    )
    .uv_pip_install("kraken==7.2", "fastapi==0.165.0", "huggingface_hub==1.16.1")
    .run_commands(
        # Python API, not the `hf` CLI: the CLI crashes on exit with kraken's pinned click.
        "python -c \"from huggingface_hub import hf_hub_download; "
        f"hf_hub_download(repo_id='{PPOCRV6_SMALL['repo']}', filename='{PPOCRV6_SMALL['filename']}', "
        f"revision='{PPOCRV6_SMALL['revision']}', local_dir='{MODEL_DIR}')\"",
        f"echo '{PPOCRV6_SMALL['sha256']}  {MODEL_DIR / PPOCRV6_SMALL['filename']}' | sha256sum -c -",
    )
    .add_local_python_source("maatik_engine")
)

app = modal.App(APP_NAME, image=image)
volume = modal.Volume.from_name(VOLUME_NAME, create_if_missing=True)

SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
MAX_IMAGE_BYTES = 40 * 1024 * 1024


def _page_dir(slug: str) -> Path:
    return DATA / "manuscripts" / slug / "pages"


def _estimate_usd(seconds: float) -> float:
    per_sec = WORKER_CPU * USD_PER_CORE_SEC + (WORKER_MEMORY_MIB / 1024) * USD_PER_GIB_SEC
    return round(seconds * per_sec, 6)


def _log_run(slug: str, record: dict) -> None:
    runs = DATA / "manuscripts" / slug / "runs.jsonl"
    runs.parent.mkdir(parents=True, exist_ok=True)
    with runs.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


@app.function(
    volumes={DATA: volume}, cpu=WORKER_CPU, memory=WORKER_MEMORY_MIB, timeout=1800
)
def recognize(slug: str, page: int) -> dict:
    from maatik_engine.recognize import recognize_page

    t0 = time.monotonic()
    volume.reload()
    pages = _page_dir(slug)
    img = pages / f"{page:04d}.jpg"
    if not img.exists():
        raise FileNotFoundError(f"{slug}/{page:04d}.jpg not found")
    record = {
        "kind": "recognize",
        "slug": slug,
        "page": page,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "worker": {"cpu": WORKER_CPU, "memory_mib": WORKER_MEMORY_MIB},
    }
    try:
        summary = recognize_page(
            img, pages / f"{page:04d}.alto.xml", MODEL_DIR / PPOCRV6_SMALL["filename"],
            threads=int(WORKER_CPU), device="cpu",
        )
        record.update(status="ok", summary=summary)
    except Exception as e:  # noqa: BLE001 - record the failure, then re-raise
        record.update(status="failed", error=str(e)[:2000])
        raise
    finally:
        seconds = round(time.monotonic() - t0, 2)
        record.update(seconds=seconds, estimated_usd=_estimate_usd(seconds))
        _log_run(slug, record)
        volume.commit()
    return record


@app.function(
    volumes={DATA: volume},
    secrets=[modal.Secret.from_name(API_SECRET_NAME, required_keys=["MAATIK_API_TOKEN"])],
    cpu=0.25,
    memory=512,
)
@modal.concurrent(max_inputs=20)
@modal.asgi_app(label="maatik-engine-api")
def api():
    import os

    from fastapi import Depends, FastAPI, HTTPException, Request
    from fastapi.responses import FileResponse, PlainTextResponse

    from maatik_engine.auth import token_matches

    expected = os.environ["MAATIK_API_TOKEN"]

    def auth(request: Request) -> None:
        header = request.headers.get("authorization", "")
        if not header.startswith("Bearer ") or not token_matches(header[7:], expected):
            raise HTTPException(status_code=401, detail="unauthorized")

    def check(slug: str, page: int) -> None:
        if not SLUG_RE.match(slug) or not (1 <= page <= 9999):
            raise HTTPException(status_code=400, detail="bad slug or page")

    web = FastAPI(dependencies=[Depends(auth)], docs_url=None, redoc_url=None, openapi_url=None)

    @web.get("/v1/health")
    def health():
        return {"ok": True}

    @web.put("/v1/manuscripts/{slug}/pages/{page}/image")
    async def put_image(slug: str, page: int, request: Request):
        check(slug, page)
        body = await request.body()
        if not body or len(body) > MAX_IMAGE_BYTES:
            raise HTTPException(status_code=413, detail="empty or too large")
        if not body.startswith(b"\xff\xd8"):
            raise HTTPException(status_code=415, detail="JPEG only for now")
        dest = _page_dir(slug) / f"{page:04d}.jpg"
        volume.reload()
        if dest.exists():
            raise HTTPException(status_code=409, detail="page exists; originals are never replaced")
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(body)
        volume.commit()
        return {"stored": f"{slug}/{page:04d}.jpg", "bytes": len(body)}

    @web.post("/v1/manuscripts/{slug}/pages/{page}/recognize")
    def start_recognize(slug: str, page: int):
        check(slug, page)
        call = recognize.spawn(slug, page)
        return {"job_id": call.object_id}

    @web.get("/v1/jobs/{job_id}")
    def job(job_id: str):
        if not re.match(r"^fc-[A-Za-z0-9]+$", job_id):
            raise HTTPException(status_code=400, detail="bad job id")
        call = modal.FunctionCall.from_id(job_id)
        try:
            return {"status": "done", "result": call.get(timeout=0)}
        except TimeoutError:
            return {"status": "running"}
        except Exception as e:  # noqa: BLE001
            return {"status": "failed", "error": str(e)[:2000]}

    @web.get("/v1/manuscripts/{slug}/pages/{page}/alto")
    def get_alto(slug: str, page: int):
        check(slug, page)
        volume.reload()
        path = _page_dir(slug) / f"{page:04d}.alto.xml"
        if not path.exists():
            raise HTTPException(status_code=404, detail="no result yet")
        return FileResponse(path, media_type="application/xml")

    @web.get("/v1/manuscripts/{slug}/runs")
    def runs(slug: str):
        if not SLUG_RE.match(slug):
            raise HTTPException(status_code=400, detail="bad slug")
        volume.reload()
        path = DATA / "manuscripts" / slug / "runs.jsonl"
        return PlainTextResponse(path.read_text(encoding="utf-8") if path.exists() else "")

    return web
