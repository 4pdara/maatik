"""Thin Modal wrapper around maatik_engine.

Deployed by .github/workflows/deploy-engine.yml (the cloud session cannot
reach Modal's gRPC API). After deployment everything goes through the HTTPS
API below, with `Authorization: Bearer <token>` (see maatik_engine/auth.py).

Storage: one Modal Volume, mounted at /data:
    /data/manuscripts/<slug>/manuscript.json         name, source, split, active_model
    /data/manuscripts/<slug>/pages/<nnnn>.jpg        original scan, never changed
    /data/manuscripts/<slug>/pages/<nnnn>.json       page JSON, the source of truth
    /data/manuscripts/<slug>/pages/<nnnn>.<model>.alto.xml   raw engine output
    /data/manuscripts/<slug>/models/v<k>/            calibrated model versions + metrics.json
    /data/manuscripts/<slug>/runs.jsonl              every run: kind, duration, estimated cost
"""

import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path

import modal

from maatik_engine import BASE_MODELS, DEFAULT_MODEL

APP_NAME = "maatik-engine"
VOLUME_NAME = "maatik-data"
API_SECRET_NAME = "maatik-engine-api"
DATA = Path("/data")
MODELS = Path("/models")
ASSETS = Path("/assets")

# Feasibility test (c) material, pinned by hash.
# CC0 text lines (Tsel HaOlam, Amsterdam 1733), HeOCR htext release on Zenodo 24521432.
TSEL_ZIP_URL = "https://zenodo.org/records/24521432/files/htext-tsel-haolam-v1.zip?download=1"
TSEL_ZIP_SHA256 = "c3fa59e87e4d7cfcf5d069a0add9a4b811dff9cfb08cbb8d65e60f6b7024c39b"
# Frank Ruhl Libre Regular (SIL OFL 1.1) from Google Fonts, used only to render those lines.
FONT_URL = "https://fonts.gstatic.com/s/frankruhllibre/v23/j8_96_fAw7jrcalD7oKYNX0QfAnPcbzNEEB7OoicBw7FYVqQ.ttf"
FONT_SHA256 = "89478e290c257456eb61d846bea77ab06d944f09c7f84000c4fd8cdedde6845a"

# Recognition worker size. Prices from modal.com/pricing, read 25.11.2026:
# CPU $0.0000131 per physical core per second, memory $0.00000222 per GiB per second.
WORKER_CPU = 2.0
WORKER_MEMORY_MIB = 4096
# Calibration (training) worker.
TRAIN_CPU = 8.0
TRAIN_MEMORY_MIB = 8192
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
        *[
            cmd
            for key, m in BASE_MODELS.items()
            for cmd in (
                # Python API, not the `hf` CLI: the CLI crashes on exit with kraken's pinned click.
                "python -c \"from huggingface_hub import hf_hub_download; "
                f"hf_hub_download(repo_id='{m['repo']}', filename='{m['filename']}', "
                f"revision='{m['revision']}', local_dir='{MODELS / key}')\"",
                f"echo '{m['sha256']}  {MODELS / key / m['filename']}' | sha256sum -c -",
            )
        ]
    )
    .apt_install("libfribidi0", "curl")
    .run_commands(
        f"mkdir -p {ASSETS}",
        f"curl -sSfL -o {ASSETS}/tsel.zip '{TSEL_ZIP_URL}'",
        f"echo '{TSEL_ZIP_SHA256}  {ASSETS}/tsel.zip' | sha256sum -c -",
        f"curl -sSfL -o {ASSETS}/FrankRuhlLibre-Regular.ttf '{FONT_URL}'",
        f"echo '{FONT_SHA256}  {ASSETS}/FrankRuhlLibre-Regular.ttf' | sha256sum -c -",
    )
    .add_local_python_source("maatik_engine")
)

app = modal.App(APP_NAME, image=image)
volume = modal.Volume.from_name(VOLUME_NAME, create_if_missing=True)

SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
MAX_IMAGE_BYTES = 40 * 1024 * 1024


def _page_dir(slug: str) -> Path:
    return DATA / "manuscripts" / slug / "pages"


def _estimate_usd(seconds: float, cpu: float = WORKER_CPU, memory_mib: int = WORKER_MEMORY_MIB) -> float:
    per_sec = cpu * USD_PER_CORE_SEC + (memory_mib / 1024) * USD_PER_GIB_SEC
    return round(seconds * per_sec, 6)


def _log_run(slug: str, record: dict, *, path: Path | None = None) -> None:
    runs = path or DATA / "manuscripts" / slug / "runs.jsonl"
    runs.parent.mkdir(parents=True, exist_ok=True)
    with runs.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def _start_run(slug: str, record: dict, *, path: Path | None = None) -> None:
    """Log the start right away, so a run killed by a timeout still leaves a trace."""
    import uuid

    record.setdefault("run_id", uuid.uuid4().hex[:12])
    _log_run(slug, dict(record, status="started"), path=path)
    volume.commit()


def _ms_dir(slug: str) -> Path:
    return DATA / "manuscripts" / slug


def _read_json(p: Path, default=None):
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else default


def _write_json(p: Path, data) -> None:
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(p)


def _page_is_untouched(page: dict | None) -> bool:
    return page is None or (not page.get("removed_lines")
                            and all(l["status"] == "pending" and l["source"] == "engine" for l in page["lines"]))


def _untouched_pages(slug: str) -> list[int]:
    """Pages with a scan whose page JSON is missing or has no human work in it."""
    return [int(img.stem) for img in sorted(_page_dir(slug).glob("[0-9][0-9][0-9][0-9].jpg"))
            if _page_is_untouched(_read_json(img.with_suffix(".json")))]


def _approved_train_lines(slug: str) -> int:
    """Approved lines on training pages: what the next calibration would learn from."""
    m = _read_json(_ms_dir(slug) / "manuscript.json", {})
    test = set((m.get("split") or {}).get("test", []))
    n = 0
    for f in _page_dir(slug).glob("[0-9][0-9][0-9][0-9].json"):
        if int(f.stem) in test:
            continue
        pg = _read_json(f) or {"lines": []}
        n += sum(l["status"] == "approved" and l["text"].strip() != "" for l in pg["lines"])
    return n


def _training_progress(slug: str) -> list[dict]:
    """Epochs finished by a calibration that is still running, read from the
    checkpoint files ketos writes (checkpoint_<epoch>-<validation accuracy>.ckpt)."""
    models = _ms_dir(slug) / "models"
    running = [v for v in models.glob("v*") if v.is_dir() and not (v / "metrics.json").exists()]
    if not running:
        return []
    v = max(running, key=lambda p: int(p.name[1:]) if p.name[1:].isdigit() else 0)
    out = []
    for f in v.glob("checkpoint_*.ckpt"):
        m = re.match(r"checkpoint_(\d+)-([0-9.]+)\.ckpt$", f.name)
        if m:
            out.append({"epoch": int(m.group(1)) + 1, "val_accuracy": float(m.group(2))})
    return sorted(out, key=lambda e: e["epoch"])


