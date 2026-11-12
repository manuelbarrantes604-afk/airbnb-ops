// Counting rules. This is the ONE place that turns records into numbers.
// Screens and CSV exports both call these functions, so they always agree.
//
//  * One actual absence = one confirmed "absent" record for one eligible
//    Fellow at one completed, required, non-canceled event.
//  * Future plans never increase actual totals.
//  * Completed events without a record stay "Not recorded" (never assumed present).
//  * Two required events missed on one date = 2 "events missed".
//  * Undo (status back to not_recorded), cancellations and repeated saves can't
//    inflate totals: there is at most one attendance row per Fellow per event.

import type {
  Attendance, AttendanceStatus, CalEvent, EventPlan, EventType, Fellow, Snapshot, TimeAway,
} from "./types";

export const hasStarted = (ev: CalEvent, now: Date) => new Date(ev.starts_at).getTime() <= now.getTime();
export const isCompleted = (ev: CalEvent, now: Date) => new Date(ev.ends_at).getTime() <= now.getTime();
export const isUpcoming = (ev: CalEvent, now: Date) => !hasStarted(ev, now);

export function isEligible(f: Fellow, dateKey: string): boolean {
  if (f.eligible_from && dateKey < f.eligible_from) return false;
  if (f.eligible_until && dateKey > f.eligible_until) return false;
  return true;
}

export function eligibleFellows(snap: Pick<Snapshot, "fellows">, ev: CalEvent): Fellow[] {
  return sortFellows(snap.fellows.filter((f) => isEligible(f, ev.local_date)));
}

export function sortFellows(list: Fellow[]): Fellow[] {
  return [...list].sort((a, b) => a.sort_order - b.sort_order || a.display_name.localeCompare(b.display_name));
}

export const activeRanges = (ranges: TimeAway[]) => ranges.filter((r) => !r.removed_at);

export function rangeCovers(r: TimeAway, dateKey: string) {
  return !r.removed_at && r.start_date <= dateKey && dateKey <= r.end_date;
}

export interface PlanInfo {
  planned: boolean;
  source: "event" | "range" | null;
  reasonId: string | null;
  note: string | null;
  ranges: TimeAway[]; // all active ranges covering the date (may overlap)
  eventPlan: EventPlan | null;
  /** A "will attend" exception overrides a covering range. */
  exception: boolean;
}

/** Plans for a Fellow at an event. Overlapping ranges + a single-event plan still count once. */
export function planFor(
  snap: Pick<Snapshot, "timeAway" | "plans">,
  fellowId: string,
  ev: CalEvent,
): PlanInfo {
  const eventPlan = snap.plans.find((p) => p.fellow_id === fellowId && p.event_id === ev.id) ?? null;
  const ranges = snap.timeAway
    .filter((r) => r.fellow_id === fellowId && rangeCovers(r, ev.local_date))
    .sort((a, b) => a.start_date.localeCompare(b.start_date));
  if (eventPlan?.kind === "absent") {
    return { planned: true, source: "event", reasonId: eventPlan.reason_id, note: eventPlan.note, ranges, eventPlan, exception: false };
  }
  if (eventPlan?.kind === "attending") {
    return { planned: false, source: null, reasonId: null, note: null, ranges, eventPlan, exception: ranges.length > 0 };
  }
  if (ranges.length) {
    return { planned: true, source: "range", reasonId: ranges[0].reason_id, note: ranges[0].note, ranges, eventPlan, exception: false };
  }
  return { planned: false, source: null, reasonId: null, note: null, ranges, eventPlan, exception: false };
}

export function attendanceFor(snap: Pick<Snapshot, "attendance">, fellowId: string, eventId: string): Attendance | null {
  return snap.attendance.find((a) => a.fellow_id === fellowId && a.event_id === eventId) ?? null;
}

export function statusOf(a: Attendance | null): AttendanceStatus {
  return a?.status ?? "not_recorded";
}

