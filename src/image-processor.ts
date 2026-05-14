/**
 * Image processor: source bitmap -> luminance buffer in [0,1].
 *
 * Pure functions; no DOM dependencies for the math. The browser-side helper
 * decodeImageToRgba uses canvas to read pixels but is isolated so the rest
 * of the module can be tested headlessly.
 */

import type { Params } from './store';

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

/**
 * Convert RGBA pixels to a luminance buffer in [0,1] applying the chain:
 *   grayscale -> mirror -> invert -> brightness -> contrast -> gamma -> smoothing
 */
export function rgbaToLuminance(src: Rgba, p: Params): Luminance {
  const { width: W, height: H, data } = src;
  const out = new Float32Array(W * H);

  // 1) Grayscale (Rec. 709 luminance)
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    out[j] = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
  }

  // 2) Mirror horizontally (in-place row-by-row swap)
  if (p.mirror) {
    for (let y = 0; y < H; y++) {
      const row = y * W;
      for (let x = 0; x < W / 2; x++) {
        const a = row + x;
        const b = row + (W - 1 - x);
        const t = out[a]; out[a] = out[b]; out[b] = t;
      }
    }
  }

  // 3) Invert
  if (p.invert) {
    for (let i = 0; i < out.length; i++) out[i] = 1 - out[i];
  }

  // 4) Brightness  (linear shift)
  const bAdd = p.brightness / 100;
  if (bAdd !== 0) {
    for (let i = 0; i < out.length; i++) {
      out[i] = clamp01(out[i] + bAdd);
    }
  }

  // 5) Contrast (S-curve around 0.5)
  // contrast in [-100, 100]; factor maps to roughly [0, 2]
  const c = (p.contrast + 100) / 100;
  if (c !== 1) {
    for (let i = 0; i < out.length; i++) {
      out[i] = clamp01((out[i] - 0.5) * c + 0.5);
    }
  }

  // 6) Gamma
  const g = p.gamma;
  if (g !== 1) {
    for (let i = 0; i < out.length; i++) {
      out[i] = Math.pow(out[i], g);
    }
  }

  // 7) Smoothing (separable box blur — fast, good enough)
  const r = Math.max(0, Math.round(p.smoothingPx));
  if (r > 0) {
    return { width: W, height: H, data: boxBlur(out, W, H, r) };
  }
  return { width: W, height: H, data: out };
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
