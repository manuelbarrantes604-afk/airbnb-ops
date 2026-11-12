import type {
  Attendance, AttendanceStatus, AuditEntry, CalEvent, EventPlan, EventType, Fellow, Member, PlanKind, Reason,
  Settings, Snapshot, TimeAway,
} from "../types";

export interface Me {
  userId: string;
  email: string;
  member: Member | null; // null = signed in but not invited / not active
}

export interface EventInput {
  title: string;
  event_type: EventType;
  starts_at: string;
  ends_at: string;
  speaker: string | null;
  location: string | null;
  description: string | null;
  attendance_required: boolean;
  status?: "scheduled" | "canceled";
  series_id?: string | null;
}

export interface TimeAwayInput {
  fellow_id: string;
  start_date: string;
  end_date: string;
  reason_id: string | null;
  note: string | null;
}

export interface FellowInput {
  display_name: string;
  agency: string | null;
  eligible_from: string | null;
  eligible_until: string | null;
  sort_order: number;
  is_placeholder: boolean;
}

export interface InviteInput {
  email: string;
  display_name: string;
  kind: "fellow" | "staff";
  fellow_id: string | null;
  role: "member" | "admin";
}

export interface Versioned { id: string; version: number }

export interface AuditQuery {
  fellowId?: string;
  eventId?: string;
  beforeId?: number;
  limit?: number;
}

export interface Backend {
  readonly mode: "live" | "demo";

  // Authentication
  currentUser(): Promise<Me | null>;
  sendCode(email: string): Promise<void>;
  verifyCode(email: string, code: string): Promise<void>;
  signOut(): Promise<void>;
  onAuthChange(cb: () => void): () => void;

  // Reading
  load(): Promise<Snapshot>;
  audit(q: AuditQuery): Promise<AuditEntry[]>;
  listMembers(): Promise<Member[]>; // admin only
  portraitUrls(paths: string[]): Promise<Record<string, string>>;
  subscribe(onChange: () => void): () => void;

  // Attendance & plans
  recordAttendance(a: {
    fellowId: string; eventId: string; status: AttendanceStatus; reasonId: string | null; note: string | null;
    expectedVersion: number | null;
  }): Promise<Attendance>;
  markRemainingPresent(eventId: string, fellowIds: string[]): Promise<number>;
  setEventPlan(a: {
    fellowId: string; eventId: string; kind: PlanKind | null; reasonId: string | null; note: string | null;
    expectedVersion: number | null;
  }): Promise<EventPlan | null>;

  // Events
  createEvents(list: EventInput[]): Promise<CalEvent[]>;
  updateEvent(ref: Versioned, patch: Partial<EventInput> & { needs_review?: boolean }): Promise<CalEvent>;

  // Time away
  createTimeAway(t: TimeAwayInput): Promise<TimeAway>;
  updateTimeAway(ref: Versioned, patch: Partial<TimeAwayInput> & { removed_at?: string | null }): Promise<TimeAway>;

  // Administration
  createFellow(f: FellowInput): Promise<Fellow>;
  updateFellow(ref: Versioned, patch: Partial<FellowInput> & { photo_path?: string | null }): Promise<Fellow>;
  uploadPortrait(fellowId: string, file: Blob): Promise<string>; // returns storage path
  createReason(label: string, sortOrder: number): Promise<Reason>;
  updateReason(ref: Versioned, patch: Partial<Pick<Reason, "label" | "sort_order" | "active">>): Promise<Reason>;
  updateSettings(version: number, patch: Partial<Omit<Settings, "id" | "version">>): Promise<Settings>;
  invite(i: InviteInput): Promise<void>;
  updateMember(ref: { user_id: string; version: number }, patch: Partial<Pick<Member, "display_name" | "kind" | "fellow_id" | "role" | "active">>): Promise<void>;
}

export class AppError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

const MESSAGES: Record<string, string> = {
  stale_version: "Someone else changed this record a moment ago. The latest version is now showing — please check it and try again.",
  event_not_started: "This event hasn't started yet, so it was saved as a plan instead.",
  event_started: "This event has already started. Record actual attendance instead.",
  event_canceled: "This event is canceled, so attendance can't be recorded.",
  reason_required: "Please choose a reason.",
  fellow_not_eligible: "That Fellow isn't on the roster for this event's date.",
  last_admin: "At least one active administrator is required.",
  owner_must_be_admin: "The primary and backup owners must be active administrators. Transfer ownership first.",
  not_allowed: "You don't have permission to do that.",
  network: "Couldn't reach the server. Check your connection and try again. Nothing was saved.",
  offline: "You're offline. Changes can't be saved until you're back online.",
};

export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const e = err as { message?: string; code?: string; hint?: string; name?: string } | null;
  const msg = e?.message ?? String(err);
  for (const code of Object.keys(MESSAGES)) {
    if (msg.includes(code)) return new AppError(code, MESSAGES[code]);
  }
  if (e?.code === "42501" || /row-level security|permission denied/i.test(msg)) return new AppError("not_allowed", MESSAGES.not_allowed);
  if (/Failed to fetch|NetworkError|Load failed|fetch failed|network/i.test(msg)) return new AppError("network", MESSAGES.network);
  if (e?.code === "23514") return new AppError("invalid", "Some of the information isn't valid. Please check the form.");
  return new AppError("unknown", msg || "Something went wrong. Please try again.");
}

export function appMessage(code: keyof typeof MESSAGES | string) {
  return MESSAGES[code] ?? code;
}
