"use client";

import { useCallback, useRef, useState } from "react";

export function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((m: string, ms = 4000) => {
    setMsg(m);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), ms);
  }, []);
  return { msg, show };
}

export function Toast({ state }: { state: { msg: string | null } }) {
  return state.msg ? <div className="toast" role="status">{state.msg}</div> : null;
}