@app.function(
    volumes={DATA: volume}, cpu=WORKER_CPU, memory=WORKER_MEMORY_MIB, timeout=1800
)
def recognize(slug: str, page: int, model: str = "active") -> dict:
    """Recognise one page. model: a base model key, or "active" (the manuscript's
    calibrated model if there is one, else the default base model). Writes the
    page JSON unless someone has already worked on that page."""
    from maatik_engine import pagejson as pj
    from maatik_engine.calibrate import active_model_path
    from maatik_engine.recognize import recognize_page

    t0 = time.monotonic()
    volume.reload()
    pages = _page_dir(slug)
    img = pages / f"{page:04d}.jpg"
    if not img.exists():
        raise FileNotFoundError(f"{slug}/{page:04d}.jpg not found")
    if model == "active":
        manuscript = _read_json(_ms_dir(slug) / "manuscript.json", {})
        weights, name = active_model_path(_ms_dir(slug), manuscript,
                                          MODELS / DEFAULT_MODEL / BASE_MODELS[DEFAULT_MODEL]["filename"])
        model_version = name if name != "base" else f"base:{DEFAULT_MODEL}"
        alto_name = f"{page:04d}.active.alto.xml"
    elif model in BASE_MODELS:
        weights, model_version = MODELS / model / BASE_MODELS[model]["filename"], f"base:{model}"
        alto_name = f"{page:04d}.{model}.alto.xml"
    else:
        raise ValueError(f"unknown model {model}")
    record = {
        "kind": "recognize",
        "slug": slug,
        "page": page,
        "model": model_version,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "worker": {"cpu": WORKER_CPU, "memory_mib": WORKER_MEMORY_MIB},
    }
    _start_run(slug, record)
    try:
        summary = recognize_page(img, pages / alto_name, weights, threads=int(WORKER_CPU), device="cpu")
        page_json = pages / f"{page:04d}.json"
        if model == "active" or not page_json.exists():
            current = _read_json(page_json)
            if _page_is_untouched(current):
                new = pj.from_kraken_alto((pages / alto_name).read_text(encoding="utf-8"),
                                          img.name, model_version)
                if current:
                    new["revision"] = current["revision"] + 1
                _write_json(page_json, new)
                summary["page_json"] = "written"
            else:
                summary["page_json"] = "kept (page already proofread)"
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
    volumes={DATA: volume}, cpu=WORKER_CPU, memory=WORKER_MEMORY_MIB, timeout=3600
)
def feasibility_c(model: str, n_lines: int = 60, epochs: int = 2) -> dict:
    """Short ketos fine-tune from a base model on rendered CC0 lines."""
    import tempfile
    import zipfile

    from maatik_engine.synth import render_lines
    from maatik_engine.train import finetune

    if model not in BASE_MODELS:
        raise ValueError(f"unknown model {model}")
    t0 = time.monotonic()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = DATA / "feasibility" / "c" / f"{stamp}-{model}"
    record = {"kind": "feasibility-c", "model": model, "lines": n_lines, "epochs": epochs,
              "started_at": datetime.now(timezone.utc).isoformat(),
              "worker": {"cpu": WORKER_CPU, "memory_mib": WORKER_MEMORY_MIB}}
    try:
        with tempfile.TemporaryDirectory() as tmp:
            text = zipfile.ZipFile(ASSETS / "tsel.zip").read("plain.txt").decode("utf-8")
            lines = [l for l in text.splitlines() if len(l.split()) >= 3][:n_lines]
            imgs = render_lines(lines, Path(tmp) / "lines", ASSETS / "FrankRuhlLibre-Regular.ttf")
            result = finetune(MODELS / model / BASE_MODELS[model]["filename"], imgs, out,
                              epochs=epochs, threads=int(WORKER_CPU))
        for ckpt in out.glob("*.ckpt"):
            ckpt.unlink()  # keep only the exported weights on the volume
        record.update(status="ok" if result["exit_code"] == 0 and result["weights"] else "failed",
                      result=result, output=str(out))
    except Exception as e:  # noqa: BLE001
        record.update(status="failed", error=str(e)[:2000])
        raise
    finally:
        seconds = round(time.monotonic() - t0, 2)
        record.update(seconds=seconds, estimated_usd=_estimate_usd(seconds))
        runs = DATA / "feasibility" / "runs.jsonl"
        runs.parent.mkdir(parents=True, exist_ok=True)
        with runs.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
        volume.commit()
    return record


