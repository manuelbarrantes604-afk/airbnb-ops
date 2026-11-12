// Row shapes mirror supabase/migrations/*_init.sql

export type EventType = "speaker_series" | "program_event" | "travel" | "other";
export type AttendanceStatus = "present" | "absent" | "not_recorded";
export type PlanKind = "absent" | "attending";

export interface Fellow {
  id: string;
  display_name: string;
  agency: string | null;
  photo_path: string | null;
  sort_order: number;
  eligible_from: string | null; // YYYY-MM-DD
  eligible_until: string | null;
  is_placeholder: boolean;
  version: number;
  updated_at: string;
  updated_by: string | null;
}

export interface Member {
  user_id: string;
  email?: string;
  display_name: string;
  kind: "fellow" | "staff";
  fellow_id: string | null;
  role: "member" | "admin";
  active: boolean;
  version?: number;
}

export interface Reason {
  id: string;
  label: string;
  sort_order: number;
  active: boolean;
  version: number;
}

export interface Settings {
  id: 1;
  program_name: string;
  class_label: string;
  warning_threshold: number;
  threshold_is_provisional: boolean;
  primary_owner_id: string | null;
  backup_owner_id: string | null;
  version: number;
}

export interface CalEvent {
  id: string;
  title: string;
  event_type: EventType;
  starts_at: string; // ISO UTC
  ends_at: string;
  local_date: string; // YYYY-MM-DD in America/New_York
  speaker: string | null;
  location: string | null;
  description: string | null;
  attendance_required: boolean;
  status: "scheduled" | "canceled";
  needs_review: boolean;
  series_id: string | null;
  version: number;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
}

export interface TimeAway {
  id: string;
  fellow_id: string;
  start_date: string;
  end_date: string;
  reason_id: string | null;
  note: string | null;
  removed_at: string | null;
  version: number;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
}

export interface EventPlan {
  fellow_id: string;
  event_id: string;
  kind: PlanKind;
  reason_id: string | null;
  note: string | null;
  version: number;
  updated_at: string;
  updated_by: string | null;
}

export interface Attendance {
  fellow_id: string;
  event_id: string;
  status: AttendanceStatus;
  reason_id: string | null;
  note: string | null;
  marked_via: "individual" | "mark_remaining_present";
  version: number;
  updated_at: string;
  updated_by: string | null;
}

export interface AuditEntry {
  id: number;
  at: string;
  actor_id: string | null;
  actor_name: string | null;
  table_name: string;
  action: "insert" | "update" | "delete" | string;
  record_id: string;
  fellow_id: string | null;
  event_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export interface Snapshot {
  fellows: Fellow[];
  events: CalEvent[];
  timeAway: TimeAway[];
  plans: EventPlan[];
  attendance: Attendance[];
  reasons: Reason[];
  settings: Settings;
  directory: Member[]; // names for "changed by" labels
  loadedAt: string;
}

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  speaker_series: "Speaker Series",
  program_event: "Program event",
  travel: "Program travel",
  other: "Other",
};
