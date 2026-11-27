import Link from "next/link";
import { NewManuscript } from "@/components/NewManuscript";
import { SignInAgain } from "@/components/SignInAgain";
import { TopBar } from "@/components/TopBar";
import { currentUser } from "@/lib/auth-server";
import { engineJson } from "@/lib/engine-server";

export const dynamic = "force-dynamic";

interface Row { slug: string; name: string | null; pages: number }

/** Where the Android app lands when files are shared to it (from DocScan or any app):
 *  choose the manuscript, then the capture page uploads them. */
export default async function Share({ searchParams }: { searchParams: Promise<{ n?: string }> }) {
  const user = await currentUser();
  if (!user) return <SignInAgain />;
  const n = Math.max(0, Math.min(500, Number((await searchParams).n) || 0));
  let rows: Row[] = [];
  try { rows = (await engineJson<Row[]>("/v1/manuscripts", user.username)).filter((r) => !r.slug.startsWith("synthetic-")); } catch { rows = []; }
  return (
    <>
      <TopBar user={user} />
      <main className="gutter mx-auto max-w-[800px] py-8">
        <h1 className="title mb-2">לאיזה כתב יד להעלות?</h1>
        <p className="eyebrow mb-6">{n === 1 ? "קובץ אחד שותף למעתיק." : `${n} קבצים שותפו למעתיק.`} העמודים יתווספו בסוף כתב היד שתבחר.</p>
        <ul className="mb-6 grid gap-0 border-t border-line">
          {rows.map((r) => (
            <li key={r.slug} className="border-b border-line">
              <Link href={`/m/${r.slug}/capture?shared=${n}`} className="flex flex-wrap items-baseline gap-x-6 px-2 py-4 text-ink no-underline hover:bg-surface">
                <span className="subtitle min-w-0 flex-1">{r.name ?? r.slug}</span>
                <span className="eyebrow num">{r.pages === 1 ? "עמוד אחד" : `${r.pages} עמודים`}</span>
              </Link>
            </li>
          ))}
        </ul>
        <NewManuscript sharedCount={n} />
      </main>
    </>
  );
}
