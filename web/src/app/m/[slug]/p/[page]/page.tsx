import { Editor } from "@/components/Editor";
import { TopBar } from "@/components/TopBar";
import { engineJson } from "@/lib/engine-server";
import type { Manuscript, PageSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function EditorPage({ params }: { params: Promise<{ slug: string; page: string }> }) {
  const { slug, page } = await params;
  const n = Number(page);
  try {
    const [ms, pages] = await Promise.all([
      engineJson<Manuscript>(`/v1/manuscripts/${slug}`),
      engineJson<PageSummary[]>(`/v1/manuscripts/${slug}/pages`),
    ]);
    return <Editor slug={slug} pageNo={n} manuscript={ms} pages={pages.filter((p) => p.recognized).map((p) => p.page)} />;
  } catch (e) {
    return (
      <>
        <TopBar />
        <main className="gutter py-10"><p className="border border-line bg-surface p-4">לא הצלחתי לטעון את העמוד. {(e as Error).message}</p></main>
      </>
    );
  }
}
