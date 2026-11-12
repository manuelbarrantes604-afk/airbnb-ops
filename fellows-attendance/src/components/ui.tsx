"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import type { AttendanceStatus, CalEvent, Fellow } from "@/lib/types";
import { EVENT_TYPE_LABELS } from "@/lib/types";
import { initials } from "@/lib/rules";
import { useData } from "@/lib/data";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------- Avatar
export function Avatar({ fellow, size = 44, ring }: { fellow: Fellow; size?: number; ring?: "gold" | "absent" | null }) {
  const { portraits } = useData();
  const url = fellow.photo_path ? portraits[fellow.photo_path] : undefined;
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.36)) };
  const ringCls = ring === "gold" ? "ring-2 ring-gold ring-offset-2 ring-offset-paper" : ring === "absent" ? "ring-2 ring-absent ring-offset-2 ring-offset-paper" : "ring-1 ring-line";
  if (url && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt="" onError={() => setBroken(true)} style={style}
        className={cx("shrink-0 rounded-full object-cover bg-gold-soft", ringCls)} />
    );
  }
  return (
    <span aria-hidden style={style}
      className={cx("inline-flex shrink-0 select-none items-center justify-center rounded-full bg-gold-soft font-serif font-semibold text-navy tabular", ringCls)}>
      {initials(fellow.display_name)}
    </span>
  );
}

