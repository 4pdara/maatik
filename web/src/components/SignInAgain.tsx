/** Shown when a session is no longer valid (user blocked, or the password was changed). */
export function SignInAgain() {
  return (
    <main className="gutter grid min-h-dvh place-items-center py-10">
      <div className="grid max-w-[420px] gap-4">
        <span className="font-text text-[26px] font-bold leading-8">מעתיק</span>
        <p className="m-0">צריך להתחבר מחדש: הסיסמה של המשתמש שונתה, או שהמשתמש נחסם.</p>
        <form method="post" action="/api/logout"><button className="btn btn-primary btn-big" type="submit">לדף הכניסה</button></form>
      </div>
    </main>
  );
}
