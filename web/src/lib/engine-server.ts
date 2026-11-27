// Server-only access to the engine API on Modal. The token never reaches the browser:
// the browser talks to /api/engine/..., and this module adds the Authorization header.
import "server-only";
import { createHmac } from "node:crypto";

let dispatcherReady: Promise<void> | null = null;

/** Behind an HTTPS proxy (as in the cloud session), route fetch through it. At home there is none. */
function useProxyIfConfigured(): Promise<void> {
  if (!dispatcherReady) {
    dispatcherReady = (async () => {
      if (process.env.HTTPS_PROXY || process.env.https_proxy) {
        const { EnvHttpProxyAgent, setGlobalDispatcher } = await import("undici");
        setGlobalDispatcher(new EnvHttpProxyAgent());
      }
    })();
  }
  return dispatcherReady;
}

function apiToken(): string {
  if (process.env.MAATIK_API_TOKEN) return process.env.MAATIK_API_TOKEN;
  const secret = process.env.MODAL_TOKEN_SECRET;
  if (!secret) throw new Error("חסר MODAL_TOKEN_SECRET או MAATIK_API_TOKEN בקובץ web/.env.local");
  // Same derivation as engine/maatik_engine/auth.py.
  return createHmac("sha256", secret).update("maatik-engine-api-v1").digest("hex");
}

export function engineBase(): string {
  const url = process.env.MAATIK_ENGINE_URL;
  if (!url) throw new Error("חסר MAATIK_ENGINE_URL בקובץ web/.env.local");
  return url.replace(/\/+$/, "");
}

export async function engineFetch(path: string, init: RequestInit = {}): Promise<Response> {
  await useProxyIfConfigured();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${apiToken()}`);
  return fetch(`${engineBase()}${path}`, { ...init, headers, cache: "no-store" });
}

export async function engineJson<T>(path: string): Promise<T> {
  const r = await engineFetch(path);
  if (!r.ok) throw new Error(`המנוע החזיר ${r.status} עבור ${path}`);
  return (await r.json()) as T;
}
