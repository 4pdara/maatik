import type { Line, Point } from "./types";

export type Box = { x: number; y: number; w: number; h: number };

export function bbox(points: Point[]): Box {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export const lineBox = (l: Line) => bbox(l.boundary.length ? l.boundary : l.baseline);

/** Side of a line on a page with two columns: full width, right column or left column.
 *  Same rule as engine/maatik_engine/layout.py (column_order). */
export function columnKinds(lines: Line[]): Map<string, "full" | "R" | "L"> {
  const out = new Map<string, "full" | "R" | "L">();
  if (!lines.length) return out;
  const boxes = lines.map(lineBox);
  const lefts = boxes.map((b) => b.x).sort((a, b) => a - b);
  const rights = boxes.map((b) => b.x + b.w).sort((a, b) => a - b);
  const tl = lefts[Math.floor(lefts.length / 10)];
  const tr = rights[Math.floor((rights.length * 9) / 10)];
  const width = Math.max(tr - tl, 1), mid = (tl + tr) / 2;
  lines.forEach((l, i) => {
    const b = boxes[i];
    out.set(l.id, b.w >= 0.75 * width ? "full" : b.x + b.w / 2 >= mid ? "R" : "L");
  });
  return out;
}

/** A line drawn in the editor: a baseline between two clicks, and a box above it as tall as a typical line. */
export function drawnLine(a: Point, b: Point, lines: Line[]): { baseline: Point[]; boundary: Point[] } {
  const heights = lines.map((l) => lineBox(l).h).filter((h) => h > 0).sort((x, y) => x - y);
  const h = heights.length ? heights[Math.floor(heights.length / 2)] : 50;
  const [p, q] = a[0] <= b[0] ? [a, b] : [b, a];
  const r = (v: number) => Math.round(v);
  const baseline: Point[] = [[r(p[0]), r(p[1])], [r(q[0]), r(q[1])]];
  const up = r(h * 0.8), down = r(h * 0.2);
  const boundary: Point[] = [
    [r(p[0]), r(p[1] - up)], [r(q[0]), r(q[1] - up)], [r(q[0]), r(q[1] + down)], [r(p[0]), r(p[1] + down)],
  ];
  return { baseline, boundary };
}

export function clampPoint(p: Point, w: number, h: number): Point {
  return [Math.max(0, Math.min(w, Math.round(p[0]))), Math.max(0, Math.min(h, Math.round(p[1])))];
}
