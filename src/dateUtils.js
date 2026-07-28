// Date helpers shared by the dashboard and the Food tab. The app stores every
// date as an "M/D/YY" string (no leading zeros, 2-digit year) — these are the
// only places that convention gets parsed or produced.

export function parseDate(str) {
  if (!str) return null;
  const parts = String(str).split("/").map(s => s.trim());
  if (parts.length !== 3) return null;
  const [m, d, yRaw] = parts.map(Number);
  if (!m || !d || Number.isNaN(yRaw)) return null;
  const y = yRaw < 100 ? 2000 + yRaw : yRaw;
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

export function formatMDY(date) {
  return `${date.getMonth() + 1}/${date.getDate()}/${String(date.getFullYear()).slice(2)}`;
}

// Conversions for <input type="date">, which speaks ISO (YYYY-MM-DD) — the
// rest of the app stores dates as "M/D/YY" strings, so form state stays
// unchanged and only the date-picker input itself converts at the edges.
export function mdyToISO(str) {
  const d = parseDate(str);
  if (!d) return "";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}
export function isoToMDY(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return "";
  return formatMDY(new Date(y, m - 1, d));
}

export const DAY_MS = 24 * 3600 * 1000;

// Date stepping here uses calendar arithmetic (year/month/day fields), not
// millisecond offsets: adding N*24h to a local midnight lands an hour off
// when the range crosses a DST change, which shifted generated "Fridays"
// onto Thursdays after the November fall-back.
export function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}
export function blockStartFor(date) {
  const dow = date.getDay();
  const diff = (dow - 5 + 7) % 7;
  return addDays(date, -diff);
}
export function blockEndFor(blockStart) {
  return addDays(blockStart, 6);
}
export function daysBetween(a, b) {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

/** Midnight today, which is what every "is this day logged yet" check wants. */
export function today() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
