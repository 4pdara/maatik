"""Continue training (fine-tune) a recognition model with ketos.

Never overwrites: every run writes into its own new output directory.
"""

from __future__ import annotations

import subprocess
import time
from pathlib import Path


def finetune(
    base_model: Path,
    line_images: list[Path],
    out_dir: Path,
    *,
    epochs: int = 3,
    batch_size: int = 8,
    threads: int = 2,
    device: str = "cpu",
    lrate: float | None = None,
) -> dict:
    if out_dir.exists() and any(out_dir.iterdir()):
        raise FileExistsError(f"{out_dir} is not empty; a model is never overwritten")
    out_dir.mkdir(parents=True, exist_ok=True)
    cmd = [
        "ketos", "-d", device, "--threads", str(threads), "--workers", "0",
        "train", "-f", "path", "-i", str(base_model), "--resize", "union",
        "-u", "NFD", "--base-dir", "R",
        "-q", "fixed", "-N", str(epochs), "-B", str(batch_size),
        "-o", str(out_dir),
    ]
    if lrate is not None:
        cmd += ["-r", str(lrate)]
    cmd += [str(p) for p in line_images]
    t0 = time.monotonic()
    proc = subprocess.run(cmd, capture_output=True, text=True)
    seconds = round(time.monotonic() - t0, 2)
    log = (proc.stdout + "\n" + proc.stderr)[-6000:]
    (out_dir / "ketos.log").write_text(log, encoding="utf-8")
    weights = sorted(p.name for p in out_dir.glob("*.safetensors"))
    result = {
        "exit_code": proc.returncode,
        "seconds": seconds,
        "epochs": epochs,
        "lines": len(line_images),
        "weights": weights,
    }
    if proc.returncode != 0 or not weights:
        result["log_tail"] = log[-2000:]
    return result