@app.function(volumes={DATA: volume}, cpu=TRAIN_CPU, memory=TRAIN_MEMORY_MIB, timeout=3 * 3600)
def calibrate_manuscript(slug: str, epochs: int = 6, n_test: int = 3) -> dict:
    """"Improve the model": train a new version from this manuscript's approved lines."""
    from maatik_engine.calibrate import calibrate

    t0 = time.monotonic()
    volume.reload()
    record = {"kind": "calibrate", "slug": slug, "started_at": datetime.now(timezone.utc).isoformat(),
              "worker": {"cpu": TRAIN_CPU, "memory_mib": TRAIN_MEMORY_MIB}, "max_epochs": epochs}
    _start_run(slug, record)
    try:
        metrics = calibrate(_ms_dir(slug), MODELS / DEFAULT_MODEL / BASE_MODELS[DEFAULT_MODEL]["filename"],
                            n_test=n_test, epochs=epochs, threads=int(TRAIN_CPU) - 2, workers=2)
        record.update(status="ok", metrics=metrics)
        if metrics.get("promoted"):
            # The new model is better: read again every page nobody has worked on yet.
            volume.commit()
            pages = _untouched_pages(slug)
            for n in pages:
                recognize.spawn(slug, n, "active")
            record["rerecognize_pages"] = pages
    except Exception as e:  # noqa: BLE001
        record.update(status="failed", error=str(e)[:2000])
        raise
    finally:
        seconds = round(time.monotonic() - t0, 2)
        record.update(seconds=seconds, estimated_usd=_estimate_usd(seconds, TRAIN_CPU, TRAIN_MEMORY_MIB))
        _log_run(slug, record)
        volume.commit()
    return record


