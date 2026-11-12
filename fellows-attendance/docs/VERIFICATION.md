# Verification report

Date: 12 November 2026. All data used was fictional.

## How it was tested

- **Real backend, locally:** a full local Supabase stack (Postgres 17, Auth, Storage, Realtime, test mailbox) running this repository's migration. Not a mock.
- **Real app:** the production build (`next build` + `next start`), driven in Chromium by Playwright. One browser context emulated an **iPhone 13** (WebKit-style mobile viewport and touch); others were desktop windows. Each context used a separate account.
- **Real sign-in:** every sign-in requested an emailed 6-digit code, read it from the test mailbox, and entered it.

## Results

| Suite | Command | Result |
|---|---|---|
| Counting rules + time zones (unit) | `npm test` | **21 / 21 passed** |
| Database permissions & rules (integration, real Supabase) | `npm run test:live` | **14 / 14 passed** |
| End-to-end app scenarios (real Supabase, two devices) | `npm run e2e` | **40 / 40 checks passed** |
| Type check / lint / production build | `npm run typecheck`, `npm run lint`, `npm run build` | clean |

### Your scenarios → what was checked

| Scenario | Checked by | Result |
|---|---|---|
| Fellow records a future absence on iPhone; staff see it from another account | e2e 3–4 (incl. live update without reload) | ✅ |
| Staff record an actual absence and undo it; totals and history correct | e2e 5 (total 1 → 0; status returns to *Not recorded*, not *Present*; 2 history rows naming the editor) | ✅ |
| Time-away saved before events exist; new event picks it up | e2e 6, unit test | ✅ |
| Overlapping plans and repeated taps don't double count | e2e 6 (two overlapping ranges + single-event plan + double-click = 1), integration (concurrent duplicate saves = 1 row) | ✅ |
| Wednesday event; two events on one date | e2e 2, unit tests ("2 events missed") | ✅ |
| Canceling/rescheduling updates projections and counts | e2e 7 & 10, integration (reschedule flags review; canceled refuses new records and can't be deleted) | ✅ |
| Planned absence stays unconfirmed after the event until reviewed | e2e 8 (no attendance row created; shows "Not recorded · plan on file") | ✅ |
| Changing a plan can't overwrite confirmed past attendance | e2e 8 (time away removed; confirmed *Absent* unchanged) | ✅ |
| Unauthorized visitors can't access roster, portraits, API, exports | integration (signed-out + uninvited account see nothing in all 8 tables, portraits refused, public URL refused), e2e 15 | ✅ |
| Non-admin can't grant themselves admin | integration + e2e 15 (direct API call rejected; invite endpoint 403; admin screen hidden) | ✅ |
| Refresh, simultaneous edits, slow connections, failed saves, sign-out/in | e2e 11–14 (stale edit rejected with message and newer correction kept; "Saving…" shown and no success before server; failed save shows "Not saved"; offline refused; direct link + refresh; sign-out/in) | ✅ |
| Production address and records survive redeploy | full rebuild + restart: record counts identical; same URL; direct links 200 | ✅ (locally; see below) |
| Narrow phone & desktop layouts | screenshots at 390 px and 1280 px; no horizontal scroll at 320 px on all 9 screens (one overflow found and fixed) | ✅ |
| Backup and restore | `scripts/backup.sh` produced roles/schema/data; data restored exactly (99/46/169/11 rows) | ✅ (data-level restore) |
| DST handling | unit tests on both 2026 switch days, the ambiguous fall-back hour, and late-evening dates | ✅ |
| CSV totals match screen | e2e 16 with non-zero data, plus with a reason filter | ✅ |

### Bugs found and fixed during verification
1. **Sign-in email sent a link, not a code**: Supabase keeps its default template until the custom one is applied. Setup step 4 now makes this explicit.
2. **A brief signal drop could replace the whole app with "Can't connect"**, even with data loaded. The app now keeps the loaded data, shows a notice, and retries automatically.
3. **A load error said "Nothing was saved"** when nothing was being saved. Reworded.
4. **Fellows page scrolled sideways on 320 px-wide phones.** Fixed.
5. **A shell quoting bug in the backup script.** Fixed and re-run.

## What was NOT verified (be aware)

- **A real iPhone and the real Home Screen app.** Playwright emulates an iPhone viewport in Chromium; it is not Safari/WebKit on iOS. Safari's separate storage for Home Screen apps is documented Apple behavior, and the code-based sign-in was chosen for it. **Please test on an actual iPhone (setup step 9).**
- **Hosted deployment.** No Vercel or hosted Supabase account was available here, so **there is no production link yet**. Nothing was deployed, and no link has been invented.
- **Real email delivery** (spam filtering, SPF/DKIM) through your SMTP provider.
- **The 15-second target with a real person.** The automated flow (open → reason → save) took under a second plus the server round-trip. It takes 3 taps when the event and Fellow are pre-selected, 4 when staff pick a Fellow. A human hasn't been timed.
- **Supabase's dashboard restore** of Pro daily backups (a paid feature).
- **Screen-reader testing.** The app uses native dialogs, labeled controls, visible focus and text labels next to colors, but it hasn't been audited with VoiceOver.

## Re-running the checks

```bash
npm install
npm i -D playwright && npx playwright install chromium   # for the e2e script
npx supabase start            # needs Docker
npx supabase db reset
npm test && npm run test:live
npm run build && npm start -- -p 3200   # with .env.local pointing at the local stack
npx supabase db reset && npm run e2e
```
