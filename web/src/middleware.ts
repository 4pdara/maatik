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
  // Build the address from the forwarded host: behind Modal's proxy the request URL is internal.
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  const next = encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(`${proto}://${host}/login?next=${next}`);
}
