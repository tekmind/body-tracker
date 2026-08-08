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
  kind text not null default 'pathology',  -- pathology | imaging
  source text not null default 'portal',   -- portal | pdf | image | manual
  created_at timestamptz not null default now()
);

-- Added after the table shipped; safe to re-run.
alter table lab_pathology add column if not exists kind text not null default 'pathology';

create index if not exists lab_pathology_date_idx on lab_pathology (date);

-- ---------------------------------------------------------------------------
-- medical_history: the context a number can't carry.
--
-- Calprotectin at 160 means one thing on anti-TNF therapy and another off it;
-- a low B12 reads differently after an ileal resection. None of that is in
-- lab_results, so a report written from the numbers alone is written blind.
--
-- Deliberately loose: `label` is the thing, `detail` is whatever else matters,
-- and dates are free text because "2019", "childhood" and "3/2021" are all
-- real answers. A row that's ended keeps its dates rather than being deleted —
-- a drug you stopped two years ago is part of why this year looks like it does.
-- ---------------------------------------------------------------------------
create table if not exists medical_history (
  id uuid primary key default gen_random_uuid(),
  kind text not null,                      -- condition | medication | surgery | allergy | family | note
  label text not null,
  detail text,
  started text,                            -- free text: "2019", "3/2021", "childhood"
  ended text,                              -- free text; null while ongoing
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists medical_history_kind_idx on medical_history (kind, sort_order);

-- ---------------------------------------------------------------------------
-- lab_reports: a written interpretation of one body system, kept as a thread.
--
-- Each row is a whole report, not a diff, so any one of them can be read on
-- its own years later. `prev_report_id` is what makes it a thread: a report
-- written after new blood work is given the last one and asked to say what
-- changed, so the thread reads as a story rather than a pile of snapshots.
--
-- `covered_panel_ids` records what the report actually saw — every draw its
-- markers appear on, and any narrative study the system claims. That is how
-- the tab knows there is something new to say (a source in this system whose
-- id isn't in this list) instead of offering to rewrite the same report from
-- the same numbers, which would produce a second opinion rather than an update.
--
-- `model` and `created_at` are stored because this is generated prose about
-- someone's health: which model wrote it and when is part of reading it.
-- ---------------------------------------------------------------------------
create table if not exists lab_reports (
  id uuid primary key default gen_random_uuid(),
  system_key text not null,                -- SYSTEMS key in src/labMarkers.js
  system_name text not null,               -- denormalised: the name at write time
  title text not null,
  summary text,
  body text not null,                      -- markdown
  model text,
  effort text,
  covered_panel_ids jsonb not null default '[]'::jsonb,
  latest_panel_date text,                  -- newest draw the report covers, "M/D/YY"
  marker_count integer,
  prev_report_id uuid references lab_reports(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists lab_reports_system_idx on lab_reports (system_key, created_at desc);

-- No-login setup, matching the rest of this project's tables: anyone with the
-- anon key can read/write. Fine for personal use; revisit with auth-scoped
-- policies before any public deployment.
alter table lab_panels enable row level security;
alter table lab_results enable row level security;
alter table lab_pathology enable row level security;
alter table medical_history enable row level security;
alter table lab_reports enable row level security;

do $$
declare t text;
begin
  foreach t in array array['lab_panels', 'lab_results', 'lab_pathology', 'medical_history', 'lab_reports'] loop
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
