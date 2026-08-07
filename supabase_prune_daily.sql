-- Dropping old days from the daily log.
--
-- Separate from supabase_recover_daily.sql on purpose: that one is safe to run
-- top to bottom, and a delete has no business hiding inside it.
--
-- WHAT THIS DOES NOT TOUCH
--   The weekly log, goals and habits are different kv_store keys. `food_log`
--   and `daily_metrics` are different tables. Only the daily log's own rows go.
--
--   So days whose steps came from the Shortcut WILL STILL APPEAR in the Daily
--   Log after this — the app merges `daily_metrics` back in and shows them as
--   synced rows. That's the point of the merge, and it means pruning gets rid
--   of hand-logged calories and body numbers, not of the day itself.
--
-- WHAT DEPENDS ON OLD DAYS
--   Pacing reads the current Fri–Thu block only. The stat cards average the
--   most recent completed block that has data. Streaks, badges, the derail
--   banner and the trend chart all read the WEEKLY log, not this one. So
--   cutting at a block boundary (a Friday) costs nothing on screen.
--
--   The one thing that changes: adding a weekly entry dated inside the pruned
--   range no longer auto-fills from the daily log — it will say there's
--   nothing logged in the seven days before, rather than inventing a number.

-- THE CUTOFF: rows ON or AFTER 7/31/26 are kept; earlier ones go. 7/31/26 is
-- a Friday, so this keeps whole Fri–Thu blocks. To use a different date,
-- change '7/31/26' in BOTH places it appears below (steps 1 and 3) — the
-- Supabase SQL editor has no variables, so the date is written out twice.

-- ---------------------------------------------------------------------------
-- 1. Dry run: what would go, and what would stay.
-- ---------------------------------------------------------------------------
with rows as (
  select e.row,
         case when e.row->>'date' ~ '^\d{1,2}/\d{1,2}/\d{2}$'
              then to_date(e.row->>'date', 'FMMM/FMDD/YY') end as day
  from kv_store k, lateral jsonb_array_elements(k.value::jsonb) as e(row)
  where k.key = 'daily_log'
)
select case
         when day is null then 'kept — unreadable date, never dropped blind'
         when day >= to_date('7/31/26', 'FMMM/FMDD/YY') then 'kept'
         else 'dropped'
       end as verdict,
       count(*) as rows,
       min(day) as earliest,
       max(day) as latest
from rows
group by 1
order by 1;

-- ---------------------------------------------------------------------------
-- 2. Keep a copy first. `do nothing`, so re-running can't overwrite the
--    pre-prune state with an already-pruned one.
-- ---------------------------------------------------------------------------
insert into kv_store (key, value)
select 'daily_log_before_prune', value from kv_store where key = 'daily_log'
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Do it. A row whose date can't be parsed is KEPT — this deletes days you
--    chose, not rows it failed to understand.
-- ---------------------------------------------------------------------------
with rows as (
  select e.row,
         case when e.row->>'date' ~ '^\d{1,2}/\d{1,2}/\d{2}$'
              then to_date(e.row->>'date', 'FMMM/FMDD/YY') end as day
  from kv_store k, lateral jsonb_array_elements(k.value::jsonb) as e(row)
  where k.key = 'daily_log'
),
kept as (
  select coalesce(jsonb_agg(row), '[]'::jsonb) as rows
  from rows
  where day is null or day >= to_date('7/31/26', 'FMMM/FMDD/YY')
)
update kv_store set value = (select rows::text from kept), updated_at = now()
where key = 'daily_log';

-- ---------------------------------------------------------------------------
-- 4. What's left.
-- ---------------------------------------------------------------------------
select jsonb_array_length(value::jsonb) as rows_now from kv_store where key = 'daily_log';

select e.row->>'date' as date, e.row->>'cal' as cal, e.row->>'weight' as weight
from kv_store k, lateral jsonb_array_elements(k.value::jsonb) as e(row)
where k.key = 'daily_log'
order by case when e.row->>'date' ~ '^\d{1,2}/\d{1,2}/\d{2}$'
              then to_date(e.row->>'date', 'FMMM/FMDD/YY') end;

-- ---------------------------------------------------------------------------
-- Undo:
--   update kv_store set value = (select value from kv_store where key = 'daily_log_before_prune')
--   where key = 'daily_log';
-- ---------------------------------------------------------------------------
