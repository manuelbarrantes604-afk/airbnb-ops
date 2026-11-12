# Owner handoff

For the VOPS committee's **primary owner** and **backup owner**.

## What exists and who should own it

| Piece | Where | Owner should control |
|---|---|---|
| Source code | Private GitHub repository (e.g. `fellows-attendance`) | Committee GitHub account/organization; backup owner added as admin |
| Website | Vercel project → stable `https://<name>.vercel.app` | Committee Vercel account (backup owner invited to the team, if on a paid team) |
| Database, sign-in, portraits | Supabase project | Committee Supabase organization; backup owner invited as **Owner** |
| Sign-in emails | Your email provider (SMTP) + domain DNS | Committee account; the domain owner |
| Passwords and keys | Password manager | Shared vault between primary and backup owner |

No AI service, laptop or temporary link is needed for the app to run. Updates are made by pushing code to GitHub; Vercel redeploys automatically and the address stays the same. Records live in Supabase and are untouched by redeploys (this was tested).

## Costs and availability (checked November 2026; confirm on the providers' pages)

**Supabase** ([pricing](https://supabase.com/pricing))
- **Free, $0:** projects are **paused after 1 week without activity**. Someone has to restore a paused project in the dashboard, and the app is down until then. That matters over breaks. **No automatic backups.** Limit of 2 active free projects.
- **Pro, from $25/month:** **not paused**, **daily backups kept 7 days**, 8 GB database, 100 GB file storage. Point-in-time recovery is a paid add-on.
- This app's data is tiny: 11 Fellows and a few hundred events is a few megabytes.

**Vercel** ([pricing](https://vercel.com/pricing))
- **Hobby, $0:** described by Vercel as for "personal, non-commercial use." A class tracker run by a committee may not fit that description; the committee should decide.
- **Pro, $20/month:** intended for professional and business use; includes usage credit with pay-as-you-go beyond it.

**Email for sign-in codes** ([Supabase guide](https://supabase.com/docs/guides/auth/auth-smtp))
- Supabase's built-in sender only sends **2 emails per hour**, and only to members of your Supabase team. It has no delivery guarantee. **A custom SMTP provider is required.** Many have free tiers that cover a class of ~20; check current terms.
- Set up SPF/DKIM DNS records with your provider, or codes may land in spam.

**Recommended for dependable use:** Supabase Pro + Vercel Pro + an email provider's free tier ≈ **$45/month**. A cheaper option that works with more risk: both free plans, plus manual weekly backups and someone checking that the project isn't paused.

No service can promise zero downtime. Supabase and Vercel publish status pages (status.supabase.com, vercel-status.com).

## Recurring duties

- **Weekly:** look at **Overview → Past events to review** so "Not recorded" doesn't pile up.
- **Monthly:** confirm the backup exists (Pro: Supabase → Database → Backups; Free: run the manual backup below).
- **Each term:** review People & access. Remove people who left (use **Remove access**; their history stays).
- **Yearly / new class:** set the departing class's **Last day on roster**, add the new Fellows, and change the class label. Past records and totals stay correct.
- Keep payment details current. A lapsed card can downgrade or pause a project.

## Backups and restore

A CSV export is **not** a backup: it's a report. A real backup contains all tables, history and accounts.

- **Supabase Pro:** daily backups are automatic (7 days). Restore from Supabase → Database → Backups.
- **Manual backup (any plan), tested here:** with Node.js and Docker installed,
  ```bash
  SUPABASE_DB_URL='<connection string from Supabase → Connect → Session pooler>' ./scripts/backup.sh
  ```
  This writes `backups/<date>/roles.sql`, `schema.sql` and `data.sql`. Store them privately: they contain everyone's records.
- **Portrait photos are not in those files.** Download the `portraits` bucket from Supabase → Storage, or simply keep the originals.
- **Restore** (into a *new, empty* Supabase project) follows Supabase's official guide: <https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore>
  ```bash
  psql --single-transaction --variable ON_ERROR_STOP=1 \
    --file roles.sql --file schema.sql \
    --command 'SET session_replication_role = replica' \
    --file data.sql --dbname '<new project connection string>'
  ```
  Then point Vercel's environment variables at the new project and redeploy. During verification, a data restore brought back every record exactly (99 attendance rows, 46 events, 169 history entries).

## Transferring responsibility

1. In the app: **Administration → People & access**, make the new person an **administrator**. Then **Ownership & settings**, set them as primary (or backup) owner.
2. **GitHub:** add them as repository admin, or transfer the repository (Settings → Danger zone → Transfer).
3. **Supabase:** Organization → Team → invite them as **Owner**. Billing is on the organization.
4. **Vercel:** invite them to the team, or transfer the project (Settings → General → Transfer).
5. **Email provider and domain:** add them as an account owner.
6. Hand over the password-manager vault, then remove the previous owner's access where appropriate.

The database refuses to leave the app without an administrator, and refuses an owner who isn't an active administrator.

## Security notes

- Every table is protected by database row-level security. Signed-out visitors and uninvited accounts get no data (tested).
- Only administrators can invite people, change roles, edit the roster, settings or reasons. A non-administrator cannot make themselves an administrator (tested).
- Attendance and plans can only be written through checked database functions. Editor identity always comes from the signed-in account, never from the browser.
- Change history is written by the database itself and can't be edited or deleted through the app or API.
- Portraits are in a private bucket and are shown through short-lived signed links.
- The only secret (`SUPABASE_SECRET_KEY`) lives in Vercel's server environment. It is never sent to browsers and never stored in the repository.
- Reasons and notes are visible to everyone invited. The app says so wherever notes are entered, and asks people not to include medical details.
