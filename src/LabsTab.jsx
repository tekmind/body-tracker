import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceArea, Dot,
} from "recharts";
import {
  Plus, X, Check, Loader2, AlertCircle, Trash2, Pencil, Search, Save, Upload,
  FileText, TrendingUp, ChevronDown, ChevronRight, ChevronLeft, ArrowUp, ArrowDown, FlaskConical,
  BookOpen, Heart,
} from "lucide-react";
import { parseDate, formatMDY, today as todayDate } from "./dateUtils.js";
import {
  resolveMarker, markerDisplayName, markerInfo, flagFor, isFavorable,
  sortResults, fmtValue, fmtRange, fmtBounds, MARKER_CATEGORIES,
  SYSTEMS, systemsFor, groupFor, markerNote, effectiveRange, borderlineFor, gaugeScale,
} from "./labMarkers.js";
import { prepareLabFile, ACCEPTED_FILE_TYPES } from "./labFile.js";
import { HISTORY_KINDS, buildReportBrief, newPanelsSince, parseMarkdown, drawContext } from "./labReport.js";
import * as labsApi from "./labsApi.js";

const CHART_THEME = { grid: "#e7e6e0", tick: "#70747c", font: "Inter" };

const num = (v) => {
  if (v === "" || v == null) return null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
};

/** ISO "2026-03-14" (what the reader returns) -> the app's "3/14/26". */
function isoToMDY(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || "").trim());
  if (!m) return "";
  return `${Number(m[2])}/${Number(m[3])}/${m[1].slice(2)}`;
}

function flagClass(flag, markerKey) {
  if (!flag || flag === "normal") return "";
  return isFavorable(markerKey, flag) ? " lab-flag-ok" : " lab-flag-off";
}

/**
 * The colour a marker row reads as. Amber sits between: inside the lab's
 * range, but hugging the end of it that isn't the good one.
 */
function attentionClass(row) {
  if (row.attention === "now") return " lab-flag-off";
  if (row.attention === "borderline") return " lab-flag-edge";
  return "";
}

/**
 * Paint a scale's zones along its track.
 *
 * Two kinds of boundary, drawn differently because they mean different
 * things. Drifting toward the end of the range is gradual, so `ok` and `edge`
 * blend into each other — the closer you sit to the bound, the warmer the bar
 * already is. Crossing the bound is not gradual, so an `off` boundary is a
 * hard stop at exactly the value the lab set.
 *
 * Deliberately pale. Twenty of these render down a system's screen, and the
 * verdict is the number and the dot — the bar is context, not an alarm.
 */
