// Data access for the Labs tab. Every write to lab_panels / lab_results goes
// through here; /api/lab-parse is a read-only lookup, so this file is the one
// place lab history actually changes.
//
// Rows keep their database (snake_case) shape — see supabase_labs.sql.

import { supabase } from "./supabaseClient.js";

const PANEL_COLUMNS = "id,date,lab_name,panel_name,source,file_name,note,created_at";
const RESULT_COLUMNS =
  "id,panel_id,marker,name,category,value,value_text,unit,ref_low,ref_high,ref_text,flag,sort_order";
const PATHOLOGY_COLUMNS =
  "id,date,report_name,specimen,accession,lab_name,diagnosis,clinical_history," +
  "gross_description,microscopic_description,comments,raw_text,source,created_at";

function unwrap({ data, error }) {
  if (error) throw error;
  return data;
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
    if (/relation .* does not exist|schema cache|could not find the table/i.test(e.message || "")) return null;
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
