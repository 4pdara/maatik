"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { recognizeAll } from "@/lib/api";
import { TrainingDialog } from "./TrainingDialog";
import { Toast, useToast } from "./Toast";

export function ManuscriptActions({ slug, unrecognized }: { slug: string; unrecognized: number }) {
  const [train, setTrain] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const router = useRouter();

  async function recognize() {
    setBusy(true);
    try {
      const r = await recognizeAll(slug);
      toast.show(r.pages.length
        ? `מזהה ${r.pages.length} עמודים ברקע. רענן בעוד כמה דקות.`
        : "אין עמודים לזהות: כל העמודים כבר זוהו ויש בהם עבודה.");
      setTimeout(() => router.refresh(), 90000);
    } catch (e) {
      toast.show((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <a className="link" href={`/api/engine/v1/manuscripts/${slug}/export.txt`} target="_blank" rel="noreferrer">ייצוא לטקסט</a>
      <a className="btn" href={`/m/${slug}/capture`}>צלם עמודים</a>
      <button className="btn" onClick={recognize} disabled={busy}
              title="מזהה עם המודל הפעיל את כל העמודים שאין בהם עדיין עבודה שלך">
        {unrecognized ? `זהה ${unrecognized} עמודים שלא זוהו` : "זהה עמודים שלא הוגהו"}
      </button>
      <button className="btn btn-primary" onClick={() => setTrain(true)}>שפר את המודל</button>
      {train && <TrainingDialog slug={slug} onClose={() => { setTrain(false); router.refresh(); }} />}
      <Toast state={toast} />
    </>
  );
}
