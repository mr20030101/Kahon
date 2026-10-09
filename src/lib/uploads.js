// Cleaning files before they're attached: check that the bytes match the extension, give
// them a safe name, and re-encode images. Re-encoding drops EXIF (GPS location, camera
// details) and anything else riding along in the file, and shrinks big photos.

// Images larger than this are too big to open in a browser tab; smaller ones are compressed
// down to the 25 MB attachment limit.
export const MAX_IMAGE_INPUT_BYTES = 100 * 1024 * 1024;
// Longest side of an attached image. Plenty for screenshots and photos on any screen.
export const MAX_IMAGE_EDGE = 3200;
// PNGs up to this size (and within MAX_IMAGE_EDGE) stay lossless PNG, so screenshots stay crisp.
const KEEP_PNG_BYTES = 2 * 1024 * 1024;
// Re-encoded images aim to be no larger than this; quality and size step down until they are.
const TARGET_IMAGE_BYTES = 4 * 1024 * 1024;

const ascii = (bytes, start, text) => [...text].every((ch, i) => bytes[start + i] === ch.charCodeAt(0));
const startsWith = (bytes, sig) => sig.every((b, i) => bytes[i] === b);

// What the first bytes of each allowed extension must look like.
const SIGNATURES = {
  png: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  jpg: (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  gif: (b) => ascii(b, 0, 'GIF87a') || ascii(b, 0, 'GIF89a'),
  webp: (b) => ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP'),
  pdf: (b) => {
    // "%PDF-" should come first, but some generators put a few bytes before it.
    for (let i = 0; i <= Math.min(b.length - 5, 1024); i += 1) if (ascii(b, i, '%PDF-')) return true;
    return false;
  },
  zip: (b) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]), // docx, xlsx, pptx and the OpenDocument formats
  ole: (b) => startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), // doc, xls, ppt
  rtf: (b) => ascii(b, 0, '{\\rtf'),
  text: (b) => !b.includes(0), // plain text never has NUL bytes
};

const SIGNATURE_FOR_EXT = {
  png: 'png', jpg: 'jpg', jpeg: 'jpg', gif: 'gif', webp: 'webp', pdf: 'pdf',
  docx: 'zip', xlsx: 'zip', pptx: 'zip', odt: 'zip', ods: 'zip', odp: 'zip',
  doc: 'ole', xls: 'ole', ppt: 'ole',
  rtf: 'rtf', txt: 'text', md: 'text', csv: 'text',
};

/** True when `bytes` (the start of a file) look like a real file of type `ext`. */
export function matchesSignature(bytes, ext) {
  const check = SIGNATURES[SIGNATURE_FOR_EXT[ext]];
  return !!check && check(bytes);
}

// Control characters, characters Windows and macOS forbid in names, and bidi overrides that
// can disguise an extension ("photo‮gnp.exe" displays as "photoexe.png").
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u001f\u007f<>:"/\\|?*‎‏‪-‮⁦-⁩]/g;

/** A safe display name ending in `ext`, built from whatever the file was called. */
export function cleanFileName(name, ext) {
  const tidy = (s) => s.replace(/\s+/g, ' ').replace(/^[\s.]+|[\s.]+$/g, '');
  const safe = tidy(String(name || '').normalize('NFC').replace(UNSAFE_CHARS, ''));
  // Drop the old extension (the stored one may differ, e.g. a JPEG saved as WebP), but only
  // something that looks like one, and never the whole name.
  const base = tidy(safe.replace(/\.[a-z0-9]{1,10}$/i, '')) || safe;
  return `${base.slice(0, 200) || 'file'}.${ext}`;
}

/** Width and height that fit within `maxEdge` on the longest side, never upscaled. */
export function fitWithin(width, height, maxEdge) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Reads the first bytes of a file and checks them against its extension. */
export async function hasValidSignature(file, ext) {
  const bytes = new Uint8Array(await file.slice(0, 8192).arrayBuffer());
  return matchesSignature(bytes, ext);
}

const toBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

/**
 * Re-encodes an image (not GIFs, which would lose their animation), resizing and compressing
 * it as needed. Returns { blob, ext, mime }. Throws when the file can't be read as an image.
 */
export async function processImage(file, ext) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file); // applies EXIF rotation, so photos stay upright
  } catch {
    throw new Error("it isn't a readable image, or it's too large to process");
  }

  try {
    let lossless = ext === 'png' && file.size <= KEEP_PNG_BYTES
      && Math.max(bitmap.width, bitmap.height) <= MAX_IMAGE_EDGE;
    let edge = MAX_IMAGE_EDGE;
    let quality = 0.85;
    let best = null;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const size = fitWithin(bitmap.width, bitmap.height, edge);
      const canvas = document.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, size.width, size.height);

      let out;
      if (lossless) {
        out = { blob: await toBlob(canvas, 'image/png'), ext: 'png', mime: 'image/png' };
      } else {
        const webp = await toBlob(canvas, 'image/webp', quality);
        // Safari can't encode WebP: JPEG for photos, PNG where transparency may matter.
        out = webp?.type === 'image/webp'
          ? { blob: webp, ext: 'webp', mime: 'image/webp' }
          : ext === 'jpg' || ext === 'jpeg'
            ? { blob: await toBlob(canvas, 'image/jpeg', quality), ext: 'jpg', mime: 'image/jpeg' }
            : { blob: await toBlob(canvas, 'image/png'), ext: 'png', mime: 'image/png' };
      }
      canvas.width = 0; // free the canvas memory straight away
      if (!out.blob) throw new Error('your browser could not process this image');
      if (!best || out.blob.size < best.blob.size) best = out;
      if (best.blob.size <= TARGET_IMAGE_BYTES) break;
      if (lossless) {
        // A noisy PNG can grow when re-encoded; fall back to lossy at full size.
        lossless = false;
        continue;
      }
      quality = Math.max(0.6, quality - 0.1);
      edge = Math.round(edge * 0.8);
    }
    return best;
  } finally {
    bitmap.close?.();
  }
}
