import { describe, expect, it } from "vitest";
import { nyToUtc, nyDateKey, nyTimeKey, addDays, weekdayOf } from "../src/lib/time";
import {
  planFor, eventSummary, fellowTotals, classTotals, emptyFilters, reportRows, eventsNeedingReview, initials,
} from "../src/lib/rules";
import type { Attendance, CalEvent, EventPlan, Fellow, Snapshot, TimeAway } from "../src/lib/types";

describe("New York time", () => {
  it("converts summer (EDT, UTC-4) and winter (EST, UTC-5) correctly", () => {
    expect(nyToUtc("2026-07-14", "12:00").toISOString()).toBe("2026-07-14T16:00:00.000Z");
    expect(nyToUtc("2026-12-15", "12:00").toISOString()).toBe("2026-12-15T17:00:00.000Z");
  });
  it("handles the DST switch days", () => {
    // 2026-03-08 spring forward; 2026-11-01 fall back
    expect(nyToUtc("2026-03-08", "10:00").toISOString()).toBe("2026-03-08T14:00:00.000Z");
    expect(nyToUtc("2026-03-07", "10:00").toISOString()).toBe("2026-03-07T15:00:00.000Z");
    expect(nyToUtc("2026-11-01", "10:00").toISOString()).toBe("2026-11-01T15:00:00.000Z");
    expect(nyToUtc("2026-10-31", "10:00").toISOString()).toBe("2026-10-31T14:00:00.000Z");
    // fall-back ambiguous 1:30am → earlier (EDT) instant
    expect(nyToUtc("2026-11-01", "01:30").toISOString()).toBe("2026-11-01T05:30:00.000Z");
  });
  it("round-trips and keeps late-evening events on the right date", () => {
    const d = nyToUtc("2026-12-31", "23:30");
    expect(nyDateKey(d)).toBe("2026-12-31");
    expect(nyTimeKey(d)).toBe("23:30");
  });
  it("does date arithmetic", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(weekdayOf("2026-11-18")).toBe(3); // Wednesday
  });
});

// ---------------------------------------------------------------------------
const NOW = new Date("2026-11-12T17:00:00Z");
let seq = 0;
const fellow = (n: number, extra: Partial<Fellow> = {}): Fellow => ({
  id: `f${n}`, display_name: `Fellow ${String(n).padStart(2, "0")}`, agency: null, photo_path: null, sort_order: n,
  eligible_from: null, eligible_until: null, is_placeholder: true, version: 1, updated_at: "", updated_by: null, ...extra,
});
const event = (id: string, date: string, time = "12:00", extra: Partial<CalEvent> = {}): CalEvent => {
  const s = nyToUtc(date, time);
  return {
    id, title: id, event_type: "speaker_series", starts_at: s.toISOString(),
    ends_at: new Date(s.getTime() + 3600_000).toISOString(), local_date: date, speaker: null, location: null,
    description: null, attendance_required: true, status: "scheduled", needs_review: false, series_id: null,
    version: 1, created_at: "", created_by: null, updated_at: "", updated_by: null, ...extra,
  };
};
const att = (f: string, e: string, status: Attendance["status"], reason: string | null = null): Attendance => ({
  fellow_id: f, event_id: e, status, reason_id: status === "absent" ? reason ?? "r-ill" : null, note: null,
  marked_via: "individual", version: 1, updated_at: "", updated_by: null,
});
const range = (f: string, s: string, e: string, extra: Partial<TimeAway> = {}): TimeAway => ({
  id: `ta${++seq}`, fellow_id: f, start_date: s, end_date: e, reason_id: "r-mil", note: null, removed_at: null,
  version: 1, created_at: "", created_by: null, updated_at: "", updated_by: null, ...extra,
});
const plan = (f: string, e: string, kind: EventPlan["kind"]): EventPlan => ({
  fellow_id: f, event_id: e, kind, reason_id: kind === "absent" ? "r-travel" : null, note: null, version: 1, updated_at: "", updated_by: null,
});
function snap(p: Partial<Snapshot>): Snapshot {
  return {
    fellows: Array.from({ length: 11 }, (_, i) => fellow(i + 1)), events: [], timeAway: [], plans: [], attendance: [],
    reasons: [], directory: [], loadedAt: "",
    settings: { id: 1, program_name: "", class_label: "", warning_threshold: 3, threshold_is_provisional: true, primary_owner_id: null, backup_owner_id: null, version: 1 },
    ...p,
  };
}

