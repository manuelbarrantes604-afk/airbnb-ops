// DEMO ONLY — fictional data that lives in this browser.
// It mirrors the database rules (versions, one record per Fellow per event,
// audit history) so the preview behaves like the real app, but it is NOT shared
// and is NOT the production database.

import type {
  Attendance, AuditEntry, CalEvent, EventPlan, EventType, Fellow, Member, Reason, Settings, Snapshot, TimeAway,
} from "../types";
import { addDays, nyToUtc, todayKey, weekdayOf } from "../time";
import { AppError, appMessage, type Backend, type EventInput, type Me } from "./types";

const KEY = "fa-demo-v3";
const ROLE_KEY = "fa-demo-role";

interface DemoState {
  fellows: Fellow[];
  events: CalEvent[];
  timeAway: TimeAway[];
  plans: EventPlan[];
  attendance: Attendance[];
  reasons: Reason[];
  settings: Settings;
  members: Member[];
  audit: AuditEntry[];
  seq: number;
}

const STAFF_ID = "demo-staff";
const STAFF2_ID = "demo-staff-2";
const FELLOW_USER_ID = "demo-fellow-05";

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Math.random().toString(36).slice(2)}-${Date.now()}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function nowIso() {
  return new Date().toISOString();
}

// ---------------------------------------------------------------- seed
function seed(): DemoState {
  const T = todayKey();
  const at = nowIso();
  const R = (label: string, i: number): Reason => ({ id: `r${i}`, label, sort_order: i, active: true, version: 1 });
  const reasons = [
    R("Military training/duty", 1), R("Placement work obligation", 2), R("Illness", 3),
    R("Personal/family", 4), R("Travel", 5), R("Other", 6),
  ];
  const fellows: Fellow[] = Array.from({ length: 11 }, (_, i) => ({
    id: `f${i + 1}`, display_name: `Fellow ${String(i + 1).padStart(2, "0")}`, agency: null, photo_path: null,
    sort_order: i + 1, eligible_from: null, eligible_until: null, is_placeholder: true, version: 1,
    updated_at: at, updated_by: null,
  }));
  const members: Member[] = [
    { user_id: STAFF_ID, email: "staff@example.org", display_name: "Demo Staff (fictional)", kind: "staff", fellow_id: null, role: "admin", active: true, version: 1 },
    { user_id: STAFF2_ID, email: "coordinator@example.org", display_name: "Program Coordinator (fictional)", kind: "staff", fellow_id: null, role: "member", active: true, version: 1 },
    { user_id: FELLOW_USER_ID, email: "fellow05@example.org", display_name: "Fellow 05", kind: "fellow", fellow_id: "f5", role: "member", active: true, version: 1 },
  ];

  const events: CalEvent[] = [];
  const mk = (date: string, start: string, end: string, title: string, type: EventType, extra: Partial<CalEvent> = {}) => {
    const ev: CalEvent = {
      id: uid(), title, event_type: type, starts_at: nyToUtc(date, start).toISOString(), ends_at: nyToUtc(date, end).toISOString(),
      local_date: date, speaker: null, location: "Conference Room B (fictional)", description: null, attendance_required: true,
      status: "scheduled", needs_review: false, series_id: null, version: 1, created_at: at, created_by: STAFF_ID,
      updated_at: at, updated_by: STAFF_ID, ...extra,
    };
    events.push(ev);
    return ev;
  };

  // Speaker Series: Tuesdays & Thursdays from 5 weeks ago to ~4 months ahead.
  const topics = [
    "Public Service Leadership", "Budget & Appropriations", "Diplomacy in Practice", "Emergency Management",
    "Science Policy", "Economic Development", "Health Policy", "Cybersecurity", "Rural Infrastructure",
    "Veterans Affairs", "Trade & Competitiveness", "Education Policy", "Energy Transition", "Judicial Process",
  ];
  let k = 0;
  const speakerSeries: CalEvent[] = [];
  for (let d = addDays(T, -35); d <= addDays(T, 120); d = addDays(d, 1)) {
    const wd = weekdayOf(d);
    if (wd !== 2 && wd !== 4) continue;
    const topic = topics[k % topics.length];
    k++;
    speakerSeries.push(
      mk(d, "12:00", "13:30", `Speaker Series: ${topic}`, "speaker_series", {
        speaker: `Guest Speaker ${String.fromCharCode(65 + (k % 26))} (fictional)`,
      }),
    );
  }

  // A Wednesday program event next week.
  let wed = addDays(T, 1);
  while (weekdayOf(wed) !== 3) wed = addDays(wed, 1);
  wed = addDays(wed, 7);
  mk(wed, "09:30", "15:00", "Agency Site Visit (Wednesday)", "program_event", { location: "Offsite — details TBD (fictional)" });

  // Two required events on one date (a Thursday ~2 weeks out): add a morning briefing.
  const twoDay = speakerSeries.find((e) => e.local_date > addDays(T, 12) && weekdayOf(e.local_date) === 4)!;
  mk(twoDay.local_date, "09:00", "10:30", "Morning Policy Briefing", "program_event");

  // Optional social event.
  mk(addDays(T, 9), "18:00", "20:00", "Class Dinner (optional)", "other", { attendance_required: false, location: "TBD (fictional)" });

  // A canceled event (kept with history).
  const canceled = speakerSeries.find((e) => e.local_date > addDays(T, 5))!;
  canceled.status = "canceled";
  canceled.description = "Speaker unavailable — canceled (fictional example).";

  // Program travel spanning a few days, 7 weeks out.
  const tripStart = addDays(T, 49);
  mk(tripStart, "08:00", "18:00", "Regional Policy Trip — Day 1", "travel", { location: "Travel (fictional)" });
  mk(addDays(tripStart, 1), "08:00", "18:00", "Regional Policy Trip — Day 2", "travel", { location: "Travel (fictional)" });

  // ---- attendance for past events: fully reviewed except the most recent one
  const attendance: Attendance[] = [];
  const audit: AuditEntry[] = [];
  let auditId = 1;
  const stamp = (offsetMin: number) => new Date(Date.now() - offsetMin * 60_000).toISOString();
  const past = events.filter((e) => new Date(e.ends_at).getTime() < Date.now() && e.status === "scheduled")
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const lastPast = past[past.length - 1];
  for (const e of past) {
    if (e === lastPast) continue; // leave one completed event unreviewed
    for (const f of fellows) {
      attendance.push({ fellow_id: f.id, event_id: e.id, status: "present", reason_id: null, note: null, marked_via: "mark_remaining_present", version: 1, updated_at: e.ends_at, updated_by: STAFF2_ID });
    }
  }
  const setAtt = (e: CalEvent, f: string, patch: Partial<Attendance>) => {
    const a = attendance.find((x) => x.event_id === e.id && x.fellow_id === f)!;
    Object.assign(a, patch);
  };
  // Actual absence: Fellow 04 missed a session (Illness).
  const absentEvent = past[past.length - 3];
  setAtt(absentEvent, "f4", { status: "absent", reason_id: "r3", note: null, marked_via: "individual", version: 2, updated_by: STAFF2_ID });
  audit.push({ id: auditId++, at: stamp(60 * 24 * 4), actor_id: STAFF2_ID, actor_name: "Program Coordinator (fictional)", table_name: "attendance", action: "update", record_id: `f4:${absentEvent.id}`, fellow_id: "f4", event_id: absentEvent.id, before: { status: "present" }, after: { status: "absent", reason_id: "r3" } });
  // Undone absence: recorded for Fellow 06 by mistake, then undone (back to "Not recorded").
  const undoEvent = past[past.length - 2];
  setAtt(undoEvent, "f6", { status: "not_recorded", reason_id: null, marked_via: "individual", version: 3, updated_by: STAFF_ID });
  audit.push(
    { id: auditId++, at: stamp(60 * 24 * 2 + 30), actor_id: STAFF_ID, actor_name: "Demo Staff (fictional)", table_name: "attendance", action: "update", record_id: `f6:${undoEvent.id}`, fellow_id: "f6", event_id: undoEvent.id, before: { status: "present" }, after: { status: "absent", reason_id: "r5" } },
    { id: auditId++, at: stamp(60 * 24 * 2), actor_id: STAFF_ID, actor_name: "Demo Staff (fictional)", table_name: "attendance", action: "update", record_id: `f6:${undoEvent.id}`, fellow_id: "f6", event_id: undoEvent.id, before: { status: "absent", reason_id: "r5" }, after: { status: "not_recorded", reason_id: null } },
  );

  // ---- planned absences
  const timeAway: TimeAway[] = [];
  const ta = (fellow: string, s: string, e: string, reason: string, note: string | null, by = STAFF_ID): TimeAway => {
    const r: TimeAway = { id: uid(), fellow_id: fellow, start_date: s, end_date: e, reason_id: reason, note, removed_at: null, version: 1, created_at: at, created_by: by, updated_at: at, updated_by: by };
    timeAway.push(r);
    audit.push({ id: auditId++, at: stamp(60 * 30), actor_id: by, actor_name: members.find((m) => m.user_id === by)!.display_name, table_name: "time_away", action: "insert", record_id: r.id, fellow_id: fellow, event_id: null, before: null, after: { start_date: s, end_date: e, reason_id: reason } });
    return r;
  };
  // Future military training (two weeks), entered well ahead.
  ta("f7", addDays(T, 20), addDays(T, 34), "r1", "Annual training (fictional example)");
  // Range that extends past the last scheduled event (events added later will pick it up).
  ta("f10", addDays(T, 100), addDays(T, 140), "r1", "Orders received (fictional)");

  const plans: EventPlan[] = [];
  const plan = (fellow: string, ev: CalEvent, reason: string, by = STAFF_ID) => {
    plans.push({ fellow_id: fellow, event_id: ev.id, kind: "absent", reason_id: reason, note: null, version: 1, updated_at: at, updated_by: by });
  };
  const upcoming = speakerSeries.filter((e) => e.status === "scheduled" && new Date(e.starts_at).getTime() > Date.now());
  plan("f2", upcoming[0], "r2", FELLOW_USER_ID);
  // Elevated: an event inside Fellow 07's training window, plus two more plans.
  const elevated = upcoming.find((e) => e.local_date >= addDays(T, 21) && e.local_date <= addDays(T, 33))!;
  plan("f2", elevated, "r5");
  plan("f9", elevated, "r2");
  // Planned absence on the most recent (completed, unreviewed) event → stays unconfirmed.
  plan("f8", lastPast, "r4");

  return {
    fellows, events, timeAway, plans, attendance, reasons, members, audit, seq: auditId,
    settings: {
      id: 1, program_name: "Fellows Attendance", class_label: "Demo class (fictional)", warning_threshold: 3,
      threshold_is_provisional: true, primary_owner_id: STAFF_ID, backup_owner_id: null, version: 1,
    },
  };
}

