// Pass-through to the engine API, for the browser. Only the routes the editor uses.
import { NextRequest } from "next/server";
import { currentUser } from "@/lib/auth-server";
import { engineFetch } from "@/lib/engine-server";

export const dynamic = "force-dynamic";

const SLUG = "[a-z0-9][a-z0-9-]{0,63}";
const ALLOWED: Record<string, RegExp[]> = {
  GET: [
    /^v1\/health$/,
    /^v1\/manuscripts$/,
    new RegExp(`^v1/manuscripts/${SLUG}$`),
    new RegExp(`^v1/manuscripts/${SLUG}/(pages|models|training|export\\.txt)$`),
    new RegExp(`^v1/manuscripts/${SLUG}/pages/\\d{1,4}$`),
    new RegExp(`^v1/manuscripts/${SLUG}/pages/\\d{1,4}/(image|thumb)$`),
    /^v1\/jobs\/fc-[A-Za-z0-9]+$/,
    /^v1\/(stats|users)$/,
  ],
  PUT: [
    new RegExp(`^v1/manuscripts/${SLUG}/pages/\\d{1,4}$`), new RegExp(`^v1/manuscripts/${SLUG}/meta$`),
    /^v1\/users\/[a-z0-9][a-z0-9._-]{1,31}$/,
    new RegExp(`^v1/manuscripts/${SLUG}/pages/\\d{1,4}/image$`),
  ],
  POST: [
    /^v1\/(users|activity|manuscripts)$/,
    new RegExp(`^v1/manuscripts/${SLUG}/(calibrate|recognize-all)$`),
    new RegExp(`^v1/manuscripts/${SLUG}/pages/\\d{1,4}/(recognize|reading-order)$`),
  ],
};

async function pass(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const joined = path.join("/");
  if (!(ALLOWED[req.method] ?? []).some((re) => re.test(joined))) {
    return Response.json({ detail: "not allowed" }, { status: 404 });
  }
  const user = await currentUser();
  if (!user) return Response.json({ detail: "צריך להתחבר מחדש. רענן את העמוד." }, { status: 401 });
  const init: RequestInit = { method: req.method };
  if (req.method === "PUT" || req.method === "POST") {
    const body = await req.arrayBuffer();
    if (body.byteLength) {
      init.body = body;
      init.headers = { "Content-Type": req.headers.get("content-type") ?? "application/json" };
    }
  }
  try {
    let r = await engineFetch(`/${joined}${req.nextUrl.search}`, init, user.username === "local" ? undefined : user.username);
    // A read can fail for a moment while the engine's storage refreshes; try once more.
    if (req.method === "GET" && (r.status === 404 || r.status >= 500)) {
      await new Promise((ok) => setTimeout(ok, 400));
      r = await engineFetch(`/${joined}${req.nextUrl.search}`, init, user.username === "local" ? undefined : user.username);
    }
    const headers = new Headers();
    const type = r.headers.get("content-type");
    if (type) headers.set("Content-Type", type);
    // Scans never change (originals are never replaced), so the browser may keep them.
    headers.set("Cache-Control", /\/(image|thumb)$/.test(joined) ? "private, max-age=86400" : "no-store");
    return new Response(r.body, { status: r.status, headers });
  } catch (e) {
    return Response.json({ detail: `אין חיבור למנוע: ${(e as Error).message}` }, { status: 502 });
  }
}

export const GET = pass;
export const PUT = pass;
export const POST = pass;
