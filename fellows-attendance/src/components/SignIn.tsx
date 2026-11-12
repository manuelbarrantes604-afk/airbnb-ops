"use client";

import { useState } from "react";
import { useData } from "@/lib/data";
import { Button, Field, inputCls } from "./ui";

export function SignIn() {
  const { backend, refreshAuth } = useData();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setErr("Please enter a valid email address.");
    setBusy(true);
    setErr(null);
    try {
      await backend.sendCode(email);
      setStep("code");
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await backend.verifyCode(email, code.replace(/\s/g, ""));
      await refreshAuth();
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="safe-top mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
      <div className="mb-8 text-center">
        <div aria-hidden className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-navy font-serif text-2xl text-gold">FA</div>
        <h1 className="font-serif text-[30px] font-semibold">Fellows Attendance</h1>
        <p className="mt-1 text-muted">Shared attendance tracker for invited Fellows and program staff.</p>
      </div>
      <div className="rounded-2xl bg-card p-5 ring-1 ring-line">
        {step === "email" ? (
          <form onSubmit={send} noValidate>
            <Field label="Email address" htmlFor="email" hint="We'll email you a 6-digit sign-in code. Invited accounts only.">
              <input id="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" autoCorrect="off"
                value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} required />
            </Field>
            <Button variant="primary" className="w-full" disabled={busy}>{busy ? "Sending…" : "Email me a code"}</Button>
          </form>
        ) : (
          <form onSubmit={verify} noValidate>
            <p className="mb-4 text-[15px]">
              If <strong>{email}</strong> has been invited, a code is on its way. It can take a minute — check spam too.
            </p>
            <Field label="Sign-in code" htmlFor="code">
              <input id="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={10}
                value={code} onChange={(e) => setCode(e.target.value)} className={`${inputCls} text-center text-2xl tracking-[0.4em] tabular`} autoFocus />
            </Field>
            <Button variant="primary" className="w-full" disabled={busy || code.replace(/\D/g, "").length < 6}>{busy ? "Checking…" : "Sign in"}</Button>
            <div className="mt-3 flex justify-between text-[14px]">
              <button type="button" className="min-h-11 font-semibold text-navy underline" onClick={() => { setStep("email"); setCode(""); setErr(null); }}>Use a different email</button>
              <button type="button" className="min-h-11 font-semibold text-navy underline" onClick={() => send()} disabled={busy}>Send a new code</button>
            </div>
          </form>
        )}
        {err && <p role="alert" className="mt-3 rounded-xl bg-absent-soft px-3 py-2 text-[14px] text-absent">{err}</p>}
      </div>
      <p className="mt-6 text-center text-[13px] text-muted">Not an official government system.</p>
    </main>
  );
}

export function NoAccess() {
  const { backend, me, refreshAuth } = useData();
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 text-center">
      <h1 className="font-serif text-[26px] font-semibold">No access yet</h1>
      <p className="mt-2 text-muted">
        You&apos;re signed in as <strong>{me?.email}</strong>, but this account hasn&apos;t been invited or its access was removed.
        Ask a tracker administrator (the VOPS committee) to invite this email.
      </p>
      <div className="mt-6 flex justify-center gap-2">
        <Button onClick={() => refreshAuth()}>Check again</Button>
        <Button variant="primary" onClick={async () => { await backend.signOut(); await refreshAuth(); }}>Sign out</Button>
      </div>
    </main>
  );
}
