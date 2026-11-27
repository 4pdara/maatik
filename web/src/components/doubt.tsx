import type { Line } from "@/lib/types";
import { UNSURE_BELOW } from "@/lib/types";

/** Words the engine was unsure of, as long as the line still reads as the engine read it
 *  (after an edit the word boxes no longer match the text). */
export function doubtfulWords(l: Line): string[] {
  if (l.status === "approved" || l.source !== "engine" || l.text !== l.engine_text) return [];
  return l.words.filter((w) => w.doubtful || (w.confidence ?? 1) < UNSURE_BELOW).map((w) => w.text)
    .filter((t) => /[א-ת]/.test(t));
}

export const isDoubtful = (l: Line) => doubtfulWords(l).length > 0;

/** The line text with the unsure words marked. */
export function MarkedText({ line }: { line: Line }) {
  const unsure = new Set(doubtfulWords(line));
  if (!unsure.size) return <>{line.text || <span className="text-muted">(שורה ריקה)</span>}</>;
  const parts = line.text.split(/(\s+)/);
  return <>{parts.map((p, i) => (unsure.has(p) ? <span key={i} className="doubt-word">{p}</span> : <span key={i}>{p}</span>))}</>;
}
