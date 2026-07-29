// POST /api/food-parse
//
// Turns "a can of tuna fish and four ounces of white rice and ten saltine
// crackers" into structured, quantified food entries.
//
// Body: {
//   transcript: string,           // what was said (or typed)
//   localTime?: string,           // "Tuesday 3:42 PM" — used to guess the meal section
//   section?: string,             // section the user had open, used as a tiebreak
//   history?: [{ id, name, brand, serving }]   // recently/frequently eaten foods
// }
//
// Returns { section, items: [{ query, quantity, unit, history_id, note,
//                              candidates: [food] }] }
//
// Deliberately read-only: this endpoint resolves, it never writes. The client
// owns every insert into food_log / food_items, so there's exactly one place
// where the log changes.

import Anthropic from "@anthropic-ai/sdk";
import { searchUsda, searchOff, searchNutritionix, matchScore, readJsonBody } from "./_food.js";

// Haiku is the cheapest tier and this is a well-scoped extraction task: a
// strict JSON schema, a short sentence, and a list of ids to match against.
// Roughly a tenth the cost of running it on Opus. Override with
// FOOD_PARSE_MODEL if matching quality ever disappoints — no code change.
const MODEL = process.env.FOOD_PARSE_MODEL || "claude-haiku-4-5";
const MAX_ITEMS = 12;

// output_config.effort is rejected outright by the older/cheaper models, and
// server-side refusal fallback only exists on the frontier ones. Both are sent
// only where they apply, so switching models via the env var can't start
// 400ing (or, worse, silently cost a wasted round trip on every request).
const SUPPORTS_EFFORT = new Set([
  "claude-opus-5", "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6",
  "claude-sonnet-5", "claude-sonnet-4-6", "claude-fable-5",
]);
const SUPPORTS_REFUSAL_FALLBACK = new Set(["claude-opus-5", "claude-fable-5"]);

const SECTIONS = ["breakfast", "lunch", "snack_early", "snack_late", "dinner", "dessert"];

const PARSE_SCHEMA = {
  type: "object",
  properties: {
    section: {
      type: "string",
      enum: SECTIONS,
      description: "Which meal section these foods belong to.",
    },
    items: {
      type: "array",
      description: "One entry per distinct food mentioned, in the order they were said.",
      items: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Short searchable name for the food, e.g. 'canned tuna in water', 'white rice, cooked', 'saltine crackers'.",
          },
          quantity: { type: "number", description: "How many of the unit below." },
          unit: {
            type: "string",
            description:
              "The unit actually spoken: oz, g, cup, slice, can, cracker, egg, scoop, tbsp… Use 'serving' when no unit was given.",
          },
          history_id: {
            type: "string",
            description:
              "The id of the matching entry from RECENT FOODS, or an empty string when nothing there matches.",
          },
          note: {
            type: "string",
            description: "Short restatement of any assumption you made, or an empty string.",
          },
        },
        required: ["query", "quantity", "unit", "history_id", "note"],
        additionalProperties: false,
      },
    },
  },
  required: ["section", "items"],
  additionalProperties: false,
};

const SYSTEM = `You convert a spoken description of a meal into structured entries for a personal calorie tracker.

Split what was said into one entry per distinct food, in the order spoken.

Quantity and unit:
- Write spoken numbers as digits: "four ounces" -> quantity 4, unit "oz"; "a" or "an" -> 1.
- Use the unit the person actually said. Countable foods keep their own unit ("ten saltine crackers" -> quantity 10, unit "cracker"). A container counts as a unit ("a can of tuna" -> quantity 1, unit "can").
- When no unit is spoken, use "serving".
- Fractions become decimals: "half a cup" -> 0.5, unit "cup".

query: the food itself, without the quantity, in the words a nutrition database would use. Keep preparation words that change the nutrition ("cooked", "grilled", "in water", "2%") and drop ones that don't.

RECENT FOODS: these are foods already in this person's log. If an entry clearly refers to one of them, put that entry's id in history_id — match on the food, never on the quantity, since the amount usually differs. Prefer a recent food over a generic one whenever it plausibly matches; that is the whole point of the list. When nothing matches, history_id must be an empty string.

section: use the section the person named if they named one ("that was for breakfast"). Otherwise infer it from the local time given below, and only fall back to the section they currently have open if the time is genuinely ambiguous.

note: one short clause when you assumed something the person might want to correct (an implied preparation, a guessed portion). Otherwise an empty string.`;

