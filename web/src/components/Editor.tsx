"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Plus, Trash2, ZoomIn, ZoomOut, Undo2 } from "lucide-react";
import { EngineError, getPage, imageUrl, newLineId, savePage } from "@/lib/api";
import { clampPoint, columnKinds, drawnLine } from "@/lib/geometry";
import type { Line, Manuscript, Page, Point, Region } from "@/lib/types";
import { REGION_LABEL } from "@/lib/types";
import { MarkedText, doubtfulWords } from "./doubt";
import { LineCards } from "./LineCards";
import { ScanView } from "./ScanView";
import { TopBar, type BarUser } from "./TopBar";
import { TrainingDialog } from "./TrainingDialog";
import { Toast, useToast } from "./Toast";

type Mode = "side" | "lines";
type SaveState = { kind: "saved" | "pending" | "saving" } | { kind: "error"; message: string; conflict: boolean };

const ICON = { size: 18, strokeWidth: 1.5 } as const;
const sortLines = (ls: Line[]) => [...ls].sort((a, b) => a.order - b.order).map((l, i) => ({ ...l, order: i }));

export function Editor({ slug, pageNo, manuscript, pages, user }: {
  slug: string; pageNo: number; manuscript: Manuscript; pages: number[]; user?: BarUser | null;
}) {
  const [page, setPage] = useState<Page | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("side");
  const [zoom, setZoom] = useState(1);
  const [showOrder, setShowOrder] = useState(false);
  const [drawing, setDrawing] = useState<Point[] | null>(null);
  const [save, setSave] = useState<SaveState>({ kind: "saved" });
  const [trainOpen, setTrainOpen] = useState(false);
  const toast = useToast();

  const pageRef = useRef<Page | null>(null);
  const history = useRef<Line[][]>([]);
  const lastEdited = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const dirty = useRef(false);
  const field = useRef<HTMLInputElement>(null);
  const draftKey = `maatik-draft-${slug}-${pageNo}`;

  // ---------------------------------------------------------------- load
  useEffect(() => {
    try { const m = localStorage.getItem("maatik-mode"); if (m === "side" || m === "lines") setMode(m); } catch { /* no storage */ }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await getPage(slug, pageNo);
        if (cancelled) return;
        p.lines = sortLines(p.lines);
        let restored = false;
        try {
          const raw = localStorage.getItem(draftKey);
          if (raw) {
            const d = JSON.parse(raw) as { revision: number; lines: Line[] };
            if (d.revision === p.revision) { p.lines = d.lines; restored = true; dirty.current = true; }
            else localStorage.removeItem(draftKey);
          }
        } catch { /* no storage */ }
        pageRef.current = p;
        setPage(p);
        const first = p.lines.find((l) => l.status !== "approved") ?? p.lines[0];
        setActiveId(first?.id ?? null);
        if (restored) { toast.show("שוחזרו שינויים שלא נשמרו בפעם הקודמת. שומר אותם עכשיו."); scheduleSave(0); }
      } catch (e) {
        if (!cancelled) setLoadError((e as Error).message);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, pageNo]);

  // ---------------------------------------------------------------- save
  const doSave = useCallback(async () => {
    const p = pageRef.current;
    if (!p || inFlight.current || !dirty.current) return;
    inFlight.current = true;
    dirty.current = false;
    setSave({ kind: "saving" });
    try {
      const { revision } = await savePage(slug, pageNo, p);
      const next = { ...pageRef.current!, revision };
      pageRef.current = next;
      setPage(next);
      try { localStorage.removeItem(draftKey); } catch { /* no storage */ }
      setSave({ kind: dirty.current ? "pending" : "saved" });
    } catch (e) {
      dirty.current = true;
      const conflict = e instanceof EngineError && e.status === 409;
      try { localStorage.setItem(draftKey, JSON.stringify({ revision: p.revision, lines: p.lines })); } catch { /* no storage */ }
      setSave({
        kind: "error", conflict,
        message: conflict
          ? "העמוד נשמר בינתיים ממקום אחר, ולכן השינויים שלך לא נשמרו. הם עדיין כאן ושמורים בדפדפן."
          : `השמירה נכשלה (${(e as Error).message}). השינויים עדיין כאן ושמורים בדפדפן.`,
      });
    } finally {
      inFlight.current = false;
      if (dirty.current && saveTimer.current === null) scheduleSave(1500);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, pageNo, draftKey]);

  function scheduleSave(ms = 700) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { saveTimer.current = null; void doSave(); }, ms);
  }

  // Working time: once a minute, if the person typed or clicked in the last two minutes and
  // the page is visible, tell the engine. Idle time is not counted.
  useEffect(() => {
    let last = Date.now();
    const touch = () => { last = Date.now(); };
    const events = ["keydown", "pointerdown", "input", "wheel"] as const;
    events.forEach((ev) => addEventListener(ev, touch, { passive: true }));
    const t = setInterval(() => {
      if (document.visibilityState !== "visible" || Date.now() - last > 120_000) return;
      void fetch("/api/engine/v1/activity", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "active", slug, page: pageNo }),
      }).catch(() => { /* a missed minute is not worth an error */ });
    }, 60_000);
    return () => { clearInterval(t); events.forEach((ev) => removeEventListener(ev, touch)); };
  }, [slug, pageNo]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty.current || inFlight.current) e.preventDefault(); };
    addEventListener("beforeunload", warn);
    return () => removeEventListener("beforeunload", warn);
  }, []);

  /** Every change goes through here: it records undo history and schedules a save. */
  function change(lines: Line[], { record = true } = {}) {
    const p = pageRef.current;
    if (!p) return;
    if (record) {
      history.current.push(p.lines);
      if (history.current.length > 100) history.current.shift();
    }
    const next = { ...p, lines: sortLines(lines) };
    pageRef.current = next;
    setPage(next);
    dirty.current = true;
    if (save.kind !== "error" || !save.conflict) setSave({ kind: "pending" });
    scheduleSave();
  }

  function undo() {
    const prev = history.current.pop();
    if (!prev) { toast.show("אין מה לבטל."); return; }
    lastEdited.current = null;
    change(prev, { record: false });
    if (!prev.some((l) => l.id === activeId)) setActiveId(prev[0]?.id ?? null);
    toast.show("בוטל.");
  }

  // ---------------------------------------------------------------- line actions
  const lines = page?.lines ?? [];
  const idx = lines.findIndex((l) => l.id === activeId);
  const active = idx >= 0 ? lines[idx] : null;

  const focusField = () => requestAnimationFrame(() => field.current?.focus({ preventScroll: true }));
  function go(i: number) {
    if (!lines.length) return;
    const j = Math.max(0, Math.min(lines.length - 1, i));
    setActiveId(lines[j].id);
    lastEdited.current = null;
    focusField();
  }
  const update = (id: string, patch: Partial<Line>, record = true) =>
    change(lines.map((l) => (l.id === id ? { ...l, ...patch } : l)), { record });

  function editText(text: string) {
    if (!active) return;
    // One undo step per line edited, not per keystroke (the text field has its own undo for that).
    const first = lastEdited.current !== active.id;
    lastEdited.current = active.id;
    update(active.id, { text }, first);
  }
  function approve() {
    if (!active) return;
    const text = active.text.replace(/\s+/g, " ").trim();
    if (!text) { toast.show("שורה ריקה לא מאושרת. הקלד את מה שכתוב, או מחק את השורה."); return; }
    update(active.id, { text, status: "approved" });
    if (idx < lines.length - 1) go(idx + 1);
    else toast.show("זו השורה האחרונה בעמוד.");
  }
  function leaveUnsure() {
    if (!active) return;
    if (active.status === "approved") update(active.id, { status: "pending" });
    if (idx < lines.length - 1) go(idx + 1);
    toast.show("השורה נשארה לא מאושרת, ולא תיכנס לאימון.");
  }
  function remove() {
    if (!active) return;
    const next = lines[idx + 1] ?? lines[idx - 1] ?? null;
    change(lines.filter((l) => l.id !== active.id));
    setActiveId(next?.id ?? null);
    toast.show("השורה נמחקה. Ctrl+Z מחזיר אותה.");
  }
  function setRegion(region: Region) { if (active) update(active.id, { region }); }

  function startDrawing() {
    setMode("side");
    setDrawing([]);
    toast.show("לחץ בסריקה על תחילת השורה החסרה ואחר כך על סופה, על קו הכתיבה.", 6000);
  }
  function addPoint(p: Point) {
    if (!drawing || !page) return;
    const pt = clampPoint(p, page.image.width, page.image.height);
    if (drawing.length === 0) { setDrawing([pt]); return; }
    const geo = drawnLine(drawing[0], pt, lines);
    const fit = (ps: Point[]) => ps.map((q) => clampPoint(q, page.image.width, page.image.height));
    const line: Line = {
      id: newLineId(), order: active ? active.order + 0.5 : lines.length, region: "main",
      baseline: fit(geo.baseline), boundary: fit(geo.boundary), text: "", words: [], engine_text: "",
      llm: null, source: "manual", status: "pending", model_version: null,
    };
    change([...lines, line]);
    setDrawing(null);
    setActiveId(line.id);
    focusField();
    toast.show("נוספה שורה. הקלד את מה שכתוב בה ואשר.");
  }

  // ---------------------------------------------------------------- keyboard
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    if (trainOpen) return;
    const inField = (e.target as HTMLElement)?.id === "line-field";
    if (e.key === "Escape" && drawing) { setDrawing(null); toast.show("ההוספה בוטלה."); return; }
    if (e.altKey && e.key === "ArrowDown") { e.preventDefault(); go(idx + 1); return; }
    if (e.altKey && e.key === "ArrowUp") { e.preventDefault(); go(idx - 1); return; }
    if (e.altKey && e.code === "Digit1") { e.preventDefault(); approve(); return; }
    if (e.altKey && e.code === "Digit2") { e.preventDefault(); leaveUnsure(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey && !inField) { e.preventDefault(); undo(); return; }
    if (e.key === "Enter" && inField && !e.isComposing) { e.preventDefault(); approve(); }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keys.current(e);
    addEventListener("keydown", h);
    return () => removeEventListener("keydown", h);
  }, []);

  function switchMode(m: Mode) {
    setMode(m);
    try { localStorage.setItem("maatik-mode", m); } catch { /* no storage */ }
  }

  // ---------------------------------------------------------------- render
  const approved = lines.filter((l) => l.status === "approved").length;
  const pos = pages.indexOf(pageNo);
  const prevPage = pos > 0 ? pages[pos - 1] : null;
  const nextPage = pos >= 0 && pos < pages.length - 1 ? pages[pos + 1] : null;
  const label = manuscript.page_labels[String(pageNo)];
  const isTest = manuscript.split?.test.includes(pageNo) ?? false;
  const kinds = useMemo(() => columnKinds(lines), [lines]);
  const twoColumns = [...kinds.values()].includes("L") && [...kinds.values()].includes("R");

  const crumbs = (
    <>
      <Link href={`/m/${slug}`} className="font-medium text-ink">{manuscript.name ?? slug}</Link>
      <span className="inline-flex items-center gap-1">
        {prevPage ? <Link href={`/m/${slug}/p/${prevPage}`} className="btn btn-quiet btn-icon" aria-label="לעמוד הקודם"><ChevronRight {...ICON} /></Link>
                  : <span className="btn btn-quiet btn-icon opacity-30" aria-hidden><ChevronRight {...ICON} /></span>}
        <span className="num">עמוד {pageNo} מתוך {pages.length}{label ? ` · ${label}` : ""}</span>
        {nextPage ? <Link href={`/m/${slug}/p/${nextPage}`} className="btn btn-quiet btn-icon" aria-label="לעמוד הבא"><ChevronLeft {...ICON} /></Link>
                  : <span className="btn btn-quiet btn-icon opacity-30" aria-hidden><ChevronLeft {...ICON} /></span>}
      </span>
      {page && <span className="num">אושרו {approved} מתוך {lines.length} שורות</span>}
      {isTest && <span className="chip chip-test" title="עמוד בדיקה: לא נכנס לאימון, משמש למדידה">עמוד בדיקה</span>}
      <SaveBadge state={save} onRetry={() => { setSave({ kind: "pending" }); void doSave(); }} />
    </>
  );

  return (
    <div className={`flex min-h-dvh flex-col ${mode === "side" ? "lg:h-dvh" : ""}`}>
      <TopBar crumbs={crumbs} user={user}>
        <div className="flex" role="group" aria-label="תצוגה">
          {(["side", "lines"] as Mode[]).map((m) => (
            <button key={m} className={`btn min-h-10 ${mode === m ? "border-2 border-accent bg-accent-tint" : ""} ${m === "side" ? "rounded-e-none" : "rounded-s-none border-s-0"}`}
                    aria-pressed={mode === m} onClick={() => switchMode(m)}>
              {m === "side" ? "צד מול צד" : "שורה מעל שורה"}
            </button>
          ))}
        </div>
        <a className="link" href={`/api/engine/v1/manuscripts/${slug}/export.txt`} target="_blank" rel="noreferrer">ייצוא</a>
        <button className="btn btn-primary" onClick={() => setTrainOpen(true)}>שפר את המודל</button>
      </TopBar>

      {save.kind === "error" && (
        <div className="gutter flex flex-wrap items-center gap-3 border-b border-danger bg-surface py-3" role="alert">
          <span className="text-danger">{save.message}</span>
          {save.conflict
            ? <button className="btn" onClick={() => { try { localStorage.removeItem(draftKey); } catch { /* */ } location.reload(); }}>טען את הגרסה השמורה (השינויים שלי יימחקו)</button>
            : <button className="btn" onClick={() => void doSave()}>נסה לשמור שוב</button>}
        </div>
      )}

      {loadError && <main className="gutter py-10"><p className="border border-line bg-surface p-4">לא הצלחתי לטעון את העמוד: {loadError}</p></main>}
      {!page && !loadError && <main className="gutter py-10 text-muted">טוען את העמוד…</main>}

      {page && mode === "side" && (
        <main className="gutter grid min-h-0 flex-1 grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] gap-7 py-5 max-lg:grid-cols-1 lg:grid-rows-[minmax(0,1fr)]">
          <section className="flex min-h-0 min-w-0 flex-col gap-3 max-lg:h-[48dvh]" aria-label="הסריקה">
            <div className="flex flex-wrap items-center gap-2">
              <span className="subtitle">הסריקה</span>
              <span className="flex-1" />
              <label className="inline-flex cursor-pointer items-center gap-2 text-[15px]">
                <input type="checkbox" className="h-[18px] w-[18px] accent-[var(--accent)]" checked={showOrder} onChange={(e) => setShowOrder(e.target.checked)} />
                סדר קריאה
              </label>
              <button className="btn btn-icon" onClick={() => setZoom((z) => Math.max(1, z - 0.5))} aria-label="הקטן" disabled={zoom <= 1}><ZoomOut {...ICON} /></button>
              <span className="num eyebrow w-12 text-center">{Math.round(zoom * 100)}%</span>
              <button className="btn btn-icon" onClick={() => setZoom((z) => Math.min(3, z + 0.5))} aria-label="הגדל" disabled={zoom >= 3}><ZoomIn {...ICON} /></button>
            </div>
            {drawing && (
              <div className="flex flex-wrap items-center gap-3 border border-accent bg-accent-tint px-3 py-2 text-[15px]">
                <span>{drawing.length === 0 ? "לחץ על תחילת השורה החסרה, על קו הכתיבה." : "עכשיו לחץ על סוף השורה."}</span>
                <button className="link" onClick={() => setDrawing(null)}>ביטול</button>
              </div>
            )}
            <ScanView src={imageUrl(slug, pageNo)} width={page.image.width} height={page.image.height} lines={lines}
                      activeId={activeId} zoom={zoom} showOrder={showOrder} drawing={drawing}
                      onPick={(id) => { setActiveId(id); lastEdited.current = null; focusField(); }} onPoint={addPoint} />
          </section>

          <section className="flex min-h-0 min-w-0 flex-col gap-3" aria-label="התעתוק">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="subtitle">התעתוק</span>
              <span className="flex-1" />
              {twoColumns && <span className="eyebrow">שני טורים: טור ימין נקרא לפני טור שמאל</span>}
            </div>
            <LineList lines={lines} kinds={kinds} activeId={activeId}
                      onPick={(id) => { setActiveId(id); lastEdited.current = null; focusField(); }}
                      editor={active && (
                        <LineEditor line={active} index={idx} total={lines.length} fieldRef={field} size={22}
                                    onText={editText} onApprove={approve} onUnsure={leaveUnsure} onPrev={() => go(idx - 1)}
                                    onMissing={startDrawing} onDelete={remove} onRegion={setRegion} onUndo={undo} />
                      )} />
          </section>
        </main>
      )}

      {page && mode === "lines" && (
        <main className="gutter flex-1 py-5">
          <LineCards src={imageUrl(slug, pageNo)} page={page} kinds={kinds} activeId={activeId}
                     onPick={(id) => { setActiveId(id); lastEdited.current = null; focusField(); }}
                     editor={active && (
                       <LineEditor line={active} index={idx} total={lines.length} fieldRef={field} size={24} inCard
                                   onText={editText} onApprove={approve} onUnsure={leaveUnsure} onPrev={() => go(idx - 1)}
                                   onMissing={startDrawing} onDelete={remove} onRegion={setRegion} onUndo={undo} />
                     )} />
        </main>
      )}

      {trainOpen && <TrainingDialog slug={slug} onClose={() => { setTrainOpen(false); focusField(); }} />}
      <Toast state={toast} />
    </div>
  );
}

