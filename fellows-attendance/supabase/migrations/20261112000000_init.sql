-- Fellows Attendance — initial schema
-- ---------------------------------------------------------------------------
-- Design notes
--  * A user ACCOUNT (public.members) is different from a FELLOW PROFILE
--    (public.fellows). Staff have accounts but are never counted as Fellows.
--  * Totals are never stored. The app derives them from authoritative rows
--    (events, attendance, time_away, event_plans).
--  * Every editable row has a `version`. An update must carry the version it
--    was based on; a stale version is rejected ("stale_version") so a newer
--    correction is never silently overwritten.
--  * Who-changed-what is stamped by triggers from the signed-in user
--    (auth.uid()), never from values the browser sends.
--  * Row Level Security enforces permissions in the database itself.
-- ---------------------------------------------------------------------------

create extension if not exists pgcrypto;
create schema if not exists private;
grant usage on schema private to authenticated;

-- ===========================================================================
-- Tables
-- ===========================================================================

create table public.fellows (
  id              uuid primary key default gen_random_uuid(),
  display_name    text not null check (length(btrim(display_name)) between 1 and 80),
  agency          text check (agency is null or length(agency) <= 120),
  photo_path      text,
  sort_order      int  not null default 0,
  -- Eligibility window. Events outside it do not count for this Fellow.
  -- Ending a Fellow's eligibility (instead of deleting) keeps history intact.
  eligible_from   date,
  eligible_until  date,
  is_placeholder  boolean not null default false,
  version         int not null default 1,
  created_at      timestamptz not null default now(),
  created_by      uuid,
  updated_at      timestamptz not null default now(),
  updated_by      uuid,
  check (eligible_until is null or eligible_from is null or eligible_until >= eligible_from)
);

create table public.members (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  email         text not null,
  display_name  text not null check (length(btrim(display_name)) between 1 and 80),
  kind          text not null check (kind in ('fellow', 'staff')),
  fellow_id     uuid unique references public.fellows(id) on delete set null,
  role          text not null default 'member' check (role in ('member', 'admin')),
  active        boolean not null default true,
  version       int not null default 1,
  created_at    timestamptz not null default now(),
  created_by    uuid,
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  check (kind = 'fellow' or fellow_id is null)
);