describe("planned absences", () => {
  it("a range saved before events exist applies to an event added later", () => {
    const s = snap({ timeAway: [range("f1", "2027-01-04", "2027-01-22")] });
    expect(s.events.length).toBe(0);
    s.events.push(event("later", "2027-01-12"));
    expect(planFor(s, "f1", s.events[0]).planned).toBe(true);
    expect(planFor(s, "f1", s.events[0]).source).toBe("range");
  });
  it("overlapping ranges + a single-event plan count once", () => {
    const ev = event("e", "2027-01-12");
    const s = snap({
      events: [ev],
      timeAway: [range("f1", "2027-01-01", "2027-01-31"), range("f1", "2027-01-10", "2027-01-15")],
      plans: [plan("f1", "e", "absent")],
    });
    const sum = eventSummary(s, ev);
    expect(sum.planned.length).toBe(1);
    expect(sum.noAbsenceReported).toBe(10);
  });
  it("a will-attend exception overrides a range", () => {
    const ev = event("e", "2027-01-12");
    const s = snap({ events: [ev], timeAway: [range("f1", "2027-01-01", "2027-01-31")], plans: [plan("f1", "e", "attending")] });
    const p = planFor(s, "f1", ev);
    expect(p.planned).toBe(false);
    expect(p.exception).toBe(true);
  });
  it("removed ranges stop applying", () => {
    const ev = event("e", "2027-01-12");
    const s = snap({ events: [ev], timeAway: [range("f1", "2027-01-01", "2027-01-31", { removed_at: "x" })] });
    expect(planFor(s, "f1", ev).planned).toBe(false);
  });
  it("rescheduling an event out of a range removes the projection", () => {
    const ev = event("e", "2027-01-12");
    const s = snap({ events: [ev], timeAway: [range("f1", "2027-01-01", "2027-01-15")] });
    expect(planFor(s, "f1", ev).planned).toBe(true);
    s.events[0] = event("e", "2027-01-20");
    expect(planFor(s, "f1", s.events[0]).planned).toBe(false);
  });
  it("flags elevated planned absences at the threshold", () => {
    const ev = event("e", "2027-01-12");
    const s = snap({ events: [ev], plans: ["f1", "f2", "f3"].map((f) => plan(f, "e", "absent")) });
    expect(eventSummary(s, ev).elevated).toBe(true);
    s.plans.pop();
    expect(eventSummary(s, ev).elevated).toBe(false);
  });
});

