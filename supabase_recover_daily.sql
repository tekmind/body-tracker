-- Rebuilding the daily log's calories from the food log.
--
-- Written after a bug in the app replaced the whole `daily_log` blob with a
-- single row (fixed: persistDaily now refuses to write before the log has been
-- read). This recovers what can honestly be recovered and says plainly what
-- can't.
--
--   RECOVERABLE   Calories, for every day you logged food. Each meal is still
--                 its own row in `food_log`, a separate table the bug never
--                 touched, so the day's total is just a sum.
--   NOT HERE      Weight, fat mass, muscle mass, and calories on days you
--                 typed by hand without logging food. Those lived only in the
--                 blob. A Supabase backup is the only route to them —
--                 Dashboard → Database → Backups, restore the `kv_store` row
--                 where key = 'daily_log'.
--   NEVER AT RISK Steps and anything else the Shortcut or Withings wrote:
--                 `daily_metrics` is its own table. Those days come back on
--                 their own through the app's merge.
--
-- Run the steps in order. Every one is re-runnable, and step 2 keeps a copy of
-- the current state before anything is changed.

-- ---------------------------------------------------------------------------
-- 1. Look first. How much is left, and when did it change?
-- ---------------------------------------------------------------------------
select key,
       length(value)                                as chars,
       jsonb_array_length(nullif(value, '')::jsonb) as rows,
       updated_at
from kv_store
order by updated_at desc;

-- What the food log can give back, day by day.
select date, count(*) as meals, round(sum(cal)) as calories
from food_log
group by date
order by min(created_at);

-- ---------------------------------------------------------------------------
-- 2. Keep what's there now, before touching it.
--
--    `do nothing`, deliberately: this must capture the state BEFORE the first
--    recovery run. Refreshing it on a later run would overwrite the copy with
--    already-recovered data and quietly destroy the undo below.
-- ---------------------------------------------------------------------------
insert into kv_store (key, value)
select 'daily_log_before_recovery', value from kv_store where key = 'daily_log'
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Add a row for every day the food log knows about that the daily log has
--    lost. Days still present are left exactly as they are — this only fills
--    gaps, so running it twice changes nothing the second time.
--
--    Dates are matched as text. The app writes M/D/YY with no leading zeros in
--    both tables, so they line up; a hand-typed "08/06/26" would not match and
--    would come back as a second row for that day. Step 4 finds those.
-- ---------------------------------------------------------------------------
with existing as (
  select e.row, e.row->>'date' as date
  from kv_store k, lateral jsonb_array_elements(k.value::jsonb) as e(row)
  where k.key = 'daily_log'
),
from_food as (
  select date, round(sum(cal))::int as cal
  from food_log
  group by date
),
missing as (
  select f.date, f.cal
  from from_food f
  where not exists (select 1 from existing x where x.date = f.date)
),
merged as (
  select coalesce(jsonb_agg(row), '[]'::jsonb) as rows
  from (
    select row from existing
    union all
    select jsonb_build_object(
             'date',       date,
             'cal',        cal,
             'steps',      null,
             'weight',     null,
             'fatMass',    null,
             'muscleMass', null,
             -- "food", not "manual": these came from what you logged, and the
             -- Food tab is then free to correct them if a meal changes.
             'calSource',  'food')
      from missing
  ) all_rows
)
insert into kv_store (key, value)
select 'daily_log', rows::text from merged
on conflict (key) do update set value = excluded.value, updated_at = now();

-- ---------------------------------------------------------------------------
-- 4. Check the result. Any date appearing twice here needs one row deleting by
--    hand in the app — see the note in step 3 about date spelling.
-- ---------------------------------------------------------------------------
select e.row->>'date' as date, count(*) as rows
from kv_store k, lateral jsonb_array_elements(k.value::jsonb) as e(row)
where k.key = 'daily_log'
group by 1
having count(*) > 1;

select jsonb_array_length(value::jsonb) as rows_now,
       (select count(distinct date) from food_log) as days_with_food
from kv_store where key = 'daily_log';

-- ---------------------------------------------------------------------------
-- If you need to undo all of this:
--   update kv_store set value = (select value from kv_store where key = 'daily_log_before_recovery')
--   where key = 'daily_log';
-- ---------------------------------------------------------------------------
