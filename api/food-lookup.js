// POST /api/food-lookup
//
// Looks up nutrition facts for a food the databases don't have, by searching
// the web and reading what it finds. Fills in the Custom Food form; it never
// writes anything, and the numbers land in an editable form on purpose.
//
// Body:  { name: string, brand?: string, serving?: string }
// Reply: { nutrition: {...}, sources: [{title, url}], searched: boolean }

import Anthropic from "@anthropic-ai/sdk";
import { readJsonBody } from "./_food.js";

// Web search plus judgement about which sources to trust — a harder task than
// parsing a sentence, and one that runs rarely (only for foods no database
// has). Sonnet is the cheapest tier that reliably reads a nutrition panel off
// an arbitrary page without inventing numbers. Override with
// FOOD_LOOKUP_MODEL.
const MODEL = process.env.FOOD_LOOKUP_MODEL || "claude-sonnet-5";

// Web search can take several round trips, which outruns the default function
// timeout on a quiet day.
export const maxDuration = 60;

// The dynamic-filtering search tool needs a recent model; older ones take the
// basic variant. Sending the wrong one is a 400.
const DYNAMIC_SEARCH_MODELS = new Set([
  "claude-opus-5", "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6",
  "claude-sonnet-5", "claude-sonnet-4-6", "claude-fable-5",
]);

const SUPPORTS_EFFORT = DYNAMIC_SEARCH_MODELS;

// Reporting through a tool rather than output_config.format: structured
// outputs and cited search results don't combine cleanly, and a strict tool
// schema gets the same guarantee — the input is validated before it reaches
// us, so a malformed answer is impossible rather than merely unlikely.
const REPORT_TOOL = {
  name: "report_nutrition",
  description:
    "Report the nutrition facts you found. Call this exactly once, after searching, whether or not you found everything.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      found: {
        type: "boolean",
        description: "false if you could not find credible nutrition data for this food.",
      },
      name: { type: "string", description: "The food's name, tidied up." },
      brand: { type: "string", description: "Brand or restaurant, or an empty string." },
      serving_qty: { type: "number", description: "Size of one serving, as a number." },
      serving_unit: {
        type: "string",
        description: "Unit of one serving as a label states it: 'cup', 'slice', 'bar', 'burrito', 'g'.",
      },
      serving_grams: {
        type: "number",
        description: "What one serving weighs in grams. 0 if the sources don't say.",
      },
      cal: { type: "number", description: "Calories per serving." },
      protein: { type: "number", description: "Grams of protein per serving." },
      carbs: { type: "number", description: "Grams of total carbohydrate per serving." },
      fat: { type: "number", description: "Grams of total fat per serving." },
      confidence: {
        type: "string",
        enum: ["high", "medium", "low"],
        description:
          "high = an official nutrition label or the manufacturer's own page; medium = a reputable aggregator; low = pieced together or estimated from a similar food.",
      },
      note: {
        type: "string",
        description:
          "One short sentence on where the numbers came from, or what you had to assume. Empty string if nothing needs saying.",
      },
    },
    required: [
      "found", "name", "brand", "serving_qty", "serving_unit", "serving_grams",
      "cal", "protein", "carbs", "fat", "confidence", "note",
    ],
    additionalProperties: false,
  },
};

const SYSTEM = `You look up nutrition facts for a single food and report them through the report_nutrition tool.

Search the web first. Prefer, in order: the manufacturer's or restaurant's own nutrition page, an official published nutrition label, then a reputable nutrition database. Treat crowd-sourced entries as weak evidence — people enter them by hand and they are frequently wrong.

Report ONE serving, using the serving the label itself states. If the only figures you can find are per 100 g, report a 100 g serving rather than converting to a portion you are guessing at.

Do not invent numbers. If you cannot find credible data, call the tool with found=false and leave the numbers at 0 — a blank form the person fills in themselves is far better than plausible-looking figures that are wrong, because these get logged and averaged for weeks.

Set confidence honestly, and use the note to say where the numbers came from or what you had to assume. Call report_nutrition exactly once, and do not write a prose answer.`;

function buildPrompt({ name, brand, serving }) {
  const bits = [`Food: ${name}`];
  if (brand) bits.push(`Brand or restaurant: ${brand}`);
  if (serving) bits.push(`Serving the person mentioned: ${serving}`);
  bits.push("", "Find the nutrition facts and report them.");
  return bits.join("\n");
}

function collectSources(content, into) {
  for (const block of content) {
    if (block.type !== "web_search_tool_result") continue;
    // An error result is a single object rather than the usual list.
    if (!Array.isArray(block.content)) continue;
    for (const r of block.content) {
      if (r.url && !into.some(s => s.url === r.url)) {
        into.push({ title: r.title || r.url, url: r.url });
      }
    }
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY isn't set, so nutrition lookup is off." });
  }

  const body = readJsonBody(req);
  const name = String(body.name || "").trim();
  if (!name) return res.status(400).json({ error: "Type a food name first." });
  if (name.length > 200) return res.status(400).json({ error: "That name is too long." });

  const client = new Anthropic();
  const searchTool = DYNAMIC_SEARCH_MODELS.has(MODEL)
    ? { type: "web_search_20260209", name: "web_search", max_uses: 6 }
    : { type: "web_search_20250305", name: "web_search", max_uses: 6 };

  const messages = [{ role: "user", content: buildPrompt({ ...body, name }) }];
  const sources = [];

  try {
    // Server-side search runs inside the model's turn, but a long one comes
    // back as pause_turn and has to be continued — hence the loop rather than
    // a single call.
    for (let turn = 0; turn < 4; turn++) {
      const resp = await client.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: SYSTEM,
        tools: [searchTool, REPORT_TOOL],
        ...(SUPPORTS_EFFORT.has(MODEL) ? { output_config: { effort: "low" } } : {}),
        messages,
      });

      if (resp.stop_reason === "refusal") {
        return res.status(422).json({ error: "That lookup was declined. Enter the numbers by hand." });
      }

      collectSources(resp.content, sources);

      const report = resp.content.find(b => b.type === "tool_use" && b.name === "report_nutrition");
      if (report) {
        const n = report.input;
        if (!n.found) {
          return res.status(200).json({
            nutrition: null,
            sources: sources.slice(0, 4),
            error: n.note || "Couldn't find credible nutrition data for that. Enter it from the label.",
          });
        }
        return res.status(200).json({
          nutrition: {
            name: n.name || name,
            brand: n.brand || "",
            serving_qty: n.serving_qty > 0 ? n.serving_qty : 1,
            serving_unit: n.serving_unit || "serving",
            serving_grams: n.serving_grams > 0 ? n.serving_grams : null,
            cal: Math.max(0, n.cal),
            protein: Math.max(0, n.protein),
            carbs: Math.max(0, n.carbs),
            fat: Math.max(0, n.fat),
            confidence: n.confidence,
            note: n.note,
          },
          sources: sources.slice(0, 4),
        });
      }

      // Still working (a paused search, or thinking between searches).
      messages.push({ role: "assistant", content: resp.content });
      if (resp.stop_reason === "end_turn") {
        // It answered in prose instead of calling the tool — ask once, plainly.
        messages.push({
          role: "user",
          content: "Report what you found by calling report_nutrition now, with found=false if you came up empty.",
        });
      }
    }

    return res.status(504).json({ error: "The lookup took too long. Enter the numbers by hand." });
  } catch (e) {
    const status = e?.status && e.status >= 400 && e.status < 600 ? e.status : 502;
    return res.status(status).json({ error: `Lookup failed: ${e?.message || "unknown error"}` });
  }
}
