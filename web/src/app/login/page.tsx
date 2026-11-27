import { safeNext } from "@/lib/session";
import { PasswordField } from "./PasswordField";

export const dynamic = "force-dynamic";

const MESSAGES: Record<string, string> = {
  wrong: "הסיסמה לא נכונה. נסה שוב.",
  locked: "יותר מדי ניסיונות. נסה שוב בעוד רבע שעה.",
};

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <main className="gutter grid min-h-dvh place-items-center py-10">
      <form method="post" action="/api/login" className="grid w-full max-w-[380px] gap-5">
        <div className="grid gap-1">
          <span className="font-text text-[26px] font-bold leading-8">מעתיק</span>
          <h1 className="title m-0">כניסה</h1>
        </div>
        <input type="hidden" name="next" value={safeNext(next)} />
        <PasswordField />
        {error && MESSAGES[error] && <p className="m-0 text-danger" role="alert">{MESSAGES[error]}</p>}
        <button className="btn btn-primary btn-big" type="submit">כניסה</button>
      </form>
    </main>
  );
}
