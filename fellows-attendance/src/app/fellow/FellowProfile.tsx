"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useLookups, useSnap } from "@/lib/data";
import { EVENT_TYPE_LABELS } from "@/lib/types";
import { emptyFilters, fellowTotals, planFor, reportRows, upcomingPlannedEvents } from "@/lib/rules";
import { fmtDateMedium, fmtDateShort, todayKey } from "@/lib/time";
import { useActions } from "@/components/actions";
import { AuditList } from "@/components/History";
import { Avatar, Button, Card, Empty, Pill, SectionTitle, StatusPill, cx } from "@/components/ui";

export default function FellowProfile() {
  const id = useSearchParams().get("id");
  const { snap, now } = useSnap();
  const L = useLookups();
  const actions = useActions();
  const [showRemoved, setShowRemoved] = useState(false);
  const fellow = id ? L.fellow.get(id) : undefined;
  if (!fellow) return <Card><Empty>Fellow not found. <Link className="underline" href="/fellows">Back to Fellows</Link></Empty></Card>;

  const t = fellowTotals(snap, { ...emptyFilters, fellowId: fellow.id }, now)[0];
  const history = reportRows(snap, { ...emptyFilters, fellowId: fellow.id }, now).reverse();
  const planned = upcomingPlannedEvents(snap, fellow, now);
  const today = todayKey(now);
  const ranges = snap.timeAway
    .filter((r) => r.fellow_id === fellow.id && (showRemoved || !r.removed_at))
    .sort((a, b) => b.start_date.localeCompare(a.start_date));
  const optionalOrOther = snap.attendance.filter((a) => a.fellow_id === fellow.id && a.status === "absent")
    .map((a) => ({ a, e: L.event.get(a.event_id)! }))
    .filter(({ e }) => e && (e.status === "canceled" || !e.attendance_required));

  return (
    <div className="space-y-6">
      <Link href="/fellows" className="inline-flex min-h-11 items-center text-[15px] font-semibold underline-offset-4 hover:underline">‹ Fellows</Link>
      <Card>
        <div className="flex flex-wrap items-center gap-4">
          <Avatar fellow={fellow} size={88} />
          <div className="min-w-0 flex-1">
            <h1 className="font-serif text-[28px] font-semibold leading-tight">{fellow.display_name}</h1>
            <p className="text-muted">{fellow.agency || (fellow.is_placeholder ? "Placeholder profile" : "Placement not set")}</p>
            {(fellow.eligible_from || fellow.eligible_until) && (
              <p className="text-[14px] text-muted">On roster {fellow.eligible_from ? `from ${fmtDateShort(fellow.eligible_from)}` : ""}{fellow.eligible_until ? ` until ${fmtDateShort(fellow.eligible_until)}` : ""}</p>
            )}
          </div>
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
            <Button variant="primary" onClick={() => actions.recordAbsence({ fellowId: fellow.id })}>Record absence</Button>
            <Button variant="gold" onClick={() => actions.planAway({ fellowId: fellow.id })}>Plan time away</Button>
          </div>
        </div>
        <dl className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Big label="Events missed" sub="required events, confirmed" n={t.eventsMissed} />
          <Big label="Speaker Series missed" sub="subset of events missed" n={t.speakerSeriesMissed} />
          <Big label="Planned ahead" sub="upcoming, not counted" n={t.plannedUpcoming} tone="text-gold-ink" />
          <Big label="Not recorded" sub="past events awaiting review" n={t.notRecorded} tone="text-muted" />
        </dl>
        {Object.keys(t.byReason).length > 0 && (
          <p className="mt-3 text-[14px] text-muted">
            Reasons for events missed: {Object.entries(t.byReason).map(([r, n]) => `${L.reasonLabel(r)} (${n})`).join(" · ")}
          </p>
        )}
      </Card>

      <section>
        <SectionTitle aside={<label className="flex items-center gap-2 text-[14px]"><input type="checkbox" className="h-5 w-5 accent-[#14213d]" checked={showRemoved} onChange={(e) => setShowRemoved(e.target.checked)} />Show removed</label>}>Time away</SectionTitle>
        {ranges.length ? (
          <ul className="space-y-2">
            {ranges.map((r) => (
              <li key={r.id} className={cx("flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-card p-3.5 ring-1 ring-line", r.removed_at && "opacity-60")}>
                <div>
                  <p className="font-semibold">{fmtDateMedium(r.start_date)} – {fmtDateMedium(r.end_date)}</p>
                  <p className="text-[14px] text-muted">{L.reasonLabel(r.reason_id)}{r.note && ` · “${r.note}”`} · saved by {L.personName(r.created_by)}</p>
                  <div className="mt-1 flex gap-1.5">
                    {r.removed_at ? <Pill tone="quiet">Removed</Pill> : r.end_date < today ? <Pill tone="quiet">Past</Pill> : r.start_date <= today ? <Pill tone="planned">Away now</Pill> : <Pill tone="planned">Upcoming</Pill>}
                  </div>
                </div>
                {!r.removed_at && <Button onClick={() => actions.planAway({ range: r })}>Edit / shorten / remove</Button>}
              </li>
            ))}
          </ul>
        ) : <Empty>No time away planned.</Empty>}
      </section>

      <section>
        <SectionTitle>Upcoming planned absences</SectionTitle>
        {planned.length ? (
          <ul className="space-y-2">
            {planned.map((e) => {
              const p = planFor(snap, fellow.id, e);
              return (
                <li key={e.id}>
                  <Link href={`/event?id=${e.id}`} className="flex items-center justify-between gap-3 rounded-2xl bg-card p-3.5 ring-1 ring-line hover:ring-gold">
                    <span><span className="block font-semibold">{e.title}</span><span className="block text-[14px] text-muted">{fmtDateMedium(e.local_date)} · {L.reasonLabel(p.reasonId)}{p.source === "range" && " · from time away"}</span></span>
                    <StatusPill status="planned" />
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : <Empty>No planned absences for upcoming required events.</Empty>}
      </section>

      <section>
        <SectionTitle>Event-by-event history</SectionTitle>
        <p className="-mt-2 mb-3 text-[14px] text-muted">Completed, required, non-canceled events while on the roster. Newest first.</p>
        {history.length ? (
          <div className="overflow-x-auto rounded-2xl bg-card ring-1 ring-line">
            <table className="w-full min-w-[560px] text-left text-[15px]">
              <thead className="border-b border-line bg-paper text-[13px] uppercase tracking-wide text-muted">
                <tr><th className="px-3 py-2 font-semibold">Date</th><th className="px-3 py-2 font-semibold">Event</th><th className="px-3 py-2 font-semibold">Status</th><th className="px-3 py-2 font-semibold">Reason / note</th><th className="px-3 py-2 font-semibold">Recorded by</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {history.map((r) => (
                  <tr key={r.event.id}>
                    <td className="whitespace-nowrap px-3 py-2">{fmtDateMedium(r.event.local_date)}</td>
                    <td className="px-3 py-2"><Link className="hover:underline" href={`/event?id=${r.event.id}`}>{r.event.title}</Link><span className="block text-[13px] text-muted">{EVENT_TYPE_LABELS[r.event.event_type]}</span></td>
                    <td className="px-3 py-2"><StatusPill status={r.status} /></td>
                    <td className="px-3 py-2 text-[14px]">{r.status === "absent" ? `${L.reasonLabel(r.attendance?.reason_id)}${r.attendance?.note ? ` · “${r.attendance.note}”` : ""}` : "—"}</td>
                    <td className="px-3 py-2 text-[14px] text-muted">{r.attendance && r.status !== "not_recorded" ? L.personName(r.attendance.updated_by) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>No completed required events yet.</Empty>}
        {optionalOrOther.length > 0 && (
          <p className="mt-2 text-[13px] text-muted">{optionalOrOther.length} absence record{optionalOrOther.length === 1 ? " is" : "s are"} on optional or canceled events and not counted.</p>
        )}
      </section>

      <section>
        <SectionTitle>Corrections & changes</SectionTitle>
        <AuditList fellowId={fellow.id} />
      </section>
    </div>
  );
}

function Big({ label, sub, n, tone }: { label: string; sub: string; n: number; tone?: string }) {
  return (
    <div className="rounded-xl bg-paper px-3 py-3 ring-1 ring-line">
      <dd className={cx("font-serif text-[30px] font-semibold leading-none tabular", tone)}>{n}</dd>
      <dt className="mt-1 text-[14px] font-semibold">{label}</dt>
      <p className="text-[12px] text-muted">{sub}</p>
    </div>
  );
}
