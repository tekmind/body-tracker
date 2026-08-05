import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell,
} from "recharts";
import {
  Plus, X, Check, Loader2, AlertCircle, Mic, Sparkles, Search, ChevronLeft, ChevronRight,
  Trash2, Pencil, Utensils, BookMarked, Undo2, Save, ScanLine, Globe, Camera,
} from "lucide-react";
import BarcodeScanner from "./BarcodeScanner.jsx";
import { fileToScaledJpeg } from "./labelPhoto.js";
import { parseDate, formatMDY, addDays, blockStartFor, blockEndFor, today as todayDate } from "./dateUtils.js";
import {
  MEAL_SECTIONS, sectionLabel, sectionForHour, unitOptions, defaultPortion, lastPortion,
  displayServing, portionDisplay, scaleMacros, macroColumns, sumMacros, roundTotals, matchScore, normalizeUnit,
  carbGoalFrom, macroStatus, bufferRangeLabel, withAlcoholAsCarbs,
} from "./foodMath.js";
import * as foodApi from "./foodApi.js";

// `band` says what kind of number each goal is, which is what decides where an
// amber buffer sits — see macroStatus() in foodMath.js. These are the fallbacks
// for a date with no goal; when there is one, the calorie and carb bands come
// from its phase instead (a cut's calorie goal is a ceiling, a gain's is a
// floor) — see targetsForDate in Dashboard.jsx.
const MACROS = [
  { key: "cal", label: "Calories", unit: "", goalKey: "cal", color: "#c4534a", band: "window" },
  { key: "protein", label: "Protein", unit: "g", goalKey: "protein", color: "#5b8dee", band: "floor" },
  { key: "carbs", label: "Carbs", unit: "g", goalKey: "carbs", color: "#dba236", band: "window" },
  { key: "fat", label: "Fat", unit: "g", goalKey: "fat", color: "#4caf7d", band: "ceiling" },
];

const STATUS_CLASS = { good: " macro-good", warn: " macro-warn", bad: " macro-bad" };

const CHART_THEME = { grid: "#e7e6e0", tick: "#70747c", font: "Inter" };

// One status green/red across the tab: the tile tints, the tile bars, and the
// week chart's bars. The tint backgrounds live in FOOD_STYLES (CSS can't read
// these) — keep the two in step.
const STATUS = { good: "#3f8f2b", warn: "#dba236", bad: "#c4534a" };
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const fmt = (n) => (n == null ? "–" : Math.round(n * 10) / 10 === Math.round(n) ? Math.round(n).toLocaleString() : (Math.round(n * 10) / 10).toLocaleString());
const num = (v) => {
  if (v === "" || v == null) return null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
};

/**
 * A usable target, or null. Blank goal fields reach the Food tab as "" rather
 * than null, and a target of zero isn't one — both mean "not set", and every
 * part of a tile has to agree on that or the tint and the text contradict
 * each other.
 */
const targetOf = (v) => {
  const n = num(v);
  // Zero passes: it's what a paced calorie budget leaves for carbs once
  // protein and fat are paid for, and "0g, you're 178g over" is the truth.
  // Only a blank or negative goal counts as no target.
  return n != null && n >= 0 ? n : null;
};

function weekDateStrings(start) {
  return Array.from({ length: 7 }, (_, i) => formatMDY(addDays(start, i)));
}

/** Best food already in the catalog for a phrase, or null if nothing is close. */
function bestLocalMatch(query, catalog) {
  let best = null, bestScore = 0;
  for (const f of catalog) {
    const s = matchScore(query, f);
    if (s > bestScore) { best = f; bestScore = s; }
  }
  return bestScore >= 0.7 ? best : null;
}

