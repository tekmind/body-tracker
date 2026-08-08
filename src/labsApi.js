// Data access for the Labs tab. Every write to lab_panels / lab_results goes
// through here; /api/lab-parse is a read-only lookup, so this file is the one
// place lab history actually changes.
//
// Rows keep their database (snake_case) shape — see supabase_labs.sql.

import { supabase } from "./supabaseClient.js";

const PANEL_COLUMNS =
  "id,date,lab_name,panel_name,source,file_name,note,drawn_at,fasted,infusion_relation,created_at";
const RESULT_COLUMNS =
  "id,panel_id,marker,name,category,value,value_text,unit,ref_low,ref_high,ref_text,flag,sort_order";
const PATHOLOGY_COLUMNS =
  "id,date,report_name,specimen,accession,lab_name,diagnosis,clinical_history," +
  "gross_description,microscopic_description,comments,raw_text,kind,source,created_at";
const HISTORY_COLUMNS = "id,kind,label,detail,started,ended,active,sort_order,created_at,updated_at";
const REPORT_COLUMNS =
  "id,system_key,system_name,title,summary,body,model,effort,covered_panel_ids," +
  "latest_panel_date,marker_count,prev_report_id,created_at";

function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

/** A table that hasn't been created yet is a setup step, not a failure. */
function isMissingTable(e) {
  return /relation .* does not exist|schema cache|could not find the table/i.test(e?.message || "");
}

// --- reads -----------------------------------------------------------------

export async function fetchPanels(limit = 200) {
  return unwrap(
    await supabase.from("lab_panels").select(PANEL_COLUMNS).order("created_at", { ascending: false }).limit(limit)
  ) || [];
}

/**
 * Every result for the given panels, in one round trip.
 *
 * All of them, not a page: a lifetime of blood work for one person is a few
 * thousand rows, and having the whole set client-side is what makes the trend
 * chart instant and the marker search work without a query per keystroke.
 */
export async function fetchResults(panelIds) {
  if (!panelIds.length) return [];
  return unwrap(
    await supabase.from("lab_results").select(RESULT_COLUMNS).in("panel_id", panelIds).order("sort_order")
  ) || [];
}

/**
 * Pathology reports — biopsies and histology, which carry prose instead of
 * markers. Missing table is not an error: the Labs tab works without it and
 * only offers the Pathology view once supabase_labs.sql has been re-run.
 */
export async function fetchPathology(limit = 200) {
  try {
    return unwrap(
      await supabase.from("lab_pathology").select(PATHOLOGY_COLUMNS).order("created_at", { ascending: false }).limit(limit)
    ) || [];
  } catch (e) {
    if (isMissingTable(e)) return null;
    throw e;
  }
}

/**
 * Written reports, newest first. Same missing-table contract as pathology:
 * null means supabase_labs.sql hasn't been re-run, and the tab hides the
 * feature rather than showing an error on a tab that otherwise works.
 */
export async function fetchReports(limit = 200) {
  try {
    return unwrap(
      await supabase.from("lab_reports").select(REPORT_COLUMNS).order("created_at", { ascending: false }).limit(limit)
    ) || [];
  } catch (e) {
    if (isMissingTable(e)) return null;
    throw e;
  }
}

export async function fetchHistory() {
  try {
    return unwrap(
      await supabase.from("medical_history").select(HISTORY_COLUMNS).order("sort_order").order("created_at")
    ) || [];
  } catch (e) {
    if (isMissingTable(e)) return null;
    throw e;
  }
}

// --- writes ----------------------------------------------------------------

/**
 * Save a panel and its results together.
 *
 * If the results insert fails the panel is deleted again, so a failed import
 * can't leave an empty panel sitting in the list looking like a real draw.
 */
export async function createPanel({ panel, results }) {
  const saved = unwrap(await supabase.from("lab_panels").insert(panel).select(PANEL_COLUMNS).single());
  if (!results.length) return { panel: saved, results: [] };

  try {
    const rows = unwrap(
      await supabase
        .from("lab_results")
        .insert(results.map((r, i) => ({ ...r, panel_id: saved.id, sort_order: i })))
        .select(RESULT_COLUMNS)
    );
    return { panel: saved, results: rows || [] };
  } catch (e) {
    try { await supabase.from("lab_panels").delete().eq("id", saved.id); } catch { /* best effort */ }
    throw e;
  }
}

export async function updatePanel(id, patch) {
  return unwrap(await supabase.from("lab_panels").update(patch).eq("id", id).select(PANEL_COLUMNS).single());
}

/** Cascades to the panel's results (see the foreign key in supabase_labs.sql). */
export async function deletePanel(id) {
  unwrap(await supabase.from("lab_panels").delete().eq("id", id));
}

export async function addResult(panelId, result) {
  return unwrap(
    await supabase.from("lab_results").insert({ ...result, panel_id: panelId }).select(RESULT_COLUMNS).single()
  );
}

export async function updateResult(id, patch) {
  return unwrap(await supabase.from("lab_results").update(patch).eq("id", id).select(RESULT_COLUMNS).single());
}

export async function deleteResult(id) {
  unwrap(await supabase.from("lab_results").delete().eq("id", id));
}

export async function deletePathology(id) {
  unwrap(await supabase.from("lab_pathology").delete().eq("id", id));
}

// --- medical history -------------------------------------------------------

export async function addHistory(entry) {
  return unwrap(await supabase.from("medical_history").insert(entry).select(HISTORY_COLUMNS).single());
}

export async function updateHistory(id, patch) {
  return unwrap(
    await supabase.from("medical_history")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id).select(HISTORY_COLUMNS).single()
  );
}

export async function deleteHistory(id) {
  unwrap(await supabase.from("medical_history").delete().eq("id", id));
}

// --- reports ---------------------------------------------------------------

export async function createReport(report) {
  return unwrap(await supabase.from("lab_reports").insert(report).select(REPORT_COLUMNS).single());
}

/**
 * Deleting a report leaves the ones written after it pointing at nothing —
 * `prev_report_id` is `on delete set null`, so the thread reconnects rather
 * than the delete failing or cascading through everything since.
 */
export async function deleteReport(id) {
  unwrap(await supabase.from("lab_reports").delete().eq("id", id));
}

// --- the reader endpoint ---------------------------------------------------

/**
 * Send a PDF or image off to be read. Returns { panel, results } — or
 * { panel: null, error } when nothing readable was found, which is a normal
 * outcome rather than a failure, so it isn't thrown.
 */
export async function readLabFile(payload) {
  const resp = await fetch("/api/lab-parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json.error || `Couldn't read that file (${resp.status})`);
  return json;
}

/**
 * Ask for a written report. Returns { title, summary, body } — nothing is
 * saved until the report comes back and the caller writes it.
 *
 * A report takes far longer than any other call in the app, and the function
 * that writes it has a hard ceiling, so a timeout says what to do about it
 * rather than surfacing a bare 504.
 */
export async function writeLabReport(payload) {
  const resp = await fetch("/api/lab-report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    if (resp.status === 504 || resp.status === 408) {
      throw new Error("That report took longer than the server allows. Try again, or set LAB_REPORT_EFFORT=low in Vercel to trade some depth for time.");
    }
    throw new Error(json.error || `Couldn't write that report (${resp.status})`);
  }
  return json;
}
