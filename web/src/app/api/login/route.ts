import { NextRequest, NextResponse } from "next/server";
import { engineFetch } from "@/lib/engine-server";
import { clientKey, failed, locked, succeeded } from "@/lib/rate-limit";
import { COOKIE, MAX_AGE_SECONDS, makeSession, safeNext } from "@/lib/session";

export const dynamic = "force-dynamic";

const back = (error: string, next: string, username: string) =>
  new NextResponse(null, {
    status: 303,
    headers: { Location: `/login?error=${error}&next=${encodeURIComponent(next)}&u=${encodeURIComponent(username)}` },
  });

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const username = String(form.get("username") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const next = safeNext(String(form.get("next") ?? "/"));
  const keys = [`ip:${clientKey(req)}`, `user:${username}`];
  if (locked(...keys)) return back("locked", next, username);

  const r = await engineFetch("/v1/auth/verify", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }),
  });
  if (r.status === 401) {
    await failed(...keys);
    return back("wrong", next, username);
  }
  if (!r.ok) return back("engine", next, username);
  succeeded(...keys);
  const res = new NextResponse(null, { status: 303, headers: { Location: next } });
  const secure = (req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "")) === "https";
  res.cookies.set(COOKIE, await makeSession(username), { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: MAX_AGE_SECONDS });
  return res;
}
