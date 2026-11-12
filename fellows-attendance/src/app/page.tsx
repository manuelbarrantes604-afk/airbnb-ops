"use client";

import Link from "next/link";
import { useLookups, useSnap } from "@/lib/data";
import { eventSummary, eventsNeedingReview, hasStarted, upcomingEvents } from "@/lib/rules";
import { fmtDateMedium } from "@/lib/time";
import { useActions } from "@/components/actions";
import { EventRow, EventStateTags, EventWhen, plannedSentence } from "@/components/EventBits";
import { Avatar, Button, Card, Empty, LinkButton, Pill, SectionTitle, TypePill } from "@/components/ui";

export default function OverviewPage() {
  const { snap, now, me } = useSnap();
  const L = useLookups();
  const actions = useActions();
  const upcoming = upcomingEvents(snap, now);
  const next = upcoming[0];
  const nextSummary = next ? eventSummary(snap, next) : null;
  const threshold = snap.settings.warning_threshold;
  const elevated = upcoming.filter((e) => e !== next && !hasStarted(e, now)).filter((e) => eventSummary(snap, e).elevated).slice(0, 6);
  const review = eventsNeedingReview(snap, now).slice(0, 4);
  const later = upcoming.slice(1, 6);
  const firstName = me?.member?.display_name?.split(" ")[0];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[15px] text-muted">Welcome{firstName ? `, ${firstName}` : ""}</p>
          <h1 className="font-serif text-[30px] font-semibold leading-tight sm:text-[34px]">Overview</h1>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Button variant="primary" className="min-h-12 text-[17px]" onClick={() => actions.recordAbsence({ eventId: next?.id })}>Record absence</Button>
          <Button variant="gold" className="min-h-12 text-[17px]" onClick={() => actions.planAway()}>Plan time away</Button>
        </div>
      </div>

      {/* Next event */}
      {next && nextSummary ? (
        <Card className="ring-gold/60">
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-[13px] font-semibold uppercase tracking-wider text-gold-ink">
              {hasStarted(next, now) ? "Happening now" : "Next event"}
            </p>
            <TypePill ev={next} />
          </div>
          <Link href={`/event?id=${next.id}`} className="group block">
            <h2 className="font-serif text-[24px] font-semibold leading-snug group-hover:underline">{next.title}</h2>
          </Link>
          {next.speaker && <p className="mt-0.5 text-[16px]">{next.speaker}</p>}
          <p className="mt-1 text-[15px]"><EventWhen ev={next} long /></p>
          {next.location && <p className="text-[15px] text-muted">{next.location}</p>}
          <div className="mt-1"><EventStateTags ev={next} /></div>

          <div className="mt-4 border-t border-line pt-4">
            <p className="text-[15px] font-semibold">{plannedSentence(nextSummary.planned.length, nextSummary.noAbsenceReported)}</p>
            <p className="text-[13px] text-muted">“No absence reported” is not a confirmed attendance.</p>
            {nextSummary.planned.length > 0 ? (
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {nextSummary.planned.map((r) => (
                  <li key={r.fellow.id} className="flex items-center gap-3 rounded-xl bg-paper px-3 py-2 ring-1 ring-line">
                    <Avatar fellow={r.fellow} size={40} ring="gold" />
                    <span className="min-w-0">
                      <span className="block font-semibold">{r.fellow.display_name}</span>
                      <span className="block text-[13px] text-muted">{L.reasonLabel(r.plan.reasonId)}{r.plan.source === "range" && " · time away"}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[15px] text-muted">No one has reported they’ll miss it.</p>
            )}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <LinkButton href={`/event?id=${next.id}`} variant="secondary">Open event & attendance</LinkButton>
          </div>
        </Card>
      ) : (
        <Card><Empty>No upcoming events on the calendar. <Link className="font-semibold underline" href="/calendar">Add one in Calendar</Link>.</Empty></Card>
      )}

      {/* Elevated planned absences */}
      <section aria-labelledby="elevated-h">
        <SectionTitle aside={<span className="text-[13px] text-muted">Threshold: {threshold}+ planned{snap.settings.threshold_is_provisional && " · provisional setting"}</span>}>
          <span id="elevated-h">Upcoming events with several planned absences</span>
        </SectionTitle>
        {elevated.length ? (
          <ul className="space-y-2">
            {elevated.map((e) => {
              const s = eventSummary(snap, e);
              return (
                <li key={e.id}>
                  <Link href={`/event?id=${e.id}`} className="flex items-center gap-3 rounded-2xl bg-gold-soft/70 p-3.5 ring-1 ring-gold/50 hover:ring-gold">
                    <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-card font-semibold text-gold-ink ring-1 ring-gold">{s.planned.length}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold leading-snug">{e.title}</span>
                      <span className="block text-[14px] text-navy">{fmtDateMedium(e.local_date)} · {plannedSentence(s.planned.length, s.noAbsenceReported)}</span>
                      <span className="block truncate text-[13px] text-muted">{s.planned.map((r) => r.fellow.display_name).join(", ")}</span>
                    </span>
                    <span aria-hidden className="text-muted">›</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty>No later events have {threshold} or more planned absences.</Empty>
        )}
      </section>

      {/* Needs review */}
      {review.length > 0 && (
        <section aria-labelledby="review-h">
          <SectionTitle><span id="review-h">Past events to review</span></SectionTitle>
          <p className="-mt-2 mb-3 text-[14px] text-muted">These events have Fellows marked “Not recorded.” Plans are not assumed to have happened — confirm who actually missed.</p>
          <ul className="space-y-2">
            {review.map((e) => {
              const s = eventSummary(snap, e);
              return (
                <li key={e.id}>
                  <Link href={`/event?id=${e.id}#review`} className="flex items-center justify-between gap-3 rounded-2xl bg-card p-3.5 ring-1 ring-line hover:ring-gold">
                    <span className="min-w-0">
                      <span className="block font-semibold">{e.title}</span>
                      <span className="block text-[14px] text-muted">{fmtDateMedium(e.local_date)}</span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      {s.notRecorded > 0 && <Pill tone="quiet">{s.notRecorded} not recorded</Pill>}
                      {e.needs_review && <Pill tone="warn">Rescheduled</Pill>}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Coming up */}
      <section aria-labelledby="later-h">
        <SectionTitle aside={<Link href="/calendar" className="text-[15px] font-semibold underline">Full calendar</Link>}><span id="later-h">Coming up</span></SectionTitle>
        {later.length ? <ul className="space-y-2">{later.map((e) => <li key={e.id}><EventRow ev={e} /></li>)}</ul> : <Empty>Nothing else scheduled yet.</Empty>}
      </section>
    </div>
  );
}
