import { Capture } from "@/components/Capture";
import { SignInAgain } from "@/components/SignInAgain";
import { TopBar } from "@/components/TopBar";
import { currentUser } from "@/lib/auth-server";
import { engineJson } from "@/lib/engine-server";
import type { Manuscript, PageSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function CapturePage({ params, searchParams }: {
  params: Promise<{ slug: string }>; searchParams: Promise<{ shared?: string }>;
}) {
  const { slug } = await params;
  const shared = Math.max(0, Math.min(500, Number((await searchParams).shared) || 0));
  const user = await currentUser();
  if (!user) return <SignInAgain />;
  try {
    const [ms, pages] = await Promise.all([
      engineJson<Manuscript>(`/v1/manuscripts/${slug}`),
      engineJson<PageSummary[]>(`/v1/manuscripts/${slug}/pages`),
    ]);
    const next = pages.reduce((m, p) => Math.max(m, p.page), 0) + 1;
    return (
      <>
        <TopBar user={user} />
        <main className="gutter mx-auto max-w-[1000px] py-6">
          <Capture slug={slug} name={ms.name ?? slug} firstPage={next} shared={shared} />
        </main>
      </>
    );
  } catch (e) {
    return (
      <>
        <TopBar user={user} />
        <main className="gutter py-10"><p className="border border-line bg-surface p-4">לא הצלחתי לטעון את כתב היד. {(e as Error).message}</p></main>
      </>
    );
  }
}
