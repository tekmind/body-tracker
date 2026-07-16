import {
  supabaseAdmin, MEASTYPES, CATEGORY, kgToLb, toMDY,
  WITHINGS_TOKEN_URL, WITHINGS_MEASURE_URL,
} from "./_withings.js";

export default async function handler(req, res) {
  const supabase = supabaseAdmin();

  const { data: tokenRow, error: tokenErr } = await supabase
    .from("withings_tokens").select("*").eq("id", 1).maybeSingle();
  if (tokenErr) return res.status(500).json({ error: tokenErr.message });
  if (!tokenRow) {
    return res.status(400).json({ error: "Withings not connected yet — visit /api/withings-auth first." });
  }

  // Withings refresh tokens are single-use, so always rotate rather than
  // tracking access-token expiry.
  const refreshParams = new URLSearchParams({
    action: "requesttoken",
    grant_type: "refresh_token",
    client_id: process.env.WITHINGS_CLIENT_ID,
    client_secret: process.env.WITHINGS_CLIENT_SECRET,
    refresh_token: tokenRow.refresh_token,
  });
  const refreshResp = await fetch(WITHINGS_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: refreshParams,
  });
  const refreshJson = await refreshResp.json();
  if (refreshJson.status !== 0) {
    return res.status(502).json({ error: `Withings token refresh failed (status ${refreshJson.status})` });
  }
  const { access_token, refresh_token } = refreshJson.body;
  const { error: saveErr } = await supabase.from("withings_tokens").upsert({
    id: 1,
    access_token,
    refresh_token,
    withings_user_id: tokenRow.withings_user_id,
    updated_at: new Date().toISOString(),
  });
  if (saveErr) return res.status(500).json({ error: saveErr.message });

  const now = Math.floor(Date.now() / 1000);
  const measParams = new URLSearchParams({
    action: "getmeas",
    meastypes: `${MEASTYPES.WEIGHT},${MEASTYPES.FAT_MASS},${MEASTYPES.MUSCLE_MASS}`,
    category: String(CATEGORY),
    startdate: String(now - 3 * 24 * 3600),
    enddate: String(now),
  });
  const measResp = await fetch(WITHINGS_MEASURE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Bearer ${access_token}`,
    },
    body: measParams,
  });
  const measJson = await measResp.json();
  if (measJson.status !== 0) {
    return res.status(502).json({ error: `Withings measurement fetch failed (status ${measJson.status})` });
  }

  const groups = measJson.body?.measuregrps || [];
  if (groups.length === 0) {
    return res.status(200).json({ message: "No recent measurement found." });
  }
  const latest = groups.reduce((a, b) => (b.date > a.date ? b : a));
  const tz = measJson.body?.timezone;

  const values = {};
  for (const m of latest.measures) {
    const kg = m.value * Math.pow(10, m.unit);
    if (m.type === MEASTYPES.WEIGHT) values.weight = kgToLb(kg);
    if (m.type === MEASTYPES.FAT_MASS) values.fat_mass = kgToLb(kg);
    if (m.type === MEASTYPES.MUSCLE_MASS) values.muscle_mass = kgToLb(kg);
  }
  const date = toMDY(latest.date, tz);

  // Only touch weight/fat_mass/muscle_mass on an existing row so a
  // HealthKit-synced day's cal/steps/source survive untouched. A brand-new
  // row (no HealthKit data yet for this date) is inserted with its own
  // source label instead of inheriting the table's 'healthkit' default.
  const { data: existing, error: existingErr } = await supabase
    .from("daily_metrics").select("date").eq("date", date).maybeSingle();
  if (existingErr) return res.status(500).json({ error: existingErr.message });

  const writeErr = existing
    ? (await supabase.from("daily_metrics").update(values).eq("date", date)).error
    : (await supabase.from("daily_metrics").insert({ date, source: "withings", ...values })).error;
  if (writeErr) return res.status(500).json({ error: writeErr.message });

  return res.status(200).json({
    date,
    weight: values.weight ?? null,
    fatMass: values.fat_mass ?? null,
    muscleMass: values.muscle_mass ?? null,
  });
}
