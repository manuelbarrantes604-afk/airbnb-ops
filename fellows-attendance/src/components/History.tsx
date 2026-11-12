"use client";

import { useCallback, useEffect, useState } from "react";
import { useData, useLookups, useSnap } from "@/lib/data";
import type { AuditEntry } from "@/lib/types";
import { EVENT_TYPE_LABELS, type EventType } from "@/lib/types";
import { fmtDateMedium, fmtDateTime, fmtTimeRange, nyDateKey } from "@/lib/time";
import { Button, Empty } from "./ui";

const STATUS: Record<string, string> = { present: "Present", absent: "Absent", not_recorded: "Not recorded" };

type L = ReturnType<typeof useLookups>;

function evName(L: L, id: unknown) {
  const e = typeof id === "string" ? L.event.get(id) : undefined;
  return e ? `“${e.title}” (${fmtDateMedium(e.local_date)})` : "an event";
}
function fName(L: L, id: unknown) {
  return (typeof id === "string" && L.fellow.get(id)?.display_name) || "a Fellow";
}
const g = (o: Record<string, unknown> | null, k: string) => (o ? o[k] : undefined);

export function describe(a: AuditEntry, L: L): string {
  const b = a.before, n = a.after;
  switch (a.table_name) {
    case "attendance": {
      const who = fName(L, g(n ?? b, "fellow_id"));
      const ev = evName(L, g(n ?? b, "event_id"));
      const fmt = (o: Record<string, unknown> | null) =>
        o ? `${STATUS[String(o.status)] ?? o.status}${o.status === "absent" && o.reason_id ? ` (${L.reasonLabel(String(o.reason_id))})` : ""}` : "Not recorded";
      const bulk = g(n, "marked_via") === "mark_remaining_present" && g(n, "status") === "present" ? " using “Mark remaining present”" : "";
      if (a.action === "insert") return `Recorded ${who} as ${fmt(n)} at ${ev}${bulk}.`;
      if (g(b, "status") === "absent" && g(n, "status") === "not_recorded") return `Undid the absence for ${who} at ${ev} (now Not recorded).`;
      return `Changed ${who} at ${ev} from ${fmt(b)} to ${fmt(n)}${bulk}.`;
    }
    case "event_plans": {
      const who = fName(L, g(n ?? b, "fellow_id"));
      const ev = evName(L, g(n ?? b, "event_id"));
      if (a.action === "delete") return g(b, "kind") === "absent" ? `Removed the planned absence for ${who} at ${ev}.` : `Removed the “will attend” exception for ${who} at ${ev}.`;
      if (g(n, "kind") === "attending") return `Marked ${who} as attending ${ev} despite time away.`;
      return `${a.action === "insert" ? "Added" : "Updated"} a planned absence for ${who} at ${ev} (${L.reasonLabel(String(g(n, "reason_id") ?? ""))}).`;
    }
    case "time_away": {
      const who = fName(L, g(n ?? b, "fellow_id"));
      const range = (o: Record<string, unknown> | null) => (o ? `${fmtDateMedium(String(o.start_date))} – ${fmtDateMedium(String(o.end_date))}` : "");
      if (a.action === "insert") return `Planned time away for ${who}: ${range(n)} (${L.reasonLabel(String(g(n, "reason_id") ?? ""))}).`;
      if (!g(b, "removed_at") && g(n, "removed_at")) return `Removed time away for ${who}: ${range(b)}.`;
      if (g(b, "removed_at") && !g(n, "removed_at")) return `Restored time away for ${who}: ${range(n)}.`;
      return `Changed time away for ${who} from ${range(b)} to ${range(n)}.`;
    }
    case "events": {
      const title = String(g(n ?? b, "title") ?? "event");
      if (a.action === "insert") return `Added event “${title}” on ${fmtDateMedium(String(g(n, "local_date") ?? nyDateKey(String(g(n, "starts_at")))))}.`;
      if (g(b, "status") !== g(n, "status")) return g(n, "status") === "canceled" ? `Canceled “${title}”.` : `Restored “${title}”.`;
      const parts: string[] = [];
      if (g(b, "starts_at") !== g(n, "starts_at") || g(b, "ends_at") !== g(n, "ends_at"))
        parts.push(`rescheduled from ${fmtDateMedium(nyDateKey(String(g(b, "starts_at"))))} ${fmtTimeRange(String(g(b, "starts_at")), String(g(b, "ends_at")))} to ${fmtDateMedium(nyDateKey(String(g(n, "starts_at"))))} ${fmtTimeRange(String(g(n, "starts_at")), String(g(n, "ends_at")))}`);
      if (g(b, "title") !== g(n, "title")) parts.push(`renamed from “${g(b, "title")}”`);
      if (g(b, "event_type") !== g(n, "event_type")) parts.push(`type set to ${EVENT_TYPE_LABELS[g(n, "event_type") as EventType]}`);
      if (g(b, "attendance_required") !== g(n, "attendance_required")) parts.push(g(n, "attendance_required") ? "made required" : "made optional");
      if (g(b, "needs_review") && !g(n, "needs_review")) parts.push("marked as reviewed");
      if (!parts.length) parts.push("updated details");
      return `“${title}”: ${parts.join("; ")}.`;
    }
    case "fellows":
      if (a.action === "insert") return `Added ${g(n, "display_name")} to the roster.`;
      if (g(b, "display_name") !== g(n, "display_name")) return `Renamed ${g(b, "display_name")} to ${g(n, "display_name")}.`;
      if (g(b, "photo_path") !== g(n, "photo_path")) return `Updated the portrait for ${g(n, "display_name")}.`;
      return `Updated the profile for ${g(n, "display_name")}.`;
    case "members":
      if (a.action === "insert") return `Invited ${g(n, "display_name")}.`;
      if (g(b, "active") && !g(n, "active")) return `Removed access for ${g(n, "display_name")}.`;
      if (!g(b, "active") && g(n, "active")) return `Restored access for ${g(n, "display_name")}.`;
      if (g(b, "role") !== g(n, "role")) return `${g(n, "role") === "admin" ? "Made" : "Removed"} ${g(n, "display_name")} ${g(n, "role") === "admin" ? "an administrator" : "as administrator"}.`;
      return `Updated the account for ${g(n, "display_name")}.`;
    case "reasons":
      return a.action === "insert" ? `Added reason “${g(n, "label")}”.` : `Updated reason “${g(n, "label")}”.`;
    case "settings":
      return "Updated tracker settings.";
    default:
      return `${a.action} ${a.table_name}`;
  }
}

