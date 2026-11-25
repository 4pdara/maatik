"""maatik-engine command line.

    maatik-engine recognize PAGE.jpg OUT.alto.xml --model small.safetensors
"""

import argparse
import json
from pathlib import Path

from .recognize import recognize_page


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="maatik-engine")
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("recognize", help="segment and recognise one page")
    r.add_argument("image", type=Path)
    r.add_argument("out_alto", type=Path)
    r.add_argument("--model", type=Path, required=True)
    r.add_argument("--threads", type=int, default=2)
    r.add_argument("--device", default="cpu")
    args = p.parse_args(argv)

    if args.cmd == "recognize":
        summary = recognize_page(
            args.image, args.out_alto, args.model, threads=args.threads, device=args.device
        )
        print(json.dumps(summary, ensure_ascii=False, indent=2))
