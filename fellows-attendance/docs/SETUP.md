# Setup guide — going live

Written for someone who is not a developer. Follow the steps in order. Plan for about **1.5–2 hours**, plus waiting for an email provider to verify your domain.

**Who should do this:** the person the VOPS committee names as **primary owner**, signed in with accounts the committee controls. Use a committee or role mailbox if possible (for example `vops-tracker@…`), not a personal address that might leave with one person.

**Never paste these anywhere public, and never put them in GitHub:**
- the Supabase **database password**
- the Supabase **secret key** (starts with `sb_secret_`)
- your email provider's SMTP password or API key

Keep them in a password manager. The only place the secret key is entered is Vercel's "Environment Variables" screen (step 6).

---

## 0. Before you start

You need:
1. A **GitHub** account owned by the committee (free).
2. A **Supabase** account (supabase.com), signed up with the committee email.
3. A **Vercel** account (vercel.com), signed up with the same GitHub account.
4. An **email-sending service** for the sign-in codes, such as Resend, Postmark, Amazon SES or SendGrid. Most offer a free tier that easily covers ~20 people; check each provider's current terms. You'll need to prove you own a domain by adding DNS records. If nobody on the committee controls a domain, ask your program's IT contact.

## 1. Put the code in a repository the committee owns

The code currently sits in the folder `fellows-attendance/` of a personal repository (`airbnb-ops`). It should live in its own repository owned by the committee.

1. In GitHub, create a **new private repository**, for example `fellows-attendance`, under the committee's account or organization. Leave it empty.
2. Ask any developer to run the commands below (about 2 minutes). Or start a new Claude Code session with that repository attached and ask Claude to copy the folder in.
   ```bash
   git clone https://github.com/manuelbarrantes604-afk/airbnb-ops.git
   cd airbnb-ops && git checkout claude/fellows-attendance-tracker-vm89hx
   cp -r fellows-attendance ../fellows-attendance-new && cd ../fellows-attendance-new
   git init && git add . && git commit -m "Fellows Attendance initial import"
   git branch -M main
   git remote add origin https://github.com/<OWNER>/fellows-attendance.git
   git push -u origin main
   ```

## 2. Create the Supabase project (database, sign-in, photos)

1. In Supabase, click **New project**.
   - Organization: the committee's organization.
   - Name: `fellows-attendance`.
   - **Database password:** click *Generate*, then **save it in your password manager**.
   - Region: **East US (North Virginia)**, closest to Washington, DC.
2. Choose a plan. See **docs/HANDOFF.md → Costs**. Short version: Free projects pause after 7 days without activity and have no automatic backups. **Pro ($25/month) is recommended for real use.**
3. Wait for the project to finish starting (about 2 minutes).

## 3. Create the database tables and permissions

1. In your Supabase project, open **SQL Editor** → **New query**.
2. Open the file `supabase/migrations/20261112000000_init.sql` from the repository on GitHub. Click **Raw**, select all, copy.
3. Paste it into the SQL Editor and click **Run**. You should see "Success. No rows returned."
4. Check: open **Table Editor**. You should see tables such as `fellows` (with Fellow 01–Fellow 11), `events` and `attendance`.

> Do **not** run `supabase/demo-seed.sql` here. It contains fictional test data.

## 4. Configure sign-in

In Supabase, go to **Authentication**:

1. **Sign In / Providers** (or **Providers → Email**):
   - Turn **"Allow new users to sign up" OFF**. This makes the tracker invitation-only.
   - Keep **Email** enabled. "Confirm email" can stay on.
   - Email OTP expiration: `3600` seconds (1 hour) is fine.
2. **Emails → Templates → "Magic Link"** (Supabase uses this template for sign-in codes):
   - Subject: `Your Fellows Attendance sign-in code`
   - Body: paste the full contents of `supabase/templates/sign-in-code.html`.
   - **This step is required.** The default template sends a link instead of a code. Links open Safari, not the Home Screen app. *(I confirmed this during testing: the default template sent a link with no code.)*
