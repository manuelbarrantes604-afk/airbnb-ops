# Fellows Attendance

A shared attendance tracker for a class of Fellows and program staff: a Speaker Series calendar, planned time away, confirmed absences, corrections with full history, and simple reports. It works on iPhone (it can be added to the Home Screen) and on desktop.

> Not an official government system. Uses no seals or official marks.

- **Going live (non-developers start here):** [docs/SETUP.md](docs/SETUP.md)
- **Owner handoff, costs, backups:** [docs/HANDOFF.md](docs/HANDOFF.md)
- **What was tested:** [docs/VERIFICATION.md](docs/VERIFICATION.md)

## How it works

```
 iPhone / desktop browser ──HTTPS──▶  Vercel (Next.js app, stable address)
          │                                  │  /api/admin/invite (server-only, uses secret key)
          └──── signed-in requests ────────▶ Supabase
                                              ├─ Postgres + row-level security (who can do what)
                                              ├─ save functions (no duplicates, conflict checks)
                                              ├─ triggers: editor stamp + append-only history
                                              ├─ Auth: invite-only, 6-digit email codes
                                              ├─ Storage: private portraits bucket
                                              └─ Realtime: other screens update live
```

- **Accounts ≠ Fellows.** `members` are people who can sign in (Fellows or staff); `fellows` is the roster that attendance is about. Staff never count in totals.
- **Totals are never stored.** They're derived from records by one tested module (`src/lib/rules.ts`) that both the screens and the CSV exports use.
- **Planned vs actual.** Plans (`time_away` ranges, `event_plans`) are projections. Only a confirmed `attendance` row with status *absent* at a completed, required, non-canceled event counts as an "event missed". Unreviewed past events stay **Not recorded**.
- **Conflicts.** Every row has a `version`. A save based on an old version is rejected (`stale_version`), the screen reloads, and the person is told.

## Run it on your computer

```bash
npm install
npm run dev          # with no .env.local → clearly labeled DEMO with fictional data
```

With a local Supabase (needs Docker):

```bash
npx supabase start && npx supabase db reset
cp .env.example .env.local     # local keys printed by `supabase start`
npm run db:demo-seed           # optional fictional data
npm run dev
```

Sign-in codes for local accounts appear in the local mailbox at http://127.0.0.1:54324.

## Project layout

```
src/app/            screens: / (Overview), /calendar, /event, /fellows, /fellow, /reports, /history, /admin, /help
src/app/api/admin/invite/route.ts   the only server code (creates invited accounts)
src/components/     shell, sheets (Record absence, Plan time away, events), history
src/lib/rules.ts    counting rules (unit tested)
src/lib/time.ts     America/New_York date/time handling (DST-tested)
src/lib/backend/    supabase.ts (live) and demo.ts (fictional, browser-only)
supabase/migrations/   schema, permissions, triggers, save functions, starter placeholders
supabase/demo-seed.sql fictional demo data (local/test databases only)
supabase/templates/    sign-in code email
tests/              unit + live-database integration tests
e2e/                end-to-end script (real local Supabase, two devices)
scripts/            build-demo.sh, backup.sh
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `npm run build` / `npm start` | develop / build / serve |
| `npm test` | unit tests (rules, time zones, CSV) |
| `npm run test:live` | permission and rule tests against local Supabase (resets it) |
| `npm run e2e` | end-to-end checks against a running app + local Supabase |
| `npm run build:demo` | static fictional demo into `out/` |
| `npm run db:demo-seed` | load fictional data into the **local** database |
