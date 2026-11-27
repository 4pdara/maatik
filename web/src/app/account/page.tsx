import { AccountForm } from "@/components/AccountForm";
import { SignInAgain } from "@/components/SignInAgain";
import { TopBar } from "@/components/TopBar";
import { currentUser } from "@/lib/auth-server";

export const dynamic = "force-dynamic";

export default async function Account() {
  const user = await currentUser();
  if (!user) return <SignInAgain />;
  return (
    <>
      <TopBar user={user} />
      <main className="gutter mx-auto max-w-[640px] py-8">
        <h1 className="title mb-2">החשבון שלי</h1>
        <p className="eyebrow mb-6" dir="ltr">{user.username}</p>
        <AccountForm username={user.username} displayName={user.display_name} />
      </main>
    </>
  );
}
