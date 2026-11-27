import Link from "next/link";

export interface BarUser { display_name: string; role: string }

/** The header line every screen shares: product name, where you are, screen actions, and who is logged in. */
export function TopBar({ crumbs, children, user }: { crumbs?: React.ReactNode; children?: React.ReactNode; user?: BarUser | null }) {
  return (
    <header className="gutter sticky top-0 z-20 flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line bg-paper py-3 max-sm:static">
      <Link href="/" className="font-text text-[26px] font-bold leading-8 text-ink no-underline">
        מעתיק
      </Link>
      {crumbs && <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 text-[15px] text-muted max-sm:order-3 max-sm:basis-full">{crumbs}</div>}
      <span className="flex-1" />
      <div className="flex flex-wrap items-center gap-4">{children}</div>
      {user && (
        <nav className="flex flex-wrap items-center gap-x-4 gap-y-1 border-s border-line ps-4 text-[15px] max-sm:order-4 max-sm:basis-full max-sm:border-s-0 max-sm:ps-0"
             aria-label="חשבון">
          <Link href="/account" className="text-ink" title="החשבון שלי">{user.display_name}</Link>
          <Link href="/stats" className="link">סטטיסטיקה</Link>
          {user.role === "admin" && <Link href="/users" className="link">משתמשים</Link>}
          <form method="post" action="/api/logout"><button className="link" type="submit">יציאה</button></form>
        </nav>
      )}
    </header>
  );
}
