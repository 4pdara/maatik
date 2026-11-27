"use client";

import { useId, useState } from "react";

/** A password field, with "show password" and warnings for a Hebrew keyboard or Caps Lock. */
export function PasswordField({ name = "password", label = "סיסמה", autoComplete = "current-password", autoFocus = false }: {
  name?: string; label?: string; autoComplete?: string; autoFocus?: boolean;
}) {
  const id = useId();
  const [show, setShow] = useState(false);
  const [hebrew, setHebrew] = useState(false);
  const [caps, setCaps] = useState(false);
  return (
    <div className="grid gap-2">
      <label htmlFor={id}>{label}</label>
      <input id={id} name={name} type={show ? "text" : "password"} required autoFocus={autoFocus}
             autoComplete={autoComplete} spellCheck={false} autoCapitalize="off" autoCorrect="off"
             className="field text-[20px]" dir="ltr"
             onChange={(e) => setHebrew(/[֐-׿]/.test(e.target.value))}
             onKeyUp={(e) => setCaps(e.getModifierState?.("CapsLock") ?? false)} />
      <label className="inline-flex cursor-pointer items-center gap-2 text-[15px]">
        <input type="checkbox" className="h-[18px] w-[18px] accent-[var(--accent)]" checked={show}
               onChange={(e) => setShow(e.target.checked)} />
        הצג סיסמה
      </label>
      {hebrew && <p className="m-0 text-[15px] text-doubt-line">המקלדת כותבת בעברית. אם הסיסמה באנגלית, החלף שפה (Alt+Shift).</p>}
      {caps && <p className="m-0 text-[15px] text-doubt-line">Caps Lock דלוק.</p>}
    </div>
  );
}