function SaveBadge({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  if (state.kind === "error") return <button className="link text-danger" onClick={onRetry}>לא נשמר</button>;
  const text = { saved: "נשמר", pending: "יישמר בעוד רגע", saving: "שומר…" }[state.kind];
  return <span aria-live="polite" className="text-muted">{text}</span>;
}

function LineList({ lines, kinds, activeId, onPick, editor }: {
  lines: Line[]; kinds: Map<string, "full" | "R" | "L">; activeId: string | null;
  onPick: (id: string) => void; editor: React.ReactNode;
}) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = list.current?.querySelector<HTMLElement>(`[data-id="${activeId}"]`);
    if (!row || !list.current) return;
    const lt = list.current.getBoundingClientRect(), rt = row.getBoundingClientRect();
    if (list.current.scrollHeight > list.current.clientHeight && (rt.top < lt.top || rt.bottom > lt.bottom)) {
      list.current.scrollBy({ top: rt.top - lt.top - 60, behavior: "smooth" });
    } else if (list.current.scrollHeight <= list.current.clientHeight && (rt.top < 90 || rt.bottom > innerHeight)) {
      scrollBy({ top: rt.top - 140, behavior: "smooth" });
    }
  }, [activeId]);

  let prev: string | null = null;
  return (
    <div ref={list} className="min-h-0 flex-1 overflow-auto border-t border-line max-lg:overflow-visible">
      {lines.map((l, i) => {
        const k = kinds.get(l.id) ?? "full";
        const head = k !== prev && (k === "R" || k === "L") ? (k === "R" ? "טור ימין" : "טור שמאל")
          : k !== prev && k === "full" && (prev === "R" || prev === "L") ? "רוחב מלא" : null;
        prev = k;
        const on = l.id === activeId;
        return (
          <div key={l.id} data-id={l.id}>
            {head && <div className="sticky top-0 z-[1] border-b border-line bg-paper px-2 pb-1 pt-2.5 text-[15px] text-muted">{head}</div>}
            {on ? (
              <div className="grid grid-cols-[36px_minmax(0,1fr)] gap-3 border-b border-line bg-accent-tint px-2 py-2 max-sm:grid-cols-[24px_minmax(0,1fr)] max-sm:gap-2">
                <span className="num pt-1 text-end text-[15px] text-muted">{i + 1}</span>
                <div className="grid gap-3 pb-2">{editor}</div>
              </div>
            ) : (
              <button onClick={() => onPick(l.id)}
                      className={`grid w-full cursor-pointer grid-cols-[36px_minmax(0,1fr)_24px] items-baseline gap-3 border-b border-line px-2 py-1.5 text-start hover:bg-surface max-sm:grid-cols-[24px_minmax(0,1fr)_20px] max-sm:gap-2 ${l.status === "approved" ? "text-ink" : "text-muted"}`}>
                <span className="num text-end text-[15px] text-muted">{i + 1}</span>
                <span className="font-text text-[19px] leading-[33px] [overflow-wrap:anywhere]">
                  {l.region !== "main" && <span className="chip me-2 align-middle">{REGION_LABEL[l.region]}</span>}
                  <MarkedText line={l} />
                </span>
                <span className="self-center text-accent">{l.status === "approved" && <Check {...ICON} aria-label="מאושרת" />}</span>
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function LineEditor({ line, index, total, fieldRef, size, inCard = false, onText, onApprove, onUnsure, onPrev, onMissing, onDelete, onRegion, onUndo }: {
  line: Line; index: number; total: number; fieldRef: React.RefObject<HTMLInputElement | null>; size: number; inCard?: boolean;
  onText: (t: string) => void; onApprove: () => void; onUnsure: () => void; onPrev: () => void;
  onMissing: () => void; onDelete: () => void; onRegion: (r: Region) => void; onUndo: () => void;
}) {
  const unsure = doubtfulWords(line);
  const next = Math.min(index + 2, total);
  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <label htmlFor="line-field" className="eyebrow">
          {inCard ? "התעתוק" : <>שורה <span className="num">{index + 1}</span></>}
          {line.source === "manual" ? " · נוספה ידנית" : ""}
          {line.status === "approved" ? " · מאושרת" : ""}
        </label>
        <span className="flex-1" />
        <label className="eyebrow inline-flex items-center gap-2">
          אזור
          <select className="border border-line bg-surface px-2 py-0.5 text-[15px] text-ink" value={line.region}
                  onChange={(e) => onRegion(e.target.value as Region)}>
            {(Object.keys(REGION_LABEL) as Region[]).map((r) => <option key={r} value={r}>{REGION_LABEL[r]}</option>)}
          </select>
        </label>
      </div>
      <input id="line-field" ref={fieldRef} className="field" dir="rtl" lang="he" autoComplete="off" spellCheck={false}
             style={{ fontSize: size, lineHeight: `${Math.round(size * 1.5)}px` }}
             value={line.text} onChange={(e) => onText(e.target.value)} />
      {line.status !== "approved" && line.source === "engine" && line.text !== line.engine_text && (
        <p className="eyebrow m-0">המנוע קרא: <span className="font-text text-[17px] text-ink">{line.engine_text}</span></p>
      )}
      {unsure.length > 0 && (
        <div className="grid gap-1 border border-line bg-surface px-4 py-3">
          <p className="m-0">
            המנוע לא בטוח {unsure.length === 1 ? "במילה" : "במילים"}{" "}
            {unsure.map((w, i) => <span key={i}><span className="doubt-word font-text">{w}</span>{i < unsure.length - 1 ? ", " : ""}</span>)}.
            {" "}בדוק {unsure.length === 1 ? "אותה" : "אותן"} בסריקה, במסגרת החומה.
          </p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-primary btn-big max-sm:basis-full" onClick={onApprove}>
          <Check {...ICON} /> אשר והמשך לשורה <span className="num">{next}</span>
        </button>
        <button className="btn max-sm:flex-1" onClick={onUnsure} title="השורה נשארת לא מאושרת ולא תיכנס לאימון">קריאה מסופקת</button>
        <button className="btn max-sm:flex-1" onClick={onPrev} disabled={index === 0}>חזרה לשורה <span className="num">{Math.max(index, 1)}</span></button>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <button className="btn btn-quiet" onClick={onMissing}><Plus {...ICON} /> חסרה כאן שורה</button>
        <button className="btn btn-danger" onClick={onDelete}><Trash2 {...ICON} /> מחק שורה</button>
        <button className="btn btn-quiet" onClick={onUndo}><Undo2 {...ICON} /> בטל</button>
      </div>
      <p className="kbd eyebrow m-0 max-sm:hidden">
        <span dir="ltr"><kbd>Enter</kbd></span> מאשר ועובר · <span dir="ltr"><kbd>Alt</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd></span> בין שורות ·{" "}
        <span dir="ltr"><kbd>Alt</kbd>+<kbd>2</kbd></span> קריאה מסופקת · <span dir="ltr"><kbd>Ctrl</kbd>+<kbd>Z</kbd></span> מבטל (מחוץ לשדה)
      </p>
    </>
  );
}
