// POST /api/food-label
//
// Reads a photo of a Nutrition Facts panel and returns the numbers printed on
// it. This is the most reliable way to add a food: the package is the source
// of truth, and it sidesteps databases that have the serving wrong.
//
// Body:  { image: base64 string (no data: prefix), media_type, name?, brand? }
// Reply: { nutrition: {...} } or { nutrition: null, error }
//
// Like the other AI endpoints this only reads — the numbers land in the
// editable form, and nothing is stored until the person saves it.

import Anthropic from "@anthropic-ai/sdk";
import { readJsonBody } from "./_food.js";

// Misreading a label is silent and durable: a wrong number here repeats every
// time that food is logged. Vision plus careful digit reading is worth more
// than the cheapest tier, and this runs once per new food rather than per
// meal. Override with FOOD_LABEL_MODEL.
const MODEL = process.env.FOOD_LABEL_MODEL || "claude-sonnet-5";

export const maxDuration = 30;

const SUPPORTS_EFFORT = new Set([
  "claude-opus-5", "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6",
  "claude-sonnet-5", "claude-sonnet-4-6", "claude-fable-5",
]);

const ALLOWED_MEDIA = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const LABEL_SCHEMA = {
  type: "object",
  properties: {
    found: {
      type: "boolean",
      description: "false if this isn't a nutrition label, or it's too unclear to read reliably.",
    },
    name: { type: "string", description: "Product name if visible in the photo, else an empty string." },
    brand: { type: "string", description: "Brand if visible, else an empty string." },
    serving_qty: { type: "number", description: "The number in 'Serving size' — 1 for '1 stick', 2 for '2 cookies'." },
    serving_unit: {
      type: "string",
      description:
        "The household unit from 'Serving size' — stick, cookie, cup, slice, bar, container. Use 'g' only when the serving is given purely as a weight.",
    },
    serving_grams: {
      type: "number",
      description: "Grams for ONE serving, from the parenthetical like '(32g)'. 0 if no gram weight is printed.",
    },
    servings_per_container: { type: "number", description: "From 'servings per container'. 0 if not printed." },
    cal: { type: "number", description: "Calories per serving." },
    protein: { type: "number", description: "Protein grams per serving." },
    carbs: { type: "number", description: "Total Carbohydrate grams per serving — not net carbs." },
    fat: { type: "number", description: "Total Fat grams per serving — not saturated." },
    confidence: {
      type: "string",
      enum: ["high", "medium", "low"],
      description: "high = every figure clearly legible; low = glare, blur, or a partly cut-off panel.",
    },
    note: {
      type: "string",
      description: "One short sentence naming anything you couldn't read or had to judge. Empty string if all clean.",
    },
  },
  required: [
    "found", "name", "brand", "serving_qty", "serving_unit", "serving_grams",
    "servings_per_container", "cal", "protein", "carbs", "fat", "confidence", "note",
  ],
  additionalProperties: false,
};

const PROMPT = `Read the Nutrition Facts panel in this photo and report exactly what it prints for ONE serving.

The photo may be rotated, angled, or catching glare — read it as it is.

Rules:
- Report the printed numbers. Do not convert between units, do not scale to 100 g, and do not calculate anything the label doesn't state.
- Serving size: take the count and the household unit as written. "1 stick (32g / 1.15oz)" is serving_qty 1, serving_unit "stick", serving_grams 32. Take grams from the gram figure, never from the ounces.
- Use Total Fat, not saturated. Use Total Carbohydrate, not net carbs or sugars.
- If a figure is illegible, set found=false rather than guessing. A person retaking the photo costs seconds; a wrong number here quietly skews every day this food is logged in.
- Set confidence honestly, and use note for anything you had to judge.`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY isn't set, so label reading is off." });
  }

  const body = readJsonBody(req);
  const image = String(body.image || "");
  const mediaType = String(body.media_type || "image/jpeg");
  if (!image) return res.status(400).json({ error: "No photo received." });
  if (!ALLOWED_MEDIA.has(mediaType)) return res.status(400).json({ error: "That image format isn't supported." });
  // Base64 is ~4/3 of the raw bytes; the client downscales well below this.
  if (image.length > 6_000_000) return res.status(413).json({ error: "That photo is too large — try again." });

  const client = new Anthropic();

  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      output_config: {
        format: { type: "json_schema", schema: LABEL_SCHEMA },
        ...(SUPPORTS_EFFORT.has(MODEL) ? { effort: "low" } : {}),
      },
      messages: [{
        role: "user",
        content: [
          // Image before text: the model reads the panel, then the rules.
          { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
          { type: "text", text: PROMPT },
        ],
      }],
    });

    if (message.stop_reason === "refusal") {
      return res.status(422).json({ error: "That image was declined. Enter the numbers by hand." });
    }

    const text = (message.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
    if (!text) return res.status(502).json({ error: "Got an empty response — try the photo again." });

    const n = JSON.parse(text);
    if (!n.found) {
      return res.status(200).json({
        nutrition: null,
        error: n.note || "Couldn't read that label clearly. Try again with less glare, or type the numbers in.",
      });
    }

    return res.status(200).json({
      nutrition: {
        name: n.name || "",
        brand: n.brand || "",
        serving_qty: n.serving_qty > 0 ? n.serving_qty : 1,
        serving_unit: n.serving_unit || "serving",
        serving_grams: n.serving_grams > 0 ? n.serving_grams : null,
        servings_per_container: n.servings_per_container > 0 ? n.servings_per_container : null,
        cal: Math.max(0, n.cal),
        protein: Math.max(0, n.protein),
        carbs: Math.max(0, n.carbs),
        fat: Math.max(0, n.fat),
        confidence: n.confidence,
        note: n.note,
      },
    });
  } catch (e) {
    if (e instanceof SyntaxError) {
      return res.status(502).json({ error: "Couldn't read the response — try again." });
    }
    const status = e?.status && e.status >= 400 && e.status < 600 ? e.status : 502;
    return res.status(status).json({ error: `Couldn't read that label: ${e?.message || "unknown error"}` });
  }
}
