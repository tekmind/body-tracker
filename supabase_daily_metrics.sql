-- Run this once in the Supabase SQL Editor.
-- If you already created daily_metrics from an earlier version of this file,
-- these statements are safe to re-run (IF NOT EXISTS / idempotent policy add).

create table if not exists daily_metrics (
  date text primary key,
  cal integer,
  steps integer,
  source text default 'healthkit',
  updated_at timestamptz not null default now()
);

alter table daily_metrics add column if not exists weight numeric;
alter table daily_metrics add column if not exists fat_mass numeric;
alter table daily_metrics add column if not exists muscle_mass numeric;

alter table daily_metrics enable row level security;

drop policy if exists "public read" on daily_metrics;
drop policy if exists "public write" on daily_metrics;
drop policy if exists "public update" on daily_metrics;
drop policy if exists "public delete" on daily_metrics;
create policy "public read" on daily_metrics for select using (true);
create policy "public write" on daily_metrics for insert with check (true);
create policy "public update" on daily_metrics for update using (true);
create policy "public delete" on daily_metrics for delete using (true);

-- Cleanup: remove the test row from earlier verification.
delete from daily_metrics where date = '7/14/26';
