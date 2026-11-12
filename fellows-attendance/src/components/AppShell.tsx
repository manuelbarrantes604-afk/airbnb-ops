"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useData } from "@/lib/data";
import { DemoBackend } from "@/lib/backend/demo";
import { NoAccess, SignIn } from "./SignIn";
import { Button, Sheet, cx } from "./ui";
import { ActionsProvider } from "./actions";

const NAV = [
  { href: "/", label: "Overview", icon: "M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" },
  { href: "/calendar", label: "Calendar", icon: "M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm-1 5h16M8 3v4m8-4v4" },
  { href: "/fellows", label: "Fellows", icon: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zm-6 9c0-3.3 2.7-6 6-6s6 2.7 6 6m1-9a3 3 0 1 0 0-6m2 15c0-2.6-1.3-4.8-3.3-5.8" },
];

function isActive(path: string, href: string) {
  if (href === "/") return path === "/";
  return path === href || path.startsWith(href + "/") || (href === "/calendar" && path.startsWith("/event")) || (href === "/fellows" && path.startsWith("/fellow"));
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { auth, loadError, snap, reload } = useData();

  if (auth === "checking") return <Loading label="Checking sign-in…" />;
  if (auth === "signed_out") return <SignIn />;
  if (auth === "no_access") return <NoAccess />;
  if (auth === "error")
    return (
      <main className="mx-auto max-w-md px-5 py-20 text-center">
        <h1 className="font-serif text-2xl font-semibold">Can&apos;t connect</h1>
        <p className="mt-2 text-muted">
          The tracker needs an internet connection to load the shared records. It will try again automatically when you&apos;re back online.
        </p>
        <Button className="mt-5" variant="primary" onClick={() => location.reload()}>Try again</Button>
      </main>
    );
  if (!snap)
    return loadError ? (
      <main className="mx-auto max-w-md px-5 py-20 text-center">
        <h1 className="font-serif text-2xl font-semibold">Couldn&apos;t load the tracker</h1>
        <p className="mt-2 text-muted">{loadError}</p>
        <Button className="mt-5" variant="primary" onClick={() => reload()}>Try again</Button>
      </main>
    ) : (
      <Loading label="Loading the latest records…" />
    );

  return (
    <ActionsProvider>
      <Chrome>{children}</Chrome>
    </ActionsProvider>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <main className="flex min-h-dvh items-center justify-center" aria-busy="true">
      <p role="status" className="text-muted">{label}</p>
    </main>
  );
}

function Chrome({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { snap, backend, online, syncing, lastSynced, loadError, reload } = useData();
  const [menu, setMenu] = useState(false);
  const demo = backend.mode === "demo";

  return (
    <div className="min-h-dvh pb-24 md:pb-10">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-card focus:px-3 focus:py-2">Skip to content</a>
      {demo && <DemoBar />}
      <header className="safe-top sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2.5">
          <Link href="/" className="flex min-h-11 items-center gap-2.5">
            <span aria-hidden className="flex h-9 w-9 items-center justify-center rounded-xl bg-navy font-serif text-[15px] text-gold">FA</span>
            <span className="leading-tight">
              <span className="block font-serif text-[17px] font-semibold">{snap!.settings.program_name}</span>
              <span className="block text-[12px] text-muted">{snap!.settings.class_label}</span>
            </span>
          </Link>
          <nav aria-label="Main" className="ml-6 hidden gap-1 md:flex">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} aria-current={isActive(path, n.href) ? "page" : undefined}
                className={cx("min-h-11 rounded-xl px-4 py-2.5 text-[15px] font-semibold", isActive(path, n.href) ? "bg-navy text-white" : "text-navy hover:bg-gold-soft/60")}>
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <SyncDot online={online} syncing={syncing} error={!!loadError} last={lastSynced} onRetry={reload} />
            <button onClick={() => setMenu(true)} className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-[15px] font-semibold hover:bg-gold-soft/60" aria-haspopup="dialog">
              <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
              Menu
            </button>
          </div>
        </div>
      </header>

      {!online && (
        <div role="status" className="border-b border-gold/40 bg-gold-soft px-4 py-2 text-center text-[14px] text-gold-ink">
          You&apos;re offline. You can look around, but changes can&apos;t be saved until you reconnect.
        </div>
      )}
      {online && loadError && (
        <div role="alert" className="border-b border-absent/30 bg-absent-soft px-4 py-2 text-center text-[14px] text-absent">
          Couldn&apos;t refresh: {loadError} <button className="ml-2 font-semibold underline" onClick={() => reload()}>Retry</button>
        </div>
      )}

      <main id="main" className="mx-auto max-w-5xl px-4 pt-5 sm:pt-7">{children}</main>

      <nav aria-label="Main" className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-card/95 backdrop-blur md:hidden">
        <div className="mx-auto grid max-w-md grid-cols-3">
          {NAV.map((n) => {
            const on = isActive(path, n.href);
            return (
              <Link key={n.href} href={n.href} aria-current={on ? "page" : undefined}
                className={cx("flex min-h-[60px] flex-col items-center justify-center gap-0.5 text-[13px] font-semibold", on ? "text-navy" : "text-muted")}>
                <svg aria-hidden width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={on ? 2.2 : 1.7} strokeLinecap="round" strokeLinejoin="round"><path d={n.icon} /></svg>
                <span className={cx("rounded-full px-2", on && "bg-gold-soft")}>{n.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      <MenuSheet open={menu} onClose={() => setMenu(false)} />
    </div>
  );
}

function SyncDot({ online, syncing, error, last, onRetry }: { online: boolean; syncing: boolean; error: boolean; last: Date | null; onRetry: () => void }) {
  const label = !online ? "Offline" : error ? "Not up to date" : syncing ? "Updating…" : "Up to date";
  const color = !online || error ? "bg-absent" : syncing ? "bg-gold" : "bg-present";
  return (
    <button onClick={onRetry} title={last ? `Last updated ${last.toLocaleTimeString()}` : undefined}
      className="hidden min-h-11 items-center gap-2 rounded-xl px-3 text-[13px] text-muted hover:bg-gold-soft/60 sm:inline-flex">
      <span aria-hidden className={cx("h-2.5 w-2.5 rounded-full", color)} />
      {label}
    </button>
  );
}

function MenuSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { me, backend, refreshAuth, online, lastSynced, reload } = useData();
  const router = useRouter();
  const isAdmin = me?.member?.role === "admin";
  const go = (href: string) => {
    onClose();
    router.push(href);
  };
  const item = (href: string, label: string, sub: string) => (
    <li>
      <button onClick={() => go(href)} className="flex min-h-14 w-full items-center justify-between rounded-xl px-3 py-2 text-left hover:bg-paper">
        <span>
          <span className="block font-semibold">{label}</span>
          <span className="block text-[14px] text-muted">{sub}</span>
        </span>
        <span aria-hidden className="text-muted">›</span>
      </button>
    </li>
  );
  return (
    <Sheet open={open} onClose={onClose} title="Menu">
      <p className="mb-3 rounded-xl bg-paper px-3 py-2 text-[14px] text-muted ring-1 ring-line">
        Signed in as <strong className="text-navy">{me?.member?.display_name}</strong> ({me?.email})
        {" · "}{me?.member?.kind === "fellow" ? "Fellow" : "Program staff"}{isAdmin && " · Administrator"}
      </p>
      <ul className="divide-y divide-line">
        {item("/reports", "Reports & export", "Totals, reasons, filters, CSV")}
        {item("/history", "Change history", "Who changed what, and when")}
        {isAdmin && item("/admin", "Administration", "Roster, portraits, invitations, owners, settings")}
        {item("/help", "Help & privacy", "Add to Home Screen, who can see what")}
      </ul>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
        <span className="text-[13px] text-muted">
          {online ? `Last updated ${lastSynced ? lastSynced.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—"}` : "Offline"}
          <button className="ml-2 font-semibold text-navy underline" onClick={() => reload()}>Refresh</button>
        </span>
        <Button onClick={async () => { await backend.signOut(); onClose(); await refreshAuth(); }}>Sign out</Button>
      </div>
    </Sheet>
  );
}

function DemoBar() {
  const { backend, refreshAuth, reload } = useData();
  const demo = backend as DemoBackend;
  const [role, setRole] = useState(demo.role);
  return (
    <div className="no-print bg-navy px-4 py-2 text-[13px] text-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-1">
        <strong className="rounded bg-gold px-1.5 py-0.5 text-navy">DEMO</strong>
        <span>Fictional data, stored only in this browser — not shared, not live.</span>
        <label className="ml-auto flex items-center gap-2">
          View as
          <select value={role} className="min-h-9 rounded-md bg-white/10 px-2 ring-1 ring-white/30"
            onChange={async (e) => {
              const r = e.target.value as "staff" | "fellow";
              setRole(r);
              demo.setRole(r);
              await refreshAuth();
              await reload();
            }}>
            <option className="text-navy" value="staff">Program staff (admin)</option>
            <option className="text-navy" value="fellow">Fellow 05 (member)</option>
          </select>
        </label>
        <button className="min-h-9 font-semibold underline" onClick={() => { if (confirm("Reset the demo to its starting fictional data?")) demo.reset(); }}>Reset demo</button>
      </div>
    </div>
  );
}
