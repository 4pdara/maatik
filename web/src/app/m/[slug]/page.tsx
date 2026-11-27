import Link from "next/link";
import { TopBar } from "@/components/TopBar";
import { ManuscriptActions } from "@/components/ManuscriptActions";
import { engineJson } from "@/lib/engine-server";
import type { Manuscript, PageSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

function pageState(p: PageSummary): { text: string; cls: string } {
  if (!p.recognized) return { text: "לא זוהה", cls: "chip" };
  if (p.lines > 0 && p.approved === p.lines) return { text: "הוגה", cls: "chip chip-ok" };
  if (p.approved > 0) return { text: "בהגהה", cls: "chip" };
  return { text: "טרם הוגה", cls: "chip" };
}

export default async function ManuscriptPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let ms: Manuscript, pages: PageSummary[];
  try {
    [ms, pages] = await Promise.all([
      engineJson<Manuscript>(`/v1/manuscripts/${slug}`),
      engineJson<PageSummary[]>(`/v1/manuscripts/${slug}/pages`),
    ]);
  } catch (e) {
    return (
      <>
        <TopBar />
        <main className="gutter py-10"><p className="border border-line bg-surface p-4">לא הצלחתי לטעון את כתב היד. {(e as Error).message}</p></main>
      </>
    );
  }
  const total = pages.reduce((a, p) => a + p.lines, 0);
  const approved = pages.reduce((a, p) => a + p.approved, 0);
  const unrecognized = pages.filter((p) => !p.recognized).length;

  return (
    <>
      <TopBar crumbs={<b className="text-[17px] font-medium text-ink">{ms.name ?? slug}</b>}>
        <ManuscriptActions slug={slug} unrecognized={unrecognized} />
      </TopBar>
      <main className="gutter py-8">
        <div className="mb-6 flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <h1 className="title m-0">עמודים</h1>
          <span className="eyebrow num">{pages.length} עמודים · אושרו {approved} מתוך {total} שורות</span>
          <span className="eyebrow">{ms.active_model ? `מזהה עם המודל המכויל ${ms.active_model}` : "מזהה עם מודל הבסיס"}</span>
        </div>
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-5 max-sm:grid-cols-2 max-sm:gap-3">
          {pages.map((p) => {
            const st = pageState(p);
            const inner = (
              <>
                <div className="aspect-[2/3] overflow-hidden border border-line bg-scan">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/engine/v1/manuscripts/${slug}/pages/${p.page}/thumb`} alt={`סריקת עמוד ${p.page}`}
                       loading="lazy" className="h-full w-full object-cover" />
                </div>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-text text-[19px] font-medium">עמוד {p.page}</span>
                  {p.label && <span className="eyebrow">{p.label}</span>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className={st.cls}>{st.text}</span>
                  {p.test && <span className="chip chip-test" title="לא נכנס לאימון. משמש למדידה.">עמוד בדיקה</span>}
                </div>
                {p.recognized && <span className="eyebrow num">אושרו {p.approved} מתוך {p.lines}</span>}
              </>
            );
            return (
              <li key={p.page}>
                {p.recognized ? (
                  <Link href={`/m/${slug}/p/${p.page}`} className="grid gap-2 text-ink no-underline hover:[&_div:first-child]:border-accent">{inner}</Link>
                ) : (
                  <div className="grid gap-2 opacity-70">{inner}</div>
                )}
              </li>
            );
          })}
        </ul>
      </main>
    </>
  );
}
