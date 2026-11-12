import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Attendance, AuditEntry, CalEvent, EventPlan, Fellow, Member, Reason, Settings, Snapshot, TimeAway } from "../types";
import { AppError, toAppError, type Backend, type Me } from "./types";

const PAGE = 1000; // Supabase returns at most 1000 rows per request by default

export class SupabaseBackend implements Backend {
  readonly mode = "live" as const;
  readonly sb: SupabaseClient;
  private urlCache = new Map<string, { url: string; exp: number }>();

  constructor(url: string, key: string) {
    this.sb = createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "fa-auth" },
    });
  }

  private async run<T>(p: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
    if (typeof navigator !== "undefined" && !navigator.onLine) throw new AppError("offline", toAppError({ message: "offline" }).message);
    let res: { data: T | null; error: unknown };
    try {
      res = await p;
    } catch (e) {
      throw toAppError(e);
    }
    if (res.error) throw toAppError(res.error);
    return res.data as T;
  }

  private async all<T>(table: string, order: string): Promise<T[]> {
    const out: T[] = [];
    for (let from = 0; ; from += PAGE) {
      const rows = await this.run<T[]>(
        this.sb.from(table).select("*").order(order, { ascending: true }).range(from, from + PAGE - 1),
      );
      out.push(...rows);
      if (rows.length < PAGE) return out;
    }
  }

  // ---------------------------------------------------------------- auth
  async currentUser(): Promise<Me | null> {
    const { data } = await this.sb.auth.getSession();
    const user = data.session?.user;
    if (!user) return null;
    const { data: member, error } = await this.sb.from("members").select("*").eq("user_id", user.id).maybeSingle();
    if (error) throw toAppError(error);
    return {
      userId: user.id,
      email: user.email ?? "",
      member: member && (member as Member).active ? (member as Member) : null,
    };
  }

  async sendCode(email: string) {
    const { error } = await this.sb.auth.signInWithOtp({ email: email.trim().toLowerCase(), options: { shouldCreateUser: false } });
    if (error) {
      // Don't reveal whether an email is on the invite list.
      if (/signups not allowed|not found|otp_disabled/i.test(error.message)) return;
      if (/rate limit|security purposes/i.test(error.message))
        throw new AppError("rate", "Too many code requests. Please wait a minute, then try again.");
      throw toAppError(error);
    }
  }

  async verifyCode(email: string, code: string) {
    const { error } = await this.sb.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.trim(), type: "email" });
    if (error) {
      if (/expired|invalid/i.test(error.message))
        throw new AppError("bad_code", "That code didn't work. It may be mistyped or expired — request a new one.");
      throw toAppError(error);
    }
  }

  async signOut() {
    await this.sb.auth.signOut();
    this.urlCache.clear();
  }

  onAuthChange(cb: () => void) {
    const { data } = this.sb.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") setTimeout(cb, 0);
    });
    return () => data.subscription.unsubscribe();
  }

  // ---------------------------------------------------------------- read
  async load(): Promise<Snapshot> {
    const [fellows, events, timeAway, plans, attendance, reasons, settingsRows, directory] = await Promise.all([
      this.all<Fellow>("fellows", "sort_order"),
      this.all<CalEvent>("events", "starts_at"),
      this.all<TimeAway>("time_away", "start_date"),
      this.all<EventPlan>("event_plans", "event_id"),
      this.all<Attendance>("attendance", "event_id"),
      this.all<Reason>("reasons", "sort_order"),
      this.run<Settings[]>(this.sb.from("settings").select("*")),
      this.run<Member[]>(this.sb.rpc("member_directory")),
    ]);
    if (!settingsRows[0]) throw new AppError("not_allowed", "You don't have access to this tracker.");
    return { fellows, events, timeAway, plans, attendance, reasons, settings: settingsRows[0], directory, loadedAt: new Date().toISOString() };
  }

  async audit(q: { fellowId?: string; eventId?: string; beforeId?: number; limit?: number }) {
    let query = this.sb.from("audit_log").select("*").order("id", { ascending: false }).limit(q.limit ?? 50);
    if (q.fellowId) query = query.eq("fellow_id", q.fellowId);
    if (q.eventId) query = query.eq("event_id", q.eventId);
    if (q.beforeId) query = query.lt("id", q.beforeId);
    return this.run<AuditEntry[]>(query);
  }

  async listMembers() {
    return this.run<Member[]>(this.sb.from("members").select("*").order("display_name"));
  }

  async portraitUrls(paths: string[]) {
    const now = Date.now();
    const out: Record<string, string> = {};
    const need: string[] = [];
    for (const p of paths) {
      const c = this.urlCache.get(p);
      if (c && c.exp > now) out[p] = c.url;
      else need.push(p);
    }
    if (need.length) {
      const { data, error } = await this.sb.storage.from("portraits").createSignedUrls(need, 3600);
      if (!error && data) {
        for (const d of data) {
          if (d.signedUrl && d.path) {
            out[d.path] = d.signedUrl;
            this.urlCache.set(d.path, { url: d.signedUrl, exp: now + 50 * 60_000 });
          }
        }
      }
    }
    return out;
  }

  subscribe(onChange: () => void) {
    const ch = this.sb
      .channel("tracker-changes")
      .on("postgres_changes", { event: "*", schema: "public" }, () => onChange())
      .subscribe((status) => {
        if (status === "SUBSCRIBED") onChange(); // re-sync after (re)connecting
      });
    return () => {
      this.sb.removeChannel(ch);
    };
  }

  // ---------------------------------------------------------------- attendance
  recordAttendance(a: Parameters<Backend["recordAttendance"]>[0]) {
    return this.run<Attendance>(
      this.sb.rpc("record_attendance", {
        p_fellow_id: a.fellowId, p_event_id: a.eventId, p_status: a.status,
        p_reason_id: a.reasonId, p_note: a.note, p_expected_version: a.expectedVersion,
      }).single(),
    );
  }

  markRemainingPresent(eventId: string, fellowIds: string[]) {
    return this.run<number>(this.sb.rpc("mark_remaining_present", { p_event_id: eventId, p_fellow_ids: fellowIds }));
  }

  async setEventPlan(a: Parameters<Backend["setEventPlan"]>[0]) {
    const row = await this.run<EventPlan | null>(
      this.sb.rpc("set_event_plan", {
        p_fellow_id: a.fellowId, p_event_id: a.eventId, p_kind: a.kind,
        p_reason_id: a.reasonId, p_note: a.note, p_expected_version: a.expectedVersion,
      }),
    );
    return row && (row as EventPlan).fellow_id ? row : null;
  }

  // ---------------------------------------------------------------- events
  createEvents(list: Parameters<Backend["createEvents"]>[0]) {
    return this.run<CalEvent[]>(this.sb.from("events").insert(list).select());
  }

  private async updateRow<T>(table: string, key: string, id: string, version: number, patch: object): Promise<T> {
    const rows = await this.run<T[]>(this.sb.from(table).update({ ...patch, version }).eq(key, id).eq("version", version).select());
    if (!rows.length) {
      // Nothing matched: either the version moved on (conflict) or this account may not edit the row.
      const cur = await this.run<{ version: number }[]>(this.sb.from(table).select("version").eq(key, id));
      if (cur[0] && cur[0].version === version) throw new AppError("not_allowed", toAppError({ message: "not_allowed" }).message);
      throw new AppError("stale_version", toAppError({ message: "stale_version" }).message);
    }
    return rows[0];
  }

  updateEvent(ref: { id: string; version: number }, patch: object) {
    return this.updateRow<CalEvent>("events", "id", ref.id, ref.version, patch);
  }

  // ---------------------------------------------------------------- time away
  async createTimeAway(t: Parameters<Backend["createTimeAway"]>[0]) {
    const rows = await this.run<TimeAway[]>(this.sb.from("time_away").insert(t).select());
    return rows[0];
  }
  updateTimeAway(ref: { id: string; version: number }, patch: object) {
    return this.updateRow<TimeAway>("time_away", "id", ref.id, ref.version, patch);
  }

  // ---------------------------------------------------------------- admin
  async createFellow(f: Parameters<Backend["createFellow"]>[0]) {
    const rows = await this.run<Fellow[]>(this.sb.from("fellows").insert(f).select());
    return rows[0];
  }
  updateFellow(ref: { id: string; version: number }, patch: object) {
    return this.updateRow<Fellow>("fellows", "id", ref.id, ref.version, patch);
  }
  async uploadPortrait(fellowId: string, file: Blob) {
    const path = `${fellowId}/${Date.now()}.jpg`;
    const { error } = await this.sb.storage.from("portraits").upload(path, file, { contentType: "image/jpeg", upsert: false });
    if (error) throw toAppError(error);
    return path;
  }
  async createReason(label: string, sortOrder: number) {
    const rows = await this.run<Reason[]>(this.sb.from("reasons").insert({ label, sort_order: sortOrder }).select());
    return rows[0];
  }
  updateReason(ref: { id: string; version: number }, patch: object) {
    return this.updateRow<Reason>("reasons", "id", ref.id, ref.version, patch);
  }
  updateSettings(version: number, patch: object) {
    return this.updateRow<Settings>("settings", "id", "1", version, patch);
  }
  async invite(i: Parameters<Backend["invite"]>[0]) {
    const { data } = await this.sb.auth.getSession();
    let res: Response;
    try {
      res = await fetch("/api/admin/invite", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${data.session?.access_token ?? ""}` },
        body: JSON.stringify(i),
      });
    } catch (e) {
      throw toAppError(e);
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new AppError(body.code ?? "invite_failed", body.error ?? "The invitation could not be created.");
  }
  async updateMember(ref: { user_id: string; version: number }, patch: object) {
    await this.updateRow<Member>("members", "user_id", ref.user_id, ref.version, patch);
  }
}
