// Prepares a camera photo for the label reader.
//
// Phone cameras produce 4000px, multi-megabyte JPEGs. Sending one raw would
// risk the request-size limit and cost far more to read than it's worth — a
// nutrition panel is legible at a fraction of that. Downscaling happens on the
// device, so the big original never leaves it.

const MAX_EDGE = 1600;
const QUALITY = 0.85;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That file isn't an image I can read.")); };
    img.src = url;
  });
}

/**
 * Returns { data, mediaType } where data is bare base64 JPEG — no data: prefix,
 * which is what the Messages API wants.
 */
export async function fileToScaledJpeg(file, maxEdge = MAX_EDGE) {
  const img = await loadImage(file);
  const longest = Math.max(img.naturalWidth, img.naturalHeight);
  const scale = longest > maxEdge ? maxEdge / longest : 1;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext("2d");
  // Labels are small type; smoothing is what keeps digits readable when the
  // photo shrinks.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const dataUrl = canvas.toDataURL("image/jpeg", QUALITY);
  const comma = dataUrl.indexOf(",");
  if (comma < 0) throw new Error("Couldn't process that photo.");
  return { data: dataUrl.slice(comma + 1), mediaType: "image/jpeg" };
}
