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

/** Decode a File/Blob/HTMLImageElement to RGBA pixels via an offscreen canvas. */
export async function decodeImageToRgba(source: Blob): Promise<Rgba> {
  const bmp = await createImageBitmap(source);
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
