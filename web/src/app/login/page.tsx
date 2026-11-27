import { engineJson } from "@/lib/engine-server";
import { safeNext } from "@/lib/session";
import { PasswordField } from "./PasswordField";

export const dynamic = "force-dynamic";

const LOGIN_ERRORS: Record<string, string> = {
  wrong: "שם המשתמש או הסיסמה לא נכונים.",
  locked: "יותר מדי ניסיונות. נסה שוב בעוד רבע שעה.",
  engine: "אין כרגע חיבור למנוע. נסה שוב בעוד דקה.",
};
const SETUP_ERRORS: Record<string, string> = {
  site_password: "סיסמת האתר לא נכונה.",
  mismatch: "שתי הסיסמאות החדשות לא זהות.",
  locked: "יותר מדי ניסיונות. נסה שוב בעוד רבע שעה.",
  done: "כבר יש משתמשים. התחבר עם שם משתמש וסיסמה.",
  engine: "אין כרגע חיבור למנוע. נסה שוב בעוד דקה.",
  invalid: "",
};

export default async function Login({ searchParams }: {
  searchParams: Promise<{ next?: string; error?: string; u?: string; setup_error?: string; d?: string }>;
}) {
  const sp = await searchParams;
  let users: unknown[] | null = null;
  try { users = await engineJson<unknown[]>("/v1/users"); } catch { users = null; }
  const setup = users !== null && users.length === 0;

  return (
    <main className="gutter grid min-h-dvh place-items-center py-10">
      <div className="grid w-full max-w-[400px] gap-5">
        <div className="grid gap-1">
          <span className="font-text text-[26px] font-bold leading-8">מעתיק</span>
          <h1 className="title m-0">{setup ? "הקמת המשתמש הראשון" : "כניסה"}</h1>
        </div>

        {users === null && <p className="m-0 text-danger" role="alert">{LOGIN_ERRORS.engine}</p>}

        {!setup && users !== null && (
          <form method="post" action="/api/login" className="grid gap-5">
            <input type="hidden" name="next" value={safeNext(sp.next)} />
            <label className="grid gap-2">
              <span>שם משתמש</span>
              <input name="username" required autoFocus={!sp.u} defaultValue={sp.u ?? ""} autoComplete="username"
                     autoCapitalize="off" autoCorrect="off" spellCheck={false} dir="ltr" className="field text-[20px]" />
            </label>
            <PasswordField autoFocus={!!sp.u} />
            {sp.error && LOGIN_ERRORS[sp.error] && <p className="m-0 text-danger" role="alert">{LOGIN_ERRORS[sp.error]}</p>}
            <button className="btn btn-primary btn-big" type="submit">כניסה</button>
          </form>
        )}

        {setup && (
          <form method="post" action="/api/setup" className="grid gap-5">
            <p className="m-0">
              עדיין אין משתמשים. כאן יוצרים את המשתמש הראשון, שיהיה המנהל. כדי להוכיח שזה אתה, צריך את סיסמת האתר
              (הסוד MAATIK_WEB_PASSWORD ב-GitHub). אחר כך נכנסים רק עם שם משתמש וסיסמה.
            </p>
            <PasswordField name="site_password" label="סיסמת האתר" autoComplete="off" autoFocus />
            <label className="grid gap-2">
              <span>שם משתמש (באנגלית, למשל uriel)</span>
              <input name="username" required pattern="[a-z0-9][a-z0-9._\-]{1,31}" autoComplete="username"
                     autoCapitalize="off" autoCorrect="off" spellCheck={false} dir="ltr" className="field text-[20px]" />
            </label>
            <label className="grid gap-2">
              <span>שם לתצוגה</span>
              <input name="display_name" required maxLength={60} className="field text-[20px]" />
            </label>
            <PasswordField name="password" label="סיסמה חדשה (לפחות 10 תווים)" autoComplete="new-password" />
            <PasswordField name="password2" label="הסיסמה החדשה שוב" autoComplete="new-password" />
            {sp.setup_error && (
              <p className="m-0 text-danger" role="alert">{SETUP_ERRORS[sp.setup_error] || sp.d || "לא הצלחתי ליצור את המשתמש."}</p>
            )}
            <button className="btn btn-primary btn-big" type="submit">צור משתמש והיכנס</button>
          </form>
        )}
      </div>
    </main>
  );
}
