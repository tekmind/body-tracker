-- Weekly log: muscle mass -> lean mass, all the way back.
--
-- The scale pipeline (Withings -> Apple Health -> Shortcut) provides weight
-- and fat mass; Withings' own muscle-mass figure never leaves its app. Rather
-- than carry a metric the pipeline can't feed, the app now tracks LEAN mass —
-- weight minus fat mass — and every historical week is recomputed by that
-- same rule from numbers it already has. The whole series shifts up by
-- roughly your bone mass and stays internally consistent; there is no jump
-- at the switchover, because no week keeps the old definition.
--
--   aM becomes aW - aF   (actual lean = actual weight - actual fat)
--   tM becomes tW - tF   (target lean = target weight - target fat)
--
-- A row missing either side keeps null. Every other field is untouched.
--
-- TAKE A BACKUP FIRST: Goal Settings -> Back up now. Step 2 also keeps its
-- own copy, and the undo is at the bottom.

-- ---------------------------------------------------------------------------
-- 1. Dry run: what each week's aM would become.
-- ---------------------------------------------------------------------------
select e.row->>'date'                          as date,
       (e.row->>'aM')::numeric                 as muscle_now,
       round((e.row->>'aW')::numeric - (e.row->>'aF')::numeric, 1) as lean_after,
       (e.row->>'tM')::numeric                 as target_now,
       round((e.row->>'tW')::numeric - (e.row->>'tF')::numeric, 1) as target_after
from kv_store k, lateral jsonb_array_elements(k.value::jsonb) as e(row)
where k.key = 'entries'
order by case when e.row->>'date' ~ '^\d{1,2}/\d{1,2}/\d{2}$'
              then to_date(e.row->>'date', 'FMMM/FMDD/YY') end;

-- ---------------------------------------------------------------------------
-- 2. Keep a copy. `do nothing`: re-running must not overwrite the pre-lean
--    state with an already-migrated one.
-- ---------------------------------------------------------------------------
insert into kv_store (key, value)
select 'entries_before_lean', value from kv_store where key = 'entries'
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Rewrite. jsonb_set with a null-safe value: when weight or fat is
--    missing, aM/tM are written as JSON null rather than dropped, keeping
--    every row's shape identical to what the app writes itself.
-- ---------------------------------------------------------------------------
with migrated as (
  select jsonb_agg(
           jsonb_set(
             jsonb_set(
               e.row,
               '{aM}',
               coalesce(to_jsonb(round((e.row->>'aW')::numeric - (e.row->>'aF')::numeric, 1)), 'null'::jsonb),
               true),
             '{tM}',
             coalesce(to_jsonb(round((e.row->>'tW')::numeric - (e.row->>'tF')::numeric, 1)), 'null'::jsonb),
             true)
         ) as rows
  from kv_store k, lateral jsonb_array_elements(k.value::jsonb) as e(row)
  where k.key = 'entries'
)
update kv_store set value = (select rows::text from migrated), updated_at = now()
where key = 'entries'
  and exists (select 1 from migrated where rows is not null);

-- ---------------------------------------------------------------------------
-- 4. Check: every row where lean != weight - fat (should be none), and the
--    row count before vs after (should match).
-- ---------------------------------------------------------------------------
select e.row->>'date' as date, e.row->>'aM' as aM, e.row->>'aW' as aW, e.row->>'aF' as aF
from kv_store k, lateral jsonb_array_elements(k.value::jsonb) as e(row)
where k.key = 'entries'
  and (e.row->>'aW') is not null and (e.row->>'aF') is not null
  and (e.row->>'aM')::numeric is distinct from round((e.row->>'aW')::numeric - (e.row->>'aF')::numeric, 1);

select (select jsonb_array_length(value::jsonb) from kv_store where key = 'entries')             as rows_now,
       (select jsonb_array_length(value::jsonb) from kv_store where key = 'entries_before_lean') as rows_before;

-- ---------------------------------------------------------------------------
-- Undo:
--   update kv_store set value = (select value from kv_store where key = 'entries_before_lean')
--   where key = 'entries';
-- ---------------------------------------------------------------------------
