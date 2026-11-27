"use client";

import { useEffect, useRef } from "react";
import type { Line, Point } from "@/lib/types";
import { lineBox } from "@/lib/geometry";
import { isDoubtful } from "./doubt";

/** The whole scan with every line's shape on it. The active line is framed, and the
 *  view scrolls to it whenever it changes. In drawing mode clicks become points. */
export function ScanView({
  src, width, height, lines, activeId, zoom, showOrder, drawing, onPick, onPoint,
}: {
  src: string; width: number; height: number; lines: Line[]; activeId: string | null; zoom: number;
  showOrder: boolean; drawing: Point[] | null; onPick: (id: string) => void; onPoint: (p: Point) => void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const active = lines.find((l) => l.id === activeId) ?? null;

  useEffect(() => {
    const f = frame.current;
    if (!f || !active) return;
    const s = f.scrollWidth / width;
    const b = lineBox(active);
    f.scrollTo({ top: (b.y + b.h / 2) * s - f.clientHeight / 2, left: (b.x + b.w / 2) * s - f.clientWidth / 2, behavior: "smooth" });
  }, [activeId, zoom, width, active]);

  function click(e: React.MouseEvent<SVGSVGElement>) {
    if (!drawing || !svg.current) return;
    const m = svg.current.getScreenCTM();
    if (!m) return;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    onPoint([pt.x, pt.y]);
  }

  const doubt = active && isDoubtful(active) ? active.words.filter((w) => w.box && (w.confidence ?? 1) < 0.8) : [];

  return (
    // The scan is a picture, not text: it is laid out left to right so scrolling maths is simple.
    <div ref={frame} dir="ltr" className={`relative min-h-0 flex-1 overflow-auto border border-line bg-scan ${drawing ? "cursor-crosshair" : ""}`}>
      <div className="relative" style={{ width: `${zoom * 100}%` }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="סריקת העמוד" className="block h-auto w-full max-w-none select-none" draggable={false} />
        <svg ref={svg} viewBox={`0 0 ${width} ${height}`} className="absolute inset-0 h-full w-full" onClick={click}
             role="group" aria-label="השורות על הסריקה">
          {lines.map((l, i) => (
            <polygon key={l.id} points={(l.boundary.length ? l.boundary : l.baseline).map((p) => p.join(",")).join(" ")}
                     className={`ln ${l.status === "approved" ? "ln-done" : ""} ${l.source === "manual" ? "ln-manual" : ""} ${l.id === activeId ? "ln-on" : ""}`}
                     onClick={(e) => { if (!drawing) { e.stopPropagation(); onPick(l.id); } }}
                     style={drawing ? { pointerEvents: "none" } : undefined}>
              <title>{`שורה ${i + 1}`}</title>
            </polygon>
          ))}
          {doubt.map((w, i) => (
            <rect key={i} className="wbox" x={w.box![0] - 2} y={w.box![1]} width={w.box![2] + 4} height={w.box![3]} />
          ))}
          {showOrder && lines.map((l, i) => {
            const b = lineBox(l);
            return <text key={l.id} className="ord" x={b.x + b.w + 10} y={b.y + b.h * 0.72}>{i + 1}</text>;
          })}
          {drawing && drawing.length === 1 && <circle cx={drawing[0][0]} cy={drawing[0][1]} r={8} fill="var(--accent)" />}
        </svg>
      </div>
    </div>
  );
}
