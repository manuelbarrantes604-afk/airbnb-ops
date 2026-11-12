"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useLookups, useSnap } from "@/lib/data";
import { eventRoster, eventSummary, hasStarted, isCompleted, type RosterRow } from "@/lib/rules";
import { fmtDateShort } from "@/lib/time";
import { useActions, useSaver } from "@/components/actions";
import { EventStateTags, EventWhen, plannedSentence } from "@/components/EventBits";
import { AuditList } from "@/components/History";
import { useToast } from "@/components/toast";
import { Avatar, Button, Card, Empty, Pill, SaveStatus, SectionTitle, Sheet, StatusPill, TypePill, cx } from "@/components/ui";

export default function EventDetail() {
  const id = useSearchParams().get("id");
  const { snap, now } = useSnap();
  const L = useLookups();
  const actions = useActions();
  const ev = id ? L.event.get(id) : undefined;
  if (!ev) {
    return (
      <Card>
        <Empty>This event couldn’t be found. It may have been removed from your view. <Link className="font-semibold underline" href="/calendar">Back to the calendar</Link></Empty>
      </Card>
    );
  }
  const started = hasStarted(ev, now);
  const completed = isCompleted(ev, now);
  const s = eventSummary(snap, ev);
  const roster = eventRoster(snap, ev);
  const canceled = ev.status === "canceled";

  return (
    <div className="space-y-6">
      <Link href="/calendar" className="inline-flex min-h-11 items-center text-[15px] font-semibold text-navy underline-offset-4 hover:underline">‹ Calendar</Link>
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <TypePill ev={ev} />
            <h1 className={cx("mt-1 font-serif text-[26px] font-semibold leading-tight sm:text-[30px]", canceled && "line-through")}>{ev.title}</h1>
            {ev.speaker && <p className="mt-0.5 text-[17px]">{ev.speaker}</p>}
            <p className="mt-1 text-[15px]"><EventWhen ev={ev} long /></p>
            {ev.location && <p className="text-[15px] text-muted">{ev.location}</p>}
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Pill tone={ev.attendance_required ? "navy" : "quiet"}>{ev.attendance_required ? "Attendance required" : "Optional"}</Pill>
              <EventStateTags ev={ev} />
            </div>
            {ev.description && <p className="mt-3 max-w-prose whitespace-pre-line text-[15px]">{ev.description}</p>}
          </div>
          <Button onClick={() => actions.editEvent({ event: ev })}>Edit event</Button>
        </div>
        <p className="mt-3 text-[13px] text-muted">Last changed by {L.personName(ev.updated_by)}</p>
      </Card>

      {canceled && <p role="status" className="rounded-xl bg-quiet px-4 py-3 text-[15px] ring-1 ring-line">This event is canceled. It’s kept for the record and doesn’t count toward any totals.</p>}
      {ev.needs_review && <ReviewedBanner />}

      {!canceled && !started && (
        <section aria-labelledby="planned-h">
          <SectionTitle><span id="planned-h">Planned absences</span></SectionTitle>
          <p className="-mt-2 mb-3 text-[15px]">
            <strong>{plannedSentence(s.planned.length, s.noAbsenceReported)}</strong>
            {s.elevated && <span className="ml-2"><Pill tone="warn" icon="⚠">At or above threshold ({snap.settings.warning_threshold})</Pill></span>}
          </p>
          <Button variant="primary" className="mb-3" onClick={() => actions.recordAbsence({ eventId: ev.id })}>Record absence</Button>
          <ul className="space-y-2">{roster.map((r) => <PlanRow key={r.fellow.id} row={r} />)}</ul>
        </section>
      )}

      {!canceled && started && <AttendanceSection roster={roster} completed={completed} />}

      <section aria-labelledby="hist-h">
        <SectionTitle><span id="hist-h">Change history for this event</span></SectionTitle>
        <AuditList eventId={ev.id} />
      </section>
    </div>
  );

}

function ReviewedBanner() {
  return (
    <div role="status" className="rounded-xl bg-gold-soft px-4 py-3 text-[15px] text-gold-ink ring-1 ring-gold/50">
      <p><strong>This event was rescheduled after attendance was recorded.</strong> Check the records below are still right, then mark it reviewed.</p>
      <MarkReviewed />
    </div>
  );
}

function MarkReviewed() {
  const id = useSearchParams().get("id");
  const L = useLookups();
  const { backend } = useSnap();
  const saver = useSaver();
  const ev = id ? L.event.get(id) : undefined;
  if (!ev) return null;
  return (
    <div className="mt-2 flex items-center gap-3">
      <Button onClick={() => saver.run(() => backend.updateEvent(ev, { needs_review: false }), "Marked reviewed")} disabled={saver.saving}>Mark reviewed</Button>
      <SaveStatus state={saver.state} />
    </div>
  );
}

