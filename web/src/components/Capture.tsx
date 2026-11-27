"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, ImagePlus, RotateCw, Maximize, Check, SkipForward, FileUp } from "lucide-react";
import { readyPages } from "@/lib/ready-pages";
import { outputSize, warp, type Pt } from "@/lib/warp";

const ICON = { size: 20, strokeWidth: 1.5 } as const;
const MAX_SOURCE = 3600; // long side of the photo we work on
const MAX_OUTPUT = 3000; // long side of the page we upload

type Done = { page: number; url: string; state: "uploading" | "recognizing" | "ready" | "failed"; lines?: number; error?: string };

/** Photograph pages (or pick photos), mark the page corners, straighten, upload, recognise. */
export function Capture({ slug, name, firstPage, shared = 0 }: { slug: string; name: string; firstPage: number; shared?: number }) {
  const [queue, setQueue] = useState<File[]>([]);
  const [img, setImg] = useState<ImageBitmap | HTMLCanvasElement | null>(null);
  const [corners, setCorners] = useState<Pt[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done[]>([]);
  const [error, setError] = useState<string | null>(null);
  const nextPage = useRef(firstPage);
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const ready = useRef<HTMLInputElement>(null);
  const [readyNote, setReadyNote] = useState<string | null>(null);
  const [sharedLeft, setSharedLeft] = useState(shared);

  /** Already-cropped pages (a DocScan PDF, or images): uploaded in order, without marking corners. */
  async function addReady(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    setSharedLeft(0);
    try {
      setReadyNote("מכין את העמודים…");
      const pages = await readyPages(Array.from(files), setReadyNote);
      if (!pages.length) { setError("לא מצאתי תמונות או PDF בקבצים שנבחרו."); return; }
      setReadyNote(`מעלה ${pages.length} עמודים…`);
      for (const blob of pages) await upload(blob, URL.createObjectURL(blob), false);
      setReadyNote(null);
    } catch (e) {
      setError(`לא הצלחתי לפתוח את הקבצים: ${(e as Error).message}`);
      setReadyNote(null);
    }
  }

  // Load the first photo in the queue, downscaled, upright (EXIF orientation applied).
  useEffect(() => {
    if (img || !queue.length) return;
    let cancelled = false;
    (async () => {
      try {
        const bmp = await createImageBitmap(queue[0], { imageOrientation: "from-image" });
        const s = Math.min(1, MAX_SOURCE / Math.max(bmp.width, bmp.height));
        const c = document.createElement("canvas");
        c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
        c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
        bmp.close();
        if (cancelled) return;
        setImg(c);
        setCorners(inset(c.width, c.height));
      } catch {
        setError("לא הצלחתי לפתוח את התמונה. נסה לצלם שוב.");
        setQueue((q) => q.slice(1));
      }
    })();
    return () => { cancelled = true; };
  }, [queue, img]);

  function add(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    setQueue((q) => [...q, ...Array.from(files).filter((f) => f.type.startsWith("image/"))]);
  }

  function nextPhoto() {
    setImg(null);
    setCorners([]);
    setQueue((q) => q.slice(1));
  }

  function rotate() {
    if (!img) return;
    const c = document.createElement("canvas");
    c.width = img.height; c.height = img.width;
    const g = c.getContext("2d")!;
    g.translate(c.width, 0);
    g.rotate(Math.PI / 2);
    g.drawImage(img, 0, 0);
    setImg(c);
    setCorners(inset(c.width, c.height));
  }

  async function saveAndUpload() {
    if (!img) return;
    setBusy(true);
    setError(null);
    try {
      const src = document.createElement("canvas");
      src.width = img.width; src.height = img.height;
      const sg = src.getContext("2d", { willReadFrequently: true })!;
      sg.drawImage(img, 0, 0);
      const { w, h } = outputSize(corners, MAX_OUTPUT, src.width, src.height);
      // Let the "working" state paint before the heavy loop.
      await new Promise((ok) => requestAnimationFrame(() => setTimeout(ok, 0)));
      const out = warp(sg.getImageData(0, 0, src.width, src.height), corners, w, h);
      const oc = document.createElement("canvas");
      oc.width = w; oc.height = h;
      oc.getContext("2d")!.putImageData(out, 0, 0);
      const blob: Blob = await new Promise((ok, no) => oc.toBlob((b) => (b ? ok(b) : no(new Error("JPEG"))), "image/jpeg", 0.9));
      const url = URL.createObjectURL(blob);
      nextPhoto();
      void upload(blob, url);
    } catch (e) {
      setError((e as Error).message || "היישור נכשל.");
    } finally {
      setBusy(false);
    }
  }

  /** Upload one page, then start its recognition. With `wait` false it returns once the page is
   *  uploaded and recognition was asked for, so the next page can start uploading. */
  const upload = useCallback(async (blob: Blob, url: string, wait = true) => {
    let page = nextPage.current++;
    const set = (p: number, patch: Partial<Done>) => setDone((d) => d.map((x) => (x.page === p ? { ...x, ...patch } : x)));
    setDone((d) => [{ page, url, state: "uploading" }, ...d]);
    try {
      for (let tries = 0; ; tries++) {
        const r = await fetch(`/api/engine/v1/manuscripts/${slug}/pages/${page}/image`, {
          method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: blob,
        });
        if (r.ok) break;
        if (r.status === 409 && tries < 20) {
          // That page number is taken (someone else uploaded): take the next one.
          const old = page;
          page = nextPage.current++;
          setDone((d) => d.map((x) => (x.page === old ? { ...x, page } : x)));
          continue;
        }
        throw new Error(r.status === 413 ? "התמונה גדולה מדי" : `ההעלאה נכשלה (${r.status})`);
      }
      set(page, { state: "recognizing" });
      const job = await (await fetch(`/api/engine/v1/manuscripts/${slug}/pages/${page}/recognize`, { method: "POST" })).json();
      const p = page;
      const follow = (async () => {
        try {
          for (let i = 0; i < 120; i++) {
            await new Promise((ok) => setTimeout(ok, 5000));
            const s = await (await fetch(`/api/engine/v1/jobs/${job.job_id}`)).json();
            if (s.status === "done") { set(p, { state: "ready", lines: s.result?.summary?.lines }); return; }
            if (s.status === "failed") throw new Error("הזיהוי נכשל");
          }
          throw new Error("הזיהוי לוקח יותר מדי זמן");
        } catch (e) {
          set(p, { state: "failed", error: (e as Error).message });
        }
      })();
      if (wait) await follow;
    } catch (e) {
      set(page, { state: "failed", error: (e as Error).message });
    }
  }, [slug]);

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="title m-0">צילום עמודים</h1>
        <Link href={`/m/${slug}`} className="link">{name}</Link>
      </div>

      {/* Hidden file inputs: the camera (on a phone) and the gallery. */}
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
      <input ref={gallery} type="file" accept="image/*" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
      <input ref={ready} type="file" accept="image/*,application/pdf" multiple hidden data-ready-files
             onChange={(e) => { void addReady(e.target.files); e.target.value = ""; }} />

      {sharedLeft > 0 && !img && (
        <div className="grid gap-3 border border-accent bg-accent-tint p-4">
          <p className="m-0">
            {sharedLeft === 1 ? "קובץ אחד שותף" : `${sharedLeft} קבצים שותפו`} למעתיק (למשל מ-DocScan). הם כבר חתוכים, ויעלו כמו שהם,
            עמוד אחרי עמוד, מעמוד <span className="num">{nextPage.current}</span>.
          </p>
          <button className="btn btn-primary btn-big justify-self-start" onClick={() => ready.current?.click()}>
            <FileUp {...ICON} /> העלה את מה ששותף
          </button>
        </div>
      )}

      {!img && (
        <div className="grid gap-3 sm:flex sm:flex-wrap">
          <button className="btn btn-primary btn-big" onClick={() => camera.current?.click()}><Camera {...ICON} /> צלם עמוד</button>
          <button className="btn btn-big" onClick={() => gallery.current?.click()}><ImagePlus {...ICON} /> בחר תמונות מהגלריה</button>
          <button className="btn btn-big" onClick={() => ready.current?.click()}
                  title="עמודים שכבר נחתכו ויושרו, למשל PDF או תמונות מ-DocScan: עולים בלי סימון פינות">
            <FileUp {...ICON} /> העלה PDF או תמונות מוכנים
          </button>
          {queue.length > 0 && <span className="eyebrow self-center">פותח את התמונה…</span>}
        </div>
      )}
      {!img && done.length === 0 && (
        <p className="eyebrow m-0 max-w-[60ch]">
          צלם עמוד אחד בכל פעם, מלמעלה, באור טוב ובלי צל. אחר כך מסמנים את ארבע הפינות של הדף, והעמוד מיושר, עולה למנוע
          ומזוהה. העמוד הבא יקבל את המספר <span className="num">{nextPage.current}</span>.
        </p>
      )}
      {error && <p className="m-0 text-danger" role="alert">{error}</p>}
      {readyNote && <p className="m-0 text-muted" aria-live="polite">{readyNote}</p>}

      {img && (
        <div className="grid gap-3">
          <p className="m-0">
            גרור את ארבע הנקודות לפינות הדף. {queue.length > 1 && <span className="eyebrow num">(עוד {queue.length - 1} תמונות בתור)</span>}
          </p>
          <CornerEditor img={img} corners={corners} onChange={setCorners} />
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary btn-big max-sm:basis-full" disabled={busy} onClick={saveAndUpload}>
              <Check {...ICON} /> {busy ? "מיישר…" : `שמור והעלה כעמוד ${nextPage.current}`}
            </button>
            <button className="btn max-sm:flex-1" onClick={rotate} disabled={busy}><RotateCw {...ICON} /> סובב</button>
            <button className="btn max-sm:flex-1" onClick={() => setCorners(full(img.width, img.height))} disabled={busy}><Maximize {...ICON} /> כל התמונה</button>
            <button className="btn btn-quiet" onClick={nextPhoto} disabled={busy}><SkipForward {...ICON} /> דלג</button>
          </div>
        </div>
      )}

      {done.length > 0 && (
        <section className="grid gap-3" aria-label="עמודים שהועלו">
          <h2 className="subtitle m-0">הועלו עכשיו</h2>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-4 max-sm:grid-cols-2">
            {done.map((d) => (
              <li key={d.page + d.url} className="grid gap-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={d.url} alt={`עמוד ${d.page}`} className="aspect-[2/3] w-full border border-line bg-scan object-cover" />
                <span className="font-text text-[17px] font-medium">עמוד <span className="num">{d.page}</span></span>
                <span className={`text-[15px] ${d.state === "failed" ? "text-danger" : "text-muted"}`} aria-live="polite">
                  {d.state === "uploading" && "מעלה…"}
                  {d.state === "recognizing" && "מזהה שורות… (כדקה)"}
                  {d.state === "ready" && <Link className="link" href={`/m/${slug}/p/${d.page}`}>זוהו {d.lines ?? ""} שורות. להגהה</Link>}
                  {d.state === "failed" && d.error}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function inset(w: number, h: number): Pt[] {
  const dx = w * 0.06, dy = h * 0.06;
  return [{ x: w - dx, y: dy }, { x: dx, y: dy }, { x: dx, y: h - dy }, { x: w - dx, y: h - dy }];
}
function full(w: number, h: number): Pt[] {
  return [{ x: w - 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: h - 1 }, { x: w - 1, y: h - 1 }];
}

/** The photo with four draggable corner handles (top-right, top-left, bottom-left, bottom-right). */
function CornerEditor({ img, corners, onChange }: { img: ImageBitmap | HTMLCanvasElement; corners: Pt[]; onChange: (c: Pt[]) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<number | null>(null);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const s = Math.min(1, 1600 / Math.max(img.width, img.height));
    c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  }, [img]);

  function toImage(e: React.PointerEvent): Pt | null {
    const m = svg.current?.getScreenCTM();
    if (!m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: Math.max(0, Math.min(img.width - 1, p.x)), y: Math.max(0, Math.min(img.height - 1, p.y)) };
  }

  const r = Math.max(img.width, img.height) * 0.028;
  return (
    // The photo is a picture, not text: laid out left to right like the scan view.
    <div dir="ltr" className="relative mx-auto w-full max-w-[720px] touch-none select-none border border-line bg-scan">
      <canvas ref={canvas} className="block h-auto w-full" role="img" aria-label="התמונה שצולמה" />
      <svg ref={svg} viewBox={`0 0 ${img.width} ${img.height}`} className="absolute inset-0 h-full w-full"
           onPointerMove={(e) => {
             if (drag.current === null) return;
             const p = toImage(e);
             if (p) onChange(corners.map((c, i) => (i === drag.current ? p : c)));
           }}
           onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
        <polygon points={corners.map((c) => `${c.x},${c.y}`).join(" ")} fill="rgba(223,230,240,0.25)"
                 stroke="var(--accent)" strokeWidth={Math.max(2, r / 6)} />
        {corners.map((c, i) => (
          <circle key={i} cx={c.x} cy={c.y} r={r} fill="rgba(255,255,255,0.85)" stroke="var(--accent)" strokeWidth={Math.max(2, r / 5)}
                  style={{ cursor: "grab" }} aria-label={["פינה עליונה ימנית", "פינה עליונה שמאלית", "פינה תחתונה שמאלית", "פינה תחתונה ימנית"][i]}
                  onPointerDown={(e) => { drag.current = i; (e.target as Element).setPointerCapture?.(e.pointerId); }} />
        ))}
      </svg>
    </div>
  );
}
