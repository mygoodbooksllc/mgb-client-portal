// Staff profile photos: browser image helpers (spec docs/staff-photo-spec.md, Part E2).
//
// Everything is re-encoded through a canvas, which drops all metadata (EXIF,
// GPS). Nothing reads or uploads the original file bytes. Pure sizing rules
// live in staffPhotoLogic.js (SP_fitWithin, SP_cropRect, SP_tooSmall).

function SPI_err(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

function SPI_canvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function SPI_toBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(SPI_err("encode", "Couldn't prepare that photo. Try another one."))),
      type,
      quality
    );
  });
}

function SPI_loadViaImg(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      // The <img> path applies EXIF orientation in current browsers (image-orientation: from-image).
      // Loaded and decoded, so the blob URL can go (the element stays drawable).
      URL.revokeObjectURL(url);
      resolve({ source: img, width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("decode"));
    };
    img.src = url;
  });
}

// -> {source, width, height}. source is an ImageBitmap or HTMLImageElement,
// EXIF orientation applied. .code is "heic" or "decode" on failure.
async function SPI_loadImage(file) {
  let res = null;
  try {
    if (typeof createImageBitmap === "function") {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      res = { source: bmp, width: bmp.width, height: bmp.height };
    }
  } catch (e) {
    res = null;
  }
  if (!res) {
    try {
      res = await SPI_loadViaImg(file);
    } catch (e) {
      res = null;
    }
  }
  if (!res || !(res.width > 0) || !(res.height > 0)) {
    const heic = typeof SP_isHeic === "function" && SP_isHeic({ type: file && file.type, name: file && file.name });
    throw heic
      ? SPI_err("heic", "This photo is in HEIC format, which this browser can't open.")
      : SPI_err("decode", "That file doesn't look like a photo this browser can open.");
  }
  return { source: res.source, width: res.width, height: res.height };
}

// Longest side <= 2048, JPEG q0.9 stepping down to 0.8 then 0.7 while over 4.5 MB.
async function SPI_encodeOriginal(src) {
  const fit = SP_fitWithin(src.width, src.height, SP_LIMITS.originalMaxSide);
  const canvas = SPI_canvas(fit.w, fit.h);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, fit.w, fit.h);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src.source, 0, 0, src.width, src.height, 0, 0, fit.w, fit.h);
  const limit = 4.5 * 1024 * 1024;
  const qualities = [0.9, 0.8, 0.7];
  let blob = null;
  for (let i = 0; i < qualities.length; i++) {
    blob = await SPI_toBlob(canvas, "image/jpeg", qualities[i]);
    if (blob.size <= limit) break;
  }
  return blob;
}

// 512 x 512 JPEG q0.9 from rect = {sx, sy, sSize} (SP_cropRect). White fill first.
async function SPI_encodeCrop(src, rect, size) {
  const px = size || SP_LIMITS.currentSize;
  const canvas = SPI_canvas(px, px);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, px, px);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src.source, rect.sx, rect.sy, rect.sSize, rect.sSize, 0, 0, px, px);
  return SPI_toBlob(canvas, "image/jpeg", 0.9);
}

// An admin's edited photo: center-crop to a square, 512 x 512 on a transparent
// canvas, PNG. hasAlpha = any sampled pixel with alpha < 250.
async function SPI_normalizeEdited(file) {
  const src = await SPI_loadImage(file);
  const short = Math.min(src.width, src.height);
  if (short < SP_LIMITS.minSide) throw SPI_err("small", "This photo is too small. Choose one at least 400 × 400 pixels.");
  const px = SP_LIMITS.currentSize;
  const canvas = SPI_canvas(px, px);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, px, px);
  ctx.imageSmoothingQuality = "high";
  const sx = Math.round((src.width - short) / 2);
  const sy = Math.round((src.height - short) / 2);
  ctx.drawImage(src.source, sx, sy, short, short, 0, 0, px, px);
  let hasAlpha = false;
  try {
    const data = ctx.getImageData(0, 0, px, px).data;
    // Every 4th pixel: 16 bytes per step, alpha is the 4th byte.
    for (let i = 3; i < data.length; i += 16) {
      if (data[i] < 250) {
        hasAlpha = true;
        break;
      }
    }
  } catch (e) {
    hasAlpha = false;
  }
  const blob = await SPI_toBlob(canvas, "image/png");
  return { blob, width: px, height: px, hasAlpha };
}

function SPI_downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "photo";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
