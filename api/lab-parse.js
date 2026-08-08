// POST /api/lab-parse
//
// Reads a lab report — a PDF from the portal, or a photo/screenshot of one —
// and returns the markers it prints, with their units and reference ranges.
//
// Body:  { file: base64 (no data: prefix), media_type, file_name? }
// Reply: { panel: {...}, results: [...] } or { panel: null, error }
//
// Like the other AI endpoints this only reads. Nothing is written until the
// person looks at the extracted rows and presses Save — which matters more
// here than anywhere else in the app, because a misread lab value is a number
// you might act on.

import Anthropic from "@anthropic-ai/sdk";
import { readJsonBody } from "./_food.js";

// A lab report is a dense grid of numbers where a misread digit is both
// silent and consequential, so this doesn't run on the cheapest tier. It also
// runs a handful of times a year, not several times a day. Set
// LAB_PARSE_MODEL=claude-opus-5 if you want the ceiling instead.
const MODEL = process.env.LAB_PARSE_MODEL || "claude-sonnet-5";

// Multi-page panels take a while to read; well under Vercel's ceiling.
export const maxDuration = 60;

const SUPPORTS_EFFORT = new Set([
  "claude-opus-5", "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6",
  "claude-sonnet-5", "claude-sonnet-4-6", "claude-fable-5",
]);

const IMAGE_MEDIA = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const PDF_MEDIA = "application/pdf";

// Quest prints how a number was derived next to the unit — "mg/dL (calc)",
// or a bare "(calc)" where there is no unit at all. It's a note about the
// method, not a unit, and left in place it shows up on every chart axis and
// every row as though "(calc)" were the thing being measured.
const CALC_NOTE = /^\(?\s*(calc|calc\.|calculated)\s*\)?$/i;

export function cleanUnit(raw) {
  let u = String(raw || "").trim();
  for (let i = 0; i < 3; i++) {
    const m = u.match(/^(.*?)\s*\(([^()]*)\)$/);
    if (!m || !CALC_NOTE.test(m[2])) break;
    u = m[1].trim();
  }
  return CALC_NOTE.test(u) ? "" : u;
}

/**
 * A reference range that is only a parenthesised unit — "(mg/dL (calc))",
 * "(ng/mL)" — is not a range. The app prints ref_text verbatim, so left alone
 * it renders as this marker's reference range, which the report never gave.
 * Qualitative ranges ("NEGATIVE", "NON-REACTIVE") are real and stay.
 */
export function cleanRefText(raw) {
  const t = String(raw || "").trim();
  if (!t) return "";
  if (/^\(.*\)$/.test(t) && !/\d/.test(t)) return "";
  return t;
}

// A number the report may simply not print — ranges are missing on plenty of
// calculated values, and a result can be qualitative ("Negative").
const nullableNumber = (description) => ({
  anyOf: [{ type: "number" }, { type: "null" }],
  description,
});

const RESULT_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "The test name exactly as the report prints it." },
    value: nullableNumber("The numeric result. null when the result isn't a number (e.g. 'Negative', '<0.2')."),
    value_text: {
      type: "string",
      description: "The result verbatim when it isn't a plain number — 'Negative', '<0.2', 'TNP'. Empty string otherwise.",
    },
    unit: { type: "string", description: "Unit as printed — mg/dL, ng/mL, %, K/uL. Empty string if none." },
    ref_low: nullableNumber("Low end of the printed reference range. null if the range is one-sided or absent."),
    ref_high: nullableNumber("High end of the printed reference range. null if the range is one-sided or absent."),
    ref_text: {
      type: "string",
      description: "The reference range verbatim, including any wording — '70-99', '<5.7', 'Not Estab.'. Empty string if none printed.",
    },
    flag: {
      type: "string",
      enum: ["low", "high", "normal", "none"],
      description: "The report's own flag (L/H/Low/High/Abnormal). 'none' when the report prints no flag — don't infer one.",
    },
  },
  required: ["name", "value", "value_text", "unit", "ref_low", "ref_high", "ref_text", "flag"],
  additionalProperties: false,
};

const PARSE_SCHEMA = {
  type: "object",
  properties: {
    found: { type: "boolean", description: "false if this isn't a lab report, or is too unclear to read reliably." },
    collected_date: {
      type: "string",
      description: "The COLLECTION / draw date as YYYY-MM-DD. Empty string if not printed. Prefer collection date over reported/printed date.",
    },
    lab_name: { type: "string", description: "Lab or clinic that ran it — Quest, LabCorp, a hospital. Empty string if not shown." },
    panel_name: { type: "string", description: "Panel title if the report gives one, e.g. 'Comprehensive Metabolic Panel'. Empty string otherwise." },
    results: { type: "array", items: RESULT_SCHEMA, description: "Every test result on the report." },
    fasting: {
      type: "string",
      enum: ["yes", "no", "unknown"],
      description: "Only if the report explicitly states fasting status (many print 'FASTING: Y'). 'unknown' otherwise — never infer it from the tests ordered.",
    },
    confidence: {
      type: "string",
      enum: ["high", "medium", "low"],
      description: "high = clean digital report; low = blur, glare, cut-off columns, or ambiguous alignment.",
    },
    note: {
      type: "string",
      description: "One or two short sentences on anything you couldn't read or had to judge. Empty string if all clean.",
    },
  },
  required: ["found", "collected_date", "lab_name", "panel_name", "results", "fasting", "confidence", "note"],
  additionalProperties: false,
};

