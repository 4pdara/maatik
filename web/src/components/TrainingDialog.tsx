"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { getModels, getTraining, startTraining, EngineError } from "@/lib/api";
import type { Models, Training, Version } from "@/lib/types";

const pct = (v: number | null | undefined) => (v == null ? "—" : `${(v * 100).toFixed(2)}%`);
const dateHe = (iso: string) => new Date(iso).toLocaleDateString("he-IL", { day: "numeric", month: "numeric" });

function elapsed(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return min < 60 ? `${min} דקות` : `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")} שעות`;
}

/** The "improve the model" dialog: what the active model scores, what is new, and the run itself. */
export function TrainingDialog({ slug, onClose, onTrainingChange }: {
  slug: string; onClose: () => void; onTrainingChange?: (running: boolean) => void;
}) {
  const [training, setTraining] = useState<Training | null>(null);
  const [models, setModels] = useState<Models | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    try {
      const [t, m] = await Promise.all([getTraining(slug), getModels(slug)]);
      setTraining(t); setModels(m); setError(null);
      onTrainingChange?.(t.job?.status === "running");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [slug, onTrainingChange]);

  useEffect(() => { void load(); closeRef.current?.focus(); }, [load]);
  const running = training?.job?.status === "running";
  useEffect(() => {
    if (!running) return;
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [running, load]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);

  async function start() {
    setStarting(true);
    try {
      await startTraining(slug);
      await load();
    } catch (e) {
      setError(e instanceof EngineError && e.status === 409 ? "כבר רץ אימון לכתב היד הזה." : (e as Error).message);
    } finally {
      setStarting(false);
    }
  }

  const versions = [...(models?.versions ?? [])].sort((a, b) => +a.version.slice(1) - +b.version.slice(1));
  const active = versions.find((v) => v.version === models?.active_model);
  const base = versions[0]?.before;
  const fresh = training ? Math.max(0, training.approved_train_lines - training.last_trained_lines) : 0;
  const lastRun = versions.at(-1);
  const nextVersion = `v${versions.length + 1}`;
  const job = training?.job;
  const finished = job?.status === "done" ? job.result?.metrics : undefined;

  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="train-title">
        <header className="flex items-center gap-3 border-b border-line px-7 pb-3 pt-5 max-sm:px-4">
          <h2 id="train-title" className="title m-0 flex-1">שפר את המודל</h2>
          <button ref={closeRef} className="btn btn-icon" onClick={onClose} aria-label="סגור"><X size={18} strokeWidth={1.5} /></button>
        </header>
        <div className="grid gap-5 px-7 pb-7 pt-5 max-sm:px-4">
          <p className="m-0">
            המודל של כתב היד הזה לומד מכל שורה שאישרת בעמודי האימון. אחרי האימון הוא נבדק על עמודי הבדיקה,
            ומחליף את הקודם רק אם הוא טועה פחות.
          </p>
          {error && <p className="m-0 border border-danger p-3 text-danger">{error}</p>}
          {!training && !error && <p className="eyebrow m-0">טוען…</p>}

          {training && (
            <div className="grid grid-cols-3 border border-line bg-surface max-sm:grid-cols-1">
              <Fact value={active ? pct(active.after?.cer) : pct(base?.cer)}
                    label={active ? `שגיאות באותיות בגרסה הפעילה (${active.version})` : "שגיאות באותיות במודל הבסיס"} />
              <Fact value={String(training.last_trained_lines)} label="שורות מאושרות שהמודל למד מהן" />
              <Fact value={String(fresh)} label="שורות חדשות מאז האימון האחרון" />
            </div>
          )}

          {training && !running && (
            <div className="flex flex-wrap items-center gap-3">
              <button className="btn btn-primary btn-big" disabled={fresh === 0 || starting} onClick={start}>
                {starting ? "מתחיל…" : `התחל אימון (${nextVersion})`}
              </button>
              <span className="eyebrow">
                {fresh === 0
                  ? "אין שורות חדשות. אשר שורות בעמודי האימון כדי שיהיה ממה ללמוד."
                  : lastRun
                    ? `האימון הקודם לקח ${Math.round(lastRun.seconds / 60)} דקות. אפשר להמשיך להגיה בזמן האימון.`
                    : "אפשר להמשיך להגיה בזמן האימון."}
              </span>
            </div>
          )}

          {job && running && (
            <div className="grid gap-2 border border-line bg-surface p-4" aria-live="polite">
              <span className="subtitle">אימון רץ · {elapsed(job.started_at)}</span>
              <span className="eyebrow">
                הדיוק בעמוד האימות אחרי כל סבב (מתוך {job.epochs}). מתעדכן כל 20 שניות.
              </span>
              <div className="num flex flex-wrap gap-2 text-[15px]">
                {(job.epochs_done ?? []).length === 0 && <span className="eyebrow">הסבב הראשון עוד לא הסתיים.</span>}
                {(job.epochs_done ?? []).map((e) => (
                  <span key={e.epoch} className="border border-line bg-paper px-2">סבב {e.epoch} · {pct(e.val_accuracy)}</span>
                ))}
              </div>
            </div>
          )}

          {job && job.status === "failed" && (
            <p className="m-0 border border-danger p-3">האימון האחרון נכשל: {job.error}</p>
          )}
          {finished && <Outcome v={finished} usd={job?.result?.estimated_usd} again={job?.result?.rerecognize_pages} />}

          {versions.length > 0 && (
            <div className="grid gap-2">
              <span className="subtitle">גרסאות</span>
              <div className="overflow-x-auto">
                <table className="num w-full border-collapse text-[17px]">
                  <thead>
                    <tr className="text-[15px] text-muted">
                      <th className="border-b border-line p-2 text-start font-medium">גרסה</th>
                      <th className="border-b border-line p-2 text-start font-medium">שגיאות באותיות</th>
                      <th className="border-b border-line p-2 text-start font-medium">שגיאות במילים</th>
                      <th className="border-b border-line p-2 text-start font-medium">מצב</th>
                    </tr>
                  </thead>
                  <tbody>
                    {base && (
                      <tr>
                        <td className="border-b border-line p-2">מודל הבסיס</td>
                        <td className="border-b border-line p-2">{pct(base.cer)}</td>
                        <td className="border-b border-line p-2">{pct(base.wer)}</td>
                        <td className="border-b border-line p-2">{models?.active_model ? "נקודת המוצא" : <b>פעיל</b>}</td>
                      </tr>
                    )}
                    {versions.map((v) => (
                      <tr key={v.version} className={v.version === models?.active_model ? "bg-accent-tint" : ""}>
                        <td className="border-b border-line p-2">{v.version} · {dateHe(v.created_at)}</td>
                        <td className={`border-b border-line p-2 ${v.promoted ? "" : "text-danger"}`}>{pct(v.after?.cer)}</td>
                        <td className="border-b border-line p-2">{pct(v.after?.wer)}</td>
                        <td className="border-b border-line p-2">
                          {v.version === models?.active_model ? <b>פעילה</b> : v.promoted ? "הוחלפה בגרסה חדשה יותר" : "לא שיפרה, לא הוחלפה"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {lastRun && (
            <p className="m-0 border-s-2 border-line-strong ps-3 text-[15px] leading-[22px] text-muted">
              נמדד על עמודי הבדיקה {lastRun.test_pages.join(", ")} ({lastRun.test_lines} שורות, {lastRun.before.chars.toLocaleString("he-IL")} אותיות),
              שלא נכנסים לאימון אף פעם. תיקונים בעמודים האלה משפרים את המדידה, לא את המודל.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Fact({ value, label }: { value: string; label: string }) {
  return (
    <div className="grid gap-0.5 px-4 py-3 [&+&]:border-s [&+&]:border-line max-sm:[&+&]:border-s-0 max-sm:[&+&]:border-t">
      <span className="num font-text text-[30px] font-medium leading-[38px]">{value}</span>
      <span className="eyebrow">{label}</span>
    </div>
  );
}

function Outcome({ v, usd, again }: { v: Version; usd?: number; again?: number[] }) {
  return (
    <div className={`grid gap-1 border p-4 ${v.promoted ? "border-accent bg-accent-tint" : "border-line bg-surface"}`}>
      <span className="subtitle">
        {v.promoted ? `${v.version} שיפרה ועכשיו היא הפעילה` : `${v.version} לא שיפרה, והגרסה הקודמת נשארה`}
      </span>
      <span className="num">
        שגיאות באותיות: {pct(v.before.cer)} לפני, {pct(v.after?.cer)} אחרי. במילים: {pct(v.before.wer)} ← {pct(v.after?.wer)}.
      </span>
      <span className="eyebrow num">
        {Math.round(v.seconds / 60)} דקות{usd != null ? `, בערך ${usd.toFixed(2)}$` : ""}.
        {again && again.length > 0 ? ` עמודים ${again.join(", ")} מזוהים מחדש עם הגרסה החדשה.` : ""}
      </span>
    </div>
  );
}