@app.function(volumes={DATA: volume}, cpu=TRAIN_CPU, memory=TRAIN_MEMORY_MIB, timeout=3 * 3600)
def e2e_synthetic(pages: int = 8, n_test: int = 2, epochs: int = 10) -> dict:
    """Whole pipeline on a synthetic manuscript with known truth (see maatik_engine/e2e.py)."""
    import zipfile

    from maatik_engine.e2e import run

    t0 = time.monotonic()
    slug = "synthetic-tsel-" + datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    record = {"kind": "e2e-synthetic", "slug": slug, "pages": pages, "started_at": datetime.now(timezone.utc).isoformat(),
              "worker": {"cpu": TRAIN_CPU, "memory_mib": TRAIN_MEMORY_MIB}}
    _start_run(slug, record)
    try:
        text = zipfile.ZipFile(ASSETS / "tsel.zip").read("plain.txt").decode("utf-8").splitlines()
        report = run(_ms_dir(slug), text, ASSETS / "FrankRuhlLibre-Regular.ttf",
                     MODELS / DEFAULT_MODEL / BASE_MODELS[DEFAULT_MODEL]["filename"],
                     pages=pages, n_test=n_test, epochs=epochs, threads=int(TRAIN_CPU))
        report["calibration"]["training"].pop("log_tail", None)
        record.update(status="ok", calibration=report["calibration"])
    except Exception as e:  # noqa: BLE001
        record.update(status="failed", error=str(e)[:2000])
        raise
    finally:
        seconds = round(time.monotonic() - t0, 2)
        record.update(seconds=seconds, estimated_usd=_estimate_usd(seconds, TRAIN_CPU, TRAIN_MEMORY_MIB))
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
    def start_recognize(slug: str, page: int, model: str = "active"):
        check(slug, page)
        if model != "active" and model not in BASE_MODELS:
            raise HTTPException(status_code=400, detail="unknown model")
        call = recognize.spawn(slug, page, model)
        return {"job_id": call.object_id}

    def check_slug(slug: str) -> None:
        if not SLUG_RE.match(slug):
            raise HTTPException(status_code=400, detail="bad slug")

    def job_state(job_id: str) -> dict:
        call = modal.FunctionCall.from_id(job_id)
        try:
            return {"status": "done", "result": call.get(timeout=0)}
        except TimeoutError:
            return {"status": "running"}
        except Exception as e:  # noqa: BLE001
            return {"status": "failed", "error": str(e)[:2000]}

    @web.get("/v1/manuscripts/{slug}")
    def get_manuscript(slug: str):
        check_slug(slug)
        volume.reload()
        d = _ms_dir(slug)
        if not d.exists():
            raise HTTPException(status_code=404, detail="no such manuscript")
        m = _read_json(d / "manuscript.json", {})
        return {"slug": slug, "name": m.get("name"), "source": m.get("source"),
                "active_model": m.get("active_model"), "split": m.get("split"),
                "page_labels": m.get("page_labels", {})}

    @web.put("/v1/manuscripts/{slug}/meta")
    async def put_meta(slug: str, request: Request):
        """Set the display name and page labels (e.g. folio numbers). Nothing else."""
        check_slug(slug)
        body = await request.json()
        volume.reload()
        path = _ms_dir(slug) / "manuscript.json"
        if not _ms_dir(slug).exists():
            raise HTTPException(status_code=404, detail="no such manuscript")
        m = _read_json(path, {})
        if "name" in body:
            if not isinstance(body["name"], str) or not (1 <= len(body["name"]) <= 200):
                raise HTTPException(status_code=422, detail="bad name")
            m["name"] = body["name"]
        if "page_labels" in body:
            labels = body["page_labels"]
            if not isinstance(labels, dict) or not all(
                    str(k).isdigit() and isinstance(v, str) and len(v) <= 40 for k, v in labels.items()):
                raise HTTPException(status_code=422, detail="bad page_labels")
            m["page_labels"] = {str(int(k)): v for k, v in labels.items()}
        _write_json(path, m)
        volume.commit()
        return {"name": m.get("name"), "page_labels": m.get("page_labels", {})}

    @web.post("/v1/manuscripts/{slug}/recognize-all")
    def recognize_all(slug: str):
        """Recognise every page nobody has worked on yet, with the active model."""
        check_slug(slug)
        volume.reload()
        pages = _untouched_pages(slug)
        jobs = {str(n): recognize.spawn(slug, n, "active").object_id for n in pages}
        return {"pages": pages, "jobs": jobs}

    @web.get("/v1/manuscripts/{slug}/training")
    def training(slug: str):
        """State of "improve the model": the running or last job, its epochs so far,
        and how many approved lines were added since the last trained version."""
        check_slug(slug)
        volume.reload()
        d = _ms_dir(slug)
        t = _read_json(d / "training.json")
        versions = [_read_json(v / "metrics.json") for v in (d / "models").glob("v*")]
        versions = [v for v in versions if v]
        last = max(versions, key=lambda v: int(v["version"][1:]), default=None)
        out = {"approved_train_lines": _approved_train_lines(slug),
               "last_trained_lines": last["train_lines"] if last else 0,
               "last_version": last["version"] if last else None,
               "job": None}
        if t:
            state = job_state(t["job_id"])
            if state["status"] == "done":
                state["result"] = {k: state["result"].get(k) for k in ("status", "metrics", "seconds", "estimated_usd",
                                                                       "rerecognize_pages")}
                (state["result"].get("metrics") or {}).get("training", {}).pop("log_tail", None)
            out["job"] = dict(t, **state)
            if state["status"] == "running":
                out["job"]["epochs_done"] = _training_progress(slug)
        return out

    @web.get("/v1/manuscripts/{slug}/export.txt")
    def export_txt(slug: str, approved_only: bool = False):
        """The whole manuscript as plain text, page by page, in reading order."""
        from maatik_engine import pagejson as pj

        check_slug(slug)
        volume.reload()
        m = _read_json(_ms_dir(slug) / "manuscript.json", {})
        labels = m.get("page_labels", {})
        parts = []
        for f in sorted(_page_dir(slug).glob("[0-9][0-9][0-9][0-9].json")):
            n = int(f.stem)
            head = f"עמוד {n}" + (f" ({labels[str(n)]})" if str(n) in labels else "")
            parts.append(head + "\n" + pj.page_text(_read_json(f), approved_only=approved_only))
        return PlainTextResponse("\n\n".join(parts) + "\n")

    @web.post("/v1/manuscripts/{slug}/pages/{page}/reading-order")
    def fix_reading_order(slug: str, page: int):
        """Put the page's lines in reading order (right column before left). Text and
        approvals are untouched; only the order changes."""
        from maatik_engine.layout import reading_order

        check(slug, page)
        volume.reload()
        path = _page_dir(slug) / f"{page:04d}.json"
        pg = _read_json(path)
        if pg is None:
            raise HTTPException(status_code=404, detail="page not recognised yet")
        before = [l["id"] for l in sorted(pg["lines"], key=lambda l: l["order"])]
        pg["lines"] = reading_order(sorted(pg["lines"], key=lambda l: l["order"]))
        changed = before != [l["id"] for l in pg["lines"]]
        if changed:
            pg["revision"] += 1
            _write_json(path, pg)
            volume.commit()
        return {"changed": changed, "revision": pg["revision"]}

    @web.get("/v1/manuscripts")
    def list_manuscripts():
        volume.reload()
        root = DATA / "manuscripts"
        out = []
        for d in sorted(root.iterdir()) if root.exists() else []:
            if d.is_dir() and SLUG_RE.match(d.name):
                m = _read_json(d / "manuscript.json", {})
                out.append({"slug": d.name, "name": m.get("name"), "active_model": m.get("active_model"),
                            "pages": len(list((d / "pages").glob("[0-9][0-9][0-9][0-9].jpg")))})
        return out

    @web.get("/v1/manuscripts/{slug}/pages")
    def list_pages(slug: str):
        check(slug, 1)
        volume.reload()
        m = _read_json(_ms_dir(slug) / "manuscript.json", {})
        labels = m.get("page_labels", {})
        test = set((m.get("split") or {}).get("test", []))
        out = []
        for img in sorted(_page_dir(slug).glob("[0-9][0-9][0-9][0-9].jpg")):
            pg = _read_json(img.with_suffix(".json"))
            lines = pg["lines"] if pg else []
            n = int(img.stem)
            out.append({"page": n, "label": labels.get(str(n)), "test": n in test,
                        "recognized": pg is not None, "lines": len(lines),
                        "approved": sum(l["status"] == "approved" for l in lines),
                        "revision": pg["revision"] if pg else None})
        return out

    @web.get("/v1/manuscripts/{slug}/pages/{page}")
    def get_page(slug: str, page: int):
        check(slug, page)
        volume.reload()
        pg = _read_json(_page_dir(slug) / f"{page:04d}.json")
        if pg is None:
            raise HTTPException(status_code=404, detail="page not recognised yet")
        return pg

    @web.put("/v1/manuscripts/{slug}/pages/{page}")
    async def put_page(slug: str, page: int, request: Request):
        """Save a page. The body's revision must equal the stored one (no lost updates)."""
        check(slug, page)
        body = await request.json()
        path = _page_dir(slug) / f"{page:04d}.json"
        volume.reload()
        current = _read_json(path)
        if current is None:
            raise HTTPException(status_code=404, detail="page not recognised yet")
        if body.get("revision") != current["revision"]:
            raise HTTPException(status_code=409, detail={"message": "page changed since you loaded it",
                                                         "revision": current["revision"]})
        if body.get("schema_version") != 1 or not isinstance(body.get("lines"), list):
            raise HTTPException(status_code=422, detail="not a schema 1 page")
        from maatik_engine import pagejson as pj

        old = {l["id"]: l for l in current["lines"]}
        # Lines deleted in the editor are kept aside, so an undo restores them exactly
        # (with what the engine read), instead of coming back as new manual lines.
        removed = {l["id"]: l for l in current.get("removed_lines", [])}
        known = {**removed, **old}
        W, H = current["image"]["width"], current["image"]["height"]
        lines, seen = [], set()
        for l in body["lines"]:
            if not isinstance(l, dict):
                raise HTTPException(status_code=422, detail="bad line")
            if l.get("id") in known:
                # Geometry and origin of a known line come from the stored page, not the client.
                o = known[l["id"]]
                l = dict(l, source=o["source"], baseline=o["baseline"], boundary=o["boundary"])
            problem = pj.check_line(l, W, H)
            if problem or l["id"] in seen:
                raise HTTPException(status_code=422, detail=f"{problem or 'duplicate id'} on line {l.get('id')}")
            seen.add(l["id"])
            if l["id"] in known:
                # What the engine read (text, words, confidences, model) is never changed by a save.
                o = known[l["id"]]
                l = dict(l, text=pj._nfc(l["text"]), engine_text=o["engine_text"], words=o["words"],
                         llm=o["llm"], source=o["source"], model_version=o["model_version"])
                l = {k: l[k] for k in o}
            else:
                l = pj.manual_line(l)
            lines.append(l)
        lines.sort(key=lambda l: l["order"])
        for i, l in enumerate(lines):
            l["order"] = i
        body = {"schema_version": 1, "revision": current["revision"] + 1, "image": current["image"], "lines": lines,
                "removed_lines": [l for i, l in known.items() if i not in seen][-500:]}
        _write_json(path, body)
        volume.commit()
        return {"revision": body["revision"]}

    @web.get("/v1/manuscripts/{slug}/pages/{page}/image")
    def get_image(slug: str, page: int):
        check(slug, page)
        path = _page_dir(slug) / f"{page:04d}.jpg"
        # Scans never change, so reload the volume only for a scan this container has not seen.
        # (Reloading on every request, with several requests in flight, made files look missing.)
        if not path.exists():
            volume.reload()
        if not path.exists():
            raise HTTPException(status_code=404, detail="no such page")
        return FileResponse(path, media_type="image/jpeg")

    @web.get("/v1/manuscripts/{slug}/pages/{page}/thumb")
    def get_thumb(slug: str, page: int):
        """A small copy of the scan for page lists (made once, kept next to the scan)."""
        from PIL import Image

        check(slug, page)
        src = _page_dir(slug) / f"{page:04d}.jpg"
        thumb = _page_dir(slug) / f"{page:04d}.thumb.jpg"
        if thumb.exists():
            return FileResponse(thumb, media_type="image/jpeg")
        if not src.exists():
            volume.reload()
        if not src.exists():
            raise HTTPException(status_code=404, detail="no such page")
        if not thumb.exists():
            with Image.open(src) as im:
                im.thumbnail((360, 540))
                im.convert("RGB").save(thumb, "JPEG", quality=80)
            volume.commit()
        return FileResponse(thumb, media_type="image/jpeg")

    @web.post("/v1/manuscripts/{slug}/calibrate")
    def start_calibrate(slug: str, epochs: int = 6):
        check(slug, 1)
        if not (1 <= epochs <= 60):
            raise HTTPException(status_code=400, detail="epochs 1..60")
        volume.reload()
        tpath = _ms_dir(slug) / "training.json"
        t = _read_json(tpath)
        if t and job_state(t["job_id"])["status"] == "running":
            raise HTTPException(status_code=409, detail={"message": "a training run is already going",
                                                         "job_id": t["job_id"]})
        call = calibrate_manuscript.spawn(slug, epochs)
        _write_json(tpath, {"job_id": call.object_id, "epochs": epochs,
                            "started_at": datetime.now(timezone.utc).isoformat()})
        volume.commit()
        return {"job_id": call.object_id}

    @web.get("/v1/manuscripts/{slug}/models")
    def list_models(slug: str):
        check(slug, 1)
        volume.reload()
        d = _ms_dir(slug)
        m = _read_json(d / "manuscript.json", {})
        versions = []
        for v in sorted((d / "models").glob("v*"), key=lambda p: int(p.name[1:]) if p.name[1:].isdigit() else 0):
            met = _read_json(v / "metrics.json")
            if met:
                met.get("training", {}).pop("log_tail", None)
                versions.append(met)
        return {"active_model": m.get("active_model"), "split": m.get("split"), "versions": versions}

    @web.get("/v1/storage")
    def storage():
        """Read-only: bytes on the volume per top-level area and per manuscript, and leftovers."""
        volume.reload()

        def size(p: Path) -> int:
            return sum(f.stat().st_size for f in p.rglob("*") if f.is_file()) if p.exists() else 0

        areas = {d.name: size(d) for d in DATA.iterdir() if d.is_dir()} if DATA.exists() else {}
        manuscripts = {}
        for d in sorted((DATA / "manuscripts").iterdir()) if (DATA / "manuscripts").exists() else []:
            if d.is_dir():
                manuscripts[d.name] = {"total": size(d), "models": size(d / "models"),
                                       "model_versions": len(list((d / "models").glob("v*")))}
        ckpts = [{"path": str(f.relative_to(DATA)), "bytes": f.stat().st_size}
                 for f in DATA.rglob("*.ckpt")] if DATA.exists() else []
        return {"total": sum(areas.values()), "areas": areas, "manuscripts": manuscripts,
                "leftover_checkpoints": ckpts}

    @web.post("/v1/storage/delete-leftover-checkpoints")
    def delete_leftover_checkpoints():
        """Delete only *.ckpt files (intermediate training state left by an interrupted
        run). Scans, page JSON, ALTO and exported model weights are never touched."""
        volume.reload()
        deleted = []
        for f in list(DATA.rglob("*.ckpt")) if DATA.exists() else []:
            if f.is_file() and f.suffix == ".ckpt":
                deleted.append({"path": str(f.relative_to(DATA)), "bytes": f.stat().st_size})
                f.unlink()
        volume.commit()
        return {"deleted": deleted, "bytes_freed": sum(d["bytes"] for d in deleted)}

    @web.post("/v1/e2e/synthetic")
    def start_e2e(pages: int = 8, n_test: int = 2, epochs: int = 10):
        if not (4 <= pages <= 20) or not (1 <= n_test < pages) or not (1 <= epochs <= 30):
            raise HTTPException(status_code=400, detail="bad parameters")
        call = e2e_synthetic.spawn(pages, n_test, epochs)
        return {"job_id": call.object_id}

    @web.post("/v1/feasibility/c")
    def start_feasibility_c(model: str = DEFAULT_MODEL, lines: int = 60, epochs: int = 2):
        if model not in BASE_MODELS or not (10 <= lines <= 500) or not (1 <= epochs <= 5):
            raise HTTPException(status_code=400, detail="bad parameters")
        call = feasibility_c.spawn(model, lines, epochs)
        return {"job_id": call.object_id}

    @web.get("/v1/jobs/{job_id}")
    def job(job_id: str):
        if not re.match(r"^fc-[A-Za-z0-9]+$", job_id):
            raise HTTPException(status_code=400, detail="bad job id")
        return job_state(job_id)

    @web.get("/v1/manuscripts/{slug}/pages/{page}/alto")
    def get_alto(slug: str, page: int, model: str = DEFAULT_MODEL):
        check(slug, page)
        if model != "active" and model not in BASE_MODELS:
            raise HTTPException(status_code=400, detail="unknown model")
        volume.reload()
        path = _page_dir(slug) / f"{page:04d}.{model}.alto.xml"
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