function gaugePaint(zones) {
  if (!zones?.length) return undefined;
  const C = { ok: "rgba(103,161,90,0.34)", edge: "rgba(192,122,31,0.36)", off: "rgba(165,52,42,0.34)" };
  const pct = (x) => `${+(x * 100).toFixed(2)}%`;
  const stops = [`${C[zones[0].level]} 0%`];
  zones.forEach((z, i) => {
    // A stop mid-zone so a zone with soft boundaries on both sides still
    // reaches its own colour instead of being blended away entirely.
    stops.push(`${C[z.level]} ${pct((z.from + z.to) / 2)}`);
    const next = zones[i + 1];
    if (next && (z.level === "off" || next.level === "off")) {
      stops.push(`${C[z.level]} ${pct(z.to)}`, `${C[next.level]} ${pct(z.to)}`);
    }
  });
  stops.push(`${C[zones[zones.length - 1].level]} 100%`);
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

/** A parsed or hand-entered report, before anything is saved. */
function blankDraft(overrides = {}) {
  return {
    date: formatMDY(todayDate()),
    lab_name: "",
    panel_name: "",
    source: "manual",
    file_name: "",
    note: "",
    confidence: "",
    // Null until someone actually knows — see supabase_labs.sql. A guess here
    // would be read as fact by every report written afterwards.
    drawn_at: "",
    fasted: "",
    infusion_relation: "",
    rows: [],
    ...overrides,
  };
}

/** A row worth saving: ticked, named, and carrying some kind of result. */
function isSavable(r) {
  return r.include && r.name.trim() && (num(r.value) != null || r.value_text.trim());
}

function blankRow() {
  return { include: true, name: "", value: "", value_text: "", unit: "", ref_low: "", ref_high: "", ref_text: "", flag: null };
}

export default function LabsTab() {
  const [status, setStatus] = useState("loading");
  const [err, setErr] = useState("");
  const [panels, setPanels] = useState([]);
  const [results, setResults] = useState([]);
  // null means the table isn't there yet, which is a normal state until
  // supabase_labs.sql has been re-run — the Pathology view just stays hidden.
  const [pathology, setPathology] = useState(null);

  const [view, setView] = useState(() => localStorage.getItem("bt_labs_view") || "panels");
  // Which system's own screen is open, if any. Not persisted — a drill-down
  // is somewhere you go, not somewhere you leave the app sitting.
  const [zoomSystem, setZoomSystem] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [trendKey, setTrendKey] = useState(null);
  // Written reports and the history they read. null on either means
  // supabase_labs.sql hasn't been re-run since these tables were added — the
  // rest of the tab works, and the feature stays hidden rather than erroring.
  const [reports, setReports] = useState(null);
  const [history, setHistory] = useState(null);
  const [openReport, setOpenReport] = useState(null);   // report id being read
  const [historyOpen, setHistoryOpen] = useState(false);
  const [writing, setWriting] = useState(false);
  const [query, setQuery] = useState("");
  const [confirmDel, setConfirmDel] = useState(null);
  const [editing, setEditing] = useState(null);   // { id, value, unit, ref_low, ref_high }
  const [busy, setBusy] = useState(false);

  // Imports queue up: a folder of reports is the normal case, and each one
  // gets reviewed on its own before it's saved.
  const [queue, setQueue] = useState(null);       // { items: [...], at: 0 } | null
  const fileRef = useRef(null);

  useEffect(() => { localStorage.setItem("bt_labs_view", view); }, [view]);

  // --- load ----------------------------------------------------------------

  const reload = useCallback(async () => {
    const ps = await labsApi.fetchPanels();
    const rs = await labsApi.fetchResults(ps.map(p => p.id));
    setPanels(ps);
    setResults(rs);
    // Supplementary, and on tables that may not exist yet — so they must not
    // hold up the first render or fail the whole tab if slow or absent.
    labsApi.fetchPathology().then(setPathology).catch(() => setPathology(null));
    labsApi.fetchReports().then(setReports).catch(() => setReports(null));
    labsApi.fetchHistory().then(setHistory).catch(() => setHistory(null));
    return ps;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ps = await reload();
        if (cancelled) return;
        setExpanded(ps[0]?.id ?? null);
        setStatus("ready");
      } catch (e) {
        if (cancelled) return;
        setStatus("error");
        setErr(
          /relation .* does not exist|schema cache/i.test(e.message || "")
            ? "The lab tables aren't set up yet — run supabase_labs.sql in the Supabase SQL editor, then reload."
            : `Couldn't load your labs: ${e.message}`
        );
      }
    })();
    return () => { cancelled = true; };
  }, [reload]);

  const runWrite = useCallback(async (fn, failMessage) => {
    setBusy(true);
    setErr("");
    try {
      await fn();
      return true;
    } catch (e) {
      setErr(`${failMessage}: ${e.message}`);
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  // --- derived -------------------------------------------------------------

  /** Newest draw first. Falls back to insertion order for unparseable dates. */
  const orderedPanels = useMemo(() => {
    return [...panels].sort((a, b) => {
      const da = parseDate(a.date), db = parseDate(b.date);
      if (da && db) return db - da;
      if (da) return -1;
      if (db) return 1;
      return String(b.created_at || "").localeCompare(String(a.created_at || ""));
    });
  }, [panels]);

  const resultsByPanel = useMemo(() => {
    const m = new Map();
    for (const r of results) {
      if (!m.has(r.panel_id)) m.set(r.panel_id, []);
      m.get(r.panel_id).push(r);
    }
    for (const [, list] of m) list.splice(0, list.length, ...sortResults(list));
    return m;
  }, [results]);

  const panelDate = useCallback((id) => {
    const p = panels.find(x => x.id === id);
    return p ? parseDate(p.date) : null;
  }, [panels]);

  /** Every reading of one marker, oldest first — the trend line. */
  const seriesFor = useCallback((markerKey) => {
    return results
      .filter(r => r.marker === markerKey && r.value != null)
      .map(r => ({ ...r, at: panelDate(r.panel_id) }))
      .filter(r => r.at)
      .sort((a, b) => a.at - b.at);
  }, [results, panelDate]);

  /** One row per marker: its latest reading, and the move since the one before. */
  const markerRows = useMemo(() => {
    const byMarker = new Map();
    for (const r of results) {
      if (!byMarker.has(r.marker)) byMarker.set(r.marker, []);
      byMarker.get(r.marker).push(r);
    }
    const rows = [];
    for (const [marker, list] of byMarker) {
      const dated = list.map(r => ({ ...r, at: panelDate(r.panel_id) })).filter(r => r.at).sort((a, b) => b.at - a.at);
      const latest = dated[0] || list[0];
      if (!latest) continue;
      const prev = dated.find(r => r.value != null && r !== latest && r.at < latest.at);
      const delta = latest.value != null && prev?.value != null ? latest.value - prev.value : null;
      // The 80/20 read: is this a number that needs eyes on it? "now" is an
      // unfavourable flag on the latest reading; "past" is a marker that has
      // been flagged before but recovered — worth a glance, not an alarm.
      // A favourable excursion (high HDL, high eGFR) is neither.
      // Where the report gave no range, fall back to the app's own so a
      // marker like calprotectin can still be called. flagFor derives from
      // whichever range applies; the lab's own flag still wins when it set one.
      const flagOf = (r) => {
        if (r.flag) return r.flag;
        const er = effectiveRange(marker, r);
        return er.fromLab ? null : flagFor(r.value, er.lo, er.hi);
      };
      const unfavourable = (r) => {
        const f = flagOf(r);
        return f && f !== "normal" && !isFavorable(marker, f);
      };
      const ref = effectiveRange(marker, latest);
      const edge = borderlineFor(marker, latest.value, ref.lo, ref.hi);
      // Out of range now > inside but hugging the bad edge > was out once >
      // fine. Borderline outranks a historic flag: a number drifting toward
      // the edge today is more actionable than one that recovered years ago.
      const attention = unfavourable(latest) ? "now"
        : edge ? "borderline"
        : list.some(unfavourable) ? "past"
        : "ok";
      rows.push({
        marker,
        name: markerDisplayName(marker, latest.name),
        labName: latest.name,
        category: latest.category || "Other",
        latest,
        delta,
        count: list.length,
        at: latest.at,
        attention,
        edge,
        // The flag actually shown — derived from the app range when the
        // report gave none, so the colour matches the verdict.
        flag: flagOf(latest),
        ref,
        range: ref.text,
      });
    }
    const rank = (c) => {
      const i = MARKER_CATEGORIES.indexOf(c || "Other");
      return i < 0 ? MARKER_CATEGORIES.length : i;
    };
    return rows.sort((a, b) => rank(a.category) - rank(b.category) || a.name.localeCompare(b.name));
  }, [results, panelDate]);

  /**
   * One card per body system: its markers (latest reading each, reusing the
   * marker rows so the numbers agree everywhere), its flagged count, and any
   * narrative studies it claims. Markers appear in several cards on purpose —
   * ferritin is iron and inflammation and IBD-monitoring at once.
   */
  const systemCards = useMemo(() => {
    return SYSTEMS.map(s => {
      const rows = markerRows.filter(r => systemsFor(r.marker).some(x => x.key === s.key));
      // Counts what the colours say: the same attention reckoning the rows
      // use, so a badge never disagrees with the numbers under it.
      const flagged = rows.filter(r => r.attention === "now").length;
      const nearEdge = rows.filter(r => r.attention === "borderline").length;
      const studies = s.studies ? (pathology || []).filter(s.studies) : [];
      return { ...s, rows, flagged, nearEdge, studies };
    }).filter(s => s.rows.length || s.studies.length);
  }, [markerRows, pathology]);

  /**
   * Stat cards for the pinned systems. Of the system's declared headline
   * markers, the first with data is the hero number and the next couple show
   * as compact rows beneath it — B12 rides under vitamin D, free T under
   * total. If none have data: the first flagged marker in the system, then
   * simply its first marker — a card with a stand-in number beats a blank
   * card, and a system with no data at all gets no card.
   */
  const pinnedStats = useMemo(() => {
    return SYSTEMS.filter(s => s.pinned).map(s => {
      const rows = markerRows.filter(r => systemsFor(r.marker).some(x => x.key === s.key));
      if (!rows.length) return null;
      const headlined = (s.headline || []).map(k => rows.find(r => r.marker === k)).filter(Boolean);
      const row =
        headlined[0] ||
        rows.find(r => r.latest.flag && r.latest.flag !== "normal") ||
        rows[0];
      const extras = headlined.slice(1, 3);
      // Counts what the colours say: the same attention reckoning the rows
      // use, so a badge never disagrees with the numbers under it.
      const flagged = rows.filter(r => r.attention === "now").length;
      const nearEdge = rows.filter(r => r.attention === "borderline").length;
      return { key: s.key, name: s.name, short: s.short, row, extras, flagged, nearEdge };
    }).filter(Boolean);
  }, [markerRows]);

  const filteredMarkers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return markerRows;
    return markerRows.filter(r =>
      r.name.toLowerCase().includes(q) || r.labName.toLowerCase().includes(q) || r.category.toLowerCase().includes(q)
    );
  }, [markerRows, query]);

  const latestPanel = orderedPanels[0] || null;
  /**
   * What the most recent draw flagged.
   *
   * By date, not by panel: this lab splits one morning's blood work into a
   * separate lab_panels row per test ordered, so "the latest panel" is an
   * arbitrary third of a single draw. Read that way, a low vitamin D sitting
   * on a sibling panel of the same date simply didn't appear.
   */
  const latestFlagged = useMemo(() => {
    if (!latestPanel) return [];
    return panels
      .filter(p => p.date === latestPanel.date)
      .flatMap(p => resultsByPanel.get(p.id) || [])
      .filter(r => r.flag && r.flag !== "normal");
  }, [latestPanel, panels, resultsByPanel]);

  // --- import --------------------------------------------------------------

  const draftFromParse = useCallback((parsed, fileName) => {
    const rows = parsed.results.map(r => ({
      include: true,
      name: r.name,
      value: r.value == null ? "" : String(r.value),
      value_text: r.value_text || "",
      unit: r.unit || "",
      ref_low: r.ref_low == null ? "" : String(r.ref_low),
      ref_high: r.ref_high == null ? "" : String(r.ref_high),
      ref_text: r.ref_text || "",
      flag: r.flag || null,
    }));
    return blankDraft({
      date: isoToMDY(parsed.panel.collected_date) || formatMDY(todayDate()),
      lab_name: parsed.panel.lab_name || "",
      panel_name: parsed.panel.panel_name || "",
      source: parsed.panel.source || "pdf",
      file_name: parsed.panel.file_name || fileName,
      note: parsed.panel.note || "",
      confidence: parsed.panel.confidence || "",
      // Only when the report actually printed it — the reader is told not to
      // infer fasting from which tests were ordered.
      fasted: parsed.panel.fasting || "",
      rows,
    });
  }, []);

  const handleFiles = useCallback(async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setErr("");
    setQueue({ at: 0, items: files.map(f => ({ name: f.name, state: "parsing", draft: null, error: "" })) });

    // Sequential on purpose: these are big uploads on a phone connection, and
    // firing five at once is how you get five timeouts instead of five reads.
    for (let i = 0; i < files.length; i++) {
      try {
        const payload = await prepareLabFile(files[i]);
        const parsed = await labsApi.readLabFile(payload);
        setQueue(q => {
          if (!q) return q;
          const items = [...q.items];
          items[i] = parsed.panel
            ? { ...items[i], state: "ready", draft: draftFromParse(parsed, files[i].name) }
            : { ...items[i], state: "error", error: parsed.error || "Nothing readable in that file." };
          return { ...q, items };
        });
      } catch (e) {
        setQueue(q => {
          if (!q) return q;
          const items = [...q.items];
          items[i] = { ...items[i], state: "error", error: e.message };
          return { ...q, items };
        });
      }
    }
  }, [draftFromParse]);

  const openManual = useCallback(() => {
    setErr("");
    setQueue({
      at: 0,
      items: [{ name: "By hand", state: "ready", draft: blankDraft({ rows: [blankRow(), blankRow(), blankRow()] }), error: "" }],
    });
  }, []);

  const current = queue ? queue.items[queue.at] : null;

  const patchDraft = useCallback((patch) => {
    setQueue(q => {
      if (!q) return q;
      const items = [...q.items];
      items[q.at] = { ...items[q.at], draft: { ...items[q.at].draft, ...patch } };
      return { ...q, items };
    });
  }, []);

  const patchRow = useCallback((idx, patch) => {
    setQueue(q => {
      if (!q) return q;
      const items = [...q.items];
      const draft = items[q.at].draft;
      const rows = [...draft.rows];
      rows[idx] = { ...rows[idx], ...patch };
      items[q.at] = { ...items[q.at], draft: { ...draft, rows } };
      return { ...q, items };
    });
  }, []);

  const advance = useCallback(() => {
    setQueue(q => {
      if (!q) return q;
      const next = q.items.findIndex((it, i) => i > q.at && it.state !== "saved");
      if (next < 0) {
        // Nothing left worth reviewing — but keep an unsaved earlier item open.
        const back = q.items.findIndex(it => it.state === "ready");
        return back < 0 ? null : { ...q, at: back };
      }
      return { ...q, at: next };
    });
  }, []);

  const saveDraft = useCallback(async () => {
    const draft = current?.draft;
    if (!draft) return;
    const rows = draft.rows.filter(isSavable);
    if (!rows.length) {
      setErr("Nothing to save — every row is either unticked or empty.");
      return;
    }
    if (!parseDate(draft.date)) {
      setErr("That date isn't one I can read — use M/D/YY, like 3/14/26.");
      return;
    }

    const ok = await runWrite(async () => {
      await labsApi.createPanel({
        panel: {
          date: draft.date,
          lab_name: draft.lab_name.trim() || null,
          panel_name: draft.panel_name.trim() || null,
          source: draft.source,
          file_name: draft.file_name || null,
          note: draft.note.trim() || null,
          drawn_at: draft.drawn_at.trim() || null,
          fasted: draft.fasted || null,
          infusion_relation: draft.infusion_relation || null,
        },
        results: rows.map(r => {
          const m = resolveMarker(r.name, draft.panel_name);
          const value = num(r.value);
          const refLow = num(r.ref_low);
          const refHigh = num(r.ref_high);
          return {
            marker: m.key,
            name: r.name.trim(),
            category: m.category,
            value,
            value_text: r.value_text.trim() || null,
            unit: r.unit.trim() || null,
            ref_low: refLow,
            ref_high: refHigh,
            ref_text: r.ref_text.trim() || null,
            // The lab's own flag wins; ours fills in when it printed none.
            flag: r.flag || flagFor(value, refLow, refHigh),
          };
        }),
      });
      const ps = await reload();
      setExpanded(ps[0]?.id ?? null);
    }, "Couldn't save that report");

    if (!ok) return;
    setQueue(q => {
      if (!q) return q;
      const items = [...q.items];
      items[q.at] = { ...items[q.at], state: "saved" };
      return { ...q, items };
    });
    advance();
  }, [current, runWrite, reload, advance]);

  // --- per-result edits ----------------------------------------------------

  const saveEdit = useCallback(async () => {
    if (!editing) return;
    const value = num(editing.value);
    const refLow = num(editing.ref_low);
    const refHigh = num(editing.ref_high);
    const ok = await runWrite(async () => {
      const saved = await labsApi.updateResult(editing.id, {
        value,
        unit: editing.unit.trim() || null,
        ref_low: refLow,
        ref_high: refHigh,
        // Rewritten from the edited bounds: keeping the report's original
        // wording here would keep displaying the range that was just changed.
        ref_text: fmtBounds(refLow, refHigh) || null,
        flag: flagFor(value, refLow, refHigh),
      });
      setResults(rs => rs.map(r => (r.id === saved.id ? saved : r)));
    }, "Couldn't update that result");
    if (ok) setEditing(null);
  }, [editing, runWrite]);

  const removeResult = useCallback((id) => runWrite(async () => {
    await labsApi.deleteResult(id);
    setResults(rs => rs.filter(r => r.id !== id));
  }, "Couldn't delete that result"), [runWrite]);

  const removePanel = useCallback((id) => runWrite(async () => {
    await labsApi.deletePanel(id);
    setPanels(ps => ps.filter(p => p.id !== id));
    setResults(rs => rs.filter(r => r.panel_id !== id));
  }, "Couldn't delete that report"), [runWrite]);

  const removePathology = useCallback((id) => runWrite(async () => {
    await labsApi.deletePathology(id);
    setPathology(rs => (rs || []).filter(r => r.id !== id));
  }, "Couldn't delete that report"), [runWrite]);

  // --- written reports -----------------------------------------------------

  /** Each system's thread, newest first (the fetch already orders them). */
  const reportsBySystem = useMemo(() => {
    const m = new Map();
    for (const r of reports || []) {
      if (!m.has(r.system_key)) m.set(r.system_key, []);
      m.get(r.system_key).push(r);
    }
    return m;
  }, [reports]);

  /**
   * Everything a report is written from, assembled from what's already in
   * memory. Text results come along with the numeric ones: "Negative" on a
   * stool pathogen panel is how infection got ruled out, and a brief built
   * only from numbers would leave that out of the reasoning entirely.
   */
  const briefFor = useCallback((card) => {
    const dateOf = new Map(panels.map(p => [p.id, p.date]));
    const ctxOf = new Map(panels.map(p => [p.id, drawContext(p)]));
    const readings = {};
    for (const row of card.rows) {
      readings[row.marker] = results
        .filter(r => r.marker === row.marker)
        .map(r => ({ ...r, at: panelDate(r.panel_id) }))
        .filter(r => r.at)
        .sort((a, b) => a.at - b.at)
        .map(r => ({
          date: dateOf.get(r.panel_id) || "",
          value: r.value,
          valueText: r.value_text,
          unit: r.unit,
          flag: r.flag,
          refText: r.ref_text,
          context: ctxOf.get(r.panel_id) || "",
        }));
    }
    return buildReportBrief({
      system: card,
      rows: card.rows.map(r => ({ ...r, unit: r.latest.unit || "" })),
      readings,
      studies: card.studies,
      history: history || [],
      previous: reportsBySystem.get(card.key)?.[0] || null,
      today: formatMDY(todayDate()),
    });
  }, [panels, results, panelDate, history, reportsBySystem]);

  /**
   * Everything in this system a report would read, by id.
   *
   * Every panel any of its markers appear on — not just the latest, because a
   * marker measured once in 2019 is still a draw the report saw — plus the
   * narrative studies the system claims. A colon biopsy landing between
   * reports is exactly the sort of thing an update should be prompted by.
   */
  const sourceIdsFor = useCallback((card) => {
    const keys = new Set(card.rows.map(r => r.marker));
    const ids = new Set(card.studies.map(s => s.id));
    for (const r of results) if (keys.has(r.marker) && r.panel_id) ids.add(r.panel_id);
    return [...ids];
  }, [results]);

  const generateReport = useCallback(async (card) => {
    const previous = reportsBySystem.get(card.key)?.[0] || null;
    const covered = sourceIdsFor(card);

    const latestDate = card.rows
      .map(r => panels.find(p => p.id === r.latest.panel_id)?.date)
      .filter(Boolean)
      .sort((a, b) => (parseDate(b) || 0) - (parseDate(a) || 0))[0] || null;

    setWriting(true);
    setErr("");
    try {
      const out = await labsApi.writeLabReport({
        system: card.name,
        mode: previous ? "update" : "first",
        brief: briefFor(card),
      });
      const saved = await labsApi.createReport({
        system_key: card.key,
        system_name: card.name,
        title: out.title,
        summary: out.summary || null,
        body: out.body,
        model: out.model || null,
        effort: out.effort || null,
        covered_panel_ids: covered,
        latest_panel_date: latestDate,
        marker_count: card.rows.length,
        prev_report_id: previous?.id || null,
      });
      setReports(rs => [saved, ...(rs || [])]);
      setOpenReport(saved.id);
    } catch (e) {
      // The endpoint already writes a full sentence, so prefixing it again
      // produced "Couldn't write that report: Couldn't write that report: …".
      const msg = String(e.message || "");
      setErr(
        /relation .* does not exist|schema cache|could not find the table/i.test(msg)
          ? "Reports need a table that isn't there yet — re-run supabase_labs.sql in the Supabase SQL editor, then reload."
          : /^Couldn't|^That report took/.test(msg) ? msg : `Couldn't write that report: ${msg}`
      );
    } finally {
      setWriting(false);
    }
  }, [reportsBySystem, briefFor, sourceIdsFor, panels]);

  const removeReport = useCallback((id) => runWrite(async () => {
    await labsApi.deleteReport(id);
    setReports(rs => (rs || []).filter(r => r.id !== id));
    setOpenReport(cur => (cur === id ? null : cur));
  }, "Couldn't delete that report"), [runWrite]);

  // --- render --------------------------------------------------------------

  /**
   * One marker row, shared by the By marker and By system views. The
   * reference range sits directly under the value — a number without its
   * range is only half a reading.
   */
  const markerRowBtn = (row) => (
    <button key={row.marker} className="labs-marker-row" onClick={() => setTrendKey(row.marker)}>
      <span className="lmr-main">
        <span className="lmr-name">{row.name}</span>
        <span className="lmr-meta">
          {row.category} · {row.count} reading{row.count === 1 ? "" : "s"} · latest {row.latest.value != null ? "" : "(text) "}
          {panels.find(p => p.id === row.latest.panel_id)?.date || ""}
        </span>
      </span>
      <span className="lmr-right">
        <span className={"lmr-value" + attentionClass(row)}>
          {row.latest.value != null ? fmtValue(row.latest.value) : (row.latest.value_text || "–")}
          <span className="lmr-unit"> {row.latest.unit || ""}</span>
        </span>
        {row.range && <span className="lmr-range">{row.range}</span>}
        {/* Where inside the range the value sits — the track is the range,
            the dot is you. Out-of-range clamps to the edge in red. */}
        {(() => {
          const g = gaugeScale(row.marker, row.latest.value, row.ref.lo, row.ref.hi);
          if (!g) return null;
          return (
            <span className="lmr-gauge" style={{ background: gaugePaint(g.zones) }}>
              {g.marks.map(m => <span key={m.kind} className="lmr-gauge-mark" style={{ left: `${m.at * 100}%` }} />)}
              <span
                className={"lmr-gauge-dot" + (row.attention === "now" ? " lmr-gauge-off" : row.attention === "borderline" ? " lmr-gauge-edge" : "")}
                style={{ left: `${g.pos * 100}%` }}
              />
            </span>
          );
        })()}
      </span>
      <span className={"lmr-delta" + (row.delta == null ? " lmr-delta-none" : "")}>
        {row.delta == null ? "–" : `${row.delta > 0 ? "+" : ""}${fmtValue(row.delta)}`}
      </span>
      <TrendingUp size={13} className="lmr-chev" />
    </button>
  );

  // Newest first, same rule as the report list.
  const orderedPathology = useMemo(() => {
    return [...(pathology || [])].sort((a, b) => {
      const da = parseDate(a.date), db = parseDate(b.date);
      if (da && db) return db - da;
      if (da) return -1;
      if (db) return 1;
      return String(b.created_at || "").localeCompare(String(a.created_at || ""));
    });
  }, [pathology]);
  const hasPathology = orderedPathology.length > 0;
  // The choice is remembered across reloads, so it can outlive the reports it
  // pointed at — fall back rather than showing an empty view with no toggle.
  const activeView = view === "pathology" && !hasPathology ? "panels" : view;

  if (status === "loading") {
    return (
      <div className="labs-view">
        <style>{LAB_STYLES}</style>
        <div className="dash-loading"><Loader2 className="spin" size={20} /><span>Loading your labs…</span></div>
      </div>
    );
  }

  const DeleteBtn = ({ id, onDelete, size = 12 }) => (
    <button
      className={"icon-btn danger" + (confirmDel === id ? " armed" : "")}
      title={confirmDel === id ? "Click again to confirm" : "Delete"}
      onMouseLeave={() => { if (confirmDel === id) setConfirmDel(null); }}
      onClick={() => {
        if (confirmDel === id) { onDelete(); setConfirmDel(null); }
        else setConfirmDel(id);
      }}>
      <Trash2 size={size} />
    </button>
  );

  // ---------------- Reading one report ----------------
  // A whole screen rather than a sheet: this is the longest piece of prose in
  // the app, and it is meant to be read rather than glanced at.
  if (openReport) {
    const rep = (reports || []).find(r => r.id === openReport);
    if (!rep) { setOpenReport(null); return null; }
    const thread = reportsBySystem.get(rep.system_key) || [];
    const idx = thread.findIndex(r => r.id === rep.id);

    return (
      <div className="labs-view">
        <style>{LAB_STYLES}</style>
        <div className="labs-zoom-head">
          <button className="btn-ghost sm" onClick={() => setOpenReport(null)}>
            <ChevronLeft size={14} /> {rep.system_name}
          </button>
          <DeleteBtn id={rep.id} onDelete={() => removeReport(rep.id)} size={13} />
        </div>

        <article className="panel labs-report">
          <div className="labs-report-meta">
            {formatMDY(new Date(rep.created_at))} · {rep.system_name}
            {rep.latest_panel_date && <> · covers draws to {rep.latest_panel_date}</>}
            {thread.length > 1 && <> · #{thread.length - idx} of {thread.length}</>}
          </div>
          <Markdown text={rep.body} />
        </article>

        {/* Provenance, not a hedge. This is generated prose about someone's
            health that will be re-read months from now, so which model wrote
            it and when is part of reading it. */}
        <p className="labs-zoom-foot">
          Written by {rep.model || "an AI model"} on {formatMDY(new Date(rep.created_at))} from the results
          and history recorded in this app. It has no examination and no symptom history, so treatment decisions
          belong with your care team.
        </p>

        {idx >= 0 && idx < thread.length - 1 && (
          <button className="btn-ghost sm labs-report-prev" onClick={() => setOpenReport(thread[idx + 1].id)}>
            <ChevronLeft size={12} /> The report before this one
          </button>
        )}
      </div>
    );
  }

  // ---------------- Medical history ----------------
  // What the numbers can't carry. Calprotectin at 160 reads one way on
  // anti-TNF therapy and another off it, so this is the difference between a
  // report that reasons and one that describes.
  if (historyOpen) {
    return (
      <HistoryScreen
        entries={history}
        busy={busy}
        // Back goes wherever you came from — the system screen stays open
        // underneath — so the label has to say which that is.
        backLabel={zoomSystem ? (systemCards.find(x => x.key === zoomSystem)?.name || "Back") : "All labs"}
        onBack={() => setHistoryOpen(false)}
        onAdd={(entry) => runWrite(async () => {
          const saved = await labsApi.addHistory(entry);
          setHistory(hs => [...(hs || []), saved]);
        }, "Couldn't save that")}
        onPatch={(id, patch) => runWrite(async () => {
          const saved = await labsApi.updateHistory(id, patch);
          setHistory(hs => (hs || []).map(h => (h.id === saved.id ? saved : h)));
        }, "Couldn't update that")}
        onDelete={(id) => runWrite(async () => {
          await labsApi.deleteHistory(id);
          setHistory(hs => (hs || []).filter(h => h.id !== id));
        }, "Couldn't delete that")}
        DeleteBtn={DeleteBtn}
        error={err}
      />
    );
  }

  // ---------------- One system's own screen ----------------
  // A drill-down rather than another list: everything about one area of the
  // body, with the plain-language notes that the compact rows have no room
  // for. Reached from a hero card or a system row; leaves by the back button.
  if (zoomSystem) {
    const s = systemCards.find(x => x.key === zoomSystem);
    if (!s) { setZoomSystem(null); return null; }
    const rank = { now: 0, borderline: 1, past: 2, ok: 3 };
    const ordered = [...s.rows].sort((a, b) => rank[a.attention] - rank[b.attention] || a.name.localeCompare(b.name));
    // Grouped where the system says how, in the order it declares — 35 markers
    // in one run is a list, not an answer. The verdict above already names
    // what's wrong, so attention ordering can happen inside a group instead of
    // scattering related markers across the screen. A system with no groups
    // renders as one unnamed run, exactly as before.
    const groups = (() => {
      if (!SYSTEMS.find(x => x.key === s.key)?.groups) return [{ name: null, rows: ordered }];
      const byName = new Map();
      for (const row of ordered) {
        const g = groupFor(s.key, row.marker) || { name: "Other" };
        if (!byName.has(g.name)) byName.set(g.name, { name: g.name, blurb: g.blurb, rows: [] });
        byName.get(g.name).rows.push(row);
      }
      const order = (SYSTEMS.find(x => x.key === s.key).groups || []).map(g => g.name).concat("Other");
      return [...byName.values()].sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
    })();
    const needs = ordered.filter(r => r.attention === "now");
    const edges = ordered.filter(r => r.attention === "borderline");

    return (
      <div className="labs-view">
        <style>{LAB_STYLES}</style>
        <div className="labs-zoom-head">
          <button className="btn-ghost sm" onClick={() => setZoomSystem(null)}><ChevronLeft size={14} /> All labs</button>
        </div>

        {/* Without this a failed report was invisible: setErr fired, and the
            only banner-error in the tab lives on the list view behind this
            screen. The spinner stopped and nothing else happened. */}
        {err && <div className="banner-error"><AlertCircle size={13} /> {err}</div>}

        <div className="labs-zoom-title">
          <h2 className="panel-title">{s.name}</h2>
          <div className="labs-zoom-blurb">{s.blurb}</div>
        </div>

        {/* The one-line answer to "how is this area doing?" before any rows. */}
        <div className={"labs-zoom-verdict" + (needs.length ? " labs-zoom-verdict-off" : edges.length ? " labs-zoom-verdict-edge" : " labs-zoom-verdict-ok")}>
          {needs.length > 0 && (
            <>{needs.length} marker{needs.length === 1 ? " is" : "s are"} outside range right now — {needs.map(r => r.name).join(", ")}.</>
          )}
          {needs.length > 0 && edges.length > 0 && " "}
          {edges.length > 0 && (
            <>{needs.length ? "Another " : ""}{edges.length} {edges.length === 1 ? "is" : "are"} inside the range but near the {edges.length === 1 ? "edge" : "edges"} — {edges.map(r => r.name).join(", ")}.</>
          )}
          {needs.length === 0 && edges.length === 0 && (
            <>Every marker in this area is comfortably inside its range on the most recent draw it was measured.</>
          )}
        </div>

        {/* The thread of written reports for this system. Reports are the one
            thing here that reads the medical history as well as the numbers,
            so the entry point to that history sits in the same card. */}
        {reports !== null && (() => {
          const thread = reportsBySystem.get(s.key) || [];
          const latest = thread[0] || null;
          const fresh = newPanelsSince(latest, sourceIdsFor(s));
          const histCount = (history || []).length;
          return (
            <div className="panel labs-reports">
              <div className="labs-reports-head">
                <div className="lzc-name"><BookOpen size={13} /> Reports</div>
                {/* Ghost when there's nothing new: a green button inviting
                    the action the line below it argues against reads as a
                    recommendation, and it isn't one. */}
                <button
                  className={(latest && !fresh.length ? "btn-ghost" : "btn-primary") + " sm"}
                  disabled={writing || busy || !s.rows.length}
                  onClick={() => generateReport(s)}>
                  {writing
                    ? <><Loader2 size={13} className="spin" /> Writing…</>
                    : !latest ? <>Write a report</>
                    : fresh.length ? <>Update report</>
                    : <>Write another</>}
                </button>
              </div>

              <div className="labs-reports-sub">
                {!latest
                  ? <>A full read of every {s.name} marker here, written against your medical history. Takes about a minute.</>
                  : fresh.length
                    ? <>{fresh.length} new {fresh.length === 1 ? "result set" : "result sets"} since the last report — an update will say what changed.</>
                    : <>Nothing new since the last report. Writing another would give you a second opinion on the same numbers rather than an update.</>}
              </div>

              {writing && (
                <div className="labs-reports-wait">
                  <Loader2 size={13} className="spin" />
                  <span>
                    Reading {s.rows.length} marker{s.rows.length === 1 ? "" : "s"} across your whole history,
                    against {(history || []).length} history {(history || []).length === 1 ? "entry" : "entries"}.
                    {" "}<strong><Elapsed /></strong> so far — a full system takes a minute or so. Don't leave the tab.
                  </span>
                </div>
              )}

              {thread.map(r => (
                <button key={r.id} className="labs-report-row" onClick={() => setOpenReport(r.id)}>
                  <span className="lrr-title">{r.title}</span>
                  <span className="lrr-meta">
                    {formatMDY(new Date(r.created_at))}
                    {r.latest_panel_date && <> · to {r.latest_panel_date}</>}
                  </span>
                  {r.summary && <span className="lrr-summary">{r.summary}</span>}
                </button>
              ))}

              {history !== null && (
                <button className="btn-ghost sm labs-reports-hist" onClick={() => setHistoryOpen(true)}>
                  <Heart size={12} /> Medical history — {histCount || "nothing"} {histCount === 1 ? "entry" : histCount ? "entries" : "recorded yet"}
                </button>
              )}
            </div>
          );
        })()}

        {groups.map(group => (
        <React.Fragment key={group.name || "all"}>
        {group.name && (
          <div className="labs-group-head">
            <span className="labs-group-name">{group.name}</span>
            <span className="labs-group-count">
              {group.rows.length}
              {group.rows.some(r => r.attention === "now") && <span className="labs-panel-flagged">{group.rows.filter(r => r.attention === "now").length} flagged</span>}
            </span>
            {group.blurb && <span className="labs-group-blurb">{group.blurb}</span>}
          </div>
        )}
        {group.rows.map(row => {
          const note = markerNote(row.marker);
          // The effective range, not the raw row — otherwise a marker whose
          // range the app supplies (calprotectin) draws neither the scale nor
          // the shaded band, and the note claiming a shaded band is a lie.
          const lo = row.ref.lo, hi = row.ref.hi;
          const scale = gaugeScale(row.marker, row.latest.value, lo, hi);
          return (
            <div className="panel labs-zoom-card" key={row.marker}>
              <div className="lzc-head">
                <div className="lzc-name">
                  {row.name}
                  {row.attention === "now" && <span className="labs-panel-flagged">out of range</span>}
                  {row.attention === "borderline" && (
                    <span className="lzc-edge">{row.edge === "low" ? "low end of range" : "high end of range"}</span>
                  )}
                  {row.attention === "past" && <span className="lzc-past">was flagged</span>}
                  {!row.ref.fromLab && <span className="lzc-appref">app reference</span>}
                </div>
                <div className={"lzc-value" + attentionClass(row)}>
                  {row.latest.value != null ? fmtValue(row.latest.value) : (row.latest.value_text || "–")}
                  <span className="lmr-unit"> {row.latest.unit || ""}</span>
                </div>
              </div>

              {scale ? (
                <div className="lzc-scale">
                  <div className="lzc-track" style={{ background: gaugePaint(scale.zones) }}>
                    {/* Where normal ended. Without it the colour change on an
                        extended bar is unexplained. */}
                    {scale.marks.map(m => (
                      <span key={m.kind} className="lzc-mark" style={{ left: `${m.at * 100}%` }} />
                    ))}
                    <span
                      className={"lzc-dot" + (row.attention === "now" ? " lzc-dot-off" : row.attention === "borderline" ? " lzc-dot-edge" : "")}
                      style={{ left: `${scale.pos * 100}%` }}
                    />
                  </div>
                  {/* When a bound label lands on top of an axis label, the
                      bound wins: an extended axis ends at the reading, which
                      is already in large type above, while the bound is the
                      number you can't get anywhere else on this card. */}
                  {(() => {
                    const crowds = (edge) => scale.marks.some(m => Math.abs(m.at - edge) < 0.1);
                    return (
                      <div className="lzc-ends">
                        <span>{crowds(0) ? "" : fmtValue(scale.min)}</span>
                        {scale.marks.map(m => (
                          <span key={m.kind} className="lzc-mark-label" style={{ left: `${m.at * 100}%` }}>{fmtValue(m.value)}</span>
                        ))}
                        <span>{crowds(1) ? "" : fmtValue(scale.max)}</span>
                      </div>
                    );
                  })()}
                </div>
              ) : row.range ? (
                <div className="lzc-rangeonly">Reference: {row.range}</div>
              ) : null}

              <div className="lzc-meta">
                {row.count} reading{row.count === 1 ? "" : "s"} · latest {panels.find(p => p.id === row.latest.panel_id)?.date || "–"}
                {row.delta != null && <> · {row.delta > 0 ? "+" : ""}{fmtValue(row.delta)} since previous</>}
              </div>

              {!row.ref.fromLab && row.ref.why && (
                <div className="lzc-appnote">
                  <strong>This range isn't from your lab.</strong> The report printed none, so the app supplies one. {row.ref.why}
                </div>
              )}

              {note && (
                <div className="lzc-note">
                  <p><strong>What it is.</strong> {note.what}</p>
                  <p><strong>What moves it.</strong> {note.moves}</p>
                </div>
              )}

              <button className="btn-ghost sm lzc-trend" onClick={() => setTrendKey(row.marker)}>
                <TrendingUp size={12} /> Full trend
              </button>
            </div>
          );
        })}
        </React.Fragment>
        ))}

        {s.studies.length > 0 && (
          <div className="panel labs-zoom-card">
            <div className="lzc-name">Related studies</div>
            <div className="labs-sys-studies">
              {s.studies.map(st => (
                <button key={st.id} className="labs-sys-study" onClick={() => { setZoomSystem(null); setView("pathology"); setExpanded(st.id); }}>
                  <FileText size={11} /> {st.date} · {st.report_name}
                </button>
              ))}
            </div>
          </div>
        )}

        <p className="labs-zoom-foot">
          These notes describe what each test measures and what generally moves it. What your own numbers mean —
          and what to do about them — depends on your symptoms, treatment and history, and belongs with your care team.
        </p>

        {trendKey && (
          <TrendSheet
            markerKey={trendKey}
            series={seriesFor(trendKey)}
            fallbackName={results.find(r => r.marker === trendKey)?.name}
            onClose={() => setTrendKey(null)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="labs-view">
      <style>{LAB_STYLES}</style>

      {err && <div className="banner-error"><AlertCircle size={13} /> {err}</div>}

      {/* ---------------- Add + summary ----------------
           The summary cards aren't in a panel: on the Home tab cards sit
           straight on the page background, and the Food tab's day tiles do
           the same. Inside a panel they were white cards on white. */}
      <div className="labs-head">
        <div className="panel-head labs-head-row">
          <h2 className="panel-title"><FlaskConical size={14} /> Lab results</h2>
          <div className="panel-head-actions labs-head-actions">
            <button className="btn-primary sm" onClick={() => fileRef.current?.click()} disabled={busy}>
              <Upload size={13} /> Add a report
            </button>
            <button className="btn-ghost sm" onClick={openManual} disabled={busy}>
              <Plus size={13} /> Add by hand
            </button>
            {/* Not a fifth view toggle: history is written rarely and read by
                the reports rather than by you, so it lives behind a button
                instead of taking a permanent slot on a phone-width row. */}
            {history !== null && (
              <button className="btn-ghost sm" onClick={() => setHistoryOpen(true)} disabled={busy}>
                <Heart size={13} /> History
              </button>
            )}
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPTED_FILE_TYPES}
          multiple
          style={{ display: "none" }}
          onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }}
        />
      </div>

      {panels.length === 0 ? (
        <div className="panel labs-empty-panel">
          <div className="labs-empty">
            <p>Nothing here yet. Pick the PDFs out of your <strong>labs</strong> folder — or photograph the results page — and they'll be read into rows you can check before anything is saved.</p>
            <p className="labs-empty-sub">Several files at once is fine; you review them one at a time.</p>
          </div>
        </div>
      ) : (
        <div className="labs-summary">
          <div className="labs-summary-tile">
            <div className="labs-summary-label">Latest draw</div>
            <div className="labs-summary-value">{latestPanel?.date || "–"}</div>
            <div className="labs-summary-sub">{latestPanel?.lab_name || latestPanel?.panel_name || " "}</div>
          </div>
          <div className="labs-summary-tile">
            <div className="labs-summary-label">Reports</div>
            <div className="labs-summary-value">{panels.length}</div>
            <div className="labs-summary-sub">{results.length} results</div>
          </div>
        </div>
      )}

      {/* The owner's core areas, pinned. Each card leads with its system's
          headline marker — the number you'd check first — and taps through to
          the full system card. */}
      {pinnedStats.length > 0 && (
        <div className="labs-syscards">
          {pinnedStats.map(s => (
            <button
              key={s.key}
              className="labs-syscard"
              onClick={() => setZoomSystem(s.key)}
            >
              <span className="lsc-head">
                <span className="lsc-label">{s.short || s.name}</span>
                {s.flagged > 0 && <span className="labs-panel-flagged">{s.flagged} flagged</span>}
                {s.flagged === 0 && s.nearEdge > 0 && <span className="labs-panel-edge">{s.nearEdge} near edge</span>}
              </span>
              <span className={"lsc-value" + attentionClass(s.row)}>
                {s.row.latest.value != null ? fmtValue(s.row.latest.value) : (s.row.latest.value_text || "–")}
                <span className="lsc-unit"> {s.row.latest.unit || ""}</span>
                {s.row.range && <span className="lsc-range">range {s.row.range}</span>}
              </span>
              {/* A position bar, not a trend line: on a card this size the
                  sparkline was decoration, while "where in the range am I"
                  is the thing worth two seconds. The full trend is one tap
                  away on the system's own screen. */}
              {(() => {
                const g = gaugeScale(s.row.marker, s.row.latest.value, s.row.ref.lo, s.row.ref.hi);
                if (!g) return null;
                return (
                  <span className="lsc-gauge" style={{ background: gaugePaint(g.zones) }}>
                    {g.marks.map(m => <span key={m.kind} className="lsc-gauge-mark" style={{ left: `${m.at * 100}%` }} />)}
                    <span
                      className={"lsc-gauge-dot" + (s.row.attention === "now" ? " lsc-gauge-off" : s.row.attention === "borderline" ? " lsc-gauge-edge" : "")}
                      style={{ left: `${g.pos * 100}%` }}
                    />
                  </span>
                );
              })()}
              <span className="lsc-sub">
                {s.row.name}
                {s.row.delta != null && (
                  <span className="lsc-delta"> · {s.row.delta > 0 ? "+" : ""}{fmtValue(s.row.delta)}</span>
                )}
              </span>
              {s.extras.map(x => (
                <span className="lsc-extra" key={x.marker}>
                  <span className="lsc-extra-name">{x.name}</span>
                  <span className={"lsc-extra-value" + flagClass(x.latest.flag, x.marker)}>
                    {x.latest.value != null ? fmtValue(x.latest.value) : (x.latest.value_text || "–")}
                    {x.latest.unit ? ` ${x.latest.unit}` : ""}
                    {x.delta != null && <span className="lsc-delta"> · {x.delta > 0 ? "+" : ""}{fmtValue(x.delta)}</span>}
                  </span>
                </span>
              ))}
            </button>
          ))}
        </div>
      )}

      {latestFlagged.length > 0 && (
        <div className="labs-flag-strip">
          {latestFlagged.map(r => (
            <button key={r.id} className={"labs-flag-chip" + flagClass(r.flag, r.marker)} onClick={() => setTrendKey(r.marker)}>
              <span className="lfc-name">{markerDisplayName(r.marker, r.name)}</span>
              <span className="lfc-value">
                {fmtValue(r.value)} {r.unit || ""} {r.flag === "high" ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
              </span>
            </button>
          ))}
        </div>
      )}

      {(panels.length > 0 || hasPathology) && (
        <>
          <div className="labs-view-toggle toggle-group">
            <button className={"toggle-btn" + (activeView === "panels" ? " active" : "")} onClick={() => setView("panels")}>
              By report
            </button>
            <button className={"toggle-btn" + (activeView === "markers" ? " active" : "")} onClick={() => setView("markers")}>
              By marker
            </button>
            <button className={"toggle-btn" + (activeView === "systems" ? " active" : "")} onClick={() => setView("systems")}>
              By system
            </button>
            {/* "Studies", not "Reports": the summary tile above already counts
                blood panels under that word, and two different meanings of it
                on one screen reads as a bug. */}
            {hasPathology && (
              <button className={"toggle-btn" + (activeView === "pathology" ? " active" : "")} onClick={() => setView("pathology")}>
                Studies
              </button>
            )}
          </div>

          {activeView === "panels" ? (
            <div className="labs-panels">
              {orderedPanels.map(p => {
                const rows = resultsByPanel.get(p.id) || [];
                const flagged = rows.filter(r => r.flag && r.flag !== "normal").length;
                const open = expanded === p.id;
                return (
                  <div className="panel labs-panel" key={p.id}>
                    <button className="labs-panel-head" onClick={() => setExpanded(open ? null : p.id)}>
                      {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      <span className="labs-panel-date">{p.date}</span>
                      <span className="labs-panel-name">
                        {p.panel_name || "Lab report"}
                        {p.lab_name && <span className="labs-panel-lab"> · {p.lab_name}</span>}
                      </span>
                      <span className="labs-panel-counts">
                        {rows.length} result{rows.length === 1 ? "" : "s"}
                        {flagged > 0 && <span className="labs-panel-flagged">{flagged} flagged</span>}
                      </span>
                    </button>

                    {open && (
                      <div className="labs-panel-body">
                        {p.note && <div className="labs-panel-note">{p.note}</div>}
                        <ResultTable
                          rows={rows}
                          editing={editing}
                          setEditing={setEditing}
                          saveEdit={saveEdit}
                          onTrend={setTrendKey}
                          DeleteBtn={DeleteBtn}
                          removeResult={removeResult}
                        />
                        <div className="labs-panel-foot">
                          {p.file_name && <span className="labs-file"><FileText size={11} /> {p.file_name}</span>}
                          <DeleteBtn id={`panel:${p.id}`} onDelete={() => removePanel(p.id)} size={13} />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : activeView === "systems" ? (
            <div className="labs-panels">
              {systemCards.map(s => {
                const open = expanded === `sys:${s.key}`;
                return (
                  <div className="panel labs-panel" key={s.key}>
                    <button className="labs-panel-head" onClick={() => setExpanded(open ? null : `sys:${s.key}`)}>
                      {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      <span className="labs-panel-name">
                        {s.name}
                        <span className="labs-panel-lab"> · {s.blurb}</span>
                      </span>
                      <span className="labs-panel-counts">
                        {s.rows.length} marker{s.rows.length === 1 ? "" : "s"}
                        {s.flagged > 0 && <span className="labs-panel-flagged">{s.flagged} flagged</span>}
                        {s.nearEdge > 0 && <span className="labs-panel-edge">{s.nearEdge} near edge</span>}
                      </span>
                    </button>
                    {open && (
                      <div className="labs-sys-openrow">
                        <button className="btn-ghost sm" onClick={() => setZoomSystem(s.key)}>
                          Open {s.short || s.name} <ChevronRight size={13} />
                        </button>
                      </div>
                    )}

                    {open && (
                      <div className="labs-panel-body">
                        {/* Flagged first: the point of opening a system is
                            finding out what's wrong in it. */}
                        <div className="labs-marker-list">
                          {[...s.rows]
                            .sort((a, b) => ({ now: 0, borderline: 1, past: 2, ok: 3 }[a.attention] - { now: 0, borderline: 1, past: 2, ok: 3 }[b.attention]))
                            .map(markerRowBtn)}
                        </div>

                        {s.studies.length > 0 && (
                          <div className="labs-sys-studies">
                            {s.studies.map(st => (
                              <button
                                key={st.id}
                                className="labs-sys-study"
                                onClick={() => { setView("pathology"); setExpanded(st.id); }}
                              >
                                <FileText size={11} /> {st.date} · {st.report_name}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : activeView === "pathology" ? (
            <div className="labs-panels">
              {orderedPathology.map(r => {
                const open = expanded === r.id;
                return (
                  <div className="panel labs-panel" key={r.id}>
                    <button className="labs-panel-head" onClick={() => setExpanded(open ? null : r.id)}>
                      {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      <span className="labs-panel-date">{r.date}</span>
                      <span className="labs-panel-name">
                        {r.report_name || "Pathology report"}
                        {r.lab_name && <span className="labs-panel-lab"> · {r.lab_name}</span>}
                      </span>
                      <span className="labs-panel-counts">{r.kind === "imaging" ? "imaging" : "pathology"}</span>
                    </button>

                    {open && (
                      <div className="labs-panel-body">
                        {/* Diagnosis first and on its own: it is the line you
                            came to read, and burying it under the specimen
                            description is how you end up not reading it. */}
                        {r.diagnosis && (
                          <div className="labs-path-section labs-path-diagnosis">
                            <div className="labs-path-label">{r.kind === "imaging" ? "Impression" : "Diagnosis"}</div>
                            <div className="labs-path-text">{r.diagnosis}</div>
                          </div>
                        )}
                        {/* Same columns, but a radiologist and a pathologist
                            don't call them the same things. */}
                        {[
                          [r.kind === "imaging" ? "Exam" : "Specimen", r.specimen],
                          ["Clinical history", r.clinical_history],
                          [r.kind === "imaging" ? "Technique" : "Gross description", r.gross_description],
                          [r.kind === "imaging" ? "Findings" : "Microscopic description", r.microscopic_description],
                          ["Comments", r.comments],
                        ].filter(([, v]) => v && String(v).trim()).map(([label, value]) => (
                          <div className="labs-path-section" key={label}>
                            <div className="labs-path-label">{label}</div>
                            <div className="labs-path-text">{value}</div>
                          </div>
                        ))}
                        <div className="labs-panel-foot">
                          {r.accession && <span className="labs-file"><FileText size={11} /> {r.accession}</span>}
                          <DeleteBtn id={`path:${r.id}`} onDelete={() => removePathology(r.id)} size={13} />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="panel labs-marker-panel">
              <div className="labs-search-box labs-marker-search">
                <Search size={14} />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a marker…" />
              </div>
              {filteredMarkers.length === 0 ? (
                <div className="labs-empty-row">No marker matches that.</div>
              ) : (
                <div className="labs-marker-list">
                  {/* The 80/20 read: what's wrong now, what has been wrong
                      before, then everything that's fine — so the glance
                      stops at the top. */}
                  {[["now", "Needs attention"], ["borderline", "Near the edge of range"], ["past", "Previously flagged"], ["ok", "In range"]].map(([k, label]) => {
                    const rows = filteredMarkers.filter(r => r.attention === k);
                    if (!rows.length) return null;
                    return (
                      <div className="labs-prio" key={k}>
                        <div className={"labs-prio-head labs-prio-" + k}>
                          {label}
                          <span className="labs-prio-count">{rows.length}</span>
                        </div>
                        {rows.map(markerRowBtn)}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ---------------- Import / manual review sheet ---------------- */}
      {queue && current && (
        <ImportSheet
          queue={queue}
          item={current}
          busy={busy}
          error={err}
          onClose={() => { setErr(""); setQueue(null); }}
          onGo={(at) => setQueue(q => (q ? { ...q, at } : q))}
          patchDraft={patchDraft}
          patchRow={patchRow}
          onAddRow={() => patchDraft({ rows: [...current.draft.rows, blankRow()] })}
          onSave={saveDraft}
        />
      )}

      {/* ---------------- Trend sheet ---------------- */}
      {trendKey && (
        <TrendSheet
          markerKey={trendKey}
          series={seriesFor(trendKey)}
          fallbackName={results.find(r => r.marker === trendKey)?.name}
          onClose={() => setTrendKey(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function ResultTable({ rows, editing, setEditing, saveEdit, onTrend, DeleteBtn, removeResult }) {
  if (!rows.length) return <div className="labs-empty-row">No results on this report.</div>;

  const groups = [];
  for (const r of rows) {
    const cat = r.category || "Other";
    if (!groups.length || groups[groups.length - 1].cat !== cat) groups.push({ cat, rows: [] });
    groups[groups.length - 1].rows.push(r);
  }

  return (
    <div className="labs-results">
      {groups.map(g => (
        <div className="labs-group" key={g.cat}>
          <div className="labs-group-head">{g.cat}</div>
          {g.rows.map(r => (
            <div className="labs-result-row" key={r.id}>
              <button className="lrr-name" onClick={() => onTrend(r.marker)} title="See the trend">
                {markerDisplayName(r.marker, r.name)}
                {markerDisplayName(r.marker, r.name) !== r.name && <span className="lrr-asprinted">{r.name}</span>}
              </button>

              {editing?.id === r.id ? (
                <div className="lrr-edit">
                  <input value={editing.value} inputMode="decimal" placeholder="value"
                    onChange={(e) => setEditing({ ...editing, value: e.target.value })} />
                  <input value={editing.unit} placeholder="unit"
                    onChange={(e) => setEditing({ ...editing, unit: e.target.value })} />
                  <input value={editing.ref_low} inputMode="decimal" placeholder="low"
                    onChange={(e) => setEditing({ ...editing, ref_low: e.target.value })} />
                  <input value={editing.ref_high} inputMode="decimal" placeholder="high"
                    onChange={(e) => setEditing({ ...editing, ref_high: e.target.value })} />
                  <button className="icon-btn" title="Save" onClick={saveEdit}><Check size={12} /></button>
                  <button className="icon-btn" title="Cancel" onClick={() => setEditing(null)}><X size={12} /></button>
                </div>
              ) : (
                <>
                  <span className={"lrr-value" + flagClass(r.flag, r.marker)}>
                    {r.value != null ? fmtValue(r.value) : (r.value_text || "–")}
                    <span className="lrr-unit"> {r.unit || ""}</span>
                    {r.flag === "high" && <ArrowUp size={12} />}
                    {r.flag === "low" && <ArrowDown size={12} />}
                  </span>
                  <span className="lrr-range">{fmtRange(r.ref_low, r.ref_high, r.ref_text)}</span>
                  <span className="lrr-actions">
                    <button className="icon-btn" title="Edit"
                      onClick={() => setEditing({
                        id: r.id,
                        value: r.value == null ? "" : String(r.value),
                        unit: r.unit || "",
                        ref_low: r.ref_low == null ? "" : String(r.ref_low),
                        ref_high: r.ref_high == null ? "" : String(r.ref_high),
                      })}>
                      <Pencil size={12} />
                    </button>
                    <DeleteBtn id={r.id} onDelete={() => removeResult(r.id)} />
                  </span>
                </>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

function ImportSheet({ queue, item, busy, error, onClose, onGo, patchDraft, patchRow, onAddRow, onSave }) {
  const total = queue.items.length;
  const manual = item.draft?.source === "manual";
  const draft = item.draft;
  const savable = draft ? draft.rows.filter(isSavable) : [];
  const included = savable.length;
  const unknown = savable.filter(r => !resolveMarker(r.name, draft.panel_name).known).length;

  return (
    <div className="labs-sheet-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="labs-sheet">
        <div className="labs-sheet-head">
          <div className="labs-sheet-title">
            <FlaskConical size={15} /> {manual ? "New report" : "Check before saving"}
          </div>
          <button className="icon-btn" onClick={onClose} title="Close"><X size={15} /></button>
        </div>

        {total > 1 && (
          <div className="labs-queue">
            <button className="icon-btn" disabled={queue.at === 0} onClick={() => onGo(queue.at - 1)} title="Previous file">
              <ChevronLeft size={13} />
            </button>
            <span className="labs-queue-label">
              File {queue.at + 1} of {total} · <span className="labs-queue-name">{item.name}</span>
            </span>
            <button className="icon-btn" disabled={queue.at === total - 1} onClick={() => onGo(queue.at + 1)} title="Next file">
              <ChevronRight size={13} />
            </button>
            <span className="labs-queue-dots">
              {queue.items.map((it, i) => (
                <span key={i} className={`lqd lqd-${it.state}` + (i === queue.at ? " lqd-at" : "")} title={`${it.name}: ${it.state}`} />
              ))}
            </span>
          </div>
        )}

        <div className="labs-sheet-body">
          {item.state === "parsing" && (
            <div className="labs-parsing">
              <Loader2 size={18} className="spin" />
              <div>
                <strong>Reading {item.name}…</strong>
                <div className="labs-parsing-sub">Dense reports take a few seconds. Nothing is saved until you press Save.</div>
              </div>
            </div>
          )}

          {item.state === "error" && (
            <div className="labs-note labs-note-warn">
              <div className="labs-note-line"><AlertCircle size={13} /> {item.error}</div>
            </div>
          )}

          {item.state === "saved" && (
            <div className="labs-note">
              <div className="labs-note-line"><Check size={13} /> Saved. {total > 1 ? "Use the arrows for the rest." : ""}</div>
            </div>
          )}

          {item.state === "ready" && draft && (
            <>
              {draft.confidence && (
                <div className={"labs-note" + (draft.confidence === "high" ? "" : " labs-note-warn")}>
                  <div className="labs-note-line">
                    <AlertCircle size={13} />
                    <span className={`labs-conf labs-conf-${draft.confidence}`}>{draft.confidence}</span>
                    <span>These came off the file — check them against the report before saving.</span>
                  </div>
                  {draft.note && <div className="labs-note-detail">{draft.note}</div>}
                </div>
              )}

              <div className="form-grid labs-meta-grid">
                <label>Draw date<input value={draft.date} placeholder="3/14/26"
                  onChange={(e) => patchDraft({ date: e.target.value })} /></label>
                <label>Lab<input value={draft.lab_name} placeholder="optional"
                  onChange={(e) => patchDraft({ lab_name: e.target.value })} /></label>
                <label>Panel<input value={draft.panel_name} placeholder="e.g. Lipid panel"
                  onChange={(e) => patchDraft({ panel_name: e.target.value })} /></label>
              </div>

              {/* How the blood was taken. Every one defaults to unknown and
                  stays there unless you say otherwise: a report rarely prints
                  any of it, and a guess would be read as fact by every written
                  report from here on. */}
              <div className="labs-draw-ctx">
                <div className="labs-draw-ctx-head">How it was drawn <em>optional — leave blank if you don't know</em></div>
                <div className="form-grid labs-meta-grid">
                  <label>Time of day<input value={draft.drawn_at} placeholder="e.g. ~noon"
                    onChange={(e) => patchDraft({ drawn_at: e.target.value })} /></label>
                  <label>Fasted
                    <select value={draft.fasted} onChange={(e) => patchDraft({ fasted: e.target.value })}>
                      <option value="">Unknown</option>
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  </label>
                  <label>Against the infusion
                    <select value={draft.infusion_relation} onChange={(e) => patchDraft({ infusion_relation: e.target.value })}>
                      <option value="">Unknown</option>
                      <option value="trough">Just before one (trough)</option>
                      <option value="after">After one</option>
                      <option value="unrelated">Not timed to it</option>
                    </select>
                  </label>
                </div>
              </div>

              <div className="labs-draft-head">
                <strong>{included} result{included === 1 ? "" : "s"}</strong> to save
                {unknown > 0 && (
                  <span className="labs-draft-unknown">
                    {unknown} not in the app's marker list — they still save and still chart, just under the lab's own name.
                  </span>
                )}
                <button className="btn-ghost sm labs-add-row" onClick={onAddRow}><Plus size={12} /> Add row</button>
              </div>

              <div className="labs-draft-rows">
                {draft.rows.map((r, i) => {
                  const m = r.name.trim() ? resolveMarker(r.name, draft.panel_name) : null;
                  return (
                    <div className={"labs-draft-row" + (r.include ? "" : " labs-row-off")} key={i}>
                      <label className="labs-draft-tick">
                        <input type="checkbox" checked={r.include} onChange={(e) => patchRow(i, { include: e.target.checked })} />
                      </label>
                      <div className="labs-draft-fields">
                        <input className="ldf-name" value={r.name} placeholder="Test name"
                          onChange={(e) => patchRow(i, { name: e.target.value })} />
                        <input className="ldf-val" value={r.value} inputMode="decimal" placeholder="value"
                          onChange={(e) => patchRow(i, { value: e.target.value })} />
                        <input className="ldf-unit" value={r.unit} placeholder="unit"
                          onChange={(e) => patchRow(i, { unit: e.target.value })} />
                        <input className="ldf-ref" value={r.ref_low} inputMode="decimal" placeholder="low"
                          onChange={(e) => patchRow(i, { ref_low: e.target.value })} />
                        <input className="ldf-ref" value={r.ref_high} inputMode="decimal" placeholder="high"
                          onChange={(e) => patchRow(i, { ref_high: e.target.value })} />
                      </div>
                      {m && (
                        <div className="labs-draft-mapped">
                          {m.known
                            ? <>charts as <strong>{m.name}</strong></>
                            : <>charts under its own name</>}
                          {r.value_text && <span className="ldm-text"> · reported “{r.value_text}”</span>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {error && (
                <div className="labs-note labs-note-warn labs-sheet-error">
                  <div className="labs-note-line"><AlertCircle size={13} /> {error}</div>
                </div>
              )}

              <div className="labs-draft-actions">
                <button className="btn-ghost" onClick={onClose}>Cancel</button>
                <button className="btn-primary" onClick={onSave} disabled={busy || included === 0}>
                  {busy ? <Loader2 size={13} className="spin" /> : <Save size={13} />} Save {included} result{included === 1 ? "" : "s"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function TrendSheet({ markerKey, series, fallbackName, onClose }) {
  const info = markerInfo(markerKey);
  const name = markerDisplayName(markerKey, fallbackName);
  const unit = series[series.length - 1]?.unit || info?.unit || "";

  const data = series.map(r => ({
    date: formatMDY(r.at),
    value: Number(r.value),
    flag: r.flag,
    marker: markerKey,
  }));

  // The band is the most recent range the lab gave — earlier draws may have
  // used a different one, which is why each row still shows its own.
  const last = [...series].reverse().find(r => r.ref_low != null || r.ref_high != null);
  const bandLow = last?.ref_low != null ? Number(last.ref_low) : null;
  const bandHigh = last?.ref_high != null ? Number(last.ref_high) : null;

  const values = data.map(d => d.value);
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  // Pull a bound into view only when the readings have crossed it. Otherwise
  // the band already fills the plot, and stretching to a distant bound would
  // flatten the line to a straight edge for no gain.
  if (bandHigh != null && hi > bandHigh) lo = Math.min(lo, bandHigh);
  if (bandLow != null && lo < bandLow) hi = Math.max(hi, bandLow);
  const pad = Math.max((hi - lo) * 0.15, Math.abs(hi) * 0.05, 0.5);
  // A one-sided range still shades — "<100" means everything below 100 is
  // fine, and drawing nothing would leave the legend describing a band that
  // isn't there.
  const hasBand = bandLow != null || bandHigh != null;
  const bandFrom = bandLow != null ? bandLow : lo - pad;
  const bandTo = bandHigh != null ? bandHigh : hi + pad;

  return (
    <div className="labs-sheet-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="labs-sheet">
        <div className="labs-sheet-head">
          <div className="labs-sheet-title"><TrendingUp size={15} /> {name}</div>
          <button className="icon-btn" onClick={onClose} title="Close"><X size={15} /></button>
        </div>

        <div className="labs-sheet-body">
          {data.length === 0 ? (
            <div className="labs-empty-row">No numeric readings for this marker yet.</div>
          ) : (
            <>
              <div className="labs-trend-chart">
                <ResponsiveContainer width="100%" height={230}>
                  <LineChart data={data} margin={{ top: 10, right: 10, left: -6, bottom: 0 }}>
                    <CartesianGrid stroke={CHART_THEME.grid} vertical={false} />
                    {hasBand && (
                      <ReferenceArea y1={bandFrom} y2={bandTo} fill="#3f8f2b" fillOpacity={0.09} stroke="none" />
                    )}
                    <XAxis dataKey="date" tick={{ fill: CHART_THEME.tick, fontSize: 11, fontFamily: CHART_THEME.font }}
                      axisLine={{ stroke: CHART_THEME.grid }} tickLine={false} />
                    <YAxis domain={[lo - pad, hi + pad]} tick={{ fill: CHART_THEME.tick, fontSize: 11, fontFamily: CHART_THEME.font }}
                      axisLine={false} tickLine={false} width={46}
                      tickFormatter={(v) => fmtValue(v)} />
                    <Tooltip
                      contentStyle={{ background: "#fff", border: "1px solid #e7e6e0", borderRadius: 10, fontFamily: CHART_THEME.font, fontSize: 12.5 }}
                      formatter={(v) => [`${fmtValue(v)} ${unit}`, name]} />
                    <Line type="monotone" dataKey="value" stroke="#16181d" strokeWidth={2}
                      dot={<TrendDot />} activeDot={{ r: 5 }} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
                <div className="labs-trend-legend">
                  {hasBand
                    ? <>Shaded band is the reference range on your most recent report ({fmtRange(bandLow, bandHigh, last?.ref_text)} {unit}).</>
                    : <>These reports gave no reference range, so there's no band to draw.</>}
                </div>
              </div>

              <div className="labs-trend-rows">
                {[...series].reverse().map(r => (
                  <div className="labs-trend-row" key={r.id}>
                    <span className="ltr-date">{formatMDY(r.at)}</span>
                    <span className={"ltr-value" + flagClass(r.flag, markerKey)}>
                      {fmtValue(r.value)} <span className="ltr-unit">{r.unit || ""}</span>
                    </span>
                    <span className="ltr-range">{fmtRange(r.ref_low, r.ref_high, r.ref_text)}</span>
                    <span className="ltr-as">{r.name}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Out-of-range readings get a filled dot so the eye lands on them first. */
function TrendDot(props) {
  const { cx, cy, payload } = props;
  if (cx == null || cy == null) return null;
  const off = payload.flag && payload.flag !== "normal";
  const good = off && isFavorable(payload.marker, payload.flag);
  const fill = !off ? "#ffffff" : good ? "#3f8f2b" : "#c4534a";
  const stroke = !off ? "#16181d" : fill;
  return <Dot cx={cx} cy={cy} r={4} fill={fill} stroke={stroke} strokeWidth={2} />;
}

// ---------------------------------------------------------------------------

/**
 * A report, rendered. The parser is in labReport.js; this only turns its
 * blocks into elements, so nothing generated ever becomes markup — a report
 * is model output going straight onto the screen.
 */
function Markdown({ text }) {
  const runs = (spans) => spans.map((s, i) => (
    s.bold ? <strong key={i}>{s.text}</strong>
      : s.code ? <code key={i}>{s.text}</code>
      : s.em ? <em key={i}>{s.text}</em>
      : <React.Fragment key={i}>{s.text}</React.Fragment>
  ));

  return (
    <div className="labs-md">
      {parseMarkdown(text).map((b, i) => {
        if (b.type === "heading") {
          // h1 is the report's own title and already sits at the top of the
          // card; deeper levels flatten rather than shrinking to nothing.
          const Tag = b.level <= 1 ? "h2" : b.level === 2 ? "h3" : "h4";
          return <Tag key={i}>{runs(b.spans)}</Tag>;
        }
        if (b.type === "list") {
          const Tag = b.ordered ? "ol" : "ul";
          return <Tag key={i}>{b.items.map((it, j) => <li key={j}>{runs(it)}</li>)}</Tag>;
        }
        return <p key={i}>{runs(b.spans)}</p>;
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * Seconds since this mounted.
 *
 * The only honest progress signal available: the model streams nothing back
 * until it has finished thinking, so there is no percentage to show. A number
 * that moves is the difference between "working" and "hung", and this is the
 * longest wait anywhere in the app.
 */
function Elapsed() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN(x => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return <>{n < 60 ? `${n}s` : `${Math.floor(n / 60)}m ${String(n % 60).padStart(2, "0")}s`}</>;
}

const blankHistory = () => ({ kind: "condition", label: "", detail: "", started: "", ended: "", active: true });

/**
 * The medical history editor.
 *
 * Structured enough that a report can reason with it — a condition is not a
 * medication is not a surgery — and loose enough to actually get written:
 * dates are free text because "2019", "childhood" and "3/2021" are all real
 * answers, and everything but the label is optional.
 */
function HistoryScreen({ entries, busy, backLabel, onBack, onAdd, onPatch, onDelete, DeleteBtn, error }) {
  const [draft, setDraft] = useState(null);
  const rows = entries || [];

  const save = async () => {
    if (!draft?.label.trim()) return;
    const entry = {
      kind: draft.kind,
      label: draft.label.trim(),
      detail: draft.detail.trim() || null,
      started: draft.started.trim() || null,
      ended: draft.ended.trim() || null,
      // An entry with an end date is over whether or not the box was ticked.
      active: draft.ended.trim() ? false : draft.active,
      sort_order: rows.length,
    };
    const ok = draft.id ? await onPatch(draft.id, entry) : await onAdd(entry);
    if (ok !== false) setDraft(null);
  };

  return (
    <div className="labs-view">
      <style>{LAB_STYLES}</style>
      <div className="labs-zoom-head">
        <button className="btn-ghost sm" onClick={onBack}><ChevronLeft size={14} /> {backLabel || "All labs"}</button>
      </div>

      {error && <div className="banner-error"><AlertCircle size={13} /> {error}</div>}

      <div className="labs-zoom-title">
        <h2 className="panel-title"><Heart size={14} /> Medical history</h2>
        <div className="labs-zoom-blurb">
          What the numbers can't carry. Calprotectin at 160 means one thing on anti-TNF therapy and another off it,
          and none of that is in a lab result — so this is the difference between a report that reasons about your
          results and one that only describes them. Nothing here is sent anywhere except when you ask for a report.
        </div>
      </div>

      {HISTORY_KINDS.map(kind => {
        const mine = rows.filter(h => h.kind === kind.key);
        if (!mine.length) return null;
        return (
          <div className="panel labs-hist-group" key={kind.key}>
            <div className="lzc-name">{kind.label}</div>
            {mine.map(h => (
              <div className={"labs-hist-row" + (h.active === false ? " labs-hist-past" : "")} key={h.id}>
                <div className="lhr-main">
                  <div className="lhr-label">{h.label}{h.active === false && <span className="lhr-past">past</span>}</div>
                  {h.detail && <div className="lhr-detail">{h.detail}</div>}
                  {(h.started || h.ended) && (
                    <div className="lhr-when">
                      {h.started && h.ended ? `${h.started} to ${h.ended}` : h.started ? `since ${h.started}` : `until ${h.ended}`}
                    </div>
                  )}
                </div>
                <div className="lhr-actions">
                  <button className="icon-btn" title="Edit" onClick={() => setDraft({
                    id: h.id, kind: h.kind, label: h.label, detail: h.detail || "",
                    started: h.started || "", ended: h.ended || "", active: h.active !== false,
                  })}>
                    <Pencil size={12} />
                  </button>
                  <DeleteBtn id={h.id} onDelete={() => onDelete(h.id)} />
                </div>
              </div>
            ))}
          </div>
        );
      })}

      {rows.length === 0 && !draft && (
        <div className="panel labs-empty-panel">
          <div className="labs-empty">
            <p>Nothing recorded yet. Your diagnoses, the treatments you're on, and anything that's been operated on are what turn a list of numbers into a reading of them.</p>
          </div>
        </div>
      )}

      {draft ? (
        <div className="panel labs-hist-edit">
          <div className="lzc-name">{draft.id ? "Edit entry" : "New entry"}</div>
          <div className="labs-hist-fields">
            <label className="labs-field">
              <span>Kind</span>
              <select value={draft.kind} onChange={(e) => setDraft(d => ({ ...d, kind: e.target.value }))}>
                {HISTORY_KINDS.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
              </select>
            </label>
            <label className="labs-field labs-field-wide">
              <span>What</span>
              <input
                value={draft.label}
                placeholder={HISTORY_KINDS.find(k => k.key === draft.kind)?.hint || ""}
                onChange={(e) => setDraft(d => ({ ...d, label: e.target.value }))}
              />
            </label>
            <label className="labs-field labs-field-wide">
              <span>Detail <em>optional</em></span>
              <input
                value={draft.detail}
                placeholder="Dose, site, how it's going — anything a report should weigh"
                onChange={(e) => setDraft(d => ({ ...d, detail: e.target.value }))}
              />
            </label>
            <label className="labs-field">
              <span>Started <em>optional</em></span>
              <input value={draft.started} placeholder="2019" onChange={(e) => setDraft(d => ({ ...d, started: e.target.value }))} />
            </label>
            <label className="labs-field">
              <span>Ended <em>optional</em></span>
              <input value={draft.ended} placeholder="blank if ongoing" onChange={(e) => setDraft(d => ({ ...d, ended: e.target.value }))} />
            </label>
          </div>
          <div className="labs-hist-actions">
            <button className="btn-primary sm" onClick={save} disabled={busy || !draft.label.trim()}>
              <Save size={13} /> Save
            </button>
            <button className="btn-ghost sm" onClick={() => setDraft(null)} disabled={busy}>Cancel</button>
          </div>
        </div>
      ) : (
        <button className="btn-primary sm labs-hist-add" onClick={() => setDraft(blankHistory())} disabled={busy}>
          <Plus size={13} /> Add an entry
        </button>
      )}
    </div>
  );
}

export const LAB_STYLES = `
  .labs-view { display: block; }

  /* Sheet, notes and search box are this tab's own copies on purpose: the
     Food tab's stylesheet is only in the document while the Food tab is
     mounted, so borrowing from it renders these unstyled. */
  .labs-sheet-backdrop { position: fixed; inset: 0; z-index: 60; background: rgba(20,22,27,0.42); display: flex; align-items: flex-end; justify-content: center; padding: 24px 16px; }
  .labs-sheet { width: 100%; max-width: 720px; max-height: 88vh; display: flex; flex-direction: column; background: var(--panel); border-radius: 20px; box-shadow: 0 18px 50px rgba(20,22,27,0.28); overflow: hidden; }
  .labs-sheet-head { display: flex; align-items: center; justify-content: space-between; padding: 16px 18px 10px; }
  .labs-sheet-title { display: flex; align-items: center; gap: 8px; font-family: 'Inter', sans-serif; font-size: 16px; font-weight: 700; }
  .labs-sheet-body { flex: 1; overflow-y: auto; padding: 0 18px 20px; -webkit-overflow-scrolling: touch; }

  .labs-search-box { display: flex; align-items: center; gap: 8px; background: var(--panel-2); border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px; color: var(--text-faint); min-width: 0; }
  .labs-search-box input { flex: 1; min-width: 0; background: transparent; border: none; outline: none; color: var(--text); font-family: 'Inter', sans-serif; font-size: 14.5px; }
  .labs-empty-row { font-family: 'Inter', sans-serif; font-size: 13.2px; color: var(--text-faint); padding: 12px 2px 14px; }

  .labs-note { background: #f4faf1; border: 1px solid #cfe6c4; border-radius: 12px; padding: 10px 13px; margin-bottom: 12px; }
  .labs-note.labs-note-warn { background: #fdf1dd; border-color: #ecd3a4; }
  .labs-note-line { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; font-size: 13.2px; color: #2b6e1e; line-height: 1.5; }
  .labs-note-warn .labs-note-line { color: #8a5b13; }
  .labs-note-line svg { flex-shrink: 0; }
  .labs-conf { font-family: 'Inter', sans-serif; font-size: 10.4px; letter-spacing: 0.05em; text-transform: uppercase; padding: 2px 7px; border-radius: 999px; }
  .labs-conf-high { background: rgba(54,135,39,0.15); color: #2b6e1e; }
  .labs-conf-medium { background: rgba(219,162,54,0.2); color: #8a5b13; }
  .labs-conf-low { background: rgba(199,58,47,0.14); color: #a5342a; }
  .labs-note-detail { font-family: 'Inter', sans-serif; font-size: 12.6px; color: var(--text-dim); margin-top: 6px; line-height: 1.5; }

  .labs-head { margin-bottom: 12px; }
  .labs-head-row { margin-bottom: 0; }
  .labs-head-actions { gap: 10px; flex: 1 1 auto; min-width: 0; justify-content: flex-end; }
  .labs-empty-panel { padding-bottom: 18px; }
  .labs-empty { font-size: 13.8px; line-height: 1.6; color: var(--text-dim); padding: 6px 2px 2px; }
  .labs-empty p { margin: 0 0 8px; }
  .labs-empty-sub { font-family: 'Inter', sans-serif; font-size: 12.6px; color: var(--text-faint); }

  .labs-summary { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; margin-bottom: 14px; }
  /* min-width: 0 — a grid item defaults to auto, and the nowrap sub-line
     under it then pushes the third card past the grid's edge. */
  .labs-summary-tile { min-width: 0; background: var(--panel); border: 1px solid var(--border); border-radius: 18px; padding: 14px 15px; box-shadow: 0 1px 2px rgba(20, 22, 27, 0.05), 0 4px 16px rgba(20, 22, 27, 0.05); }
  /* Home's hero-card tints, the same pair the Food tab's macro tiles use. */
  .labs-summary-tile.labs-tile-ok { background: #ddefd4; border-color: #cfe6c4; }
  .labs-summary-tile.labs-tile-off { background: #f8ddd9; border-color: #eec4be; }
  .labs-tile-ok .labs-summary-label, .labs-tile-ok .labs-summary-value { color: #2b6e1e; }
  .labs-tile-ok .labs-summary-sub { color: rgba(43, 110, 30, 0.72); }
  .labs-tile-off .labs-summary-label, .labs-tile-off .labs-summary-value { color: #a5342a; }
  .labs-tile-off .labs-summary-sub { color: rgba(165, 52, 42, 0.72); }
  .labs-summary-label { font-family: 'Inter', sans-serif; font-size: 13.2px; font-weight: 600; letter-spacing: 0.01em; color: var(--text-dim); }
  .labs-summary-value { font-family: 'Inter', sans-serif; letter-spacing: -0.02em; font-size: 30px; font-weight: 700; line-height: 1.1; margin-top: 6px; }
  .labs-summary-sub { font-family: 'Inter', sans-serif; font-size: 13.2px; color: var(--text-dim); margin-top: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .labs-flag-strip { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
  .labs-flag-chip { display: inline-flex; align-items: center; gap: 8px; border-radius: 999px; padding: 6px 13px; border: 1px solid #eec4be; background: #f8ddd9; color: #a5342a; font-family: 'Inter', sans-serif; font-size: 13.2px; cursor: pointer; }
  .labs-flag-chip.lab-flag-ok { border-color: #cfe6c4; background: #ddefd4; color: #2b6e1e; }
  .lfc-value { display: inline-flex; align-items: center; gap: 3px; font-family: 'Inter', sans-serif; font-size: 13px; font-weight: 700; letter-spacing: -0.01em; }

  .labs-view-toggle { display: inline-flex; margin-bottom: 14px; }

  .labs-panels { display: flex; flex-direction: column; gap: 12px; }
  .labs-panel { padding: 0; overflow: hidden; }
  .labs-panel-head { display: flex; align-items: center; gap: 10px; width: 100%; background: transparent; border: none; padding: 14px 16px; cursor: pointer; color: var(--text); text-align: left; }
  .labs-panel-head:hover { background: var(--panel-2); }
  .labs-panel-date { font-family: 'Inter', sans-serif; font-size: 13.5px; font-weight: 600; flex-shrink: 0; }
  .labs-panel-name { flex: 1; min-width: 0; font-size: 14.2px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .labs-panel-lab { font-weight: 400; color: var(--text-faint); }
  .labs-panel-counts { display: flex; align-items: center; gap: 8px; flex-shrink: 0; font-family: 'Inter', sans-serif; font-size: 12.6px; color: var(--text-faint); }
  .labs-panel-flagged { background: #f8ddd9; color: #a5342a; padding: 2px 8px; border-radius: 999px; font-weight: 600; }
  .labs-panel-body { padding: 0 16px 14px; }
  .labs-panel-note { font-family: 'Inter', sans-serif; font-size: 12.6px; color: var(--text-faint); line-height: 1.55; padding-bottom: 10px; }

  /* Pinned system stat cards. Same family as the summary tiles above them,
     one size down — these are shortcuts, not the headline of the page. */
  .labs-syscards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: 14px; }
  .labs-syscard { min-width: 0; text-align: left; cursor: pointer; background: var(--panel); border: 1px solid var(--border); border-radius: 16px; padding: 11px 13px; box-shadow: 0 1px 2px rgba(20, 22, 27, 0.05); display: flex; flex-direction: column; gap: 3px; }
  .lsc-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
  .lsc-label { font-family: 'Inter', sans-serif; font-size: 12.2px; font-weight: 600; letter-spacing: 0.01em; color: var(--text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .lsc-value { font-family: 'Inter', sans-serif; font-size: 21px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.15; color: var(--text); }
  .lsc-value.lab-flag-off { color: #a5342a; }
  .lsc-value.lab-flag-ok { color: #2b6e1e; }
  .lsc-unit { font-size: 12px; font-weight: 600; color: var(--text-faint); letter-spacing: 0; }
  .lsc-sub { font-family: 'Inter', sans-serif; font-size: 11.8px; color: var(--text-faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .lsc-delta { color: var(--text-dim); }
  .lsc-extra { display: flex; justify-content: space-between; gap: 8px; padding-top: 2px; border-top: 1px dashed transparent; }
  .lsc-extra-name { font-family: 'Inter', sans-serif; font-size: 11.6px; color: var(--text-faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .lsc-extra-value { font-family: 'Inter', sans-serif; font-size: 11.6px; font-weight: 600; color: var(--text-dim); white-space: nowrap; }
  .lsc-extra-value.lab-flag-off { color: #a5342a; }
  .lsc-extra-value.lab-flag-ok { color: #2b6e1e; }

  /* Studies attached to a system card — a quiet strip under the markers. */
  .labs-sys-studies { display: flex; flex-wrap: wrap; gap: 8px; padding-top: 10px; }
  .labs-sys-study { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--line, #e2e1db); background: transparent; border-radius: 999px; padding: 5px 12px; font-family: 'Inter', sans-serif; font-size: 12.4px; color: var(--text-dim); cursor: pointer; }

  /* Pathology is prose, so it gets reading measure and line height rather than
     the tight numeric grid the result table uses. */
  .labs-path-section { padding: 0 0 12px; }
  .labs-path-label { font-family: 'Inter', sans-serif; font-size: 11.5px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-faint); margin-bottom: 4px; }
  .labs-path-text { font-family: 'Inter', sans-serif; font-size: 13.4px; line-height: 1.62; color: var(--text-dim); white-space: pre-wrap; overflow-wrap: anywhere; }
  .labs-path-diagnosis { border-left: 3px solid #cfd8e6; padding-left: 11px; margin-bottom: 4px; }
  .labs-path-diagnosis .labs-path-text { color: var(--text); font-size: 14px; }
  .labs-panel-foot { display: flex; align-items: center; gap: 10px; padding-top: 12px; }
  .labs-file { display: inline-flex; align-items: center; gap: 5px; flex: 1; min-width: 0; font-family: 'Inter', sans-serif; font-size: 12.2px; color: var(--text-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .labs-group { margin-bottom: 4px; }
  .labs-group-head { font-family: 'Inter', sans-serif; font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-faint); padding: 13px 2px 5px; }
  .labs-result-row { display: flex; align-items: center; gap: 12px; padding: 8px 2px; border-bottom: 1px solid var(--border); }
  .labs-result-row:last-child { border-bottom: none; }
  .lrr-name { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 1px; background: transparent; border: none; padding: 0; text-align: left; cursor: pointer; color: var(--text); font-size: 14px; }
  .lrr-name:hover { color: var(--cut); }
  .lrr-asprinted { font-family: 'Inter', sans-serif; font-size: 12px; color: var(--text-faint); }
  .lrr-value { display: inline-flex; align-items: center; gap: 3px; flex-shrink: 0; min-width: 96px; justify-content: flex-end; font-family: 'Inter', sans-serif; letter-spacing: -0.02em; font-size: 17px; font-weight: 700; }
  .lrr-unit { font-family: 'Inter', sans-serif; font-size: 12px; font-weight: 500; color: var(--text-faint); letter-spacing: 0; }
  .lrr-value.lab-flag-off { color: #a5342a; }
  .lrr-value.lab-flag-ok { color: #2b6e1e; }
  .lrr-range { flex-shrink: 0; min-width: 92px; text-align: right; font-family: 'Inter', sans-serif; font-size: 12.6px; color: var(--text-faint); }
  .lrr-actions { display: flex; gap: 4px; flex-shrink: 0; }
  .lrr-edit { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .lrr-edit input { width: 68px; background: var(--panel-2); border: 1px solid var(--border); border-radius: 7px; color: var(--text); padding: 5px 7px; font-family: 'Inter', sans-serif; font-size: 12px; outline: none; }

  .labs-marker-panel { padding-bottom: 12px; }
  .labs-marker-search { margin-bottom: 6px; }
  .labs-marker-list { display: flex; flex-direction: column; }
  .labs-marker-row { display: flex; align-items: center; gap: 12px; width: 100%; background: transparent; border: none; border-bottom: 1px solid var(--border); padding: 11px 4px; cursor: pointer; color: var(--text); text-align: left; }
  .labs-marker-row:last-child { border-bottom: none; }
  .labs-marker-row:hover { background: var(--panel-2); }
  .lmr-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .lmr-name { font-size: 14.2px; font-weight: 500; }
  .lmr-meta { font-family: 'Inter', sans-serif; font-size: 12.2px; color: var(--text-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lmr-right { flex-shrink: 0; display: flex; flex-direction: column; align-items: flex-end; gap: 1px; min-width: 88px; }
  .lmr-range { font-family: 'Inter', sans-serif; font-size: 11.2px; color: var(--text-faint); white-space: nowrap; }
  .lmr-gauge { position: relative; display: block; width: 68px; height: 4px; border-radius: 999px; background: rgba(103, 161, 90, 0.22); margin-top: 3px; }
  .lmr-gauge-mark { position: absolute; top: -1px; bottom: -1px; width: 1.5px; margin-left: -0.75px; background: var(--panel); }
  .lmr-gauge-dot { position: absolute; top: 50%; width: 7px; height: 7px; margin-left: -3.5px; border-radius: 999px; background: #2b6e1e; transform: translateY(-50%); }
  .lmr-gauge-dot.lmr-gauge-off { background: #a5342a; }
  .lmr-gauge-dot.lmr-gauge-edge { background: #c07a1f; }
  .lab-flag-edge { color: #96601a; }
  .labs-prio-head.labs-prio-borderline { color: #96601a; }
  .lmr-value { flex-shrink: 0; min-width: 88px; text-align: right; font-family: 'Inter', sans-serif; letter-spacing: -0.02em; font-size: 17px; font-weight: 700; }
  .lmr-right .lmr-value { min-width: 0; }

  /* Priority sections in the marker list — the glance stops at the top. */
  .labs-prio-head { display: flex; align-items: center; gap: 8px; font-family: 'Inter', sans-serif; font-size: 11.5px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-faint); padding: 12px 4px 5px; border-bottom: 1px solid var(--border); }
  .labs-prio-now .labs-prio-head, .labs-prio-head.labs-prio-now { color: #a5342a; }
  .labs-prio-head.labs-prio-past { color: #8a6d1a; }
  .labs-prio-count { font-weight: 600; background: var(--panel-2); border-radius: 999px; padding: 1px 8px; color: var(--text-dim); }

  .lsc-range { display: block; font-family: 'Inter', sans-serif; font-size: 10.8px; font-weight: 500; letter-spacing: 0; color: var(--text-faint); margin-top: 1px; }

  /* One system's own screen. Wider measure than the compact rows, because
     this is the one place with room to explain rather than just report. */
  .labs-zoom-head { margin-bottom: 6px; }
  .labs-zoom-title { margin-bottom: 12px; }
  .labs-zoom-blurb { font-family: 'Inter', sans-serif; font-size: 13px; color: var(--text-dim); margin-top: 3px; }
  .labs-zoom-verdict { font-family: 'Inter', sans-serif; font-size: 13.4px; line-height: 1.5; border-radius: 14px; padding: 11px 14px; margin-bottom: 14px; }
  .labs-zoom-verdict-ok { background: #ddefd4; border: 1px solid #cfe6c4; color: #2b6e1e; }
  .labs-zoom-verdict-off { background: #f8ddd9; border: 1px solid #eec4be; color: #a5342a; }
  .labs-zoom-verdict-edge { background: #fbeddc; border: 1px solid #f0d7bb; color: #96601a; }
  .labs-zoom-card { padding: 14px 16px; margin-bottom: 12px; }
  .lzc-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  .lzc-name { font-family: 'Inter', sans-serif; font-size: 14.6px; font-weight: 600; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .lzc-past { font-family: 'Inter', sans-serif; font-size: 10.8px; font-weight: 600; letter-spacing: 0.03em; text-transform: uppercase; color: #8a6d1a; background: #f6efd8; border: 1px solid #e8dcb4; border-radius: 999px; padding: 1px 8px; }
  .labs-panel-edge { font-family: 'Inter', sans-serif; font-size: 11px; font-weight: 600; color: #96601a; background: #fbeddc; border: 1px solid #f0d7bb; border-radius: 999px; padding: 1px 8px; margin-left: 8px; }
  .lzc-edge { font-family: 'Inter', sans-serif; font-size: 10.8px; font-weight: 600; letter-spacing: 0.03em; text-transform: uppercase; color: #96601a; background: #fbeddc; border: 1px solid #f0d7bb; border-radius: 999px; padding: 1px 8px; }
  .lzc-appref { font-family: 'Inter', sans-serif; font-size: 10.8px; font-weight: 600; letter-spacing: 0.03em; text-transform: uppercase; color: var(--text-faint); background: var(--panel-2); border: 1px solid var(--border); border-radius: 999px; padding: 1px 8px; }
  .lzc-appnote { font-family: 'Inter', sans-serif; font-size: 12.4px; line-height: 1.55; color: var(--text-dim); background: var(--panel-2); border: 1px dashed var(--border); border-radius: 12px; padding: 9px 11px; margin-top: 9px; }
  .lzc-appnote strong { color: var(--text); font-weight: 600; }
  .lzc-dot.lzc-dot-edge { background: #c07a1f; }
  .lzc-value { font-family: 'Inter', sans-serif; font-size: 22px; font-weight: 700; letter-spacing: -0.02em; white-space: nowrap; }
  .lzc-value.lab-flag-off { color: #a5342a; }
  .lzc-value.lab-flag-ok { color: #2b6e1e; }
  .lzc-scale { margin: 10px 0 6px; }
  .lzc-track { position: relative; height: 6px; border-radius: 999px; background: rgba(103, 161, 90, 0.22); }
  .lzc-dot { position: absolute; top: 50%; width: 11px; height: 11px; margin-left: -5.5px; border-radius: 999px; background: #2b6e1e; border: 2px solid var(--panel); transform: translateY(-50%); }
  .lzc-dot.lzc-dot-off { background: #a5342a; }
  /* Absolute rather than flexed: a bound the axis ran past has to sit at its
     own position on the bar, not be spaced evenly with the two ends. */
  .lzc-ends { position: relative; display: flex; justify-content: space-between; font-family: 'Inter', sans-serif; font-size: 11px; color: var(--text-faint); margin-top: 3px; }
  .lzc-mark { position: absolute; top: -2px; bottom: -2px; width: 2px; margin-left: -1px; border-radius: 1px; background: var(--panel); box-shadow: 0 0 0 0.5px rgba(20,22,27,0.22); }
  .lzc-mark-label { position: absolute; top: 0; transform: translateX(-50%); font-variant-numeric: tabular-nums; color: var(--text-dim); font-weight: 600; }
  .lzc-rangeonly { font-family: 'Inter', sans-serif; font-size: 12px; color: var(--text-faint); margin: 8px 0 4px; }
  .lzc-meta { font-family: 'Inter', sans-serif; font-size: 12px; color: var(--text-faint); }
  .lzc-note { margin-top: 9px; padding-top: 9px; border-top: 1px solid var(--border); }
  .lzc-note p { font-family: 'Inter', sans-serif; font-size: 13.2px; line-height: 1.6; color: var(--text-dim); margin: 0 0 6px; }
  .lzc-note p:last-child { margin-bottom: 0; }
  .lzc-note strong { color: var(--text); font-weight: 600; }
  .lzc-trend { margin-top: 10px; }
  .labs-zoom-foot { font-family: 'Inter', sans-serif; font-size: 12.2px; line-height: 1.6; color: var(--text-faint); padding: 4px 4px 20px; }
  .labs-sys-openrow { padding: 0 16px 12px; }

  /* ---- Reports ----
     The card sits above the markers on a system's screen: the written read is
     the thing you came for, the numbers are what it was written from. */
  /* A group heading sits on the page background between cards, the way the
     Food tab's meal headings do — not another card, or the grouping competes
     with the markers it is grouping. */
  /* Name and count on one line, the blurb under it. Side by side, a blurb
     long enough to be useful wraps to three lines on a phone and shoves the
     count away from the name it belongs to. */
  .labs-group-head { display: grid; grid-template-columns: 1fr auto; gap: 2px 10px; padding: 16px 4px 7px; }
  .labs-group-name { font-family: 'Inter', sans-serif; font-size: 13px; font-weight: 700; letter-spacing: 0.03em; text-transform: uppercase; color: var(--text); }
  .labs-group-count { font-family: 'Inter', sans-serif; font-size: 12px; color: var(--text-faint); display: flex; align-items: center; gap: 6px; justify-self: end; }
  .labs-group-blurb { grid-column: 1 / -1; font-family: 'Inter', sans-serif; font-size: 12.4px; line-height: 1.45; color: var(--text-faint); }

  .labs-reports { padding: 14px 16px; margin-bottom: 12px; }
  .labs-reports-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
  .labs-reports-head .lzc-name { display: flex; align-items: center; gap: 6px; }
  .labs-reports-sub { font-family: 'Inter', sans-serif; font-size: 12.8px; line-height: 1.6; color: var(--text-dim); margin-top: 7px; }
  .labs-reports-wait { display: flex; align-items: flex-start; gap: 8px; font-family: 'Inter', sans-serif; font-size: 12.6px; line-height: 1.55; color: #8a5b13; background: #fdf1dd; border: 1px solid #ecd3a4; border-radius: 10px; padding: 9px 11px; margin-top: 10px; }
  .labs-reports-wait svg { flex-shrink: 0; margin-top: 2px; }
  .labs-reports-hist { margin-top: 12px; }

  .labs-report-row { display: block; width: 100%; text-align: left; background: var(--panel-2); border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px; margin-top: 10px; cursor: pointer; }
  .labs-report-row:hover { border-color: var(--text-faint); }
  .lrr-title { display: block; font-family: 'Inter', sans-serif; font-size: 14px; font-weight: 650; color: var(--text); line-height: 1.4; }
  .lrr-meta { display: block; font-family: 'Inter', sans-serif; font-size: 11.6px; color: var(--text-faint); margin-top: 2px; }
  .lrr-summary { display: block; font-family: 'Inter', sans-serif; font-size: 12.8px; line-height: 1.55; color: var(--text-dim); margin-top: 6px; }

  .labs-report { padding: 18px 18px 22px; }
  .labs-report-meta { font-family: 'Inter', sans-serif; font-size: 11.6px; letter-spacing: 0.02em; text-transform: uppercase; color: var(--text-faint); padding-bottom: 12px; border-bottom: 1px solid var(--border); margin-bottom: 14px; }
  .labs-report-prev { margin: 2px 4px 20px; }

  /* Long-form prose, the only place in the app with any: wider line height
     and a real measure, because this gets read rather than scanned. */
  .labs-md { font-family: 'Inter', sans-serif; color: var(--text-dim); }
  .labs-md h2 { font-family: 'Inter', sans-serif; font-size: 17.5px; font-weight: 700; color: var(--text); line-height: 1.35; margin: 0 0 10px; }
  .labs-md h3 { font-family: 'Inter', sans-serif; font-size: 15px; font-weight: 680; color: var(--text); line-height: 1.4; margin: 22px 0 8px; }
  /* Deeper than h3 has to look clearly subordinate to it, or a report's
     structure flattens into one long run of same-sized bold lines. */
  .labs-md h4 { font-family: 'Inter', sans-serif; font-size: 12.4px; font-weight: 650; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-faint); margin: 18px 0 6px; }
  .labs-md p { font-size: 14.2px; line-height: 1.72; margin: 0 0 13px; }
  .labs-md ul, .labs-md ol { margin: 0 0 13px; padding-left: 20px; }
  .labs-md li { font-size: 14.2px; line-height: 1.68; margin-bottom: 6px; }
  .labs-md strong { color: var(--text); font-weight: 650; }
  .labs-md code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.8px; background: var(--panel-2); border-radius: 5px; padding: 1px 5px; }
  .labs-md > *:last-child { margin-bottom: 0; }

  /* ---- Medical history ---- */
  .labs-hist-group { padding: 13px 16px; margin-bottom: 10px; }
  .labs-hist-row { display: flex; align-items: flex-start; gap: 10px; padding: 9px 0; border-top: 1px solid var(--border); }
  .labs-hist-row:first-of-type { border-top: none; }
  .lhr-main { flex: 1; min-width: 0; }
  .lhr-label { font-family: 'Inter', sans-serif; font-size: 14px; font-weight: 600; color: var(--text); display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
  .lhr-past { font-family: 'Inter', sans-serif; font-size: 10.2px; letter-spacing: 0.05em; text-transform: uppercase; background: var(--panel-2); color: var(--text-faint); border-radius: 999px; padding: 2px 7px; font-weight: 600; }
  .lhr-detail { font-family: 'Inter', sans-serif; font-size: 13px; line-height: 1.55; color: var(--text-dim); margin-top: 2px; }
  .lhr-when { font-family: 'Inter', sans-serif; font-size: 11.8px; color: var(--text-faint); margin-top: 2px; }
  .labs-hist-past .lhr-label { color: var(--text-dim); }
  .lhr-actions { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }

  .labs-hist-edit { padding: 14px 16px; }
  .labs-hist-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 11px; }
  .labs-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .labs-field-wide { grid-column: 1 / -1; }
  .labs-field > span { font-family: 'Inter', sans-serif; font-size: 11.4px; letter-spacing: 0.03em; text-transform: uppercase; color: var(--text-faint); font-weight: 600; }
  .labs-field > span em { font-style: normal; text-transform: none; letter-spacing: 0; font-weight: 400; opacity: 0.75; }
  .labs-field input, .labs-field select { background: var(--panel-2); border: 1px solid var(--border); border-radius: 10px; padding: 9px 11px; font-family: 'Inter', sans-serif; font-size: 14px; color: var(--text); outline: none; min-width: 0; }
  .labs-field input:focus, .labs-field select:focus { border-color: var(--text-faint); }
  .labs-hist-actions { display: flex; gap: 8px; margin-top: 12px; }
  .labs-hist-add { margin: 2px 0 20px; }

  /* The hero card's position bar: the track is the range, the dot is you. */
  .lsc-gauge { position: relative; display: block; width: 100%; height: 5px; border-radius: 999px; background: rgba(103, 161, 90, 0.22); margin: 7px 0 3px; }
  .lsc-gauge-mark { position: absolute; top: -1px; bottom: -1px; width: 1.5px; margin-left: -0.75px; background: var(--panel); }
  .lsc-gauge-dot { position: absolute; top: 50%; width: 9px; height: 9px; margin-left: -4.5px; border-radius: 999px; background: #2b6e1e; border: 2px solid var(--panel); transform: translateY(-50%); }
  .lsc-gauge-dot.lsc-gauge-off { background: #a5342a; }
  .lsc-gauge-dot.lsc-gauge-edge { background: #c07a1f; }

  .lmr-value.lab-flag-off { color: #a5342a; }
  .lmr-value.lab-flag-ok { color: #2b6e1e; }
  .lmr-unit { font-family: 'Inter', sans-serif; font-size: 12px; font-weight: 500; color: var(--text-faint); letter-spacing: 0; }
  .lmr-delta { flex-shrink: 0; min-width: 56px; text-align: right; font-family: 'Inter', sans-serif; font-size: 13px; font-weight: 600; color: var(--text-dim); }
  .lmr-delta-none { color: var(--text-faint); }
  .lmr-chev { flex-shrink: 0; color: var(--text-faint); }

  .labs-queue { display: flex; align-items: center; gap: 8px; margin: 0 18px 12px; padding: 8px 10px; background: var(--panel-2); border-radius: 10px; }
  .labs-queue-label { flex: 1; min-width: 0; font-family: 'Inter', sans-serif; font-size: 12.6px; color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .labs-queue-name { color: var(--text-faint); }
  .labs-queue-dots { display: flex; gap: 4px; flex-shrink: 0; }
  .lqd { width: 7px; height: 7px; border-radius: 999px; background: var(--border); }
  .lqd-ready { background: var(--text-dim); }
  .lqd-saved { background: #3f8f2b; }
  .lqd-error { background: #c4534a; }
  .lqd-at { box-shadow: 0 0 0 2px rgba(20,22,27,0.18); }

  .labs-parsing { display: flex; align-items: center; gap: 12px; padding: 18px 4px; font-size: 13.5px; }
  .labs-parsing-sub { font-family: 'Inter', sans-serif; font-size: 12.6px; color: var(--text-faint); margin-top: 3px; line-height: 1.5; }

  .labs-meta-grid { grid-template-columns: repeat(3, 1fr); margin-bottom: 4px; }
  .labs-draw-ctx { margin: 12px 0 4px; padding-top: 12px; border-top: 1px solid var(--border); }
  .labs-draw-ctx-head { font-family: 'Inter', sans-serif; font-size: 11.4px; letter-spacing: 0.03em; text-transform: uppercase; color: var(--text-faint); font-weight: 600; margin-bottom: 8px; }
  .labs-draw-ctx-head em { font-style: normal; text-transform: none; letter-spacing: 0; font-weight: 400; opacity: 0.8; }
  .labs-draw-ctx select { width: 100%; background: var(--panel-2); border: 1px solid var(--border); border-radius: 10px; padding: 9px 11px; font-family: 'Inter', sans-serif; font-size: 14px; color: var(--text); outline: none; }
  .labs-draft-head { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; padding: 14px 2px 8px; font-size: 13.2px; border-bottom: 1px solid var(--border); }
  .labs-draft-unknown { flex: 1; min-width: 180px; font-family: 'Inter', sans-serif; font-size: 12.2px; color: var(--text-faint); line-height: 1.5; }
  .labs-add-row { margin-left: auto; }
  .labs-draft-rows { display: flex; flex-direction: column; }
  .labs-draft-row { display: flex; align-items: flex-start; gap: 10px; flex-wrap: wrap; padding: 9px 2px; border-bottom: 1px solid var(--border); }
  .labs-draft-row.labs-row-off { opacity: 0.42; }
  .labs-draft-tick { display: flex; align-items: center; padding-top: 8px; }
  .labs-draft-tick input { width: 18px; height: 18px; accent-color: #3f8f2b; }
  .labs-draft-fields { flex: 1; min-width: 0; display: flex; gap: 6px; flex-wrap: wrap; }
  .labs-draft-fields input { background: var(--panel-2); border: 1px solid var(--border); border-radius: 8px; color: var(--text); padding: 7px 9px; font-family: 'Inter', sans-serif; font-size: 13.5px; outline: none; min-width: 0; }
  .labs-draft-fields input:focus { border-color: var(--text-dim); }
  .ldf-name { flex: 3 1 160px; }
  .ldf-val { flex: 1 1 68px; }
  .ldf-unit { flex: 1 1 68px; }
  .ldf-ref { flex: 1 1 56px; }
  .labs-draft-mapped { flex-basis: 100%; padding-left: 28px; font-family: 'Inter', sans-serif; font-size: 12.2px; color: var(--text-faint); line-height: 1.5; }
  .ldm-text { color: var(--text-dim); }
  .labs-sheet-error { margin-top: 14px; margin-bottom: 0; }
  .labs-draft-actions { display: flex; align-items: center; justify-content: flex-end; gap: 12px; padding-top: 16px; }

  .labs-trend-chart { padding: 6px 0 4px; }
  .labs-trend-legend { font-family: 'Inter', sans-serif; font-size: 12.6px; color: var(--text-faint); line-height: 1.55; padding: 8px 2px 0; }
  .labs-trend-rows { display: flex; flex-direction: column; margin-top: 12px; }
  .labs-trend-row { display: flex; align-items: center; gap: 12px; padding: 9px 2px; border-bottom: 1px solid var(--border); }
  .labs-trend-row:last-child { border-bottom: none; }
  .ltr-date { flex-shrink: 0; min-width: 66px; font-family: 'Inter', sans-serif; font-size: 13.2px; color: var(--text-dim); }
  .ltr-value { flex-shrink: 0; min-width: 84px; font-family: 'Inter', sans-serif; letter-spacing: -0.02em; font-size: 17px; font-weight: 700; }
  .ltr-value.lab-flag-off { color: #a5342a; }
  .ltr-value.lab-flag-ok { color: #2b6e1e; }
  .ltr-unit { font-family: 'Inter', sans-serif; font-size: 12px; font-weight: 500; color: var(--text-faint); letter-spacing: 0; }
  .ltr-range { flex-shrink: 0; min-width: 88px; font-family: 'Inter', sans-serif; font-size: 12.6px; color: var(--text-faint); }
  .ltr-as { flex: 1; min-width: 0; font-family: 'Inter', sans-serif; font-size: 12px; color: var(--text-faint); text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  @media (max-width: 860px) {
    /* Two columns rather than smaller type — the same trade the Home tab's
       stat grid makes at this width. The out-of-range card takes the whole
       second row, which is the one you want to read first anyway. */
    .labs-summary { gap: 10px; }
    .labs-meta-grid { grid-template-columns: repeat(2, 1fr); }
    .labs-draw-ctx .labs-meta-grid { grid-template-columns: repeat(2, 1fr); }
  }

  @media (max-width: 640px) {
    .labs-sheet-backdrop { padding: 0; }
    /* dvh, not vh: an open keyboard doesn't shrink vh, which would push Save
       underneath it. Plain vh stays as the fallback for iOS < 16.4. */
    .labs-sheet { max-width: none; max-height: 100vh; height: 100vh; border-radius: 0; padding-top: env(safe-area-inset-top); }
    .labs-sheet { max-height: 100dvh; height: 100dvh; }
    .labs-meta-grid { grid-template-columns: 1fr !important; }
    .labs-head-actions { justify-content: flex-start; }
    /* The range column is the first thing worth losing on a phone — the value
       and its flag are what you're looking at, and the range is one tap away
       in the trend sheet. */
    .lrr-range, .ltr-as { display: none; }
    .lrr-value { min-width: 84px; }
    .labs-panel-counts { font-size: 10.6px; }
    .labs-marker-row { gap: 8px; }
    .lmr-delta { min-width: 46px; }
    .lmr-chev { display: none; }
  }
`;