create table public.reasons (
  id          uuid primary key default gen_random_uuid(),
  label       text not null check (length(btrim(label)) between 1 and 60),
  sort_order  int not null default 0,
  active      boolean not null default true,
  version     int not null default 1,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

create table public.settings (
  id                        int primary key default 1 check (id = 1),
  program_name              text not null default 'Fellows Attendance',
  class_label               text not null default 'Class of 2026–2027',
  warning_threshold         int  not null default 3 check (warning_threshold between 1 and 50),
  threshold_is_provisional  boolean not null default true,
  primary_owner_id          uuid references public.members(user_id) on delete set null,
  backup_owner_id           uuid references public.members(user_id) on delete set null,
  version                   int not null default 1,
  created_at                timestamptz not null default now(),
  created_by                uuid,
  updated_at                timestamptz not null default now(),
  updated_by                uuid
);

create table public.events (
  id                   uuid primary key default gen_random_uuid(),
  title                text not null check (length(btrim(title)) between 1 and 140),
  event_type           text not null check (event_type in ('speaker_series', 'program_event', 'travel', 'other')),
  starts_at            timestamptz not null,
  ends_at              timestamptz not null,
  -- Calendar date in America/New_York; maintained by trigger.
  local_date           date not null default '1970-01-01',
  speaker              text check (speaker is null or length(speaker) <= 140),
  location             text check (location is null or length(location) <= 140),
  description          text check (description is null or length(description) <= 1000),
  attendance_required  boolean not null default true,
  status               text not null default 'scheduled' check (status in ('scheduled', 'canceled')),
  needs_review         boolean not null default false,
  series_id            uuid,
  version              int not null default 1,
  created_at           timestamptz not null default now(),
  created_by           uuid,
  updated_at           timestamptz not null default now(),
  updated_by           uuid,
  check (ends_at > starts_at)
);
create index events_local_date_idx on public.events (local_date);

-- A date range when a Fellow expects to be away (e.g. military training).
-- Saved even if no events exist yet; it applies to events added later.
create table public.time_away (
  id          uuid primary key default gen_random_uuid(),
  fellow_id   uuid not null references public.fellows(id) on delete restrict,
  start_date  date not null,
  end_date    date not null,
  reason_id   uuid references public.reasons(id),
  note        text check (note is null or length(note) <= 280),
  removed_at  timestamptz,           -- soft removal keeps history and allows restore
  version     int not null default 1,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  check (end_date >= start_date)
);
create index time_away_fellow_idx on public.time_away (fellow_id);

-- Single-event plans: either a planned absence for one event, or an
-- exception ("will attend") inside a longer time-away range.
create table public.event_plans (
  fellow_id   uuid not null references public.fellows(id) on delete restrict,
  event_id    uuid not null references public.events(id) on delete restrict,
  kind        text not null check (kind in ('absent', 'attending')),
  reason_id   uuid references public.reasons(id),
  note        text check (note is null or length(note) <= 280),
  version     int not null default 1,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  primary key (fellow_id, event_id)
);

-- Confirmed attendance for an event that has started.
-- Exactly ONE current row per Fellow per event (primary key).
create table public.attendance (
  fellow_id     uuid not null references public.fellows(id) on delete restrict,
  event_id      uuid not null references public.events(id) on delete restrict,
  status        text not null check (status in ('present', 'absent', 'not_recorded')),
  reason_id     uuid references public.reasons(id),
  note          text check (note is null or length(note) <= 280),
  marked_via    text not null default 'individual' check (marked_via in ('individual', 'mark_remaining_present')),
  version       int not null default 1,
  created_at    timestamptz not null default now(),
  created_by    uuid,
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  primary key (fellow_id, event_id),
  check (status = 'absent' or reason_id is null)
);
create index attendance_event_idx on public.attendance (event_id);

-- Append-only change history. Written only by triggers.
create table public.audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor_id    uuid,
  actor_name  text,
  table_name  text not null,
  action      text not null,
  record_id   text not null,
  fellow_id   uuid,
  event_id    uuid,
  before      jsonb,
  after       jsonb
);
create index audit_log_at_idx on public.audit_log (at desc);
create index audit_log_fellow_idx on public.audit_log (fellow_id, at desc);
create index audit_log_event_idx on public.audit_log (event_id, at desc);

-- ===========================================================================
-- Helper functions (private schema: not callable through the public API)
-- ===========================================================================

create or replace function private.is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members m where m.user_id = auth.uid() and m.active);
$$;

create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members m where m.user_id = auth.uid() and m.active and m.role = 'admin');
$$;

grant execute on function private.is_member() to authenticated;
grant execute on function private.is_admin() to authenticated;

-- Stamps editor identity/time and enforces optimistic concurrency.
create or replace function private.stamp_row() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.version    := 1;
    new.created_at := now();
    new.created_by := auth.uid();
    new.updated_at := now();
    new.updated_by := auth.uid();
  else
    if new.version is distinct from old.version then
      raise exception 'stale_version' using errcode = 'P0001',
        hint = 'This record was changed by someone else. Reload and try again.';
    end if;
    new.version    := old.version + 1;
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.updated_at := now();
    new.updated_by := auth.uid();
  end if;
  return new;
end $$;

-- Writes one audit row per insert/update/delete.
create or replace function private.write_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  r_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  r     jsonb := coalesce(r_new, r_old);
  rid   text;
  v_name text;
begin
  -- Skip no-op updates (only bookkeeping columns changed).
  if tg_op = 'UPDATE' and (r_old - array['version','updated_at','updated_by'])
                        = (r_new - array['version','updated_at','updated_by']) then
    return null;
  end if;

  rid := coalesce(r->>'id', r->>'user_id', (r->>'fellow_id') || ':' || (r->>'event_id'));
  select m.display_name into v_name from public.members m where m.user_id = auth.uid();

  insert into public.audit_log (actor_id, actor_name, table_name, action, record_id, fellow_id, event_id, before, after)
  values (
    auth.uid(),
    coalesce(v_name, case when auth.uid() is null then 'System' else 'Unknown user' end),
    tg_table_name, lower(tg_op), rid,
    case when tg_table_name = 'fellows' then (r->>'id')::uuid else (r->>'fellow_id')::uuid end,
    case when tg_table_name = 'events'  then (r->>'id')::uuid else (r->>'event_id')::uuid end,
    r_old, r_new
  );
  return null;
