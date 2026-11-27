import { NextRequest, NextResponse } from "next/server";
import { COOKIE, authOn, readSession } from "@/lib/session";

// Everything except the login page itself, its two form targets and static files needs a session.
export const config = { matcher: ["/((?!login|api/login|api/setup|_next/static|_next/image|icon.svg|favicon.ico).*)"] };

export async function middleware(req: NextRequest) {
  if (!authOn()) return NextResponse.next();
  // The signature is checked here; whether the user is still allowed is checked by the
  // pages and the engine pass-through (they ask the engine).
  if (await readSession(req.cookies.get(COOKIE)?.value)) return NextResponse.next();
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
