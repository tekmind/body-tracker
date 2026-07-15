-- Run this once in the Supabase SQL Editor (Project -> SQL Editor -> New query).
-- Creates a simple key/value store matching the app's existing storage keys:
-- entries, phase_goals, daily_log, habits_log, habits_targets, collapsed_groups.

create table if not exists kv_store (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table kv_store enable row level security;

-- No-login setup: anyone with the anon key can read/write. Fine for personal
-- local use; revisit with auth-scoped policies before any public deployment.
create policy "public read" on kv_store for select using (true);
create policy "public write" on kv_store for insert with check (true);
create policy "public update" on kv_store for update using (true);