end $$;

-- Events: keep local_date in America/New_York; flag reschedules that touch recorded attendance.
create or replace function private.events_before_write() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.local_date := (new.starts_at at time zone 'America/New_York')::date;
  if tg_op = 'UPDATE'
     and (new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at)
     and exists (select 1 from public.attendance a where a.event_id = new.id and a.status <> 'not_recorded') then
    new.needs_review := true;
  end if;
  return new;
end $$;

-- Owners must be active admins.
create or replace function private.settings_check_owners() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.primary_owner_id is not null and not exists (
      select 1 from public.members m where m.user_id = new.primary_owner_id and m.active and m.role = 'admin') then
    raise exception 'owner_must_be_admin' using errcode = 'P0001';
  end if;
  if new.backup_owner_id is not null and not exists (
      select 1 from public.members m where m.user_id = new.backup_owner_id and m.active and m.role = 'admin') then
    raise exception 'owner_must_be_admin' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- Never leave the app without an active administrator; keep owners valid.
create or replace function private.members_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.members m where m.active and m.role = 'admin') then
    raise exception 'last_admin' using errcode = 'P0001',
      hint = 'At least one active administrator is required.';
  end if;
  if exists (select 1 from public.settings s
             left join public.members p on p.user_id = s.primary_owner_id
             left join public.members b on b.user_id = s.backup_owner_id
             where (s.primary_owner_id is not null and (not p.active or p.role <> 'admin'))
                or (s.backup_owner_id  is not null and (not b.active or b.role <> 'admin'))) then
    raise exception 'owner_must_be_admin' using errcode = 'P0001',
      hint = 'Transfer ownership before removing this person''s admin access.';
  end if;
  return null;
end $$;

-- Attendance/plans must reference a Fellow who is eligible on the event date.
create or replace function private.check_fellow_eligible() returns trigger
language plpgsql set search_path = '' as $$
declare d date; f record;
begin
  select e.local_date into d from public.events e where e.id = new.event_id;
  select * into f from public.fellows where id = new.fellow_id;
  if (f.eligible_from is not null and d < f.eligible_from)
     or (f.eligible_until is not null and d > f.eligible_until) then
    raise exception 'fellow_not_eligible' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- ===========================================================================
-- Triggers
-- ===========================================================================

do $$
declare t text;
begin
  foreach t in array array['fellows','members','reasons','settings','events','time_away','event_plans','attendance'] loop
    execute format('create trigger stamp before insert or update on public.%I for each row execute function private.stamp_row()', t);
    execute format('create trigger audit after insert or update or delete on public.%I for each row execute function private.write_audit()', t);
  end loop;
end $$;

create trigger events_before_write before insert or update on public.events
  for each row execute function private.events_before_write();
create trigger settings_owners before insert or update on public.settings
  for each row execute function private.settings_check_owners();
create trigger members_guard after update or delete on public.members
  for each statement execute function private.members_guard();
create trigger attendance_eligible before insert or update on public.attendance
  for each row execute function private.check_fellow_eligible();
create trigger plans_eligible before insert or update on public.event_plans
  for each row execute function private.check_fellow_eligible();

-- ===========================================================================
-- Row Level Security
-- ===========================================================================

alter table public.fellows     enable row level security;
alter table public.members     enable row level security;
alter table public.reasons     enable row level security;
alter table public.settings    enable row level security;
alter table public.events      enable row level security;
alter table public.time_away   enable row level security;
alter table public.event_plans enable row level security;
alter table public.attendance  enable row level security;
alter table public.audit_log   enable row level security;

-- Nobody signed-out gets anything.
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;

