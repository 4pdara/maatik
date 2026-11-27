// Slow down password guessing: a pause on every failure, and a lockout after many,
// per address and per user name (in memory, per server; enough for a handful of users).
import type { NextRequest } from "next/server";

const failures = new Map<string, { count: number; since: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;

export function clientKey(req: NextRequest): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "local";
}

export function locked(...keys: string[]): boolean {
  const now = Date.now();
  return keys.some((k) => {
    const f = failures.get(k);
    return !!f && now - f.since < WINDOW_MS && f.count >= MAX_FAILURES;
  });
}

export async function failed(...keys: string[]) {
  const now = Date.now();
  for (const k of keys) {
    const f = failures.get(k);
    const cur = f && now - f.since < WINDOW_MS ? f : { count: 0, since: now };
    cur.count += 1;
    failures.set(k, cur);
  }
  await new Promise((ok) => setTimeout(ok, 1000));
}

export function succeeded(...keys: string[]) {
  for (const k of keys) failures.delete(k);
}

/** A relative redirect: behind Modal's proxy the server does not know its public address. */
export function seeOther(path: string, init?: { headers?: Record<string, string> }) {
  return new Response(null, { status: 303, headers: { Location: path, ...(init?.headers ?? {}) } });
}
