/**
 * AI depth estimation via Depth Anything (Transformers.js, browser-only).
 *
 * Transformers.js hub.js intentionally omits Authorization headers in browser
 * environments (see hub.js line 247). We work around this by providing a
 * custom cache (env.customCache) whose match() method fetches model files with
 * the user's HuggingFace token before transformers.js ever sees the response.
 * Downloaded files are stored in the browser's Cache API so subsequent visits
 * skip the network entirely.
 *
 * Output: normalized depth in [0,1] at the model's native resolution.
 * Higher value = closer to camera (foreground).
 */

import { pipeline, env } from '@huggingface/transformers';
import type { Luminance } from './image-processor';

(env as any).allowLocalModels = false;
(env as any).allowRemoteModels = true;

const MODEL_ID = 'Xenova/depth-anything-small-hf';
const CACHE_NAME = 'hf-model-cache';

export type ProgressCallback = (msg: string) => void;

let hfToken = '';
let pipelinePromise: Promise<any> | null = null;

export function setHfToken(token: string): void {
  hfToken = token;
  pipelinePromise = null;
}

/** Build and install a custom cache that fetches HuggingFace files with auth. */
function installAuthCache(token: string, onProgress?: ProgressCallback): void {
  const mem = new Map<string, { buf: ArrayBuffer; ct: string }>();

  (env as any).useCustomCache = true;
  (env as any).customCache = {
    async match(url: string): Promise<Response | undefined> {
      // Fast path: already downloaded this session
      const hit = mem.get(url);
      if (hit) return new Response(hit.buf.slice(0), { headers: { 'Content-Type': hit.ct } });

      // Persistent path: browser Cache API (survives page reloads)
      if (typeof caches !== 'undefined') {
        try {
          const c = await caches.open(CACHE_NAME);
          const cached = await c.match(url);
          if (cached) {
            const buf = await cached.arrayBuffer();
            const ct = cached.headers.get('Content-Type') ?? 'application/octet-stream';
            mem.set(url, { buf, ct });
            return new Response(buf.slice(0), { headers: { 'Content-Type': ct } });
          }
        } catch (_) {}
      }

      // Network path: fetch with auth and stream progress for large files
      if (/huggingface\.co|hf\.co/.test(url)) {
        const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!resp.ok) {
          // Return undefined so hub.js surfaces its own error (401, 404, etc.)
          return undefined;
        }
        const ct = resp.headers.get('Content-Type') ?? 'application/octet-stream';
        const total = parseInt(resp.headers.get('Content-Length') ?? '0', 10);
        const reader = resp.body!.getReader();
        const chunks: Uint8Array[] = [];
        let received = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.byteLength;
          if (total > 0 && onProgress) {
            onProgress(`Downloading AI model… ${Math.round((received / total) * 100)}%`);
          }
        }

        const buf = new Uint8Array(received);
        let offset = 0;
        for (const chunk of chunks) { buf.set(chunk, offset); offset += chunk.byteLength; }
        const arrayBuf = buf.buffer;

        mem.set(url, { buf: arrayBuf, ct });
        if (typeof caches !== 'undefined') {
          try {
            const c = await caches.open(CACHE_NAME);
            await c.put(url, new Response(arrayBuf.slice(0), { headers: { 'Content-Type': ct } }));
          } catch (_) {}
        }
        return new Response(arrayBuf.slice(0), { headers: { 'Content-Type': ct } });
      }
      return undefined;
    },

    // hub.js calls put() after a network fetch it performed itself.
    // We already cached in match(), so this is a no-op.
    async put(): Promise<void> {},
  };
}

function getDepthPipeline(onProgress?: ProgressCallback): Promise<any> {
  if (!pipelinePromise) {
    installAuthCache(hfToken, onProgress);
    pipelinePromise = (pipeline as any)(
      'depth-estimation',
      MODEL_ID,
      {
        progress_callback: onProgress
          ? (info: any) => {
              if (info.status === 'loading') onProgress('Loading AI model…');
            }
          : undefined,
      },
    ).catch((err: unknown) => {
      pipelinePromise = null;
      throw err;
    });
  }
  return pipelinePromise;
}

/**
 * Run Depth Anything on a source image blob.
 * Returns a Luminance where higher values are closer to the camera.
 */
export async function estimateDepth(
  source: Blob,
  onProgress?: ProgressCallback,
): Promise<Luminance> {
  const estimator = await getDepthPipeline(onProgress);
  onProgress?.('Running depth estimation…');

  const url = URL.createObjectURL(source);
  try {
    const output = await estimator(url);
    const predicted_depth = output.predicted_depth;
    const rawData = predicted_depth.data as Float32Array;
    const dims = predicted_depth.dims as number[];
    const W = dims[dims.length - 1];
    const H = dims[dims.length - 2];
    const offset = rawData.length - W * H;

    // Max-only normalization (matches HF Space behavior): divide by max so the
    // closest point = 1. This preserves relative depth ordering better than
    // min-max, which can compress the foreground when the background is far.
    const n = W * H;
    let maxVal = 0;
    for (let i = 0; i < n; i++) {
      if (rawData[offset + i] > maxVal) maxVal = rawData[offset + i];
    }
    if (maxVal === 0) maxVal = 1;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      out[i] = rawData[offset + i] / maxVal;
    }

    return { width: W, height: H, data: out };
  } finally {
    URL.revokeObjectURL(url);
  }
}
