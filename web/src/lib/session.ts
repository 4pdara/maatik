// Password login for the deployed site. Works in middleware (edge) and in route handlers.
//
// MAATIK_WEB_PASSWORD set     -> every page needs a signed session cookie.
// MAATIK_REQUIRE_PASSWORD=1   -> the deployed site refuses to run open if the password is missing.
// Neither set (local `npm run dev`) -> no login.
export const COOKIE = "maatik_session";
export const MAX_AGE_SECONDS = 30 * 24 * 3600;

export function authMode(): "off" | "on" | "misconfigured" {
  const pw = process.env.MAATIK_WEB_PASSWORD;
  if (pw) return "on";
  return process.env.MAATIK_REQUIRE_PASSWORD === "1" ? "misconfigured" : "off";
}

const enc = new TextEncoder();

async function hmacHex(message: string): Promise<string> {
  // Changing the password (or the engine token) signs everyone out.
  const secret = `${process.env.MAATIK_WEB_PASSWORD ?? ""}\u0000${process.env.MAATIK_API_TOKEN ?? process.env.MODAL_TOKEN_SECRET ?? ""}`;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function makeSession(): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS;
  return `${exp}.${await hmacHex(`maatik-session|${exp}`)}`;
}

export async function validSession(value: string | undefined): Promise<boolean> {
  if (!value) return false;
  const [exp, sig] = value.split(".");
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < Date.now() / 1000) return false;
  return sameString(sig, await hmacHex(`maatik-session|${exp}`));
}

export async function passwordMatches(given: string): Promise<boolean> {
  const expected = process.env.MAATIK_WEB_PASSWORD ?? "";
  if (!expected) return false;
  // Compare digests so the comparison takes the same time whatever the length.
  const [a, b] = await Promise.all([hmacHex(`pw|${given}`), hmacHex(`pw|${expected}`)]);
  return sameString(a, b);
}

/** Only same-site paths are allowed as the page to return to after login. */
export function safeNext(next: string | null | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/api/") ? next : "/";
}
