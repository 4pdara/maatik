"use client";

import { useState } from "react";

export interface AdminUser {
  username: string; display_name: string; role: "admin" | "editor"; disabled: boolean;
  created_at: string; created_by: string | null; password_changed_at: string;
}

const ROLE: Record<string, string> = { admin: "מנהל", editor: "מגיה" };

async function send(path: string, method: "POST" | "PUT", body: unknown): Promise<AdminUser> {
  const r = await fetch(`/api/engine/${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof data.detail === "string" ? data.detail : `שגיאה ${r.status}`);
  return data as AdminUser;
}

/** Admin screen: add users, reset passwords, change roles, block and unblock. */
export function UsersAdmin({ initial, me }: { initial: AdminUser[]; me: string }) {
  const [users, setUsers] = useState(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [resetFor, setResetFor] = useState<string | null>(null);

  const replace = (u: AdminUser) => setUsers((us) => us.map((x) => (x.username === u.username ? u : x)));

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      const u = await send("v1/users", "POST", {
        username: String(f.get("username")).trim().toLowerCase(), display_name: f.get("display_name"),
        password: f.get("password"), role: f.get("role"),
      });
      setUsers((us) => [...us, u]);
      (e.target as HTMLFormElement).reset();
      setMsg({ ok: true, text: `המשתמש ${u.display_name} נוסף. מסור לו את שם המשתמש ואת הסיסמה.` });
    } catch (err) { setMsg({ ok: false, text: (err as Error).message }); }
  }

  async function update(username: string, patch: Record<string, unknown>, done: string) {
    try {
      replace(await send(`v1/users/${username}`, "PUT", patch));
      setMsg({ ok: true, text: done });
    } catch (err) { setMsg({ ok: false, text: (err as Error).message }); }
  }

  return (
    <div className="grid gap-8">
      {msg && <p className={`m-0 border p-3 ${msg.ok ? "border-accent bg-accent-tint" : "border-danger text-danger"}`} role="status">{msg.text}</p>}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-[17px]">
          <thead>
            <tr className="text-[15px] text-muted">
              {["שם", "שם משתמש", "תפקיד", "מצב", "נוצר", ""].map((h, i) => <th key={i} className="border-b border-line p-2 text-start font-medium">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.username} className={u.disabled ? "text-muted" : ""}>
                <td className="border-b border-line p-2">{u.display_name}{u.username === me ? " (אתה)" : ""}</td>
                <td className="border-b border-line p-2" dir="ltr">{u.username}</td>
                <td className="border-b border-line p-2">
                  <select className="border border-line bg-surface px-2 py-0.5 text-[15px]" value={u.role} disabled={u.username === me}
                          aria-label={`תפקיד של ${u.display_name}`}
                          onChange={(e) => update(u.username, { role: e.target.value }, "התפקיד עודכן.")}>
                    <option value="editor">{ROLE.editor}</option>
                    <option value="admin">{ROLE.admin}</option>
                  </select>
                </td>
                <td className="border-b border-line p-2">{u.disabled ? "חסום" : "פעיל"}</td>
                <td className="num border-b border-line p-2 text-[15px]">{new Date(u.created_at).toLocaleDateString("he-IL")}</td>
                <td className="border-b border-line p-2">
                  <div className="flex flex-wrap gap-3">
                    <button className="link" onClick={() => setResetFor(resetFor === u.username ? null : u.username)}>סיסמה חדשה</button>
                    {u.username !== me && (
                      <button className={u.disabled ? "link" : "link text-danger"}
                              onClick={() => update(u.username, { disabled: !u.disabled }, u.disabled ? "המשתמש שוחרר." : "המשתמש נחסם ולא יוכל להיכנס.")}>
                        {u.disabled ? "שחרר" : "חסום"}
                      </button>
                    )}
                  </div>
                  {resetFor === u.username && (
                    <form className="mt-2 flex flex-wrap items-center gap-2"
                          onSubmit={(e) => {
                            e.preventDefault();
                            const pw = String(new FormData(e.currentTarget).get("password"));
                            void update(u.username, { password: pw }, `הסיסמה של ${u.display_name} הוחלפה. הוא יצטרך להתחבר מחדש.`);
                            setResetFor(null);
                          }}>
                      <input name="password" type="text" required minLength={10} autoComplete="off" dir="ltr"
                             placeholder="לפחות 10 תווים" aria-label="סיסמה חדשה" className="field w-56 text-[17px]" />
                      <button className="btn" type="submit">שמור</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form onSubmit={create} className="grid max-w-[560px] gap-4 border border-line bg-surface p-5">
        <h2 className="subtitle m-0">הוספת משתמש</h2>
        <label className="grid gap-1"><span>שם לתצוגה</span><input name="display_name" required maxLength={60} className="field text-[19px]" /></label>
        <label className="grid gap-1"><span>שם משתמש (באנגלית, אותיות קטנות)</span>
          <input name="username" required pattern="[a-z0-9][a-z0-9._\-]{1,31}" dir="ltr" autoCapitalize="off" autoCorrect="off" spellCheck={false} className="field text-[19px]" />
        </label>
        <label className="grid gap-1"><span>סיסמה ראשונית (לפחות 10 תווים)</span>
          <input name="password" type="text" required minLength={10} autoComplete="off" dir="ltr" className="field text-[19px]" />
        </label>
        <label className="grid gap-1"><span>תפקיד</span>
          <select name="role" defaultValue="editor" className="border border-line bg-paper px-2 py-1">
            <option value="editor">מגיה: מגיה ומאמן</option>
            <option value="admin">מנהל: גם מנהל משתמשים ורואה את הסטטיסטיקה של כולם</option>
          </select>
        </label>
        <button className="btn btn-primary btn-big justify-self-start" type="submit">הוסף משתמש</button>
      </form>
    </div>
  );
}