export function AvatarStack({ fellows, max = 5, size = 34 }: { fellows: Fellow[]; max?: number; size?: number }) {
  const shown = fellows.slice(0, max);
  return (
    <span className="flex -space-x-2">
      {shown.map((f) => <Avatar key={f.id} fellow={f} size={size} />)}
      {fellows.length > max && (
        <span className="inline-flex items-center justify-center rounded-full bg-quiet text-xs font-semibold text-navy ring-1 ring-line" style={{ width: size, height: size }}>
          +{fellows.length - max}
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------- Pills
type PillTone = "planned" | "absent" | "present" | "quiet" | "navy" | "warn";
const toneCls: Record<PillTone, string> = {
  planned: "bg-gold-soft text-gold-ink ring-gold/40",
  absent: "bg-absent-soft text-absent ring-absent/30",
  present: "bg-present-soft text-present ring-present/30",
  quiet: "bg-quiet text-muted ring-line",
  navy: "bg-navy text-white ring-navy",
  warn: "bg-gold-soft text-gold-ink ring-gold",
};
export function Pill({ tone, children, icon }: { tone: PillTone; children: React.ReactNode; icon?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[13px] font-semibold ring-1", toneCls[tone])}>
      {icon && <span aria-hidden>{icon}</span>}
      {children}
    </span>
  );
}

export function StatusPill({ status, planned }: { status: AttendanceStatus | "planned"; planned?: boolean }) {
  if (status === "planned") return <Pill tone="planned" icon="◷">Planned absence</Pill>;
  if (status === "absent") return <Pill tone="absent" icon="✕">Absent</Pill>;
  if (status === "present") return <Pill tone="present" icon="✓">Present</Pill>;
  return <Pill tone="quiet" icon="–">{planned ? "Not recorded · plan on file" : "Not recorded"}</Pill>;
}

export function TypePill({ ev }: { ev: CalEvent }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted">
      <span aria-hidden className={cx("inline-block h-2 w-2 rounded-full", ev.event_type === "speaker_series" ? "bg-gold" : "bg-navy-2")} />
      {EVENT_TYPE_LABELS[ev.event_type]}
      {!ev.attendance_required && <span className="text-muted">· Optional</span>}
    </span>
  );
}

// ---------------------------------------------------------------- Buttons
type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "gold";
const btnCls: Record<BtnVariant, string> = {
  primary: "bg-navy text-white hover:bg-navy-2 disabled:bg-navy/50",
  gold: "bg-gold-soft text-navy ring-1 ring-gold hover:bg-[#efe3c4]",
  secondary: "bg-card text-navy ring-1 ring-line-strong hover:bg-paper",
  ghost: "text-navy hover:bg-gold-soft/60",
  danger: "bg-card text-absent ring-1 ring-absent/40 hover:bg-absent-soft",
};
export function Button({
  variant = "secondary", className, children, ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant }) {
  return (
    <button {...rest}
      className={cx("inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2 text-[16px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60", btnCls[variant], className)}>
      {children}
    </button>
  );
}

export function LinkButton({ href, variant = "secondary", className, children }: { href: string; variant?: BtnVariant; className?: string; children: React.ReactNode }) {
  return (
    <Link href={href} className={cx("inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2 text-[16px] font-semibold", btnCls[variant], className)}>
      {children}
    </Link>
  );
}

// ---------------------------------------------------------------- Card / layout
export function Card({ className, children, as: As = "section" }: { className?: string; children: React.ReactNode; as?: "section" | "div" | "article" }) {
  return <As className={cx("rounded-2xl bg-card p-4 shadow-[0_1px_0_rgb(20_33_61/0.04)] ring-1 ring-line sm:p-5", className)}>{children}</As>;
}

export function PageTitle({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-serif text-[28px] font-semibold leading-tight tracking-tight sm:text-[32px]">{title}</h1>
        {subtitle && <p className="mt-1 text-[15px] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function SectionTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="font-serif text-[20px] font-semibold">{children}</h2>
      {aside}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl bg-paper px-4 py-5 text-center text-[15px] text-muted ring-1 ring-line">{children}</p>;
}

// ---------------------------------------------------------------- Sheet (native dialog)
export function Sheet({
  open, onClose, title, children, footer, wide, description,
}: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean; description?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className={cx("sheet", wide && "wide")} aria-labelledby={titleId}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      {open && (
        <div className="flex max-h-[inherit] flex-col">
          <div className="flex items-start justify-between gap-3 border-b border-line px-5 pb-3 pt-4">
            <div>
              <h2 id={titleId} className="font-serif text-[22px] font-semibold leading-tight">{title}</h2>
              {description && <p className="mt-0.5 text-[14px] text-muted">{description}</p>}
            </div>
            <button onClick={onClose} className="-mr-2 inline-flex h-11 w-11 items-center justify-center rounded-full text-[22px] text-muted hover:bg-paper" aria-label="Close">×</button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="safe-bottom border-t border-line bg-paper/60 px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

// ---------------------------------------------------------------- Form bits
export function Field({ label, hint, children, htmlFor }: { label: string; hint?: React.ReactNode; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className="mb-4">
      <label htmlFor={htmlFor} className="mb-1.5 block text-[15px] font-semibold">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[13px] text-muted">{hint}</p>}
    </div>
  );
}

export const inputCls =
  "w-full min-h-11 rounded-xl border border-line-strong bg-card px-3 py-2 text-[16px] text-navy placeholder:text-muted/70 focus:border-gold focus:outline-none focus-visible:outline-3 focus-visible:outline-gold";

export function Chips<T extends string>({
  options, value, onChange, label,
}: { options: { value: T; label: string }[]; value: T | null; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.value)}
            className={cx("min-h-11 rounded-xl px-3.5 py-2 text-[15px] font-medium ring-1 transition-colors",
              on ? "bg-navy text-white ring-navy" : "bg-card text-navy ring-line-strong hover:bg-paper")}>
            {on && <span aria-hidden className="mr-1">✓</span>}{o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Segmented<T extends string>({ options, value, onChange, label }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-xl bg-quiet p-1 ring-1 ring-line">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} onClick={() => onChange(o.value)}
          className={cx("min-h-10 rounded-lg px-4 text-[15px] font-semibold", o.value === value ? "bg-card text-navy shadow-sm ring-1 ring-line" : "text-muted")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Save state
export type SaveState = { phase: "idle" } | { phase: "saving" } | { phase: "saved"; msg?: string } | { phase: "error"; msg: string };

export function SaveStatus({ state, onRetry }: { state: SaveState; onRetry?: () => void }) {
  if (state.phase === "idle") return null;
  if (state.phase === "saving") return <p role="status" className="text-[14px] text-muted">Saving…</p>;
  if (state.phase === "saved") return <p role="status" className="text-[14px] font-semibold text-present">✓ {state.msg ?? "Saved"}</p>;
  return (
    <div role="alert" className="rounded-xl bg-absent-soft px-3 py-2 text-[14px] text-absent ring-1 ring-absent/30">
      <p className="font-semibold">Not saved.</p>
      <p>{state.msg}</p>
      {onRetry && <button className="mt-1 font-semibold underline" onClick={onRetry}>Try again</button>}
    </div>
  );
}
