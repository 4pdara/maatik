"use client";

import { useEffect, useRef, useState } from "react";
import type { Line, Page } from "@/lib/types";
import { REGION_LABEL, UNSURE_BELOW } from "@/lib/types";
import { lineBox } from "@/lib/geometry";
import { MarkedText, doubtfulWords } from "./doubt";

/** Line over line: every line cut from the scan, with its transcription right under it. */
export function LineCards({ src, page, kinds, activeId, onPick, editor }: {
  src: string; page: Page; kinds: Map<string, "full" | "R" | "L">; activeId: string | null;
  onPick: (id: string) => void; editor: React.ReactNode;
}) {
  const img = useLoadedImage(src);
  useEffect(() => {
    const el = document.querySelector<HTMLElement>(`[data-card="${activeId}"]`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.top < 100 || r.top > innerHeight - 200) scrollBy({ top: r.top - 120, behavior: "smooth" });
  }, [activeId]);

  let prev: string | null = null;
  return (
    <div className="mx-auto grid max-w-[1000px] gap-3">
      {page.lines.map((l, i) => {
        const k = kinds.get(l.id) ?? "full";
        const head = k !== prev && (k === "R" || k === "L") ? (k === "R" ? "טור ימין" : "טור שמאל") : null;
        prev = k;
        const on = l.id === activeId;
        return (
          <div key={l.id} className="grid gap-3">
            {head && <div className="mt-2 border-t border-line pt-3 text-[15px] text-muted">{head}</div>}
            <article data-card={l.id} onClick={() => !on && onPick(l.id)}
                     className={`grid gap-2 border bg-surface px-3.5 py-2.5 ${on ? "border-2 border-accent bg-white" : "cursor-pointer border-line"}`}>
              <div className="flex flex-wrap items-baseline gap-3">
                <span className="num text-[15px] text-muted">שורה {i + 1}</span>
                {l.region !== "main" && <span className="chip">{REGION_LABEL[l.region]}</span>}
                <span className="flex-1" />
                <span className={l.status === "approved" ? "chip chip-ok" : "chip"}>{l.status === "approved" ? "מאושרת" : "טרם הוגהה"}</span>
              </div>
              <div className="flex justify-center bg-scan p-1.5">
                {img ? <LineCrop img={img} line={l} /> : <div className="h-12" />}
              </div>
              {on ? <div className="grid gap-3">{editor}</div> : (
                <div className={`font-text text-[22px] leading-[34px] ${l.status === "approved" ? "text-ink" : "text-muted"}`}>
                  <MarkedText line={l} />
                </div>
              )}
            </article>
          </div>
        );
      })}
    </div>
  );
}

function useLoadedImage(src: string): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    const i = new Image();
    i.src = src;
    i.decode().then(() => setImg(i)).catch(() => setImg(null));
  }, [src]);
  return img;
}

function LineCrop({ img, line }: { img: HTMLImageElement; line: Line }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const pad = 8;
    const b = lineBox(line);
    const sx = Math.max(0, b.x - pad), sy = Math.max(0, b.y - pad);
    const sw = Math.min(img.naturalWidth - sx, b.w + 2 * pad), sh = Math.min(img.naturalHeight - sy, b.h + 2 * pad);
    const avail = c.parentElement ? c.parentElement.clientWidth - 12 : 800;
    const scale = Math.min(avail / sw, 80 / sh, 2);
    const dpr = Math.min(devicePixelRatio || 1, 2);
    c.width = Math.round(sw * scale * dpr);
    c.height = Math.round(sh * scale * dpr);
    setWidth(Math.round(sw * scale));
    const g = c.getContext("2d")!;
    g.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    g.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    if (doubtfulWords(line).length) {
      g.strokeStyle = getComputedStyle(c).getPropertyValue("--doubt-line") || "#8a5a00";
      g.lineWidth = 2 / scale;
      for (const w of line.words) {
        if (w.box && (w.confidence ?? 1) < UNSURE_BELOW) g.strokeRect(w.box[0] - sx - 1, w.box[1] - sy, w.box[2] + 2, w.box[3]);
      }
    }
  }, [img, line]);
  return <canvas ref={ref} style={{ width: width || undefined, maxWidth: "100%", height: "auto" }} role="img" aria-label="השורה בסריקה" />;
}
