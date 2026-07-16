import { supabaseAdmin, WITHINGS_TOKEN_URL } from "./_withings.js";

export default async function handler(req, res) {
  const { code } = req.query || {};
  if (!code) {
    res.writeHead(302, { Location: "/?withings=error" });
    res.end();
    return;
  }

  try {
    const params = new URLSearchParams({
      action: "requesttoken",
      grant_type: "authorization_code",
      client_id: process.env.WITHINGS_CLIENT_ID,
      client_secret: process.env.WITHINGS_CLIENT_SECRET,
      code,
      redirect_uri: process.env.WITHINGS_REDIRECT_URI,
    });
    const resp = await fetch(WITHINGS_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });
    const json = await resp.json();
    if (json.status !== 0) throw new Error(`Withings token exchange failed (status ${json.status})`);

    const { access_token, refresh_token, userid } = json.body;
    const supabase = supabaseAdmin();
    const { error } = await supabase.from("withings_tokens").upsert({
      id: 1,
      access_token,
      refresh_token,
      withings_user_id: String(userid),
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;

    res.writeHead(302, { Location: "/?withings=connected" });
    res.end();
  } catch (e) {
    res.writeHead(302, { Location: "/?withings=error" });
    res.end();
  }
}
