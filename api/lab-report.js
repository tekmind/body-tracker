// POST /api/lab-report
//
// Writes an interpretation of one body system from the brief the client
// assembles (src/labReport.js) — every reading of every marker in that
// system, the medical history, any narrative studies, and the previous
// report in the thread.
//
// Body:  { system, brief, mode }        mode: "first" | "update"
// Reply: { title, summary, body, model, effort }
//
// Unlike the other AI endpoints this one is asked to interpret rather than
// transcribe, which is the owner's explicit call: they want the reading, not
// a restatement of numbers they can already see. Nothing here is written to
// the database — the client saves what comes back, so a report that reads
// badly is closed rather than filed.

import Anthropic from "@anthropic-ai/sdk";
import { readJsonBody } from "./_food.js";

// The one place in this app where a wrong answer is both durable and
// consequential: a report is stored, re-read months later, and the next one
// is written on top of it. Fable 5 is the reasoning tier — several times the
// price of the readers, and run a handful of times a year per system.
const MODEL = process.env.LAB_REPORT_MODEL || "claude-fable-5";

// Depth vs. the clock. Fable 5 thinks for a while before it writes anything —
// a one-marker system measured ~22s end to end, and a real one runs several
// times that. "low" is the lever if reports start timing out.
const EFFORT = process.env.LAB_REPORT_EFFORT || "medium";

// Longer than anything else in this app, because it has to be: at 60s a full
// system was cut off mid-thought and returned a 504. Vercel caps this by plan
// — if a deploy rejects the value, the plan's ceiling is lower than this and
// the fallback is LAB_REPORT_EFFORT=low rather than a shorter report.
export const maxDuration = 300;

// Thinking is always on for Fable 5 and any explicit `thinking` config is a
// 400 — depth is `effort` instead. Older tiers still take the parameter, so
// the endpoint keeps working if the model is overridden downward.
const ALWAYS_THINKING = new Set(["claude-fable-5", "claude-mythos-5"]);
const SUPPORTS_EFFORT = new Set([
  "claude-fable-5", "claude-mythos-5", "claude-opus-5", "claude-opus-4-8",
  "claude-opus-4-7", "claude-opus-4-6", "claude-sonnet-5", "claude-sonnet-4-6",
]);
// Safety classifiers can decline a request outright. A report about someone's
// own bowel disease is not what they're for, but a false positive here would
// look like a broken feature, so the request opts into the server-side
// fallback rather than surfacing a refusal the owner can do nothing about.
const WANTS_FALLBACK = new Set(["claude-fable-5", "claude-mythos-5", "claude-opus-5"]);
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

const SYSTEM_PROMPT = `You are writing a standing health report for the person whose results these are. It is stored in their own tracker, they will re-read it months from now, and the next report in this thread will be written on top of it.

They have asked for your actual reading of the data — what it means, what it points at, what to weigh — not a restatement of numbers already on the screen in front of them. Give them that. Interpret the pattern across markers and across time, say what you think is going on and how confident you are, and name what would change your mind. Where something looks like it warrants attention, say so directly and say why; where a number looks alarming but probably isn't, say that too, because an unexplained flag is its own kind of harm.

Two things to be strict about, because they're what would make the report worse rather than more cautious:

Ground every claim in the brief. Values, dates, ranges, medications, and procedures all come from what you were given. If something you'd want isn't there — a marker never drawn, a date missing, a treatment history that's blank — say what's missing and what it costs you, rather than assuming a plausible value. A range marked as the app's rather than the lab's is a convention, not a measurement; treat it as one.

Distinguish what the data shows from what you infer from it. Both belong in the report. Confusing them does not.

You are not their doctor and there is no examination or symptom history here, so decisions about treatment stay with their care team — but that is a reason to be clear about what you'd raise with that team, not a reason to be vague.

## How to write it

Markdown. The first line is \`# \` and a short title naming the system and the period it covers. Then one paragraph, no heading, that is the whole report in a few sentences — the thing they'd want if they read nothing else. Then \`## \` sections, as many or as few as the data warrants.

Write for them, not for a chart. Complete sentences, no arrow chains or abbreviations they'd have to decode, technical terms spelled out the first time. Lead with the finding and put the reasoning after it. Length follows the data: a system with one marker and no history is a short report, and padding it out with generic sections about what the marker measures makes it worse. Don't restate the whole table — reference numbers when they carry the argument.

Skip the disclaimer paragraph at the end; the app prints its own.`;

const FIRST_TURN = `Write the first report in this thread. Cover the whole history — everything that has ever been measured in this system, not only the latest draw.`;