export interface RosterRow {
  fellow: Fellow;
  plan: PlanInfo;
  attendance: Attendance | null;
  status: AttendanceStatus;
}

export function eventRoster(snap: Snapshot, ev: CalEvent): RosterRow[] {
  return eligibleFellows(snap, ev).map((fellow) => {
    const attendance = attendanceFor(snap, fellow.id, ev.id);
    return { fellow, plan: planFor(snap, fellow.id, ev), attendance, status: statusOf(attendance) };
  });
}

export interface EventSummary {
  eligible: number;
  planned: RosterRow[];      // planned absences (meaningful for upcoming events)
  noAbsenceReported: number; // eligible − planned. NOT "confirmed attending".
  elevated: boolean;
  present: number;
  absent: number;
  notRecorded: number;
}

export function eventSummary(snap: Snapshot, ev: CalEvent): EventSummary {
  const roster = eventRoster(snap, ev);
  const planned = roster.filter((r) => r.plan.planned);
  return {
    eligible: roster.length,
    planned,
    noAbsenceReported: roster.length - planned.length,
    elevated: ev.status === "scheduled" && planned.length >= snap.settings.warning_threshold,
    present: roster.filter((r) => r.status === "present").length,
    absent: roster.filter((r) => r.status === "absent").length,
    notRecorded: roster.filter((r) => r.status === "not_recorded").length,
  };
}

