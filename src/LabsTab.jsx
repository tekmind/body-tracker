import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceArea, Dot,
} from "recharts";
import {
  Plus, X, Check, Loader2, AlertCircle, Trash2, Pencil, Search, Save, Upload,
  FileText, TrendingUp, ChevronDown, ChevronRight, ChevronLeft, ArrowUp, ArrowDown, FlaskConical,
} from "lucide-react";
import { parseDate, formatMDY, today as todayDate } from "./dateUtils.js";
import {
  resolveMarker, markerDisplayName, markerInfo, flagFor, isFavorable,
  sortResults, fmtValue, fmtRange, fmtBounds, MARKER_CATEGORIES,
} from "./labMarkers.js";
import { prepareLabFile, ACCEPTED_FILE_TYPES } from "./labFile.js";
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

  const [view, setView] = useState(() => localStorage.getItem("bt_labs_view") || "panels");
  const [expanded, setExpanded] = useState(null);
  const [trendKey, setTrendKey] = useState(null);
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
      rows.push({
        marker,
        name: markerDisplayName(marker, latest.name),
        labName: latest.name,
        category: latest.category || "Other",
        latest,
        delta,
        count: list.length,
        at: latest.at,
      });
    }
    const rank = (c) => {
      const i = MARKER_CATEGORIES.indexOf(c || "Other");
      return i < 0 ? MARKER_CATEGORIES.length : i;
    };
    return rows.sort((a, b) => rank(a.category) - rank(b.category) || a.name.localeCompare(b.name));
  }, [results, panelDate]);

  const filteredMarkers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return markerRows;
    return markerRows.filter(r =>
      r.name.toLowerCase().includes(q) || r.labName.toLowerCase().includes(q) || r.category.toLowerCase().includes(q)
    );
  }, [markerRows, query]);

  const latestPanel = orderedPanels[0] || null;
  const latestFlagged = useMemo(() => {
    if (!latestPanel) return [];
    return (resultsByPanel.get(latestPanel.id) || []).filter(r => r.flag && r.flag !== "normal");
  }, [latestPanel, resultsByPanel]);

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
        },
        results: rows.map(r => {
          const m = resolveMarker(r.name);
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

  // --- render --------------------------------------------------------------

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
          {/* Tinted like the Food tab's macro tiles and the Home hero cards —
              out of range is the one status here worth colouring. */}
          <div className={"labs-summary-tile" + (latestFlagged.length ? " labs-tile-off" : " labs-tile-ok")}>
            <div className="labs-summary-label">Out of range</div>
            <div className="labs-summary-value">{latestFlagged.length}</div>
            <div className="labs-summary-sub">on the latest draw</div>
          </div>
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

      {panels.length > 0 && (
        <>
          <div className="labs-view-toggle toggle-group">
            <button className={"toggle-btn" + (view === "panels" ? " active" : "")} onClick={() => setView("panels")}>
              By report
            </button>
            <button className={"toggle-btn" + (view === "markers" ? " active" : "")} onClick={() => setView("markers")}>
              By marker
            </button>
          </div>

          {view === "panels" ? (
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
                  {filteredMarkers.map(row => (
                    <button key={row.marker} className="labs-marker-row" onClick={() => setTrendKey(row.marker)}>
                      <span className="lmr-main">
                        <span className="lmr-name">{row.name}</span>
                        <span className="lmr-meta">
                          {row.category} · {row.count} reading{row.count === 1 ? "" : "s"} · latest {row.latest.value != null ? "" : "(text) "}
                          {panels.find(p => p.id === row.latest.panel_id)?.date || ""}
                        </span>
                      </span>
                      <span className={"lmr-value" + flagClass(row.latest.flag, row.marker)}>
                        {row.latest.value != null ? fmtValue(row.latest.value) : (row.latest.value_text || "–")}
                        <span className="lmr-unit"> {row.latest.unit || ""}</span>
                      </span>
                      <span className={"lmr-delta" + (row.delta == null ? " lmr-delta-none" : "")}>
                        {row.delta == null ? "–" : `${row.delta > 0 ? "+" : ""}${fmtValue(row.delta)}`}
                      </span>
                      <TrendingUp size={13} className="lmr-chev" />
                    </button>
                  ))}
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
  const unknown = savable.filter(r => !resolveMarker(r.name).known).length;

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
                  const m = r.name.trim() ? resolveMarker(r.name) : null;
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

  .labs-summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 14px; }
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
  .lmr-value { flex-shrink: 0; min-width: 88px; text-align: right; font-family: 'Inter', sans-serif; letter-spacing: -0.02em; font-size: 17px; font-weight: 700; }
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
    .labs-summary { grid-template-columns: repeat(2, 1fr); gap: 10px; }
    .labs-summary-tile:last-child { grid-column: 1 / -1; }
    .labs-meta-grid { grid-template-columns: repeat(2, 1fr); }
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
