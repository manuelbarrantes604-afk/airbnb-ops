// Integration tests against a REAL Supabase (local: `npx supabase start`).
// Run: npm run test:live   (skipped unless LIVE_SUPABASE_URL is set)
// Uses fictional accounts only. Never point this at production.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { execSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";

// Keys come from the running LOCAL stack (`npx supabase status`), never hard-coded.
function localStack(): Record<string, string> {
  if (!process.env.LIVE) return {};
  try {
    return JSON.parse(execSync("npx supabase status -o json", { stdio: ["ignore", "pipe", "ignore"] }).toString());
  } catch {
    return {};
  }
}
const st = localStack();
const URL = process.env.LIVE_SUPABASE_URL ?? st.API_URL;
const ANON = process.env.LIVE_SUPABASE_ANON_KEY ?? st.PUBLISHABLE_KEY;
const SECRET = process.env.LIVE_SUPABASE_SECRET_KEY ?? st.SECRET_KEY;
const DB = process.env.LIVE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const run = URL ? describe : describe.skip;

const PW = "test-password-Long-1!";
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const sql = (q: string) => execSync(`psql "${DB}" -v ON_ERROR_STOP=1 -tAc ${JSON.stringify(q)}`).toString().trim();

let admin: SupabaseClient, fellow: SupabaseClient, staff: SupabaseClient, outsider: SupabaseClient, anon: SupabaseClient;
let fellowIds: string[] = [];
let reasonId = "";
const ids: Record<string, string> = {};

async function user(email: string) {
  const svc = createClient(URL!, SECRET, opts);
  const { data, error } = await svc.auth.admin.createUser({ email, password: PW, email_confirm: true });
  if (error) throw error;
  const c = createClient(URL!, ANON, opts);
  const s = await c.auth.signInWithPassword({ email, password: PW });
  if (s.error) throw s.error;
  ids[email] = data.user.id;
  return c;
}

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
async function newEvent(c: SupabaseClient, startH: number, extra: object = {}) {
  const { data, error } = await c.from("events").insert({
    title: `Test ${startH}`, event_type: "speaker_series", starts_at: hoursFromNow(startH), ends_at: hoursFromNow(startH + 1), ...extra,
  }).select().single();
  if (error) throw error;
  return data;
}

