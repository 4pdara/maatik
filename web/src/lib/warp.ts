// Straighten a photographed page: the four corners the person marked become a rectangle.
// A plane-to-plane (perspective) transform, solved from the four point pairs.

export type Pt = { x: number; y: number };

/** The 3x3 homography (as 8 numbers, h33 = 1) that maps each `from` point onto its `to` point. */
export function homography(from: Pt[], to: Pt[]): number[] {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i];
    const { x: u, y: v } = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  return solve(A, b);
}

/** Gaussian elimination with partial pivoting (8x8 here). */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) throw new Error("הפינות שסומנו לא יוצרות מרובע");
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

type V3 = [number, number, number];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** The page's real width/height ratio, recovered from the four corners of a photo of size
 *  imgW×imgH (Zhang & He, "Whiteboard scanning and image enhancement", 2007: pinhole camera,
 *  principal point at the image centre). Null when it cannot be recovered (a photo taken
 *  straight on, or corners that no camera could produce). */
export function pageAspect(c: Pt[], imgW: number, imgH: number): number | null {
  const [tr, tl, bl, br] = c;
  const h = (p: Pt): V3 => [p.x - imgW / 2, p.y - imgH / 2, 1];
  const m1 = h(tl), m2 = h(tr), m3 = h(bl), m4 = h(br);
  const k2 = dot(cross(m1, m4), m3) / dot(cross(m2, m4), m3);
  const k3 = dot(cross(m1, m4), m2) / dot(cross(m3, m4), m2);
  const n2: V3 = [k2 * m2[0] - m1[0], k2 * m2[1] - m1[1], k2 * m2[2] - m1[2]];
  const n3: V3 = [k3 * m3[0] - m1[0], k3 * m3[1] - m1[1], k3 * m3[2] - m1[2]];
  if (!isFinite(k2) || !isFinite(k3) || Math.abs(n2[2] * n3[2]) < 1e-9) return null;
  const f2 = -(n2[0] * n3[0] + n2[1] * n3[1]) / (n2[2] * n3[2]);
  const longSide = Math.max(imgW, imgH);
  // A phone camera's focal length is roughly 0.5 to 3 times the long side of the photo.
  if (!(f2 > (0.4 * longSide) ** 2 && f2 < (4 * longSide) ** 2)) return null;
  const q = (n: V3) => (n[0] * n[0] + n[1] * n[1]) / f2 + n[2] * n[2];
  const r = Math.sqrt(q(n2) / q(n3));
  return isFinite(r) && r > 0.2 && r < 5 ? r : null;
}

/** Output size for corners [top-right, top-left, bottom-left, bottom-right] in source pixels,
 *  scaled down so the long side is at most `maxSide`. With the photo's size, the page's real
 *  proportions are used when they can be recovered. */
export function outputSize(c: Pt[], maxSide: number, imgW?: number, imgH?: number): { w: number; h: number } {
  const [tr, tl, bl, br] = c;
  let w = Math.max(dist(tl, tr), dist(bl, br));
  let h = Math.max(dist(tl, bl), dist(tr, br));
  const ratio = imgW && imgH ? pageAspect(c, imgW, imgH) : null;
  if (ratio) {
    // Keep the longer measured side, and set the other from the real ratio.
    if (h >= w) w = h * ratio; else h = w / ratio;
  }
  const s = Math.min(1, maxSide / Math.max(w, h));
  w = Math.max(1, Math.round(w * s));
  h = Math.max(1, Math.round(h * s));
  return { w, h };
}

/** Warp `src` so the quadrilateral `c` (top-right, top-left, bottom-left, bottom-right) fills a w×h image.
 *  Bilinear sampling. */
export function warp(src: ImageData, c: Pt[], w: number, h: number): ImageData {
  const [tr, tl, bl, br] = c;
  // From output pixel to source pixel.
  const H = homography(
    [{ x: w - 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: h - 1 }, { x: w - 1, y: h - 1 }],
    [tr, tl, bl, br],
  );
  const out = new ImageData(w, h);
  const S = src.data, O = out.data, sw = src.width, sh = src.height;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = H[6] * x + H[7] * y + 1;
      const sx = (H[0] * x + H[1] * y + H[2]) / d;
      const sy = (H[3] * x + H[4] * y + H[5]) / d;
      const o = (y * w + x) * 4;
      if (sx < 0 || sy < 0 || sx > sw - 1 || sy > sh - 1) { O[o] = O[o + 1] = O[o + 2] = 255; O[o + 3] = 255; continue; }
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      const x1 = Math.min(x0 + 1, sw - 1), y1 = Math.min(y0 + 1, sh - 1);
      const fx = sx - x0, fy = sy - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = (y0 * sw + x1) * 4, i01 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4;
      for (let k = 0; k < 3; k++) {
        const top = S[i00 + k] + (S[i10 + k] - S[i00 + k]) * fx;
        const bot = S[i01 + k] + (S[i11 + k] - S[i01 + k]) * fx;
        O[o + k] = top + (bot - top) * fy;
      }
      O[o + 3] = 255;
    }
  }
  return out;
}
