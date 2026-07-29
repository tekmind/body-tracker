// Prepares a lab report for the reader endpoint.
//
// Two shapes arrive here: a PDF straight from the lab's portal, which goes up
// as-is because its text is already crisp, and a photo or screenshot, which
// gets downscaled on the device first.
//
// Lab reports are dense small type, so images are allowed a longer edge than
// a nutrition label gets — 1600px turns a two-column result grid into mush.

import { fileToScaledJpeg } from "./labelPhoto.js";

const PDF = "application/pdf";
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

// Base64 is ~4/3 of the raw bytes, and the serverless request body caps at
// 4.5MB. Leave headroom for the JSON envelope.
const MAX_BASE64 = 3_900_000;

const MAX_IMAGE_EDGE = 2200;

/** What the file picker should offer. */
export const ACCEPTED_FILE_TYPES = [PDF, ...IMAGE_TYPES].join(",");

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      if (comma < 0) reject(new Error("Couldn't read that file."));
      else resolve(result.slice(comma + 1));
    };
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.readAsDataURL(file);
  });
}

function looksLikePdf(file) {
  return file.type === PDF || /\.pdf$/i.test(file.name || "");
}

/**
 * Returns { file: base64 (no data: prefix), media_type, file_name }.
 * Throws with a message worth showing when the file can't be sent.
 */
export async function prepareLabFile(file) {
  if (looksLikePdf(file)) {
    const data = await readAsBase64(file);
    if (data.length > MAX_BASE64) {
      throw new Error(
        `"${file.name}" is too large to send. Lab portals often offer a smaller "results only" PDF — or screenshot the results pages instead.`
      );
    }
    return { file: data, media_type: PDF, file_name: file.name || "report.pdf" };
  }

  if (!file.type.startsWith("image/")) {
    throw new Error(`"${file.name}" isn't a PDF or an image.`);
  }

  const { data, mediaType } = await fileToScaledJpeg(file, MAX_IMAGE_EDGE);
  if (data.length > MAX_BASE64) {
    throw new Error(`"${file.name}" is too large even after shrinking — try photographing one page at a time.`);
  }
  return { file: data, media_type: mediaType, file_name: file.name || "report.jpg" };
}
