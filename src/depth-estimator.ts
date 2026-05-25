/**
 * AI depth estimation via Depth Anything V2 (Transformers.js, browser-only).
 *
 * Uses onnx-community/depth-anything-v2-small — a public model that requires
 * no authentication token. Transformers.js fetches and caches model weights
 * automatically on first use (~25 MB quantized ONNX).
 *
 * Output: normalized depth in [0,1] at the model's native resolution.
 * Higher value = closer to camera (foreground).
 */

import { pipeline, env } from '@huggingface/transformers';
import type { Luminance } from './image-processor';

(env as any).allowLocalModels = false;
(env as any).allowRemoteModels = true;

const MODEL_ID = 'onnx-community/depth-anything-v2-small';

export type ProgressCallback = (msg: string) => void;

let pipelinePromise: Promise<any> | null = null;

function getDepthPipeline(onProgress?: ProgressCallback): Promise<any> {
  if (!pipelinePromise) {
    pipelinePromise = (pipeline as any)(
      'depth-estimation',
      MODEL_ID,
      {
        progress_callback: onProgress
          ? (info: any) => {
              if (info.status === 'downloading') {
                const pct = info.progress != null ? ` ${Math.round(info.progress)}%` : '';
                onProgress(`Downloading AI model…${pct}`);
              } else if (info.status === 'loading') {
                onProgress('Loading AI model…');
              }
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
 * Run Depth Anything V2 on a source image blob.
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
    // closest point = 1. Preserves relative depth ordering better than min-max,
    // which can compress foreground when the background is far away.
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
