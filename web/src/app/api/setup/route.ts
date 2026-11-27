// Creates the first user (an admin), once, proving ownership with the site password.
import { NextRequest, NextResponse } from "next/server";
import { engineFetch } from "@/lib/engine-server";
import { clientKey, failed, locked, succeeded } from "@/lib/rate-limit";
import { COOKIE, MAX_AGE_SECONDS, makeSession, sitePasswordMatches } from "@/lib/session";

export const dynamic = "force-dynamic";

const back = (error: string, detail = "") =>
  new NextResponse(null, { status: 303, headers: { Location: `/login?setup_error=${error}&d=${encodeURIComponent(detail)}` } });

export async function POST(req: NextRequest) {
  const f = await req.formData();
  const get = (k: string) => String(f.get(k) ?? "");
  const key = `setup:${clientKey(req)}`;
  if (locked(key)) return back("locked");

  const existing = await engineFetch("/v1/users");
  if (!existing.ok) return back("engine");
  if (((await existing.json()) as unknown[]).length > 0) return back("done");
  if (!(await sitePasswordMatches(get("site_password")))) {
    await failed(key);
    return back("site_password");
  }
  if (get("password").trim() !== get("password2").trim()) return back("mismatch");

  const username = get("username").trim().toLowerCase();
  const r = await engineFetch("/v1/users", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, display_name: get("display_name"), password: get("password"), role: "admin" }),
  });
  if (!r.ok) {
    let detail = "";
    try { detail = String((await r.json()).detail ?? ""); } catch { /* not JSON */ }
    return back("invalid", detail);
  }
  succeeded(key);
  const res = new NextResponse(null, { status: 303, headers: { Location: "/" } });
  const secure = (req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "")) === "https";
  res.cookies.set(COOKIE, await makeSession(username), { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: MAX_AGE_SECONDS });
  return res;
}