const PROMPT = `Read this lab report and list every test result it prints.

Rules:
- Report what is printed. Do not convert units, do not compute values the report doesn't state, and do not fill in a reference range from your own knowledge — only the range this report prints for this test.
- Keep the lab's own test names verbatim, including qualifiers like "(calc)" or "Direct". The app maps them to its own names afterwards; your job is fidelity, not tidiness.
- Take the value and the reference range from the same row. Lab reports are multi-column grids and rows can be tall — if a row's alignment is genuinely ambiguous, leave that result out and say so in the note rather than pairing a value with the wrong range.
- A one-sided range ("<5.7", ">59") sets only the relevant bound; put the full text in ref_text either way.
- flag reflects the report's own L/H/abnormal marking. If the report prints no flag, use "none" — the app derives its own from the range.
- Non-numeric results belong in value_text with value null. Don't invent a number for "Negative" or "TNP".
- Include every panel in the document — a single PDF often carries a CBC, a metabolic panel, and a lipid panel together. Multi-page reports: read all pages.
- Skip page headers, patient demographics, physician notes, and methodology footnotes. Results only.
- Some reports print whether the draw was fasting. Report it if it is printed; otherwise "unknown". Ordering a lipid panel is not evidence of fasting.
- If the document isn't a lab report, or the numbers can't be read reliably, set found=false. A person retaking the photo costs seconds; a wrong lab value is one you might act on.`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY isn't set, so reading lab files is off." });
  }

  const body = readJsonBody(req);
  const data = String(body.file || "");
  const mediaType = String(body.media_type || "");
  if (!data) return res.status(400).json({ error: "No file received." });

  const isPdf = mediaType === PDF_MEDIA;
  if (!isPdf && !IMAGE_MEDIA.has(mediaType)) {
    return res.status(400).json({ error: "Send a PDF or an image of the report." });
  }
  // Vercel caps a serverless request body at 4.5MB; base64 is ~4/3 of the raw
  // bytes, so this is roughly a 3MB file. The client checks first and says so
  // in plainer words — this is the backstop.
  if (data.length > 4_000_000) {
    return res.status(413).json({ error: "That file is too big — try a single report, or a photo instead of a scan." });
  }

  const client = new Anthropic();

  const fileBlock = isPdf
    ? { type: "document", source: { type: "base64", media_type: PDF_MEDIA, data } }
    : { type: "image", source: { type: "base64", media_type: mediaType, data } };

  try {
    const message = await client.messages.create({
      model: MODEL,
      // A full panel can run 60+ markers; this leaves room without streaming.
      max_tokens: 16000,
      output_config: {
        format: { type: "json_schema", schema: PARSE_SCHEMA },
        ...(SUPPORTS_EFFORT.has(MODEL) ? { effort: "medium" } : {}),
      },
      messages: [{
        role: "user",
        // File first, rules second — same order as the label reader.
        content: [fileBlock, { type: "text", text: PROMPT }],
      }],
    });

    if (message.stop_reason === "refusal") {
      return res.status(422).json({ error: "That file was declined. You can enter the results by hand." });
    }
    if (message.stop_reason === "max_tokens") {
      return res.status(200).json({
        panel: null,
        error: "That report is longer than one read can hold. Split it into separate files and try again.",
      });
    }

    const text = (message.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
    if (!text) return res.status(502).json({ error: "Got an empty response — try again." });

    const parsed = JSON.parse(text);
    if (!parsed.found || !Array.isArray(parsed.results) || parsed.results.length === 0) {
      return res.status(200).json({
        panel: null,
        error: parsed.note || "Couldn't find lab results in that file. Try a clearer photo, or enter them by hand.",
      });
    }

    return res.status(200).json({
      panel: {
        collected_date: parsed.collected_date || "",
        lab_name: parsed.lab_name || "",
        panel_name: parsed.panel_name || "",
        source: isPdf ? "pdf" : "image",
        file_name: String(body.file_name || ""),
        confidence: parsed.confidence,
        note: parsed.note || "",
        fasting: parsed.fasting === "yes" || parsed.fasting === "no" ? parsed.fasting : "",
      },
      results: parsed.results
        .filter(r => r && String(r.name || "").trim())
        .map(r => ({
          name: String(r.name).trim(),
          value: Number.isFinite(r.value) ? r.value : null,
          value_text: r.value_text || "",
          unit: cleanUnit(r.unit),
          ref_low: Number.isFinite(r.ref_low) ? r.ref_low : null,
          ref_high: Number.isFinite(r.ref_high) ? r.ref_high : null,
          ref_text: cleanRefText(r.ref_text),
          // "none" is the model saying the report printed no flag; the app
          // derives its own from the range, so it must not become a value.
          flag: r.flag && r.flag !== "none" ? r.flag : null,
        })),
    });
  } catch (e) {
    if (e instanceof SyntaxError) {
      return res.status(502).json({ error: "Couldn't read the response — try again." });
    }
    const status = e?.status && e.status >= 400 && e.status < 600 ? e.status : 502;
    return res.status(status).json({ error: `Couldn't read that report: ${e?.message || "unknown error"}` });
  }
}