-- Read access: every active invited member.
create policy "members read fellows"    on public.fellows     for select to authenticated using (private.is_member());
create policy "members read reasons"    on public.reasons     for select to authenticated using (private.is_member());
create policy "members read settings"   on public.settings    for select to authenticated using (private.is_member());
create policy "members read events"     on public.events      for select to authenticated using (private.is_member());
create policy "members read time away"  on public.time_away   for select to authenticated using (private.is_member());
create policy "members read plans"      on public.event_plans for select to authenticated using (private.is_member());
create policy "members read attendance" on public.attendance  for select to authenticated using (private.is_member());
create policy "members read audit"      on public.audit_log   for select to authenticated using (private.is_member());
-- Accounts: you can see your own row (even if deactivated); admins see all.
create policy "read own account or admin" on public.members for select to authenticated
  using (user_id = auth.uid() or private.is_admin());

-- Shared editing: every active member (Fellows and staff).
create policy "members add events"      on public.events      for insert to authenticated with check (private.is_member());
create policy "members edit events"     on public.events      for update to authenticated using (private.is_member()) with check (private.is_member());
create policy "members add time away"   on public.time_away   for insert to authenticated with check (private.is_member());
create policy "members edit time away"  on public.time_away   for update to authenticated using (private.is_member()) with check (private.is_member());

-- Administration: admins only.
create policy "admins add fellows"     on public.fellows  for insert to authenticated with check (private.is_admin());
create policy "admins edit fellows"    on public.fellows  for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy "admins add reasons"     on public.reasons  for insert to authenticated with check (private.is_admin());
create policy "admins edit reasons"    on public.reasons  for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy "admins edit settings"   on public.settings for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy "admins add members"     on public.members  for insert to authenticated with check (private.is_admin());
create policy "admins edit members"    on public.members  for update to authenticated using (private.is_admin()) with check (private.is_admin());

-- Table privileges (RLS still applies on top of these).
revoke all on all tables in schema public from authenticated;
grant select on public.fellows, public.reasons, public.settings, public.events, public.time_away,
                public.event_plans, public.attendance, public.audit_log, public.members to authenticated;
grant insert, update on public.events, public.time_away,
                        public.fellows, public.reasons, public.members to authenticated;
grant update on public.settings to authenticated;
-- attendance and event_plans: written ONLY through the save functions below,
-- so their rules (one record per Fellow per event, no "absent" before an
-- event starts, conflict checks) cannot be bypassed.
-- audit_log: read only. No insert/update/delete for any API role.

-- ===========================================================================
-- Save functions (RPC). They check membership explicitly, then write as the
-- table owner. Editor identity still comes from auth.uid() (the signed-in user).
-- They are idempotent: repeating the same save changes nothing.
-- ===========================================================================

create or replace function public.record_attendance(
  p_fellow_id uuid, p_event_id uuid, p_status text,
  p_reason_id uuid default null, p_note text default null,
  p_expected_version int default null
) returns public.attendance
language plpgsql security definer set search_path = '' as $$
declare ev public.events; cur public.attendance; res public.attendance;
begin
  if not private.is_member() then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p_status not in ('present', 'absent', 'not_recorded') then raise exception 'bad_status'; end if;
  if p_status = 'absent' and p_reason_id is null then raise exception 'reason_required' using errcode = 'P0001'; end if;

  select * into ev from public.events where id = p_event_id;
  if not found then raise exception 'event_not_found' using errcode = 'P0001'; end if;
  if ev.status = 'canceled' then raise exception 'event_canceled' using errcode = 'P0001'; end if;
  if ev.starts_at > now() then raise exception 'event_not_started' using errcode = 'P0001',
    hint = 'This event has not started yet. Save a planned absence instead.'; end if;

  if p_status <> 'absent' then p_reason_id := null; end if;
  p_note := nullif(btrim(coalesce(p_note, '')), '');
  if p_status = 'not_recorded' then p_note := null; end if;

  select * into cur from public.attendance where fellow_id = p_fellow_id and event_id = p_event_id for update;

  if found then
    -- Same values already saved (e.g. a repeated tap): return without changes.
    if cur.status = p_status and cur.reason_id is not distinct from p_reason_id and cur.note is not distinct from p_note then
      return cur;
    end if;
    if p_expected_version is distinct from cur.version then
      raise exception 'stale_version' using errcode = 'P0001',
        hint = 'Someone else changed this record. Reload and try again.';
    end if;
    update public.attendance
       set status = p_status, reason_id = p_reason_id, note = p_note, marked_via = 'individual', version = cur.version
     where fellow_id = p_fellow_id and event_id = p_event_id
    returning * into res;
  else
    if p_expected_version is not null then
      raise exception 'stale_version' using errcode = 'P0001';
    end if;
    begin
      insert into public.attendance (fellow_id, event_id, status, reason_id, note)
      values (p_fellow_id, p_event_id, p_status, p_reason_id, p_note)
      returning * into res;
    exception when unique_violation then
      -- Two saves raced; the other one won. Report a conflict rather than overwrite.
      raise exception 'stale_version' using errcode = 'P0001';
    end;
  end if;
  return res;
