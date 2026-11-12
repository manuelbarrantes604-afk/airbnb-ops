"use client";

import Link from "next/link";
import { useLookups, useSnap } from "@/lib/data";
import type { CalEvent } from "@/lib/types";
import { attendanceFor, eventSummary, hasStarted, isCompleted, isEligible, planFor, statusOf } from "@/lib/rules";
import { fmtDateLong, fmtDateMedium, fmtTimeRange, relativeDay } from "@/lib/time";
import { Avatar, AvatarStack, Pill, StatusPill, TypePill, cx } from "./ui";

export function plannedSentence(planned: number, noneReported: number) {
  const p = `${planned} planned absence${planned === 1 ? "" : "s"}`;
  return `${p}; ${noneReported} ha${noneReported === 1 ? "s" : "ve"} no absence reported.`;
}

export function EventWhen({ ev, long }: { ev: CalEvent; long?: boolean }) {
  const { now } = useSnap();
  const rel = relativeDay(ev.local_date, now);
  return (
    <span>
      {rel && <strong className="text-navy">{rel} · </strong>}
      {long ? fmtDateLong(ev.local_date) : fmtDateMedium(ev.local_date)}
      <span className="text-muted"> · {fmtTimeRange(ev.starts_at, ev.ends_at)}</span>
    </span>
  );
}

export function EventStateTags({ ev }: { ev: CalEvent }) {
  const { now } = useSnap();
  return (
    <span className="flex flex-wrap gap-1.5">
      {ev.status === "canceled" && <Pill tone="quiet" icon="⊘">Canceled</Pill>}
      {ev.status === "scheduled" && hasStarted(ev, now) && !isCompleted(ev, now) && <Pill tone="navy">Happening now</Pill>}
      {ev.needs_review && <Pill tone="warn" icon="!">Rescheduled — review records</Pill>}
    </span>
  );
}

/** Compact row used in lists (agenda, overview). */
export function EventRow({ ev, showPlanned = true, fellowFilter }: { ev: CalEvent; showPlanned?: boolean; fellowFilter?: string | null }) {
  const { snap, now } = useSnap();
  const L = useLookups();
  const s = eventSummary(snap, ev);
  const upcoming = !hasStarted(ev, now);
  const completed = isCompleted(ev, now);
  const canceled = ev.status === "canceled";
  const fRow = fellowFilter ? L.fellow.get(fellowFilter) : null;
  return (
    <Link href={`/event?id=${ev.id}`}
      className={cx("block rounded-2xl bg-card p-4 ring-1 ring-line transition-colors hover:ring-gold", canceled && "opacity-70")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={cx("font-semibold leading-snug", canceled && "line-through")}>{ev.title}</p>
          {ev.speaker && <p className="text-[14px] text-muted">{ev.speaker}</p>}
          <p className="mt-0.5 text-[14px]"><EventWhen ev={ev} /></p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <TypePill ev={ev} />
            <EventStateTags ev={ev} />
          </div>
        </div>
        {showPlanned && !canceled && !fRow && (
          <div className="shrink-0 text-right">
            {upcoming ? (
              s.planned.length > 0 ? (
                <div className="flex flex-col items-end gap-1">
                  <AvatarStack fellows={s.planned.map((r) => r.fellow)} max={3} size={30} />
                  <span className={cx("text-[13px] font-semibold", s.elevated ? "text-gold-ink" : "text-muted")}>
                    {s.elevated && "⚠ "}{s.planned.length} planned
                  </span>
                </div>
              ) : <span className="text-[13px] text-muted">No absences reported</span>
            ) : completed ? (
              <span className="text-[13px] text-muted">
                {s.absent} absent{s.notRecorded > 0 && <><br /><span className="font-semibold text-gold-ink">{s.notRecorded} not recorded</span></>}
              </span>
            ) : null}
          </div>
        )}
        {fRow && !canceled && <FellowStatusForEvent ev={ev} fellowId={fRow.id} />}
      </div>
    </Link>
  );
}

function FellowStatusForEvent({ ev, fellowId }: { ev: CalEvent; fellowId: string }) {
  const { snap, now } = useSnap();
  const L = useLookups();
  const f = L.fellow.get(fellowId)!;
  if (!isEligible(f, ev.local_date)) return <span className="shrink-0 text-[12px] text-muted">Not on roster</span>;
  const status = statusOf(attendanceFor(snap, fellowId, ev.id));
  const plan = planFor(snap, fellowId, ev);
  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <Avatar fellow={f} size={30} />
      {!hasStarted(ev, now)
        ? plan.planned ? <Pill tone="planned">Planned absence</Pill> : <span className="text-[12px] text-muted">No absence reported</span>
        : <StatusPill status={status} planned={status === "not_recorded" && plan.planned} />}
    </div>
  );
}
