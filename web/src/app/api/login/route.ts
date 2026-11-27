import { NextRequest, NextResponse } from "next/server";
import { COOKIE, MAX_AGE_SECONDS, makeSession, passwordMatches, safeNext } from "@/lib/session";

export const dynamic = "force-dynamic";

// Slow down guessing: a short pause on every failure, and a lockout per address after many.
const failures = new Map<string, { count: number; since: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;

function clientKey(req: NextRequest): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "local";
}

function redirectTo(_req: NextRequest, path: string) {
  // A relative redirect: behind Modal's proxy the server does not know its public address.
  return new NextResponse(null, { status: 303, headers: { Location: path } });
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const password = String(form.get("password") ?? "");
  const next = safeNext(String(form.get("next") ?? "/"));
  const key = clientKey(req);
  const now = Date.now();
  const f = failures.get(key);
  if (f && now - f.since < WINDOW_MS && f.count >= MAX_FAILURES) {
    return redirectTo(req, `/login?error=locked&next=${encodeURIComponent(next)}`);
  }
  if (!(await passwordMatches(password))) {
    const cur = f && now - f.since < WINDOW_MS ? f : { count: 0, since: now };
    cur.count += 1;
    failures.set(key, cur);
    await new Promise((ok) => setTimeout(ok, 1000));
    return redirectTo(req, `/login?error=wrong&next=${encodeURIComponent(next)}`);
  }
  failures.delete(key);
  const res = redirectTo(req, next);
  const secure = (req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "")) === "https";
  res.cookies.set(COOKIE, await makeSession(), { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: MAX_AGE_SECONDS });
  return res;
}
