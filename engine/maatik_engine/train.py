"""Continue training (fine-tune) a recognition model with ketos.

Never overwrites: every run writes into its own new output directory.
"""

from __future__ import annotations

import subprocess
import time
from pathlib import Path


def finetune(
    base_model: Path,
    train_files: list[Path],
    out_dir: Path,
    *,
    fmt: str = "path",
    eval_files: list[Path] | None = None,
    epochs: int = 3,
    min_epochs: int | None = None,
    lag: int = 3,
    batch_size: int = 8,
    accumulate: int = 1,
    threads: int = 2,
    device: str = "cpu",
    lrate: float | None = None,
    augment: bool = False,
) -> dict:
    """fmt 'path': line images with .gt.txt; fmt 'alto': page ALTO files.

    With min_epochs set, training stops early (after at least min_epochs) when
    validation stops improving for `lag` epochs, and runs at most `epochs`.
    """
    if out_dir.exists() and any(out_dir.iterdir()):
        raise FileExistsError(f"{out_dir} is not empty; a model is never overwritten")
    out_dir.mkdir(parents=True, exist_ok=True)
    cmd = [
        "ketos", "-d", device, "--threads", str(threads), "--workers", "0",
        "train", "-f", fmt, "-i", str(base_model), "--resize", "union",
        "-u", "NFD", "--base-dir", "R", "-N", str(epochs), "-B", str(batch_size),
        "--accumulate-grad-batches", str(accumulate), "-o", str(out_dir),
    ]
    # Open problem (STATUS.md): fine-tuned on little data with B=8, ppocrv6 learned to
    # rely on in-batch padding and read single lines badly (synthetic handwriting-style
    # test: CER 54% at B=1 vs 12% at B=32). B=1 training was worse (BatchNorm on one
    # line; val accuracy 16%). Recipe still to be found; evaluation stays at B=1,
    # which is how pages are recognised, and the promotion rule blocks bad versions.
    if min_epochs is None:
        cmd += ["-q", "fixed"]
    else:
        # ppocrv6 defaults to a cosine schedule, which needs a known number of steps
        # and crashes (OverflowError) under early stopping; use a constant rate there.
        cmd += ["-q", "early", "--min-epochs", str(min_epochs), "--lag", str(lag),
                "--schedule", "constant"]
    if lrate is not None:
        cmd += ["-r", str(lrate)]
    if augment:
        cmd += ["--augment"]
    if eval_files:
        listing = out_dir / "eval_files.txt"
        listing.write_text("\n".join(str(p) for p in eval_files) + "\n", encoding="utf-8")
        cmd += ["-e", str(listing)]
    cmd += [str(p) for p in train_files]
    t0 = time.monotonic()
    proc = subprocess.run(cmd, capture_output=True, text=True)
    seconds = round(time.monotonic() - t0, 2)
    log = (proc.stdout + "\n" + proc.stderr)[-6000:]
    (out_dir / "ketos.log").write_text(log, encoding="utf-8")
    for ckpt in out_dir.glob("*.ckpt"):
        ckpt.unlink()  # keep only exported weights
    weights = sorted(p.name for p in out_dir.glob("*.safetensors"))
    result = {
        "exit_code": proc.returncode,
        "seconds": seconds,
        "max_epochs": epochs,
        "files": len(train_files),
        "weights": weights,
    }
    if proc.returncode != 0 or not weights:
        result["log_tail"] = log[-2000:]
    return result


def best_weights(out_dir: Path) -> Path | None:
    """ketos names the exported model best_<score>.safetensors; take the highest."""
    best = sorted(out_dir.glob("best_*.safetensors"),
                  key=lambda p: float(p.stem.split("_", 1)[1]) if p.stem.split("_", 1)[1].replace(".", "", 1).isdigit() else -1)
    return best[-1] if best else None
