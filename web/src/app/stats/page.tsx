import Link from "next/link";
import { SignInAgain } from "@/components/SignInAgain";
import { TopBar } from "@/components/TopBar";
import { currentUser } from "@/lib/auth-server";
import { engineJson } from "@/lib/engine-server";

export const dynamic = "force-dynamic";

interface Training { slug: string; version: string; created_at: string; promoted: boolean; train_lines: number; cer_before: number | null; cer_after: number | null }
interface UserStats {
  user: string; display_name: string; role: string | null; active_minutes: number; days: number; logins: number;
  first_seen: string | null; last_seen: string | null; lines_approved: number; lines_corrected: number; lines_edited: number;
  lines_added: number; lines_deleted: number; lines_unapproved: number; pages: number; manuscripts: string[];
  trainings_started: number; pages_uploaded: number; approved_per_hour: number | null; trainings: Training[];
  per_day: { day: string; minutes: number; approved: number }[];
}

const PERIODS = [7, 30, 90] as const;
const hm = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("he-IL", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jerusalem" }) : "—";
const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(2)}%`);

export default async function Stats({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const user = await currentUser();
  if (!user) return <SignInAgain />;
  const days = PERIODS.includes(Number((await searchParams).days) as 7) ? Number((await searchParams).days) : 30;
  let data: { users: UserStats[] } | null = null;
  let error: string | null = null;
  try { data = await engineJson(`/v1/stats?days=${days}`, user.username); } catch (e) { error = (e as Error).message; }
  const rows = data?.users ?? [];
  const max = Math.max(1, ...rows.flatMap((r) => r.per_day.map((d) => d.minutes)));

  return (
    <>
      <TopBar user={user} />
      <main className="gutter py-8">
        <div className="mb-6 flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <h1 className="title m-0">סטטיסטיקה</h1>
          <span className="eyebrow">{user.role === "admin" ? "כל המשתמשים" : "העבודה שלך"}</span>
          <span className="flex-1" />
          <nav className="flex gap-1" aria-label="תקופה">
            {PERIODS.map((p) => (
              <Link key={p} href={`/stats?days=${p}`} aria-current={p === days ? "page" : undefined}
                    className={`btn min-h-10 ${p === days ? "border-2 border-accent bg-accent-tint" : ""}`}>{p} ימים</Link>
            ))}
          </nav>
        </div>
        {error && <p className="border border-line bg-surface p-4">לא הצלחתי לקרוא את הסטטיסטיקה. {error}</p>}
        {!error && rows.length === 0 && (
          <p className="text-muted">אין עדיין פעילות ב-{days} הימים האחרונים. זמן העבודה נספר מרגע שעובדים בעורך.</p>
        )}

        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="num w-full min-w-[900px] border-collapse text-[17px]">
              <thead>
                <tr className="text-[15px] text-muted">
                  {["משתמש", "זמן עבודה", "ימים", "שורות שאושרו", "מתוכן תוקנו", "נוספו", "נמחקו", "עמודים", "עמודים שצולמו", "שורות לשעה", "אימונים", "פעיל לאחרונה"].map((h) => (
                    <th key={h} className="border-b border-line p-2 text-start font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.user} className="align-top">
                    <td className="border-b border-line p-2">
                      <div className="font-medium">{r.display_name}</div>
                      <div className="eyebrow" dir="ltr">{r.user}</div>
                    </td>
                    <td className="border-b border-line p-2">{hm(r.active_minutes)}</td>
                    <td className="border-b border-line p-2">{r.days}</td>
                    <td className="border-b border-line p-2">{r.lines_approved}</td>
                    <td className="border-b border-line p-2">{r.lines_corrected}</td>
                    <td className="border-b border-line p-2">{r.lines_added}</td>
                    <td className="border-b border-line p-2">{r.lines_deleted}</td>
                    <td className="border-b border-line p-2">{r.pages}</td>
                    <td className="border-b border-line p-2">{r.pages_uploaded ?? 0}</td>
                    <td className="border-b border-line p-2">{r.approved_per_hour ?? "—"}</td>
                    <td className="border-b border-line p-2">{r.trainings_started}</td>
                    <td className="border-b border-line p-2 text-[15px]">{when(r.last_seen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-8 grid gap-8">
          {rows.map((r) => (
            <section key={r.user} className="grid gap-3" aria-label={`פירוט ${r.display_name}`}>
              <h2 className="subtitle m-0">{r.display_name}</h2>
              {r.per_day.length > 0 && (
                <div className="grid gap-1">
                  <span className="eyebrow">זמן עבודה ושורות שאושרו, לפי יום</span>
                  {r.per_day.map((d) => (
                    <div key={d.day} className="num grid grid-cols-[88px_minmax(0,1fr)_120px] items-center gap-3 text-[15px]">
                      <span className="text-muted">{new Date(d.day).toLocaleDateString("he-IL", { day: "numeric", month: "numeric" })}</span>
                      <span className="h-3 bg-line" aria-hidden><span className="block h-3 bg-accent" style={{ width: `${(d.minutes / max) * 100}%` }} /></span>
                      <span>{hm(d.minutes)} · {d.approved} שורות</span>
                    </div>
                  ))}
                </div>
              )}
              {r.trainings.length > 0 && (
                <div className="grid gap-1">
                  <span className="eyebrow">אימונים שהתחיל</span>
                  {r.trainings.map((t) => (
                    <div key={t.slug + t.version} className="num text-[15px]">
                      {t.slug} {t.version} · {when(t.created_at)} · {t.train_lines} שורות · שגיאות באותיות {pct(t.cer_before)} ← {pct(t.cer_after)} ·{" "}
                      {t.promoted ? <b>הוחלף לפעיל</b> : "לא שיפר, לא הוחלף"}
                    </div>
                  ))}
                </div>
              )}
              {r.per_day.length === 0 && r.trainings.length === 0 && <span className="eyebrow">אין פירוט לתקופה הזאת.</span>}
            </section>
          ))}
        </div>
        <p className="eyebrow mt-8 max-w-[70ch]">
          זמן עבודה נספר בעורך, דקה אחרי דקה, רק כשמקלידים או לוחצים בשתי הדקות האחרונות. "מתוכן תוקנו" הן שורות
          שאושרו עם קריאה שונה מזו של המנוע. "שורות לשעה" מחושב כשיש לפחות רבע שעה של עבודה.
        </p>
      </main>
    </>
  );
}
