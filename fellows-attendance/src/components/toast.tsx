"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { cx } from "./ui";

interface ToastItem {
  id: number;
  msg: string;
  tone: "ok" | "error" | "info";
  action?: { label: string; run: () => Promise<void> };
  busy?: boolean;
}

const Ctx = createContext<{ show: (t: Omit<ToastItem, "id">) => void } | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const n = useRef(0);
  const dismiss = (id: number) => setItems((xs) => xs.filter((x) => x.id !== id));
  const show = useCallback((t: Omit<ToastItem, "id">) => {
    const id = ++n.current;
    setItems((xs) => [...xs.slice(-2), { ...t, id }]);
    setTimeout(() => dismiss(id), t.action ? 12000 : 5000);
  }, []);

  const runAction = async (t: ToastItem) => {
    if (!t.action || t.busy) return;
    setItems((xs) => xs.map((x) => (x.id === t.id ? { ...x, busy: true } : x)));
    try {
      await t.action.run();
      dismiss(t.id);
    } catch (e) {
      setItems((xs) => xs.map((x) => (x.id === t.id ? { ...x, busy: false, tone: "error", msg: (e as Error).message, action: undefined } : x)));
    }
  };

  return (
    <Ctx.Provider value={{ show }}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 px-4 md:bottom-6">
        {items.map((t) => (
          <div key={t.id} role={t.tone === "error" ? "alert" : "status"}
            className={cx("pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl px-4 py-3 text-[15px] shadow-lg ring-1",
              t.tone === "error" ? "bg-absent-soft text-absent ring-absent/30" : "bg-navy text-white ring-navy")}>
            <span className="flex-1">{t.msg}</span>
            {t.action && (
              <button onClick={() => runAction(t)} disabled={t.busy}
                className="min-h-10 rounded-lg bg-white/15 px-3 font-semibold text-white ring-1 ring-white/40 hover:bg-white/25 disabled:opacity-60">
                {t.busy ? "Working…" : t.action.label}
              </button>
            )}
            <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="h-9 w-9 rounded-full text-lg opacity-80 hover:opacity-100">×</button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useToast outside provider");
  return c.show;
}
