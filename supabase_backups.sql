-- Nightly backups table. Run once in the Supabase SQL Editor; safe to re-run.
--
-- /api/backup writes one row per day: every kv_store blob (parsed) plus the
-- food, labs and daily_metrics tables, all inside a single jsonb payload.
-- vercel.json schedules it every morning; "Back up now" on Goal Settings and
-- /api/backup?download=1 use the same endpoint. 30 days are kept.

create table if not exists backups (
  day text primary key,                       -- ISO yyyy-mm-dd, one row per day
  taken_at timestamptz not null default now(),
  payload jsonb not null
);

alter table backups enable row level security;

-- Same no-login posture as every other table here: anyone with the anon key
-- can read/write. Revisit alongside the rest if this app ever goes public.
drop policy if exists "public read" on backups;
drop policy if exists "public write" on backups;
drop policy if exists "public update" on backups;
drop policy if exists "public delete" on backups;
create policy "public read" on backups for select using (true);
create policy "public write" on backups for insert with check (true);
create policy "public update" on backups for update using (true);
create policy "public delete" on backups for delete using (true);

-- ---------------------------------------------------------------------------
-- Restoring from a snapshot (nothing below runs by itself — copy what you
-- need). List what exists:
--
--   select day, taken_at,
--          jsonb_object_keys(payload->'sections') as section
--   from backups order by day desc;
--
-- Put one kv blob back (daily_log shown; same shape for entries, phase_goals,
-- habits_log, habits_targets, alert_settings):
--
--   update kv_store
--   set value = (select (payload->'sections'->'kv_store'->'daily_log')::text
--                from backups where day = '2026-08-07'),
--       updated_at = now()
--   where key = 'daily_log';
--
-- Table sections (food_log, daily_metrics, …) are jsonb arrays of rows:
--
--   select jsonb_array_elements(payload->'sections'->'food_log')
--   from backups where day = '2026-08-07';
--
-- and go back with jsonb_populate_recordset, e.g.:
--
--   insert into food_log
--   select * from jsonb_populate_recordset(null::food_log,
--     (select payload->'sections'->'food_log' from backups where day = '2026-08-07'))
--   on conflict (id) do nothing;
-- ---------------------------------------------------------------------------