export function AuditList({ fellowId, eventId, limit = 25 }: { fellowId?: string; eventId?: string; limit?: number }) {
  const { backend } = useData();
  const { snap } = useSnap();
  const L = useLookups();
  const [items, setItems] = useState<AuditEntry[]>([]);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const fetchPage = useCallback((beforeId?: number) =>
    backend.audit({ fellowId, eventId, beforeId, limit }).then(
      (rows) => {
        setItems((xs) => (beforeId ? [...xs, ...rows] : rows));
        setMore(rows.length === limit);
        setErr(null);
        setBusy(false);
      },
      (e) => {
        setErr((e as Error).message);
        setBusy(false);
      },
    ), [backend, fellowId, eventId, limit]);
  const load = (beforeId?: number) => {
    setBusy(true);
    fetchPage(beforeId);
  };

  // Refresh when shared data changes (new edits arrive).
  useEffect(() => { fetchPage(); }, [fetchPage, snap.loadedAt]);

  if (err) return <p role="alert" className="text-[14px] text-absent">Couldn’t load history: {err}</p>;
  if (!items.length) return busy ? <p className="text-muted">Loading…</p> : <Empty>No changes recorded yet.</Empty>;
  return (
    <div>
      <ol className="space-y-2">
        {items.map((a) => (
          <li key={a.id} className="rounded-xl bg-card px-3.5 py-2.5 ring-1 ring-line">
            <p className="text-[15px]">{describe(a, L)}</p>
            <p className="text-[13px] text-muted">by <strong className="text-navy">{a.actor_name ?? "System"}</strong> · {fmtDateTime(a.at)}</p>
          </li>
        ))}
      </ol>
      {more && <Button className="mt-3" onClick={() => load(items[items.length - 1].id)} disabled={busy}>{busy ? "Loading…" : "Show older changes"}</Button>}
    </div>
  );
}
