/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script */
// End-to-end check of the REAL app against a local Supabase (fictional data).
// Prereqs: `npx supabase start`, `npx supabase db reset`, app running with .env.local
// Run: node e2e/live.e2e.cjs   (env: APP, SB_URL, SB_SECRET, MAILPIT, DB_URL)
const { chromium, devices } = require("playwright");
const { execSync } = require("node:child_process");

const APP = process.env.APP || "http://127.0.0.1:3200";
const SB = process.env.SB_URL || "http://127.0.0.1:54321";
// Local stack keys are read from `npx supabase status`, never hard-coded.
const st = (() => { try { return JSON.parse(execSync("npx supabase status -o json", { stdio: ["ignore", "pipe", "ignore"] }).toString()); } catch { return {}; } })();
const SECRET = process.env.SB_SECRET || st.SECRET_KEY;
const PUB = process.env.SB_PUB || st.PUBLISHABLE_KEY;
const MAIL = process.env.MAILPIT || "http://127.0.0.1:54324";
const DB = process.env.DB_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const SHOTS = process.env.SHOTS || null;
const sql = (q) => execSync(`psql "${DB}" -v ON_ERROR_STOP=1 -tAc ${JSON.stringify(q)}`).toString().trim();

const results = [];
const pages = {};
const ok = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const visible = (loc, t = 10000) => loc.waitFor({ timeout: t }).then(() => true, () => false);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function latestCode(email, after) {
  for (let i = 0; i < 40; i++) {
    const r = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`).then((x) => x.json());
    const m = (r.messages || []).find((x) => new Date(x.Created).getTime() >= after - 2000);
    if (m) {
      const full = await fetch(`${MAIL}/api/v1/message/${m.ID}`).then((x) => x.json());
      const code = (full.Text || full.HTML || "").match(/\b(\d{6,10})\b/);
      if (code) return code[1];
    }
    await sleep(500);
  }
  throw new Error(`no code for ${email}`);
}

async function signIn(page, email) {
  await page.goto(APP + "/");
  await page.getByLabel("Email address").fill(email);
  const t = Date.now();
  await page.getByRole("button", { name: "Email me a code" }).click();
  await page.getByLabel("Sign-in code").waitFor();
  const code = await latestCode(email, t);
  await page.getByLabel("Sign-in code").fill(code);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("heading", { name: "Overview" }).waitFor({ timeout: 15000 });
}

const nyDate = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
const addDays = (key, n) => { const [y, m, d] = key.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };

(async () => {
  const tag = Date.now().toString(36);
  const ADMIN = `owner-${tag}@example.org`, FELLOW = `fellow-${tag}@example.org`, STAFF = `staff-${tag}@example.org`, OUT = `stranger-${tag}@example.org`;

  // Owner bootstrap exactly as in the setup guide: create user, then run the SQL helper.
  const mk = (email) => fetch(`${SB}/auth/v1/admin/users`, { method: "POST", headers: { apikey: SECRET, authorization: `Bearer ${SECRET}`, "content-type": "application/json" }, body: JSON.stringify({ email, email_confirm: true }) });
  await mk(ADMIN);
  await mk(OUT); // a real account that was never invited
  sql(`select public.bootstrap_first_admin('${ADMIN}', 'Owner Tester')`);

  const browser = await chromium.launch();
  const desk = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const phone = await browser.newContext({ ...devices["iPhone 13"] });
  const admin = await desk.newPage();
  const errors = [];
  for (const p of [admin]) p.on("pageerror", (e) => errors.push(String(e)));

  // ---- 1. Owner signs in with an emailed code and invites people through the UI
  await signIn(admin, ADMIN);
  ok("Owner signs in with emailed 6-digit code", true);
  await admin.goto(APP + "/admin");
  await admin.getByRole("button", { name: "Invite person" }).click();
  await admin.getByLabel("Email").fill(FELLOW);
  await admin.getByLabel("Roster profile").selectOption({ label: "Fellow 03" });
  await admin.getByLabel("Display name").fill("Fellow 03");
  await admin.getByRole("button", { name: "Create invitation" }).click();
  await admin.getByText("Invitation created").waitFor();
  await admin.getByLabel("Email").fill(STAFF);
  await admin.getByRole("radio", { name: "Program staff" }).click();
  await admin.getByLabel("Display name").fill("Staff Tester");
  await admin.getByRole("button", { name: "Create invitation" }).click();
  await sleep(1500);
  ok("Invitations created via server route", sql(`select count(*) from public.members`) === "3");
  await admin.getByRole("button", { name: "Done" }).click();

  // ---- 2. Owner adds events: a past event (yesterday), a Wednesday event, and two events on one date
  const today = nyDate(new Date());
  let wed = addDays(today, 1);
  while (new Date(wed + "T12:00:00Z").getUTCDay() !== 3) wed = addDays(wed, 1);
  const addEvent = async (title, date, start, end) => {
    await admin.goto(APP + "/calendar");
    await admin.getByRole("button", { name: "Add event" }).click();
    await admin.getByLabel("Title").fill(title);
    await admin.getByLabel("Date").fill(date);
    await admin.getByLabel("Starts (ET)").fill(start);
    await admin.getByLabel("Ends (ET)").fill(end);
    await admin.locator("dialog").getByRole("button", { name: "Add event" }).click();
    await admin.getByText(`Event added: ${title}`).waitFor();
  };
  await addEvent("E2E Past Session", addDays(today, -1), "12:00", "13:00");
  await addEvent("E2E Wednesday Visit", wed, "09:30", "15:00");
  await addEvent("E2E Morning Briefing", addDays(wed, 1), "09:00", "10:00");
  await addEvent("E2E Afternoon Speaker", addDays(wed, 1), "14:00", "15:00");
  ok("Wednesday event stored on correct NY date", sql(`select local_date from public.events where title='E2E Wednesday Visit'`) === wed);
  ok("Two events on one date", sql(`select count(*) from public.events where local_date='${addDays(wed, 1)}'`) === "2");
  const wedStartUtc = sql(`select to_char(starts_at at time zone 'UTC','HH24:MI') from public.events where title='E2E Wednesday Visit'`);
  ok("09:30 ET stored as correct UTC instant", wedStartUtc === "14:30" || wedStartUtc === "13:30", wedStartUtc);

  // ---- 3. Fellow on iPhone records a future (planned) absence; timed
  const fp = await phone.newPage();
  fp.on("pageerror", (e) => errors.push(String(e)));
  pages.phone = fp;
  await signIn(fp, FELLOW);
  const t0 = Date.now();
  await fp.getByRole("button", { name: "Record absence" }).first().click();
  await fp.locator("dialog").getByLabel("Event").selectOption({ label: await fp.locator("dialog select option", { hasText: "E2E Wednesday Visit" }).innerText() });
  await fp.locator("dialog").getByRole("radio", { name: "Placement work obligation" }).click();
  await fp.locator("dialog").getByRole("button", { name: "Save planned absence" }).click();
  await fp.getByText("Planned absence saved for Fellow 03").waitFor();
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  ok("Fellow defaulted to self and saved a planned absence on iPhone", sql(`select count(*) from public.event_plans ep join public.fellows f on f.id=ep.fellow_id where f.display_name='Fellow 03'`) === "1", `${secs}s of automated taps incl. server round-trip`);
  if (SHOTS) await fp.screenshot({ path: `${SHOTS}/e2e-phone-after-save.png` });

  // ---- 4. Staff on another device sees it (live update, no reload)
  const sp = await desk.browser().newContext({ viewport: { width: 1280, height: 900 } }).then((c) => c.newPage());
  await signIn(sp, STAFF);
  pages.staff = sp;
  const wedId = sql(`select id from public.events where title='E2E Wednesday Visit'`);
  await sp.goto(`${APP}/event?id=${wedId}`);
  await sp.getByText("1 planned absence; 10 have no absence reported.").waitFor({ timeout: 8000 });
  ok("Staff sees the Fellow's planned absence (honest wording)", true);
  // Fellow removes it on the phone → staff screen updates live
  await fp.goto(`${APP}/event?id=${wedId}`);
  await fp.getByRole("button", { name: "Undo absence" }).click();
  let live = false;
  try { await sp.getByText("0 planned absences; 11 have no absence reported.").waitFor({ timeout: 8000 }); live = true; } catch {}
  ok("Staff screen updates live after another device's change", live);

  // ---- 5. Staff records an actual absence for yesterday, then undoes it
  const pastId = sql(`select id from public.events where title='E2E Past Session'`);
  await sp.goto(`${APP}/event?id=${pastId}`);
  await sp.getByText("Attendance review").waitFor();
  const row = sp.locator("li", { hasText: "Fellow 05" });
  await row.getByRole("button", { name: "Absent…" }).click();
  await sp.locator("dialog").getByRole("radio", { name: "Illness" }).click();
  await sp.locator("dialog").getByRole("button", { name: "Record absence" }).click();
  await sp.getByText("Absence recorded for Fellow 05").waitFor();
  await sp.goto(APP + "/fellows");
  const card = sp.locator("a", { hasText: "Fellow 05" });
  const missed1 = await card.locator("dd").first().innerText();
  ok("Actual absence counts as 1 event missed", missed1 === "1", missed1);
  await sp.goto(`${APP}/event?id=${pastId}`);
  await sp.locator("li", { hasText: "Fellow 05" }).getByRole("button", { name: "Undo absence" }).click();
  await sp.getByText("Fellow 05: absence undone.").waitFor();
  await sp.goto(APP + "/fellows");
  const missed2 = await sp.locator("a", { hasText: "Fellow 05" }).locator("dd").first().innerText();
  ok("Undo returns total to 0", missed2 === "0", missed2);
  ok("Undo leaves 'Not recorded', not 'Present'", sql(`select status from public.attendance a join public.fellows f on f.id=a.fellow_id where f.display_name='Fellow 05'`) === "not_recorded");
  ok("History kept (2 audit rows by staff)", sql(`select count(*) from public.audit_log l join public.members m on m.user_id=l.actor_id where l.table_name='attendance' and m.display_name='Staff Tester'`) === "2");
  await sp.goto(APP + "/history");
  await sp.getByText("Undid the absence for Fellow 05").first().waitFor();
  ok("Change history names the editor", await sp.getByText("by Staff Tester").first().isVisible());

  // ---- 6. Time away before events exist; a later event picks it up; overlap + repeated taps don't double count
  const rs = addDays(today, 60), re = addDays(today, 74);
  await fp.goto(APP + "/");
  await fp.getByRole("button", { name: "Plan time away" }).click();
  await fp.getByLabel("First day away").fill(rs);
  await fp.getByLabel("Last day away").fill(re);
  await fp.locator("dialog").getByRole("radio", { name: "Military training/duty" }).click();
  await fp.locator("dialog").getByText("No upcoming events are on the calendar in these dates yet.").waitFor();
  await fp.locator("dialog").getByRole("button", { name: "Save time away" }).click();
  await fp.getByText("Time away saved").waitFor();
  // Overlapping second range
  await fp.getByRole("button", { name: "Plan time away" }).click();
  await fp.getByLabel("First day away").fill(addDays(rs, 3));
  await fp.getByLabel("Last day away").fill(addDays(rs, 5));
  await fp.locator("dialog").getByRole("radio", { name: "Travel" }).click();
  await fp.locator("dialog").getByRole("button", { name: "Save time away" }).click();
  await fp.getByText("Time away saved").first().waitFor();
  await addEvent("E2E Later Event", addDays(rs, 4), "12:00", "13:00");
  const laterId = sql(`select id from public.events where title='E2E Later Event'`);
  await sp.goto(`${APP}/event?id=${laterId}`);
  await sp.getByText("1 planned absence; 10 have no absence reported.").waitFor();
  ok("Event added later picks up saved time away (overlap counted once)", true);
  // Single-event plan on top of range; double-tap save
  await sp.getByRole("button", { name: "Record absence" }).first().click();
  await sp.locator("dialog").getByRole("radio", { name: "Fellow 03" }).click();
  await sp.locator("dialog").getByRole("radio", { name: "Travel" }).click();
  const save = sp.locator("dialog").getByRole("button", { name: "Save planned absence" });
  await save.dblclick();
  await sp.getByText("Planned absence saved").first().waitFor();
  await sleep(800);
  await sp.reload();
  await sp.getByText("1 planned absence; 10 have no absence reported.").waitFor();
  ok("Range + single plan + double tap still counts once", sql(`select count(*) from public.event_plans where event_id='${laterId}'`) === "1");
  // Exception: will attend this one (removes the single plan first via Undo, then exception)
  await sp.locator("li", { hasText: "Fellow 03" }).getByRole("button", { name: "Undo absence" }).click();
  await sp.locator("li", { hasText: "Fellow 03" }).getByRole("button", { name: "Will attend this one" }).click();
  await sp.getByText("0 planned absences; 11 have no absence reported.").waitFor();
  ok("'Will attend this one' exception overrides the range", true);

  // ---- 7. Rescheduling: moving the event out of the range updates projections
  await sp.locator("li", { hasText: "Fellow 03" }).getByRole("button", { name: "Remove exception" }).click();
  await sp.getByText("1 planned absence; 10 have no absence reported.").waitFor();
  await sp.getByRole("button", { name: "Edit event" }).click();
  await sp.locator("dialog").getByLabel("Date").fill(addDays(re, 2));
  await sp.locator("dialog").getByRole("button", { name: "Save changes" }).click();
  await sp.getByText("0 planned absences; 11 have no absence reported.").waitFor();
  ok("Rescheduling out of a time-away range removes the projection", true);

  // ---- 8. Plan remains unconfirmed after the event until reviewed; changing plan can't touch confirmed past
  // Put a plan on a future event, then move the event into the past (simulates time passing).
  const pastPlanned = sql(`insert into public.events (title, event_type, starts_at, ends_at) values ('E2E Becomes Past','speaker_series', now() + interval '2 days', now() + interval '2 days 1 hour') returning id`).split("\n")[0];
  const fid3 = sql(`select id from public.fellows where display_name='Fellow 03'`);
  sql(`insert into public.event_plans (fellow_id, event_id, kind, reason_id) values ('${fid3}','${pastPlanned}','absent',(select id from public.reasons order by sort_order limit 1))`);
  sql(`update public.events set starts_at = now() - interval '3 hours', ends_at = now() - interval '2 hours' where id='${pastPlanned}'`);
  await sp.goto(`${APP}/event?id=${pastPlanned}`);
  await sp.getByText("Attendance review").waitFor();
  const f3row = sp.locator("li", { hasText: "Fellow 03" });
  ok("Planned absence after the event shows 'Not recorded · plan on file'", await f3row.getByText("Not recorded · plan on file").isVisible());
  ok("No attendance row auto-created", sql(`select count(*) from public.attendance where event_id='${pastPlanned}'`) === "0");
  await f3row.getByRole("button", { name: "Confirm absent" }).click();
  await sp.getByText("Fellow 03: recorded absent.").waitFor();
  // Remove the time away on the phone: confirmed past record must not change
  await fp.goto(`${APP}/fellow?id=${fid3}`);
  await fp.getByRole("button", { name: "Edit / shorten / remove" }).first().click();
  await fp.locator("dialog").getByRole("button", { name: "Remove" }).first().click();
  await fp.locator("dialog").getByRole("button", { name: "Remove" }).last().click();
  await fp.getByText("Time away removed.").waitFor();
  ok("Changing plans doesn't alter confirmed past attendance", sql(`select status from public.attendance where event_id='${pastPlanned}' and fellow_id='${fid3}'`) === "absent");

  // ---- 9. Mark remaining present requires explicit confirmation and is logged
  await sp.getByRole("button", { name: /Mark remaining present/ }).click();
  await sp.locator("dialog").getByRole("button", { name: /Mark 10 present/ }).click();
  await sp.getByText("10 Fellows marked present").waitFor();
  ok("Mark remaining present: 10 present, 1 absent kept", sql(`select string_agg(status||':'||n, ',' order by status) from (select status, count(*) n from public.attendance where event_id='${pastPlanned}' group by status) x`) === "absent:1,present:10");

  // ---- 10. Cancel an event: kept, not counted
  await sp.getByRole("button", { name: "Edit event" }).click();
  await sp.locator("dialog").getByRole("button", { name: "Cancel event…" }).click();
  await sp.locator("dialog").getByRole("button", { name: "Cancel event", exact: true }).click();
  await sp.getByText("Event canceled.").waitFor();
  await sp.goto(APP + "/fellows");
  const f3m = await sp.locator("a", { hasText: "Fellow 03" }).locator("dd").first().innerText();
  ok("Canceled event's absence no longer counts", f3m === "0", f3m);

  // ---- 11. Failed and slow saves: never shows 'Saved' before the server confirms
  await sp.goto(`${APP}/event?id=${pastId}`);
  await sp.route("**/rest/v1/rpc/record_attendance", (r) => r.abort("failed"));
  await sp.locator("li", { hasText: "Fellow 07" }).getByRole("button", { name: "Mark present" }).click();
  await sp.getByText("Not saved.").waitFor();
  ok("Failed save shows 'Not saved' with a clear message", await sp.getByText("Couldn't reach the server").isVisible());
  await sp.unroute("**/rest/v1/rpc/record_attendance");
  await sp.route("**/rest/v1/rpc/record_attendance", async (r) => { await sleep(2500); await r.continue(); });
  await sp.locator("li", { hasText: "Fellow 07" }).getByRole("button", { name: "Mark present" }).click();
  await sp.getByText("Saving…").first().waitFor();
  const prematureToast = await sp.getByText("Fellow 07: marked present.").isVisible();
  await sp.getByText("Fellow 07: marked present.").waitFor({ timeout: 8000 });
  ok("Slow save shows 'Saving…' and confirms only after server", !prematureToast);
  await sp.unroute("**/rest/v1/rpc/record_attendance");

  // ---- 12. Offline: edits refused with explanation
  await fp.goto(APP + "/");
  await fp.getByRole("heading", { name: "Overview" }).waitFor();
  await phone.setOffline(true);
  await fp.evaluate(() => window.dispatchEvent(new Event("offline")));
  await fp.getByText("You're offline").or(fp.getByText("You’re offline")).first().waitFor();
  if (SHOTS) await fp.screenshot({ path: `${SHOTS}/e2e-offline.png` });
  await fp.getByRole("button", { name: "Record absence" }).first().click();
  await fp.locator("dialog").getByRole("radio", { name: "Illness" }).click();
  await fp.locator("dialog").getByRole("button", { name: /Save planned absence|Record absence/ }).click();
  await fp.locator("dialog").getByText("Not saved.").waitFor();
  ok("Offline edit is refused with an explanation", true);
  await phone.setOffline(false);
  await fp.evaluate(() => window.dispatchEvent(new Event("online")));
  await fp.locator("dialog").getByRole("button", { name: "Close" }).click();

  // ---- 13. Simultaneous edits: stale screen can't overwrite a newer correction
  const s2 = await desk.newPage(); // same staff session? use admin page for second editor
  await admin.goto(`${APP}/event?id=${pastId}`);
  await sp.goto(`${APP}/event?id=${pastId}`);
  await sp.getByText("Attendance review").waitFor();
  await admin.getByText("Attendance review").waitFor();
  // Freeze the staff page's live updates by going offline for realtime only: simulate by blocking reloads
  await sp.route("**/rest/v1/attendance*", (r) => r.abort("failed"));
  await admin.locator("li", { hasText: "Fellow 08" }).getByRole("button", { name: "Mark present" }).click();
  await admin.getByText("Fellow 08: marked present.").waitFor();
  await sleep(1200);
  // Staff page still shows Fellow 08 as Not recorded (stale). Staff now records absent via sheet with stale version.
  await sp.locator("li", { hasText: "Fellow 08" }).getByRole("button", { name: "Absent…" }).click();
  await sp.locator("dialog").getByRole("radio", { name: "Travel" }).click();
  await sp.locator("dialog").getByRole("button", { name: "Record absence" }).click();
  let conflict = false;
  try { await sp.locator("dialog").getByText("Someone else changed this record").waitFor({ timeout: 6000 }); conflict = true; } catch {}
  ok("Stale edit is rejected with a conflict message", conflict);
  ok("Newer correction preserved", sql(`select status from public.attendance a join public.fellows f on f.id=a.fellow_id where f.display_name='Fellow 08' and a.event_id='${pastId}'`) === "present");
  await sp.unroute("**/rest/v1/attendance*");
  await s2.close();

  // ---- 14. Refresh, direct links, sign out / sign in
  await fp.goto(`${APP}/event?id=${wedId}`);
  await fp.reload();
  ok("Direct link + refresh keeps the session (iPhone)", await visible(fp.getByRole("heading", { name: "E2E Wednesday Visit" })));
  await fp.getByRole("button", { name: "Menu" }).click();
  await fp.locator("dialog").getByRole("button", { name: "Sign out" }).click();
  await fp.getByLabel("Email address").waitFor();
  await fp.goto(`${APP}/reports`);
  ok("After sign-out, pages show only the sign-in screen", await visible(fp.getByLabel("Email address")));
  await signIn(fp, FELLOW);
  ok("Sign back in works", true);
  const ctx2 = await browser.newContext({ ...devices["iPhone 13"] });
  const p2 = await ctx2.newPage();
  await p2.goto(APP + "/");
  ok("Fresh device (like Home Screen app) needs its own sign-in", await visible(p2.getByLabel("Email address")));

  // ---- 15. Unauthorized access
  const anonRest = await fetch(`${SB}/rest/v1/attendance?select=*`, { headers: { apikey: PUB } }).then((r) => r.json());
  ok("Anonymous API call returns no attendance", Array.isArray(anonRest) ? anonRest.length === 0 : true, JSON.stringify(anonRest).slice(0, 80));
  const anonInvite = await fetch(`${APP}/api/admin/invite`, { method: "POST", body: "{}" });
  ok("Invite endpoint refuses signed-out callers", anonInvite.status === 401);
  const op = await (await browser.newContext()).newPage();
  await signIn(op, OUT).catch(() => {});
  ok("Uninvited account sees 'No access yet' and no data", await visible(op.getByText("No access yet")));
  // Fellow (non-admin) cannot call invite or open admin tools
  const tok = await fp.evaluate(() => JSON.parse(localStorage.getItem("fa-auth") || "{}").access_token);
  const fInvite = await fetch(`${APP}/api/admin/invite`, { method: "POST", headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" }, body: JSON.stringify({ email: "x@example.org", display_name: "x", kind: "staff", role: "admin" }) });
  ok("Non-admin cannot invite (403)", fInvite.status === 403);
  const selfAdmin = await fetch(`${SB}/rest/v1/members?user_id=eq.${sql(`select user_id from public.members where email='${FELLOW}'`)}`, { method: "PATCH", headers: { apikey: PUB, authorization: `Bearer ${tok}`, "content-type": "application/json", prefer: "return=representation" }, body: JSON.stringify({ role: "admin", version: 1 }) }).then((r) => r.json());
  ok("Non-admin cannot grant themselves admin", sql(`select role from public.members where email='${FELLOW}'`) === "member", JSON.stringify(selfAdmin).slice(0, 60));
  await fp.goto(APP + "/admin");
  ok("Admin screen hidden for non-admins", await visible(fp.getByText("Administration is limited to tracker administrators.")));

  // ---- 16. CSV export matches on-screen totals (with real non-zero data)
  await admin.goto(`${APP}/event?id=${pastId}`);
  await admin.locator("li", { hasText: "Fellow 06" }).getByRole("button", { name: "Absent…" }).click();
  await admin.locator("dialog").getByRole("radio", { name: "Personal/family" }).click();
  await admin.locator("dialog").getByRole("button", { name: "Record absence" }).click();
  await admin.getByText("Absence recorded for Fellow 06").waitFor();
  await admin.goto(APP + "/reports");
  await admin.locator("tbody tr").first().waitFor();
  const [dl] = await Promise.all([admin.waitForEvent("download"), admin.getByRole("button", { name: "Download summary CSV" }).click()]);
  const csv = require("node:fs").readFileSync(await dl.path(), "utf8");
  const screenMissed = await admin.locator("tbody tr").evaluateAll((rows) => rows.map((r) => r.children[2].textContent).join(","));
  const csvMissed = csv.trim().split(/\r?\n/).slice(1).map((l) => l.split(",")[3]).join(",");
  ok("CSV totals match the screen (non-zero)", screenMissed === csvMissed && /[1-9]/.test(csvMissed), `${screenMissed} vs ${csvMissed}`);
  await admin.getByLabel("Absence reason").selectOption({ label: "Illness" });
  const [dl2] = await Promise.all([admin.waitForEvent("download"), admin.getByRole("button", { name: "Download summary CSV" }).click()]);
  const csv2 = require("node:fs").readFileSync(await dl2.path(), "utf8");
  const screen2 = await admin.locator("tbody tr").evaluateAll((rows) => rows.map((r) => r.children[2].textContent).join(","));
  const csv2Missed = csv2.trim().split(/\r?\n/).slice(1).map((l) => l.split(",")[3]).join(",");
  ok("Filtered CSV (reason = Illness) matches filtered screen", screen2 === csv2Missed && !/[1-9]/.test(csv2Missed), `${screen2}`);

  ok("No uncaught page errors", errors.length === 0, errors.join(" | ").slice(0, 200));
  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch(async (e) => {
  console.error("E2E crashed:", e);
  if (SHOTS && pages.phone) await pages.phone.screenshot({ path: `${SHOTS}/e2e-crash-phone.png` }).catch(() => {});
  if (SHOTS && pages.staff) await pages.staff.screenshot({ path: `${SHOTS}/e2e-crash-staff.png`, fullPage: true }).catch(() => {});
  process.exit(2);
});
