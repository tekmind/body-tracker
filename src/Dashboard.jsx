import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import {
  ComposedChart, LineChart, BarChart, Line, Bar, Area, AreaChart, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceArea, Cell
} from "recharts";
import {
  TrendingDown, TrendingUp, Minus, Flame, Footprints, Scale, Percent,
  Plus, Pencil, Trash2, X, Save, Loader2, AlertCircle, Settings, Target, LayoutDashboard, AlertTriangle, Check, Circle, StickyNote, Dumbbell, Activity, Heart, CalendarDays, RefreshCw, Watch
} from "lucide-react";
import { supabase } from "./supabaseClient.js";

const STORAGE_KEY = "entries";
const GOALS_KEY = "phase_goals";
const DAILY_KEY = "daily_log";
const HABITS_KEY = "habits_log";
const HABITS_TARGETS_KEY = "habits_targets";
const TAB_ORDER = ["dashboard", "daily", "habits", "settings"];
const DEFAULT_HABIT_TARGETS = { walking: 5, conditioning: 3, weightLifting: 3, cardio: 3 };

const HABITS = [
  { key: "walking",      label: "Walking",      color: "#5b8dee", Icon: Footprints },
  { key: "conditioning", label: "Conditioning", color: "#dba236", Icon: Activity },
  { key: "weightLifting",label: "Weight Lifting",color: "#4caf7d", Icon: Dumbbell },
  { key: "cardio",       label: "Cardio",       color: "#c4534a", Icon: Heart },
];

// ---------- Seed data (only used the very first time, to migrate off the sheet) ----------
const SEED = [
  { wk: "Pre", date: "1/18/26", phase: "Off", tW: null, aW: 164, tM: null, aM: 118.7, tF: null, aF: 39, tBF: null, aBF: 23.8, aCal: null, tCal: null, steps: null, notes: "" },
  { wk: 0, date: "3/1/26", phase: "Cut", tW: 160.4, aW: 160.4, tM: 119.7, aM: 119.7, tF: 34.3, aF: 34.3, tBF: 21.4, aBF: 21.4, aCal: null, tCal: null, steps: null, notes: "" },
  { wk: 1, date: "3/6/26", phase: "Cut", tW: 159.9, aW: 157.9, tM: 119.7, aM: 118.9, tF: 33.8, aF: 32.7, tBF: 21.1, aBF: 20.7, aCal: 1551, tCal: 2100, steps: 4096, notes: "" },
  { wk: 2, date: "3/13/26", phase: "Cut", tW: 159.4, aW: 158.9, tM: 119.7, aM: 120, tF: 33.3, aF: 32.7, tBF: 20.9, aBF: 20.6, aCal: 1614, tCal: 2100, steps: 5037, notes: "" },
  { wk: 3, date: "3/20/26", phase: "Cut", tW: 158.9, aW: 157.8, tM: 119.7, aM: 119.3, tF: 32.8, aF: 32.1, tBF: 20.6, aBF: 20.3, aCal: 1689, tCal: 2100, steps: 11784, notes: "" },
  { wk: 4, date: "3/27/26", phase: "Cut", tW: 158.4, aW: 158.1, tM: 119.7, aM: 120.8, tF: 32.3, aF: 31, tBF: 20.4, aBF: 19.6, aCal: 1841, tCal: 2100, steps: 5714, notes: "" },
  { wk: 5, date: "4/3/26", phase: "Cut", tW: 157.9, aW: 156.8, tM: 119.7, aM: 120.3, tF: 31.8, aF: 30.2, tBF: 20.1, aBF: 19.3, aCal: 1977, tCal: 2100, steps: 7193, notes: "" },
  { wk: 6, date: "4/10/26", phase: "Cut", tW: 157.4, aW: 157.6, tM: 119.7, aM: 120.1, tF: 31.3, aF: 31.2, tBF: 19.9, aBF: 19.8, aCal: 1765, tCal: 1900, steps: 7106, notes: "" },
  { wk: 7, date: "4/17/26", phase: "Cut", tW: 156.9, aW: 157.7, tM: 119.7, aM: 120.9, tF: 30.8, aF: 30.3, tBF: 19.6, aBF: 19.2, aCal: 1832, tCal: 1600, steps: 9456, notes: "" },
  { wk: 8, date: "4/24/26", phase: "Cut", tW: 156.4, aW: 156.8, tM: 119.7, aM: 120.6, tF: 30.3, aF: 29.8, tBF: 19.4, aBF: 19.0, aCal: 1754, tCal: 1600, steps: 10122, notes: "" },
  { wk: 9, date: "5/1/26", phase: "Cut", tW: 155.9, aW: 154.7, tM: 119.7, aM: 119.2, tF: 29.8, aF: 29.1, tBF: 19.1, aBF: 18.8, aCal: 1739, tCal: 1600, steps: 10202, notes: "tracked Thu 4/30, vacation" },
  { wk: 10, date: "5/8/26", phase: "Cut", tW: 155.4, aW: 154.6, tM: 119.7, aM: 119.6, tF: 29.3, aF: 28.6, tBF: 18.9, aBF: 18.5, aCal: 1561, tCal: 1600, steps: 10712, notes: "" },
  { wk: 11, date: "5/15/26", phase: "Cut", tW: 154.7, aW: 153.6, tM: 119.7, aM: 119.6, tF: 28.6, aF: 27.6, tBF: 18.5, aBF: 18.0, aCal: 1542, tCal: 1500, steps: 11154, notes: "Mon 40hr fast · Tue–Thu 1100cal · 10.5k steps" },
  { wk: 12, date: "5/22/26", phase: "Cut", tW: 153.9, aW: 152.6, tM: 119.7, aM: 119.2, tF: 27.8, aF: 27.1, tBF: 18.1, aBF: 17.8, aCal: 1456, tCal: 1500, steps: 12157, notes: "Mon 24hr fast · Tue–Thu 1450cal · 11.15k steps" },
  { wk: 13, date: "5/29/26", phase: "Cut", tW: 153.9, aW: 153, tM: 119.7, aM: 119.5, tF: 27.8, aF: 27.2, tBF: 17.8, aBF: 17.8, aCal: 2048, tCal: null, steps: 10393, notes: "" },
  { wk: 14, date: "6/5/26", phase: "Cut", tW: 153.9, aW: 151.8, tM: 119.7, aM: 118.4, tF: 27.8, aF: 27.2, tBF: 17.8, aBF: 17.9, aCal: 2200, tCal: null, steps: 7401, notes: "" },
  { wk: 15, date: "6/12/26", phase: "Cut", tW: 153.9, aW: 152.8, tM: 119.7, aM: 118.7, tF: 27.8, aF: 27.8, tBF: 17.8, aBF: 18.2, aCal: 2328, tCal: null, steps: 6086, notes: "" },
  { wk: 16, date: "6/19/26", phase: "Cut", tW: 153.9, aW: 153.3, tM: 119.7, aM: 119.5, tF: 27.8, aF: 27.5, tBF: 17.8, aBF: 17.9, aCal: 2200, tCal: null, steps: 5588, notes: "" },
  { wk: 17, date: "6/26/26", phase: "Cut", tW: 153.9, aW: 152.9, tM: 119.7, aM: 117.9, tF: 27.8, aF: 28.7, tBF: 17.8, aBF: 18.8, aCal: 2395, tCal: null, steps: 5402, notes: "" },
  { wk: 18, date: "7/3/26", phase: "Cut", tW: 153.9, aW: 153.9, tM: 119.7, aM: 118.4, tF: 27.8, aF: 29.3, tBF: 17.8, aBF: 19.0, aCal: 2522, tCal: null, steps: 7579, notes: "" },
  { wk: 19, date: "7/4/26", phase: "Maintain", tW: 153.9, aW: null, tM: 120.2, aM: null, tF: 27.8, aF: null, tBF: 17.8, aBF: null, aCal: null, tCal: 2000, steps: null, notes: "" },
  { wk: 20, date: "7/5/26", phase: "Maintain", tW: 153.9, aW: null, tM: 120.7, aM: null, tF: 27.8, aF: null, tBF: 17.8, aBF: null, aCal: null, tCal: 2000, steps: null, notes: "" },
  { wk: 21, date: "7/6/26", phase: "Maintain", tW: 153.9, aW: null, tM: 121.2, aM: null, tF: 27.8, aF: null, tBF: 17.8, aBF: null, aCal: null, tCal: 2000, steps: null, notes: "" },
  { wk: 22, date: "7/31/26", phase: "Maintain", tW: 153.9, aW: null, tM: 121.7, aM: null, tF: 27.8, aF: null, tBF: 17.8, aBF: null, aCal: null, tCal: 2000, steps: null, notes: "" },
  { wk: 23, date: "8/7/26", phase: "Maintain", tW: 153.9, aW: null, tM: 122.2, aM: null, tF: 27.8, aF: null, tBF: 17.8, aBF: null, aCal: null, tCal: 2000, steps: null, notes: "" },
  { wk: 24, date: "8/14/26", phase: "Gain", tW: 154.5, aW: null, tM: 122.7, aM: null, tF: 27.9, aF: null, tBF: 18.1, aBF: null, aCal: null, tCal: null, steps: null, notes: "" },
  { wk: 25, date: "8/21/26", phase: "Gain", tW: 154.9, aW: null, tM: 123.0, aM: null, tF: 28.1, aF: null, tBF: 18.1, aBF: null, aCal: null, tCal: null, steps: null, notes: "" },
  { wk: 26, date: "8/28/26", phase: "Gain", tW: 155.3, aW: null, tM: 123.2, aM: null, tF: 28.2, aF: null, tBF: 18.1, aBF: null, aCal: null, tCal: null, steps: null, notes: "" },
  { wk: 27, date: "9/4/26", phase: "Gain", tW: 155.7, aW: null, tM: 123.5, aM: null, tF: 28.3, aF: null, tBF: 18.2, aBF: null, aCal: null, tCal: null, steps: null, notes: "" },
  { wk: 28, date: "9/11/26", phase: "Gain", tW: 156.0, aW: null, tM: 123.7, aM: null, tF: 28.4, aF: null, tBF: 18.2, aBF: null, aCal: null, tCal: null, steps: null, notes: "" },
];

const PHASE_COLOR = { Off: "#6b7280", Cut: "#5b8dee", Derailed: "#c4534a", Maintain: "#dba236", Gain: "#4caf7d" };
const PHASE_LABEL = { Off: "OFF", Cut: "CUT", Derailed: "DERAILED", Maintain: "MAINTAIN", Gain: "GAIN" };
const PHASES = ["Off", "Cut", "Maintain", "Gain"];

const PHASE_RENAMES = { Crashed: "Derailed", Derailed: "Cut" };
function migratePhase(p) { return PHASE_RENAMES[p] || p; }

function phaseColor(phase) { return PHASE_COLOR[phase] || "#6b7280"; }
function phaseLabel(phase) { return PHASE_LABEL[phase] || String(phase || "?").toUpperCase(); }
const ROW_PHASE_CLASS = { Off: "row-off", Cut: "row-cut", Derailed: "row-derailed", Maintain: "row-maintain", Gain: "row-gain" };
function rowPhaseClass(phase) { return ROW_PHASE_CLASS[phase] || ""; }
const GOAL_PHASES = ["Cut", "Gain", "Maintain"];

const SEED_GOALS = [
  { date: "3/1/26", phase: "Cut", muscleRate: 0, fatRate: -0.5, stepGoal: 10000, calGoal: 1600, durationWeeks: 20, notes: "Initial cut targets" },
  { date: "8/1/26", phase: "Gain", muscleRate: 0.25, fatRate: 2.5, stepGoal: 8000, calGoal: 2600, durationWeeks: 8, notes: "Gain phase starts" },
];

