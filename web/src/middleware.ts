import { NextRequest, NextResponse } from "next/server";
import { COOKIE, authMode, validSession } from "@/lib/session";

// Everything except the login page itself and static files needs a session when a password is set.
export const config = { matcher: ["/((?!login|api/login|_next/static|_next/image|icon.svg|favicon.ico).*)"] };

export async function middleware(req: NextRequest) {
  const mode = authMode();
  if (mode === "off") return NextResponse.next();
  if (mode === "misconfigured") {
    return new NextResponse("האתר לא הוגדר: חסרה סיסמת כניסה (MAATIK_WEB_PASSWORD).", {
      status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  if (await validSession(req.cookies.get(COOKIE)?.value)) return NextResponse.next();
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ detail: "צריך להתחבר מחדש. רענן את העמוד." }, { status: 401 });
  }
  // Show the login page at the requested address (a rewrite, not a redirect): behind
  // Modal's proxy the server does not know its own public address.
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
  return NextResponse.rewrite(url, { headers: { "Cache-Control": "no-store" } });
}
