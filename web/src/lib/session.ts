// Login sessions for the deployed site. Works in middleware (edge) and in route handlers.
//
// MAATIK_REQUIRE_PASSWORD=1 (set on Modal) -> every page needs a signed session cookie
//   naming a user. Users are kept by the engine (/v1/users).
// Not set (local `npm run dev`) -> no login.
// MAATIK_WEB_PASSWORD is the site password: it is needed only once, to create the first
//   user (an admin) on the setup page.
export const COOKIE = "maatik_session";
export const MAX_AGE_SECONDS = 30 * 24 * 3600;

export function authOn(): boolean {
  return process.env.MAATIK_REQUIRE_PASSWORD === "1";
}

const enc = new TextEncoder();

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

function sessionKey(): string {
  // Rotating the engine token signs everyone out.
  return `maatik-session-v2\u0000${process.env.MAATIK_API_TOKEN ?? process.env.MODAL_TOKEN_SECRET ?? ""}`;
}

function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function makeSession(username: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS;
  return `${username}.${exp}.${await hmacHex(sessionKey(), `${username}|${exp}`)}`;
}

/** The session's user and when it was issued, or null if the cookie is missing, forged or expired. */
export async function readSession(value: string | undefined): Promise<{ username: string; issuedAt: number } | null> {
  const m = value?.match(/^([a-z0-9][a-z0-9._-]{1,31})\.(\d+)\.([0-9a-f]{64})$/);
  if (!m) return null;
  const [, username, exp, sig] = m;
  if (Number(exp) < Date.now() / 1000) return null;
  if (!sameString(sig, await hmacHex(sessionKey(), `${username}|${exp}`))) return null;
  return { username, issuedAt: Number(exp) - MAX_AGE_SECONDS };
}

/** Spaces or a line break around a password do not count, and Unicode is compared in one form. */
const clean = (s: string) => s.normalize("NFC").trim();

/** The site password (for creating the first user only). */
export async function sitePasswordMatches(givenRaw: string): Promise<boolean> {
  const expected = clean(process.env.MAATIK_WEB_PASSWORD ?? "");
  if (!expected) return false;
  const [a, b] = await Promise.all([hmacHex(sessionKey(), `pw|${clean(givenRaw)}`), hmacHex(sessionKey(), `pw|${expected}`)]);
  return sameString(a, b);
}

/** Only same-site paths are allowed as the page to return to after login. */
export function safeNext(next: string | null | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/api/") ? next : "/";
}