3. **Emails → SMTP Settings**: turn on **custom SMTP** and enter your email provider's details (host, port, username, password, sender address such as `no-reply@yourdomain`). **Required.** Supabase's built-in email sends only **2 emails per hour**, and only to members of your Supabase team. Then open **Rate Limits** and set emails per hour to about `30`.
4. **URL Configuration**: you'll set the Site URL after step 6.

## 5. Create the first administrator (the owner)

1. **Authentication → Users → Add user → Create new user**: enter the owner's email and tick **Auto Confirm User**. The password field can be left empty or random; sign-in uses emailed codes.
2. **SQL Editor → New query**, paste, edit the email and name, then Run:
   ```sql
   select public.bootstrap_first_admin('owner@example.org', 'Your Name');
   ```
   You should see "Administrator created. You can now sign in." This only works once. Everyone else is invited from inside the app.

## 6. Put the app online with Vercel

1. In Vercel: **Add New… → Project → Import** your `fellows-attendance` GitHub repository.
2. Framework: Next.js (auto-detected). Root directory: leave as is, because the repository root *is* the app.
3. Open **Environment Variables** and add these three. Find the values in Supabase → **Project Settings → API Keys** (and **Data API** for the URL):

   | Name | Value | Notes |
   |---|---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://<your-project-ref>.supabase.co` | public |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | starts with `sb_publishable_` | public, safe in the browser |
   | `SUPABASE_SECRET_KEY` | starts with `sb_secret_` | **secret** (tick "Sensitive"). Only the server uses it, to create invited accounts. |

   *(Older projects show "anon" and "service_role" keys instead. Those also work: anon goes in the publishable slot, service_role in the secret slot.)*
4. Click **Deploy**. When it finishes, Vercel shows your address, such as `https://fellows-attendance.vercel.app`. **That address stays the same every time you update the app.**
5. Back in Supabase → **Authentication → URL Configuration**: set **Site URL** to that exact address. Add it under **Redirect URLs** too.

> Tip: deploy once **without** the three variables, and the site runs as the clearly labeled fictional **demo**. That's a safe way to preview it. Add the variables and click **Redeploy** to switch to the real database.

## 7. First sign-in and setup inside the app

1. Open your address on a computer and sign in with the owner email. A 6-digit code arrives by email.
2. **Menu → Administration**:
   - **Roster & portraits:** replace Fellow 01–11 with real names and optional placements. Upload portraits **only with each person's permission**.
   - **People & access → Invite person:** add each Fellow (linked to their roster profile) and each staff member. The app doesn't send invitation emails; tell people the address and that they sign in with their email.
   - **Ownership & settings:** choose the **primary and backup owners**. Both must be administrators, so make the backup an administrator first. Set the **warning threshold**, and mark it "Confirmed by program" once the committee agrees on a number. (The starting value of 3 is a provisional placeholder.)
   - **Absence reasons:** adjust the categories if the committee wants different ones.
3. **Calendar → Add repeating…:** create the Tuesday/Thursday Speaker Series. Untick holidays and dates that aren't real, then add other events one by one.

## 8. iPhone Home Screen

Share these steps with the class (they're also in the app under **Menu → Help & privacy**):
1. Open the address in **Safari**.
2. Tap **Share** → **Add to Home Screen** → **Add**.
3. Open **Attendance** from the Home Screen and sign in with the emailed code.

The Home Screen app keeps its own sign-in, separate from Safari, so people may sign in once in each.

## 9. Check that it works (10 minutes)

- [ ] Owner can sign in. A stranger's email gets no code, or sees "No access yet".
- [ ] A Fellow on an iPhone records a planned absence; staff on a laptop see it within seconds.
- [ ] Staff record an absence on a past event, tap **Undo absence**, and the total goes back down.
- [ ] **Menu → Change history** shows who made each change.
- [ ] Open a direct link to an event, pull to refresh, close and reopen the Home Screen app: still signed in.

## 10. Optional: custom domain

In Vercel → Project → **Settings → Domains**, add a name such as `attendance.yourdomain.org` and follow the DNS instructions. Then update Supabase **Site URL / Redirect URLs** to match. The `.vercel.app` address keeps working too.
