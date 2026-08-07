-- Run this once in the Supabase SQL Editor (Project -> SQL Editor -> New query).
-- Tables behind the Labs tab. Safe to re-run (IF NOT EXISTS / idempotent policies).
--
-- Two tables rather than one because a lab report is a real unit: it has a
-- draw date, a lab, and a file it came from, and every marker on it shares
-- those. Splitting them is what makes "show me every ferritin I've ever had"
-- a query rather than a scan through blobs.

-- ---------------------------------------------------------------------------
-- lab_panels: one row per report / blood draw.
--
-- date matches the app's "M/D/YY" convention (see src/dateUtils.js), the same
-- as food_log and daily_metrics, so panels sort alongside everything else.
-- ---------------------------------------------------------------------------
create table if not exists lab_panels (
  id uuid primary key default gen_random_uuid(),
  date text not null,
  lab_name text,
  panel_name text,
  source text not null default 'manual',   -- manual | pdf | image
  file_name text,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists lab_panels_date_idx on lab_panels (date);

-- ---------------------------------------------------------------------------
-- lab_results: one row per marker on a panel.
--
-- `marker` is the CANONICAL key (see src/labMarkers.js) — "ldl", "tsh",
-- "vitamin_d". `name` is what the lab actually printed. Keeping both is the
-- whole point: labs name the same test five different ways, and the trend
-- chart follows the canonical key while the row still shows you the wording
-- on the report.
--
-- The reference range is stored PER RESULT, not per marker, because it's the
-- lab's range on that day. Labs disagree with each other and change their
-- ranges over time; a range copied onto an old result would silently rewrite
-- whether that result was ever flagged.
--
-- value_text carries results that aren't numbers ("Negative", "<0.2"), which
-- would otherwise have to be dropped or faked as a number.
-- ---------------------------------------------------------------------------
create table if not exists lab_results (
  id uuid primary key default gen_random_uuid(),
  panel_id uuid not null references lab_panels(id) on delete cascade,
  marker text not null,
  name text not null,
  category text,
  value numeric,
  value_text text,
  unit text,
  ref_low numeric,
  ref_high numeric,
  ref_text text,
  flag text,                               -- low | high | normal | null
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists lab_results_panel_idx on lab_results (panel_id);
create index if not exists lab_results_marker_idx on lab_results (marker);

-- ---------------------------------------------------------------------------
-- lab_pathology: one row per pathology / histology report.
--
-- Separate from lab_panels because a biopsy report has no markers. It is a
-- narrative — a diagnosis, what the specimen looked like, what the pathologist
-- saw down the microscope — and there is no value, unit, or reference range to
-- put on a trend line. Forcing one into lab_results would mean inventing a
-- marker for prose, and it would show up in the marker list as a test that
-- never has a number.
--
-- The named sections are the ones every report the app has seen prints, and
-- they are what the tab shows. raw_text keeps the report verbatim regardless,
-- because pathology labs vary their headings and a section this app doesn't
-- recognise must not be silently lost.
-- ---------------------------------------------------------------------------
create table if not exists lab_pathology (
  id uuid primary key default gen_random_uuid(),
  date text not null,                      -- collection date, "M/D/YY"
  report_name text,                        -- "Gastrointestinal"
  specimen text,                           -- "A :Colon, Colon, Sigmoid:Biopsy"
  accession text,
  lab_name text,
  diagnosis text,                          -- the part you actually read
  clinical_history text,
  gross_description text,
  microscopic_description text,
  comments text,
  raw_text text not null,
  source text not null default 'portal',   -- portal | pdf | image | manual
  created_at timestamptz not null default now()
);

create index if not exists lab_pathology_date_idx on lab_pathology (date);

-- No-login setup, matching the rest of this project's tables: anyone with the
-- anon key can read/write. Fine for personal use; revisit with auth-scoped
-- policies before any public deployment.
alter table lab_panels enable row level security;
alter table lab_results enable row level security;
alter table lab_pathology enable row level security;

do $$
declare t text;
begin
  foreach t in array array['lab_panels', 'lab_results', 'lab_pathology'] loop
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
