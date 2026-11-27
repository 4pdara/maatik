// Browser-side calls to the engine, through the local pass-through (/api/engine/...).
import type { Page, Training, Models } from "./types";

export class EngineError extends Error {
  constructor(public status: number, message: string, public detail?: unknown) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`/api/engine/${path}`, init);
  } catch {
    throw new EngineError(0, "אין חיבור לשרת המקומי של העורך. בדוק שהוא רץ (npm run dev).");
  }
  if (!r.ok) {
    let detail: unknown;
    try { detail = (await r.json()).detail; } catch { /* not JSON */ }
    const msg = typeof detail === "string" ? detail : (detail as { message?: string })?.message;
    throw new EngineError(r.status, msg ?? `המנוע החזיר שגיאה ${r.status}`, detail);
  }
  return (await r.json()) as T;
}

export const imageUrl = (slug: string, page: number) => `/api/engine/v1/manuscripts/${slug}/pages/${page}/image`;

export const getPage = (slug: string, page: number) => call<Page>(`v1/manuscripts/${slug}/pages/${page}`);

export const savePage = (slug: string, page: number, body: Page) =>
  call<{ revision: number }>(`v1/manuscripts/${slug}/pages/${page}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export const getTraining = (slug: string) => call<Training>(`v1/manuscripts/${slug}/training`);
export const getModels = (slug: string) => call<Models>(`v1/manuscripts/${slug}/models`);
export const startTraining = (slug: string) =>
  call<{ job_id: string }>(`v1/manuscripts/${slug}/calibrate`, { method: "POST" });
export const recognizeAll = (slug: string) =>
  call<{ pages: number[]; jobs: Record<string, string> }>(`v1/manuscripts/${slug}/recognize-all`, { method: "POST" });
export const recognizePage = (slug: string, page: number) =>
  call<{ job_id: string }>(`v1/manuscripts/${slug}/pages/${page}/recognize`, { method: "POST" });

export function newLineId(): string {
  const b = new Uint8Array(6);
  crypto.getRandomValues(b);
  return "l_" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