function RowShell({ row, children, status }: { row: RosterRow; children: React.ReactNode; status: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-2xl bg-card p-3 ring-1 ring-line">
      <Avatar fellow={row.fellow} size={44} ring={row.status === "absent" ? "absent" : row.plan.planned ? "gold" : null} />
      <div className="min-w-0 flex-1">
        <Link href={`/fellow?id=${row.fellow.id}`} className="font-semibold hover:underline">{row.fellow.display_name}</Link>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[13px] text-muted">{status}</div>
      </div>
      <div className="flex w-full flex-wrap justify-end gap-2 sm:w-auto">{children}</div>
    </li>
  );
}

function PlanRow({ row }: { row: RosterRow }) {
  const { backend } = useSnap();
  const L = useLookups();
  const actions = useActions();
  const toast = useToast();
  const saver = useSaver();
  const { plan, fellow } = row;
  const eventId = useSearchParams().get("id")!;

  const removePlan = async () => {
    const before = plan.eventPlan!;
    const ok = await saver.run(() => backend.setEventPlan({ fellowId: fellow.id, eventId, kind: null, reasonId: null, note: null, expectedVersion: before.version }));
    if (ok === undefined) return; // save failed; the error is shown on the row
    toast({
      tone: "ok", msg: before.kind === "absent" ? `Planned absence removed for ${fellow.display_name}.` : "Exception removed.",
      action: { label: "Undo", run: async () => { await backend.setEventPlan({ fellowId: fellow.id, eventId, kind: before.kind, reasonId: before.reason_id, note: before.note, expectedVersion: null }); } },
    });
  };
  const willAttend = () =>
    saver.run(() => backend.setEventPlan({ fellowId: fellow.id, eventId, kind: "attending", reasonId: null, note: null, expectedVersion: plan.eventPlan?.version ?? null }), "Marked as attending this one");

  let status: React.ReactNode;
  let buttons: React.ReactNode;
  if (plan.planned && plan.source === "event") {
    status = <><StatusPill status="planned" /> <span>{L.reasonLabel(plan.reasonId)}{plan.note && ` · “${plan.note}”`}</span>{plan.ranges.length > 0 && <span>· also within time away</span>}</>;
    buttons = <Button variant="danger" onClick={removePlan} disabled={saver.saving}>Undo absence</Button>;
  } else if (plan.planned && plan.source === "range") {
    const r = plan.ranges[0];
    status = <><StatusPill status="planned" /> <span>{L.reasonLabel(plan.reasonId)} · time away {fmtDateShort(r.start_date)} – {fmtDateShort(r.end_date)}</span></>;
    buttons = (
      <>
        <Button onClick={willAttend} disabled={saver.saving}>Will attend this one</Button>
        <Button onClick={() => actions.planAway({ range: r })}>Edit time away</Button>
      </>
    );
  } else if (plan.exception) {
    status = <><Pill tone="present">Will attend</Pill><span>exception to time away</span></>;
    buttons = <Button onClick={removePlan} disabled={saver.saving}>Remove exception</Button>;
  } else {
    status = <span>No absence reported</span>;
    buttons = <Button onClick={() => actions.recordAbsence({ eventId, fellowId: fellow.id })}>Plan absence</Button>;
  }
  return (
    <RowShell row={row} status={status}>
      {buttons}
      {saver.state.phase === "error" && <div className="w-full"><SaveStatus state={saver.state} /></div>}
    </RowShell>
  );
}