run("live database permissions and rules", () => {
  beforeAll(async () => {
    // Fresh schema + starter data.
    execSync("npx supabase db reset", { stdio: "ignore", cwd: process.cwd(), env: { ...process.env, PATH: process.env.PATH } });
    const tag = Date.now();
    admin = await user(`admin${tag}@example.org`);
    fellow = await user(`fellow${tag}@example.org`);
    staff = await user(`staff${tag}@example.org`);
    outsider = await user(`outsider${tag}@example.org`);
    anon = createClient(URL!, ANON, opts);
    sql(`select public.bootstrap_first_admin('admin${tag}@example.org', 'Test Admin')`);
    const { data: f } = await admin.from("fellows").select("id").order("sort_order");
    fellowIds = (f ?? []).map((x) => x.id);
    const { error: e1 } = await admin.from("members").insert({ user_id: ids[`fellow${tag}@example.org`], email: `fellow${tag}@example.org`, display_name: "Fellow 01", kind: "fellow", fellow_id: fellowIds[0] });
    const { error: e2 } = await admin.from("members").insert({ user_id: ids[`staff${tag}@example.org`], email: `staff${tag}@example.org`, display_name: "Staff Tester", kind: "staff" });
    if (e1 || e2) throw e1 ?? e2;
    reasonId = (await admin.from("reasons").select("id").limit(1).single()).data!.id;
  }, 120_000);

  it("starts with 11 placeholder Fellows", () => {
    expect(fellowIds.length).toBe(11);
  });

  it("signed-out visitors and uninvited accounts see nothing", async () => {
    for (const c of [anon, outsider]) {
      for (const t of ["fellows", "events", "attendance", "time_away", "event_plans", "audit_log", "settings", "members"]) {
        const { data } = await c.from(t).select("*");
        expect(data ?? [], `${t}`).toEqual([]);
      }
      const r = await c.rpc("member_directory");
      expect(r.data ?? []).toEqual([]);
    }
    const ins = await outsider.from("events").insert({ title: "x", event_type: "other", starts_at: hoursFromNow(1), ends_at: hoursFromNow(2) });
    expect(ins.error).not.toBeNull();
    const rpc = await outsider.rpc("record_attendance", { p_fellow_id: fellowIds[0], p_event_id: "00000000-0000-0000-0000-000000000000", p_status: "present" });
    expect(rpc.error).not.toBeNull();
  });

  it("a non-admin cannot grant themselves admin or edit the roster/settings", async () => {
    const me = ids[Object.keys(ids).find((k) => k.startsWith("fellow"))!];
    const up = await fellow.from("members").update({ role: "admin", version: 1 }).eq("user_id", me).select();
    expect(up.data ?? []).toEqual([]);
    const ins = await outsider.from("members").insert({ user_id: ids[Object.keys(ids).find((k) => k.startsWith("outsider"))!], email: "o@example.org", display_name: "O", kind: "staff", role: "admin" });
    expect(ins.error).not.toBeNull();
    expect(sql(`select role from public.members where user_id='${me}'`)).toBe("member");
    const f = await fellow.from("fellows").update({ display_name: "Hacked", version: 1 }).eq("id", fellowIds[1]).select();
    expect(f.data ?? []).toEqual([]);
    const s = await staff.from("settings").update({ warning_threshold: 9, version: 1 }).eq("id", 1).select();
    expect(s.data ?? []).toEqual([]);
    const bs = await fellow.rpc("bootstrap_first_admin", { p_email: "x@example.org", p_name: "x" });
    expect(bs.error).not.toBeNull();
  });

  it("attendance can only be written through the save functions; audit is read-only", async () => {
    const ev = await newEvent(staff, -2);
    const direct = await fellow.from("attendance").insert({ fellow_id: fellowIds[0], event_id: ev.id, status: "absent", reason_id: reasonId });
    expect(direct.error).not.toBeNull();
    const audit = await admin.from("audit_log").insert({ table_name: "x", action: "x", record_id: "x" });
    expect(audit.error).not.toBeNull();
    const del = await admin.from("audit_log").delete().gt("id", 0).select();
    expect(del.data ?? []).toEqual([]);
    expect(Number(sql("select count(*) from public.audit_log"))).toBeGreaterThan(0);
  });

  it("records an absence, ignores repeated taps, undoes it, and keeps history", async () => {
    const ev = await newEvent(staff, -3);
    const args = { p_fellow_id: fellowIds[1], p_event_id: ev.id, p_status: "absent", p_reason_id: reasonId, p_note: "t", p_expected_version: null };
    const a = await staff.rpc("record_attendance", args).single();
    expect(a.error).toBeNull();
    // Repeated taps (same values, same stale expectation) are harmless.
    const [b, c] = await Promise.all([staff.rpc("record_attendance", args).single(), staff.rpc("record_attendance", args).single()]);
    expect(b.error).toBeNull();
    expect(c.error).toBeNull();
    expect(sql(`select count(*) from public.attendance where event_id='${ev.id}'`)).toBe("1");
    const v = (a.data as { version: number }).version;
    const undo = await staff.rpc("record_attendance", { ...args, p_status: "not_recorded", p_reason_id: null, p_expected_version: v }).single();
    expect(undo.error).toBeNull();
    expect((undo.data as { status: string }).status).toBe("not_recorded");
    expect(sql(`select count(*) from public.audit_log where event_id='${ev.id}' and table_name='attendance'`)).toBe("2");
    const staffId = ids[Object.keys(ids).find((k) => k.startsWith("staff"))!];
    expect(sql(`select distinct actor_id from public.audit_log where event_id='${ev.id}' and table_name='attendance'`)).toBe(staffId);
    expect(sql(`select updated_by from public.attendance where event_id='${ev.id}'`)).toBe(staffId);
  });

  it("rejects stale edits instead of silently overwriting a newer correction", async () => {
    const ev = await newEvent(staff, -4);
    const base = { p_fellow_id: fellowIds[2], p_event_id: ev.id, p_reason_id: null, p_note: null };
    const first = await staff.rpc("record_attendance", { ...base, p_status: "present", p_expected_version: null }).single();
    expect(first.error).toBeNull();
    // Fellow corrects to absent (based on version 1)
    const fix = await fellow.rpc("record_attendance", { ...base, p_status: "absent", p_reason_id: reasonId, p_expected_version: 1 }).single();
    expect(fix.error).toBeNull();
    // Staff, still looking at version 1, tries to set present again → conflict
    const stale = await staff.rpc("record_attendance", { ...base, p_status: "present", p_expected_version: 1 }).single();
    expect(stale.error?.message).toContain("stale_version");
    expect(sql(`select status from public.attendance where event_id='${ev.id}'`)).toBe("absent");
    // Same for events table updates
    const e2 = await fellow.from("events").update({ title: "A", version: ev.version }).eq("id", ev.id).select();
    expect(e2.data?.length).toBe(1);
    const e3 = await staff.from("events").update({ title: "B", version: ev.version }).eq("id", ev.id).select();
    expect(e3.error?.message ?? (e3.data?.length === 0 ? "no rows" : "")).toMatch(/stale_version|no rows/);
  });

  it("refuses actual attendance before an event starts, and plans after it starts", async () => {
    const future = await newEvent(staff, 48);
    const r = await fellow.rpc("record_attendance", { p_fellow_id: fellowIds[0], p_event_id: future.id, p_status: "absent", p_reason_id: reasonId });
    expect(r.error?.message).toContain("event_not_started");
    const past = await newEvent(staff, -5);
    const p = await fellow.rpc("set_event_plan", { p_fellow_id: fellowIds[0], p_event_id: past.id, p_kind: "absent", p_reason_id: reasonId });
    expect(p.error?.message).toContain("event_started");
    const ok = await fellow.rpc("set_event_plan", { p_fellow_id: fellowIds[0], p_event_id: future.id, p_kind: "absent", p_reason_id: reasonId });
    expect(ok.error).toBeNull();
    const again = await fellow.rpc("set_event_plan", { p_fellow_id: fellowIds[0], p_event_id: future.id, p_kind: "absent", p_reason_id: reasonId });
    expect(again.error).toBeNull();
    expect(sql(`select count(*) from public.event_plans where event_id='${future.id}'`)).toBe("1");
  });

  it("mark remaining present only touches unrecorded Fellows and is logged", async () => {
    const ev = await newEvent(staff, -6);
    await staff.rpc("record_attendance", { p_fellow_id: fellowIds[3], p_event_id: ev.id, p_status: "absent", p_reason_id: reasonId });
    const n = await staff.rpc("mark_remaining_present", { p_event_id: ev.id, p_fellow_ids: fellowIds });
    expect(n.data).toBe(10);
    expect(sql(`select status from public.attendance where event_id='${ev.id}' and fellow_id='${fellowIds[3]}'`)).toBe("absent");
    expect(sql(`select count(*) from public.audit_log where event_id='${ev.id}' and after->>'marked_via'='mark_remaining_present'`)).toBe("10");
  });

  it("rescheduling an event with recorded attendance flags it for review; local date follows New York time", async () => {
    const ev = await newEvent(staff, -8);
    await staff.rpc("record_attendance", { p_fellow_id: fellowIds[4], p_event_id: ev.id, p_status: "present" });
    const moved = await staff.from("events").update({ starts_at: hoursFromNow(-30), ends_at: hoursFromNow(-29), version: ev.version }).eq("id", ev.id).select().single();
    expect(moved.error).toBeNull();
    expect(moved.data.needs_review).toBe(true);
    // 2026-03-04 03:30 UTC is still March 3 in New York.
    const late = await staff.from("events").insert({ title: "late", event_type: "other", starts_at: "2027-03-04T03:30:00Z", ends_at: "2027-03-04T04:00:00Z" }).select().single();
    expect(late.data.local_date).toBe("2027-03-03");
  });

  it("canceled events keep their records and refuse new attendance", async () => {
    const ev = await newEvent(staff, -10);
    await staff.rpc("record_attendance", { p_fellow_id: fellowIds[5], p_event_id: ev.id, p_status: "absent", p_reason_id: reasonId });
    const c = await staff.from("events").update({ status: "canceled", version: ev.version }).eq("id", ev.id).select().single();
    expect(c.error).toBeNull();
    const r = await staff.rpc("record_attendance", { p_fellow_id: fellowIds[6], p_event_id: ev.id, p_status: "absent", p_reason_id: reasonId });
    expect(r.error?.message).toContain("event_canceled");
    expect(sql(`select count(*) from public.attendance where event_id='${ev.id}'`)).toBe("1");
    const d = await admin.from("events").delete().eq("id", ev.id).select();
    expect(d.data ?? []).toEqual([]);
  });

  it("time away saved before events exist is stored; ineligible Fellows are rejected", async () => {
    const t = await fellow.from("time_away").insert({ fellow_id: fellowIds[0], start_date: "2027-06-01", end_date: "2027-06-14", reason_id: reasonId }).select().single();
    expect(t.error).toBeNull();
    const bad = await fellow.from("time_away").insert({ fellow_id: fellowIds[0], start_date: "2027-06-14", end_date: "2027-06-01", reason_id: reasonId });
    expect(bad.error).not.toBeNull();
    const fv = (await admin.from("fellows").select("version").eq("id", fellowIds[10]).single()).data!.version;
    await admin.from("fellows").update({ eligible_until: "2026-01-01", version: fv }).eq("id", fellowIds[10]);
    const ev = await newEvent(staff, -12);
    const r = await staff.rpc("record_attendance", { p_fellow_id: fellowIds[10], p_event_id: ev.id, p_status: "absent", p_reason_id: reasonId });
    expect(r.error?.message).toContain("fellow_not_eligible");
  });

  it("cannot remove the last administrator; ownership requires an admin", async () => {
    const adminId = ids[Object.keys(ids).find((k) => k.startsWith("admin"))!];
    const r = await admin.from("members").update({ role: "member", version: 1 }).eq("user_id", adminId).select();
    expect(r.error?.message ?? "").toMatch(/last_admin|owner_must_be_admin/);
    const staffId = ids[Object.keys(ids).find((k) => k.startsWith("staff"))!];
    const sv = (await admin.from("settings").select("version").single()).data!.version;
    const s = await admin.from("settings").update({ backup_owner_id: staffId, version: sv }).eq("id", 1).select();
    expect(s.error?.message).toContain("owner_must_be_admin");
  });

  it("removing access blocks reads immediately", async () => {
    const staffId = ids[Object.keys(ids).find((k) => k.startsWith("staff"))!];
    const v = (await admin.from("members").select("version").eq("user_id", staffId).single()).data!.version;
    const r = await admin.from("members").update({ active: false, version: v }).eq("user_id", staffId).select();
    expect(r.error).toBeNull();
    const { data } = await staff.from("events").select("id");
    expect(data ?? []).toEqual([]);
    await admin.from("members").update({ active: true, version: v + 1 }).eq("user_id", staffId);
    expect(((await staff.from("events").select("id")).data ?? []).length).toBeGreaterThan(0);
  });

  it("portraits: admins upload; members read; outsiders and non-admins cannot", async () => {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    const path = `${fellowIds[0]}/test.png`;
    const up = await admin.storage.from("portraits").upload(path, png, { contentType: "image/png" });
    expect(up.error).toBeNull();
    const bad = await fellow.storage.from("portraits").upload(`${fellowIds[0]}/evil.png`, png, { contentType: "image/png" });
    expect(bad.error).not.toBeNull();
    const ok = await fellow.storage.from("portraits").createSignedUrl(path, 60);
    expect(ok.error).toBeNull();
    const no = await outsider.storage.from("portraits").createSignedUrl(path, 60);
    expect(no.error).not.toBeNull();
    const pub = await fetch(`${URL}/storage/v1/object/public/portraits/${path}`);
    expect(pub.ok).toBe(false);
    const anonDl = await anon.storage.from("portraits").download(path);
    expect(anonDl.error).not.toBeNull();
  });
});
