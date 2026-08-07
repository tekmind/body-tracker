import { createClient } from "@supabase/supabase-js";

// Nightly snapshot of everything the app stores, one row per day in the
// `backups` table (supabase_backups.sql). vercel.json calls this every
// morning; the "Back up now" button on Goal Settings calls it on demand, and
// ?download=1 hands the snapshot back as a file.
//
// This protects against the app writing something wrong — which has happened:
// a bad write once replaced the whole daily log, and a snapshot from the
// morning before would have made that a non-event. It does NOT protect
// against losing the Supabase project itself, since the copies live in it;
// the Export button on Goal Settings is the offsite layer.

const KEEP_DAYS = 30;

// Every table the app writes. kv_store is handled separately so its JSON
// blobs land parsed — a backup you can read, not strings inside strings.
const TABLES = ["food_items", "food_meals", "food_log", "daily_metrics", "lab_panels", "lab_results"];

export default async function handler(req, res) {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    res.status(500).json({ ok: false, error: "Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY env vars." });
    return;
  }
  const supabase = createClient(url, key);

  const takenAt = new Date().toISOString();
  const payload = { taken_at: takenAt, sections: {} };
  const counts = {};

  // A table that errors (not created yet, say) is recorded as an error and
  // the rest still gets backed up — a labs table that doesn't exist must not
  // cost the night's copy of the food log.
  try {
    const { data, error } = await supabase.from("kv_store").select("key,value");
    if (error) throw error;
    const kv = {};
    for (const row of data || []) {
      try { kv[row.key] = JSON.parse(row.value); } catch { kv[row.key] = row.value; }
    }
    payload.sections.kv_store = kv;
    counts.kv_store = (data || []).length;
  } catch (e) {
    payload.sections.kv_store = { _error: e.message };
    counts.kv_store = `error: ${e.message}`;
  }

  for (const table of TABLES) {
    try {
      const { data, error } = await supabase.from(table).select("*");
      if (error) throw error;
      payload.sections[table] = data || [];
      counts[table] = (data || []).length;
    } catch (e) {
      payload.sections[table] = { _error: e.message };
      counts[table] = `error: ${e.message}`;
    }
  }

  const day = takenAt.slice(0, 10); // ISO date: sorts correctly as text

  try {
    const { error: upsertErr } = await supabase.from("backups")
      .upsert({ day, taken_at: takenAt, payload });
    if (upsertErr) throw upsertErr;

    const cutoff = new Date(Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);
    // Retention failing is not worth failing the backup over — old rows can
    // be cleared next run.
    await supabase.from("backups").delete().lt("day", cutoff);
  } catch (e) {
    res.status(500).json({
      ok: false, day, sections: counts,
      error: /relation .* does not exist|schema cache/i.test(e.message || "")
        ? "The backups table isn't set up — run supabase_backups.sql in the Supabase SQL editor."
        : e.message,
    });
    return;
  }

  if (req.query?.download) {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="body-tracker-backup-${day}.json"`);
    res.status(200).send(JSON.stringify(payload, null, 2));
    return;
  }

  res.status(200).json({ ok: true, day, sections: counts });
}
