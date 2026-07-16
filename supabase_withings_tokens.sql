-- Run this once in the Supabase SQL Editor.
-- Single-row store for the Withings OAuth2 tokens used by /api/withings-*.

create table if not exists withings_tokens (
  id integer primary key default 1,
  access_token text not null,
  refresh_token text not null,
  withings_user_id text,
  updated_at timestamptz not null default now()
);

alter table withings_tokens enable row level security;

drop policy if exists "public read" on withings_tokens;
drop policy if exists "public write" on withings_tokens;
drop policy if exists "public update" on withings_tokens;
create policy "public read" on withings_tokens for select using (true);
create policy "public write" on withings_tokens for insert with check (true);
create policy "public update" on withings_tokens for update using (true);