end $$;

-- Explicit editor action: mark every listed Fellow that is still "Not recorded" as present.
create or replace function public.mark_remaining_present(p_event_id uuid, p_fellow_ids uuid[])
returns int
language plpgsql security definer set search_path = '' as $$
declare ev public.events; n int := 0; fid uuid; cur public.attendance;
begin
  if not private.is_member() then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into ev from public.events where id = p_event_id;
  if not found then raise exception 'event_not_found' using errcode = 'P0001'; end if;
  if ev.status = 'canceled' then raise exception 'event_canceled' using errcode = 'P0001'; end if;
  if ev.starts_at > now() then raise exception 'event_not_started' using errcode = 'P0001'; end if;

  foreach fid in array p_fellow_ids loop
    select * into cur from public.attendance where fellow_id = fid and event_id = p_event_id for update;
    if not found then
      insert into public.attendance (fellow_id, event_id, status, marked_via)
      values (fid, p_event_id, 'present', 'mark_remaining_present')
      on conflict do nothing;
      if found then n := n + 1; end if;
    elsif cur.status = 'not_recorded' then
      update public.attendance set status = 'present', marked_via = 'mark_remaining_present', version = cur.version
       where fellow_id = fid and event_id = p_event_id;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- Single-event plan: p_kind = 'absent' | 'attending' | null (remove plan).
create or replace function public.set_event_plan(
  p_fellow_id uuid, p_event_id uuid, p_kind text,
  p_reason_id uuid default null, p_note text default null,
  p_expected_version int default null
) returns public.event_plans
language plpgsql security definer set search_path = '' as $$
declare ev public.events; cur public.event_plans; res public.event_plans;
begin
  if not private.is_member() then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p_kind is not null and p_kind not in ('absent', 'attending') then raise exception 'bad_kind'; end if;
  if p_kind = 'absent' and p_reason_id is null then raise exception 'reason_required' using errcode = 'P0001'; end if;

  select * into ev from public.events where id = p_event_id;
  if not found then raise exception 'event_not_found' using errcode = 'P0001'; end if;
  if ev.starts_at <= now() then raise exception 'event_started' using errcode = 'P0001',
    hint = 'This event has started. Record actual attendance instead.'; end if;

  if p_kind <> 'absent' then p_reason_id := null; end if;
  p_note := nullif(btrim(coalesce(p_note, '')), '');

  select * into cur from public.event_plans where fellow_id = p_fellow_id and event_id = p_event_id for update;

  if p_kind is null then
    if not found then return null; end if;                      -- already removed
    if p_expected_version is distinct from cur.version then
      raise exception 'stale_version' using errcode = 'P0001';
    end if;
    delete from public.event_plans where fellow_id = p_fellow_id and event_id = p_event_id;
    return null;
  end if;

  if found then
    if cur.kind = p_kind and cur.reason_id is not distinct from p_reason_id and cur.note is not distinct from p_note then
      return cur;
    end if;
    if p_expected_version is distinct from cur.version then
      raise exception 'stale_version' using errcode = 'P0001';
    end if;
    update public.event_plans set kind = p_kind, reason_id = p_reason_id, note = p_note, version = cur.version
     where fellow_id = p_fellow_id and event_id = p_event_id
    returning * into res;
  else
    if p_expected_version is not null then
      raise exception 'stale_version' using errcode = 'P0001';
    end if;
    begin
      insert into public.event_plans (fellow_id, event_id, kind, reason_id, note)
      values (p_fellow_id, p_event_id, p_kind, p_reason_id, p_note)
      returning * into res;
    exception when unique_violation then
      raise exception 'stale_version' using errcode = 'P0001';
    end;
  end if;
  return res;
