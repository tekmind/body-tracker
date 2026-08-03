-- Run this once in the Supabase SQL Editor (Project -> SQL Editor -> New query).
-- Tables behind the Food tab: the food catalog, saved custom meals, and the
-- per-day meal log. Safe to re-run (IF NOT EXISTS / idempotent policy add).
--
-- Why real tables instead of another kv_store blob: the food log grows by
-- ~15 rows a day and gets queried by date and by "what did I eat recently",
-- which is a query, not a whole-blob read-modify-write.

-- ---------------------------------------------------------------------------
-- food_items: every food you've ever used, whether you typed it in yourself
-- or it got pulled from USDA / Open Food Facts. Imported foods are cached
-- here on first use so the second time you eat them it's a local lookup.
--
-- Macros are stored per ONE base serving, described by serving_qty +
-- serving_unit. serving_grams (when known) is what that base serving weighs,
-- which is what makes "4 oz of white rice" convertible. alt_servings holds
-- the other portions the source knew about, e.g.
--   [{"label": "1 cup", "qty": 1, "unit": "cup", "grams": 158}]
-- ---------------------------------------------------------------------------
create table if not exists food_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  brand text,
  source text not null default 'custom',   -- custom | usda | off
  source_id text,
  serving_qty numeric not null default 1,
  serving_unit text not null default 'serving',
  serving_grams numeric,
  alt_servings jsonb not null default '[]'::jsonb,
  cal numeric not null default 0,
  protein numeric not null default 0,
  carbs numeric not null default 0,
  fat numeric not null default 0,
  use_count integer not null default 0,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

-- One row per external food, so re-importing the same USDA item updates the
-- cached copy instead of piling up duplicates. Custom foods (no source_id)
-- are exempt — you're allowed two things both called "Tim's protein shake".
create unique index if not exists food_items_source_key
  on food_items (source, source_id) where source_id is not null;
create index if not exists food_items_recent_idx on food_items (last_used_at desc nulls last);

-- ---------------------------------------------------------------------------
-- food_meals: a named bundle of foods ("usual breakfast") you can drop into
-- a section in one tap. items is a snapshot array of
--   [{"food_id": uuid|null, "name": ..., "brand": ..., "qty": 2,
--     "unit": "slice", "cal": 140, "protein": 12, "carbs": 2, "fat": 9}]
-- ---------------------------------------------------------------------------
create table if not exists food_meals (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  section text,
  items jsonb not null default '[]'::jsonb,
  use_count integer not null default 0,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- food_log: one row per food eaten. Macros are SNAPSHOTTED onto the row on
-- purpose — correcting a food's nutrition next month must not silently
-- rewrite what last month's days say you ate.
--
-- date matches the app's "M/D/YY" convention (see parseDate/formatMDY in
-- src/Dashboard.jsx), same as daily_metrics.
-- ---------------------------------------------------------------------------
create table if not exists food_log (
  id uuid primary key default gen_random_uuid(),
  date text not null,
  section text not null,                   -- breakfast | lunch | snack_early | snack_late | dinner | dessert
  food_id uuid references food_items(id) on delete set null,
  name text not null,
  brand text,
  qty numeric not null default 1,
  unit text not null default 'serving',
  cal numeric not null default 0,
  protein numeric not null default 0,
  carbs numeric not null default 0,
  fat numeric not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists food_log_date_idx on food_log (date);

-- No-login setup, matching the rest of this project's tables: anyone with the
-- anon key can read/write. Fine for personal use; revisit with auth-scoped
-- policies before any public deployment.
alter table food_items enable row level security;
alter table food_meals enable row level security;
alter table food_log enable row level security;

do $$
declare t text;
begin
  foreach t in array array['food_items', 'food_meals', 'food_log'] loop
    execute format('drop policy if exists "public read" on %I', t);
    execute format('drop policy if exists "public write" on %I', t);
    execute format('drop policy if exists "public update" on %I', t);
    execute format('drop policy if exists "public delete" on %I', t);
    execute format('create policy "public read" on %I for select using (true)', t);
    execute format('create policy "public write" on %I for insert with check (true)', t);
    execute format('create policy "public update" on %I for update using (true)', t);
    execute format('create policy "public delete" on %I for delete using (true)', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Remembered portions. The Food tab's "recently eaten" list adds a food in one
-- tap using the amount you had last time, so the amount has to outlive the
-- session. Safe to re-run.
alter table food_items add column if not exists last_qty numeric;
alter table food_items add column if not exists last_unit text;

-- Backfill from what you've already logged, so the feature works on day one
-- rather than after each food has been eaten once more.
update food_items f
set last_qty = l.qty, last_unit = l.unit
from (
  select distinct on (food_id) food_id, qty, unit
  from food_log
  where food_id is not null
  order by food_id, created_at desc
) l
where f.id = l.food_id and f.last_qty is null;
