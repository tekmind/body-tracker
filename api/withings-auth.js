export default function handler(req, res) {
  const clientId = process.env.WITHINGS_CLIENT_ID;
  const redirectUri = process.env.WITHINGS_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    res.status(500).send("Missing WITHINGS_CLIENT_ID / WITHINGS_REDIRECT_URI env vars.");
    return;
  }

  const state = Math.random().toString(36).slice(2);
  const url = new URL("https://account.withings.com/oauth2_user/authorize2");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("scope", "user.metrics");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);

  res.writeHead(302, { Location: url.toString() });
  res.end();
}
