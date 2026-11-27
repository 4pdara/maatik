import Link from "next/link";
import { SignInAgain } from "@/components/SignInAgain";
import { TopBar } from "@/components/TopBar";
import { engineJson } from "@/lib/engine-server";
import { currentUser } from "@/lib/auth-server";

export const dynamic = "force-dynamic";

interface Row { slug: string; name: string | null; active_model: string | null; pages: number }

export default async function Home() {
  const user = await currentUser();
  if (!user) return <SignInAgain />;
  let rows: Row[] = [];
  let error: string | null = null;
  try {
    rows = (await engineJson<Row[]>("/v1/manuscripts")).filter((r) => !r.slug.startsWith("synthetic-"));
  } catch (e) {
    error = (e as Error).message;
  }
  return (
    <>
      <TopBar user={user} />
      <main className="gutter mx-auto max-w-[1100px] py-10">
        <h1 className="title mb-6">כתבי היד</h1>
        {error && (
          <p className="border border-line bg-surface p-4">
            לא הצלחתי לקרוא את רשימת כתבי היד מהמנוע. {error}
          </p>
        )}
        {!error && rows.length === 0 && (
          <p className="text-muted">אין עדיין כתבי יד. מעלים סריקות עם engine/scripts/engine_client.py upload.</p>
        )}
        <ul className="grid gap-0 border-t border-line">
          {rows.map((r) => (
            <li key={r.slug} className="border-b border-line">
              <Link href={`/m/${r.slug}`} className="flex flex-wrap items-baseline gap-x-6 gap-y-1 px-2 py-4 text-ink no-underline hover:bg-surface">
                <span className="subtitle min-w-0 flex-1">{r.name ?? r.slug}</span>
                <span className="eyebrow num">{r.pages === 1 ? "עמוד אחד" : `${r.pages} עמודים`}</span>
                <span className="eyebrow">{r.active_model ? `מודל מכויל ${r.active_model}` : "מודל הבסיס"}</span>
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