function AttendanceSection({ roster, completed }: { roster: RosterRow[]; completed: boolean }) {
  const eventId = useSearchParams().get("id")!;
  const { backend, me } = useSnap();
  const actions = useActions();
  const saver = useSaver();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const remaining = roster.filter((r) => r.status === "not_recorded");
  const plannedRemaining = remaining.filter((r) => r.plan.planned);
  const counts = {
    present: roster.filter((r) => r.status === "present").length,
    absent: roster.filter((r) => r.status === "absent").length,
    nr: remaining.length,
  };

  const markRest = async () => {
    const ids = remaining.map((r) => r.fellow.id);
    const n = await saver.run(() => backend.markRemainingPresent(eventId, ids));
    setConfirm(false);
    if (n !== undefined) toast({ tone: "ok", msg: `${n} Fellow${n === 1 ? "" : "s"} marked present. Logged under ${me?.member?.display_name}.` });
  };

  return (
    <section aria-labelledby="review" id="review">
      <SectionTitle><span id="review">{completed ? "Attendance review" : "Attendance (in progress)"}</span></SectionTitle>
      <div className="mb-3 grid grid-cols-3 gap-2 text-center">
        <Stat n={counts.present} label="Present" tone="text-present" />
        <Stat n={counts.absent} label="Absent" tone="text-absent" />
        <Stat n={counts.nr} label="Not recorded" tone="text-muted" />
      </div>
      <p className="mb-3 text-[14px] text-muted">
        Plans made before the event are shown as hints only. Confirm each actual absence. Unreviewed Fellows stay “Not recorded” — they are not assumed present.
      </p>
      <div className="mb-3 flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => actions.recordAbsence({ eventId })}>Record absence</Button>
        {remaining.length > 0 && (
          <Button onClick={() => setConfirm(true)}>Mark remaining present ({remaining.length})</Button>
        )}
      </div>
      <ul className="space-y-2">{roster.map((r) => <AttendanceRow key={r.fellow.id} row={r} eventId={eventId} />)}</ul>

      <Sheet open={confirm} onClose={() => setConfirm(false)} title="Mark remaining present?"
        footer={
          <div className="space-y-2">
            <SaveStatus state={saver.state} />
            <div className="flex gap-2"><Button className="flex-1" onClick={() => setConfirm(false)}>Cancel</Button>
              <Button variant="primary" className="flex-[2]" disabled={saver.saving} onClick={markRest}>{saver.saving ? "Saving…" : `Mark ${remaining.length} present`}</Button></div>
          </div>
        }>
        <p className="text-[15px]">These Fellows are still “Not recorded” and will be marked <strong>Present</strong>. This is logged under your name.</p>
        <ul className="mt-3 space-y-1 text-[15px]">{remaining.map((r) => <li key={r.fellow.id}>• {r.fellow.display_name}{r.plan.planned && <span className="text-gold-ink"> — had a planned absence</span>}</li>)}</ul>
        {plannedRemaining.length > 0 && (
          <p className="mt-3 rounded-xl bg-gold-soft px-3 py-2 text-[14px] text-gold-ink ring-1 ring-gold/40">
            {plannedRemaining.length} of them had a planned absence. If they actually missed the event, cancel and use “Confirm absent” on their row first.
          </p>
        )}
      </Sheet>
    </section>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone: string }) {
  return (
    <div className="rounded-xl bg-card px-2 py-3 ring-1 ring-line">
      <div className={cx("font-serif text-[26px] font-semibold tabular", tone)}>{n}</div>
      <div className="text-[13px] text-muted">{label}</div>
    </div>
  );
}

function AttendanceRow({ row, eventId }: { row: RosterRow; eventId: string }) {
  const { backend } = useSnap();
  const L = useLookups();
  const actions = useActions();
  const toast = useToast();
  const saver = useSaver();
  const { fellow, attendance, status, plan } = row;
  const v = attendance?.version ?? null;

  const set = async (next: "present" | "not_recorded" | "absent", reasonId: string | null = null, note: string | null = null) => {
    const prev = attendance;
    const r = await saver.run(() => backend.recordAttendance({ fellowId: fellow.id, eventId, status: next, reasonId, note, expectedVersion: v }));
    if (!r) return;
    const label = next === "present" ? "marked present" : next === "absent" ? "recorded absent" : prev?.status === "absent" ? "absence undone" : "cleared";
    toast({
      tone: "ok", msg: `${fellow.display_name}: ${label}.`,
      action: {
        label: "Undo",
        run: async () => {
          await backend.recordAttendance({ fellowId: fellow.id, eventId, status: prev?.status ?? "not_recorded", reasonId: prev?.reason_id ?? null, note: prev?.note ?? null, expectedVersion: r.version });
        },
      },
    });
  };

  const statusEl = (
    <>
      <StatusPill status={status} planned={status === "not_recorded" && plan.planned} />
      {status === "absent" && <span>{L.reasonLabel(attendance?.reason_id)}{attendance?.note && ` · “${attendance.note}”`}</span>}
      {status !== "absent" && plan.planned && <span className="text-gold-ink">Planned beforehand: {L.reasonLabel(plan.reasonId)}</span>}
      {attendance && status !== "not_recorded" && <span>· by {L.personName(attendance.updated_by)}{attendance.marked_via === "mark_remaining_present" && " (mark remaining)"}</span>}
    </>
  );

  return (
    <RowShell row={row} status={statusEl}>
      {status === "not_recorded" && plan.planned && (
        <Button variant="danger" disabled={saver.saving} onClick={() => set("absent", plan.reasonId, plan.note)}>Confirm absent</Button>
      )}
      {status === "not_recorded" && !plan.planned && (
        <Button disabled={saver.saving} onClick={() => actions.recordAbsence({ eventId, fellowId: fellow.id })}>Absent…</Button>
      )}
      {status !== "present" && <Button disabled={saver.saving} onClick={() => set("present")}>Mark present</Button>}
      {status === "absent" && (
        <>
          <Button disabled={saver.saving} onClick={() => actions.recordAbsence({ eventId, fellowId: fellow.id })}>Change reason</Button>
          <Button variant="danger" disabled={saver.saving} onClick={() => set("not_recorded")}>Undo absence</Button>
        </>
      )}
      {status === "present" && (
        <>
          <Button disabled={saver.saving} onClick={() => actions.recordAbsence({ eventId, fellowId: fellow.id })}>Absent…</Button>
          <Button variant="ghost" disabled={saver.saving} onClick={() => set("not_recorded")}>Clear</Button>
        </>
      )}
      {saver.state.phase !== "idle" && saver.state.phase !== "saved" && <div className="w-full"><SaveStatus state={saver.state} /></div>}
    </RowShell>
  );
}