function buildUserMessage({ transcript, localTime, section, history }) {
  const lines = [];
  lines.push(`Local time: ${localTime || "unknown"}`);
  lines.push(`Section currently open in the app: ${SECTIONS.includes(section) ? section : "none"}`);
  lines.push("");
  if (history && history.length) {
    lines.push("RECENT FOODS (id | name | typical serving):");
    for (const h of history.slice(0, 80)) {
      const brand = h.brand ? ` (${h.brand})` : "";
      lines.push(`${h.id} | ${h.name}${brand} | ${h.serving || "1 serving"}`);
    }
  } else {
    lines.push("RECENT FOODS: (none yet)");
  }
  lines.push("");
  lines.push(`What they said: "${String(transcript).trim()}"`);
  return lines.join("\n");
}

// On the frontier models, safety classifiers can decline a request outright;
// server-side fallback re-runs it on another model inside the same call. It's
// a beta, so a rejected beta flag falls back to the plain endpoint rather than
// failing someone's dinner. Models that can't refuse this way skip it entirely
// — attempting it would just buy a guaranteed 400 and a retry on every meal.
async function callClaude(client, params) {
  if (!SUPPORTS_REFUSAL_FALLBACK.has(params.model)) {
    return client.messages.create(params);
  }
  try {
    return await client.beta.messages.create({
      ...params,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
  } catch (e) {
    if (e instanceof Anthropic.BadRequestError || e?.status === 400) {
      return client.messages.create(params);
    }
    throw e;
  }
}

function extractText(message) {
  return (message.content || [])
    .filter(b => b.type === "text")
    .map(b => b.text)
    .join("")
    .trim();
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error: "ANTHROPIC_API_KEY isn't set on the server, so voice entry is off. Add it in your Vercel project settings.",
    });
  }

  const body = readJsonBody(req);
  const transcript = String(body.transcript || "").trim();
  if (!transcript) return res.status(400).json({ error: "Nothing to parse — say or type what you ate." });
  if (transcript.length > 2000) return res.status(400).json({ error: "That's too long to parse in one go." });

  const client = new Anthropic();

  let parsed;
  try {
    const message = await callClaude(client, {
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM,
      output_config: {
        format: { type: "json_schema", schema: PARSE_SCHEMA },
        ...(SUPPORTS_EFFORT.has(MODEL) ? { effort: "low" } : {}),
      },
      messages: [{ role: "user", content: buildUserMessage({ ...body, transcript }) }],
    });

    if (message.stop_reason === "refusal") {
      return res.status(422).json({ error: "That request was declined. Try rewording what you ate." });
    }
    if (message.stop_reason === "max_tokens") {
      return res.status(422).json({ error: "That was too much to parse at once — try it in two goes." });
    }

    const text = extractText(message);
    if (!text) return res.status(502).json({ error: "Got an empty response back — try again." });
    parsed = JSON.parse(text);
  } catch (e) {
    if (e instanceof SyntaxError) {
      return res.status(502).json({ error: "Couldn't read the parsed meal — try again." });
    }
    const status = e?.status && e.status >= 400 && e.status < 600 ? e.status : 502;
    return res.status(status).json({ error: `Couldn't parse that: ${e?.message || "unknown error"}` });
  }

  const historyIds = new Set((body.history || []).map(h => String(h.id)));
  const items = (parsed.items || []).slice(0, MAX_ITEMS).map(item => ({
    query: String(item.query || "").trim(),
    quantity: Number(item.quantity) > 0 ? Number(item.quantity) : 1,
    unit: String(item.unit || "serving").trim() || "serving",
    // Guard against a hallucinated id: anything not actually in the list the
    // model was given falls through to a database search instead.
    history_id: historyIds.has(String(item.history_id)) ? String(item.history_id) : "",
    note: String(item.note || "").trim(),
  })).filter(i => i.query);

  // Only the items history didn't already answer need a database round trip.
  const needsLookup = items.filter(i => !i.history_id);
  const results = await Promise.all(needsLookup.map(async (item) => {
    const settled = await Promise.allSettled([
      searchUsda(item.query, 8),
      searchNutritionix(item.query, 3),
      searchOff(item.query, 4),
    ]);
    const foods = [];
    for (const r of settled) {
      if (r.status === "fulfilled" && !r.value.error) foods.push(...r.value.foods);
    }
    foods.sort((a, b) => matchScore(item.query, b) - matchScore(item.query, a));
    return foods.slice(0, 5);
  }));

  needsLookup.forEach((item, i) => { item.candidates = results[i]; });
  items.forEach(item => { if (!item.candidates) item.candidates = []; });

  const section = SECTIONS.includes(parsed.section)
    ? parsed.section
    : (SECTIONS.includes(body.section) ? body.section : "lunch");

  return res.status(200).json({ section, items, transcript });
}