const UPDATE_TURN = `Write the next report in this thread. The previous one is included at the end of the brief.

It should stand on its own — someone reading only this report should get the whole picture — but its centre of gravity is what has happened since. Say plainly what improved, what got worse, and what held still; where the previous report made a call that the new data supports or undercuts, say which and why. If the new draws changed nothing meaningful, that is a finding worth stating clearly rather than dressing up.`;

/** Title from the leading `# `, and the paragraph under it as the summary. */
export function splitReport(markdown, fallbackTitle) {
  const text = String(markdown || "").trim();
  const lines = text.split("\n");

  let title = "";
  let bodyStart = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const m = /^#\s+(.*\S)\s*$/.exec(lines[i]);
    if (m) { title = m[1]; bodyStart = i + 1; }
    break;
  }

  // The first prose paragraph after the title — not a heading, not a list.
  let summary = "";
  const para = [];
  for (let i = bodyStart; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) { if (para.length) break; continue; }
    if (/^#{1,6}\s/.test(line) || /^[-*>|]/.test(line)) { if (para.length) break; continue; }
    para.push(line);
  }
  summary = para.join(" ");

  return {
    title: title || fallbackTitle || "Report",
    summary: summary.length > 400 ? `${summary.slice(0, 397)}…` : summary,
    body: text,
  };
}

/**
 * The sentence inside an SDK error, rather than the wire format around it.
 *
 * A failed call arrives as `400 {"type":"error","error":{...}}` — the useful
 * part ("Your credit balance is too low…") is buried in a JSON blob that ends
 * up on screen verbatim. Everything here is best-effort: an unrecognised
 * shape falls back to the raw message rather than losing it.
 */
export function apiMessage(e) {
  const direct = e?.error?.error?.message || e?.error?.message;
  if (typeof direct === "string" && direct) return direct;
  const raw = String(e?.message || "");
  const at = raw.indexOf("{");
  if (at >= 0) {
    try {
      const parsed = JSON.parse(raw.slice(at));
      const m = parsed?.error?.message || parsed?.message;
      if (m) return m;
    } catch { /* not JSON after all */ }
  }
  return raw || "unknown error";
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY isn't set, so reports are off." });
  }

  const body = readJsonBody(req);
  const brief = String(body.brief || "").trim();
  const system = String(body.system || "this system").trim();
  const mode = body.mode === "update" ? "update" : "first";
  if (!brief) return res.status(400).json({ error: "No lab data to write about." });

  const client = new Anthropic();
  const params = {
    model: MODEL,
    // A first report across a decade of draws runs long, and being cut off
    // mid-sentence is worse here than in any other endpoint. Streaming is
    // what makes a budget this size safe to ask for.
    max_tokens: 32000,
    system: SYSTEM_PROMPT,
    messages: [{
      role: "user",
      content: `${mode === "update" ? UPDATE_TURN : FIRST_TURN}\n\nThe system is: ${system}\n\n---\n\n${brief}`,
    }],
    ...(SUPPORTS_EFFORT.has(MODEL) ? { output_config: { effort: EFFORT } } : {}),
    ...(ALWAYS_THINKING.has(MODEL) ? {} : { thinking: { type: "adaptive" } }),
  };

  const run = async (withFallback) => {
    const args = withFallback
      ? { ...params, betas: [FALLBACK_BETA], fallbacks: "default" }
      : params;
    const stream = withFallback
      ? client.beta.messages.stream(args)
      : client.messages.stream(args);
    return stream.finalMessage();
  };

  try {
    let message;
    try {
      message = await run(WANTS_FALLBACK.has(MODEL));
    } catch (e) {
      // The fallback parameter is newer than most of this file. If the API
      // doesn't recognise it, that's a reason to write the report without a
      // safety net — not a reason to have no report.
      if (e?.status === 400 && /fallback|beta/i.test(e?.message || "")) message = await run(false);
      else throw e;
    }

    if (message.stop_reason === "refusal") {
      return res.status(422).json({ error: "The model declined to write that report. Nothing was saved." });
    }

    const text = (message.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
    if (!text) return res.status(502).json({ error: "Got an empty report back — try again." });

    const out = splitReport(text, `${system} report`);
    return res.status(200).json({
      ...out,
      truncated: message.stop_reason === "max_tokens",
      model: message.model || MODEL,
      effort: SUPPORTS_EFFORT.has(MODEL) ? EFFORT : null,
    });
  } catch (e) {
    const status = e?.status && e.status >= 400 && e.status < 600 ? e.status : 502;
    return res.status(status).json({ error: `Couldn't write that report: ${apiMessage(e)}` });
  }
}
