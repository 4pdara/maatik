// Who is logged in, for server pages and route handlers.
import "server-only";
import { cookies } from "next/headers";
import { engineFetch } from "./engine-server";
import { COOKIE, authOn, readSession } from "./session";

export interface SiteUser { username: string; display_name: string; role: "admin" | "editor"; disabled?: boolean; password_changed_at?: string }

// Users change rarely; ask the engine at most once a minute per user.
const cache = new Map<string, { at: number; user: SiteUser | null }>();

async function lookUp(username: string): Promise<SiteUser | null> {
  const hit = cache.get(username);
  if (hit && Date.now() - hit.at < 60_000) return hit.user;
  const r = await engineFetch(`/v1/users/${username}`);
  const user = r.ok ? ((await r.json()) as SiteUser) : null;
  if (r.ok || r.status === 404) cache.set(username, { at: Date.now(), user });
  return user;
}

export function forgetUser(username: string) {
  cache.delete(username);
}

/** The logged-in user. Locally (no login) everyone is "local". Null when not logged in,
 *  blocked, or logged in before their password was last changed. */
export async function currentUser(): Promise<SiteUser | null> {
  if (!authOn()) return { username: "local", display_name: "עבודה מקומית", role: "admin" };
  const s = await readSession((await cookies()).get(COOKIE)?.value);
  if (!s) return null;
  const u = await lookUp(s.username);
  if (!u || u.disabled) return null;
  if (u.password_changed_at && s.issuedAt < Date.parse(u.password_changed_at) / 1000 - 5) return null;
  return u;
}
