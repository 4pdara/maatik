import { Editor } from "@/components/Editor";
import { SignInAgain } from "@/components/SignInAgain";
import { TopBar } from "@/components/TopBar";
import { currentUser } from "@/lib/auth-server";
import { engineJson } from "@/lib/engine-server";
import type { Manuscript, PageSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function EditorPage({ params }: { params: Promise<{ slug: string; page: string }> }) {
  const { slug, page } = await params;
  const n = Number(page);
  const user = await currentUser();
  if (!user) return <SignInAgain />;
  try {
    const [ms, pages] = await Promise.all([
      engineJson<Manuscript>(`/v1/manuscripts/${slug}`),
      engineJson<PageSummary[]>(`/v1/manuscripts/${slug}/pages`),
    ]);
    return <Editor slug={slug} pageNo={n} manuscript={ms} user={user ? { display_name: user.display_name, role: user.role } : null} pages={pages.filter((p) => p.recognized).map((p) => p.page)} />;
  } catch (e) {
    return (
      <>
        <TopBar />
        <main className="gutter py-10"><p className="border border-line bg-surface p-4">לא הצלחתי לטעון את העמוד. {(e as Error).message}</p></main>
      </>
    );
  }
}
