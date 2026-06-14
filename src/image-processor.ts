/**
 * Image processor: source bitmap -> luminance buffer in [0,1].
 *
 * Pure functions; no DOM dependencies for the math. The browser-side helper
 * decodeImageToRgba uses canvas to read pixels but is isolated so the rest
 * of the module can be tested headlessly.
 */

import type { Params } from './store';

/** Nearest-neighbor resample of a Float32Array heightmap. */
export function resampleFloat32(
  src: Float32Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Float32Array {
  if (srcW === dstW && srcH === dstH) return src;
  const out = new Float32Array(dstW * dstH);
  const sx = srcW / dstW;
  const sy = srcH / dstH;
  for (let y = 0; y < dstH; y++) {
    const srcY = Math.min(srcH - 1, Math.floor(y * sy));
    for (let x = 0; x < dstW; x++) {
      const srcX = Math.min(srcW - 1, Math.floor(x * sx));
      out[y * dstW + x] = src[srcY * srcW + srcX];
    }
  }
  return out;
}

/** Bilinear resample of a Float32Array heightmap — preserves more detail than nearest-neighbor. */
export function resampleFloat32Bilinear(
  src: Float32Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Float32Array {
  if (srcW === dstW && srcH === dstH) return src;
  const out = new Float32Array(dstW * dstH);
  for (let y = 0; y < dstH; y++) {
    const fy = (y + 0.5) * (srcH / dstH) - 0.5;
    const y0 = Math.max(0, Math.floor(fy));
    const y1 = Math.min(srcH - 1, y0 + 1);
    const dy = fy - y0;
    for (let x = 0; x < dstW; x++) {
      const fx = (x + 0.5) * (srcW / dstW) - 0.5;
      const x0 = Math.max(0, Math.floor(fx));
      const x1 = Math.min(srcW - 1, x0 + 1);
      const dx = fx - x0;
      const v00 = src[y0 * srcW + x0];
      const v10 = src[y0 * srcW + x1];
      const v01 = src[y1 * srcW + x0];
      const v11 = src[y1 * srcW + x1];
      out[y * dstW + x] = v00 * (1 - dx) * (1 - dy) + v10 * dx * (1 - dy) + v01 * (1 - dx) * dy + v11 * dx * dy;
    }
  }
  return out;
}

/**
 * Apply the image-adjustment chain (mirror → invert → brightness → contrast
 * → gamma → smoothing) to an already-grayscale Float32Array in [0,1].
 * Always returns a new buffer; never mutates src.
 */
export function applyImageParams(
  src: Float32Array,
  W: number,
  H: number,
  p: Params,
): Luminance {
  const out = src.slice();

  if (p.mirror) {
    for (let y = 0; y < H; y++) {
      const row = y * W;
      for (let x = 0; x < W / 2; x++) {
        const a = row + x, b = row + (W - 1 - x);
        const t = out[a]; out[a] = out[b]; out[b] = t;
      }
    }
  }

  if (p.invert) {
    for (let i = 0; i < out.length; i++) out[i] = 1 - out[i];
  }

  const bAdd = p.brightness / 100;
  if (bAdd !== 0) {
    for (let i = 0; i < out.length; i++) out[i] = clamp01(out[i] + bAdd);
  }

  const c = (p.contrast + 100) / 100;
  if (c !== 1) {
    for (let i = 0; i < out.length; i++) out[i] = clamp01((out[i] - 0.5) * c + 0.5);
  }

  const g = p.gamma;
  if (g !== 1) {
    for (let i = 0; i < out.length; i++) out[i] = Math.pow(out[i], g);
  }

  const r = Math.max(0, Math.round(p.smoothingPx));
  if (r > 0) return { width: W, height: H, data: boxBlur(out, W, H, r) };
  return { width: W, height: H, data: out };
}

export type Rgba = {
  width: number;
  height: number;
  data: Uint8ClampedArray; // length = width*height*4
};

export type Luminance = {
  width: number;
  height: number;
  data: Float32Array; // 0..1
};

function isHeic(blob: Blob): boolean {
  if (blob.type === 'image/heic' || blob.type === 'image/heif') return true;
  const name = ((blob as File).name ?? '').toLowerCase();
  return name.endsWith('.heic') || name.endsWith('.heif');
}

// Try three paths in order — each covers a different browser/version.
async function bitmapForHeic(blob: Blob): Promise<ImageBitmap> {
  // 1. Safari: createImageBitmap handles HEIC natively.
  try { return await createImageBitmap(blob); } catch { /* continue */ }

  // 2. Chrome 94+ on macOS: ImageDecoder with explicit MIME type routes through the
  //    platform codec, which supports HEIC even when createImageBitmap doesn't.
  const ImageDecoder = (window as any).ImageDecoder;
  if (typeof ImageDecoder !== 'undefined') {
    try {
      const type = blob.type || 'image/heic';
      if (await ImageDecoder.isTypeSupported(type)) {
        const dec = new ImageDecoder({ data: blob.stream(), type });
        const { image } = await dec.decode();
        const bmp = await createImageBitmap(image as ImageBitmap);
        (image as any).close?.();
        dec.close();
        return bmp;
      }
    } catch { /* continue */ }
  }

  // 3. <img> element fallback (Chrome 105+ serves HEIC via object URL on macOS).
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = rej; img.src = url; });
    return await createImageBitmap(img);
  } catch {
    throw new Error('HEIC not supported in this browser. Try Safari.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Decode a File/Blob to RGBA pixels via an offscreen canvas. */
export async function decodeImageToRgba(source: Blob): Promise<Rgba> {
  const bmp = await (isHeic(source) ? bitmapForHeic(source) : createImageBitmap(source));
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
  return { width: img.width, height: img.height, data: img.data };
}

/** Resample to target dimensions (nearest-neighbor for speed; good enough for preview). */
export function resampleRgba(src: Rgba, targetW: number, targetH: number): Rgba {
  if (src.width === targetW && src.height === targetH) return src;
  const out = new Uint8ClampedArray(targetW * targetH * 4);
  const sx = src.width / targetW;
  const sy = src.height / targetH;
  for (let y = 0; y < targetH; y++) {
    const srcY = Math.min(src.height - 1, Math.floor(y * sy));
    for (let x = 0; x < targetW; x++) {
      const srcX = Math.min(src.width - 1, Math.floor(x * sx));
      const si = (srcY * src.width + srcX) * 4;
      const di = (y * targetW + x) * 4;
      out[di] = src.data[si];
      out[di + 1] = src.data[si + 1];
      out[di + 2] = src.data[si + 2];
      out[di + 3] = src.data[si + 3];
    }
  }
  return { width: targetW, height: targetH, data: out };
}

/** Raw Rec.709 grayscale from RGBA, no image adjustments — used for blending. */
export function rgbaToGrey(src: Rgba): Float32Array {
  const { data } = src;
  const grey = new Float32Array(src.width * src.height);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    grey[j] = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
  }
  return grey;
}

/**
 * Convert RGBA pixels to a luminance buffer in [0,1] applying the chain:
 *   grayscale -> mirror -> invert -> brightness -> contrast -> gamma -> smoothing
 */
export function rgbaToLuminance(src: Rgba, p: Params): Luminance {
  const { width: W, height: H } = src;
  const grey = rgbaToGrey(src);
  return applyImageParams(grey, W, H, p);
}

/**
 * Non-uniform grid mapping: maps each of the n grid indices [0..n-1] to a
 * source image coordinate [0..1], allocating `density` times as many cells
 * per unit source width inside [faceMin, faceMax] as outside it.
 * Falls back to uniform spacing when faceMin >= faceMax or density <= 1.
 */
export function computeFocusMap(
  n: number,
  faceMin: number,
  faceMax: number,
  density = 4,
): Float32Array {
  const map = new Float32Array(n);
  if (n <= 1) { if (n === 1) map[0] = 0.5; return map; }
  const fa = Math.max(0, Math.min(1, faceMin));
  const fb = Math.max(0, Math.min(1, faceMax));
  if (fa >= fb || density <= 1) {
    for (let i = 0; i < n; i++) map[i] = i / (n - 1);
    return map;
  }
  const d = density;
  const totalW = 1 + (fb - fa) * (d - 1);
  const cwFaceStart = fa / totalW;
  const cwFaceEnd = (fa + (fb - fa) * d) / totalW;
  for (let i = 0; i < n; i++) {
    const g = i / (n - 1);
    let u: number;
    if (g <= cwFaceStart) {
      u = g * totalW;
    } else if (g <= cwFaceEnd) {
      u = fa + (g - cwFaceStart) * totalW / d;
    } else {
      u = fb + (g - cwFaceEnd) * totalW;
    }
    map[i] = Math.max(0, Math.min(1, u));
  }
  return map;
}

/** Resample RGBA at non-uniform positions given by colMap/rowMap (bilinear). */
export function resampleRgbaFocused(
  src: Rgba,
  gridW: number,
  gridH: number,
  colMap: Float32Array,
  rowMap: Float32Array,
): Rgba {
  const out = new Uint8ClampedArray(gridW * gridH * 4);
  for (let j = 0; j < gridH; j++) {
    const fy = rowMap[j] * (src.height - 1);
    const y0 = Math.max(0, Math.floor(fy));
    const y1 = Math.min(src.height - 1, y0 + 1);
    const dy = fy - y0;
    for (let i = 0; i < gridW; i++) {
      const fx = colMap[i] * (src.width - 1);
      const x0 = Math.max(0, Math.floor(fx));
      const x1 = Math.min(src.width - 1, x0 + 1);
      const dx = fx - x0;
      const di = (j * gridW + i) * 4;
      for (let c = 0; c < 4; c++) {
        const v00 = src.data[(y0 * src.width + x0) * 4 + c];
        const v10 = src.data[(y0 * src.width + x1) * 4 + c];
        const v01 = src.data[(y1 * src.width + x0) * 4 + c];
        const v11 = src.data[(y1 * src.width + x1) * 4 + c];
        out[di + c] = Math.round(
          v00 * (1 - dx) * (1 - dy) + v10 * dx * (1 - dy) +
          v01 * (1 - dx) * dy       + v11 * dx * dy,
        );
      }
    }
  }
  return { width: gridW, height: gridH, data: out };
}

/** Resample a Float32Array (depth map) at non-uniform positions (bilinear). */
export function resampleFloat32Focused(
  src: Float32Array,
  srcW: number,
  srcH: number,
  colMap: Float32Array,
  rowMap: Float32Array,
): Float32Array {
  const gridW = colMap.length, gridH = rowMap.length;
  const out = new Float32Array(gridW * gridH);
  for (let j = 0; j < gridH; j++) {
    const fy = rowMap[j] * (srcH - 1);
    const y0 = Math.max(0, Math.floor(fy));
    const y1 = Math.min(srcH - 1, y0 + 1);
    const dy = fy - y0;
    for (let i = 0; i < gridW; i++) {
      const fx = colMap[i] * (srcW - 1);
      const x0 = Math.max(0, Math.floor(fx));
      const x1 = Math.min(srcW - 1, x0 + 1);
      const dx = fx - x0;
      const v00 = src[y0 * srcW + x0], v10 = src[y0 * srcW + x1];
      const v01 = src[y1 * srcW + x0], v11 = src[y1 * srcW + x1];
      out[j * gridW + i] =
        v00 * (1 - dx) * (1 - dy) + v10 * dx * (1 - dy) +
        v01 * (1 - dx) * dy       + v11 * dx * dy;
    }
  }
  return out;
}

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function boxBlur(src: Float32Array, W: number, H: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  // Horizontal
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let sum = 0, cnt = 0;
      for (let dx = -r; dx <= r; dx++) {
        const nx = x + dx;
        if (nx >= 0 && nx < W) { sum += src[y * W + nx]; cnt++; }
      }
      tmp[y * W + x] = sum / cnt;
    }
  }
  // Vertical
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let sum = 0, cnt = 0;
      for (let dy = -r; dy <= r; dy++) {
        const ny = y + dy;
        if (ny >= 0 && ny < H) { sum += tmp[ny * W + x]; cnt++; }
      }
      out[y * W + x] = sum / cnt;
    }
  }
  return out;
}
