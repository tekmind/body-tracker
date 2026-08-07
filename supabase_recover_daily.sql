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
       length(value) as chars,
       -- Only arrays have a length; habits_targets and alert_settings are
       -- objects, and asking would abort the whole script.
       case when jsonb_typeof(nullif(value, '')::jsonb) = 'array'
            then jsonb_array_length(nullif(value, '')::jsonb) end as rows,
       updated_at
from kv_store
order by updated_at desc;

-- How far back the food log actually goes, and so how much of the daily log
-- this can rebuild.
select count(distinct date)                 as days_with_food,
       count(*)                             as meals_logged,
       min(to_date(date, 'FMMM/FMDD/YY'))   as earliest_day,
       max(to_date(date, 'FMMM/FMDD/YY'))   as latest_day,
       max(to_date(date, 'FMMM/FMDD/YY'))
         - min(to_date(date, 'FMMM/FMDD/YY')) as span_days
from food_log;

-- What it can give back, day by day. Ordered by the day itself, not by when
-- the rows were written — anything backfilled would sort to the wrong place.
select date, count(*) as meals, round(sum(cal)) as calories
from food_log
group by date
order by to_date(date, 'FMMM/FMDD/YY');

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
--    Dates are matched by VALUE, not spelling: "08/06/26" and "8/6/26" are the
--    same day, and comparing the text would bring the second one back as a
--    duplicate row. A date that doesn't parse at all yields null, matches
--    nothing, and is simply carried through untouched — step 4 reports any
--    day that ended up with two rows either way.
-- ---------------------------------------------------------------------------
with existing as (
  select e.row,
         case when e.row->>'date' ~ '^\d{1,2}/\d{1,2}/\d{2}$'
              then to_date(e.row->>'date', 'FMMM/FMDD/YY') end as day
  from kv_store k, lateral jsonb_array_elements(k.value::jsonb) as e(row)
  where k.key = 'daily_log'
),
from_food as (
  select date, to_date(date, 'FMMM/FMDD/YY') as day, round(sum(cal))::int as cal
  from food_log
  group by date
),
missing as (
  select f.date, f.cal
  from from_food f
  where not exists (select 1 from existing x where x.day = f.day)
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
-- 4. Check the result. Any day listed here has two rows and needs one deleting
--    by hand in the app. Grouped by the parsed day, so two spellings of the
--    same date are caught rather than looking like two different days.
-- ---------------------------------------------------------------------------
select coalesce(to_char(case when e.row->>'date' ~ '^\d{1,2}/\d{1,2}/\d{2}$'
                             then to_date(e.row->>'date', 'FMMM/FMDD/YY') end, 'FMMM/FMDD/YY'),
                e.row->>'date') as day,
       count(*) as rows
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