export default function FoodTab({ targetsForDate, pacing, dailyEntryFor, onDayTotalsChange, onForceDailyCalories }) {
  const [dateStr, setDateStr] = useState(() => formatMDY(new Date()));
  const [weekStart, setWeekStart] = useState(() => blockStartFor(todayDate()));
  const [rows, setRows] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [meals, setMeals] = useState([]);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null);
  // Compare today against the pacing number instead of the flat daily goal.
  const [pacingOn, setPacingOn] = useState(() => localStorage.getItem("bt_food_pacing") === "1");
  useEffect(() => { localStorage.setItem("bt_food_pacing", pacingOn ? "1" : "0"); }, [pacingOn]);

  // Sheet / inline editors
  const [sheetSection, setSheetSection] = useState(null);
  const [editingRow, setEditingRow] = useState(null); // { id, qty, unit }
  const [mealDraft, setMealDraft] = useState(null);   // { section, name }

  // Voice entry
  const [aiText, setAiText] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiErr, setAiErr] = useState("");
  const [listening, setListening] = useState(false);
  const [review, setReview] = useState(null);
  // The entry box is a pull-up: collapsed it's one button, so the macro tiles
  // and the first meal both fit on a phone screen without scrolling.
  const [aiOpen, setAiOpen] = useState(false);

  // rows is mutated from async handlers that would otherwise close over a
  // stale copy, so the ref is the source of truth for every write path.
  const rowsRef = useRef([]);
  const loadedDates = useRef(new Set());
  const recognitionRef = useRef(null);
  const aiTextRef = useRef("");
  aiTextRef.current = aiText;

  const commitRows = useCallback((next) => {
    rowsRef.current = next;
    setRows(next);
  }, []);

  // --- loading -------------------------------------------------------------

  const ensureDates = useCallback(async (dates) => {
    const missing = dates.filter(d => !loadedDates.current.has(d));
    if (!missing.length) return;
    missing.forEach(d => loadedDates.current.add(d));
    try {
      const fetched = await foodApi.fetchFoodLog(missing);
      const missingSet = new Set(missing);
      commitRows([...rowsRef.current.filter(r => !missingSet.has(r.date)), ...fetched]);
    } catch (e) {
      missing.forEach(d => loadedDates.current.delete(d));
      setErr(`Couldn't load the food log: ${e.message}`);
    }
  }, [commitRows]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [items, savedMeals] = await Promise.all([foodApi.fetchFoodItems(), foodApi.fetchMeals()]);
        if (cancelled) return;
        setCatalog(items);
        setMeals(savedMeals);
        const start = blockStartFor(todayDate());
        await ensureDates([...weekDateStrings(start), ...weekDateStrings(addDays(start, -7))]);
        if (!cancelled) setStatus("ready");
      } catch (e) {
        if (cancelled) return;
        setStatus("error");
        setErr(
          /relation .* does not exist|schema cache/i.test(e.message || "")
            ? "The food tables aren't set up yet — run supabase_food.sql in the Supabase SQL editor, then reload."
            : `Couldn't load the food tab: ${e.message}`
        );
      }
    })();
    return () => { cancelled = true; };
  }, [ensureDates]);

  useEffect(() => {
    const d = parseDate(dateStr);
    if (d) ensureDates(weekDateStrings(blockStartFor(d)));
  }, [dateStr, ensureDates]);

  useEffect(() => { ensureDates(weekDateStrings(weekStart)); }, [weekStart, ensureDates]);

  useEffect(() => () => { try { recognitionRef.current?.stop(); } catch { /* already stopped */ } }, []);

  // --- derived -------------------------------------------------------------

  const dayRows = useMemo(() => rows.filter(r => r.date === dateStr), [rows, dateStr]);
  // Against the day's targets, a drink's calories count as carbs — otherwise
  // the calorie tile goes red while every macro sits green and nothing on
  // screen says where the difference went. The per-section lines below keep
  // the foods' own macros; only the totals being compared to a goal fold it in.
  const dayTotals = useMemo(() => withAlcoholAsCarbs(roundTotals(sumMacros(dayRows))), [dayRows]);
  const goalTargets = useMemo(() => targetsForDate(dateStr), [targetsForDate, dateStr]);

  const selectedDate = useMemo(() => parseDate(dateStr) || todayDate(), [dateStr]);
  const isToday = formatMDY(new Date()) === dateStr;

  // Pacing only means something for today: it's "what's left of this week's
  // budget, spread over the days still to come". On any other day the flat
  // goal is the only sensible thing to compare against, so the toggle has no
  // effect there and the control says why.
  const pacingAvailable = isToday && pacing?.recCal != null;
  const pacedCal = pacingOn && pacingAvailable ? pacing.recCal : null;
  const targets = useMemo(() => {
    if (pacedCal == null) return goalTargets;
    // Only the calorie number moves. Protein and fat are the numbers you aim
    // for every day either way; carbs absorb whatever calories are left, so
    // they follow the paced figure on their own.
    return {
      ...goalTargets,
      cal: pacedCal,
      carbs: carbGoalFrom(pacedCal, goalTargets.protein, goalTargets.fat),
    };
  }, [goalTargets, pacedCal]);
  const dailyEntry = dailyEntryFor(dateStr);

  const defaultSection = useMemo(
    () => (isToday ? sectionForHour(new Date().getHours()) : "dinner"),
    [isToday]
  );

  // A number typed by hand on the Daily tab is never overwritten from here —
  // when it disagrees with what's actually logged, say so and offer the swap.
  const manualCalConflict =
    dailyEntry && dailyEntry.cal != null && dailyEntry.calSource !== "food" &&
    dayRows.length > 0 && Math.abs(dailyEntry.cal - dayTotals.cal) > 1
      ? dailyEntry.cal
      : null;

  const syncDay = useCallback((allRows) => {
    const forDay = allRows.filter(r => r.date === dateStr);
    const totals = roundTotals(sumMacros(forDay));
    onDayTotalsChange(dateStr, totals.cal, forDay.length);
  }, [dateStr, onDayTotalsChange]);

  // --- mutations -----------------------------------------------------------

  const foodById = useCallback((id) => catalog.find(f => f.id === id) || null, [catalog]);

  /** Log one or more foods into a section. Externals get cached locally first. */
  const addEntries = useCallback(async (section, entries) => {
    const existing = rowsRef.current.filter(r => r.date === dateStr && r.section === section).length;
    const payload = [];
    const touched = [];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      let food = e.food;
      if (!food.id) food = await foodApi.importExternalFood(food);
      payload.push({
        date: dateStr, section, food_id: food.id,
        name: food.name, brand: food.brand || null,
        qty: e.qty, unit: normalizeUnit(e.unit) || "serving",
        ...macroColumns(food, e.qty, e.unit),
        sort_order: existing + i,
      });
      touched.push({ food, qty: e.qty, unit: normalizeUnit(e.unit) || "serving" });
    }
    const inserted = await foodApi.insertFoodRows(payload);
    const next = [...rowsRef.current, ...inserted];
    commitRows(next);
    syncDay(next);

    // Recency drives both the search ordering and what voice entry can match
    // against, so it's worth keeping current — but never worth failing on.
    const refreshed = await Promise.all(touched.map(t => foodApi.touchFood(t.food, t)));
    setCatalog(prev => {
      const byId = new Map(prev.map(f => [f.id, f]));
      refreshed.forEach(f => byId.set(f.id, f));
      return [...byId.values()].sort(sortCatalog);
    });
    return inserted;
  }, [dateStr, commitRows, syncDay]);

  const runWrite = useCallback(async (fn, failMessage) => {
    setSaving(true);
    setErr("");
    try {
      return await fn();
    } catch (e) {
      setErr(`${failMessage}: ${e.message}`);
      return null;
    } finally {
      setSaving(false);
    }
  }, []);

  // keepOpen is for one-tap adds off the recents list: a meal is usually
  // several things, and closing after each one meant reopening the sheet and
  // finding your place again for every item.
  const handleAddFood = useCallback(async ({ food, qty, unit, keepOpen }) => {
    const section = sheetSection;
    const ok = await runWrite(() => addEntries(section, [{ food, qty, unit }]), "Couldn't add that food");
    if (ok && !keepOpen) setSheetSection(null);
    return !!ok;
  }, [sheetSection, addEntries, runWrite]);

  const handleAddMeal = useCallback(async (meal) => {
    const section = sheetSection;
    await runWrite(async () => {
      const entries = [];
      for (const it of meal.items) {
        const food = (it.food_id && foodById(it.food_id)) || null;
        if (food) {
          entries.push({ food, qty: Number(it.qty) || 1, unit: it.unit || "serving" });
        } else {
          // The underlying food was deleted — the meal still carries its own
          // macro snapshot, so log that rather than dropping the item.
          entries.push({ snapshot: it });
        }
      }
      const withFoods = entries.filter(e => e.food);
      if (withFoods.length) await addEntries(section, withFoods);

      const snapshots = entries.filter(e => e.snapshot).map((e, i) => ({
        date: dateStr, section, food_id: null,
        name: e.snapshot.name, brand: e.snapshot.brand || null,
        qty: Number(e.snapshot.qty) || 1, unit: e.snapshot.unit || "serving",
        cal: Number(e.snapshot.cal) || 0, protein: Number(e.snapshot.protein) || 0,
        carbs: Number(e.snapshot.carbs) || 0, fat: Number(e.snapshot.fat) || 0,
        sort_order: 900 + i,
      }));
      if (snapshots.length) {
        const inserted = await foodApi.insertFoodRows(snapshots);
        const next = [...rowsRef.current, ...inserted];
        commitRows(next);
        syncDay(next);
      }
      await foodApi.touchMeal(meal);
      return true;
    }, "Couldn't add that meal");
    setSheetSection(null);
  }, [sheetSection, foodById, addEntries, dateStr, commitRows, syncDay, runWrite]);

  const handleCreateCustom = useCallback(async ({ fields, qty, unit }) => {
    const section = sheetSection;
    const ok = await runWrite(async () => {
      const food = await foodApi.createCustomFood(fields);
      setCatalog(prev => [food, ...prev]);
      return addEntries(section, [{ food, qty, unit }]);
    }, "Couldn't save that food");
    if (ok) setSheetSection(null);
  }, [sheetSection, addEntries, runWrite]);

  const handleDeleteRow = useCallback(async (row) => {
    await runWrite(async () => {
      await foodApi.deleteFoodRows([row.id]);
      const next = rowsRef.current.filter(r => r.id !== row.id);
      commitRows(next);
      syncDay(next);
      return true;
    }, "Couldn't delete that");
  }, [commitRows, syncDay, runWrite]);

  const handleSaveRowEdit = useCallback(async () => {
    const row = rowsRef.current.find(r => r.id === editingRow.id);
    const qty = num(editingRow.qty);
    if (!row || qty == null || qty <= 0) { setEditingRow(null); return; }
    const unit = normalizeUnit(editingRow.unit) || row.unit;
    const food = row.food_id ? foodById(row.food_id) : null;

    // With the food still in the catalog, rescale from its real serving data.
    // Without it, all we can honestly do is scale the row's own snapshot.
    const macros = food
      ? macroColumns(food, qty, unit)
      : (() => {
          const f = (Number(row.qty) || 1) === 0 ? 1 : qty / (Number(row.qty) || 1);
          return {
            cal: Math.round(row.cal * f),
            protein: Math.round(row.protein * f * 10) / 10,
            carbs: Math.round(row.carbs * f * 10) / 10,
            fat: Math.round(row.fat * f * 10) / 10,
          };
        })();

    await runWrite(async () => {
      const updated = await foodApi.updateFoodRow(row.id, { qty, unit, ...macros });
      const next = rowsRef.current.map(r => (r.id === row.id ? updated : r));
      commitRows(next);
      syncDay(next);
      return true;
    }, "Couldn't update that");
    setEditingRow(null);
  }, [editingRow, foodById, commitRows, syncDay, runWrite]);

  const handleSaveMealFromSection = useCallback(async () => {
    const { section, name } = mealDraft;
    if (!name.trim()) return;
    const items = dayRows.filter(r => r.section === section).map(r => ({
      food_id: r.food_id, name: r.name, brand: r.brand, qty: Number(r.qty), unit: r.unit,
      cal: Number(r.cal), protein: Number(r.protein), carbs: Number(r.carbs), fat: Number(r.fat),
    }));
    if (!items.length) { setMealDraft(null); return; }
    await runWrite(async () => {
      const meal = await foodApi.saveMeal({ name: name.trim(), section, items });
      setMeals(prev => [meal, ...prev]);
      return true;
    }, "Couldn't save that meal");
    setMealDraft(null);
  }, [mealDraft, dayRows, runWrite]);

  /**
   * Correcting a food detaches it from whichever database it came from.
   * Otherwise the next time the same item is picked out of search results,
   * importExternalFood would match on source + source_id and overwrite the
   * correction with the database's numbers again.
   */
  const handleUpdateFood = useCallback(async (id, fields) => {
    const existing = catalog.find(f => f.id === id);
    const patch = existing?.source_id
      ? { ...fields, source: "custom", source_id: null }
      : fields;
    return runWrite(async () => {
      const updated = await foodApi.updateFoodItem(id, patch);
      setCatalog(prev => prev.map(f => (f.id === id ? updated : f)));
      return updated;
    }, "Couldn't save that food");
  }, [catalog, runWrite]);

  // Logged rows carry their own macro snapshot and food_id is ON DELETE SET
  // NULL, so removing a food from the catalog leaves past days untouched.
  const handleDeleteFood = useCallback(async (food) => {
    await runWrite(async () => {
      await foodApi.deleteFoodItem(food.id);
      setCatalog(prev => prev.filter(f => f.id !== food.id));
      return true;
    }, "Couldn't delete that food");
  }, [runWrite]);

  const handleDeleteMeal = useCallback(async (meal) => {
    await runWrite(async () => {
      await foodApi.deleteMeal(meal.id);
      setMeals(prev => prev.filter(m => m.id !== meal.id));
      return true;
    }, "Couldn't delete that meal");
  }, [runWrite]);

  // --- voice / text entry --------------------------------------------------

  const speechSupported = typeof window !== "undefined"
    && !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  const toggleMic = useCallback(() => {
    if (listening) { try { recognitionRef.current?.stop(); } catch { /* no-op */ } return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = true;
    // Interim results are shown live but only finalized text is kept, so a
    // word the recognizer revises mid-sentence doesn't get logged twice.
    let settled = aiTextRef.current ? aiTextRef.current.trim() + " " : "";
    rec.onresult = (ev) => {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) settled += r[0].transcript;
        else interim += r[0].transcript;
      }
      setAiText((settled + interim).replace(/\s+/g, " ").trimStart());
    };
    rec.onerror = (ev) => {
      setAiErr(ev.error === "not-allowed"
        ? "Microphone access is blocked — allow it for this site, or type what you ate instead."
        : `Couldn't hear that (${ev.error}). Try again, or type it instead.`);
      setListening(false);
    };
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    setAiErr("");
    try {
      rec.start();
      setListening(true);
    } catch {
      setAiErr("Couldn't start the microphone. Type what you ate instead.");
    }
  }, [listening]);

  // Opening and starting to talk is one tap, the way it was when the box sat
  // open on the page — the mic starts inside the click so Safari allows it.
  const openAi = useCallback(() => {
    setAiErr("");
    setReview(null);
    setAiOpen(true);
    if (speechSupported && !listening) toggleMic();
  }, [speechSupported, listening, toggleMic]);

  const closeAi = useCallback(() => {
    if (listening) { try { recognitionRef.current?.stop(); } catch { /* no-op */ } }
    setAiOpen(false);
  }, [listening]);

  const runParse = useCallback(async () => {
    const text = aiText.trim();
    if (!text || aiBusy) return;
    if (listening) { try { recognitionRef.current?.stop(); } catch { /* no-op */ } }
    setAiBusy(true);
    setAiErr("");
    try {
      const now = new Date();
      const res = await foodApi.parseSpokenMeal({
        transcript: text,
        localTime: now.toLocaleString(undefined, {
          weekday: "long", hour: "numeric", minute: "2-digit",
        }),
        section: defaultSection,
        // Send each food's real portion, not its per-100 g storage form —
        // "1 can" is what someone actually says, so it's what the matcher
        // should be comparing against.
        history: catalog.slice(0, 80).map(f => ({
          id: f.id, name: f.name, brand: f.brand, serving: displayServing(f).label,
        })),
      });

      // Resolution order matches the ask: what you've eaten before wins, and
      // the wider database is only consulted when history has nothing.
      const resolved = [];
      const skipped = [];
      for (const item of res.items) {
        let food = item.history_id ? foodById(item.history_id) : null;
        let matchedFrom = food ? "history" : null;
        if (!food) {
          const local = bestLocalMatch(item.query, catalog);
          if (local) { food = local; matchedFrom = "history"; }
        }
        if (!food && item.candidates?.length) { food = item.candidates[0]; matchedFrom = "database"; }
        if (!food) { skipped.push(item); continue; }
        resolved.push({ item, food, candidates: item.candidates || [], matchedFrom });
      }

      if (!resolved.length) {
        setAiErr(skipped.length
          ? `Couldn't find ${skipped.map(s => `"${s.query}"`).join(", ")} in either database. Add ${skipped.length === 1 ? "it" : "them"} as a custom food.`
          : "Nothing recognizable in there — try naming the foods and amounts.");
        return;
      }

      const inserted = await addEntries(
        res.section,
        resolved.map(r => ({ food: r.food, qty: r.item.quantity, unit: r.item.unit }))
      );
      setReview({
        section: res.section,
        transcript: text,
        entries: resolved.map((r, i) => ({ ...r, row: inserted[i] })),
        skipped,
      });
      setAiText("");
      // The review card takes over on the page behind, so the sheet's work is
      // done — leaving it up would hide the thing you're meant to check.
      setAiOpen(false);
    } catch (e) {
      setAiErr(e.message);
    } finally {
      setAiBusy(false);
    }
  }, [aiText, aiBusy, listening, defaultSection, catalog, foodById, addEntries]);

  const undoReview = useCallback(async () => {
    const ids = review.entries.map(e => e.row?.id).filter(Boolean);
    await runWrite(async () => {
      await foodApi.deleteFoodRows(ids);
      const idSet = new Set(ids);
      const next = rowsRef.current.filter(r => !idSet.has(r.id));
      commitRows(next);
      syncDay(next);
      return true;
    }, "Couldn't undo that");
    setReview(null);
  }, [review, commitRows, syncDay, runWrite]);

  /** Swap one auto-picked food for another candidate the search turned up. */
  const swapReviewEntry = useCallback(async (index, candidate) => {
    const entry = review.entries[index];
    await runWrite(async () => {
      const [inserted] = await addEntries(review.section, [
        { food: candidate, qty: entry.item.quantity, unit: entry.item.unit },
      ]);
      if (entry.row?.id) {
        await foodApi.deleteFoodRows([entry.row.id]);
        const next = rowsRef.current.filter(r => r.id !== entry.row.id);
        commitRows(next);
        syncDay(next);
      }
      setReview(prev => ({
        ...prev,
        entries: prev.entries.map((e, i) => (i === index
          ? { ...e, food: candidate, row: inserted, matchedFrom: "database" }
          : e)),
      }));
      return true;
    }, "Couldn't swap that food");
  }, [review, addEntries, commitRows, syncDay, runWrite]);

  // --- render --------------------------------------------------------------

  if (status === "loading") {
    return (
      <div className="food-view">
        <style>{FOOD_STYLES}</style>
        <div className="dash-loading"><Loader2 className="spin" size={20} /><span>Loading your food log…</span></div>
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
    <div className="food-view">
      <style>{FOOD_STYLES}</style>

      {err && <div className="banner-error"><AlertCircle size={13} /> {err}</div>}

      {/* ---------------- Day header + macro totals ----------------
           Not wrapped in a panel: these are cards on the page background,
           the same arrangement as the Home tab's stat grid. */}
      <div className="food-day-head">
        <div className="food-day-nav">
          <button className="icon-btn" title="Previous day"
            onClick={() => setDateStr(formatMDY(addDays(selectedDate, -1)))}>
            <ChevronLeft size={14} />
          </button>
          <div className="food-day-label">
            <span className="food-day-dow">{WEEKDAY[selectedDate.getDay()]}</span>
            <span className="food-day-date">{dateStr}</span>
            {isToday && <span className="food-today-pill">Today</span>}
          </div>
          <button className="icon-btn" title="Next day"
            onClick={() => setDateStr(formatMDY(addDays(selectedDate, 1)))}>
            <ChevronRight size={14} />
          </button>
          {!isToday && (
            <button className="btn-ghost sm food-jump-today" onClick={() => setDateStr(formatMDY(new Date()))}>
              Jump to today
            </button>
          )}
          {/* Compare today against the flat daily goal, or against what's left
              of the week spread over the days still to come. */}
          <div className="toggle-group food-pace-toggle">
            <button className={"toggle-btn" + (!pacingOn ? " active" : "")}
              onClick={() => setPacingOn(false)} title="Compare against the daily goal">
              Daily goal
            </button>
            <button className={"toggle-btn" + (pacingOn ? " active" : "")}
              disabled={!pacingAvailable}
              onClick={() => setPacingOn(true)}
              title={pacingAvailable
                ? "Compare against what's left of this week, spread over the days still to come"
                : isToday ? "No calorie goal for this week yet" : "Pacing only applies to today"}>
              Pacing
            </button>
          </div>
        </div>
      </div>

      <div className="macro-grid">
        {MACROS.map(m => (
          <MacroTile key={m.key} macro={m} value={dayTotals[m.key]} target={targets[m.goalKey]}
            band={goalTargets.bands?.[m.goalKey]} buffer={goalTargets.buffers?.[m.goalKey]}
            paced={pacedCal != null && (m.key === "cal" || m.key === "carbs")}
            note={m.key === "carbs" && dayTotals.fromAlcohol
              ? `${fmt(dayTotals.fromAlcohol)}g of it from alcohol` : null} />
        ))}
      </div>

      {manualCalConflict != null && (
        <div className="food-conflict">
          <AlertCircle size={13} />
          <span>
            The Daily tab has <strong>{fmt(manualCalConflict)}</strong> kcal typed in by hand for this day, so it
            wasn't replaced. What's logged here adds up to <strong>{fmt(dayTotals.cal)}</strong>.
          </span>
          <button className="btn-ghost sm" onClick={() => onForceDailyCalories(dateStr, dayTotals.cal)}>
            Use {fmt(dayTotals.cal)}
          </button>
        </div>
      )}
      {pacedCal != null && (
        <div className="food-pace-note">
          <Sparkles size={12} />
          <span>
            Pacing: <strong>{fmt(pacedCal)} kcal</strong> today
            {goalTargets.cal != null && <> instead of the {fmt(goalTargets.cal)} daily goal</>}
            {pacing?.daysRemaining != null && <> — this week's remaining budget over {pacing.daysRemaining} day{pacing.daysRemaining === 1 ? "" : "s"}</>}
            . Protein and fat targets don't move; carbs follow the calorie number.
            {targets.carbs === 0 && <> Today that budget is fully spent on protein and fat, so there's nothing left for carbs.</>}
          </span>
        </div>
      )}
      {pacingOn && !pacingAvailable && (
        <div className="food-pace-note food-pace-note-off">
          <AlertCircle size={12} />
          <span>
            {isToday
              ? "Pacing needs a calorie goal for this week — set one on the Goal Settings tab."
              : "Pacing only applies to today, so this day is shown against its flat daily goal."}
          </span>
        </div>
      )}
      {!targets.cal && (
        <div className="food-hint food-hint-loose">
          No calorie or macro targets for this date yet — set them per phase on the Goal Settings tab and the bars
          here start comparing against them.
        </div>
      )}

      {/* ---------------- Voice / text entry ---------------- */}
      <button className="food-ai-trigger" onClick={openAi}>
        <Mic size={17} />
        <span className="fat-label">Say what you ate</span>
        <span className="fat-hint">it files the foods under the right meal</span>
      </button>

      {aiErr && !aiOpen && <div className="form-error food-ai-err"><AlertCircle size={12} /> {aiErr}</div>}

      {review && (
        <div className="food-review">
          <div className="food-review-head">
            <Check size={14} />
            <strong>
              Added {review.entries.length} item{review.entries.length === 1 ? "" : "s"} to {sectionLabel(review.section)}
            </strong>
            <button className="btn-ghost sm" onClick={undoReview}><Undo2 size={12} /> Undo all</button>
            <button className="icon-btn" onClick={() => setReview(null)} title="Dismiss"><X size={12} /></button>
          </div>
          {review.entries.map((e, i) => (
            <div className="food-review-row" key={e.row?.id || i}>
              <span className="frr-qty">{fmt(e.item.quantity)} {e.item.unit}</span>
              <span className="frr-name">
                {e.food.name}
                {e.food.brand && <span className="frr-brand"> · {e.food.brand}</span>}
              </span>
              <span className={"frr-src frr-" + e.matchedFrom}>
                {e.matchedFrom === "history" ? "from your history" : "from the database"}
              </span>
              <span className="frr-cal">{fmt(e.row?.cal)} kcal</span>
              {e.candidates.length > 1 && (
                <select
                  className="frr-swap"
                  value=""
                  onChange={(ev) => {
                    const pick = e.candidates[Number(ev.target.value)];
                    if (pick) swapReviewEntry(i, pick);
                  }}>
                  <option value="">Wrong food?</option>
                  {e.candidates.map((c, ci) => {
                    const s = displayServing(c);
                    return (
                      <option key={ci} value={ci}>
                        {c.name}{c.brand ? ` · ${c.brand}` : ""} — {fmt(s.cal)} kcal/{s.label}
                      </option>
                    );
                  })}
                </select>
              )}
              {e.item.note && <span className="frr-note">{e.item.note}</span>}
            </div>
          ))}
          {review.skipped.length > 0 && (
            <div className="food-review-skip">
              Couldn't find {review.skipped.map(s => `"${s.query}"`).join(", ")} — add
              {review.skipped.length === 1 ? " it" : " them"} by hand with the + button below.
            </div>
          )}
        </div>
      )}

      {/* ---------------- Meal sections ---------------- */}
      {MEAL_SECTIONS.map(sec => {
        const secRows = dayRows.filter(r => r.section === sec.key).sort((a, b) => a.sort_order - b.sort_order);
        const totals = roundTotals(sumMacros(secRows));
        return (
          <div className="panel food-section" key={sec.key}>
            <div className="panel-head">
              <div className="panel-title">
                {sec.label}
                {secRows.length > 0 && (
                  <span className="dim">
                    {fmt(totals.cal)} kcal · {fmt(totals.protein)}p / {fmt(totals.carbs)}c / {fmt(totals.fat)}f
                  </span>
                )}
              </div>
              <div className="panel-head-actions">
                {secRows.length > 0 && (
                  <button className="btn-ghost sm" onClick={() => setMealDraft({ section: sec.key, name: sec.label })}>
                    <BookMarked size={12} /> Save as meal
                  </button>
                )}
                <button className="btn-primary sm" onClick={() => setSheetSection(sec.key)} disabled={saving}>
                  <Plus size={13} /> Food
                </button>
              </div>
            </div>

            {mealDraft?.section === sec.key && (
              <div className="food-meal-draft">
                <input
                  value={mealDraft.name}
                  autoFocus
                  onChange={(e) => setMealDraft({ ...mealDraft, name: e.target.value })}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSaveMealFromSection(); }}
                  placeholder="Name this meal, e.g. Usual breakfast"
                />
                <button className="btn-primary sm" onClick={handleSaveMealFromSection}><Save size={12} /> Save</button>
                <button className="btn-ghost sm" onClick={() => setMealDraft(null)}><X size={12} /> Cancel</button>
              </div>
            )}

            {secRows.length === 0 ? (
              <div className="food-section-empty">Nothing logged yet.</div>
            ) : (
              <div className="food-rows">
                {secRows.map(r => {
                  // The unit it was logged in stays offered even when the food
                  // has since changed its portions (or been deleted outright).
                  const rowFood = foodById(r.food_id);
                  const units = unitOptions(rowFood || { serving_unit: r.unit });
                  if (!units.includes(r.unit)) units.push(r.unit);
                  return (
                  <div className="food-row" key={r.id}>
                    <div className="food-row-main">
                      <div className="food-row-name">
                        {r.name}
                        {r.brand && <span className="food-row-brand"> · {r.brand}</span>}
                      </div>
                      {editingRow?.id === r.id ? (
                        <div className="food-row-edit">
                          <input
                            className="qty-input"
                            value={editingRow.qty}
                            autoFocus
                            inputMode="decimal"
                            onChange={(e) => setEditingRow({ ...editingRow, qty: e.target.value })}
                            onKeyDown={(e) => { if (e.key === "Enter") handleSaveRowEdit(); }}
                          />
                          <select
                            value={editingRow.unit}
                            onChange={(e) => setEditingRow({ ...editingRow, unit: e.target.value })}>
                            {units.map(u => <option key={u} value={u}>{u}</option>)}
                          </select>
                          <button className="icon-btn" onClick={handleSaveRowEdit} title="Save"><Check size={12} /></button>
                          <button className="icon-btn" onClick={() => setEditingRow(null)} title="Cancel"><X size={12} /></button>
                        </div>
                      ) : (
                        <div className="food-row-qty">{fmt(r.qty)} {r.unit}</div>
                      )}
                    </div>
                    <div className="food-row-macros">
                      <span className="frm-cal">{fmt(r.cal)}</span>
                      <span className="frm-sub">{fmt(r.protein)}p · {fmt(r.carbs)}c · {fmt(r.fat)}f</span>
                    </div>
                    <div className="food-row-actions">
                      <button className="icon-btn" title="Change amount"
                        onClick={() => setEditingRow({ id: r.id, qty: String(r.qty), unit: r.unit })}>
                        <Pencil size={12} />
                      </button>
                      <DeleteBtn id={`row-${r.id}`} onDelete={() => handleDeleteRow(r)} />
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* ---------------- Week averages ---------------- */}
      <WeekPanel
        weekStart={weekStart}
        setWeekStart={setWeekStart}
        rows={rows}
        targetsForDate={targetsForDate}
        onPickDay={setDateStr}
      />

      {aiOpen && (
        <div className="food-sheet-backdrop" onClick={(e) => { if (e.target === e.currentTarget) closeAi(); }}>
          <div className="food-sheet food-ai-sheet">
            <div className="food-sheet-head">
              <div className="food-sheet-title"><Mic size={14} /> Say what you ate</div>
              <button className="icon-btn" onClick={closeAi} title="Close"><X size={14} /></button>
            </div>

            <div className="food-sheet-body">
              {speechSupported ? (
                <button
                  className={"mic-btn" + (listening ? " listening" : "")}
                  onClick={toggleMic}
                  title={listening ? "Stop listening" : "Start talking"}>
                  <Mic size={20} />
                  <span>{listening ? "Listening… tap to stop" : "Tap and talk"}</span>
                </button>
              ) : (
                <div className="food-hint">
                  This browser has no speech recognition — type it instead (Safari and Chrome support the mic).
                </div>
              )}

              <textarea
                className="food-ai-input"
                value={aiText}
                autoFocus={!speechSupported}
                onChange={(e) => setAiText(e.target.value)}
                rows={3}
                placeholder={'e.g. "a can of tuna fish, four ounces of white rice and ten saltine crackers"'}
              />

              {aiErr && <div className="form-error"><AlertCircle size={12} /> {aiErr}</div>}

              <div className="food-ai-actions">
                <button className="btn-primary" onClick={runParse} disabled={aiBusy || !aiText.trim()}>
                  {aiBusy ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />}
                  {aiBusy ? "Working it out…" : "Add to log"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {sheetSection && (
        <AddFoodSheet
          section={sheetSection}
          catalog={catalog}
          meals={meals}
          saving={saving}
          onClose={() => setSheetSection(null)}
          onAdd={handleAddFood}
          onAddMeal={handleAddMeal}
          onCreateCustom={handleCreateCustom}
          onDeleteMeal={handleDeleteMeal}
          onUpdateFood={handleUpdateFood}
          onDeleteFood={handleDeleteFood}
        />
      )}
    </div>
  );
}

function sortCatalog(a, b) {
  const at = a.last_used_at ? Date.parse(a.last_used_at) : 0;
  const bt = b.last_used_at ? Date.parse(b.last_used_at) : 0;
  if (at !== bt) return bt - at;
  return (b.use_count || 0) - (a.use_count || 0);
}

// ---------------------------------------------------------------------------

function MacroTile({ macro, value, target: rawTarget, band: dateBand, buffer, paced, note }) {
  const target = targetOf(rawTarget);
  // A zero target with anything eaten is a full bar, not an empty one.
  const pct = target > 0 ? Math.min(100, (value / target) * 100)
    : target === 0 && value > 0 ? 100 : 0;
  const remaining = target != null ? target - value : null;

  // Three states now: green, amber inside the goal's buffer, red outside it.
  // The band handles direction, so one call covers all four macros — and it
  // comes from the goal in force, which is what makes a gain phase read the
  // opposite way round from a cut.
  const band = dateBand || macro.band;
  const status = macroStatus(value, target, { band, buffer });
  const amber = bufferRangeLabel(target, { band, buffer });

  return (
    <div className={"macro-tile" + (STATUS_CLASS[status] || "")}>
      <div className="macro-tile-label">
        {macro.label}
        {paced && <span className="macro-paced-tag">pace</span>}
      </div>
      <div className="macro-tile-value">
        {fmt(value)}<span className="macro-tile-unit">{macro.unit}</span>
        {target != null && <span className="macro-tile-target">/ {fmt(target)}{macro.unit}</span>}
      </div>
      <div className="macro-bar">
        <div className="macro-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="macro-tile-sub">
        {target == null
          ? "no target set"
          : band === "floor"
            ? (remaining > 0 ? `${fmt(remaining)}${macro.unit} to go` : `${fmt(-remaining)}${macro.unit} over`)
            : (remaining >= 0 ? `${fmt(remaining)}${macro.unit} left` : `${fmt(-remaining)}${macro.unit} over`)}
        {status === "warn" && amber && <span className="macro-tile-amber">amber {amber}</span>}
      </div>
      {note && <div className="macro-tile-note">{note}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------

function WeekPanel({ weekStart, setWeekStart, rows, targetsForDate, onPickDay }) {
  const [metric, setMetric] = useState("cal");
  const macro = MACROS.find(m => m.key === metric);
  const todayStr = formatMDY(new Date());
  const thisWeekStart = blockStartFor(todayDate());
  const isThisWeek = weekStart.getTime() === thisWeekStart.getTime();
  const isLastWeek = weekStart.getTime() === addDays(thisWeekStart, -7).getTime();

  const days = useMemo(() => weekDateStrings(weekStart).map(ds => {
    const dayRows = rows.filter(r => r.date === ds);
    // Same fold-in as the day's tiles, so a week's carb bars and the day
    // you'd tap through to can't tell different stories.
    const totals = withAlcoholAsCarbs(roundTotals(sumMacros(dayRows)));
    const d = parseDate(ds);
    return {
      date: ds,
      label: `${WEEKDAY[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`,
      logged: dayRows.length > 0,
      isToday: ds === todayStr,
      ...totals,
    };
  }), [weekStart, rows, todayStr]);

  // Only days you actually logged count toward the average — an untouched day
  // is missing data, not a zero-calorie day. Today is left out too (it's still
  // in progress) unless it's the only thing logged this week.
  const counted = useMemo(() => {
    const logged = days.filter(d => d.logged);
    const past = logged.filter(d => !d.isToday);
    return past.length ? past : logged;
  }, [days]);

  const averages = useMemo(() => {
    if (!counted.length) return null;
    const out = {};
    for (const m of MACROS) {
      out[m.key] = counted.reduce((a, d) => a + d[m.key], 0) / counted.length;
    }
    return out;
  }, [counted]);

  // Targets can change mid-week when a phase flips, so average the per-day
  // target across the same days the actuals came from.
  // Buffers are per-goal like the targets; the week compares against the
  // buffer in force on the most recent day it counted.
  const avgBuffers = useMemo(() => {
    const last = counted[counted.length - 1];
    return last ? (targetsForDate(last.date).buffers || {}) : {};
  }, [counted, targetsForDate]);

  // Bands come from the same day as the buffers — a week that straddles a
  // phase change is judged by the phase it ended in.
  const avgBands = useMemo(() => {
    const last = counted[counted.length - 1];
    return last ? (targetsForDate(last.date).bands || {}) : {};
  }, [counted, targetsForDate]);

  const avgTargets = useMemo(() => {
    if (!counted.length) return {};
    const out = {};
    for (const m of MACROS) {
      const vals = counted.map(d => targetsForDate(d.date)[m.goalKey]).filter(v => v != null);
      out[m.key] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    }
    return out;
  }, [counted, targetsForDate]);

  const target = avgTargets[metric];
  const chartMax = Math.max(...days.map(d => d[metric]), target || 0);
  const todayHeldBack = days.some(d => d.isToday && d.logged) && !counted.some(d => d.isToday);

  return (
    <div className="panel food-week-panel">
      <div className="panel-head">
        <div className="panel-title">
          Weekly averages
          <span className="dim">
            {formatMDY(weekStart)} – {formatMDY(blockEndFor(weekStart))} ·{" "}
            {counted.length} day{counted.length === 1 ? "" : "s"} averaged
            {todayHeldBack && " · today still in progress"}
          </span>
        </div>
        <div className="panel-head-actions">
          <div className="toggle-group">
            {MACROS.map(m => (
              <button key={m.key} className={"toggle-btn" + (metric === m.key ? " active" : "")}
                onClick={() => setMetric(m.key)}>
                {m.label}
              </button>
            ))}
          </div>
          <div className="food-week-nav">
            <button className="icon-btn" title="Previous week"
              onClick={() => setWeekStart(addDays(weekStart, -7))}><ChevronLeft size={14} /></button>
            <button className="btn-ghost sm" onClick={() => setWeekStart(addDays(thisWeekStart, -7))} disabled={isLastWeek}>
              Last week
            </button>
            <button className="btn-ghost sm" onClick={() => setWeekStart(thisWeekStart)} disabled={isThisWeek}>
              This week
            </button>
            <button className="icon-btn" title="Next week" disabled={isThisWeek}
              onClick={() => setWeekStart(addDays(weekStart, 7))}><ChevronRight size={14} /></button>
          </div>
        </div>
      </div>

      {averages ? (
        <div className="week-avg-grid">
          {MACROS.map(m => {
            const v = averages[m.key];
            const t = targetOf(avgTargets[m.key]);
            const status = macroStatus(v, t, { band: avgBands[m.key] || m.band, buffer: avgBuffers[m.key] });
            return (
              <div key={m.key} className={"week-avg-tile" + (STATUS_CLASS[status] || "")}>
                <div className="week-avg-label">{m.label} avg</div>
                <div className="week-avg-value">{fmt(v)}<span className="macro-tile-unit">{m.unit}</span></div>
                <div className="week-avg-sub">
                  {t == null ? "no target" : <>target {fmt(t)}{m.unit} · {v > t ? "+" : ""}{fmt(v - t)}{m.unit}</>}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="food-section-empty">Nothing logged this week yet.</div>
      )}

      <ResponsiveContainer width="100%" height={210}>
        <BarChart data={days} margin={{ top: 10, right: 8, left: -14, bottom: 6 }}
          onClick={(e) => { if (e?.activeLabel) { const hit = days.find(d => d.label === e.activeLabel); if (hit) onPickDay(hit.date); } }}>
          <CartesianGrid strokeDasharray="2 4" stroke={CHART_THEME.grid} vertical={false} />
          <XAxis dataKey="label" tick={{ fill: CHART_THEME.tick, fontSize: 10.4, fontFamily: CHART_THEME.font }}
            axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: CHART_THEME.tick, fontSize: 10.4, fontFamily: CHART_THEME.font }}
            axisLine={false} tickLine={false} domain={[0, Math.ceil(chartMax * 1.15) || 10]} />
          <Tooltip content={<WeekTooltip macro={macro} target={target} />} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
          {target != null && (
            <ReferenceLine y={target} stroke={CHART_THEME.tick} strokeDasharray="4 4"
              label={<TargetLabel value={`target ${fmt(target)}`} />} />
          )}
          <Bar dataKey={metric} radius={[4, 4, 0, 0]} maxBarSize={38}>
            {days.map((d, i) => {
              const status = macroStatus(d[metric], target, { band: avgBands[metric] || macro.band, buffer: avgBuffers[metric] });
              const color = !d.logged ? "#e0dfd8" : STATUS[status] || macro.color;
              return <Cell key={i} fill={color} />;
            })}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="food-hint">
        Tap a bar to open that day. Days with nothing logged have no bar at all — they're left out of the
        average rather than counted as a zero-calorie day, and today is held back until it's done.
      </div>
    </div>
  );
}

// The target caption sits at the far end of its dashed line, clear of the
// bars. recharts' own label positions are named against a rectangle, and a
// horizontal reference line is zero-height — "insideTopRight" there puts the
// text *below* the line — so it's less surprising to place it directly.
function TargetLabel({ value, viewBox }) {
  if (!viewBox) return null;
  return (
    <text x={viewBox.x + viewBox.width - 3} y={viewBox.y - 5} textAnchor="end"
      fill={CHART_THEME.tick} fontSize={11} fontFamily={CHART_THEME.font}>
      {value}
    </text>
  );
}

function WeekTooltip({ active, payload, macro, target }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="tt">
      <div className="tt-head"><span className="tt-date">{d.label}</span>{d.isToday && <span className="tt-phase">today</span>}</div>
      {!d.logged ? (
        <div className="tt-row"><span className="tt-name">nothing logged</span></div>
      ) : (
        MACROS.map(m => (
          <div className="tt-row" key={m.key}>
            <span className="tt-dot" style={{ background: m.color }} />
            <span className="tt-name">{m.label}</span>
            <span className="tt-val">{fmt(d[m.key])}{m.unit}</span>
          </div>
        ))
      )}
      {target != null && d.logged && (
        <div className="tt-row"><span className="tt-name">{macro.label} target</span><span className="tt-val">{fmt(target)}{macro.unit}</span></div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

const EMPTY_CUSTOM = {
  name: "", brand: "", serving_qty: "1", serving_unit: "serving", serving_grams: "",
  cal: "", protein: "", carbs: "", fat: "",
};

/**
 * A picked food with the name and brand you typed over it, if you typed any.
 *
 * Clearing the name entirely means "leave it alone" rather than "call it
 * nothing" — an unnamed food is unfindable afterwards, and the barcode's own
 * name is at least something. The brand does clear, because plenty of foods
 * genuinely have none and barcode databases invent them.
 */
function renamed(food, edit) {
  if (!edit) return food;
  return {
    ...food,
    name: edit.name.trim() || food.name,
    brand: edit.brand.trim() || null,
  };
}

function AddFoodSheet({
  section, catalog, meals, saving, onClose, onAdd, onAddMeal, onCreateCustom,
  onDeleteMeal, onUpdateFood, onDeleteFood,
}) {
  // "custom" isn't a tab — it's the form you land in from "Add a food" or from
  // editing one, and backing out returns you to where you came from.
  const [mode, setMode] = useState("search"); // search | mine | meals | custom
  const [customFrom, setCustomFrom] = useState("mine"); // tab the custom form was opened from
  const [editingFood, setEditingFood] = useState(null);
  const [mineQuery, setMineQuery] = useState("");
  const [confirmDelFood, setConfirmDelFood] = useState(null);
  const [query, setQuery] = useState("");
  const [dbResults, setDbResults] = useState([]);
  // What one-tap has logged since the sheet opened, so staying put still tells
  // you what went in. The sheet unmounts on close, so this resets by itself.
  const [added, setAdded] = useState([]);
  const openOrder = useRef(null);
  if (openOrder.current === null) openOrder.current = new Map(catalog.map((f, i) => [f.id, i]));
  const [warnings, setWarnings] = useState([]);
  const [attribution, setAttribution] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanErr, setScanErr] = useState("");
  const [selected, setSelected] = useState(null);
  // Set only for a scanned food: { name, brand } you can correct before it's
  // saved. Null for anything picked off a list, where the name is already the
  // one you filed it under.
  const [pickEdit, setPickEdit] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [qty, setQty] = useState("1");
  const [unit, setUnit] = useState("serving");
  const [custom, setCustom] = useState(EMPTY_CUSTOM);
  const [customQty, setCustomQty] = useState("1");
  const [lookup, setLookup] = useState(null); // { busy, source, sources, note, confidence, error }
  const labelInputRef = useRef(null);

  // Fills the form from a web search rather than saving anything — the person
  // still reviews every number before it's stored, which matters because a
  // wrong custom food quietly skews every day it appears in afterwards.
  /**
   * Merge looked-up nutrition into the form and report what it wanted to call
   * the food. When you're editing, the lookup is there to fix the numbers —
   * the name is yours. Packages and web pages print variants ("Sliced Swiss"
   * for what you filed as Swiss cheese), and taking that silently renames a
   * food out from under the name you'd find it by. It's offered instead.
   */
  const applyLookup = useCallback((n, seed) => {
    // `seed` is for a lookup fired in the same tick the form was filled in
    // (the Web button on the search row) — `custom` still holds the old value
    // then, so the caller passes what it just set.
    const was = { name: seed?.name ?? custom.name, brand: seed?.brand ?? custom.brand };
    const keep = !!editingFood;
    const name = keep && was.name.trim() ? was.name : (n.name || was.name);
    const brand = keep && was.brand.trim() ? was.brand : (n.brand || was.brand);
    setCustom(c => ({
      ...c,
      name, brand,
      serving_qty: String(n.serving_qty),
      serving_unit: n.serving_unit,
      serving_grams: n.serving_grams != null ? String(n.serving_grams) : "",
      cal: String(n.cal),
      protein: String(n.protein),
      carbs: String(n.carbs),
      fat: String(n.fat),
    }));
    return {
      readName: n.name && n.name !== name ? n.name : null,
      readBrand: n.brand && n.brand !== brand ? n.brand : null,
    };
  }, [editingFood, custom.name, custom.brand]);

  const runLookup = useCallback(async (seed) => {
    const name = (seed?.name ?? custom.name).trim();
    const brand = (seed?.brand ?? custom.brand).trim();
    if (!name) return;
    setLookup({ busy: true });
    try {
      const res = await foodApi.lookupNutrition({
        name,
        brand,
        serving: !seed && custom.serving_unit && custom.serving_unit !== "serving"
          ? `${custom.serving_qty} ${custom.serving_unit}` : "",
      });
      if (!res.nutrition) {
        setLookup({ busy: false, error: res.error, sources: res.sources || [] });
        return;
      }
      const n = res.nutrition;
      const named = applyLookup(n, seed);
      setLookup({ busy: false, sources: res.sources || [], note: n.note, confidence: n.confidence, ...named });
    } catch (e) {
      setLookup({ busy: false, error: e.message });
    }
  }, [custom.name, custom.brand, custom.serving_qty, custom.serving_unit, applyLookup]);

  const mine = useMemo(() => {
    const q = query.trim();
    // Recents are ordered by recency, which every add rewrites — so without
    // pinning the order the list reshuffles under your finger between taps.
    // Hold the order the sheet opened with until it closes.
    if (!q) {
      const rank = (f) => (openOrder.current.has(f.id) ? openOrder.current.get(f.id) : Infinity);
      return [...catalog].sort((a, b) => rank(a) - rank(b)).slice(0, 12);
    }
    return catalog
      .map(f => ({ f, s: matchScore(q, f) }))
      .filter(x => x.s > 0.3)
      .sort((a, b) => b.s - a.s)
      .slice(0, 12)
      .map(x => x.f);
  }, [catalog, query]);

  // Only the wider database search is debounced — your own foods filter as you
  // type, since that's a local array.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setDbResults([]); setWarnings([]); return; }
    let cancelled = false;
    const controller = new AbortController();
    const t = setTimeout(async () => {
      setSearching(true);
      setSearchErr("");
      try {
        const res = await foodApi.searchFoodDatabase(q, { signal: controller.signal });
        if (!cancelled) {
          setDbResults(res.foods || []);
          setWarnings(res.warnings || []);
          // A malformed field here used to throw inside render and take the
          // whole sheet down with it — not worth losing a search over.
          setAttribution(Array.isArray(res.attribution) ? res.attribution : []);
        }
      } catch (e) {
        if (!cancelled && e.name !== "AbortError") setSearchErr(e.message);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 400);
    return () => { cancelled = true; controller.abort(); clearTimeout(t); };
  }, [query]);

  const pick = useCallback(async (food, { editable = false } = {}) => {
    // Seeded once per pick: the detail fetch below re-applies the food a
    // moment later, and re-seeding there would wipe a name you'd already
    // started correcting.
    let seeded = false;
    const apply = (f) => {
      // Opens on the amount you had last time, so the edit path starts from
      // the same place one-tap add would have taken you.
      const p = lastPortion(f);
      setSelected(f);
      setQty(String(p.qty));
      setUnit(p.unit);
      if (!editable) setPickEdit(null);
      else if (!seeded) { setPickEdit({ name: f.name || "", brand: f.brand || "" }); seeded = true; }
    };
    apply(food);
    // USDA and Open Food Facts search hits can be missing portions the detail
    // endpoint knows about. Nutritionix already returns complete servings, so
    // asking for detail there is a guaranteed wasted round trip.
    if (!food.id && food.source_id && (food.source === "usda" || food.source === "off")) {
      setLoadingDetail(true);
      try {
        const full = await foodApi.fetchFoodDetail(food.source, food.source_id);
        if (full) apply(full);
      } catch { /* the summary already has usable macros */ } finally {
        setLoadingDetail(false);
      }
    }
  }, []);

  /** One tap: log the remembered amount without leaving the list. */
  const quickAdd = useCallback(async (food, portion) => {
    const ok = await onAdd({ food, qty: portion.qty, unit: portion.unit, keepOpen: true });
    if (ok) setAdded(prev => [...prev, { id: food.id, name: food.name, label: `${fmt(portion.qty)} ${portion.unit}` }]);
  }, [onAdd]);

  // A scanned package is just a picked food — same quantity step, same add
  // button — so the scanner hands off into exactly the flow search uses.
  const handleScan = useCallback(async (code) => {
    setScanBusy(true);
    setScanErr("");
    try {
      const food = await foodApi.lookupBarcode(code);
      setScanning(false);
      // Editable: barcode databases name things the way the manufacturer
      // registered them, not the way you'd look for them later.
      pick(food, { editable: true });
    } catch (e) {
      setScanErr(e.message);
    } finally {
      setScanBusy(false);
    }
  }, [pick]);

  const preview = selected ? scaleMacros(selected, num(qty) ?? 0, unit) : null;

  const customValid = custom.name.trim() && num(custom.cal) != null && (num(custom.serving_qty) ?? 0) > 0;

  const customFields = () => ({
    name: custom.name.trim(),
    brand: custom.brand.trim() || null,
    serving_qty: num(custom.serving_qty) ?? 1,
    serving_unit: normalizeUnit(custom.serving_unit) || "serving",
    serving_grams: num(custom.serving_grams),
    cal: num(custom.cal) ?? 0,
    protein: num(custom.protein) ?? 0,
    carbs: num(custom.carbs) ?? 0,
    fat: num(custom.fat) ?? 0,
  });

  const openCreate = useCallback((from = "mine") => {
    setEditingFood(null);
    setCustom(EMPTY_CUSTOM);
    setCustomQty("1");
    setLookup(null);
    setCustomFrom(from);
    setMode("custom");
  }, []);

  // The Web button on the search row: what you typed is the food's name, and
  // the lookup starts straight away rather than making you retype it into the
  // custom form. Same review-before-saving rule as every other lookup — it
  // fills the form in, it doesn't save anything.
  const openWebLookup = useCallback((text) => {
    const name = text.trim();
    if (!name) return;
    setEditingFood(null);
    setCustom({ ...EMPTY_CUSTOM, name });
    setCustomQty("1");
    setCustomFrom("search");
    setMode("custom");
    runLookup({ name, brand: "" });
  }, [runLookup]);

  const closeCustom = useCallback(() => {
    setEditingFood(null);
    setMode(customFrom);
  }, [customFrom]);

  const openEdit = useCallback((food) => {
    // Show the food's real serving, not the per-100 g form it's stored in.
    // The form asks for "one serving exactly as the label reads it", and
    // pre-filling 100 g / 313 kcal against that instruction was its own kind
    // of wrong answer.
    const s = displayServing(food);
    setEditingFood(food);
    setCustomFrom("mine");
    setCustom({
      name: food.name || "",
      brand: food.brand || "",
      serving_qty: String(s.qty),
      serving_unit: s.unit,
      serving_grams: s.grams != null ? String(s.grams) : "",
      cal: String(s.cal),
      protein: String(s.protein),
      carbs: String(s.carbs),
      fat: String(s.fat),
    });
    setLookup(null);
    setMode("custom");
  }, []);

  const openScanner = useCallback(() => { setScanErr(""); setScanning(true); }, []);

  // capture="environment" opens the rear camera straight from the file input,
  // which beats a getUserMedia viewfinder here: the OS camera focuses and
  // exposes properly, and small print needs that.
  const openLabelCamera = useCallback(() => {
    setEditingFood(null);
    setCustom(EMPTY_CUSTOM);
    setLookup(null);
    setCustomFrom("mine");
    setMode("custom");
    labelInputRef.current?.click();
  }, []);

  const handleLabelPhoto = useCallback(async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // so re-picking the same photo still fires onChange
    if (!file) return;
    setLookup({ busy: true, source: "label" });
    try {
      const image = await fileToScaledJpeg(file);
      const res = await foodApi.readNutritionLabel(image);
      if (!res.nutrition) {
        setLookup({ busy: false, error: res.error, source: "label" });
        return;
      }
      const n = res.nutrition;
      const named = applyLookup(n);
      setLookup({
        busy: false,
        source: "label",
        note: [n.note, n.servings_per_container ? `${n.servings_per_container} servings per container.` : ""]
          .filter(Boolean).join(" "),
        confidence: n.confidence,
        ...named,
      });
    } catch (err) {
      setLookup({ busy: false, error: err.message, source: "label" });
    }
  }, [applyLookup]);

  const customTab = (tab) => mode === tab || (mode === "custom" && customFrom === tab);

  const mineList = useMemo(() => {
    const q = mineQuery.trim();
    if (!q) return catalog;
    return catalog.filter(f => matchScore(q, f) > 0.3);
  }, [catalog, mineQuery]);

  return (
    <div className="food-sheet-backdrop sheet-top" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="food-sheet">
        {/* One hidden input drives every "photo of label" button. */}
        <input ref={labelInputRef} type="file" accept="image/*" capture="environment"
          style={{ display: "none" }} onChange={handleLabelPhoto} />
        <div className="food-sheet-head">
          <div className="food-sheet-title"><Utensils size={14} /> Add to {sectionLabel(section)}</div>
          <button className="icon-btn" onClick={onClose} title="Close"><X size={14} /></button>
        </div>

        <div className="toggle-group food-sheet-tabs">
          {/* Switching tabs drops a half-finished pick, which is what tapping
              a different tab means. */}
          {/* The custom form isn't a tab of its own, so it keeps lit whichever
              tab you opened it from — that's where backing out returns you. */}
          <button className={"toggle-btn" + (customTab("search") && !selected ? " active" : "")}
            onClick={() => { setSelected(null); setMode("search"); }}>Search</button>
          <button className={"toggle-btn" + (customTab("mine") && !selected ? " active" : "")}
            onClick={() => { setSelected(null); setMode("mine"); }}>My foods</button>
          <button className={"toggle-btn" + (mode === "meals" && !selected ? " active" : "")}
            onClick={() => { setSelected(null); setMode("meals"); }}>My meals</button>
        </div>

        <div className="food-sheet-body">
          {!selected && mode === "search" && (
            <>
              <div className="food-search-row">
                <div className="food-search-box">
                  <Search size={14} />
                  {/* Deliberately not autofocused. The sheet opens onto the
                      foods you actually eat, and raising the keyboard covers
                      them — searching is the fallback, not the first move. */}
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search your foods and the food database…"
                  />
                  {searching && <Loader2 size={14} className="spin" />}
                </div>
                <button className="scan-btn" onClick={openScanner} title="Scan a barcode">
                  <ScanLine size={18} />
                  <span>Scan</span>
                </button>
                <button className="scan-btn" onClick={() => openWebLookup(query)}
                  disabled={query.trim().length < 2}
                  title={query.trim().length < 2
                    ? "Type a name first, then search the web for it"
                    : `Search the web for "${query.trim()}" and make it your own food`}>
                  <Globe size={18} />
                  <span>Web</span>
                </button>
              </div>
              {scanErr && !scanning && <div className="form-error"><AlertCircle size={12} /> {scanErr}</div>}

              {added.length > 0 && (
                <div className="food-added-note">
                  <Check size={13} />
                  <span>
                    <strong>{added.length} added</strong> to {sectionLabel(section)} —{" "}
                    {added.map(a => `${a.label} ${a.name}`).join(", ")}. Keep going, or close when you're done.
                  </span>
                </div>
              )}

              {mine.length > 0 && (
                <div className="food-result-group">
                  <div className="food-result-head">{query.trim() ? "Your foods" : "Recently eaten"}</div>
                  {mine.map(f => (
                    <FoodResult key={f.id} food={f} onPick={pick} onQuickAdd={quickAdd} disabled={saving} mine />
                  ))}
                </div>
              )}

              {dbResults.length > 0 && (
                <div className="food-result-group">
                  <div className="food-result-head">Food database</div>
                  {dbResults.map(f => <FoodResult key={`${f.source}-${f.source_id}`} food={f} onPick={pick} />)}
                </div>
              )}

              {searchErr && <div className="form-error"><AlertCircle size={12} /> {searchErr}</div>}
              {warnings.map((w, i) => <div className="food-hint" key={i}>{w}</div>)}
              {attribution.map((a, i) => <div className="food-attribution" key={i}>{a}</div>)}
              {query.trim().length >= 2 && !searching && !mine.length && !dbResults.length && !searchErr && (
                <div className="food-section-empty">
                  <div>Nothing found for "{query.trim()}".</div>
                  <div className="food-empty-actions">
                    <button className="btn-primary sm" onClick={() => openWebLookup(query)}>
                      <Globe size={13} /> Search the web for it
                    </button>
                    <button className="btn-ghost sm"
                      onClick={() => { openCreate("search"); setCustom({ ...EMPTY_CUSTOM, name: query.trim() }); }}>
                      <Plus size={13} /> Add it by hand
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Not tied to a tab: a food can be picked from search results, from
              My foods, or straight off a barcode scan started in either. */}
          {selected && (
            <div className="food-pick">
              <button className="btn-ghost sm" onClick={() => setSelected(null)}>
                <ChevronLeft size={12} /> {mode === "mine" ? "Back to my foods" : "Back to results"}
              </button>
              {pickEdit ? (
                <div className="food-pick-edit">
                  <label>Name
                    <input value={pickEdit.name} placeholder={selected.name}
                      onChange={(e) => setPickEdit(p => ({ ...p, name: e.target.value }))} />
                  </label>
                  <label>Brand
                    <input value={pickEdit.brand} placeholder="optional"
                      onChange={(e) => setPickEdit(p => ({ ...p, brand: e.target.value }))} />
                  </label>
                </div>
              ) : (
                <div className="food-pick-name">
                  {selected.name}
                  {selected.brand && <span className="food-row-brand"> · {selected.brand}</span>}
                </div>
              )}
              <div className="food-pick-serving">
                {loadingDetail
                  ? <><Loader2 size={12} className="spin" /> loading portions…</>
                  : (() => {
                      const s = displayServing(selected);
                      return <>{fmt(s.cal)} kcal per {s.label} · {fmt(s.protein)}p / {fmt(s.carbs)}c / {fmt(s.fat)}f</>;
                    })()}
              </div>

              <div className="food-pick-qty">
                <label>Amount<input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" /></label>
                <label>Unit
                  <select value={unit} onChange={(e) => setUnit(e.target.value)}>
                    {unitOptions(selected).map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </label>
              </div>

              {preview && (
                <div className="food-pick-preview">
                  <span className="fpp-cal">{fmt(preview.cal)} kcal</span>
                  <span>{fmt(preview.protein)}p · {fmt(preview.carbs)}c · {fmt(preview.fat)}f</span>
                  {!preview.exact && (
                    <span className="fpp-warn">
                      This food has no "{unit}" portion on file, so that's counted as {fmt(num(qty))} servings — check it.
                    </span>
                  )}
                </div>
              )}

              <div className="form-actions">
                <button className="btn-ghost" onClick={() => setSelected(null)}><X size={13} /> Cancel</button>
                <button className="btn-primary" disabled={saving || (num(qty) ?? 0) <= 0}
                  onClick={() => onAdd({ food: renamed(selected, pickEdit), qty: num(qty), unit })}>
                  {saving ? <Loader2 size={13} className="spin" /> : <Plus size={13} />} Add to {sectionLabel(section)}
                </button>
              </div>
            </div>
          )}

          {!selected && mode === "mine" && (
            <>
              <div className="mine-head">
                <button className="btn-primary sm" onClick={openScanner}><ScanLine size={13} /> Scan a barcode</button>
                <button className="btn-primary sm" onClick={openLabelCamera}><Camera size={13} /> Photo of label</button>
                <button className="btn-ghost sm" onClick={openCreate}><Plus size={13} /> Add by hand</button>
                <span className="mine-count">
                  {catalog.length} food{catalog.length === 1 ? "" : "s"} in your list
                </span>
              </div>
              {scanErr && !scanning && <div className="form-error"><AlertCircle size={12} /> {scanErr}</div>}

              {catalog.length > 6 && (
                <div className="food-search-box mine-filter">
                  <Search size={14} />
                  <input value={mineQuery} onChange={(e) => setMineQuery(e.target.value)} placeholder="Filter your foods…" />
                </div>
              )}

              {catalog.length === 0 ? (
                <div className="food-section-empty">
                  Nothing here yet. Anything you log from a search gets saved here automatically, or add one by hand.
                </div>
              ) : mineList.length === 0 ? (
                <div className="food-section-empty">No food matches "{mineQuery}".</div>
              ) : mineList.map(f => {
                const s = displayServing(f);
                return (
                  <div className="mine-row" key={f.id}>
                    <button className="mine-pick" onClick={() => pick(f)} title={`Add ${f.name} to ${sectionLabel(section)}`}>
                      <span className="food-result-name">
                        {f.name}
                        {f.brand && <span className="food-row-brand"> · {f.brand}</span>}
                      </span>
                      <span className="food-result-macros">
                        {fmt(s.cal)} kcal / {s.label} · {fmt(s.protein)}p {fmt(s.carbs)}c {fmt(s.fat)}f
                      </span>
                    </button>
                    <div className="mine-actions">
                      <button className="icon-btn" title="Edit this food" onClick={() => openEdit(f)}>
                        <Pencil size={12} />
                      </button>
                      <button
                        className={"icon-btn danger" + (confirmDelFood === f.id ? " armed" : "")}
                        title={confirmDelFood === f.id ? "Tap again to confirm" : "Delete this food"}
                        onMouseLeave={() => { if (confirmDelFood === f.id) setConfirmDelFood(null); }}
                        onClick={() => {
                          if (confirmDelFood === f.id) { onDeleteFood(f); setConfirmDelFood(null); }
                          else setConfirmDelFood(f.id);
                        }}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                );
              })}

              {catalog.length > 0 && (
                <div className="food-hint">
                  Tap a food to log it, or the pencil to fix its nutrition. Days you've already logged keep the numbers
                  they were logged with, so correcting a food never rewrites your history.
                </div>
              )}
            </>
          )}

          {!selected && mode === "meals" && (
            <>
              {meals.length === 0 ? (
                <div className="food-section-empty">
                  No saved meals yet. Log a section the way you like it, then hit "Save as meal" on it.
                </div>
              ) : meals.map(m => {
                const totals = roundTotals(sumMacros(m.items));
                return (
                  <div className="food-meal-row" key={m.id}>
                    <button className="food-meal-pick" onClick={() => onAddMeal(m)} disabled={saving}>
                      <span className="food-meal-name">{m.name}</span>
                      <span className="food-meal-sub">
                        {m.items.length} item{m.items.length === 1 ? "" : "s"} · {fmt(totals.cal)} kcal ·{" "}
                        {fmt(totals.protein)}p / {fmt(totals.carbs)}c / {fmt(totals.fat)}f
                      </span>
                    </button>
                    <button className="icon-btn danger" title="Delete meal" onClick={() => onDeleteMeal(m)}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                );
              })}
            </>
          )}

          {!selected && mode === "custom" && (
            <div className="food-custom">
              <button className="btn-ghost sm" onClick={closeCustom}>
                <ChevronLeft size={12} /> Back to {customFrom === "search" ? "search" : "my foods"}
              </button>
              <div className="form-note">
                Enter the nutrition for one serving exactly as the label reads it. Filling in the gram weight is what
                lets you log it later by weight ("4 oz") instead of by serving.
                {editingFood?.source_id && (
                  <> This one came from {editingFood.source === "usda" ? "USDA" : editingFood.source === "off" ? "Open Food Facts" : "a food database"} —
                  saving changes makes it your own copy, so a later search can't overwrite your correction.</>
                )}
              </div>

              <div className="lookup-bar">
                <button className="btn-primary sm" onClick={() => labelInputRef.current?.click()}
                  disabled={lookup?.busy}>
                  {lookup?.busy && lookup.source === "label"
                    ? <Loader2 size={12} className="spin" /> : <Camera size={12} />}
                  {lookup?.busy && lookup.source === "label" ? "Reading the label…" : "Photo of label"}
                </button>
                <button className="btn-ghost sm" onClick={() => runLookup()} disabled={!custom.name.trim() || lookup?.busy}>
                  {lookup?.busy && lookup.source !== "label"
                    ? <Loader2 size={12} className="spin" /> : <Globe size={12} />}
                  {lookup?.busy && lookup.source !== "label" ? "Searching the web…" : "Search the web"}
                </button>
                <span className="lookup-bar-hint">
                  Photographing the Nutrition Facts panel is the most accurate option — it's the package itself, not a
                  database's copy of it. When you don't have the package to hand, search the web by name instead
                  (type the name first).
                </span>
              </div>

              {/* A label read has no web sources, so gating on those alone
                  swallowed its "check the numbers" warning entirely. */}
              {lookup && !lookup.busy && (lookup.error || lookup.confidence || lookup.sources?.length > 0) && (
                <div className={"lookup-result" + (lookup.error ? " lookup-miss" : "")}>
                  {lookup.error ? (
                    <div className="lookup-line"><AlertCircle size={12} /> {lookup.error}</div>
                  ) : (
                    <div className="lookup-line">
                      <Check size={12} />
                      {lookup.source === "label" ? "Read off the label" : "Filled in from the web"} —{" "}
                      <strong>check the numbers before saving.</strong>
                      {lookup.confidence && (
                        <span className={"lookup-confidence lc-" + lookup.confidence}>{lookup.confidence} confidence</span>
                      )}
                    </div>
                  )}
                  {(lookup.readName || lookup.readBrand) && (
                    <div className="lookup-note lookup-rename">
                      <span>
                        It reads{lookup.readName && <> the name as <strong>{lookup.readName}</strong></>}
                        {lookup.readName && lookup.readBrand && " and"}
                        {lookup.readBrand && <> the brand as <strong>{lookup.readBrand}</strong></>}
                        . Kept yours, so the food stays where you'd look for it.
                      </span>
                      <button className="btn-ghost sm" onClick={() => {
                        setCustom(c => ({
                          ...c,
                          name: lookup.readName || c.name,
                          brand: lookup.readBrand || c.brand,
                        }));
                        setLookup(l => ({ ...l, readName: null, readBrand: null }));
                      }}>Use it</button>
                    </div>
                  )}
                  {lookup.note && <div className="lookup-note">{lookup.note}</div>}
                  {lookup.sources?.length > 0 && (
                    <div className="lookup-sources">
                      {lookup.sources.map((s, i) => (
                        <a key={i} href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div className="form-grid food-custom-grid">
                <label>Name<input value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} placeholder="e.g. Protein shake" /></label>
                <label>Brand<input value={custom.brand} onChange={(e) => setCustom({ ...custom, brand: e.target.value })} placeholder="optional" /></label>
                <label>Serving size<input value={custom.serving_qty} onChange={(e) => setCustom({ ...custom, serving_qty: e.target.value })} inputMode="decimal" /></label>
                <label>Serving unit<input value={custom.serving_unit} onChange={(e) => setCustom({ ...custom, serving_unit: e.target.value })} placeholder="scoop, cup, slice…" /></label>
                <label>Grams per serving<input value={custom.serving_grams} onChange={(e) => setCustom({ ...custom, serving_grams: e.target.value })} placeholder="optional" inputMode="decimal" /></label>
                <label>Calories<input value={custom.cal} onChange={(e) => setCustom({ ...custom, cal: e.target.value })} inputMode="decimal" /></label>
                <label>Protein (g)<input value={custom.protein} onChange={(e) => setCustom({ ...custom, protein: e.target.value })} inputMode="decimal" /></label>
                <label>Carbs (g)<input value={custom.carbs} onChange={(e) => setCustom({ ...custom, carbs: e.target.value })} inputMode="decimal" /></label>
                <label>Fat (g)<input value={custom.fat} onChange={(e) => setCustom({ ...custom, fat: e.target.value })} inputMode="decimal" /></label>
                {/* Only when creating: editing a food shouldn't also log it. */}
                {!editingFood && (
                  <label>How many now<input value={customQty} onChange={(e) => setCustomQty(e.target.value)} inputMode="decimal" /></label>
                )}
              </div>
              <div className="form-actions">
                <button className="btn-ghost" onClick={closeCustom}>
                  <X size={13} /> Cancel
                </button>
                {editingFood ? (
                  <button className="btn-primary" disabled={!customValid || saving}
                    onClick={async () => {
                      const fields = customFields();
                      // What you typed becomes the food's serving. Any portion
                      // it already had under that same name has to go, or the
                      // old one shadows the correction — the food would still
                      // resolve "1 serving" to the 33 g it came with instead
                      // of the 32 g just entered. Portions under other names
                      // are kept: they're stored in grams, so they stay
                      // correct against the new base.
                      const kept = (editingFood.alt_servings || []).filter(a => {
                        const u = normalizeUnit(a.unit || "");
                        return u && u !== fields.serving_unit;
                      });
                      const ok = await onUpdateFood(editingFood.id, { ...fields, alt_servings: kept });
                      if (ok) { setEditingFood(null); setMode("mine"); }
                    }}>
                    {saving ? <Loader2 size={13} className="spin" /> : <Save size={13} />} Save changes
                  </button>
                ) : (
                  <button className="btn-primary" disabled={!customValid || saving}
                    onClick={() => {
                      const fields = { ...customFields(), alt_servings: [] };
                      // "How many now" counts SERVINGS, and a serving is often
                      // more than one of its own unit — "12 oz", "2 crackers".
                      // Logging qty 1 of "oz" against a 12 oz serving asked for
                      // one ounce of it, a twelfth of the calories, and got
                      // remembered as the portion to repeat next time.
                      onCreateCustom({
                        fields,
                        qty: (num(customQty) ?? 1) * fields.serving_qty,
                        unit: fields.serving_unit,
                      });
                    }}>
                    {saving ? <Loader2 size={13} className="spin" /> : <Save size={13} />} Save & add
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {scanning && (
        <BarcodeScanner
          busy={scanBusy}
          error={scanErr}
          onDetected={handleScan}
          onClose={() => setScanning(false)}
        />
      )}
    </div>
  );
}

function FoodResult({ food, onPick, onQuickAdd, disabled, mine }) {
  // Where one tap would log it, the line under the name describes that
  // portion — the amount you had last time, with macros to match — so the
  // button needs no label of its own and the row already says what it does.
  // Everything else falls back to the food's own portion rather than the
  // per-100 g figure it's stored as.
  const p = onQuickAdd ? lastPortion(food) : null;
  const s = p ? portionDisplay(food, p) : displayServing(food);
  return (
    <div className="food-result-row">
      <button className="food-result" onClick={() => onPick(food)}>
        <span className="food-result-name">
          {food.name}
          {food.brand && <span className="food-row-brand"> · {food.brand}</span>}
          {mine && <span className="food-result-tag">yours</span>}
        </span>
        <span className="food-result-macros">
          {fmt(s.cal)} kcal / {s.label} · {fmt(s.protein)}p {fmt(s.carbs)}c {fmt(s.fat)}f
        </span>
      </button>
      {p && (
        <button className="food-quick-add" disabled={disabled}
          onClick={() => onQuickAdd(food, p)}
          aria-label={`Add ${fmt(p.qty)} ${p.unit} of ${food.name}`}
          title={`Add ${fmt(p.qty)} ${p.unit} of ${food.name}`}>
          <Plus size={18} />
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

export const FOOD_STYLES = `
  .food-view { display: block; }

  .food-day-head { margin-bottom: 12px; }
  .food-day-nav { display: flex; align-items: center; gap: 10px; }
  .food-day-label { display: flex; align-items: baseline; gap: 8px; }
  .food-day-dow { font-family: 'Inter', sans-serif; font-size: 19px; font-weight: 700; }
  .food-day-date { font-family: 'Inter', sans-serif; font-size: 19px; color: var(--text-dim); }
  .food-today-pill { font-family: 'Inter', sans-serif; font-size: 13px; letter-spacing: 0.05em; text-transform: uppercase; color: var(--good); background: rgba(54,135,39,0.13); padding: 3px 10px; border-radius: 999px; }
  .food-jump-today { margin-left: auto; }
  .food-pace-toggle { margin-left: auto; flex-shrink: 0; }
  .food-jump-today + .food-pace-toggle { margin-left: 0; }
  .macro-paced-tag { margin-left: 6px; padding: 1px 6px; border-radius: 999px; background: rgba(20,22,27,0.08); font-size: 10.6px; font-weight: 600; letter-spacing: 0.03em; text-transform: uppercase; vertical-align: 1px; }
  .macro-warn .macro-paced-tag { background: rgba(138, 91, 19, 0.14); }
  .macro-good .macro-paced-tag { background: rgba(43, 110, 30, 0.14); }
  .macro-bad .macro-paced-tag { background: rgba(165, 52, 42, 0.14); }
  .macro-tile-amber { flex-basis: 100%; font-size: 12px; color: rgba(138, 91, 19, 0.85); }

  .food-pace-note { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 14px; padding: 10px 13px; border-radius: 12px; background: var(--panel-2); font-size: 13px; line-height: 1.55; color: var(--text-dim); }
  .food-pace-note svg { flex-shrink: 0; margin-top: 3px; }
  .food-pace-note strong { color: var(--text); }
  .food-pace-note-off { background: #fdf1dd; color: #8a5b13; }
  .food-pace-note-off strong { color: #8a5b13; }

  .macro-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 14px; }
  .macro-tile { background: var(--panel); border: 1px solid var(--border); border-radius: 18px; padding: 14px 15px; box-shadow: 0 1px 2px rgba(20, 22, 27, 0.05), 0 4px 16px rgba(20, 22, 27, 0.05); min-width: 0; }
  /* Tinted the way the Home tab tints its hero cards: coloured background,
     status-coloured text, no separate badge. --tint-bar is the one thing the
     card's own colour can't express — the fill has to sit ON the tint. */
  /* --tint-bar mirrors STATUS.good / STATUS.warn / STATUS.bad in this file. */
  .macro-tile.macro-good, .week-avg-tile.macro-good { --tint-bar: #3f8f2b; background: #ddefd4; border-color: #cfe6c4; }
  .macro-tile.macro-bad, .week-avg-tile.macro-bad { --tint-bar: #c4534a; background: #f8ddd9; border-color: #eec4be; }
  /* Amber is the app's existing warning pair (see .food-conflict), used here
     for "inside the goal's alert buffer" — close enough to matter, not yet
     wrong. */
  .macro-tile.macro-warn, .week-avg-tile.macro-warn { --tint-bar: #dba236; background: #fdf1dd; border-color: #ecd3a4; }
  .macro-good .macro-tile-label, .macro-good .macro-tile-value, .macro-good .macro-tile-sub,
  .macro-good .week-avg-label, .macro-good .week-avg-value, .macro-good .week-avg-sub { color: #2b6e1e; }
  .macro-bad .macro-tile-label, .macro-bad .macro-tile-value, .macro-bad .macro-tile-sub,
  .macro-bad .week-avg-label, .macro-bad .week-avg-value, .macro-bad .week-avg-sub { color: #a5342a; }
  .macro-warn .macro-tile-label, .macro-warn .macro-tile-value, .macro-warn .macro-tile-sub,
  .macro-warn .week-avg-label, .macro-warn .week-avg-value, .macro-warn .week-avg-sub { color: #8a5b13; }
  /* The unit and the "/ target" suffix keep their own weight, just re-tinted. */
  .macro-good .macro-tile-unit, .macro-good .macro-tile-target { color: rgba(43, 110, 30, 0.72); }
  .macro-bad .macro-tile-unit, .macro-bad .macro-tile-target { color: rgba(165, 52, 42, 0.72); }
  .macro-warn .macro-tile-unit, .macro-warn .macro-tile-target { color: rgba(138, 91, 19, 0.72); }
  .macro-tile-label { font-family: 'Inter', sans-serif; font-size: 13.2px; font-weight: 600; letter-spacing: 0.01em; color: var(--text-dim); margin-bottom: 8px; }
  .macro-tile-value { font-family: 'Inter', sans-serif; letter-spacing: -0.02em; font-size: 30px; font-weight: 700; line-height: 1; white-space: nowrap; }
  .macro-tile-unit { font-size: 14px; font-weight: 500; color: var(--text-dim); margin-left: 1px; }
  .macro-tile-target { font-family: 'Inter', sans-serif; font-size: 13.2px; font-weight: 500; color: var(--text-faint); margin-left: 6px; }
  .macro-bar { height: 5px; border-radius: 999px; background: rgba(20,22,27,0.11); margin: 10px 0 7px; overflow: hidden; }
  /* Falls back to the neutral text colour when there's no target to be
     over or under, which is the only state with no status to show. */
  .macro-bar-fill { height: 100%; border-radius: 999px; background: var(--tint-bar, var(--text-dim)); transition: width 0.25s ease, background 0.25s ease; }
  .macro-tile-sub { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; font-family: 'Inter', sans-serif; font-size: 13.2px; color: var(--text-dim); }
  /* Quieter than the sub-line and deliberately not re-tinted with the status:
     it explains where a number came from, it isn't part of the verdict. */
  .macro-tile-note { font-family: 'Inter', sans-serif; font-size: 11.6px; color: var(--text-faint); margin-top: 3px; }

  .food-conflict { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; margin-bottom: 14px; padding: 10px 13px; border-radius: 12px; background: #fdf1dd; border: 1px solid #ecd3a4; color: #8a5b13; font-size: 13px; line-height: 1.5; }
  .food-conflict svg { flex-shrink: 0; color: #b07d17; }
  .food-conflict span { flex: 1; min-width: 200px; }
  .food-hint-loose { margin: 0 2px 14px; }
  .food-hint { font-family: 'Inter', sans-serif; font-size: 12.6px; color: var(--text-faint); line-height: 1.55; margin-top: 12px; padding-bottom: 4px; }
  .food-hint-inline { font-family: 'Inter', sans-serif; font-size: 12.6px; color: var(--text-faint); flex: 1; }

  /* Collapsed, this is a single row — the box it opens is a pull-up sheet. */
  .food-ai-trigger { display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; margin-bottom: 14px; padding: 14px 16px; border: 1px solid var(--text-dim); border-radius: 18px; background: var(--panel); color: var(--text); font-family: 'Inter', sans-serif; font-size: 14.5px; text-align: center; cursor: pointer; }
  .food-ai-trigger:hover { background: var(--panel-2); }
  .food-ai-trigger svg { color: var(--text); flex: none; }
  .fat-label { font-weight: 600; flex: none; }
  .fat-hint { color: var(--text-faint); font-size: 12.6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .food-ai-err { margin: -6px 0 14px; }

  .food-ai-sheet .food-sheet-body { display: flex; flex-direction: column; gap: 12px; }
  .mic-btn { display: flex; align-items: center; justify-content: center; gap: 9px; width: 100%; padding: 15px 12px; border-radius: 14px; border: 1px solid var(--border); background: var(--panel-2); color: var(--text-dim); font-family: 'Inter', sans-serif; font-size: 13.6px; font-weight: 600; line-height: 1.3; text-align: center; cursor: pointer; }
  .mic-btn:hover { color: var(--text); border-color: var(--text-dim); }
  .mic-btn.listening { background: rgba(199,58,47,0.1); border-color: var(--bad); color: var(--bad); animation: micpulse 1.4s ease-in-out infinite; }
  @keyframes micpulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.62; } }
  .food-ai-input { width: 100%; resize: vertical; border: 1px solid var(--border); border-radius: 12px; background: var(--panel-2); color: var(--text); padding: 12px 13px; font-family: 'Inter', sans-serif; font-size: 14.5px; line-height: 1.5; outline: none; }
  .food-ai-input:focus { border-color: var(--text-dim); }
  .food-ai-actions { display: flex; align-items: center; gap: 12px; }
  .food-ai-actions .btn-primary { margin-left: auto; }

  .food-review { margin-top: 14px; border: 1px solid #cfe6c4; background: #f4faf1; border-radius: 14px; padding: 12px 14px; }
  .food-review-head { display: flex; align-items: center; gap: 9px; color: #3a6b2c; font-size: 13.5px; padding-bottom: 8px; border-bottom: 1px solid #d9ead0; }
  .food-review-head strong { flex: 1; font-family: 'Inter', sans-serif; font-weight: 600; }
  .food-review-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 8px 0; border-bottom: 1px solid #e4f0dc; font-size: 13px; }
  .food-review-row:last-child { border-bottom: none; }
  .frr-qty { font-family: 'Inter', sans-serif; font-size: 12px; color: var(--text-dim); min-width: 72px; }
  .frr-name { font-weight: 600; }
  .frr-brand { font-weight: 400; color: var(--text-faint); }
  .frr-src { font-family: 'Inter', sans-serif; font-size: 10px; letter-spacing: 0.04em; text-transform: uppercase; padding: 2px 7px; border-radius: 999px; }
  .frr-history { background: rgba(54,135,39,0.14); color: #3a6b2c; }
  .frr-database { background: rgba(91,141,238,0.14); color: #3a5fa8; }
  .frr-cal { margin-left: auto; font-family: 'Inter', sans-serif; letter-spacing: -0.02em; font-weight: 600; }
  .frr-swap { font-family: 'Inter', sans-serif; font-size: 11px; max-width: 200px; border: 1px solid var(--border); border-radius: 7px; padding: 3px 6px; background: var(--panel); color: var(--text-dim); }
  .frr-note { flex-basis: 100%; font-family: 'Inter', sans-serif; font-size: 11.2px; color: var(--text-faint); }
  .food-review-skip { margin-top: 9px; font-family: 'Inter', sans-serif; font-size: 11.6px; color: #a03d33; line-height: 1.5; }

  .food-section { padding-bottom: 12px; }
  /* On a narrow screen the title and its controls can't share a line, so the
     controls wrap. A lone item on a wrapped line ignores the parent's
     space-between and sits left; letting it claim the line restores its own
     flex-end alignment. It has to stay shrinkable (1 1 auto, min-width 0) or
     a control row wider than the panel — the week panel's toggle plus its
     arrows — pushes out past the edge instead of wrapping inside itself. */
  .food-section .panel-head-actions,
  .food-week-panel .panel-head-actions { flex: 1 1 auto; min-width: 0; justify-content: flex-end; }
  .food-section-empty { font-family: 'Inter', sans-serif; font-size: 13.2px; color: var(--text-faint); padding: 12px 2px 14px; }
  .food-rows { display: flex; flex-direction: column; }
  .food-row { display: flex; align-items: center; gap: 12px; padding: 9px 2px; border-bottom: 1px solid var(--border); }
  .food-row:last-child { border-bottom: none; }
  .food-row-main { flex: 1; min-width: 0; }
  .food-row-name { font-size: 14.2px; font-weight: 500; }
  .food-row-brand { color: var(--text-faint); font-weight: 400; font-size: 12.6px; }
  .food-row-qty { font-family: 'Inter', sans-serif; font-size: 13px; color: var(--text-dim); margin-top: 2px; }
  .food-row-edit { display: flex; align-items: center; gap: 6px; margin-top: 4px; }
  .food-row-edit .qty-input { width: 58px; }
  .food-row-edit input, .food-row-edit select { background: var(--panel-2); border: 1px solid var(--border); border-radius: 7px; color: var(--text); padding: 4px 7px; font-family: 'Inter', sans-serif; font-size: 12px; outline: none; }
  .food-row-macros { display: flex; flex-direction: column; align-items: flex-end; flex-shrink: 0; }
  .frm-cal { font-family: 'Inter', sans-serif; letter-spacing: -0.02em; font-size: 17px; font-weight: 700; }
  .frm-sub { font-family: 'Inter', sans-serif; font-size: 12px; color: var(--text-faint); margin-top: 3px; white-space: nowrap; }
  .food-row-actions { display: flex; gap: 4px; flex-shrink: 0; }
  .food-meal-draft { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; padding: 10px 0 4px; }
  .food-meal-draft input { flex: 1; min-width: 180px; background: var(--panel-2); border: 1px solid var(--border); border-radius: 8px; color: var(--text); padding: 8px 10px; font-family: 'Inter', sans-serif; font-size: 13.5px; outline: none; }

  .food-week-panel { padding-bottom: 14px; }
  .food-week-nav { display: flex; align-items: center; gap: 5px; }
  .week-avg-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 8px 0 16px; }
  .week-avg-tile { background: transparent; border: 1px solid var(--border); border-radius: 14px; padding: 13px 15px; min-width: 0; }
  .week-avg-label { font-family: 'Inter', sans-serif; font-size: 13.2px; font-weight: 600; letter-spacing: 0.01em; color: var(--text-dim); }
  .week-avg-value { font-family: 'Inter', sans-serif; letter-spacing: -0.02em; font-size: 26px; font-weight: 700; line-height: 1.2; margin-top: 6px; }
  .week-avg-sub { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; font-family: 'Inter', sans-serif; font-size: 13.2px; color: var(--text-dim); margin-top: 6px; }

  .food-sheet-backdrop { position: fixed; inset: 0; z-index: 60; background: rgba(20,22,27,0.42); display: flex; align-items: flex-end; justify-content: center; padding: 24px 16px; }
  /* The add-food sheet changes height constantly — search results, a picked
     food, the custom form. Pinned to the bottom, every one of those moved the
     top edge and the tabs with it; pinned to the top, it grows downwards and
     the controls you're aiming at stay put. The entry sheet keeps rising from
     the bottom: it's three controls tall and doesn't resize like this. */
  .food-sheet-backdrop.sheet-top { align-items: flex-start; }
  .food-sheet { width: 100%; max-width: 640px; max-height: 88vh; display: flex; flex-direction: column; background: var(--panel); border-radius: 20px; box-shadow: 0 18px 50px rgba(20,22,27,0.28); overflow: hidden; }
  .food-sheet-head { display: flex; align-items: center; justify-content: space-between; padding: 16px 18px 10px; }
  .food-sheet-title { display: flex; align-items: center; gap: 8px; font-family: 'Inter', sans-serif; font-size: 16px; font-weight: 700; }
  .food-sheet-tabs { margin: 0 18px 12px; align-self: flex-start; }
  .food-sheet-body { flex: 1; overflow-y: auto; padding: 0 18px 20px; -webkit-overflow-scrolling: touch; }

  .food-search-row { display: flex; align-items: stretch; gap: 8px; }
  .food-search-box { flex: 1; display: flex; align-items: center; gap: 8px; background: var(--panel-2); border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px; color: var(--text-faint); min-width: 0; }
  .food-search-box input { flex: 1; min-width: 0; background: transparent; border: none; outline: none; color: var(--text); font-family: 'Inter', sans-serif; font-size: 14.5px; }
  .scan-btn { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; flex-shrink: 0; padding: 6px 12px; border-radius: 12px; border: 1px solid var(--border); background: var(--panel-2); color: var(--text-dim); font-family: 'Inter', sans-serif; font-size: 9.6px; letter-spacing: 0.05em; text-transform: uppercase; cursor: pointer; }
  .scan-btn:hover:not(:disabled) { color: var(--text); border-color: var(--text-dim); }
  .scan-btn:disabled { opacity: 0.45; cursor: default; }
  .food-empty-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-top: 10px; }
  .food-attribution { font-family: 'Inter', sans-serif; font-size: 10.6px; color: var(--text-faint); margin-top: 14px; padding-bottom: 4px; }

  .scanner-backdrop { position: fixed; inset: 0; z-index: 70; background: rgba(12,13,16,0.88); display: flex; align-items: center; justify-content: center; padding: 16px; }
  .scanner-frame { width: 100%; max-width: 520px; background: var(--panel); border-radius: 18px; overflow: hidden; }
  .scanner-head { display: flex; align-items: center; justify-content: space-between; padding: 13px 15px; font-family: 'Inter', sans-serif; font-size: 14.5px; font-weight: 600; }
  .scanner-head span { display: flex; align-items: center; gap: 7px; }
  .scanner-video-wrap { position: relative; background: #000; aspect-ratio: 4 / 3; }
  .scanner-video { width: 100%; height: 100%; object-fit: cover; display: block; }
  /* A window to aim through — barcodes read best filling the middle band. */
  .scanner-reticle { position: absolute; left: 8%; right: 8%; top: 32%; height: 36%; border: 2px solid rgba(255,255,255,0.85); border-radius: 12px; box-shadow: 0 0 0 9999px rgba(0,0,0,0.28); }
  .scanner-overlay { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 9px; background: rgba(0,0,0,0.55); color: #fff; font-family: 'Inter', sans-serif; font-size: 12.4px; }
  .scanner-error { display: flex; align-items: center; gap: 7px; padding: 11px 15px; background: #fcebe9; color: #a03d33; font-size: 12.8px; line-height: 1.5; }
  .scanner-error svg { flex-shrink: 0; }
  .scanner-hint { font-family: 'Inter', sans-serif; font-size: 11.2px; color: var(--text-faint); padding: 11px 15px 14px; line-height: 1.5; }
  .food-result-group { margin-top: 16px; }
  .food-result-head { font-family: 'Inter', sans-serif; font-size: 10.6px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-faint); margin-bottom: 6px; }
  .food-result { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; width: 100%; text-align: left; background: transparent; border: none; border-bottom: 1px solid var(--border); padding: 10px 4px; cursor: pointer; color: var(--text); }
  .food-result:hover { background: var(--panel-2); }
  /* The border moves to the row so the quick-add button sits inside the same
     ruled line rather than floating past it. */
  .food-result-row { display: flex; align-items: stretch; gap: 8px; border-bottom: 1px solid var(--border); }
  .food-result-row .food-result { border-bottom: none; min-width: 0; }
  .food-result-row .food-result-name, .food-result-row .food-result-macros { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
  .food-quick-add { display: flex; align-items: center; justify-content: center; flex: none; align-self: center; width: 40px; height: 40px; padding: 0; border: 1px solid var(--border); border-radius: 50%; background: var(--panel); color: var(--text); cursor: pointer; }
  .food-quick-add:hover:not(:disabled) { background: var(--good); border-color: var(--good); color: #ffffff; }
  .food-added-note { display: flex; align-items: flex-start; gap: 9px; margin: 10px 0 2px; padding: 10px 12px; border: 1px solid #cfe6c4; background: #f4faf1; border-radius: 12px; font-family: 'Inter', sans-serif; font-size: 12.6px; line-height: 1.5; color: #3a6b2c; }
  .food-added-note svg { flex: none; margin-top: 1px; }
  .food-added-note strong { font-weight: 700; }
  .food-quick-add:disabled { opacity: 0.5; cursor: default; }
  .food-result-name { font-size: 14px; font-weight: 500; }
  .food-result-tag { margin-left: 7px; font-family: 'Inter', sans-serif; font-size: 9.4px; letter-spacing: 0.05em; text-transform: uppercase; color: var(--good); background: rgba(54,135,39,0.13); padding: 1px 6px; border-radius: 999px; }
  .food-result-macros { font-family: 'Inter', sans-serif; font-size: 12.6px; color: var(--text-faint); }

  .food-pick { padding-top: 6px; }
  .food-pick-name { font-family: 'Inter', sans-serif; font-size: 17px; font-weight: 700; margin: 12px 0 4px; }
  .food-pick-edit { display: grid; grid-template-columns: 1.6fr 1fr; gap: 12px; margin: 12px 0 8px; }
  .food-pick-edit label { display: flex; flex-direction: column; gap: 5px; font-family: 'Inter', sans-serif; font-size: 13.2px; font-weight: 600; letter-spacing: 0.01em; color: var(--text-dim); }
  .food-pick-serving { display: flex; align-items: center; gap: 6px; font-family: 'Inter', sans-serif; font-size: 13.2px; color: var(--text-dim); }
  .food-pick-qty { display: grid; grid-template-columns: 1fr 1.4fr; gap: 12px; margin: 16px 0; }
  .food-pick-qty label { display: flex; flex-direction: column; gap: 5px; font-family: 'Inter', sans-serif; font-size: 13.2px; font-weight: 600; letter-spacing: 0.01em; color: var(--text-dim); }
  .food-pick-qty input, .food-pick-qty select, .food-pick-edit input { background: var(--panel-2); border: 1px solid var(--border); border-radius: 9px; color: var(--text); padding: 9px 11px; font-family: 'Inter', sans-serif; font-size: 15px; outline: none; min-width: 0; }
  .food-pick-preview { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; background: var(--panel-2); border-radius: 12px; padding: 12px 14px; font-family: 'Inter', sans-serif; font-size: 12.4px; color: var(--text-dim); }
  .fpp-cal { font-family: 'Inter', sans-serif; letter-spacing: -0.02em; font-size: 20px; font-weight: 700; color: var(--text); }
  .fpp-warn { flex-basis: 100%; color: #a03d33; font-size: 11.4px; line-height: 1.5; }

  .mine-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 4px 0 12px; }
  .mine-count { font-family: 'Inter', sans-serif; font-size: 12.6px; color: var(--text-faint); }
  .mine-filter { margin-bottom: 6px; }
  .mine-row { display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--border); }
  .mine-row:last-of-type { border-bottom: none; }
  .mine-pick { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 3px; background: transparent; border: none; padding: 11px 4px; text-align: left; cursor: pointer; color: var(--text); }
  .mine-pick:hover { background: var(--panel-2); }
  .mine-pick .food-result-name, .mine-pick .food-result-macros { max-width: 100%; }
  .mine-actions { display: flex; gap: 6px; flex-shrink: 0; }

  .food-meal-row { display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--border); }
  .food-meal-pick { flex: 1; display: flex; flex-direction: column; align-items: flex-start; gap: 3px; background: transparent; border: none; padding: 12px 4px; text-align: left; cursor: pointer; color: var(--text); }
  .food-meal-pick:hover { background: var(--panel-2); }
  .food-meal-name { font-size: 14.5px; font-weight: 600; }
  .food-meal-sub { font-family: 'Inter', sans-serif; font-size: 12.6px; color: var(--text-faint); }
  .food-custom-grid { margin-top: 4px; }
  .lookup-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
  .lookup-bar-hint { flex: 1; min-width: 160px; font-family: 'Inter', sans-serif; font-size: 12.6px; color: var(--text-faint); line-height: 1.5; }
  .lookup-result { background: #f4faf1; border: 1px solid #cfe6c4; border-radius: 12px; padding: 10px 13px; margin-bottom: 12px; }
  .lookup-result.lookup-miss { background: #fdf1dd; border-color: #ecd3a4; }
  .lookup-line { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; font-size: 12.8px; color: #3a6b2c; line-height: 1.5; }
  .lookup-miss .lookup-line { color: #8a5b13; }
  .lookup-line svg { flex-shrink: 0; }
  .lookup-confidence { font-family: 'Inter', sans-serif; font-size: 9.6px; letter-spacing: 0.05em; text-transform: uppercase; padding: 2px 7px; border-radius: 999px; }
  .lc-high { background: rgba(54,135,39,0.15); color: #3a6b2c; }
  .lc-medium { background: rgba(219,162,54,0.2); color: #8a5b13; }
  .lc-low { background: rgba(199,58,47,0.14); color: #a03d33; }
  .lookup-note { font-family: 'Inter', sans-serif; font-size: 11.2px; color: var(--text-dim); margin-top: 6px; line-height: 1.5; }
  .lookup-rename { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .lookup-rename span { flex: 1; min-width: 180px; }
  .lookup-sources { display: flex; flex-wrap: wrap; gap: 6px 12px; margin-top: 8px; }
  .lookup-sources a { font-family: 'Inter', sans-serif; font-size: 10.8px; color: var(--cut); text-decoration: none; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lookup-sources a:hover { text-decoration: underline; }

  @media (max-width: 860px) {
    .macro-grid, .week-avg-grid { grid-template-columns: repeat(2, 1fr); }
    .food-custom-grid { grid-template-columns: repeat(2, 1fr); }
  }

  @media (max-width: 640px) {
    .fat-hint { display: none; }
    .food-ai-actions .btn-primary { width: 100%; justify-content: center; margin-left: 0; }
    .food-sheet-backdrop { padding: 0; }
    /* dvh, not vh: an open keyboard doesn't shrink vh, which pushed the Add
       button underneath it. Plain vh stays as the fallback for iOS < 16.4. */
    .food-sheet { max-width: none; max-height: 100vh; height: 100vh; border-radius: 0; padding-top: env(safe-area-inset-top); }
    .food-sheet { max-height: 100dvh; height: 100dvh; }
    /* The entry sheet is three controls tall — it rises from the bottom rather
       than taking the whole screen, so the day behind it stays visible. */
    .food-ai-sheet { height: auto; max-height: 90dvh; border-radius: 20px 20px 0 0; padding-top: 0; padding-bottom: env(safe-area-inset-bottom); }
    .food-row-edit .qty-input { width: 72px; }
    .food-row-actions { gap: 8px; }
    .food-row-edit { gap: 8px; flex-wrap: wrap; }
    /* Two columns of 16px fields don't fit a phone — one column each. */
    .food-custom-grid { grid-template-columns: 1fr !important; }
    .food-day-nav { flex-wrap: wrap; }
    .food-pace-toggle { margin-left: 0; }
    .food-jump-today { margin-left: 0; }
    .food-week-nav { flex-wrap: wrap; }
    .frr-cal { margin-left: 0; }
    .food-pick-qty { grid-template-columns: 1fr; }
    .food-pick-edit { grid-template-columns: 1fr; }
  }
`;