/** Does this event count toward required-event totals? */
export function countsTowardTotals(ev: CalEvent, now: Date): boolean {
  return ev.status === "scheduled" && ev.attendance_required && isCompleted(ev, now);
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export interface ReportFilters {
  from: string | null; // inclusive YYYY-MM-DD
  to: string | null;
  fellowId: string | null;
  eventType: EventType | null;
  reasonId: string | null; // narrows ABSENCE counts to one reason
}

export const emptyFilters: ReportFilters = { from: null, to: null, fellowId: null, eventType: null, reasonId: null };

export interface ReportRow {
  fellow: Fellow;
  event: CalEvent;
  status: AttendanceStatus;
  attendance: Attendance | null;
}

/** One row per (eligible Fellow × completed, required, non-canceled event) inside the filters. */
export function reportRows(snap: Snapshot, filters: ReportFilters, now: Date): ReportRow[] {
  const rows: ReportRow[] = [];
  const events = snap.events
    .filter((e) => countsTowardTotals(e, now))
    .filter((e) => (!filters.from || e.local_date >= filters.from) && (!filters.to || e.local_date <= filters.to))
    .filter((e) => !filters.eventType || e.event_type === filters.eventType)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const fellows = sortFellows(snap.fellows.filter((f) => !filters.fellowId || f.id === filters.fellowId));
  for (const event of events) {
    for (const fellow of fellows) {
      if (!isEligible(fellow, event.local_date)) continue;
      const attendance = attendanceFor(snap, fellow.id, event.id);
      rows.push({ fellow, event, status: statusOf(attendance), attendance });
    }
  }
  return rows;
}

export interface FellowTotals {
  fellow: Fellow;
  eligibleEvents: number;       // completed, required, non-canceled events in filter
  eventsMissed: number;         // confirmed absences (all required event types in filter)
  speakerSeriesMissed: number;  // subset of eventsMissed
  present: number;
  notRecorded: number;
  plannedUpcoming: number;      // future planned absences (separate; never added to actual)
  byReason: Record<string, number>;
}

export function isCountedAbsence(r: ReportRow, filters: ReportFilters) {
  return r.status === "absent" && (!filters.reasonId || r.attendance?.reason_id === filters.reasonId);
}

export function fellowTotals(snap: Snapshot, filters: ReportFilters, now: Date): FellowTotals[] {
  const rows = reportRows(snap, filters, now);
  const fellows = sortFellows(snap.fellows.filter((f) => !filters.fellowId || f.id === filters.fellowId));
  return fellows.map((fellow) => {
    const mine = rows.filter((r) => r.fellow.id === fellow.id);
    const missed = mine.filter((r) => isCountedAbsence(r, filters));
    const byReason: Record<string, number> = {};
    for (const r of missed) {
      const k = r.attendance?.reason_id ?? "none";
      byReason[k] = (byReason[k] ?? 0) + 1;
    }
    return {
      fellow,
      eligibleEvents: mine.length,
      eventsMissed: missed.length,
      speakerSeriesMissed: missed.filter((r) => r.event.event_type === "speaker_series").length,
      present: mine.filter((r) => r.status === "present").length,
      notRecorded: mine.filter((r) => r.status === "not_recorded").length,
      plannedUpcoming: plannedUpcomingCount(snap, fellow, filters, now),
      byReason,
    };
  });
}

/** Future, scheduled, required events where the Fellow has a planned absence. */
export function plannedUpcomingCount(snap: Snapshot, fellow: Fellow, filters: ReportFilters, now: Date): number {
  return upcomingPlannedEvents(snap, fellow, now)
    .filter((e) => (!filters.from || e.local_date >= filters.from) && (!filters.to || e.local_date <= filters.to))
    .filter((e) => !filters.eventType || e.event_type === filters.eventType)
    .filter((e) => !filters.reasonId || planFor(snap, fellow.id, e).reasonId === filters.reasonId).length;
}

export function upcomingPlannedEvents(snap: Snapshot, fellow: Fellow, now: Date): CalEvent[] {
  return snap.events
    .filter((e) => e.status === "scheduled" && e.attendance_required && isUpcoming(e, now) && isEligible(fellow, e.local_date))
    .filter((e) => planFor(snap, fellow.id, e).planned)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
}

export interface ClassTotals {
  eventsCounted: number;
  eventsMissed: number;
  speakerSeriesMissed: number;
  notRecorded: number;
  byReason: Record<string, number>;
  unreviewedEvents: number; // completed counted events with ≥1 "not recorded"
}

export function classTotals(snap: Snapshot, filters: ReportFilters, now: Date): ClassTotals {
  const rows = reportRows(snap, filters, now);
  const missed = rows.filter((r) => isCountedAbsence(r, filters));
  const byReason: Record<string, number> = {};
  for (const r of missed) {
    const k = r.attendance?.reason_id ?? "none";
    byReason[k] = (byReason[k] ?? 0) + 1;
  }
  const eventIds = new Set(rows.map((r) => r.event.id));
  const unreviewed = new Set(rows.filter((r) => r.status === "not_recorded").map((r) => r.event.id));
  return {
    eventsCounted: eventIds.size,
    eventsMissed: missed.length,
    speakerSeriesMissed: missed.filter((r) => r.event.event_type === "speaker_series").length,
    notRecorded: rows.filter((r) => r.status === "not_recorded").length,
    byReason,
    unreviewedEvents: unreviewed.size,
  };
}

/** Completed, non-canceled events that still need someone to review attendance. */
export function eventsNeedingReview(snap: Snapshot, now: Date): CalEvent[] {
  return snap.events
    .filter((e) => e.status === "scheduled" && isCompleted(e, now))
    .filter((e) => e.needs_review || eventRoster(snap, e).some((r) => r.status === "not_recorded"))
    .sort((a, b) => b.starts_at.localeCompare(a.starts_at));
}

/** Upcoming scheduled events, soonest first. Includes events in progress. */
export function upcomingEvents(snap: Snapshot, now: Date): CalEvent[] {
  return snap.events
    .filter((e) => e.status === "scheduled" && !isCompleted(e, now))
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
}

/** Events a time-away range would cover (for previews). */
export function eventsInRange(snap: Snapshot, start: string, end: string): CalEvent[] {
  return snap.events
    .filter((e) => e.local_date >= start && e.local_date <= end)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
}

export function initials(name: string): string {
  const m = name.match(/^Fellow\s+(\d+)$/i);
  if (m) return m[1].padStart(2, "0");
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}