// ---------------------------------------------------------------- backend
export class DemoBackend implements Backend {
  readonly mode = "demo" as const;
  private s: DemoState;
  private listeners = new Set<() => void>();
  private authListeners = new Set<() => void>();
  private signedIn = true;

  constructor() {
    this.s = this.read() ?? seed();
    this.write();
  }

  private read(): DemoState | null {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as DemoState) : null;
    } catch {
      return null;
    }
  }
  private write() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.s));
    } catch {
      /* private mode: keep in memory */
    }
  }

  reset() {
    this.s = seed();
    this.write();
    this.emit();
  }

  get role(): "staff" | "fellow" {
    try {
      return (localStorage.getItem(ROLE_KEY) as "staff" | "fellow") || "staff";
    } catch {
      return "staff";
    }
  }
  setRole(r: "staff" | "fellow") {
    try {
      localStorage.setItem(ROLE_KEY, r);
    } catch { /* ignore */ }
    this.authListeners.forEach((cb) => cb());
  }

  private get actorId() {
    return this.role === "fellow" ? FELLOW_USER_ID : STAFF_ID;
  }
  private get actor() {
    return this.s.members.find((m) => m.user_id === this.actorId)!;
  }

  private async tick() {
    if (typeof navigator !== "undefined" && !navigator.onLine) throw new AppError("offline", appMessage("offline"));
    await sleep(250 + Math.random() * 250);
  }
  private emit() {
    this.listeners.forEach((cb) => cb());
  }
  private log(table: string, action: string, recordId: string, before: object | null, after: object | null, fellowId: string | null, eventId: string | null) {
    this.s.audit.unshift({
      id: this.s.seq++, at: nowIso(), actor_id: this.actorId, actor_name: this.actor.display_name, table_name: table, action,
      record_id: recordId, fellow_id: fellowId, event_id: eventId,
      before: before ? JSON.parse(JSON.stringify(before)) : null, after: after ? JSON.parse(JSON.stringify(after)) : null,
    });
  }
  private commit() {
    this.write();
    this.emit();
  }
  private requireAdmin() {
    if (this.actor.role !== "admin") throw new AppError("not_allowed", appMessage("not_allowed"));
  }
  private stale(): never {
    throw new AppError("stale_version", appMessage("stale_version"));
  }
  private eligibleOrThrow(fellowId: string, ev: CalEvent) {
    const f = this.s.fellows.find((x) => x.id === fellowId)!;
    if ((f.eligible_from && ev.local_date < f.eligible_from) || (f.eligible_until && ev.local_date > f.eligible_until))
      throw new AppError("fellow_not_eligible", appMessage("fellow_not_eligible"));
  }

  // ---- auth
  async currentUser(): Promise<Me | null> {
    if (!this.signedIn) return null;
    const m = this.actor;
    return { userId: m.user_id, email: m.email ?? "", member: m };
  }
  async sendCode() { await sleep(300); }
  async verifyCode() { this.signedIn = true; this.authListeners.forEach((cb) => cb()); }
  async signOut() { this.signedIn = false; this.authListeners.forEach((cb) => cb()); }
  onAuthChange(cb: () => void) {
    this.authListeners.add(cb);
    return () => { this.authListeners.delete(cb); };
  }

  // ---- read
  async load(): Promise<Snapshot> {
    await sleep(120);
    const c = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
    return {
      fellows: c(this.s.fellows), events: c(this.s.events), timeAway: c(this.s.timeAway), plans: c(this.s.plans),
      attendance: c(this.s.attendance), reasons: c(this.s.reasons), settings: c(this.s.settings),
      directory: c(this.s.members), loadedAt: nowIso(),
    };
  }
  async audit(q: { fellowId?: string; eventId?: string; beforeId?: number; limit?: number }) {
    await sleep(80);
    return this.s.audit
      .filter((a) => (!q.fellowId || a.fellow_id === q.fellowId) && (!q.eventId || a.event_id === q.eventId) && (!q.beforeId || a.id < q.beforeId))
      .sort((a, b) => b.id - a.id)
      .slice(0, q.limit ?? 50);
  }
  async listMembers() {
    this.requireAdmin();
    return JSON.parse(JSON.stringify(this.s.members)) as Member[];
  }
  async portraitUrls(paths: string[]) {
    const out: Record<string, string> = {};
    for (const p of paths) if (p.startsWith("data:")) out[p] = p;
    return out;
  }
  subscribe(cb: () => void) {
    this.listeners.add(cb);
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) {
        this.s = this.read() ?? this.s;
        cb();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      this.listeners.delete(cb);
      window.removeEventListener("storage", onStorage);
    };
  }

  // ---- attendance
  async recordAttendance(a: Parameters<Backend["recordAttendance"]>[0]) {
    await this.tick();
    const ev = this.s.events.find((e) => e.id === a.eventId);
    if (!ev) throw new AppError("event_not_found", "Event not found.");
    if (ev.status === "canceled") throw new AppError("event_canceled", appMessage("event_canceled"));
    if (new Date(ev.starts_at).getTime() > Date.now()) throw new AppError("event_not_started", appMessage("event_not_started"));
    if (a.status === "absent" && !a.reasonId) throw new AppError("reason_required", appMessage("reason_required"));
    this.eligibleOrThrow(a.fellowId, ev);
    const reason = a.status === "absent" ? a.reasonId : null;
    const note = a.status === "not_recorded" ? null : a.note?.trim() || null;
    const cur = this.s.attendance.find((x) => x.fellow_id === a.fellowId && x.event_id === a.eventId);
    if (cur) {
      if (cur.status === a.status && cur.reason_id === reason && cur.note === note) return { ...cur };
      if (a.expectedVersion !== cur.version) this.stale();
      const before = { ...cur };
      Object.assign(cur, { status: a.status, reason_id: reason, note, marked_via: "individual", version: cur.version + 1, updated_at: nowIso(), updated_by: this.actorId });
      this.log("attendance", "update", `${a.fellowId}:${a.eventId}`, before, cur, a.fellowId, a.eventId);
      this.commit();
      return { ...cur };
    }
    if (a.expectedVersion !== null) this.stale();
    const row: Attendance = { fellow_id: a.fellowId, event_id: a.eventId, status: a.status, reason_id: reason, note, marked_via: "individual", version: 1, updated_at: nowIso(), updated_by: this.actorId };
    this.s.attendance.push(row);
    this.log("attendance", "insert", `${a.fellowId}:${a.eventId}`, null, row, a.fellowId, a.eventId);
    this.commit();
    return { ...row };
  }

  async markRemainingPresent(eventId: string, fellowIds: string[]) {
    await this.tick();
    const ev = this.s.events.find((e) => e.id === eventId)!;
    if (new Date(ev.starts_at).getTime() > Date.now()) throw new AppError("event_not_started", appMessage("event_not_started"));
    let n = 0;
    for (const fid of fellowIds) {
      const cur = this.s.attendance.find((x) => x.fellow_id === fid && x.event_id === eventId);
      if (!cur) {
        const row: Attendance = { fellow_id: fid, event_id: eventId, status: "present", reason_id: null, note: null, marked_via: "mark_remaining_present", version: 1, updated_at: nowIso(), updated_by: this.actorId };
        this.s.attendance.push(row);
        this.log("attendance", "insert", `${fid}:${eventId}`, null, row, fid, eventId);
        n++;
      } else if (cur.status === "not_recorded") {
        const before = { ...cur };
        Object.assign(cur, { status: "present", marked_via: "mark_remaining_present", version: cur.version + 1, updated_at: nowIso(), updated_by: this.actorId });
        this.log("attendance", "update", `${fid}:${eventId}`, before, cur, fid, eventId);
        n++;
      }
    }
    this.commit();
    return n;
  }

  async setEventPlan(a: Parameters<Backend["setEventPlan"]>[0]) {
    await this.tick();
    const ev = this.s.events.find((e) => e.id === a.eventId)!;
    if (new Date(ev.starts_at).getTime() <= Date.now()) throw new AppError("event_started", appMessage("event_started"));
    if (a.kind === "absent" && !a.reasonId) throw new AppError("reason_required", appMessage("reason_required"));
    this.eligibleOrThrow(a.fellowId, ev);
    const idx = this.s.plans.findIndex((p) => p.fellow_id === a.fellowId && p.event_id === a.eventId);
    const cur = idx >= 0 ? this.s.plans[idx] : null;
    const reason = a.kind === "absent" ? a.reasonId : null;
    const note = a.note?.trim() || null;
    if (a.kind === null) {
      if (!cur) return null;
      if (a.expectedVersion !== cur.version) this.stale();
      this.s.plans.splice(idx, 1);
      this.log("event_plans", "delete", `${a.fellowId}:${a.eventId}`, cur, null, a.fellowId, a.eventId);
      this.commit();
      return null;
    }
    if (cur) {
      if (cur.kind === a.kind && cur.reason_id === reason && cur.note === note) return { ...cur };
      if (a.expectedVersion !== cur.version) this.stale();
      const before = { ...cur };
      Object.assign(cur, { kind: a.kind, reason_id: reason, note, version: cur.version + 1, updated_at: nowIso(), updated_by: this.actorId });
      this.log("event_plans", "update", `${a.fellowId}:${a.eventId}`, before, cur, a.fellowId, a.eventId);
      this.commit();
      return { ...cur };
    }
    if (a.expectedVersion !== null) this.stale();
    const row: EventPlan = { fellow_id: a.fellowId, event_id: a.eventId, kind: a.kind, reason_id: reason, note, version: 1, updated_at: nowIso(), updated_by: this.actorId };
    this.s.plans.push(row);
    this.log("event_plans", "insert", `${a.fellowId}:${a.eventId}`, null, row, a.fellowId, a.eventId);
    this.commit();
    return { ...row };
  }

  // ---- events
  async createEvents(list: EventInput[]) {
    await this.tick();
    const out: CalEvent[] = [];
    for (const i of list) {
      const ev: CalEvent = {
        id: uid(), status: "scheduled", series_id: null, ...i, local_date: todayKey(new Date(i.starts_at)), needs_review: false,
        version: 1, created_at: nowIso(), created_by: this.actorId, updated_at: nowIso(), updated_by: this.actorId,
      } as CalEvent;
      this.s.events.push(ev);
      this.log("events", "insert", ev.id, null, ev, null, ev.id);
      out.push(ev);
    }
    this.commit();
    return out;
  }
  async updateEvent(ref: { id: string; version: number }, patch: Partial<EventInput> & { needs_review?: boolean }) {
    await this.tick();
    const ev = this.s.events.find((e) => e.id === ref.id)!;
    if (ev.version !== ref.version) this.stale();
    const before = { ...ev };
    Object.assign(ev, patch);
    ev.local_date = todayKey(new Date(ev.starts_at));
    if ((ev.starts_at !== before.starts_at || ev.ends_at !== before.ends_at)
      && this.s.attendance.some((a) => a.event_id === ev.id && a.status !== "not_recorded")) ev.needs_review = true;
    ev.version++;
    ev.updated_at = nowIso();
    ev.updated_by = this.actorId;
    this.log("events", "update", ev.id, before, ev, null, ev.id);
    this.commit();
    return { ...ev };
  }

  // ---- time away
  async createTimeAway(t: Parameters<Backend["createTimeAway"]>[0]) {
    await this.tick();
    const r: TimeAway = { id: uid(), ...t, note: t.note?.trim() || null, removed_at: null, version: 1, created_at: nowIso(), created_by: this.actorId, updated_at: nowIso(), updated_by: this.actorId };
    this.s.timeAway.push(r);
    this.log("time_away", "insert", r.id, null, r, r.fellow_id, null);
    this.commit();
    return { ...r };
  }
  async updateTimeAway(ref: { id: string; version: number }, patch: Partial<TimeAway>) {
    await this.tick();
    const r = this.s.timeAway.find((x) => x.id === ref.id)!;
    if (r.version !== ref.version) this.stale();
    const before = { ...r };
    Object.assign(r, patch, { version: r.version + 1, updated_at: nowIso(), updated_by: this.actorId });
    this.log("time_away", "update", r.id, before, r, r.fellow_id, null);
    this.commit();
    return { ...r };
  }

  // ---- admin
  async createFellow(f: Parameters<Backend["createFellow"]>[0]) {
    await this.tick();
    this.requireAdmin();
    const row: Fellow = { id: uid(), ...f, photo_path: null, version: 1, updated_at: nowIso(), updated_by: this.actorId };
    this.s.fellows.push(row);
    this.log("fellows", "insert", row.id, null, row, row.id, null);
    this.commit();
    return row;
  }
  async updateFellow(ref: { id: string; version: number }, patch: Partial<Fellow>) {
    await this.tick();
    this.requireAdmin();
    const f = this.s.fellows.find((x) => x.id === ref.id)!;
    if (f.version !== ref.version) this.stale();
    const before = { ...f };
    Object.assign(f, patch, { version: f.version + 1, updated_at: nowIso(), updated_by: this.actorId });
    this.log("fellows", "update", f.id, before, f, f.id, null);
    this.commit();
    return { ...f };
  }
  async uploadPortrait(_fellowId: string, file: Blob) {
    this.requireAdmin();
    return await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(new AppError("upload", "Could not read that image."));
      fr.readAsDataURL(file);
    });
  }
  async createReason(label: string, sortOrder: number) {
    await this.tick();
    this.requireAdmin();
    const r: Reason = { id: uid(), label, sort_order: sortOrder, active: true, version: 1 };
    this.s.reasons.push(r);
    this.log("reasons", "insert", r.id, null, r, null, null);
    this.commit();
    return r;
  }
  async updateReason(ref: { id: string; version: number }, patch: Partial<Reason>) {
    await this.tick();
    this.requireAdmin();
    const r = this.s.reasons.find((x) => x.id === ref.id)!;
    if (r.version !== ref.version) this.stale();
    const before = { ...r };
    Object.assign(r, patch, { version: r.version + 1 });
    this.log("reasons", "update", r.id, before, r, null, null);
    this.commit();
    return { ...r };
  }
  async updateSettings(version: number, patch: Partial<Settings>) {
    await this.tick();
    this.requireAdmin();
    if (this.s.settings.version !== version) this.stale();
    for (const k of ["primary_owner_id", "backup_owner_id"] as const) {
      const v = patch[k];
      if (v && !this.s.members.some((m) => m.user_id === v && m.active && m.role === "admin"))
        throw new AppError("owner_must_be_admin", appMessage("owner_must_be_admin"));
    }
    const before = { ...this.s.settings };
    Object.assign(this.s.settings, patch, { version: version + 1 });
    this.log("settings", "update", "1", before, this.s.settings, null, null);
    this.commit();
    return { ...this.s.settings };
  }
  async invite(i: Parameters<Backend["invite"]>[0]) {
    await this.tick();
    this.requireAdmin();
    if (this.s.members.some((m) => m.email?.toLowerCase() === i.email.toLowerCase()))
      throw new AppError("exists", "That email already has an account.");
    const m: Member = { user_id: uid(), ...i, email: i.email.toLowerCase(), active: true, version: 1 };
    this.s.members.push(m);
    this.log("members", "insert", m.user_id, null, m, null, null);
    this.commit();
  }
  async updateMember(ref: { user_id: string; version: number }, patch: Partial<Member>) {
    await this.tick();
    this.requireAdmin();
    const m = this.s.members.find((x) => x.user_id === ref.user_id)!;
    if (m.version !== ref.version) this.stale();
    const next = { ...m, ...patch };
    const admins = this.s.members.map((x) => (x.user_id === m.user_id ? next : x)).filter((x) => x.active && x.role === "admin");
    if (!admins.length) throw new AppError("last_admin", appMessage("last_admin"));
    const owners = [this.s.settings.primary_owner_id, this.s.settings.backup_owner_id];
    if (owners.includes(m.user_id) && (!next.active || next.role !== "admin"))
      throw new AppError("owner_must_be_admin", appMessage("owner_must_be_admin"));
    const before = { ...m };
    Object.assign(m, patch, { version: (m.version ?? 1) + 1 });
    this.log("members", "update", m.user_id, before, m, null, null);
    this.commit();
  }
}
