"use client";

import { useState } from "react";

/** Change your own display name and password. */
export function AccountForm({ username, displayName }: { username: string; displayName: string }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const patch: Record<string, string> = {};
    const name = String(f.get("display_name")).trim();
    if (name && name !== displayName) patch.display_name = name;
    const pw = String(f.get("password") ?? "").trim();
    if (pw) {
      if (pw !== String(f.get("password2") ?? "").trim()) { setMsg({ ok: false, text: "שתי הסיסמאות לא זהות." }); return; }
      patch.password = pw;
    }
    if (!Object.keys(patch).length) { setMsg({ ok: false, text: "לא שינית כלום." }); return; }
    const r = await fetch(`/api/engine/v1/users/${username}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg({ ok: false, text: typeof data.detail === "string" ? data.detail : `שגיאה ${r.status}` }); return; }
    setMsg({ ok: true, text: patch.password ? "נשמר. הסיסמה הוחלפה, ותצטרך להתחבר מחדש בעוד דקה." : "נשמר." });
    (e.target as HTMLFormElement).reset();
  }

  return (
    <form onSubmit={save} className="grid gap-4">
      <label className="grid gap-1"><span>שם לתצוגה</span>
        <input name="display_name" defaultValue={displayName} maxLength={60} className="field text-[19px]" />
      </label>
      <label className="grid gap-1"><span>סיסמה חדשה (לפחות 10 תווים, ריק אם לא משנים)</span>
        <input name="password" type="password" minLength={10} autoComplete="new-password" dir="ltr" className="field text-[19px]" />
      </label>
      <label className="grid gap-1"><span>הסיסמה החדשה שוב</span>
        <input name="password2" type="password" autoComplete="new-password" dir="ltr" className="field text-[19px]" />
      </label>
      {msg && <p className={`m-0 ${msg.ok ? "" : "text-danger"}`} role="status">{msg.text}</p>}
      <button className="btn btn-primary btn-big justify-self-start" type="submit">שמור</button>
    </form>
  );
}
