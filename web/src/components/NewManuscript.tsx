"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

/** "New manuscript": a name, then straight to photographing its pages. */
export function NewManuscript() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/engine/v1/manuscripts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: f.get("name"), source: f.get("source") }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof data.detail === "string" ? data.detail : `שגיאה ${r.status}`);
      router.push(`/m/${data.slug}/capture`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (!open) return <button className="btn btn-primary" onClick={() => setOpen(true)}><Plus size={18} strokeWidth={1.5} /> כתב יד חדש</button>;
  return (
    <form onSubmit={create} className="grid w-full max-w-[560px] gap-3 border border-line bg-surface p-5">
      <label className="grid gap-1"><span>שם כתב היד</span><input name="name" required maxLength={200} autoFocus className="field text-[19px]" /></label>
      <label className="grid gap-1"><span>מקור (לא חובה): ספרייה, מספר כתב יד, בעלים</span><input name="source" maxLength={500} className="field text-[17px]" /></label>
      {error && <p className="m-0 text-danger" role="alert">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "יוצר…" : "צור ועבור לצילום"}</button>
        <button className="btn btn-quiet" type="button" onClick={() => setOpen(false)}>ביטול</button>
      </div>
    </form>
  );
}
