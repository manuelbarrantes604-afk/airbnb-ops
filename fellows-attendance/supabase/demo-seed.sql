-- FICTIONAL DEMO DATA — for a local or throwaway test database ONLY.
-- Never run this on the production project.
-- Load locally with:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/demo-seed.sql
-- It adds events, plans and attendance for the 11 placeholder Fellows.
-- Changes made here are logged as "System" in the change history.

do $$
declare
  d date;
  t date := (now() at time zone 'America/New_York')::date;
  n int := 0;
  topics text[] := array['Public Service Leadership','Budget & Appropriations','Diplomacy in Practice','Emergency Management',
                         'Science Policy','Economic Development','Health Policy','Cybersecurity','Rural Infrastructure','Veterans Affairs'];
  f record;
  ev uuid;
  r_mil uuid := (select id from public.reasons where label = 'Military training/duty');
  r_ill uuid := (select id from public.reasons where label = 'Illness');
  r_work uuid := (select id from public.reasons where label = 'Placement work obligation');
  r_travel uuid := (select id from public.reasons where label = 'Travel');
  f02 uuid := (select id from public.fellows where display_name = 'Fellow 02');
  f04 uuid := (select id from public.fellows where display_name = 'Fellow 04');
  f06 uuid := (select id from public.fellows where display_name = 'Fellow 06');
  f07 uuid := (select id from public.fellows where display_name = 'Fellow 07');
  f09 uuid := (select id from public.fellows where display_name = 'Fellow 09');
  v int;
begin
  -- Tuesday/Thursday Speaker Series, 5 weeks back to 16 weeks ahead
  for d in select g::date from generate_series(t - 35, t + 112, interval '1 day') g loop
    if extract(dow from d) in (2, 4) then
      n := n + 1;
      insert into public.events (title, event_type, starts_at, ends_at, speaker, location)
      values ('Speaker Series: ' || topics[1 + (n % array_length(topics, 1))], 'speaker_series',
              (d + time '12:00') at time zone 'America/New_York', (d + time '13:30') at time zone 'America/New_York',
              'Guest Speaker (fictional)', 'Conference Room B (fictional)');
    end if;
  end loop;

  -- A Wednesday program event next week, and two events on one Thursday
  d := t + ((3 - extract(dow from t)::int + 7) % 7) + 7;
  insert into public.events (title, event_type, starts_at, ends_at, location)
  values ('Agency Site Visit (Wednesday)', 'program_event', (d + time '09:30') at time zone 'America/New_York', (d + time '15:00') at time zone 'America/New_York', 'Offsite (fictional)');
  insert into public.events (title, event_type, starts_at, ends_at)
  values ('Morning Policy Briefing', 'program_event', (d + 1 + time '09:00') at time zone 'America/New_York', (d + 1 + time '10:30') at time zone 'America/New_York');
  insert into public.events (title, event_type, starts_at, ends_at, attendance_required)
  values ('Class Dinner (optional)', 'other', (t + 9 + time '18:00') at time zone 'America/New_York', (t + 9 + time '20:00') at time zone 'America/New_York', false);

  -- Past events fully recorded present except the most recent one
  for ev in select id from public.events where ends_at < now() order by starts_at desc offset 1 loop
    insert into public.attendance (fellow_id, event_id, status, marked_via)
    select id, ev, 'present', 'mark_remaining_present' from public.fellows;
  end loop;

  -- An actual absence (Fellow 04, Illness) two sessions ago
  ev := (select id from public.events where ends_at < now() order by starts_at desc offset 2 limit 1);
  update public.attendance set status = 'absent', reason_id = r_ill, marked_via = 'individual', version = version
   where event_id = ev and fellow_id = f04;

  -- An absence recorded by mistake then undone (Fellow 06)
  ev := (select id from public.events where ends_at < now() order by starts_at desc offset 1 limit 1);
  update public.attendance set status = 'absent', reason_id = r_travel, marked_via = 'individual', version = version where event_id = ev and fellow_id = f06;
  update public.attendance set status = 'not_recorded', reason_id = null, version = version where event_id = ev and fellow_id = f06;

  -- Future military training for Fellow 07 (entered well ahead)
  insert into public.time_away (fellow_id, start_date, end_date, reason_id, note)
  values (f07, t + 20, t + 34, r_mil, 'Annual training (fictional example)');

  -- Two more planned absences inside that window → event flagged at threshold 3
  ev := (select id from public.events where event_type = 'speaker_series' and local_date between t + 21 and t + 33 order by starts_at limit 1);
  insert into public.event_plans (fellow_id, event_id, kind, reason_id) values (f02, ev, 'absent', r_travel), (f09, ev, 'absent', r_work);
end $$;

select 'Fictional demo data loaded: ' || (select count(*) from public.events) || ' events.' as result;
