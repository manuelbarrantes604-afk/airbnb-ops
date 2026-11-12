"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Backend, Me } from "./backend/types";
import type { Snapshot } from "./types";
import { DemoBackend } from "./backend/demo";
import { SupabaseBackend } from "./backend/supabase";

let singleton: Backend | null = null;

export function getBackend(): Backend {
  if (singleton) return singleton;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  singleton = url && key ? new SupabaseBackend(url, key) : new DemoBackend();
  return singleton;
}

export type AuthState = "checking" | "signed_out" | "no_access" | "ready" | "error";

interface DataCtx {
  backend: Backend;
  auth: AuthState;
  me: Me | null;
  snap: Snapshot | null;
  loadError: string | null;
  syncing: boolean;
  online: boolean;
  lastSynced: Date | null;
  now: Date;
  reload: () => Promise<void>;
  refreshAuth: () => Promise<void>;
  portraits: Record<string, string>;
}

const Ctx = createContext<DataCtx | null>(null);

export function DataProvider({ children }: { children: React.ReactNode }) {
  const backend = useMemo(() => getBackend(), []);
  const [auth, setAuth] = useState<AuthState>("checking");
  const [me, setMe] = useState<Me | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [portraits, setPortraits] = useState<Record<string, string>>({});
  const inflight = useRef<Promise<void> | null>(null);
  const again = useRef(false);

  const reload = useCallback(async () => {
    if (inflight.current) {
      again.current = true; // coalesce bursts of change notifications
      return inflight.current;
    }
    const run = async () => {
      setSyncing(true);
      try {
        do {
          again.current = false;
          const s = await backend.load();
          setSnap(s);
          setLoadError(null);
          setLastSynced(new Date());
          setNow(new Date());
          const paths = s.fellows.map((f) => f.photo_path).filter(Boolean) as string[];
          if (paths.length) {
            const urls = await backend.portraitUrls(paths).catch(() => ({}));
            setPortraits((p) => ({ ...p, ...urls }));
          }
        } while (again.current);
      } catch (e) {
        const code = (e as { code?: string }).code;
        setLoadError(code === "network" || code === "offline"
          ? "Couldn’t reach the server to load the latest records. Check your connection."
          : (e as Error).message || "Could not load the latest records.");
      } finally {
        setSyncing(false);
        inflight.current = null;
      }
    };
    inflight.current = run();
    return inflight.current;
  }, [backend]);

  const applyMe = useCallback((m: Me | null) => {
      setMe(m);
      if (!m) {
        setAuth("signed_out");
        setSnap(null);
      } else if (!m.member) {
        setAuth("no_access");
        setSnap(null);
      } else {
        setAuth("ready");
      }
  }, []);
  // A failed re-check (e.g. the phone briefly lost signal) must not throw away a
  // working session: keep showing loaded data with a notice instead.
  const authFailed = useCallback((e: unknown) => {
    setLoadError((e as Error).message);
    setAuth((cur) => (cur === "ready" ? "ready" : "error"));
  }, []);
  const refreshAuth = useCallback(
    () => backend.currentUser().then(applyMe, authFailed),
    [backend, applyMe, authFailed],
  );

  useEffect(() => {
    backend.currentUser().then(applyMe, authFailed);
    return backend.onAuthChange(() => {
      backend.currentUser().then(applyMe, authFailed);
    });
  }, [backend, applyMe, authFailed]);

  // Couldn't even check sign-in (e.g. opened with no signal): retry automatically when back online.
  useEffect(() => {
    if (auth !== "error") return;
    const retry = () => backend.currentUser().then(applyMe, authFailed);
    window.addEventListener("online", retry);
    const t = setInterval(() => { if (navigator.onLine) retry(); }, 15_000);
    return () => { window.removeEventListener("online", retry); clearInterval(t); };
  }, [auth, backend, applyMe, authFailed]);

  // Load + live updates while signed in.
  useEffect(() => {
    if (auth !== "ready") return;
    reload();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const debounced = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => reload(), 300);
    };
    const unsub = backend.subscribe(debounced);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        refreshAuth();
        reload();
      }
    };
    const onOnline = () => {
      setOnline(true);
      reload();
    };
    const onOffline = () => setOnline(false);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("pageshow", onVisible);
    // Safety net: refresh every 2 minutes while visible.
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") reload();
    }, 120_000);
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("pageshow", onVisible);
    };
  }, [auth, backend, reload, refreshAuth]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const value = useMemo<DataCtx>(
    () => ({ backend, auth, me, snap, loadError, syncing, online, lastSynced, now, reload, refreshAuth, portraits }),
    [backend, auth, me, snap, loadError, syncing, online, lastSynced, now, reload, refreshAuth, portraits],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useData outside DataProvider");
  return c;
}

/** For screens rendered only after data is loaded. */
export function useSnap() {
  const c = useData();
  if (!c.snap) throw new Error("snapshot not loaded");
  return { ...c, snap: c.snap };
}

export function useLookups() {
  const { snap } = useSnap();
  return useMemo(() => {
    const fellow = new Map(snap.fellows.map((f) => [f.id, f]));
    const reason = new Map(snap.reasons.map((r) => [r.id, r]));
    const person = new Map(snap.directory.map((m) => [m.user_id, m]));
    const event = new Map(snap.events.map((e) => [e.id, e]));
    return {
      fellow, reason, person, event,
      reasonLabel: (id: string | null | undefined) => (id ? reason.get(id)?.label ?? "Unknown reason" : "—"),
      personName: (id: string | null | undefined) => (id ? person.get(id)?.display_name ?? "Former member" : "System"),
    };
  }, [snap]);
}
