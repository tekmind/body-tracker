-- Dropping old synced days from daily_metrics.
--
-- The daily-log prune (supabase_prune_daily.sql) empties the hand-entered
-- blob, but days the Shortcut posted steps for live in THIS table, and the
-- app merges them back into the Daily Log as synced rows — so pruned dates
-- reappear with a step count and nothing else. Run this only if you want
-- those days gone from the table entirely.
--
-- WHAT IT COSTS
--   Day-level step history before the cutoff. The weekly log's step averages
--   already captured those weeks, and today's server backup holds a full
--   copy of this table, but the per-day numbers stop being visible in-app.
--
-- THE CUTOFF: rows ON or AFTER 7/31/26 stay. To change it, edit '7/31/26' in
-- BOTH places below (steps 1 and 3) — the editor has no variables.

-- ---------------------------------------------------------------------------
-- 1. Dry run: what would go, and what would stay.
-- ---------------------------------------------------------------------------
select case
         when date !~ '^\d{1,2}/\d{1,2}/\d{2}$' then 'kept — unreadable date, never dropped blind'
         when to_date(date, 'FMMM/FMDD/YY') >= to_date('7/31/26', 'FMMM/FMDD/YY') then 'kept'
         else 'dropped'
       end as verdict,
       count(*) as rows,
       min(case when date ~ '^\d{1,2}/\d{1,2}/\d{2}$' then to_date(date, 'FMMM/FMDD/YY') end) as earliest,
       max(case when date ~ '^\d{1,2}/\d{1,2}/\d{2}$' then to_date(date, 'FMMM/FMDD/YY') end) as latest
from daily_metrics
group by 1
order by 1;

-- ---------------------------------------------------------------------------
-- 2. Keep the rows about to be deleted, so the undo is a plain insert rather
--    than a dig through backup JSON. Re-running only adds rows not already
--    kept — it can't duplicate or overwrite.
-- ---------------------------------------------------------------------------
create table if not exists daily_metrics_pruned (like daily_metrics including all);

insert into daily_metrics_pruned
select * from daily_metrics d
where d.date ~ '^\d{1,2}/\d{1,2}/\d{2}$'
  and to_date(d.date, 'FMMM/FMDD/YY') < to_date('7/31/26', 'FMMM/FMDD/YY')
on conflict (date) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Delete. A row whose date can't be parsed is KEPT.
-- ---------------------------------------------------------------------------
delete from daily_metrics
where date ~ '^\d{1,2}/\d{1,2}/\d{2}$'
  and to_date(date, 'FMMM/FMDD/YY') < to_date('7/31/26', 'FMMM/FMDD/YY');

-- ---------------------------------------------------------------------------
-- 4. What's left, oldest first.
-- ---------------------------------------------------------------------------
select date, cal, steps, weight, fat_mass, muscle_mass
from daily_metrics
order by case when date ~ '^\d{1,2}/\d{1,2}/\d{2}$' then to_date(date, 'FMMM/FMDD/YY') end;

-- ---------------------------------------------------------------------------
-- Undo:
--   insert into daily_metrics select * from daily_metrics_pruned
--   on conflict (date) do nothing;
-- Once you're sure you won't want it:
--   drop table daily_metrics_pruned;
-- ---------------------------------------------------------------------------