function parseDate(str) {
  if (!str) return null;
  const parts = String(str).split("/").map(s => s.trim());
  if (parts.length !== 3) return null;
  const [m, d, yRaw] = parts.map(Number);
  if (!m || !d || Number.isNaN(yRaw)) return null;
  const y = yRaw < 100 ? 2000 + yRaw : yRaw;
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function formatMDY(date) {
  return `${date.getMonth() + 1}/${date.getDate()}/${String(date.getFullYear()).slice(2)}`;
}

// Conversions for <input type="date">, which speaks ISO (YYYY-MM-DD) — the
// rest of the app stores dates as "M/D/YY" strings, so form state stays
// unchanged and only the date-picker input itself converts at the edges.
function mdyToISO(str) {
  const d = parseDate(str);
  if (!d) return "";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}
function isoToMDY(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return "";
  return formatMDY(new Date(y, m - 1, d));
}

const DAY_MS = 24 * 3600 * 1000;

function blockStartFor(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dow = d.getDay();
  const diff = (dow - 5 + 7) % 7;
  return new Date(d.getTime() - diff * DAY_MS);
}
function blockEndFor(blockStart) {
  return new Date(blockStart.getTime() + 6 * DAY_MS);
}
function daysBetween(a, b) {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

function generateSchedule(entries, goals) {
  const realWithDate = entries
    .map(e => ({ ...e, _d: parseDate(e.date) }))
    .filter(e => e._d);
  const hasActual = e => e.aW != null || e.aM != null || e.aF != null;

  const takenBlocks = new Set();
  realWithDate.forEach(e => {
    takenBlocks.add(blockStartFor(e._d).getTime());
  });

  const sortedGoals = goals
    .map(g => ({ ...g, _d: parseDate(g.date) }))
    .filter(g => g._d)
    .sort((a, b) => a._d.getTime() - b._d.getTime());

  const generated = [];
  sortedGoals.forEach((g, gi) => {
    const dur = Number.isFinite(g.durationWeeks) && g.durationWeeks > 0 ? Math.floor(g.durationWeeks) : 0;
    if (!dur) return;
    const firstFri = blockStartFor(g._d);
    const nextStart = sortedGoals[gi + 1]?._d ?? null;
    for (let w = 0; w < dur; w++) {
      const d = new Date(firstFri.getTime() + w * 7 * DAY_MS);
      if (nextStart && d >= blockStartFor(nextStart)) break;
      const key = d.getTime();
      if (takenBlocks.has(key)) continue;
      takenBlocks.add(key);
      generated.push({
        wk: 0, date: formatMDY(d), phase: g.phase,
        aW: null, aM: null, aF: null, aBF: null,
        aCal: null, steps: null, notes: "", _generated: true,
      });
    }
  });

  const merged = [...entries, ...generated]
    .map(e => ({ ...e, _d: parseDate(e.date) }))
    .sort((a, b) => (a._d?.getTime() ?? 0) - (b._d?.getTime() ?? 0));
  let n = 0;
  return merged.map(e => {
    const { _d, ...rest } = e;
    const wk = typeof e.wk === "string" && !/^\d+$/.test(e.wk) ? e.wk : n++;
    return { ...rest, wk };
  });
}

function tagGoalStatuses(goals) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const withDate = goals.map((g, i) => ({ ...g, _idx: i, _d: parseDate(g.date) }));
  const pastOrToday = withDate.filter(g => g._d && g._d <= today).sort((a, b) => b._d - a._d);
  const globalActiveGoal = pastOrToday[0] || null;

  return goals.map((g, i) => {
    const d = parseDate(g.date);
    if (!d) return { ...g, status: "upcoming" };
    if (d > today) return { ...g, status: "upcoming" };
    if (globalActiveGoal && g.phase === globalActiveGoal.phase && g.date === globalActiveGoal.date)
      return { ...g, status: "active" };
    return { ...g, status: "past" };
  });
}

const WEEK_MS = 7 * 24 * 3600 * 1000;
function round1(n) { return Math.round(n * 10) / 10; }
function fmtNum(n, decimals) {
  if (n === null || n === undefined || Number.isNaN(n)) return "–";
  if (decimals == null) return n.toLocaleString();
  return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function activeGoalFor(goals, phase, date) {
  if (!date) return null;
  const candidates = goals
    .filter(g => g.phase === phase)
    .map(g => ({ ...g, _d: parseDate(g.date) }))
    .filter(g => g._d && g._d <= date)
    .sort((a, b) => b._d.getTime() - a._d.getTime());
  return candidates[0] || null;
}

function phaseOnDate(goals, date) {
  if (!date) return null;
  const g = goals
    .map(g => ({ phase: g.phase, _d: parseDate(g.date) }))
    .filter(g => g._d && g._d <= date)
    .sort((a, b) => b._d.getTime() - a._d.getTime())[0];
  return g ? g.phase : null;
}

function computeTargets(entries, goals) {
  const logged = entries
    .filter(e => e.aM != null && e.aF != null && e.aW != null)
    .map(e => ({ m: e.aM, f: e.aF, w: e.aW, d: parseDate(e.date) }))
    .filter(e => e.d)
    .sort((a, b) => a.d.getTime() - b.d.getTime());

  const projectAt = (anchor, mRate, fRate, date) => {
    const weeks = (date.getTime() - anchor.date.getTime()) / WEEK_MS;
    return { m: round1(anchor.m + mRate * weeks), f: round1(anchor.f + fRate * weeks), other: anchor.other };
  };

  const timeline = goals
    .map(g => ({ ...g, _d: parseDate(g.date) }))
    .filter(g => g._d)
    .sort((a, b) => a._d.getTime() - b._d.getTime());
  let prev = null;
  timeline.forEach(g => {
    let anchor = null;
    if (prev && prev.phase === g.phase && prev._anchor) {
      const p = projectAt(prev._anchor, prev.muscleRate || 0, prev.fatRate || 0, g._d);
      anchor = { m: p.m, f: p.f, other: prev._anchor.other, date: g._d };
    } else if (logged.length) {
      let best = null;
      for (const l of logged) if (l.d <= g._d) best = l;
      if (!best) best = logged[0];
      anchor = { m: best.m, f: best.f, other: round1(best.w - best.m - best.f), date: g._d };
    }
    g._anchor = anchor;
    prev = g;
  });

  return entries.map(entry => {
    const d = parseDate(entry.date);
    if (!d) return null;
    let g = null;
    for (const t of timeline) { if (t._d <= d) g = t; else break; }
    if (!g || !g._anchor) return null;
    const weeks = (d.getTime() - g._anchor.date.getTime()) / WEEK_MS;
    const m = round1(g._anchor.m + (g.muscleRate || 0) * weeks);
    const f = round1(g._anchor.f + (g.fatRate || 0) * weeks);
    const w = round1(g._anchor.other + m + f);
    const bf = w > 0 ? round1((f / w) * 100) : null;
    return { m, f, w, bf, other: g._anchor.other };
  });
}

function computeStepTargets(entries, goals) {
  let last = null;
  return entries.map(entry => {
    const d = parseDate(entry.date);
    const g = d ? activeGoalFor(goals, entry.phase, d) : null;
    if (g && g.stepGoal != null) last = g.stepGoal;
    return last;
  });
}

function computeCalorieTargets(entries, goals) {
  let last = null;
  return entries.map(entry => {
    const d = parseDate(entry.date);
    const g = d ? activeGoalFor(goals, entry.phase, d) : null;
    if (g && g.calGoal != null) last = g.calGoal;
    return last;
  });
}

function rollingMissStreak(rows, actualKey, targetKey, isMiss) {
  let streak = 0;
  return rows.map(r => {
    if (r[actualKey] != null && r[targetKey] != null && isMiss(r[actualKey], r[targetKey])) streak++;
    else streak = 0;
    return streak;
  });
}

const emptyForm = { wk: "", date: "", phase: "Cut", aW: "", aM: "", aF: "", aBF: "", aCal: "", steps: "", notes: "" };

function num(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = parseFloat(v);
  return Number.isNaN(n) ? null : n;
}

function delta(curr, prev) { return curr - prev; }

function cellClass(kind, actual, target) {
  if (actual == null || target == null) return "";
  if (kind === "muscle" || kind === "steps") return actual >= target ? "cell-good" : "cell-bad";
  return actual <= target ? "cell-good" : "cell-bad";
}

function calBarColor(actual, target) {
  if (actual == null || target == null) return "#5b8dee";
  return actual <= target ? "var(--bar-good)" : "var(--bar-bad)";
}
function stepsBarColor(actual, target) {
  if (actual == null || target == null) return "#5b8dee";
  return actual >= target ? "var(--bar-good)" : "var(--bar-bad)";
}

function missStreak(actualRows, actualKey, targetKey, isMiss) {
  let streak = 0;
  for (let i = actualRows.length - 1; i >= 0; i--) {
    const r = actualRows[i];
    if (r[actualKey] != null && r[targetKey] != null && isMiss(r[actualKey], r[targetKey])) streak++;
    else break;
  }
  return streak;
}

function mkBadge(weeks, level) { return weeks > 0 ? { weeks, level } : null; }

function StatCard({ icon: Icon, label, value, unit, sub, trend, accent, badge }) {
  return (
    <div className="stat-card">
      {badge && (
        <span className={"stat-alert-badge " + badge.level} title={(badge.level === "good" ? "On track " : "Missed target ") + badge.weeks + " weeks in a row"}>
          {badge.level === "good" ? <Check size={10} /> : <AlertTriangle size={10} />} {badge.weeks}w
        </span>
      )}
      <div className="stat-top">
        <span className="stat-icon" style={{ background: accent + "22", color: accent }}><Icon size={15} strokeWidth={2.25} /></span>
        <span className="stat-label">{label}</span>
      </div>
      <div className="stat-value">{value}<span className="stat-unit">{unit}</span></div>
      {sub && (
        <div className={"stat-sub " + (trend || "")}>
          {trend === "down" && <TrendingDown size={12} />}
          {trend === "up" && <TrendingUp size={12} />}
          {trend === "flat" && <Minus size={12} />}
          {sub}
        </div>
      )}
    </div>
  );
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="tt">
      <div className="tt-head">
        <span className="tt-week">WK {row.wk}</span>
        <span className="tt-date">{row.date}</span>
        <span className="tt-phase" style={{ color: phaseColor(row.phase) }}>{phaseLabel(row.phase)}</span>
      </div>
      {payload.map((p, i) => p.value != null && (
        <div key={i} className="tt-row">
          <span className="tt-dot" style={{ background: p.color }} />
          <span className="tt-name">{p.name}</span>
          <span className="tt-val">{typeof p.value === "number" ? fmtNum(p.value, 1) : p.value}</span>
        </div>
      ))}
    </div>
  );
}

function RecoveryFooter({ r }) {
  const dirText = r.dir === "improving"
    ? `Closing the gap — fat is ${Math.abs(r.gap)} lb over target, down from ${Math.abs(r.prevGap)} last week. Keep going.`
    : r.dir === "worsening"
    ? `Drifting further — fat is ${r.gap} lb over target, up from ${r.prevGap ?? "?"} last week.`
    : `Holding — fat is ${r.gap} lb over target, flat vs last week.`;
  const dirClass = r.dir === "improving" ? "rec-good" : r.dir === "worsening" ? "rec-bad" : "rec-flat";
  return (
    <div className="recovery">
      <div className={"rec-trend " + dirClass}>
        {r.dir === "improving" && <TrendingDown size={13} />}
        {r.dir === "worsening" && <TrendingUp size={13} />}
        {r.dir === "flat" && <Minus size={13} />}
        <span>{dirText}</span>
      </div>
      {(r.calGoal != null || r.stepGoal != null) && (
        <div className="rec-plan">
          <span className="rec-plan-label">Get back to your Cut:</span>
          {r.calGoal != null && <span className="rec-chip">{r.calGoal.toLocaleString()} kcal/day</span>}
          {r.stepGoal != null && <span className="rec-chip">{r.stepGoal.toLocaleString()} steps/day</span>}
        </div>
      )}
    </div>
  );
}

function SeriesToggle({ items, active, onToggle }) {
  return (
    <div className="toggle-group series-toggle">
      {items.map((it) => (
        <button
          key={it.key}
          className={"toggle-btn " + (active[it.key] ? "active" : "")}
          onClick={() => onToggle(it.key)}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

function ChartLegend({ items }) {
  return (
    <div className="chart-legend">
      {items.map((it, i) => (
        <span key={i} className="cl-item">
          {it.swatch === "line" && <span className="cl-line" style={{ borderTopColor: it.color }} />}
          {it.swatch === "dash" && <span className="cl-line dashed" style={{ borderTopColor: it.color }} />}
          {it.swatch === "box" && <span className="cl-box" style={{ background: it.color }} />}
          {it.swatch === "shade" && <span className="cl-shade" />}
          {it.label}
        </span>
      ))}
    </div>
  );
}

function PhaseTimeline({ all, trackedCount, derailedDates }) {
  const segs = [];
  let cur = null;
  all.forEach((r, i) => {
    if (!cur || cur.phase !== r.phase) { cur = { phase: r.phase, from: i, to: i, count: 1 }; segs.push(cur); }
    else { cur.to = i; cur.count++; }
  });
  const total = all.length || 1;
  const hasDerail = derailedDates && derailedDates.size > 0;
  return (
    <div className="timeline-wrap">
      <div className="timeline-bar">
        {segs.map((s, i) => (
          <div key={i} className="timeline-seg"
            style={{ width: `${(s.count / total) * 100}%`, background: phaseColor(s.phase), opacity: s.to < trackedCount ? 1 : 0.38 }}
            title={`${phaseLabel(s.phase)} · ${all[s.from]?.date} → ${all[s.to]?.date}`} />
        ))}
        {hasDerail && all.map((r, i) => derailedDates.has(r.date) ? (
          <div key={"d" + i} className="timeline-derail"
            style={{ left: `${(i / total) * 100}%`, width: `${(1 / total) * 100}%` }}
            title={`Derailed · ${r.date}`} />
        ) : null)}
        {trackedCount > 0 && <div className="timeline-now" style={{ left: `${((trackedCount - 1) / total) * 100}%` }} />}
      </div>
      <div className="timeline-legend">
        {PHASES.map(p => (
          <span key={p} className="tl-item"><span className="tl-dot" style={{ background: PHASE_COLOR[p] }} />{PHASE_LABEL[p]}</span>
        ))}
        {hasDerail && <span className="tl-item"><span className="tl-dot" style={{ background: PHASE_COLOR.Derailed }} />DERAILED</span>}
      </div>
    </div>
  );
}

function EntryForm({ form, setForm, onSave, onCancel, isEdit, error }) {
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <div className="entry-form">
      <div className="form-note">Targets and phase are set automatically from your Goal Settings (the latest goal on or before each week's date decides its phase). Calories and steps here are entered manually for the week — separate from the Daily tab, which tracks its own day-by-day pacing.</div>
      <div className="form-grid">
        <label>Week<input value={form.wk} onChange={set("wk")} placeholder="e.g. 19" /></label>
        <label>Date<input value={form.date} onChange={set("date")} placeholder="7/10/26" /></label>
        <label>Weight (actual)<input value={form.aW} onChange={set("aW")} placeholder="lb" /></label>
        <label>Muscle (actual)<input value={form.aM} onChange={set("aM")} placeholder="lb" /></label>
        <label>Fat mass (actual)<input value={form.aF} onChange={set("aF")} placeholder="lb" /></label>
        <label>Calories (actual)<input value={form.aCal} onChange={set("aCal")} placeholder="kcal" /></label>
        <label>Steps<input value={form.steps} onChange={set("steps")} placeholder="steps" /></label>
        <label className="notes-field">Notes<input value={form.notes} onChange={set("notes")} placeholder="optional" /></label>
      </div>
      {error && <div className="form-error"><AlertCircle size={12} /> {error}</div>}
      <div className="form-actions">
        <button className="btn-ghost" onClick={onCancel}><X size={13} /> Cancel</button>
        <button className="btn-primary" onClick={onSave}><Save size={13} /> {isEdit ? "Save changes" : "Add week"}</button>
      </div>
    </div>
  );
}

function GoalForm({ form, setForm, onSave, onCancel, isEdit, error }) {
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <div className="entry-form">
      <div className="form-grid goal-grid">
        <label>Effective date<input type="date" value={mdyToISO(form.date)} onChange={(e) => setForm({ ...form, date: isoToMDY(e.target.value) })} /></label>
        <label>Phase
          <select value={form.phase} onChange={set("phase")}>
            {GOAL_PHASES.map(p => <option key={p} value={p}>{PHASE_LABEL[p]}</option>)}
          </select>
        </label>
        <label>Muscle rate (lb/wk)<input value={form.muscleRate} onChange={set("muscleRate")} placeholder="blank = same as last goal" /></label>
        <label>Fat rate (lb/wk)<input value={form.fatRate} onChange={set("fatRate")} placeholder="blank = same as last goal" /></label>
        <label>Step goal (avg/day)<input value={form.stepGoal} onChange={set("stepGoal")} placeholder="blank = same as last goal" /></label>
        <label>Calorie goal (kcal/day)<input value={form.calGoal} onChange={set("calGoal")} placeholder="blank = same as last goal" /></label>
        <label>Duration (weeks)<input value={form.durationWeeks} onChange={set("durationWeeks")} placeholder="e.g. 12 — generates the weeks" /></label>
        <label className="notes-field">Notes<input value={form.notes} onChange={set("notes")} placeholder="optional — why the change" /></label>
      </div>
      {error && <div className="form-error"><AlertCircle size={12} /> {error}</div>}
      <div className="form-actions">
        <button className="btn-ghost" onClick={onCancel}><X size={13} /> Cancel</button>
        <button className="btn-primary" onClick={onSave}><Save size={13} /> {isEdit ? "Save changes" : "Add goal"}</button>
      </div>
    </div>
  );
}

function DailyEntryForm({ form, setForm, onSave, onCancel, isEdit, error }) {
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <div className="entry-form">
      <div className="form-grid daily-grid">
        <label>Date<input value={form.date} onChange={set("date")} placeholder="7/10/26" /></label>
        <label>Calories<input value={form.cal} onChange={set("cal")} placeholder="kcal" /></label>
        <label>Steps<input value={form.steps} onChange={set("steps")} placeholder="steps" /></label>
        <label>Weight<input value={form.weight} onChange={set("weight")} placeholder="lb" /></label>
        <label>Fat Mass<input value={form.fatMass} onChange={set("fatMass")} placeholder="lb" /></label>
        <label>Muscle Mass<input value={form.muscleMass} onChange={set("muscleMass")} placeholder="lb" /></label>
      </div>
      {error && <div className="form-error"><AlertCircle size={12} /> {error}</div>}
      <div className="form-actions">
        <button className="btn-ghost" onClick={onCancel}><X size={13} /> Cancel</button>
        <button className="btn-primary" onClick={onSave}><Save size={13} /> {isEdit ? "Save changes" : "Add day"}</button>
      </div>
    </div>
  );
}

export default function Dashboard() {


  const [entries, setEntries] = useState([]);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [errMsg, setErrMsg] = useState("");
  const [range, setRange] = useState("tracked");
  const [wbfVisible, setWbfVisible] = useState({ targets: true, weight: true, bodyFat: true });
  const [mvfVisible, setMvfVisible] = useState({ targets: true, muscle: true, fat: true });
  const [formOpen, setFormOpen] = useState(false);
  const [editIndex, setEditIndex] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  // Persisted in localStorage (not Supabase) so the last-open tab survives a
  // refresh without a network round-trip or a flash of the wrong tab.
  const [tab, setTab] = useState(() => localStorage.getItem("bt_tab") || "dashboard"); // dashboard | daily | habits | settings
  useEffect(() => { localStorage.setItem("bt_tab", tab); }, [tab]);

  const [goals, setGoals] = useState([]);
  const [goalFormOpen, setGoalFormOpen] = useState(false);
  const [goalEditIndex, setGoalEditIndex] = useState(null);
  const [goalForm, setGoalForm] = useState({ date: "", phase: "Cut", muscleRate: "", fatRate: "", stepGoal: "", calGoal: "", durationWeeks: "", notes: "" });
  const [goalSaving, setGoalSaving] = useState(false);
  const [goalErrMsg, setGoalErrMsg] = useState("");

  const [dailyEntries, setDailyEntries] = useState([]);
  // Day rows written by the HealthKit->Supabase Shortcut. Kept separate from
  // dailyEntries (manual) and merged at read time — see mergedDailyEntries —
  // so a manual edit never gets silently clobbered by the next sync, and a
  // sync never has to read-modify-write the daily_log blob.
  const [healthkitDaily, setHealthkitDaily] = useState([]);
  const [dailyFormOpen, setDailyFormOpen] = useState(false);
  const [dailyEditIndex, setDailyEditIndex] = useState(null);
  const [dailyForm, setDailyForm] = useState({ date: "", cal: "", steps: "", weight: "", fatMass: "", muscleMass: "" });
  const [dailySaving, setDailySaving] = useState(false);
  const [dailyErrMsg, setDailyErrMsg] = useState("");

  const [withingsSyncing, setWithingsSyncing] = useState(false);
  const [withingsMsg, setWithingsMsg] = useState("");
  const [withingsBanner, setWithingsBanner] = useState("");

  const [habitLog, setHabitLog] = useState([]);
  const [habitTargets, setHabitTargets] = useState(DEFAULT_HABIT_TARGETS);
  const persistHabits = useCallback(async (next) => {
    try { await window.storage.set(HABITS_KEY, JSON.stringify(next)); setHabitLog(next); } catch (e) {}
  }, []);
  const persistHabitTargets = useCallback(async (next) => {
    try { await window.storage.set(HABITS_TARGETS_KEY, JSON.stringify(next)); setHabitTargets(next); } catch (e) {}
  }, []);

  const fetchHealthkitDaily = useCallback(async () => {
    try {
      const { data, error } = await supabase.from("daily_metrics").select("date,cal,steps,weight,fat_mass,muscle_mass");
      if (error) throw error;
      setHealthkitDaily((data || []).map(d => ({
        date: d.date, cal: d.cal, steps: d.steps,
        weight: d.weight, fatMass: d.fat_mass, muscleMass: d.muscle_mass,
      })));
    } catch (e) {
      // Table may not exist yet if the Shortcut sync hasn't been set up — fine, just no synced days.
    }
  }, []);

  const [formErr, setFormErr] = useState("");
  const [goalFormErr, setGoalFormErr] = useState("");
  const [dailyFormErr, setDailyFormErr] = useState("");

  // Two-click delete: first click "arms" the button, second click deletes.
  // (window.confirm can be silently blocked inside the artifact frame, which
  // would make deletes impossible — this pattern is safe everywhere.)
  const [confirmDel, setConfirmDel] = useState(null);

  const [backupMode, setBackupMode] = useState(null); // null | 'export' | 'import'
  const [backupText, setBackupText] = useState("");
  const [backupMsg, setBackupMsg] = useState("");

  // Note popup: { title, text } of the note being viewed, or null.
  const [noteOpen, setNoteOpen] = useState(null);

  // Pull-to-refresh: standalone (home-screen) mode has no browser chrome, so
  // iOS won't give this for free — dragging down from the very top of the
  // page reveals a spinner and reloads once past the threshold.
  const [pullY, setPullY] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const pullStartY = useRef(null);
  const PULL_THRESHOLD = 64;
  const PULL_MAX = 90;
  function handlePullStart(e) {
    if (refreshing) return;
    if (window.scrollY <= 0) pullStartY.current = e.touches[0].clientY;
  }
  function handlePullMove(e) {
    if (pullStartY.current == null || refreshing) return;
    const delta = e.touches[0].clientY - pullStartY.current;
    if (delta > 0 && window.scrollY <= 0) {
      setPullY(Math.min(PULL_MAX, delta * 0.5));
      e.preventDefault();
    } else {
      pullStartY.current = null;
      setPullY(0);
    }
  }
  function handlePullEnd() {
    if (pullStartY.current == null) return;
    pullStartY.current = null;
    if (pullY >= PULL_THRESHOLD) {
      setRefreshing(true);
      setPullY(56);
      setTimeout(() => window.location.reload(), 350);
    } else {
      setPullY(0);
    }
  }

  // Swipe left/right anywhere to move between tabs (mobile). Ignored when the
  // touch starts inside a horizontally-scrollable table (.table-wrap), so
  // scrolling a wide table sideways still works instead of changing tabs.
  const swipeStart = useRef(null);
  const SWIPE_THRESHOLD = 60;
  function handleSwipeStart(e) {
    const scrollable = e.target.closest && e.target.closest(".table-wrap");
    if (scrollable && scrollable.scrollWidth > scrollable.clientWidth) {
      swipeStart.current = null;
      return;
    }
    const t = e.touches[0];
    swipeStart.current = { x: t.clientX, y: t.clientY };
  }
  function handleSwipeMove(e) {
    if (!swipeStart.current) return;
    const t = e.touches[0];
    const dx = t.clientX - swipeStart.current.x;
    const dy = t.clientY - swipeStart.current.y;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) e.preventDefault();
  }
  function handleSwipeEnd(e) {
    if (!swipeStart.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - swipeStart.current.x;
    const dy = t.clientY - swipeStart.current.y;
    swipeStart.current = null;
    if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) < Math.abs(dy)) return;
    const idx = TAB_ORDER.indexOf(tab);
    if (dx < 0 && idx < TAB_ORDER.length - 1) setTab(TAB_ORDER[idx + 1]);
    else if (dx > 0 && idx > 0) setTab(TAB_ORDER[idx - 1]);
  }
  function handleTouchStart(e) { handlePullStart(e); handleSwipeStart(e); }
  function handleTouchMove(e) { handlePullMove(e); handleSwipeMove(e); }
  function handleTouchEnd(e) { handlePullEnd(); handleSwipeEnd(e); }

  // Which weekly-log phase groups are collapsed, keyed by group id. Persisted
  // to storage so the expand/collapse state survives reloads.
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const toggleGroup = (id) => setCollapsedGroups(g => {
    const next = { ...g, [id]: !g[id] };
    window.storage.set("collapsed_groups", JSON.stringify(next)).catch(() => {});
    return next;
  });
  // Chart colors that can't come from CSS variables (recharts props).
  const chartTheme = { grid: "#e7e6e0", tick: "#70747c", ink: "#16181d", font: "Inter" };

  const persist = useCallback(async (next) => {
    setSaving(true);
    try {
      const res = await window.storage.set(STORAGE_KEY, JSON.stringify(next));
      if (!res) throw new Error("Storage write returned empty result");
      setEntries(next);
      setErrMsg("");
    } catch (e) {
      setErrMsg("Couldn't save that change — your data is only updated locally for now. Try again.");
    } finally {
      setSaving(false);
    }
  }, []);

  const persistGoals = useCallback(async (next) => {
    setGoalSaving(true);
    try {
      const res = await window.storage.set(GOALS_KEY, JSON.stringify(next));
      if (!res) throw new Error("Storage write returned empty result");
      setGoals(next);
      setGoalErrMsg("");
    } catch (e) {
      setGoalErrMsg("Couldn't save that goal change — try again.");
    } finally {
      setGoalSaving(false);
    }
  }, []);

  const persistDaily = useCallback(async (next) => {
    setDailySaving(true);
    try {
      const res = await window.storage.set(DAILY_KEY, JSON.stringify(next));
      if (!res) throw new Error("Storage write returned empty result");
      setDailyEntries(next);
      setDailyErrMsg("");
    } catch (e) {
      setDailyErrMsg("Couldn't save that day — try again.");
    } finally {
      setDailySaving(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get(STORAGE_KEY);
        const parsed = JSON.parse(res.value);
        const raw = Array.isArray(parsed) ? parsed : SEED;
        const migrated = raw.map(e => ({ ...e, phase: migratePhase(e.phase) }));
        setEntries(migrated);
        setStatus("ready");
        if (JSON.stringify(migrated) !== JSON.stringify(raw)) {
          window.storage.set(STORAGE_KEY, JSON.stringify(migrated)).catch(() => {});
        }
      } catch (e) {
        // Key doesn't exist yet — first run. Seed it from the sheet's last known state.
        try {
          await window.storage.set(STORAGE_KEY, JSON.stringify(SEED));
          setEntries(SEED);
          setStatus("ready");
        } catch (e2) {
          setEntries(SEED);
          setStatus("error");
          setErrMsg("Couldn’t reach storage — showing defaults. (Normal in the unpublished preview: data only loads in the published app.)");
        }
      }
      try {
        const res = await window.storage.get(GOALS_KEY);
        const parsed = JSON.parse(res.value);
        const rawGoals = Array.isArray(parsed) ? parsed : SEED_GOALS;
        const migratedGoals = rawGoals.map(g => ({ ...g, phase: migratePhase(g.phase) }));
        setGoals(migratedGoals);
        if (JSON.stringify(migratedGoals) !== JSON.stringify(rawGoals)) {
          window.storage.set(GOALS_KEY, JSON.stringify(migratedGoals)).catch(() => {});
        }
      } catch (e) {
        try {
          await window.storage.set(GOALS_KEY, JSON.stringify(SEED_GOALS));
          setGoals(SEED_GOALS);
        } catch (e2) {
          setGoals(SEED_GOALS);
          setGoalErrMsg("Couldn’t reach storage for goals — showing defaults. (Normal in the unpublished preview: data only loads in the published app.)");
        }
      }
      try {
        const res = await window.storage.get(DAILY_KEY);
        const parsed = JSON.parse(res.value);
        setDailyEntries(Array.isArray(parsed) ? parsed : []);
      } catch (e) {
        try {
          await window.storage.set(DAILY_KEY, JSON.stringify([]));
          setDailyEntries([]);
        } catch (e2) {
          setDailyEntries([]);
          setDailyErrMsg("Couldn’t reach storage for daily log. (Normal in the unpublished preview: data only loads in the published app.)");
        }
      }
      await fetchHealthkitDaily();
      try {
        const res = await window.storage.get("collapsed_groups");
        const parsed = JSON.parse(res.value);
        if (parsed && typeof parsed === "object") setCollapsedGroups(parsed);
      } catch (e) {
        // No saved collapse state yet — everything starts expanded.
      }
      try {
        const res = await window.storage.get(HABITS_KEY);
        const parsed = JSON.parse(res.value);
        if (Array.isArray(parsed)) setHabitLog(parsed);
      } catch (e) { /* first run — empty log */ }
      try {
        const res = await window.storage.get(HABITS_TARGETS_KEY);
        const parsed = JSON.parse(res.value);
        if (parsed && typeof parsed === "object") setHabitTargets({ ...DEFAULT_HABIT_TARGETS, ...parsed });
      } catch (e) { /* use defaults */ }
    })();
  }, []);

  // One-time banner after the Withings OAuth callback redirects back here.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const withings = params.get("withings");
    if (!withings) return;
    setWithingsBanner(
      withings === "connected"
        ? "Withings account linked."
        : "Withings connection failed — check the Vercel env vars and try /api/withings-auth again."
    );
    params.delete("withings");
    const rest = params.toString();
    window.history.replaceState({}, "", window.location.pathname + (rest ? `?${rest}` : ""));
  }, []);

  async function handleSyncWithings() {
    setWithingsSyncing(true);
    setWithingsMsg("");
    try {
      const res = await fetch("/api/withings-sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sync failed.");
      if (data.message) {
        setWithingsMsg(data.message);
      } else {
        await fetchHealthkitDaily();
        setWithingsMsg(`Synced ${data.date} — ${data.weight ?? "–"} lb`);
      }
    } catch (e) {
      setWithingsMsg(e.message || "Sync failed.");
    } finally {
      setWithingsSyncing(false);
    }
  }

  // Build the full schedule: real logged weeks + auto-generated Friday weeks
  // from each goal's duration. Real weeks always win; generation only fills
  // empty future/roadmap weeks.
  const scheduledEntries = useMemo(() => generateSchedule(entries, goals), [entries, goals]);

  // Goal Settings is the source of truth for phase: override each week's stored
  // phase with whatever the goal timeline says was in effect on that week's date
  // (latest-dated goal on or before it wins). Weeks earlier than the first goal
  // keep their originally-entered phase. Everything downstream — targets, alerts,
  // row colors, timeline, pacing — derives from these resolved phases.
  const resolvedEntries = useMemo(() => scheduledEntries.map(e => {
    const p = phaseOnDate(goals, parseDate(e.date));
    return p ? { ...e, phase: p } : e;
  }), [scheduledEntries, goals]);

  const targets = useMemo(() => computeTargets(resolvedEntries, goals), [resolvedEntries, goals]);
  const stepTargets = useMemo(() => computeStepTargets(resolvedEntries, goals), [resolvedEntries, goals]);
  const calorieTargets = useMemo(() => computeCalorieTargets(resolvedEntries, goals), [resolvedEntries, goals]);
  const enrichedEntries = useMemo(() => resolvedEntries.map((e, i) => ({
    ...e,
    // Targets come ONLY from Goal Settings (computeTargets). If there's no
    // computed target for a week (e.g. an Off week with no goal), show nothing
    // rather than falling back to stale stored values.
    tW: targets[i] ? targets[i].w : null,
    tM: targets[i] ? targets[i].m : null,
    tF: targets[i] ? targets[i].f : null,
    tBF: targets[i] ? targets[i].bf : null,
    tSteps: stepTargets[i],
    tCal: calorieTargets[i],
    _idx: i,
    // Index back into the real `entries` array, or -1 for generated placeholders.
    _realIdx: e._generated ? -1 : entries.findIndex(x => x.date === e.date),
  })), [resolvedEntries, targets, stepTargets, calorieTargets, entries]);

  // Fat adjustment columns: change in fat mass (lb) since the current phase
  // began. Walks rows chronologically; when the phase changes, it re-baselines
  // to that segment's first available target-fat and first logged actual-fat.
  // Each row then reports (this week − phase-start) for both target and actual.
  const enrichedWithAdj = useMemo(() => {
    let curPhase = null;
    let baseTF = null;   // phase-start target fat
    let baseAF = null;   // phase-start actual fat (first logged in the segment)
    return enrichedEntries.map(r => {
      if (r.phase !== curPhase) {
        curPhase = r.phase;
        baseTF = r.tF != null ? r.tF : null;
        baseAF = r.aF != null ? r.aF : null;
      } else {
        if (baseTF == null && r.tF != null) baseTF = r.tF;
        if (baseAF == null && r.aF != null) baseAF = r.aF;
      }
      const tFatAdj = (baseTF != null && r.tF != null) ? round1(r.tF - baseTF) : null;
      const aFatAdj = (baseAF != null && r.aF != null) ? round1(r.aF - baseAF) : null;
      return { ...r, tFatAdj, aFatAdj };
    });
  }, [enrichedEntries]);
  const ACTUAL = useMemo(() => enrichedEntries.filter(r => r.aW != null), [enrichedEntries]);

  // Weekly-log rows grouped into consecutive phase segments, newest first. Each
  // group gets a stable id and a count of logged vs total weeks, for the
  // collapsible phase headers.
  const logGroups = useMemo(() => {
    const rows = [...enrichedWithAdj].reverse();
    const groups = [];
    let cur = null;
    rows.forEach(r => {
      if (!cur || cur.phase !== r.phase) {
        cur = { phase: r.phase, rows: [r], startDate: r.date };
        groups.push(cur);
      } else {
        cur.rows.push(r);
      }
    });
    // Stable id per group: phase + the date span it covers.
    return groups.map((g, i) => {
      const last = g.rows[g.rows.length - 1];
      const logged = g.rows.filter(r => r.aW != null);
      // Actuals are newest-first within the group (rows were reversed), so the
      // chronological first/last are flipped here.
      const firstLogged = logged.length ? logged[logged.length - 1] : null;
      const lastLogged = logged.length ? logged[0] : null;
      const wtChange = firstLogged && lastLogged && firstLogged.aW != null && lastLogged.aW != null
        ? round1(lastLogged.aW - firstLogged.aW) : null;
      const muscleChange = firstLogged && lastLogged && firstLogged.aM != null && lastLogged.aM != null
        ? round1(lastLogged.aM - firstLogged.aM) : null;
      const fatLbChange = firstLogged && lastLogged && firstLogged.aF != null && lastLogged.aF != null
        ? round1(lastLogged.aF - firstLogged.aF) : null;
      const bfChange = firstLogged && lastLogged && firstLogged.aBF != null && lastLogged.aBF != null
        ? round1(lastLogged.aBF - firstLogged.aBF) : null;
      // Per-week rates across the logged span of this phase.
      const spanWeeks = (() => {
        if (!firstLogged || !lastLogged || firstLogged === lastLogged) return null;
        const d1 = parseDate(firstLogged.date), d2 = parseDate(lastLogged.date);
        if (d1 && d2 && d2 > d1) {
          const w = (d2.getTime() - d1.getTime()) / WEEK_MS;
          return w > 0 ? w : null;
        }
        return null;
      })();
      const rate = (chg) => (chg != null && spanWeeks ? round1(chg / spanWeeks) : null);
      const wtRate = rate(wtChange);
      const muscleRate = rate(muscleChange);
      const fatLbRate = rate(fatLbChange);
      const calLogged = logged.filter(r => r.aCal != null);
      const stepLogged = logged.filter(r => r.steps != null);
      const avgCal = calLogged.length ? Math.round(calLogged.reduce((a, r) => a + r.aCal, 0) / calLogged.length) : null;
      const avgSteps = stepLogged.length ? Math.round(stepLogged.reduce((a, r) => a + r.steps, 0) / stepLogged.length) : null;
      // For single-entry phases, expose the actuals directly (no change to show).
      const singleEntry = logged.length === 1 ? logged[0] : null;
      return {
        ...g,
        id: `${g.phase}-${g.rows[0].date}-${last.date}-${i}`,
        loggedCount: logged.length, total: g.rows.length,
        dateSpan: g.rows.length > 1 ? `${last.date} – ${g.rows[0].date}` : g.rows[0].date,
        wtChange, muscleChange, fatLbChange, bfChange,
        wtRate, muscleRate, fatLbRate, avgCal, avgSteps, singleEntry,
      };
    });
  }, [enrichedWithAdj]);
  const chartData = useMemo(() => {
    const src = range === "tracked" ? ACTUAL : enrichedEntries;
    return src.map(r => ({ ...r, label: r.date }));
  }, [range, ACTUAL, enrichedEntries]);

  // Current streak of consecutive tracked weeks where actual fat came in above target fat.
  const fatStreak = useMemo(() => {
    let streak = 0;
    for (let i = ACTUAL.length - 1; i >= 0; i--) {
      const r = ACTUAL[i];
      if (r.aF != null && r.tF != null && r.aF > r.tF) streak++;
      else break;
    }
    return streak;
  }, [ACTUAL]);
  const alertLevel = fatStreak >= 3 ? "derailed" : fatStreak >= 2 ? "slipping" : null;
  // Positive counterpart: consecutive weeks (newest first) with fat AT or UNDER
  // target — the on-track streak shown as a green pill.
  const onTrackStreak = useMemo(() => {
    let s = 0;
    for (let i = ACTUAL.length - 1; i >= 0; i--) {
      const r = ACTUAL[i];
      if (r.aF != null && r.tF != null && r.aF <= r.tF) s++;
      else break;
    }
    return s;
  }, [ACTUAL]);

  // Recovery read for the derail/slip banner: how far over target fat is now,
  // and whether the gap is widening (drifting further off) or shrinking
  // (already climbing back) vs the prior week. Also surfaces the active Cut
  // goal so we can show a concrete "get back to this" number.
  const recovery = useMemo(() => {
    if (!alertLevel || ACTUAL.length === 0) return null;
    const last = ACTUAL[ACTUAL.length - 1];
    const prev = ACTUAL.length >= 2 ? ACTUAL[ACTUAL.length - 2] : null;
    if (last.aF == null || last.tF == null) return null;
    const gap = round1(last.aF - last.tF); // lb over target (positive = over)
    let dir = "flat", prevGap = null;
    if (prev && prev.aF != null && prev.tF != null) {
      prevGap = round1(prev.aF - prev.tF);
      const change = round1(gap - prevGap);
      dir = change < -0.05 ? "improving" : change > 0.05 ? "worsening" : "flat";
    }
    // The Cut goal in effect today — what to steer back toward.
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const cutGoal = activeGoalFor(goals, "Cut", today);
    return {
      gap, dir, prevGap,
      bfActual: last.aBF, bfTarget: last.tBF,
      calGoal: cutGoal?.calGoal ?? null,
      stepGoal: cutGoal?.stepGoal ?? null,
    };
  }, [alertLevel, ACTUAL, goals]);

  // Metric watchlist: flags a tracked metric that's off target on the latest
  // logged week, and counts how many consecutive weeks it's been off. Severity
  // escalates from a warning (orange) to an alert (red) past two weeks running.
  // Adding a metric later is just another entry in `rules`. (Body fat has its
  // own streak-based banner above, so it's not duplicated here.)
  const notifications = useMemo(() => {
    if (ACTUAL.length === 0) return [];
    const rules = [
      { id: "cal", metric: "Calories", isOff: r => r.aCal != null && r.tCal != null && r.aCal - r.tCal > 100,
        word: "over target",
        detail: r => `${(r.aCal - r.tCal).toLocaleString()} over (${r.aCal.toLocaleString()} vs ${r.tCal.toLocaleString()})` },
      { id: "steps", metric: "Steps", isOff: r => r.steps != null && r.tSteps != null && r.tSteps - r.steps > 300,
        word: "under goal",
        detail: r => `${(r.tSteps - r.steps).toLocaleString()} under (${r.steps.toLocaleString()} vs ${r.tSteps.toLocaleString()})` },
      { id: "muscle", metric: "Muscle", isOff: r => r.aM != null && r.tM != null && r.aM < r.tM,
        word: "below target",
        detail: r => `${round1(r.tM - r.aM)} lb below (${r.aM} vs ${r.tM})` },
    ];
    const out = [];
    rules.forEach(rule => {
      const last = ACTUAL[ACTUAL.length - 1];
      if (!rule.isOff(last)) return; // only flag if off on the most recent week
      // Count consecutive off-target weeks ending at the latest.
      let streak = 0;
      for (let i = ACTUAL.length - 1; i >= 0; i--) {
        if (rule.isOff(ACTUAL[i])) streak++; else break;
      }
      const severity = streak >= 3 ? "alert" : "warn";
      out.push({
        id: rule.id, metric: rule.metric, severity, streak,
        message: rule.detail(last),
      });
    });
    return out;
  }, [ACTUAL]);

  // Per-metric streaks for the stat-card badges — "missing the goal" more than
  // two weeks running (i.e. 3+) lights up a small warning badge on that card.
  const weightStreak = useMemo(() => missStreak(ACTUAL, "aW", "tW", (a, t) => a > t), [ACTUAL]);
  const muscleStreak = useMemo(() => missStreak(ACTUAL, "aM", "tM", (a, t) => a < t), [ACTUAL]);
  const bfStreak = useMemo(() => missStreak(ACTUAL, "aBF", "tBF", (a, t) => a > t), [ACTUAL]);
  const calStreak = useMemo(() => missStreak(ACTUAL, "aCal", "tCal", (a, t) => a > t), [ACTUAL]);
  const stepsStreak = useMemo(() => missStreak(ACTUAL, "steps", "tSteps", (a, t) => a < t), [ACTUAL]);
  const bucketAlert = (streak) => (streak > 2 ? streak : 0);

  // Derail = a run of 3+ consecutive weeks with fat over target. Once a run
  // reaches 3, the WHOLE run is marked — including its first two weeks — so
  // historical highlights show the full off-track stretch, not just week 3+.
  const derailedRows = useMemo(() => {
    const miss = ACTUAL.map(r => r.aF != null && r.tF != null && r.aF > r.tF);
    const derailed = new Array(ACTUAL.length).fill(false);
    let start = -1;
    for (let i = 0; i <= ACTUAL.length; i++) {
      const m = i < ACTUAL.length && miss[i];
      if (m && start === -1) start = i;
      if (!m && start !== -1) {
        if (i - start >= 3) { for (let j = start; j < i; j++) derailed[j] = true; }
        start = -1;
      }
    }
    return ACTUAL.map((r, i) => ({ ...r, derailed: derailed[i] }));
  }, [ACTUAL]);
  const derailedSegments = useMemo(() => {
    const segs = [];
    let cur = null;
    derailedRows.forEach(r => {
      if (r.derailed) {
        if (!cur) cur = { x1: r.date, x2: r.date };
        else cur.x2 = r.date;
      } else if (cur) {
        segs.push(cur); cur = null;
      }
    });
    if (cur) segs.push(cur);
    return segs;
  }, [derailedRows]);
  // Dates of historically-derailed weeks, for red log rows and timeline marks.
  const derailedDates = useMemo(() => new Set(derailedRows.filter(r => r.derailed).map(r => r.date)), [derailedRows]);

  // Pacing: given the current Fri–Thu block, what should the rest of the
  // week's daily calories/steps be to land on the weekly goal by Thursday.

  // How many times each habit was done in a given Fri-Thu week block.
  const weekCount = (habitKey, blockStart) => {
    let count = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date(blockStart.getTime() + i * DAY_MS);
      const ds = formatMDY(d);
      const entry = habitLog.find(e => e.date === ds);
      if (entry && entry[habitKey]) count++;
    }
    return count;
  };

  // Consecutive completed weeks hitting the target, plus this week's current count.
  const habitStreaks = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const result = {};
    HABITS.forEach(h => {
      const target = habitTargets[h.key] || 1;
      let streak = 0;
      // Walk back week by week, starting from the most recently completed week.
      const thisBlockStart = blockStartFor(today);
      for (let w = 1; w <= 52; w++) {
        const bs = new Date(thisBlockStart.getTime() - w * 7 * DAY_MS);
        if (weekCount(h.key, bs) >= target) streak++;
        else break;
      }
      result[h.key] = { streak, thisWeek: weekCount(h.key, thisBlockStart), target };
    });
    return result;
  }, [habitLog, habitTargets]);

  // Last 4 weeks of data for the progress chart: week label + completion count per habit.
  const habitChartData = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return Array.from({ length: 4 }, (_, wi) => {
      const weekEnd = new Date(today.getTime() - wi * 7 * DAY_MS);
      const weekStart = new Date(weekEnd.getTime() - 6 * DAY_MS);
      const row = { label: `${weekStart.getMonth() + 1}/${weekStart.getDate()}` };
      HABITS.forEach(h => {
        let count = 0;
        for (let d = new Date(weekStart); d <= weekEnd; d = new Date(d.getTime() + DAY_MS)) {
          const ds = formatMDY(d);
          const entry = habitLog.find(e => e.date === ds);
          if (entry && entry[h.key]) count++;
        }
        row[h.key] = count;
      });
      return row;
    }).reverse();
  }, [habitLog]);

  // Manual entries always win. A HealthKit-synced day only shows up if you
  // haven't already logged that date by hand.
  const mergedDailyEntries = useMemo(() => {
    const manualDates = new Set(dailyEntries.map(d => d.date));
    const synced = healthkitDaily
      .filter(d => !manualDates.has(d.date))
      .map(d => ({ date: d.date, cal: d.cal, steps: d.steps, weight: d.weight, fatMass: d.fatMass, muscleMass: d.muscleMass, _synced: true }));
    return [...dailyEntries, ...synced];
  }, [dailyEntries, healthkitDaily]);

  const pacing = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const blockStart = blockStartFor(today);
    const blockEnd = blockEndFor(blockStart);
    // Current phase now comes from Goal Settings — the latest-dated goal on or
    // before today wins. Falls back to the latest logged week, then Cut, only
    // if no goal is dated yet.
    let currentPhase = phaseOnDate(goals, today);
    if (!currentPhase) {
      const pastEntries = entries
        .map(e => ({ p: e.phase, d: parseDate(e.date) }))
        .filter(e => e.d && e.d <= today)
        .sort((a, b) => a.d.getTime() - b.d.getTime());
      currentPhase = pastEntries.length ? pastEntries[pastEntries.length - 1].p
        : (entries.length ? entries[0].phase : "Cut");
    }
    const goal = activeGoalFor(goals, currentPhase, today);
    const calGoal = goal?.calGoal ?? null;
    const stepGoal = goal?.stepGoal ?? null;

    // Today is never counted as "logged," no matter what's in the database
    // for it — only days strictly before today count toward what's been
    // logged so far, and today always counts as a remaining day to plan
    // for. This matters now that automated syncs can write partial or
    // zero values for today at any hour (e.g. before any meals are
    // logged) — those shouldn't get treated as "today's already
    // accounted for" and drop out of the remaining-days math.
    const daysSoFar = mergedDailyEntries.filter(d => {
      const dd = parseDate(d.date);
      return dd && dd >= blockStart && dd < today;
    });
    const daysRemaining = daysBetween(today, blockEnd) + 1; // calendar days left, includes today

    const calLogged = daysSoFar.filter(d => d.cal != null).reduce((a, d) => a + d.cal, 0);
    const calDaysLogged = daysSoFar.filter(d => d.cal != null).length;
    const stepsLogged = daysSoFar.filter(d => d.steps != null).reduce((a, d) => a + d.steps, 0);
    const stepDaysLogged = daysSoFar.filter(d => d.steps != null).length;

    const calDaysRemaining = daysRemaining;
    const stepDaysRemaining = daysRemaining;

    // Weekly target is scaled to (logged days + remaining days), not a flat 7 —
    // a day that was never logged (forgot to enter it, not zero intake) is
    // excluded entirely rather than silently counted as 0 consumed, which
    // used to inflate the remaining budget. Only days that were actually
    // logged, plus days still ahead of you, factor into the pace.
    const recCal = calGoal != null && calDaysRemaining > 0
      ? Math.round((calGoal * (calDaysLogged + calDaysRemaining) - calLogged) / calDaysRemaining) : null;
    const recSteps = stepGoal != null && stepDaysRemaining > 0
      ? Math.round((stepGoal * (stepDaysLogged + stepDaysRemaining) - stepsLogged) / stepDaysRemaining) : null;

    const blockDays = Array.from({ length: 7 }, (_, i) => {
      const date = new Date(blockStart.getTime() + i * DAY_MS);
      const dateStr = formatMDY(date);
      const entry = mergedDailyEntries.find(d => {
        const dd = parseDate(d.date);
        return dd && dd.getTime() === date.getTime();
      });
      return {
        date, dateStr,
        label: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getDay()],
        isToday: date.getTime() === today.getTime(),
        isFuture: date.getTime() > today.getTime(),
        logged: !!entry && (entry.cal != null || entry.steps != null),
        entry,
      };
    });

    return {
      blockStart, blockEnd, daysRemaining, calGoal, stepGoal, recCal, recSteps,
      calDaysLogged, stepDaysLogged, blockDays,
      calStatus: recCal == null ? null : recCal < 0 ? "over" : recCal > calGoal ? "ahead" : "behind",
      stepStatus: recSteps == null ? null : recSteps <= stepGoal ? "ahead" : "behind",
    };
  }, [entries, goals, mergedDailyEntries]);

  if (status === "loading") {
    return (
      <div className="dash dash-loading">
        <style>{BASE_STYLES}</style>
        <Loader2 className="spin" size={22} />
        <span>Loading your log…</span>
      </div>
    );
  }

  if (ACTUAL.length === 0) {
    return (
      <div className="dash">
        <style>{BASE_STYLES}</style>
        <div className="empty-state">
          <AlertCircle size={20} />
          <p>No weeks logged yet.</p>
          <button className="btn-primary" onClick={() => { setForm({ ...emptyForm, wk: "0" }); setFormOpen(true); }}>
            <Plus size={13} /> Add your first week
          </button>
        </div>
        {formOpen && (
          <EntryForm form={form} setForm={setForm} isEdit={false} error={formErr}
            onCancel={() => { setFormOpen(false); setFormErr(""); }}
            onSave={() => {
              if (!parseDate(form.date)) { setFormErr("Date needs to look like 7/10/26 (month/day/year)."); return; }
              setFormErr("");
              const e = buildEntry(form);
              persist([...entries, e]);
              setFormOpen(false);
            }} />
        )}
      </div>
    );
  }

  const latest = ACTUAL[ACTUAL.length - 1];
  // Today's phase per Goal Settings (latest-dated goal wins), falling back to
  // the latest logged week's phase if no goal is dated yet.
  const todayPhase = (() => {
    const t = new Date(); t.setHours(0, 0, 0, 0);
    return phaseOnDate(goals, t) || latest.phase;
  })();
  const start = ACTUAL[0];
  const bestBF = ACTUAL.reduce((a, b) => (b.aBF != null && (a.aBF == null || b.aBF < a.aBF) ? b : a), ACTUAL[0]);
  const calData = ACTUAL.filter(r => r.aCal != null);
  const stepsData = ACTUAL.filter(r => r.steps != null);
  const weightChange = latest.aW != null && start.aW != null ? delta(latest.aW, start.aW) : null;
  const bfChange = latest.aBF != null && start.aBF != null ? delta(latest.aBF, start.aBF) : null;
  const fatMassChange = latest.aF != null && start.aF != null ? delta(latest.aF, start.aF) : null;
  const muscleChange = latest.aM != null && start.aM != null ? delta(latest.aM, start.aM) : null;
  const avgSteps = stepsData.length ? Math.round(stepsData.reduce((a, r) => a + r.steps, 0) / stepsData.length) : null;
  const avgCal = calData.length ? Math.round(calData.reduce((a, r) => a + r.aCal, 0) / calData.length) : null;

  function buildEntry(f) {
    const aW = num(f.aW), aF = num(f.aF);
    // Body fat % is always computed from weight + fat mass (fat ÷ weight) —
    // it's no longer entered by hand.
    const aBF = (aW != null && aF != null && aW > 0) ? round1((aF / aW) * 100) : null;
    // Phase is no longer entered by hand — resolve it from Goal Settings for
    // this week's date. Only weeks earlier than the first goal fall back to the
    // form's phase (or the existing "Cut" default).
    const resolvedPhase = phaseOnDate(goals, parseDate(f.date)) || f.phase || "Cut";
    return {
      wk: /^\d+$/.test(f.wk) ? parseInt(f.wk, 10) : f.wk,
      date: f.date, phase: resolvedPhase,
      aW, aM: num(f.aM), aF, aBF,
      aCal: num(f.aCal), steps: num(f.steps), notes: f.notes || "",
    };
  }

  // Keeps the log in chronological order no matter what order weeks are
  // entered in — target math walks the array in order, so a backfilled week
  // added at the end would otherwise silently break the projections.
  function sortEntriesByDate(list) {
    return [...list].sort((a, b) => (parseDate(a.date)?.getTime() ?? 0) - (parseDate(b.date)?.getTime() ?? 0));
  }

  function openAdd() {
    const lastNumeric = [...entries].reverse().find(r => typeof r.wk === "number");
    setForm({ ...emptyForm, wk: lastNumeric ? String(lastNumeric.wk + 1) : "0" });
    setEditIndex(null);
    setFormOpen(true);
  }
  // Fill a generated roadmap week: opens the add form pre-dated to that Friday.
  // Saving creates a real entry, which then takes over that week's slot.
  function openFill(dateStr) {
    const lastNumeric = [...entries].reverse().find(r => typeof r.wk === "number");
    setForm({ ...emptyForm, date: dateStr, wk: lastNumeric ? String(lastNumeric.wk + 1) : "0" });
    setEditIndex(null);
    setFormOpen(true);
  }
  function openEdit(idx) {
    const entry = entries[idx];
    setForm({
      wk: String(entry.wk), date: entry.date, phase: entry.phase,
      aW: entry.aW ?? "", aM: entry.aM ?? "", aF: entry.aF ?? "", aBF: entry.aBF ?? "",
      aCal: entry.aCal ?? "", steps: entry.steps ?? "", notes: entry.notes || "",
    });
    setEditIndex(idx);
    setFormOpen(true);
  }
  function handleSave() {
    if (!parseDate(form.date)) { setFormErr("Date needs to look like 7/10/26 (month/day/year)."); return; }
    setFormErr("");
    const e = buildEntry(form);
    if (editIndex != null) {
      persist(sortEntriesByDate(entries.map((r, i) => (i === editIndex ? e : r))));
    } else {
      persist(sortEntriesByDate([...entries, e]));
    }
    setFormOpen(false);
    setEditIndex(null);
  }
  function handleDelete(idx) {
    persist(entries.filter((_, i) => i !== idx));
  }

  // Blank rate/goal fields inherit from the goal that was active for this
  // phase right before this one, so you only have to type what's changing.
  // (durationWeeks and notes aren't "carry forward" values, so they're left
  // as typed — blank duration just means no roadmap weeks get generated.)
  function buildGoal(f) {
    const others = goalEditIndex != null ? goals.filter((_, i) => i !== goalEditIndex) : goals;
    const prev = activeGoalFor(others, f.phase, parseDate(f.date));
    const inherit = (v, key, fallback) => {
      const n = num(v);
      if (n != null) return n;
      return prev && prev[key] != null ? prev[key] : fallback;
    };
    return {
      date: f.date, phase: f.phase,
      muscleRate: inherit(f.muscleRate, "muscleRate", 0),
      fatRate: inherit(f.fatRate, "fatRate", 0),
      stepGoal: inherit(f.stepGoal, "stepGoal", null),
      calGoal: inherit(f.calGoal, "calGoal", null),
      durationWeeks: num(f.durationWeeks),
      notes: f.notes || "",
    };
  }
  function openAddGoal() {
    const today = new Date();
    const mm = today.getMonth() + 1, dd = today.getDate(), yy = String(today.getFullYear()).slice(2);
    setGoalForm({ date: `${mm}/${dd}/${yy}`, phase: "Cut", muscleRate: "", fatRate: "", stepGoal: "", calGoal: "", durationWeeks: "", notes: "" });
    setGoalEditIndex(null);
    setGoalFormOpen(true);
  }
  // Adjust the current phase mid-stream: creates a NEW goal dated today for the
  // phase in effect now, pre-filled with that phase's current numbers so you
  // just change what's different (e.g. drop calories). Because it's a new dated
  // goal in the same phase, targets re-anchor from today forward and the weekly
  // log stays one phase section — no new phase is started.
  function openAdjustPhase() {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const mm = today.getMonth() + 1, dd = today.getDate(), yy = String(today.getFullYear()).slice(2);
    const phase = phaseOnDate(goals, today) || "Cut";
    const cur = activeGoalFor(goals, phase, today);
    setGoalForm({
      date: `${mm}/${dd}/${yy}`, phase,
      muscleRate: cur?.muscleRate ?? "", fatRate: cur?.fatRate ?? "",
      stepGoal: cur?.stepGoal ?? "", calGoal: cur?.calGoal ?? "",
      durationWeeks: "", notes: "Mid-phase adjustment",
    });
    setGoalEditIndex(null);
    setGoalFormOpen(true);
  }
  function openEditGoal(g) {
    const idx = goals.indexOf(g);
    setGoalForm({ date: g.date, phase: g.phase, muscleRate: g.muscleRate, fatRate: g.fatRate, stepGoal: g.stepGoal ?? "", calGoal: g.calGoal ?? "", durationWeeks: g.durationWeeks ?? "", notes: g.notes || "" });
    setGoalEditIndex(idx);
    setGoalFormOpen(true);
  }
  function handleSaveGoal() {
    if (!parseDate(goalForm.date)) { setGoalFormErr("Effective date needs to look like 7/10/26 (month/day/year)."); return; }
    setGoalFormErr("");
    const g = buildGoal(goalForm);
    if (goalEditIndex != null) {
      persistGoals(goals.map((r, i) => (i === goalEditIndex ? g : r)));
    } else {
      persistGoals([...goals, g]);
    }
    setGoalFormOpen(false);
    setGoalEditIndex(null);
  }
  function handleDeleteGoal(g) {
    const idx = goals.indexOf(g);
    persistGoals(goals.filter((_, i) => i !== idx));
  }

  function buildDaily(f) {
    return {
      date: f.date, cal: num(f.cal), steps: num(f.steps),
      weight: num(f.weight), fatMass: num(f.fatMass), muscleMass: num(f.muscleMass),
    };
  }
  function openAddDaily(presetDate) {
    const d = presetDate || formatMDY(new Date());
    setDailyForm({ date: d, cal: "", steps: "", weight: "", fatMass: "", muscleMass: "" });
    setDailyEditIndex(null);
    setDailyFormOpen(true);
  }
  function openEditDaily(entry) {
    // A synced-only row (not in dailyEntries) isn't found here, so idx is -1 —
    // treat that as null (add), which upserts a new manual entry by date and
    // makes it take precedence over the synced value from then on.
    const idx = dailyEntries.indexOf(entry);
    setDailyForm({
      date: entry.date, cal: entry.cal ?? "", steps: entry.steps ?? "",
      weight: entry.weight ?? "", fatMass: entry.fatMass ?? "", muscleMass: entry.muscleMass ?? "",
    });
    setDailyEditIndex(idx >= 0 ? idx : null);
    setDailyFormOpen(true);
  }
  function handleSaveDaily() {
    const d = buildDaily(dailyForm);
    if (!parseDate(d.date)) { setDailyFormErr("Date needs to look like 7/10/26 (month/day/year)."); return; }
    setDailyFormErr("");
    if (dailyEditIndex != null) {
      persistDaily(dailyEntries.map((r, i) => (i === dailyEditIndex ? d : r)));
    } else {
      // Upsert by date: logging a day that already exists updates that row
      // instead of creating a duplicate. Blank fields don't wipe existing values.
      const dNew = parseDate(d.date);
      const existingIdx = dailyEntries.findIndex(r => {
        const dd = parseDate(r.date);
        return dd && dd.getTime() === dNew.getTime();
      });
      if (existingIdx >= 0) {
        persistDaily(dailyEntries.map((r, i) => (i === existingIdx
          ? {
              ...r,
              cal: d.cal ?? r.cal, steps: d.steps ?? r.steps,
              weight: d.weight ?? r.weight, fatMass: d.fatMass ?? r.fatMass, muscleMass: d.muscleMass ?? r.muscleMass,
            }
          : r)));
      } else {
        persistDaily([...dailyEntries, d]);
      }
    }
    setDailyFormOpen(false);
    setDailyEditIndex(null);
  }
  // Match by date, not object identity — the table renders copies of the
  // entries (merged/sorted), so indexOf against dailyEntries would miss.
  function handleDeleteDaily(entry) {
    persistDaily(dailyEntries.filter(r => r.date !== entry.date));
  }
  // Synced rows live in the daily_metrics table (written by the HealthKit
  // Shortcut), not the daily_log blob — deleting one removes the DB row.
  // Note: a sync run later the same day can legitimately re-create it.
  async function handleDeleteSynced(entry) {
    try {
      const { error } = await supabase.from("daily_metrics").delete().eq("date", entry.date);
      if (error) throw error;
      setHealthkitDaily(prev => prev.filter(r => r.date !== entry.date));
      setDailyErrMsg("");
    } catch (e) {
      setDailyErrMsg("Couldn't delete that synced day — try again.");
    }
  }

  // Delete buttons arm on the first click (turn red, "Sure?") and only delete
  // on the second. Moving the mouse away disarms.
  const DeleteBtn = ({ id, onDelete }) => (
    <button
      className={"icon-btn danger" + (confirmDel === id ? " armed" : "")}
      title={confirmDel === id ? "Click again to confirm" : "Delete"}
      onMouseLeave={() => { if (confirmDel === id) setConfirmDel(null); }}
      onClick={() => {
        if (confirmDel === id) { onDelete(); setConfirmDel(null); }
        else setConfirmDel(id);
      }}>
      <Trash2 size={12} />
    </button>
  );

  function openExport() {
    setBackupMsg("");
    setBackupText(JSON.stringify({ entries, goals, daily: dailyEntries }, null, 2));
    setBackupMode("export");
  }
  function openImport() {
    setBackupMsg("");
    setBackupText("");
    setBackupMode("import");
  }
  // Deduplicate an entries array by date — keeps the row with the most actual
  // data (most non-null fields) when duplicates exist for the same date.
  function dedupeEntries(list) {
    const byDate = new Map();
    list.forEach(e => {
      const key = e.date;
      const existing = byDate.get(key);
      if (!existing) { byDate.set(key, e); return; }
      // Count non-null values to pick the richer row.
      const score = r => ["aW","aM","aF","aBF","aCal","steps"].filter(k => r[k] != null).length;
      if (score(e) > score(existing)) byDate.set(key, e);
    });
    return sortEntriesByDate([...byDate.values()]);
  }
  function dedupeDaily(list) {
    const byDate = new Map();
    list.forEach(d => {
      const existing = byDate.get(d.date);
      if (!existing || (d.cal != null && existing.cal == null) || (d.steps != null && existing.steps == null))
        byDate.set(d.date, { ...existing, ...d });
    });
    return [...byDate.values()].sort((a, b) => (parseDate(a.date)?.getTime() ?? 0) - (parseDate(b.date)?.getTime() ?? 0));
  }
  function handleDedupe() {
    const cleanEntries = dedupeEntries(entries);
    const cleanDaily = dedupeDaily(dailyEntries);
    persist(cleanEntries);
    persistDaily(cleanDaily);
    setBackupMsg(`Cleaned up: ${entries.length - cleanEntries.length} duplicate week${entries.length - cleanEntries.length === 1 ? "" : "s"} and ${dailyEntries.length - cleanDaily.length} duplicate day${dailyEntries.length - cleanDaily.length === 1 ? "" : "s"} removed.`);
  }
  function handleRestore() {
    try {
      const parsed = JSON.parse(backupText);
      if (!Array.isArray(parsed.entries) || !Array.isArray(parsed.goals) || !Array.isArray(parsed.daily)) {
        throw new Error("Backup is missing entries, goals, or daily arrays");
      }
      const cleanEntries = dedupeEntries(parsed.entries.map(e => ({ ...e, phase: migratePhase(e.phase) })));
      persist(cleanEntries);
      persistGoals(parsed.goals.map(g => ({ ...g, phase: migratePhase(g.phase) })));
      persistDaily(dedupeDaily(parsed.daily));
      setBackupMode(null);
      setBackupText("");
      setBackupMsg("Backup restored.");
    } catch (e) {
      setBackupMsg("That doesn't look like a valid backup — paste the exact JSON from a previous Export.");
    }
  }

  function toggleHabit(dateStr, habitKey) {
    const existing = habitLog.find(e => e.date === dateStr);
    if (existing) {
      persistHabits(habitLog.map(e => e.date === dateStr ? { ...e, [habitKey]: !e[habitKey] } : e));
    } else {
      const entry = { date: dateStr };
      HABITS.forEach(h => entry[h.key] = false);
      entry[habitKey] = true;
      persistHabits([...habitLog, entry].sort((a, b) => (parseDate(a.date)?.getTime() ?? 0) - (parseDate(b.date)?.getTime() ?? 0)));
    }
  }
  const taggedGoals = tagGoalStatuses(goals);
  const currentGoals = GOAL_PHASES.map(phase => {
    const forPhase = taggedGoals.filter(g => g.phase === phase);
    return forPhase.find(g => g.status === "active") || null;
  });
  const nextGoals = GOAL_PHASES.map(phase => {
    const upcoming = taggedGoals
      .filter(g => g.phase === phase && g.status === "upcoming")
      .sort((a, b) => (parseDate(a.date)?.getTime() ?? 0) - (parseDate(b.date)?.getTime() ?? 0));
    return upcoming[0] || null;
  });

  return (
    <div className="dash" onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
      <style>{BASE_STYLES}</style>

      <div className="pull-refresh" style={{ height: pullY, opacity: Math.min(1, pullY / PULL_THRESHOLD) }}>
        <RefreshCw size={20} className={refreshing ? "spin" : ""} style={refreshing ? undefined : { transform: `rotate(${pullY * 3}deg)` }} />
      </div>

      {errMsg && <div className="banner-error"><AlertCircle size={13} /> {errMsg}</div>}
      {withingsBanner && <div className="banner-error"><AlertCircle size={13} /> {withingsBanner}</div>}

      <div className="header">
        <div className="header-top">
          <h1 className="title">Body Tracker</h1>
          <div className="header-meta">
            <div className="header-meta-row">
              <span>{formatMDY(new Date())}</span>
              <span className="phase-pill" style={{ background: phaseColor(todayPhase) + "22", color: phaseColor(todayPhase) }}>{phaseLabel(todayPhase)}</span>
            </div>
          </div>
        </div>
        <div className="hero-card">
          <div className="hero-w">
            <div className="hero-num">{fmtNum(latest.aW)}<span className="hero-unit">lb</span></div>
            <div className="hero-lbl">Weight</div>
          </div>
          <div className={"hero-bf" + (latest.aBF != null && latest.tBF != null ? (latest.aBF <= latest.tBF ? " good" : " bad") : "")}>
            <div className="hero-num hero-num-bf">{fmtNum(latest.aBF)}<span className="hero-unit">%</span></div>
            <div className="hero-lbl">Body Fat</div>
          </div>
        </div>
      </div>

      <div className="tab-bar">
        <button className={"tab-btn " + (tab === "dashboard" ? "active" : "")} onClick={() => setTab("dashboard")}>
          <LayoutDashboard size={13} /> <span className="tab-label-full">Dashboard</span><span className="tab-label-short">Home</span>
        </button>
        <button className={"tab-btn " + (tab === "daily" ? "active" : "")} onClick={() => setTab("daily")}>
          <Flame size={13} /> Daily
        </button>
        <button className={"tab-btn " + (tab === "habits" ? "active" : "")} onClick={() => setTab("habits")}>
          <Dumbbell size={13} /> Habits
        </button>
        <button className={"tab-btn " + (tab === "settings" ? "active" : "")} onClick={() => setTab("settings")}>
          <Settings size={13} /> <span className="tab-label-full">Goal Settings</span><span className="tab-label-short">Goals</span>
        </button>
      </div>

      {tab === "dashboard" && (
        <>
          {alertLevel === "slipping" && (
            <div className="banner-alert slipping">
              <AlertTriangle size={22} />
              <div className="banner-alert-text">
                <strong>Body Fat — you're slipping.</strong> <span className="notif-weeks">{fatStreak}w</span> Actual fat has been above target for {fatStreak} weeks straight. <strong style={{ textDecoration: "underline" }}>Tighten up now, before it turns into a full derail.</strong>
                {recovery && <RecoveryFooter r={recovery} />}
              </div>
            </div>
          )}
          {alertLevel === "derailed" && (
            <div className="banner-alert derailed">
              <AlertCircle size={30} />
              <div className="banner-alert-text">
                <strong>Body Fat — you've derailed.</strong> <span className="notif-weeks">{fatStreak}w</span> Fat's been above target for {fatStreak} weeks in a row — this isn't a rough week, it's a pattern.
                {recovery && <RecoveryFooter r={recovery} />}
              </div>
            </div>
          )}
          {!alertLevel && ACTUAL.length > 0 && (() => {
            const last = ACTUAL[ACTUAL.length - 1];
            const overTarget = last.aF != null && last.tF != null && last.aF > last.tF;
            return (
              <div className="banner-ontrack">
                <Check size={15} />
                <span>
                  <strong>Body Fat — </strong>
                  {fatStreak === 1 || overTarget
                    ? "over target this week. One more over-target week triggers a slipping alert."
                    : <>on track — at or under target for {onTrackStreak} week{onTrackStreak === 1 ? "" : "s"}. <span className="notif-weeks ontrack-pill">{onTrackStreak}w</span></>}
                </span>
              </div>
            );
          })()}
          {notifications.length > 0 && (
            <div className="notif-stack">
              {notifications.map(n => (
                <div key={n.id} className={"notif-row notif-" + n.severity}>
                  <span className="notif-icon"><AlertTriangle size={13} /></span>
                  <span className="notif-metric">{n.metric}</span>
                  <span className="notif-msg">{n.message}</span>
                  {n.streak >= 1 && <span className="notif-weeks">{n.streak}w</span>}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === "settings" ? (
        <div className="settings-view">
          <div className="settings-note">Maintain's target still auto-locks to your last actual regardless of what's set here — these rate fields are just for your own reference on that card.</div>
          <div className="goal-cards">
            {GOAL_PHASES.map((phase, i) => {
              const g = currentGoals[i];
              const next = nextGoals[i];
              return (
                <div key={phase} className="goal-card" style={{ borderColor: phaseColor(phase) + "55" }}>
                  <div className="goal-card-head">
                    <span className="phase-tag" style={{ background: phaseColor(phase) + "22", color: phaseColor(phase) }}>{phaseLabel(phase)}</span>
                    {g && <span className="goal-card-date">active since {g.date}</span>}
                  </div>
                  {g ? (
                    <div className="goal-card-body">
                      <div className="goal-metric">
                        <span className="goal-metric-label">Muscle</span>
                        <span className="goal-metric-val">{g.muscleRate > 0 ? "+" : ""}{g.muscleRate} lb/wk</span>
                      </div>
                      <div className="goal-metric">
                        <span className="goal-metric-label">Fat</span>
                        <span className="goal-metric-val">{g.fatRate > 0 ? "+" : ""}{g.fatRate} lb/wk</span>
                      </div>
                      {g.stepGoal != null && (
                        <div className="goal-metric">
                          <span className="goal-metric-label">Steps</span>
                          <span className="goal-metric-val">{g.stepGoal.toLocaleString()}/day</span>
                        </div>
                      )}
                      {g.calGoal != null && (
                        <div className="goal-metric">
                          <span className="goal-metric-label">Calories</span>
                          <span className="goal-metric-val">{g.calGoal.toLocaleString()}/day</span>
                        </div>
                      )}
                      {g.notes && <div className="goal-card-notes">{g.notes}</div>}
                    </div>
                  ) : next ? (
                    <div className="goal-card-empty">Nothing active yet</div>
                  ) : (
                    <div className="goal-card-empty">No goal set yet</div>
                  )}
                  {next && (
                    <div className="goal-card-upcoming">
                      <span className="upcoming-badge">UPCOMING · {next.date}</span>
                      <span className="upcoming-vals">{next.muscleRate > 0 ? "+" : ""}{next.muscleRate} muscle · {next.fatRate > 0 ? "+" : ""}{next.fatRate} fat lb/wk</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="panel">
            <div className="panel-head">
              <div className="panel-title">Goal History<span className="dim">{goals.length} entries · sorted by effective date, so future roadmap goals sort correctly</span></div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn-ghost sm" onClick={openAdjustPhase} disabled={goalSaving}>
                  <Pencil size={13} /> Adjust current phase
                </button>
                <button className="btn-primary sm" onClick={openAddGoal} disabled={goalSaving}>
                  {goalSaving ? <Loader2 size={13} className="spin" /> : <Target size={13} />} Set new goal
                </button>
              </div>
            </div>

            {goalErrMsg && <div className="banner-error"><AlertCircle size={13} /> {goalErrMsg}</div>}

            {goalFormOpen && (
              <GoalForm form={goalForm} setForm={setGoalForm} isEdit={goalEditIndex != null} error={goalFormErr}
                onCancel={() => { setGoalFormOpen(false); setGoalEditIndex(null); setGoalFormErr(""); }}
                onSave={handleSaveGoal} />
            )}

            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Date</th><th>Phase</th><th>Status</th><th>Muscle rate</th><th>Fat rate</th><th>Step goal</th><th>Calorie goal</th><th>Duration</th><th>Notes</th><th></th></tr>
                </thead>
                <tbody>
                  {goals.length === 0 && (
                    <tr><td colSpan={10} className="empty-row">No goals set yet — click "Set new goal" to add one.</td></tr>
                  )}
                  {taggedGoals
                    .map((g, i) => ({ ...g, _origIndex: i }))
                    .sort((a, b) => (parseDate(b.date)?.getTime() ?? 0) - (parseDate(a.date)?.getTime() ?? 0))
                    .map((g, i) => (
                      <tr key={i}>
                        <td>{g.date}</td>
                        <td><span className="phase-tag" style={{ background: phaseColor(g.phase) + "22", color: phaseColor(g.phase) }}>{g.phase}</span></td>
                        <td><span className={"status-badge status-" + g.status}>{g.status.toUpperCase()}</span></td>
                        <td>{g.muscleRate > 0 ? "+" : ""}{g.muscleRate} lb/wk</td>
                        <td>{g.fatRate > 0 ? "+" : ""}{g.fatRate} lb/wk</td>
                        <td>{g.stepGoal != null ? g.stepGoal.toLocaleString() + "/day" : "–"}</td>
                        <td>{g.calGoal != null ? g.calGoal.toLocaleString() + "/day" : "–"}</td>
                        <td>{g.durationWeeks != null ? g.durationWeeks + " wk" : "–"}</td>
                        <td className="notes-cell">
                          {g.notes ? (
                            <button className="icon-btn note-btn" title="View note"
                              onClick={() => setNoteOpen({ title: `${g.phase} goal · ${g.date}`, text: g.notes })}>
                              <StickyNote size={12} />
                            </button>
                          ) : null}
                        </td>
                        <td className="row-actions">
                          <button className="icon-btn" onClick={() => openEditGoal(goals[g._origIndex])} title="Edit"><Pencil size={12} /></button>
                          <DeleteBtn id={`goal-${g._origIndex}`} onDelete={() => handleDeleteGoal(goals[g._origIndex])} />
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel" style={{ paddingBottom: 18 }}>
            <div className="panel-head">
              <div className="panel-title">Habit Weekly Targets<span className="dim">days per week needed to count as a streak</span></div>
            </div>
            <div className="habit-targets-grid">
              {HABITS.map(h => (
                <div key={h.key} className="habit-target-row">
                  <h.Icon size={14} style={{ color: h.color }} />
                  <span className="habit-target-label">{h.label}</span>
                  <div className="habit-target-stepper">
                    <button className="habit-step-btn" onClick={() => persistHabitTargets({ ...habitTargets, [h.key]: Math.max(1, (habitTargets[h.key] || 1) - 1) })}>−</button>
                    <span className="habit-target-val">{habitTargets[h.key] || 1}×</span>
                    <button className="habit-step-btn" onClick={() => persistHabitTargets({ ...habitTargets, [h.key]: Math.min(7, (habitTargets[h.key] || 1) + 1) })}>+</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="panel" style={{ paddingBottom: 18 }}>
            <div className="panel-head">
              <div className="panel-title">Backup & Restore<span className="dim">weekly log + goals + daily log, one JSON blob</span></div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn-ghost" onClick={handleDedupe}>Dedupe</button>
                <button className="btn-ghost" onClick={openExport}>Export</button>
                <button className="btn-ghost" onClick={openImport}>Import</button>
              </div>
            </div>
            {backupMode === "export" && (
              <div className="backup-box">
                <div className="form-note">Click the box below and copy everything (it auto-selects). Paste it somewhere safe — a note, a text file. To restore later, use Import and paste it back.</div>
                <textarea className="backup-ta" readOnly value={backupText} onFocus={(e) => e.target.select()} />
                <div className="form-actions">
                  <button className="btn-ghost" onClick={() => setBackupMode(null)}><X size={13} /> Close</button>
                </div>
              </div>
            )}
            {backupMode === "import" && (
              <div className="backup-box">
                <div className="form-note">Paste a previously exported backup below. Restoring replaces everything currently in the app — weekly log, goals, and daily log.</div>
                <textarea className="backup-ta" value={backupText} onChange={(e) => setBackupText(e.target.value)} placeholder='Paste the exported JSON here…' />
                <div className="form-actions">
                  <button className="btn-ghost" onClick={() => { setBackupMode(null); setBackupText(""); }}><X size={13} /> Cancel</button>
                  <button className="btn-primary" onClick={handleRestore}><Save size={13} /> Restore backup</button>
                </div>
              </div>
            )}
            {backupMsg && <div className="form-note" style={{ marginBottom: 12 }}>{backupMsg}</div>}
          </div>
        </div>
      ) : tab === "habits" ? (
        <div className="habits-view">
          {/* Today's Checklist */}
          <div className="panel">
            <div className="panel-head">
              <div className="panel-title">Today's Habits<span className="dim">{formatMDY(new Date())}</span></div>
            </div>
            <div className="habit-grid">
              {HABITS.map(h => {
                const todayStr = formatMDY(new Date());
                const entry = habitLog.find(e => e.date === todayStr);
                const done = !!(entry && entry[h.key]);
                return (
                  <button key={h.key} className={"habit-btn" + (done ? " habit-done" : "")}
                    style={{ "--habit-color": h.color }}
                    onClick={() => toggleHabit(todayStr, h.key)}>
                    <span className="habit-btn-icon"><h.Icon size={22} /></span>
                    <span className="habit-btn-label">{h.label}</span>
                    <span className="habit-btn-check">{done ? <Check size={16} /> : <Circle size={14} />}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="panel">
            <div className="panel-head"><div className="panel-title">Streaks<span className="dim">consecutive weeks hitting target</span></div></div>
            <div className="habit-streaks">
              {HABITS.map(h => {
                const s = habitStreaks[h.key];
                const hitTarget = s.thisWeek >= s.target;
                return (
                  <div key={h.key} className="habit-streak-chip" style={{ borderColor: h.color + "55" }}>
                    <h.Icon size={13} style={{ color: h.color }} />
                    <span className="habit-streak-label">{h.label}</span>
                    <span className="habit-streak-this" style={{ color: hitTarget ? h.color : "var(--text-faint)" }}>
                      {s.thisWeek}/{s.target}
                    </span>
                    <span className="habit-streak-val" style={{ color: s.streak > 0 ? h.color : "var(--text-faint)" }}>
                      {s.streak}wk
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Progress chart */}
          <div className="panel">
            <div className="panel-head"><div className="panel-title">Last 4 Weeks<span className="dim">days completed per habit</span></div></div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={habitChartData} margin={{ top: 8, right: 8, left: -18, bottom: 8 }}>
                <CartesianGrid strokeDasharray="2 4" stroke={chartTheme.grid} vertical={false} />
                <XAxis dataKey="label" tick={{ fill: chartTheme.tick, fontSize: 10.9, fontFamily: chartTheme.font }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: chartTheme.tick, fontSize: 10.9, fontFamily: chartTheme.font }} axisLine={false} tickLine={false} domain={[0, 7]} ticks={[0,1,2,3,4,5,6,7]} />
                <Tooltip content={<CustomTooltip />} />
                {HABITS.map(h => <Bar key={h.key} dataKey={h.key} name={h.label} fill={h.color} radius={[3,3,0,0]} maxBarSize={18} />)}
              </BarChart>
            </ResponsiveContainer>
            <ChartLegend items={HABITS.map(h => ({ label: h.label, color: h.color, swatch: "box" }))} />
          </div>

          {/* History log */}
          <div className="panel">
            <div className="panel-head"><div className="panel-title">History<span className="dim">{habitLog.length} days logged</span></div></div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    {HABITS.map(h => <th key={h.key}>{h.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {habitLog.length === 0 && <tr><td colSpan={5} className="empty-row">No habits logged yet — check off today's habits above.</td></tr>}
                  {[...habitLog].sort((a, b) => (parseDate(b.date)?.getTime() ?? 0) - (parseDate(a.date)?.getTime() ?? 0)).map((e, i) => (
                    <tr key={i}>
                      <td>{e.date}</td>
                      {HABITS.map(h => (
                        <td key={h.key}>
                          {e[h.key]
                            ? <Check size={13} style={{ color: h.color }} />
                            : <span style={{ color: "var(--text-faint)" }}>–</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : tab === "daily" ? (
        <div className="daily-view">
          <div className="panel pacing-panel">
            <div className="panel-head">
              <div className="panel-title">This Week's Pacing<span className="dim">{formatMDY(pacing.blockStart)} – {formatMDY(pacing.blockEnd)} · {pacing.daysRemaining} day{pacing.daysRemaining === 1 ? "" : "s"} left</span></div>
            </div>
            <div className="pacing-grid">
              <div className={"pacing-card" + (pacing.calStatus === "behind" || pacing.calStatus === "over" ? " pacing-card-bad" : pacing.calStatus === "ahead" ? " pacing-card-good" : "")}>
                <div className="pacing-card-label"><Flame size={13} /> Calories</div>
                {pacing.calGoal == null ? (
                  <div className="pacing-empty">No calorie goal set for this phase yet.</div>
                ) : pacing.recCal == null ? (
                  <div className="pacing-empty">—</div>
                ) : (
                  <>
                    <div className="pacing-value">
                      {pacing.recCal.toLocaleString()} <span className="pacing-unit">/day</span>
                    </div>
                    <div className="pacing-sub">
                      {pacing.calStatus === "over" && "You're already over budget for the week — the math wants a negative number. Consider a lighter day or accept the overage."}
                      {pacing.calStatus === "ahead" && `You're under pace — you can eat more than your usual ${pacing.calGoal}/day and still hit the weekly average.`}
                      {pacing.calStatus === "behind" && `Tighter than usual: eat less than your normal ${pacing.calGoal}/day to bring the week back to target.`}
                    </div>
                    <div className="pacing-footnote">{pacing.calDaysLogged} day{pacing.calDaysLogged === 1 ? "" : "s"} logged so far this block</div>
                  </>
                )}
              </div>
              <div className={"pacing-card" + (pacing.stepStatus === "ahead" ? " pacing-card-good" : pacing.stepStatus === "behind" ? " pacing-card-bad" : "")}>
                <div className="pacing-card-label"><Footprints size={13} /> Steps</div>
                {pacing.stepGoal == null ? (
                  <div className="pacing-empty">No step goal set for this phase yet.</div>
                ) : pacing.recSteps == null ? (
                  <div className="pacing-empty">—</div>
                ) : (
                  <>
                    <div className="pacing-value">
                      {pacing.recSteps.toLocaleString()} <span className="pacing-unit">/day</span>
                    </div>
                    <div className="pacing-sub">
                      {pacing.stepStatus === "behind"
                        ? `Behind pace: walk more than your usual ${pacing.stepGoal.toLocaleString()}/day for the rest of the block.`
                        : `Ahead of pace — ${pacing.stepGoal.toLocaleString()}/day or less gets you there.`}
                    </div>
                    <div className="pacing-footnote">{pacing.stepDaysLogged} day{pacing.stepDaysLogged === 1 ? "" : "s"} logged so far this block</div>
                  </>
                )}
              </div>
            </div>

            <div className="block-checklist">
              <div className="block-checklist-label">Days logged this block</div>
              <div className="block-checklist-row">
                {pacing.blockDays.map((d, i) => (
                  <div key={i} className={"check-day " + (d.logged ? "logged" : d.isFuture ? "future" : "missing") + (d.isToday ? " today" : "")}
                    title={`${d.label} ${d.dateStr}${d.logged ? " — logged" : d.isFuture ? " — upcoming" : " — not logged yet"}`}
                    onClick={() => !d.isFuture && (d.entry ? openEditDaily(d.entry) : openAddDaily(d.dateStr))}>
                    {d.logged ? <Check size={12} /> : <Circle size={9} />}
                    <span className="check-day-label">{d.label}</span>
                  </div>
                ))}
              </div>
              <div className="block-checklist-hint">Tap a missing day to backfill it — the date field takes any past date, so it's fine to catch up late.</div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <div className="panel-title">Daily Log<span className="dim">{mergedDailyEntries.length} days logged</span></div>
              <div className="panel-head-actions">
                <button className="btn-primary sm" onClick={handleSyncWithings} disabled={withingsSyncing}>
                  <RefreshCw size={13} className={withingsSyncing ? "spin" : ""} /> Withings
                </button>
                <button className="btn-primary sm" onClick={() => openAddDaily()} disabled={dailySaving}>
                  {dailySaving ? <Loader2 size={13} className="spin" /> : <Plus size={13} />} Log
                </button>
              </div>
            </div>

            {dailyErrMsg && <div className="banner-error"><AlertCircle size={13} /> {dailyErrMsg}</div>}
            {withingsMsg && <div className="banner-error"><AlertCircle size={13} /> {withingsMsg}</div>}

            {dailyFormOpen && (
              <DailyEntryForm form={dailyForm} setForm={setDailyForm} isEdit={dailyEditIndex != null} error={dailyFormErr}
                onCancel={() => { setDailyFormOpen(false); setDailyEditIndex(null); setDailyFormErr(""); }}
                onSave={handleSaveDaily} />
            )}

            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Date</th><th>Calories</th><th>Steps</th><th>Weight</th><th>Fat Mass</th><th>Muscle Mass</th><th></th></tr>
                </thead>
                <tbody>
                  {mergedDailyEntries.length === 0 && (
                    <tr><td colSpan={7} className="empty-row">No days logged yet — click "Log" to start.</td></tr>
                  )}
                  {[...mergedDailyEntries]
                    .map((d, i) => ({ ...d, _i: i, _d: parseDate(d.date) }))
                    .sort((a, b) => (b._d?.getTime() ?? 0) - (a._d?.getTime() ?? 0))
                    .map((d) => {
                      const inBlock = d._d && d._d >= pacing.blockStart && d._d <= pacing.blockEnd;
                      return (
                        <tr key={d._i} className={d._synced ? "row-synced" : ""}>
                          <td>
                            {d.date}
                            {inBlock && <span className="this-block-tag">this block</span>}
                            {d._synced && <span className="synced-tag" title="Synced from HealthKit"><Watch size={10} /> synced</span>}
                          </td>
                          <td>{fmtNum(d.cal)}</td>
                          <td>{fmtNum(d.steps)}</td>
                          <td>{fmtNum(d.weight)}</td>
                          <td>{fmtNum(d.fatMass)}</td>
                          <td>{fmtNum(d.muscleMass)}</td>
                          <td className="row-actions">
                            <button className="icon-btn" onClick={() => openEditDaily(d)} title="Edit"><Pencil size={12} /></button>
                            <DeleteBtn id={`daily-${d._i}`} onDelete={() => (d._synced ? handleDeleteSynced(d) : handleDeleteDaily(d))} />
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="footer-note">
            This tab and its pacing math run entirely on their own — daily calories/steps here don't feed into the Weekly Log, charts, or top dashboard buckets. Those stay driven by whatever you enter manually in the weekly Add/Edit form.
          </div>
        </div>
      ) : (
      <>
      {(pacing.calGoal != null || pacing.stepGoal != null) && (
        <div className="pacing-mini">
          <div className="pacing-mini-head">
            <span><Flame size={12} /> This week's pacing · {pacing.daysRemaining}d left</span>
          </div>
          <div className="pacing-mini-row">
            {pacing.calGoal != null && pacing.recCal != null && (() => {
              const bad = pacing.calStatus === "over" || pacing.calStatus === "behind";
              return (
                <span className={"pacing-mini-item " + (bad ? "pacing-status-bad" : "pacing-status-good")}>
                  Calories: <strong className={bad ? "cell-bad" : "cell-good"}>{pacing.recCal.toLocaleString()}/day</strong>
                </span>
              );
            })()}
            {pacing.stepGoal != null && pacing.recSteps != null && (() => {
              const bad = pacing.stepStatus === "behind";
              return (
                <span className={"pacing-mini-item " + (bad ? "pacing-status-bad" : "pacing-status-good")}>
                  Steps: <strong className={bad ? "cell-bad" : "cell-good"}>{pacing.recSteps.toLocaleString()}/day</strong>
                </span>
              );
            })()}
          </div>
        </div>
      )}

      <PhaseTimeline all={resolvedEntries} trackedCount={ACTUAL.length} derailedDates={derailedDates} />

      <div className="stat-grid">
        <StatCard icon={Scale} label="Weight" value={fmtNum(latest.aW)} unit="lb"
          sub={weightChange != null ? `${weightChange > 0 ? "+" : ""}${fmtNum(weightChange, 1)} lb since start` : null}
          trend={weightChange == null ? null : weightChange < 0 ? "down" : weightChange > 0 ? "up" : "flat"}
          accent={PHASE_COLOR.Cut} badge={mkBadge(bucketAlert(weightStreak), "bad")} />
        <StatCard icon={Percent} label="Body Fat" value={fmtNum(latest.aBF)} unit="%"
          sub={bestBF?.aBF != null ? `best ${fmtNum(bestBF.aBF)}% (wk ${bestBF.wk})` : null}
          trend={bestBF && latest.aBF > bestBF.aBF ? "up" : "flat"}
          accent={PHASE_COLOR.Derailed} badge={mkBadge(bucketAlert(fatStreak), "bad")} />
        <StatCard icon={TrendingDown} label="Fat Mass" value={fmtNum(latest.aF)} unit="lb"
          sub={fatMassChange != null ? `${fatMassChange > 0 ? "+" : ""}${fmtNum(fatMassChange, 1)} lb since start` : null}
          trend={fatMassChange == null ? null : fatMassChange < 0 ? "down" : fatMassChange > 0 ? "up" : "flat"}
          accent={PHASE_COLOR.Derailed} badge={mkBadge(onTrackStreak, "good")} />
        <StatCard icon={TrendingUp} label="Muscle Mass" value={fmtNum(latest.aM)} unit="lb"
          sub={muscleChange != null ? `${muscleChange > 0 ? "+" : ""}${fmtNum(muscleChange, 1)} lb since start` : null}
          trend={muscleChange == null ? null : muscleChange > 0 ? "up" : muscleChange < 0 ? "down" : "flat"}
          accent={PHASE_COLOR.Maintain} badge={mkBadge(muscleStreak, muscleStreak >= 3 ? "bad" : "warn")} />
        <StatCard icon={Flame} label="Calories" value={fmtNum(latest.aCal)} unit=""
          sub={latest.tCal != null && latest.aCal != null
            ? <>target {fmtNum(latest.tCal)} · <span className={latest.aCal <= latest.tCal ? "cell-good" : "cell-bad"}>{latest.aCal - latest.tCal > 0 ? "+" : ""}{fmtNum(latest.aCal - latest.tCal)} kcal</span></>
            : (avgCal != null ? `${calData.length}wk avg ${fmtNum(avgCal)}` : null)}
          accent={PHASE_COLOR.Gain} badge={mkBadge(bucketAlert(calStreak), "bad")} />
        <StatCard icon={Footprints} label="Steps" value={fmtNum(latest.steps)} unit=""
          sub={latest.tSteps != null && latest.steps != null
            ? <>goal {fmtNum(latest.tSteps)} · <span className={latest.steps >= latest.tSteps ? "cell-good" : "cell-bad"}>{latest.steps - latest.tSteps > 0 ? "+" : ""}{fmtNum(latest.steps - latest.tSteps)}</span></>
            : (avgSteps != null ? `${stepsData.length}wk avg ${fmtNum(avgSteps)}` : null)}
          accent="#8b8f9c" badge={mkBadge(bucketAlert(stepsStreak), "bad")} />
      </div>

      <div className="panel">
        <div className="panel-head">
          <div className="panel-title">Weight & Body Fat<span className="dim">actual vs. target</span></div>
          <div className="panel-head-actions panel-head-actions-stack">
            <div className="toggle-group">
              <button className={"toggle-btn " + (range === "tracked" ? "active" : "")} onClick={() => setRange("tracked")}>TRACKED</button>
              <button className={"toggle-btn " + (range === "full" ? "active" : "")} onClick={() => setRange("full")}>+ ROADMAP</button>
            </div>
            <SeriesToggle
              items={[
                { key: "weight", label: "WEIGHT" },
                { key: "bodyFat", label: "BODY FAT" },
                { key: "targets", label: "TARGETS" },
              ]}
              active={wbfVisible}
              onToggle={(key) => setWbfVisible((v) => ({ ...v, [key]: !v[key] }))}
            />
          </div>
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={chartData} margin={{ top: 8, right: 4, left: 4, bottom: 12 }}>
            <CartesianGrid strokeDasharray="2 4" stroke={chartTheme.grid} vertical={false} />
            {derailedSegments.map((s, i) => (
              <ReferenceArea key={i} x1={s.x1} x2={s.x2} yAxisId="w" fill="var(--bad)" fillOpacity={0.1} stroke="var(--bad)" strokeOpacity={0.25} />
            ))}
            <XAxis dataKey="label" tick={{ fill: chartTheme.tick, fontSize: 9.5, fontFamily: chartTheme.font }} axisLine={{ stroke: chartTheme.grid }} tickLine={false} interval={range === "full" ? 3 : 1} angle={-35} textAnchor="end" height={40} />
            <YAxis yAxisId="w" width={34} tick={{ fill: chartTheme.tick, fontSize: 10, fontFamily: chartTheme.font }} axisLine={false} tickLine={false} domain={["dataMin - 2", "dataMax + 2"]} />
            <YAxis yAxisId="bf" orientation="right" width={30} tick={{ fill: chartTheme.tick, fontSize: 10, fontFamily: chartTheme.font }} axisLine={false} tickLine={false} domain={["dataMin - 1", "dataMax + 1"]} />
            <Tooltip content={<CustomTooltip />} />
            <Line yAxisId="w" type="monotone" dataKey="aW" name="Weight (actual)" stroke={chartTheme.ink} strokeWidth={2} dot={{ r: 2.5, fill: chartTheme.ink }} connectNulls hide={!wbfVisible.weight} />
            <Line yAxisId="w" type="monotone" dataKey="tW" name="Weight (target)" stroke="#5b8dee" strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls hide={!wbfVisible.targets} />
            <Line yAxisId="bf" type="monotone" dataKey="aBF" name="Body Fat % (actual)" stroke="#c4534a" strokeWidth={2} dot={{ r: 2.5, fill: "#c4534a" }} connectNulls hide={!wbfVisible.bodyFat} />
            <Line yAxisId="bf" type="monotone" dataKey="tBF" name="Body Fat % (target)" stroke="#dba236" strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls hide={!wbfVisible.targets} />
          </ComposedChart>
        </ResponsiveContainer>
        <ChartLegend items={[
          ...(wbfVisible.weight ? [{ label: "Weight (actual)", color: chartTheme.ink, swatch: "box" }] : []),
          ...(wbfVisible.targets ? [{ label: "Weight (target)", color: "#5b8dee", swatch: "dash" }] : []),
          ...(wbfVisible.bodyFat ? [{ label: "BF% (actual)", color: "#c4534a", swatch: "box" }] : []),
          ...(wbfVisible.targets ? [{ label: "BF% (target)", color: "#dba236", swatch: "dash" }] : []),
          ...(derailedSegments.length > 0 ? [{ label: "derailed weeks", swatch: "shade" }] : []),
        ]} />
      </div>

      <div className="row-2">
        <div className="panel">
          <div className="panel-head"><div className="panel-title">Calories<span className="dim">actual vs. target</span></div></div>
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={ACTUAL} margin={{ top: 8, right: 8, left: -18, bottom: 12 }}>
              <CartesianGrid strokeDasharray="2 4" stroke={chartTheme.grid} vertical={false} />
              <XAxis dataKey="date" tick={{ fill: chartTheme.tick, fontSize: 9.5, fontFamily: chartTheme.font }} axisLine={{ stroke: chartTheme.grid }} tickLine={false} angle={-35} textAnchor="end" height={40} />
              <YAxis tick={{ fill: chartTheme.tick, fontSize: 10, fontFamily: chartTheme.font }} axisLine={false} tickLine={false} tickFormatter={(v) => fmtNum(v)} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="aCal" name="Actual" radius={[3, 3, 0, 0]}>
                {ACTUAL.map((r, i) => (
                  <Cell key={i} fill={calBarColor(r.aCal, r.tCal)} />
                ))}
              </Bar>
              <Line type="monotone" dataKey="tCal" name="Target" stroke={chartTheme.ink} strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
          <ChartLegend items={[
            { label: "at/under target", color: "var(--bar-good)", swatch: "box" },
            { label: "over target", color: "var(--bar-bad)", swatch: "box" },
            { label: "no target set", color: "#5b8dee", swatch: "box" },
            { label: "target", color: chartTheme.ink, swatch: "dash" },
          ]} />
        </div>
        <div className="panel">
          <div className="panel-head"><div className="panel-title">Steps<span className="dim">actual vs. goal</span></div></div>
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={ACTUAL} margin={{ top: 8, right: 8, left: -18, bottom: 12 }}>
              <CartesianGrid strokeDasharray="2 4" stroke={chartTheme.grid} vertical={false} />
              <XAxis dataKey="date" tick={{ fill: chartTheme.tick, fontSize: 9.5, fontFamily: chartTheme.font }} axisLine={{ stroke: chartTheme.grid }} tickLine={false} angle={-35} textAnchor="end" height={40} />
              <YAxis tick={{ fill: chartTheme.tick, fontSize: 10, fontFamily: chartTheme.font }} axisLine={false} tickLine={false} tickFormatter={(v) => fmtNum(v)} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="steps" name="Steps" radius={[3, 3, 0, 0]}>
                {ACTUAL.map((r, i) => (
                  <Cell key={i} fill={stepsBarColor(r.steps, r.tSteps)} />
                ))}
              </Bar>
              <Line type="monotone" dataKey="tSteps" name="Step goal" stroke={chartTheme.ink} strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
          <ChartLegend items={[
            { label: "at/over goal", color: "var(--bar-good)", swatch: "box" },
            { label: "under goal", color: "var(--bar-bad)", swatch: "box" },
            { label: "no goal set", color: "#5b8dee", swatch: "box" },
            { label: "step goal", color: chartTheme.ink, swatch: "dash" },
          ]} />
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div className="panel-title">Muscle vs. Fat<span className="dim">actual vs. target, lb</span></div>
          <div className="panel-head-actions">
            <SeriesToggle
              items={[
                { key: "muscle", label: "MUSCLE" },
                { key: "fat", label: "FAT" },
                { key: "targets", label: "TARGETS" },
              ]}
              active={mvfVisible}
              onToggle={(key) => setMvfVisible((v) => ({ ...v, [key]: !v[key] }))}
            />
          </div>
        </div>
        <ResponsiveContainer width="100%" height={190}>
          <ComposedChart data={chartData} margin={{ top: 8, right: 4, left: 4, bottom: 12 }}>
            <defs>
              <linearGradient id="mGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#4caf7d" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#4caf7d" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="2 4" stroke={chartTheme.grid} vertical={false} />
            {derailedSegments.map((s, i) => (
              <ReferenceArea key={i} x1={s.x1} x2={s.x2} yAxisId="m" fill="var(--bad)" fillOpacity={0.1} stroke="var(--bad)" strokeOpacity={0.25} />
            ))}
            <XAxis dataKey="label" tick={{ fill: chartTheme.tick, fontSize: 9.5, fontFamily: chartTheme.font }} axisLine={{ stroke: chartTheme.grid }} tickLine={false} interval={range === "full" ? 3 : 1} angle={-35} textAnchor="end" height={40} />
            <YAxis yAxisId="m" width={34} tick={{ fill: chartTheme.tick, fontSize: 10, fontFamily: chartTheme.font }} axisLine={false} tickLine={false} domain={["dataMin - 1", "dataMax + 1"]} />
            <YAxis yAxisId="f" orientation="right" width={30} tick={{ fill: chartTheme.tick, fontSize: 10, fontFamily: chartTheme.font }} axisLine={false} tickLine={false} domain={["dataMin - 1", "dataMax + 1"]} />
            <Tooltip content={<CustomTooltip />} />
            <Area yAxisId="m" type="monotone" dataKey="aM" name="Muscle (actual)" stroke="#4caf7d" fill="url(#mGrad)" strokeWidth={2} connectNulls hide={!mvfVisible.muscle} />
            <Line yAxisId="m" type="monotone" dataKey="tM" name="Muscle (target)" stroke="#dba236" strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls hide={!mvfVisible.targets} />
            <Line yAxisId="f" type="monotone" dataKey="aF" name="Fat (actual)" stroke="#c4534a" strokeWidth={2} dot={{ r: 2.5, fill: "#c4534a" }} connectNulls hide={!mvfVisible.fat} />
            <Line yAxisId="f" type="monotone" dataKey="tF" name="Fat (target)" stroke="#5b8dee" strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls hide={!mvfVisible.targets} />
          </ComposedChart>
        </ResponsiveContainer>
        <ChartLegend items={[
          ...(mvfVisible.muscle ? [{ label: "Muscle (actual)", color: "#4caf7d", swatch: "box" }] : []),
          ...(mvfVisible.targets ? [{ label: "Muscle (target)", color: "#dba236", swatch: "dash" }] : []),
          ...(mvfVisible.fat ? [{ label: "Fat (actual)", color: "#c4534a", swatch: "box" }] : []),
          ...(mvfVisible.targets ? [{ label: "Fat (target)", color: "#5b8dee", swatch: "dash" }] : []),
          ...(derailedSegments.length > 0 ? [{ label: "derailed weeks", swatch: "shade" }] : []),
        ]} />
      </div>

      <div className="panel">
        <div className="panel-head">
          <div className="panel-title">Weekly Log<span className="dim">{entries.length} entries · {ACTUAL.length} with actuals · generated from Goal Settings</span></div>
          {saving && <span className="saving-note"><Loader2 size={12} className="spin" /> Saving…</span>}
        </div>

        {formOpen && (
          <EntryForm form={form} setForm={setForm} isEdit={editIndex != null} error={formErr}
            onCancel={() => { setFormOpen(false); setEditIndex(null); setFormErr(""); }}
            onSave={handleSave} />
        )}

        <div className="table-wrap">
          <table>
            <thead className="hidden-thead">
              <tr>
                <th>Week</th><th>Date</th><th className="phase-col">Phase</th>
                <th>Target Wt</th><th>Weight</th>
                <th>Target Musc</th><th>Muscle</th>
                <th>Target Fat</th><th>Fat</th>
                <th>Tgt Fat Adj</th><th>Act Fat Adj</th>
                <th>Target BF%</th><th>BF%</th>
                <th>Target Cal</th><th>Cal</th>
                <th>Target Steps</th><th>Steps</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {logGroups.map((g) => {
                const collapsed = !!collapsedGroups[g.id];
                return (
                  <React.Fragment key={g.id}>
                    <tr className={"group-row " + rowPhaseClass(g.phase)} onClick={() => toggleGroup(g.id)}>
                      <td className="group-cell" colSpan={18}>
                        <div className="group-head">
                          <span className="group-caret">{collapsed ? "▸" : "▾"}</span>
                          <span className="phase-tag" style={{ background: phaseColor(g.phase) + "22", color: phaseColor(g.phase) }}>{phaseLabel(g.phase)}</span>
                          <span className="group-span">{g.dateSpan}</span>
                          {g.loggedCount > 0 ? (
                            <span className="group-stats">
                              {g.singleEntry ? (
                                <>
                                  {g.singleEntry.aW != null && <span className="gstat" style={{ borderColor: phaseColor(g.phase) + "66" }}><span className="gstat-label">Weight</span><span className="gstat-val">{fmtNum(g.singleEntry.aW)} lb</span></span>}
                                  {g.singleEntry.aM != null && <span className="gstat" style={{ borderColor: phaseColor(g.phase) + "66" }}><span className="gstat-label">Muscle</span><span className="gstat-val">{fmtNum(g.singleEntry.aM)} lb</span></span>}
                                  {g.singleEntry.aF != null && <span className="gstat" style={{ borderColor: phaseColor(g.phase) + "66" }}><span className="gstat-label">Fat Mass</span><span className="gstat-val">{fmtNum(g.singleEntry.aF)} lb</span></span>}
                                  {g.singleEntry.aBF != null && <span className="gstat" style={{ borderColor: phaseColor(g.phase) + "66" }}><span className="gstat-label">Body Fat %</span><span className="gstat-val">{fmtNum(g.singleEntry.aBF)}%</span></span>}
                                  {g.singleEntry.aCal != null && <span className="gstat" style={{ borderColor: phaseColor(g.phase) + "66" }}><span className="gstat-label">Avg Cal</span><span className="gstat-val">{fmtNum(g.singleEntry.aCal)}</span></span>}
                                  {g.singleEntry.steps != null && <span className="gstat" style={{ borderColor: phaseColor(g.phase) + "66" }}><span className="gstat-label">Avg Steps</span><span className="gstat-val">{fmtNum(g.singleEntry.steps)}</span></span>}
                                </>
                              ) : (
                                <>
                                  {g.wtChange != null && (
                                    <span className="gstat" style={{ borderColor: phaseColor(g.phase) + "66" }}>
                                      <span className="gstat-label">Weight</span>
                                      <span className={"gstat-val " + (g.wtChange < 0 ? "gstat-down" : g.wtChange > 0 ? "gstat-up" : "")}>{g.wtChange > 0 ? "+" : ""}{g.wtChange} lb</span>
                                      {g.wtRate != null && <span className="gstat-rate">{g.wtRate > 0 ? "+" : ""}{g.wtRate}/wk</span>}
                                    </span>
                                  )}
                                  {g.muscleChange != null && (
                                    <span className="gstat" style={{ borderColor: phaseColor(g.phase) + "66" }}>
                                      <span className="gstat-label">Muscle</span>
                                      <span className={"gstat-val " + (g.muscleChange > 0 ? "gstat-down" : g.muscleChange < 0 ? "gstat-up" : "")}>{g.muscleChange > 0 ? "+" : ""}{g.muscleChange} lb</span>
                                      {g.muscleRate != null && <span className="gstat-rate">{g.muscleRate > 0 ? "+" : ""}{g.muscleRate}/wk</span>}
                                    </span>
                                  )}
                                  {g.fatLbChange != null && (
                                    <span className="gstat" style={{ borderColor: phaseColor(g.phase) + "66" }}>
                                      <span className="gstat-label">Fat Mass</span>
                                      <span className={"gstat-val " + (g.fatLbChange < 0 ? "gstat-down" : g.fatLbChange > 0 ? "gstat-up" : "")}>{g.fatLbChange > 0 ? "+" : ""}{g.fatLbChange} lb</span>
                                      {g.fatLbRate != null && <span className="gstat-rate">{g.fatLbRate > 0 ? "+" : ""}{g.fatLbRate}/wk</span>}
                                    </span>
                                  )}
                                  {g.bfChange != null && (
                                    <span className="gstat" style={{ borderColor: phaseColor(g.phase) + "66" }}>
                                      <span className="gstat-label">Body Fat %</span>
                                      <span className={"gstat-val " + (g.bfChange < 0 ? "gstat-down" : g.bfChange > 0 ? "gstat-up" : "")}>{g.bfChange > 0 ? "+" : ""}{g.bfChange}%</span>
                                    </span>
                                  )}
                                  {g.avgCal != null && (
                                    <span className="gstat" style={{ borderColor: phaseColor(g.phase) + "66" }}>
                                      <span className="gstat-label">Avg Cal</span>
                                      <span className="gstat-val">{g.avgCal.toLocaleString()}</span>
                                    </span>
                                  )}
                                  {g.avgSteps != null && (
                                    <span className="gstat" style={{ borderColor: phaseColor(g.phase) + "66" }}>
                                      <span className="gstat-label">Avg Steps</span>
                                      <span className="gstat-val">{g.avgSteps.toLocaleString()}</span>
                                    </span>
                                  )}
                                </>
                              )}
                            </span>
                          ) : (
                            <span className="group-stats">
                              {["Weight", "Muscle", "Fat Mass", "Body Fat %", "Avg Cal", "Avg Steps"].map(lbl => (
                                <span key={lbl} className="gstat gstat-empty" style={{ borderColor: phaseColor(g.phase) + "44" }}>
                                  <span className="gstat-label">{lbl}</span>
                                  <span className="gstat-val gstat-placeholder">–</span>
                                </span>
                              ))}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                    {!collapsed && (
                      <tr className="group-colhead">
                        <td>Week</td><td>Date</td><td className="phase-col">Phase</td>
                        <td>Target Wt</td><td>Weight</td>
                        <td>Target Musc</td><td>Muscle</td>
                        <td>Target Fat</td><td>Fat</td>
                        <td>Tgt Fat Adj</td><td>Act Fat Adj</td>
                        <td>Target BF%</td><td>BF%</td>
                        <td>Target Cal</td><td>Cal</td>
                        <td>Target Steps</td><td>Steps</td>
                        <td></td>
                      </tr>
                    )}
                    {!collapsed && g.rows.map((r) => (
                      <tr key={r._idx} className={rowPhaseClass(r.phase) + (r._generated ? " row-generated" : "") + (derailedDates.has(r.date) ? " row-derail-hist" : "")}>
                        <td>{r.wk}</td>
                        <td>{r.date}</td>
                        <td className="phase-col">
                          {derailedDates.has(r.date) ? (
                            <span className="phase-tag" style={{ background: PHASE_COLOR.Derailed + "22", color: PHASE_COLOR.Derailed }}>Derail</span>
                          ) : (
                            <span className="phase-tag" style={{ background: phaseColor(r.phase) + "22", color: phaseColor(r.phase) }}>{r.phase}</span>
                          )}
                        </td>
                        <td className="target-cell">{fmtNum(r.tW)}</td>
                        <td className={cellClass("weight", r.aW, r.tW)}>{fmtNum(r.aW)}</td>
                        <td className="target-cell">{fmtNum(r.tM)}</td>
                        <td className={cellClass("muscle", r.aM, r.tM)}>{fmtNum(r.aM)}</td>
                        <td className="target-cell">{fmtNum(r.tF)}</td>
                        <td className={cellClass("fat", r.aF, r.tF)}>{fmtNum(r.aF)}</td>
                        <td className="target-cell">{r.tFatAdj != null ? `${r.tFatAdj > 0 ? "+" : ""}${fmtNum(r.tFatAdj)}` : "–"}</td>
                        <td className={"adj-cell " + (r.aFatAdj != null && r.tFatAdj != null ? (r.aFatAdj <= r.tFatAdj ? "cell-good" : "cell-bad") : "")}>{r.aFatAdj != null ? `${r.aFatAdj > 0 ? "+" : ""}${fmtNum(r.aFatAdj)}` : "–"}</td>
                        <td className="target-cell">{r.tBF != null ? `${fmtNum(r.tBF)}%` : "–"}</td>
                        <td className={cellClass("bf", r.aBF, r.tBF)}>{r.aBF != null ? `${fmtNum(r.aBF)}%` : "–"}</td>
                        <td className="target-cell">{fmtNum(r.tCal)}</td>
                        <td className={cellClass("calories", r.aCal, r.tCal)}>{fmtNum(r.aCal)}</td>
                        <td className="target-cell">{fmtNum(r.tSteps)}</td>
                        <td className={cellClass("steps", r.steps, r.tSteps)}>{fmtNum(r.steps)}</td>
                        <td className="row-actions">
                          {r.notes && (
                            <button className="icon-btn note-btn" title="View note"
                              onClick={() => setNoteOpen({ title: `Week ${r.wk} · ${r.date}`, text: r.notes })}>
                              <StickyNote size={12} />
                            </button>
                          )}
                          {r._generated ? (
                            <button className="icon-btn fill-btn" title="Log this week" onClick={() => openFill(r.date)}><Plus size={12} /></button>
                          ) : (
                            <>
                              <button className="icon-btn" onClick={() => openEdit(r._realIdx)} title="Edit"><Pencil size={12} /></button>
                              <DeleteBtn id={`entry-${r._realIdx}`} onDelete={() => handleDelete(r._realIdx)} />
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="footer-note">
        Target weight/muscle/fat/BF% are calculated automatically from your Goal Settings rates — no manual entry needed. Data lives in this artifact's private storage; nobody else can see it.
      </div>
      </>
      )}

      {noteOpen && (
        <div className="note-overlay" onClick={() => setNoteOpen(null)}>
          <div className="note-pop" onClick={(e) => e.stopPropagation()}>
            <div className="note-pop-head">
              <span>{noteOpen.title}</span>
              <button className="icon-btn" onClick={() => setNoteOpen(null)} title="Close"><X size={12} /></button>
            </div>
            <div className="note-pop-body">{noteOpen.text}</div>
          </div>
        </div>
      )}
    </div>
  );
}

const BASE_STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap');

  .dash {
    --bg: #f7f7f4; --panel: #ffffff; --panel-2: #f1f0eb; --border: #e7e6e0;
    --text: #16181d; --text-dim: #5d6167; --text-faint: #8f939b;
    --cut: #5b8dee; --derailed: #c4534a; --maintain: #4caf7d; --gain: #dba236;
    --good: #368727; --bad: #c73a2f;
    --bar-good: #7fb46e; --bar-bad: #d4867c;
    font-family: 'Inter', sans-serif; background: var(--bg); color: var(--text);
    padding: 28px 24px 40px; border-radius: 16px; width: 100%; max-width: 1900px; margin: 0 auto; box-sizing: border-box;
  }
  .dash * { box-sizing: border-box; }
  .dash-loading { display: flex; align-items: center; justify-content: center; gap: 10px; height: 240px; color: var(--text-dim); font-family: 'JetBrains Mono', monospace; font-size: 14.9px; }
  .pull-refresh { display: flex; align-items: center; justify-content: center; overflow: hidden; color: var(--good); }
  .spin { animation: spin 0.9s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  .empty-state { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 60px 20px; color: var(--text-dim); font-family: 'JetBrains Mono', monospace; font-size: 14.9px; }

  .banner-error { display: flex; align-items: center; gap: 8px; background: #3a2418; border: 1px solid #6b4526; color: #f0c199; padding: 8px 12px; border-radius: 8px; font-size: 13.8px; font-family: 'JetBrains Mono', monospace; margin-bottom: 14px; }

  .banner-alert { display: flex; align-items: center; gap: 12px; padding: 24px 20px; min-height: 88px; border-radius: 10px; margin-bottom: 14px; font-family: 'Inter', sans-serif; font-size: 17.8px; line-height: 1.5; }
  .banner-alert strong { font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 19.5px; }
  .banner-alert.slipping { background: #341616; border: 1px solid #7a2e2e; color: #f0b0ac; }
  .banner-alert.slipping svg { color: var(--bad); flex-shrink: 0; }
  .banner-alert.derailed { background: #341616; border: 1px solid #7a2e2e; color: #f0b0ac; }
  .banner-alert.derailed svg { color: var(--bad); flex-shrink: 0; }
  .banner-alert-text { flex: 1; }
  .banner-ontrack { display: flex; align-items: center; gap: 9px; padding: 10px 14px; border-radius: 12px; margin-bottom: 14px; font-family: 'Inter', sans-serif; font-size: 13px; background: #eef6ea; border: 1px solid #cfe6c4; color: #3a6b2c; }
  .banner-ontrack svg { flex-shrink: 0; color: #4a8a35; }
  .notif-stack { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
  .notif-row { display: flex; align-items: center; gap: 9px; padding: 8px 13px; border-radius: 10px; font-family: 'Inter', sans-serif; font-size: 12.5px; }
  .notif-row.notif-warn { background: #fdf1dd; border: 1px solid #ecd3a4; color: #8a5b13; }
  .notif-row.notif-warn .notif-icon { color: #b07d17; }
  .notif-row.notif-warn .notif-msg { color: #9a6b1e; }
  .notif-row.notif-alert { background: #fcebe9; border: 1px solid #eec4be; color: #a03d33; }
  .notif-row.notif-alert .notif-icon { color: #c73a2f; }
  .notif-row.notif-alert .notif-msg { color: #b1483c; }
  .notif-icon { display: inline-flex; flex-shrink: 0; }
  .notif-metric { font-weight: 700; }
  .notif-weeks { display: inline-flex; align-items: center; vertical-align: middle; flex-shrink: 0; background: var(--bad); color: #ffffff; font-family: 'Inter', sans-serif; font-size: 11px; font-weight: 700; letter-spacing: 0.02em; padding: 2px 9px; border-radius: 999px; }
  .notif-row.notif-warn .notif-weeks { background: #b07d17; }
  .notif-weeks.ontrack-pill { background: #368727; }

  .recovery { margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.14); display: flex; flex-direction: column; gap: 9px; }
  .rec-trend { display: flex; align-items: center; gap: 7px; font-size: 13.5px; font-weight: 600; }
  .rec-trend.rec-good { color: var(--good); }
  .rec-trend.rec-bad { color: var(--bad); }
  .rec-trend.rec-flat { opacity: 0.85; }
  .rec-trend svg { flex-shrink: 0; }
  .rec-plan { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; font-size: 12.5px; }
  .rec-plan-label { font-weight: 600; opacity: 0.9; }
  .rec-chip { font-family: 'JetBrains Mono', monospace; font-size: 12px; font-weight: 600; padding: 3px 10px; border-radius: 999px; background: rgba(255,255,255,0.16); }

  .header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 14px; margin-bottom: 14px; }
  .header-top { display: flex; justify-content: space-between; align-items: flex-start; width: 100%; gap: 12px; }
  .header-meta { display: flex; flex-direction: column; align-items: flex-end; gap: 5px; margin-top: 4px; font-family: 'JetBrains Mono', monospace; font-size: 13.8px; color: var(--text-dim); }
  .header-meta-row { display: flex; align-items: center; gap: 8px; }
  .header-meta .phase-pill { padding: 6px 14px; border-radius: 8px; font-size: 13px; letter-spacing: 0.08em; font-weight: 600; }
  .header-sub { font-size: 11.5px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-faint); }

  .hero-card { display: none; align-items: stretch; gap: 8px; margin-left: auto; background: var(--panel); border-radius: 16px; padding: 8px; }
  .hero-w { display: flex; flex-direction: column; align-items: flex-end; justify-content: center; padding: 6px 10px; }
  .hero-bf { display: flex; flex-direction: column; align-items: flex-end; justify-content: center; padding: 8px 14px; border-radius: 11px; background: var(--panel-2); }
  .hero-bf.good { background: rgba(76, 175, 125, 0.16); }
  .hero-bf.good .hero-num, .hero-bf.good .hero-lbl, .hero-bf.good .hero-unit { color: var(--good); }
  .hero-bf.bad { background: rgba(217, 105, 95, 0.16); }
  .hero-bf.bad .hero-num, .hero-bf.bad .hero-lbl, .hero-bf.bad .hero-unit { color: var(--bad); }
  .hero-num { font-family: 'Space Grotesk', sans-serif; font-size: 26.4px; font-weight: 700; color: var(--text); line-height: 1.1; white-space: nowrap; }
  .hero-num-bf { font-size: 32.2px; }
  .hero-unit { font-size: 13.8px; font-weight: 500; color: var(--text-dim); margin-left: 2px; }
  .hero-lbl { font-family: 'JetBrains Mono', monospace; font-size: 10.3px; letter-spacing: 0.07em; text-transform: uppercase; color: var(--text-dim); margin-top: 3px; }

  .tab-bar { display: flex; gap: 6px; margin-bottom: 14px; }
  .tab-btn { display: inline-flex; align-items: center; gap: 6px; background: transparent; border: 1px solid var(--border); color: var(--text-dim); border-radius: 8px; padding: 7px 13px; font-family: 'JetBrains Mono', monospace; font-size: 12.6px; letter-spacing: 0.03em; cursor: pointer; }
  .tab-btn.active { background: var(--panel); color: var(--text); border-color: var(--text-dim); }
  .tab-btn:hover { color: var(--text); }
  .tab-label-short { display: none; }

  .goal-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 14px; }
  .settings-note { font-family: 'JetBrains Mono', monospace; font-size: 12.6px; color: var(--text-faint); margin-bottom: 14px; line-height: 1.5; }

  .pacing-panel { padding-bottom: 18px; }
  .pacing-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; margin-top: 6px; }
  .pacing-card { background: var(--panel-2); border: 1px solid var(--border); border-radius: 10px; padding: 16px; }
  .pacing-card.pacing-card-bad { background: #fcebe9; border-color: #eec4be; }
  .pacing-card.pacing-card-bad .pacing-card-label, .pacing-card.pacing-card-bad .pacing-sub, .pacing-card.pacing-card-bad .pacing-footnote { color: #a03d33; }
  .pacing-card.pacing-card-bad .pacing-value { color: #c73a2f; }
  .pacing-card.pacing-card-good { background: #eef6ea; border-color: #cfe6c4; }
  .pacing-card.pacing-card-good .pacing-card-label, .pacing-card.pacing-card-good .pacing-sub, .pacing-card.pacing-card-good .pacing-footnote { color: #3a6b2c; }
  .pacing-card.pacing-card-good .pacing-value { color: #368727; }
  .pacing-card-label { display: flex; align-items: center; gap: 6px; font-family: 'JetBrains Mono', monospace; font-size: 12.1px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 10px; }
  .pacing-value { font-family: 'Space Grotesk', sans-serif; font-size: 32.2px; font-weight: 700; color: var(--text); }
  .pacing-unit { font-size: 14.9px; font-weight: 500; opacity: 0.75; margin-left: 1px; }
  .pacing-sub { font-size: 13.8px; color: var(--text-dim); margin-top: 8px; line-height: 1.5; }
  .pacing-footnote { font-family: 'JetBrains Mono', monospace; font-size: 11.5px; color: var(--text-faint); margin-top: 10px; }
  .pacing-empty { font-family: 'JetBrains Mono', monospace; font-size: 13.2px; color: var(--text-faint); padding: 8px 0; }

  .block-checklist { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--border); }
  .block-checklist-label { font-family: 'JetBrains Mono', monospace; font-size: 11.5px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 10px; }
  .block-checklist-row { display: flex; gap: 8px; }
  .check-day { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 5px; padding: 8px 4px; border-radius: 8px; cursor: pointer; border: 1px solid transparent; font-family: 'JetBrains Mono', monospace; font-size: 10.9px; letter-spacing: 0.03em; color: var(--text-faint); }
  .check-day:hover { background: var(--panel); }
  .check-day.logged { color: var(--good); }
  .check-day.missing { color: var(--bad); }
  .check-day.future { color: var(--text-faint); cursor: default; opacity: 0.5; }
  .check-day.today { border-color: var(--cut); }
  .check-day-label { text-transform: uppercase; }
  .block-checklist-hint { font-family: 'JetBrains Mono', monospace; font-size: 11.5px; color: var(--text-faint); margin-top: 10px; line-height: 1.5; }
  .this-block-tag { display: inline-block; margin-left: 8px; font-family: 'JetBrains Mono', monospace; font-size: 9.8px; letter-spacing: 0.05em; color: var(--cut); background: #5b8dee22; padding: 1px 6px; border-radius: 10px; vertical-align: middle; }
  .synced-tag { display: inline-flex; align-items: center; gap: 3px; margin-left: 8px; font-family: 'JetBrains Mono', monospace; font-size: 9.8px; letter-spacing: 0.05em; color: var(--good); background: rgba(54, 135, 39, 0.13); padding: 1px 6px; border-radius: 10px; vertical-align: middle; }
  .row-synced td { opacity: 0.85; }
  .daily-grid { grid-template-columns: repeat(3, 1fr) !important; }

  .pacing-mini { background: var(--panel); border-radius: 10px; padding: 10px 14px; margin-bottom: 14px; }
  .pacing-mini-head { display: flex; justify-content: space-between; align-items: center; font-family: 'JetBrains Mono', monospace; font-size: 12.1px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.04em; }
  .pacing-mini-head span { display: flex; align-items: center; gap: 6px; }
  .pacing-mini-link { background: transparent; border: none; color: var(--cut); font-family: 'JetBrains Mono', monospace; font-size: 12.1px; cursor: pointer; text-transform: none; letter-spacing: 0; }
  .pacing-mini-link:hover { text-decoration: underline; }
  .pacing-mini-row { display: flex; gap: 24px; margin-top: 8px; font-size: 14.9px; color: var(--text-dim); }
  .pacing-mini-item strong { font-family: 'Space Grotesk', sans-serif; color: var(--text); }
  .pacing-mini-item strong.cell-good { color: var(--good); }
  .pacing-mini-item strong.cell-bad { color: var(--bad); }
  .pacing-mini-item.pacing-status-good { color: var(--good); }
  .pacing-mini-item.pacing-status-bad { color: var(--bad); }
  .goal-card { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 14px 15px; }
  .goal-card-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  .goal-card-date { font-family: 'JetBrains Mono', monospace; font-size: 11.5px; color: var(--text-faint); }
  .goal-card-body { display: flex; flex-direction: column; gap: 8px; }
  .goal-metric { display: flex; justify-content: space-between; align-items: baseline; }
  .goal-metric-label { font-family: 'JetBrains Mono', monospace; font-size: 12.1px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em; }
  .goal-metric-val { font-family: 'Space Grotesk', sans-serif; font-size: 18.4px; font-weight: 600; }
  .goal-card-notes { font-family: 'JetBrains Mono', monospace; font-size: 12.1px; color: var(--text-faint); margin-top: 4px; padding-top: 8px; border-top: 1px solid var(--border); }
  .goal-card-empty { font-family: 'JetBrains Mono', monospace; font-size: 12.6px; color: var(--text-faint); padding: 6px 0; }
  .goal-card-upcoming { margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--border); display: flex; flex-direction: column; gap: 4px; }
  .upcoming-badge { font-family: 'JetBrains Mono', monospace; font-size: 10.3px; letter-spacing: 0.06em; color: var(--gain); font-weight: 600; }
  .upcoming-vals { font-family: 'JetBrains Mono', monospace; font-size: 12.1px; color: var(--text-dim); }
  .status-badge { font-family: 'JetBrains Mono', monospace; font-size: 10.3px; letter-spacing: 0.05em; padding: 2px 6px; border-radius: 4px; font-weight: 600; }
  .status-badge.status-active { background: #4caf7d22; color: #4caf7d; }
  .status-badge.status-upcoming { background: #dba23622; color: #dba236; }
  .status-badge.status-past { background: #2b2f3a; color: var(--text-faint); }
  .empty-row { text-align: center !important; color: var(--text-faint); padding: 20px !important; }

  .eyebrow { font-family: 'JetBrains Mono', monospace; font-size: 12.6px; letter-spacing: 0.16em; color: var(--text-faint); text-transform: uppercase; margin-bottom: 6px; }
  .title { font-family: 'Space Grotesk', sans-serif; font-size: 41.4px; font-weight: 700; letter-spacing: -0.02em; margin: 0; }
  .title .accent { color: var(--derailed); }

  .timeline-wrap { margin-bottom: 14px; }
  .timeline-bar { position: relative; display: flex; height: 10px; border-radius: 6px; overflow: hidden; background: var(--panel-2); }
  .timeline-seg { height: 100%; transition: opacity 0.2s; }
  .timeline-derail { position: absolute; top: 0; bottom: 0; background: #c73a2f; opacity: 0.65; }
  .timeline-now { position: absolute; top: -3px; bottom: -3px; width: 3px; border-radius: 2px; background: #ffffff; box-shadow: 0 0 0 1px rgba(10, 12, 16, 0.45), 0 0 6px rgba(255, 255, 255, 0.6); }
  .timeline-legend { display: flex; gap: 16px; margin-top: 10px; flex-wrap: wrap; }
  .tl-item { font-family: 'JetBrains Mono', monospace; font-size: 12.1px; color: var(--text-dim); letter-spacing: 0.04em; display: flex; align-items: center; gap: 5px; }
  .tl-dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }

  .stat-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 14px; margin-bottom: 14px; }
  .stat-card { position: relative; background: var(--panel); border-radius: 12px; padding: 14px 15px; }
  .stat-alert-badge { position: absolute; top: -7px; right: 10px; display: inline-flex; align-items: center; gap: 3px; color: #1a0f0f; font-family: 'JetBrains Mono', monospace; font-size: 10.3px; font-weight: 700; letter-spacing: 0.03em; padding: 2px 6px; border-radius: 20px; box-shadow: 0 0 0 3px var(--bg); }
  .stat-alert-badge.bad { background: var(--bad); }
  .stat-alert-badge.warn { background: var(--gain); }
  .stat-alert-badge.good { background: var(--good); color: #ffffff; }
  .stat-top { display: flex; align-items: center; gap: 7px; margin-bottom: 10px; }
  .stat-icon { width: 22px; height: 22px; border-radius: 6px; display: flex; align-items: center; justify-content: center; }
  .stat-label { font-family: 'JetBrains Mono', monospace; font-size: 11.5px; letter-spacing: 0.07em; color: var(--text-dim); text-transform: uppercase; }
  .stat-value { font-family: 'Space Grotesk', sans-serif; font-size: 36.8px; font-weight: 700; letter-spacing: -0.01em; }
  .stat-unit { font-size: 14.9px; font-weight: 500; color: var(--text-dim); margin-left: 2px; }
  .stat-sub { font-family: 'JetBrains Mono', monospace; font-size: 12.6px; color: var(--text-dim); margin-top: 6px; display: flex; align-items: center; gap: 4px; }
  .stat-sub.down { color: var(--cut); } .stat-sub.up { color: var(--gain); } .stat-sub.flat { color: var(--text-dim); }

  .panel { background: var(--panel); border-radius: 12px; padding: 18px 18px 8px; margin-bottom: 14px; }
  .chart-legend-note { display: flex; align-items: center; gap: 6px; font-family: 'JetBrains Mono', monospace; font-size: 11.5px; color: var(--text-faint); padding: 0 0 12px 4px; }
  .derailed-swatch { width: 10px; height: 10px; border-radius: 2px; background: var(--bad); opacity: 0.35; display: inline-block; }

  .chart-legend { display: flex; flex-wrap: wrap; align-items: center; gap: 5px 14px; font-family: 'JetBrains Mono', monospace; font-size: 11.5px; color: var(--text-dim); padding: 2px 4px 12px; }
  .cl-item { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
  .cl-line { width: 16px; height: 0; border-top: 2px solid; display: inline-block; }
  .cl-line.dashed { border-top-style: dashed; }
  .cl-box { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
  .cl-shade { width: 12px; height: 10px; border-radius: 2px; background: var(--bad); opacity: 0.3; border: 1px solid var(--bad); display: inline-block; }
  .panel-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; gap: 10px; flex-wrap: wrap; }
  .panel-head-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
  .panel-head-actions-stack .toggle-group { order: 2; }
  .panel-head-actions-stack .series-toggle { order: 1; }
  .panel-title { font-family: 'Space Grotesk', sans-serif; font-size: 16.1px; font-weight: 600; }
  .panel-title .dim { color: var(--text-dim); font-weight: 400; margin-left: 6px; font-size: 13.8px; }
  .row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }

  .toggle-group { display: flex; gap: 3px; background: var(--panel-2); border-radius: 8px; padding: 2px; font-family: 'JetBrains Mono', monospace; font-size: 10.6px; white-space: nowrap; }
  .toggle-btn { padding: 4px 9px; border-radius: 6px; cursor: pointer; color: var(--text-dim); letter-spacing: 0.05em; background: transparent; border: none; font-family: inherit; }
  .toggle-btn.active { background: var(--panel); color: var(--text); }

  .tt { background: #0f1115; border: 1px solid var(--border); border-radius: 8px; padding: 9px 11px; font-family: 'JetBrains Mono', monospace; font-size: 12.6px; }
  .tt-head { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; padding-bottom: 6px; border-bottom: 1px solid var(--border); }
  .tt-week { color: var(--text-faint); } .tt-date { color: var(--text-dim); }
  .tt-phase { margin-left: auto; font-weight: 600; letter-spacing: 0.04em; }
  .tt-row { display: flex; align-items: center; gap: 6px; padding: 2px 0; }
  .tt-dot { width: 6px; height: 6px; border-radius: 50%; }
  .tt-name { color: var(--text-dim); flex: 1; } .tt-val { color: var(--text); font-weight: 600; }

  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-family: 'JetBrains Mono', monospace; font-size: 13.2px; }
  th { text-align: center; padding: 8px 10px; color: var(--text-faint); font-weight: 500; letter-spacing: 0.05em; text-transform: uppercase; font-size: 10.9px; background: var(--panel); border-bottom: 1px solid var(--border); }
  td { text-align: center; padding: 7px 10px; border-bottom: 1px solid rgba(43,47,58,0.5); color: var(--text-dim); }
  tr:hover td { background: var(--panel-2); color: var(--text); }
  tr:hover td.cell-good { color: var(--good); }
  tr:hover td.cell-bad { color: var(--bad); }
  tr.row-cut td { background: rgba(91, 141, 238, 0.09); }
  tr.row-cut:hover td { background: rgba(91, 141, 238, 0.15); }
  tr.row-maintain td { background: rgba(219, 162, 54, 0.09); }
  tr.row-maintain:hover td { background: rgba(219, 162, 54, 0.15); }
  tr.row-gain td { background: rgba(76, 175, 125, 0.09); }
  tr.row-gain:hover td { background: rgba(76, 175, 125, 0.15); }
  tr.row-derailed td { background: rgba(212, 90, 80, 0.11); }
  tr.row-derailed:hover td { background: rgba(212, 90, 80, 0.17); }
  tr.row-off td { background: rgba(107, 114, 128, 0.08); }
  tr.row-off:hover td { background: rgba(107, 114, 128, 0.13); }
  tr.row-derail-hist td { background: rgba(199, 58, 47, 0.13); }
  tr.row-derail-hist:hover td { background: rgba(199, 58, 47, 0.2); }
  .phase-tag { display: inline-block; min-width: 72px; text-align: center; font-size: 10.9px; padding: 3px 7px; border-radius: 20px; font-weight: 600; letter-spacing: 0.04em; }
  .notes-cell { text-align: left; white-space: nowrap; }
  .target-cell { color: var(--text-faint); font-style: italic; }
  .adj-cell { font-weight: 600; }
  .phase-col { text-align: center !important; padding-left: 6px !important; padding-right: 6px !important; }
  .row-generated td { opacity: 0.5; }
  .row-generated:hover td { opacity: 0.8; }
  .fill-btn { color: var(--good); border-color: var(--good) !important; }

  .group-row { cursor: pointer; }
  .group-cell { text-align: left !important; padding: 10px 12px !important; }
  .group-row:hover .group-cell { filter: brightness(1.15); }
  .group-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .group-caret { display: inline-block; width: 14px; color: var(--text-dim); font-size: 11px; }
  .group-head .phase-tag { min-width: 78px; }
  .group-span { color: var(--text-dim); font-size: 13px; }
  .saving-note { display: inline-flex; align-items: center; gap: 5px; font-family: 'Inter', sans-serif; font-size: 11px; color: var(--text-dim); }

  .habit-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-top: 4px; margin-bottom: 8px; }
  .habit-btn { display: flex; align-items: center; gap: 12px; padding: 16px 14px; border-radius: 14px; border: 2px solid var(--border); background: var(--panel-2); cursor: pointer; text-align: left; transition: all 0.15s; }
  .habit-btn:hover { border-color: var(--habit-color); }
  .habit-btn.habit-done { background: var(--panel); border-color: var(--habit-color); box-shadow: inset 0 0 0 99px color-mix(in srgb, var(--habit-color) 8%, transparent); }
  .habit-btn-icon { flex-shrink: 0; color: var(--habit-color); }
  .habit-done .habit-btn-icon { color: var(--habit-color); }
  .habit-btn-label { flex: 1; font-family: 'Inter', sans-serif; font-size: 14px; font-weight: 600; color: var(--text); }
  .habit-btn-check { flex-shrink: 0; color: var(--text-faint); }
  .habit-done .habit-btn-check { color: var(--habit-color); }

  .habit-streaks { display: flex; flex-wrap: wrap; gap: 10px; padding: 4px 0 10px; }
  .habit-streak-chip { display: flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: 10px; border: 1px solid var(--border); background: var(--panel-2); font-family: 'Inter', sans-serif; }
  .habit-streak-label { font-size: 12px; color: var(--text-dim); font-weight: 500; flex: 1; }
  .habit-streak-this { font-size: 13px; font-weight: 600; }
  .habit-streak-val { font-size: 16px; font-weight: 700; min-width: 36px; text-align: right; }

  .habit-targets-grid { display: flex; flex-direction: column; gap: 8px; padding: 4px 0 10px; }
  .habit-target-row { display: flex; align-items: center; gap: 10px; padding: 8px 2px; }
  .habit-target-label { flex: 1; font-family: 'Inter', sans-serif; font-size: 13px; font-weight: 500; color: var(--text); }
  .habit-target-stepper { display: flex; align-items: center; gap: 10px; }
  .habit-step-btn { width: 30px; height: 30px; border-radius: 8px; border: 1px solid var(--border); background: var(--panel-2); color: var(--text); font-size: 18px; font-weight: 400; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; line-height: 1; }
  .habit-step-btn:hover { border-color: var(--text-dim); color: var(--text); }
  .habit-target-val { font-family: 'Inter', sans-serif; font-size: 15px; font-weight: 700; color: var(--text); min-width: 28px; text-align: center; }
  .hidden-thead { display: none; }
  .group-colhead td { text-align: center; color: var(--text-faint); font-weight: 500; letter-spacing: 0.05em; text-transform: uppercase; font-size: 10.9px; padding: 7px 10px; border-bottom: 1px solid var(--border); background: var(--panel); }
  .group-colhead td:last-child { text-align: right; }
  .group-stats { display: flex; align-items: stretch; gap: 8px; flex-wrap: wrap; }
  .gstat { display: flex; flex-direction: column; align-items: flex-end; gap: 1px; background: transparent; border: 1px solid var(--border); border-radius: 9px; padding: 5px 11px; min-width: 74px; }
  .gstat-label { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-faint); }
  .gstat-val { font-family: 'Space Grotesk', sans-serif; font-size: 14px; font-weight: 700; color: var(--text); white-space: nowrap; }
  .gstat-val.gstat-down { color: var(--good); }
  .gstat-val.gstat-up { color: var(--bad); }
  .gstat-rate { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; color: var(--text-faint); white-space: nowrap; }
  .gstat-empty { background: transparent !important; opacity: 0.5; }
  .gstat-placeholder { color: var(--text-faint); }
  .cell-good { color: var(--good); font-weight: 600; }
  .cell-bad { color: var(--bad); font-weight: 600; }
  .form-note { font-family: 'JetBrains Mono', monospace; font-size: 12.1px; color: var(--text-faint); margin-bottom: 10px; line-height: 1.5; }
  .footer-note { font-family: 'JetBrains Mono', monospace; font-size: 11.5px; color: var(--text-faint); line-height: 1.5; margin-bottom: 14px; }
  .row-actions { text-align: right; white-space: nowrap; }
  .row-actions .icon-btn + .icon-btn { margin-left: 4px; }
  .icon-btn { background: transparent; border: 1px solid var(--border); color: var(--text-dim); border-radius: 6px; width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; vertical-align: middle; }
  .icon-btn:hover { color: var(--text); border-color: var(--text-dim); }
  .icon-btn.danger:hover { color: var(--derailed); border-color: var(--derailed); }
  .icon-btn.danger.armed, .icon-btn.danger.armed:hover { background: var(--bad); color: #1a0f0f; border-color: var(--bad); }
  .note-btn { color: var(--cut); }

  .note-overlay { position: fixed; inset: 0; background: rgba(8, 10, 14, 0.5); display: flex; align-items: center; justify-content: center; padding: 20px; z-index: 60; }
  .note-pop { background: var(--panel); border: 1px solid var(--border); border-radius: 14px; padding: 14px 16px 16px; width: 100%; max-width: 420px; box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4); }
  .note-pop-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; font-family: 'Space Grotesk', sans-serif; font-size: 14.9px; font-weight: 600; color: var(--text); margin-bottom: 8px; }
  .note-pop-body { font-family: 'Inter', sans-serif; font-size: 14.9px; line-height: 1.6; color: var(--text-dim); white-space: pre-wrap; }

  .form-error { display: flex; align-items: center; gap: 6px; color: var(--bad); font-family: 'JetBrains Mono', monospace; font-size: 12.6px; margin-top: 10px; }

  .backup-box { background: var(--panel-2); border: 1px solid var(--border); border-radius: 10px; padding: 14px; margin-bottom: 12px; }
  .backup-ta { width: 100%; min-height: 160px; resize: vertical; background: var(--panel); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-family: 'JetBrains Mono', monospace; font-size: 12.1px; line-height: 1.5; padding: 10px; }
  .backup-ta:focus { outline: 2px solid var(--cut); outline-offset: 1px; }

  .btn-primary { display: inline-flex; align-items: center; gap: 6px; background: var(--cut); color: #0f1115; border: none; border-radius: 8px; padding: 8px 13px; font-family: 'JetBrains Mono', monospace; font-size: 12.6px; font-weight: 600; letter-spacing: 0.03em; cursor: pointer; }
  .btn-primary:hover { filter: brightness(1.1); }
  .btn-primary.sm { padding: 6px 11px; }
  .btn-ghost.sm { padding: 6px 11px; font-size: 11px; }
  .btn-primary:disabled { opacity: 0.6; cursor: default; }
  .btn-ghost { display: inline-flex; align-items: center; gap: 6px; background: transparent; color: var(--text-dim); border: 1px solid var(--border); border-radius: 8px; padding: 8px 13px; font-family: 'JetBrains Mono', monospace; font-size: 12.6px; cursor: pointer; }
  .btn-ghost:hover { color: var(--text); }

  .entry-form { background: var(--panel-2); border: 1px solid var(--border); border-radius: 10px; padding: 14px; margin-bottom: 14px; }
  .form-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
  .form-grid label { display: flex; flex-direction: column; gap: 4px; font-family: 'JetBrains Mono', monospace; font-size: 10.9px; color: var(--text-dim); letter-spacing: 0.04em; text-transform: uppercase; }
  .form-grid input, .form-grid select { background: var(--panel); border: 1px solid var(--border); border-radius: 6px; color: var(--text); padding: 7px 8px; font-family: 'Inter', sans-serif; font-size: 14.4px; }
  .form-grid input:focus, .form-grid select:focus { outline: 2px solid var(--cut); outline-offset: 1px; }
  .notes-field { grid-column: span 4; }
  .form-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }

  @media (max-width: 860px) {
    .stat-grid { grid-template-columns: repeat(3, 1fr); }
    .row-2 { grid-template-columns: 1fr; }
    .row-2 .panel:not(:last-child) { margin-bottom: 0; }
    .form-grid { grid-template-columns: repeat(2, 1fr); }
    .notes-field { grid-column: span 2; }
    .goal-cards { grid-template-columns: 1fr; }
    .pacing-grid { grid-template-columns: 1fr; }
    .daily-grid { grid-template-columns: 1fr !important; }
    .pacing-mini-row { flex-wrap: wrap; gap: 12px; }
  }

  @media (max-width: 640px) {
    .dash { padding: 12px 10px 28px; padding-top: calc(12px + env(safe-area-inset-top)); border-radius: 0; }
    .header { margin-bottom: 12px; gap: 8px; }
    .title { font-size: 32.2px; }
    .panel { padding: 14px 12px 6px; }
    .banner-alert { padding: 14px 12px; min-height: 0; font-size: 15.5px; }
    .banner-alert, .banner-ontrack { position: relative; padding-right: 54px; }
    .banner-alert .notif-weeks, .banner-ontrack .notif-weeks { position: absolute; top: 12px; right: 12px; }
    .notif-row .notif-weeks { margin-left: auto; }
    .stat-value { font-size: 29.9px; }
    .stat-grid { grid-template-columns: repeat(2, 1fr); }
    .tab-label-full { display: none; }
    .tab-label-short { display: inline; }
    div.dash .tab-bar { gap: 8px; }
    div.dash .tab-btn { font-size: 16px; flex: 1; justify-content: center; gap: 6px; min-width: 0; padding-left: 4px; padding-right: 4px; }
    div.dash .tab-btn svg { width: 18px; height: 18px; flex-shrink: 0; }
    div.dash .header-top { align-items: center; }
    div.dash .stat-sub .cell-good, div.dash .stat-sub .cell-bad { white-space: nowrap; }
    .panel-head-actions-stack { flex-direction: column; align-items: flex-start; gap: 6px; }
    .panel-head-actions-stack .toggle-group { order: 1; }
    .panel-head-actions-stack .series-toggle { order: 2; }
  }

  /* ---------- Clean brokerage-app styling ---------- */

  /* Cards: white, big radius, soft shadow instead of hard borders */
  .dash .panel, .dash .stat-card, .dash .goal-card,
  .dash .pacing-mini {
    border-radius: 18px;
    border-color: var(--border);
    box-shadow: 0 1px 2px rgba(20, 22, 27, 0.05), 0 4px 16px rgba(20, 22, 27, 0.05);
  }
  .dash .pacing-card, .dash .entry-form, .dash .backup-box { border-radius: 14px; }

  /* Header: plain clean type instead of the mono/grotesk terminal look */
  .dash .eyebrow { font-family: 'Inter', sans-serif; letter-spacing: 0.06em; }
  .dash .title { font-family: 'Inter', sans-serif; font-weight: 700; letter-spacing: -0.015em; }
  .dash .header-meta { font-family: 'Inter', sans-serif; }
  .dash .header-sub { font-family: 'Inter', sans-serif; text-transform: none; font-size: 12.6px; letter-spacing: 0.01em; }
  .dash .hero-card { border-radius: 18px; border-color: var(--border); box-shadow: 0 1px 2px rgba(20, 22, 27, 0.05), 0 4px 16px rgba(20, 22, 27, 0.05); }
  .dash .hero-num { font-family: 'Inter', sans-serif; letter-spacing: -0.02em; }
  .dash .hero-lbl { font-family: 'Inter', sans-serif; text-transform: none; font-size: 12.1px; letter-spacing: 0.01em; font-weight: 600; }
  .dash .hero-bf { background: #f1f0eb; }
  .dash .hero-bf.good { background: #ddefd4; }
  .dash .hero-bf.good .hero-num, .dash .hero-bf.good .hero-lbl, .dash .hero-bf.good .hero-unit { color: #2b6e1e; }
  .dash .hero-bf.bad { background: #f8ddd9; }
  .dash .hero-bf.bad .hero-num, .dash .hero-bf.bad .hero-lbl, .dash .hero-bf.bad .hero-unit { color: #a5342a; }

  /* Tabs: text with a green underline, like Positions / Watchlist / Markets */
  .dash .tab-bar { gap: 22px; border-bottom: 1px solid var(--border); }
  .dash .tab-btn { background: transparent; border: none; border-radius: 0; padding: 8px 2px 12px; font-family: 'Inter', sans-serif; font-size: 15.5px; font-weight: 600; letter-spacing: 0; color: var(--text-dim); }
  .dash .tab-btn.active { background: transparent; color: var(--text); box-shadow: inset 0 -3px 0 var(--good); }
  .dash .tab-btn:hover { color: var(--text); }

  /* Segmented control, like the US / International pill toggle */
  .dash .toggle-group { background: #ecebe5; border-radius: 999px; padding: 3px; }
  .dash .toggle-btn { border-radius: 999px; font-family: 'Inter', sans-serif; font-weight: 600; letter-spacing: 0.02em; padding: 4px 10px; font-size: 11.3px; }
  .dash .toggle-btn.active { background: #ffffff; box-shadow: 0 1px 3px rgba(20, 22, 27, 0.16); }

  /* Stat cards: sentence-case labels, big clean numbers, pill deltas */
  .dash .stat-label { font-family: 'Inter', sans-serif; font-size: 13.2px; font-weight: 600; text-transform: none; letter-spacing: 0.01em; }
  .dash .stat-value { font-family: 'Inter', sans-serif; font-weight: 700; letter-spacing: -0.02em; }
  .dash .stat-sub { font-family: 'Inter', sans-serif; font-size: 13.2px; }
  .dash .stat-sub .cell-good { background: #ddefd4; color: #2b6e1e; padding: 1px 8px; border-radius: 999px; }
  .dash .stat-sub .cell-bad { background: #f8ddd9; color: #a5342a; padding: 1px 8px; border-radius: 999px; }

  /* Panel titles like "Sector performance" */
  .dash .panel-title { font-family: 'Inter', sans-serif; font-size: 17.2px; font-weight: 700; }
  .dash .panel-title .dim { font-size: 13.2px; }

  /* Buttons: green pills */
  .dash .btn-primary { background: var(--good); color: #ffffff; border-radius: 999px; font-family: 'Inter', sans-serif; font-weight: 600; letter-spacing: 0.01em; }
  .dash .btn-ghost { border-radius: 999px; font-family: 'Inter', sans-serif; font-weight: 600; letter-spacing: 0.01em; background: #ffffff; }
  .dash .icon-btn { border-radius: 8px; }

  /* Tables & forms: Inter, roomier rows */
  .dash table { font-family: 'Inter', sans-serif; font-size: 13.8px; }
  .dash th { font-family: 'Inter', sans-serif; font-size: 11.5px; letter-spacing: 0.04em; }
  .dash td { padding: 9px 10px; border-bottom: 1px solid rgba(206, 203, 194, 0.5); }
  .dash .form-grid label { font-family: 'Inter', sans-serif; text-transform: none; font-size: 12.6px; font-weight: 600; letter-spacing: 0; }
  .dash .form-grid input, .dash .form-grid select { border-radius: 10px; }
  .dash .form-grid input:focus, .dash .form-grid select:focus { outline-color: var(--good); }
  .dash .form-note, .dash .block-checklist-hint, .dash .pacing-footnote, .dash .settings-note, .dash .footer-note, .dash .chart-legend-note, .dash .goal-card-notes, .dash .goal-card-empty, .dash .pacing-empty, .dash .form-error, .dash .backup-ta { font-family: 'Inter', sans-serif; }
  .dash .eyebrow, .dash .pacing-card-label, .dash .block-checklist-label, .dash .goal-metric-label, .dash .stat-sub, .dash .goal-card-date, .dash .upcoming-vals, .dash .pacing-mini-head, .dash .pacing-mini-link, .dash .tl-item, .dash .status-badge, .dash .upcoming-badge, .dash .phase-tag, .dash .check-day, .dash .this-block-tag { font-family: 'Inter', sans-serif; }
  .dash .pacing-value, .dash .goal-metric-val, .dash .pacing-mini-item strong { font-family: 'Inter', sans-serif; font-weight: 700; }
  .dash .banner-alert strong { font-family: 'Inter', sans-serif; }

  /* Alerts & misc, tuned for white */
  .dash .banner-error { background: #fdf1dd; border-color: #ecd3a4; color: #8a5b13; font-family: 'Inter', sans-serif; }
  .dash .banner-alert { border-radius: 16px; }
  .dash .banner-alert.slipping { background: #fcebe9; border-color: #eec4be; color: #a03d33; }
  .dash .banner-alert.slipping svg { color: #c73a2f; }
  .dash .banner-alert.derailed { background: #fcebe9; border-color: #eec4be; color: #a03d33; }
  .dash .banner-alert.derailed svg { color: #c73a2f; }
  .dash .recovery { border-top-color: rgba(0,0,0,0.12); }
  .dash .rec-trend { font-family: 'Inter', sans-serif; }
  .dash .rec-trend.rec-good { color: #2b6e1e; }
  .dash .rec-trend.rec-bad { color: #a5342a; }
  .dash .rec-plan { font-family: 'Inter', sans-serif; }
  .dash .rec-chip { font-family: 'Inter', sans-serif; background: rgba(0,0,0,0.07); }
  .dash .tt { background: #ffffff; border-radius: 12px; box-shadow: 0 4px 14px rgba(30, 30, 40, 0.14); font-family: 'Inter', sans-serif; }
  .dash .timeline-now { background: #ffffff; box-shadow: 0 0 0 1.5px rgba(22, 24, 29, 0.55), 0 1px 4px rgba(22, 24, 29, 0.3); }
  .dash .stat-alert-badge { color: #ffffff; font-family: 'Inter', sans-serif; }
  .dash .icon-btn.danger.armed, .dash .icon-btn.danger.armed:hover { color: #ffffff; }
  .dash .status-badge.status-active { background: #ddefd4; color: #2b6e1e; }
  .dash .status-badge.status-past { background: #e9e7df; }
  .dash .this-block-tag { background: #5b8dee1e; }
  .dash .check-day.logged { color: #2b6e1e; }
  .dash .check-day.today { border-color: var(--good); }
  .dash .note-btn { color: var(--good); }
  .dash .note-overlay { background: rgba(30, 32, 40, 0.35); }
  .dash .note-pop { border-radius: 16px; box-shadow: 0 16px 48px rgba(20, 22, 27, 0.25); }
  .dash .note-pop-head { font-family: 'Inter', sans-serif; }
  .dash .group-span { font-family: 'Inter', sans-serif; }
  .dash .gstat-label { font-family: 'Inter', sans-serif; }
  .dash .gstat-val { font-family: 'Inter', sans-serif; }
  .dash .gstat-rate { font-family: 'Inter', sans-serif; }
  .dash .gstat-val.gstat-down { color: #2b6e1e; }
  .dash .gstat-val.gstat-up { color: #a5342a; }
  .dash .chart-legend { font-family: 'Inter', sans-serif; font-size: 12.1px; }
`;
