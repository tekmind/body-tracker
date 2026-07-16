import { createClient } from "@supabase/supabase-js";

export function supabaseAdmin() {
  return createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);
}

export const WITHINGS_TOKEN_URL = "https://wbsapi.withings.net/v2/oauth2";
export const WITHINGS_MEASURE_URL = "https://wbsapi.withings.net/measure";

// https://developer.withings.com meastype codes for body-composition data.
export const MEASTYPES = { WEIGHT: 1, FAT_MASS: 8, MUSCLE_MASS: 76 };
export const CATEGORY = 1; // real measurements, excludes user-set goals

export function kgToLb(kg) {
  return Math.round(kg * 2.20462 * 10) / 10;
}

// Matches the app's "M/D/YY" date convention (see parseDate/formatMDY in
// src/Dashboard.jsx) — no leading zeros, 2-digit year.
export function toMDY(unixSeconds, tzName) {
  const d = new Date(unixSeconds * 1000);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tzName || "UTC",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get("month")}/${get("day")}/${get("year").slice(2)}`;
}