end $$;

-- Names of people who appear in "changed by" labels. Members only.
create or replace function public.member_directory()
returns table (user_id uuid, display_name text, kind text, fellow_id uuid, role text, active boolean)
language sql stable security definer set search_path = '' as $$
  select m.user_id, m.display_name, m.kind, m.fellow_id, m.role, m.active
  from public.members m
  where private.is_member();
$$;

revoke all on function public.record_attendance(uuid, uuid, text, uuid, text, int) from public, anon;
revoke all on function public.mark_remaining_present(uuid, uuid[]) from public, anon;
revoke all on function public.set_event_plan(uuid, uuid, text, uuid, text, int) from public, anon;
revoke all on function public.member_directory() from public, anon;
grant execute on function public.record_attendance(uuid, uuid, text, uuid, text, int) to authenticated;
grant execute on function public.mark_remaining_present(uuid, uuid[]) to authenticated;
grant execute on function public.set_event_plan(uuid, uuid, text, uuid, text, int) to authenticated;
grant execute on function public.member_directory() to authenticated;

-- One-time setup, run by the owner in the Supabase SQL editor (not callable from the app):
--   select public.bootstrap_first_admin('owner@example.org', 'Your Name');
create or replace function public.bootstrap_first_admin(p_email text, p_name text)
returns text
language plpgsql security definer set search_path = '' as $$
declare uid uuid;
begin
  if exists (select 1 from public.members) then
    raise exception 'Members already exist. Use the Admin screen to invite people.';
  end if;
  select id into uid from auth.users where lower(email) = lower(btrim(p_email));
  if uid is null then
    raise exception 'No user with that email. First add the user under Authentication → Users.';
  end if;
  insert into public.members (user_id, email, display_name, kind, role)
  values (uid, lower(btrim(p_email)), btrim(p_name), 'staff', 'admin');
  update public.settings set primary_owner_id = uid, version = version where id = 1;
  return 'Administrator created. You can now sign in.';
end $$;
revoke all on function public.bootstrap_first_admin(text, text) from public, anon, authenticated;

-- ===========================================================================
-- Portrait storage (private bucket)
-- ===========================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('portraits', 'portraits', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "members view portraits" on storage.objects for select to authenticated
  using (bucket_id = 'portraits' and private.is_member());
create policy "admins upload portraits" on storage.objects for insert to authenticated
  with check (bucket_id = 'portraits' and private.is_admin());
create policy "admins replace portraits" on storage.objects for update to authenticated
  using (bucket_id = 'portraits' and private.is_admin()) with check (bucket_id = 'portraits' and private.is_admin());
create policy "admins delete portraits" on storage.objects for delete to authenticated
  using (bucket_id = 'portraits' and private.is_admin());

-- ===========================================================================
-- Live updates
-- ===========================================================================

alter publication supabase_realtime add table
  public.fellows, public.events, public.time_away, public.event_plans,
  public.attendance, public.reasons, public.settings;

-- ===========================================================================
-- Starter data (placeholders, not real people)
-- ===========================================================================

insert into public.settings (id) values (1);

insert into public.reasons (label, sort_order) values
  ('Military training/duty', 1),
  ('Placement work obligation', 2),
  ('Illness', 3),
  ('Personal/family', 4),
  ('Travel', 5),
  ('Other', 6);

insert into public.fellows (display_name, sort_order, is_placeholder)
select format('Fellow %s', lpad(n::text, 2, '0')), n, true
from generate_series(1, 11) as n;
