import { SignInAgain } from "@/components/SignInAgain";
import { TopBar } from "@/components/TopBar";
import { UsersAdmin, type AdminUser } from "@/components/UsersAdmin";
import { currentUser } from "@/lib/auth-server";
import { engineJson } from "@/lib/engine-server";

export const dynamic = "force-dynamic";

export default async function Users() {
  const user = await currentUser();
  if (!user) return <SignInAgain />;
  if (user.role !== "admin") {
    return (
      <>
        <TopBar user={user} />
        <main className="gutter py-10"><p>רק מנהל יכול לנהל משתמשים.</p></main>
      </>
    );
  }
  let list: AdminUser[] = [];
  let error: string | null = null;
  try { list = await engineJson<AdminUser[]>("/v1/users", user.username); } catch (e) { error = (e as Error).message; }
  return (
    <>
      <TopBar user={user} />
      <main className="gutter mx-auto max-w-[1100px] py-8">
        <h1 className="title mb-6">משתמשים</h1>
        {error ? <p className="border border-line bg-surface p-4">לא הצלחתי לקרוא את רשימת המשתמשים. {error}</p>
               : <UsersAdmin initial={list} me={user.username} />}
      </main>
    </>
  );
}