describe("actual totals", () => {
  it("future plans never increase actual totals", () => {
    const ev = event("future", "2027-01-12");
    const s = snap({ events: [ev], plans: [plan("f1", "future", "absent")] });
    const t = fellowTotals(s, emptyFilters, NOW).find((x) => x.fellow.id === "f1")!;
    expect(t.eventsMissed).toBe(0);
    expect(t.plannedUpcoming).toBe(1);
  });
  it("a plan stays unconfirmed after the event until reviewed", () => {
    const ev = event("past", "2026-11-10");
    const s = snap({ events: [ev], timeAway: [range("f1", "2026-11-01", "2026-11-30")] });
    const t = fellowTotals(s, emptyFilters, NOW).find((x) => x.fellow.id === "f1")!;
    expect(t.eventsMissed).toBe(0);
    expect(t.notRecorded).toBe(1);
    expect(eventsNeedingReview(s, NOW).map((e) => e.id)).toEqual(["past"]);
  });
  it("undo returns the total to zero; it does not mark present", () => {
    const ev = event("past", "2026-11-10");
    const s = snap({ events: [ev], attendance: [att("f2", "past", "absent")] });
    expect(fellowTotals(s, emptyFilters, NOW)[1].eventsMissed).toBe(1);
    s.attendance[0] = att("f2", "past", "not_recorded");
    const t = fellowTotals(s, emptyFilters, NOW)[1];
    expect(t.eventsMissed).toBe(0);
    expect(t.present).toBe(0);
    expect(t.notRecorded).toBe(1);
  });
  it("two required events on one date count as two events missed; speaker series separate", () => {
    const a = event("am", "2026-11-04", "09:00", { event_type: "program_event" });
    const b = event("pm", "2026-11-04", "14:00");
    const s = snap({ events: [a, b], attendance: [att("f3", "am", "absent"), att("f3", "pm", "absent")] });
    const t = fellowTotals(s, emptyFilters, NOW)[2];
    expect(t.eventsMissed).toBe(2);
    expect(t.speakerSeriesMissed).toBe(1);
  });
  it("canceled and optional events never count", () => {
    const c = event("c", "2026-11-04", "09:00", { status: "canceled" });
    const o = event("o", "2026-11-05", "09:00", { attendance_required: false });
    const s = snap({ events: [c, o], attendance: [att("f1", "c", "absent"), att("f1", "o", "absent")] });
    expect(fellowTotals(s, emptyFilters, NOW)[0].eventsMissed).toBe(0);
    expect(classTotals(s, emptyFilters, NOW).eventsCounted).toBe(0);
  });
  it("a Wednesday event counts like any other day", () => {
    const w = event("wed", "2026-11-11");
    expect(weekdayOf("2026-11-11")).toBe(3);
    const s = snap({ events: [w], attendance: [att("f4", "wed", "absent")] });
    expect(fellowTotals(s, emptyFilters, NOW)[3].eventsMissed).toBe(1);
  });
  it("roster changes keep historical eligibility", () => {
    const early = event("early", "2026-09-01");
    const late = event("late", "2026-11-03");
    const fellows = Array.from({ length: 11 }, (_, i) => fellow(i + 1));
    fellows[10] = fellow(11, { eligible_until: "2026-10-01" });
    const s = snap({ fellows, events: [early, late] });
    const t = fellowTotals(s, emptyFilters, NOW)[10];
    expect(t.eligibleEvents).toBe(1);
    expect(reportRows(s, emptyFilters, NOW).filter((r) => r.event.id === "late").length).toBe(10);
  });
  it("filters (date, type, reason, fellow) apply identically to totals and rows", () => {
    const a = event("a", "2026-10-01");
    const b = event("b", "2026-11-03", "12:00", { event_type: "program_event" });
    const s = snap({ events: [a, b], attendance: [att("f1", "a", "absent", "r-mil"), att("f1", "b", "absent", "r-ill")] });
    const f = { ...emptyFilters, from: "2026-10-15", fellowId: "f1" };
    expect(fellowTotals(s, f, NOW)[0].eventsMissed).toBe(1);
    expect(fellowTotals(s, { ...emptyFilters, reasonId: "r-mil" }, NOW)[0].eventsMissed).toBe(1);
    expect(fellowTotals(s, { ...emptyFilters, eventType: "program_event" }, NOW)[0].speakerSeriesMissed).toBe(0);
    expect(classTotals(s, emptyFilters, NOW).byReason).toEqual({ "r-mil": 1, "r-ill": 1 });
  });
});

describe("initials", () => {
  it("uses the number for placeholders and first/last initials otherwise", () => {
    expect(initials("Fellow 07")).toBe("07");
    expect(initials("Avery Quinn Morgan")).toBe("AM");
  });
});
