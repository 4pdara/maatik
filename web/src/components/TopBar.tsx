import Link from "next/link";

/** The header line every screen shares: product name, where you are, and screen actions. */
export function TopBar({ crumbs, children }: { crumbs?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header className="gutter sticky top-0 z-20 flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line bg-paper py-3 max-sm:static">
      <Link href="/" className="font-text text-[26px] font-bold leading-8 text-ink no-underline">
        מעתיק
      </Link>
      {crumbs && <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 text-[15px] text-muted max-sm:order-3 max-sm:basis-full">{crumbs}</div>}
      <span className="flex-1" />
      <div className="flex flex-wrap items-center gap-4">{children}</div>
    </header>
  );
}
