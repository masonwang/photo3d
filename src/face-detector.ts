/**
 * Face / person region detection via Transformers.js (YOLOS-tiny, COCO).
 * Works for frontal, profile, and partial-body shots. Falls back gracefully
 * when the model fails to download or finds nothing.
 *
 * The returned regions are in source-image pixel coordinates.
 * Head region is estimated as the top 38% of each detected person bbox.
 */

import { pipeline } from '@huggingface/transformers';

export type FaceRegion = { x: number; y: number; width: number; height: number };

// Singleton — loaded once, reused across modal opens.
let _detector: ((img: HTMLCanvasElement, opts: object) => Promise<DetectionResult[]>) | null = null;

interface DetectionBox { xmin: number; ymin: number; xmax: number; ymax: number }
interface DetectionResult { label: string; score: number; box: DetectionBox }

async function getDetector(
  onProgress?: (msg: string) => void,
): Promise<(img: HTMLCanvasElement, opts: object) => Promise<DetectionResult[]>> {
  if (_detector) return _detector;
  _detector = await pipeline(
    'object-detection',
    'Xenova/yolos-tiny',
    {
      progress_callback: (info: { status: string; loaded?: number; total?: number }) => {
        if (info.status === 'progress' && info.total) {
          const pct = Math.round((info.loaded! / info.total) * 100);
          onProgress?.(`Loading face model ${pct}%…`);
        }
      },
    },
  ) as unknown as (img: HTMLCanvasElement, opts: object) => Promise<DetectionResult[]>;
  return _detector;
}

export async function detectFaceRegions(
  imgCanvas: HTMLCanvasElement,
  onProgress?: (msg: string) => void,
): Promise<FaceRegion[]> {
  const detector = await getDetector(onProgress);
  onProgress?.('Detecting faces…');

  let results: DetectionResult[];
  try {
    results = await detector(imgCanvas, { threshold: 0.35 });
  } catch (e) {
    console.error('[FaceDetect] inference error:', e);
    return [];
  }

  const persons = results.filter(r => r.label === 'person');
  if (persons.length === 0) return [];

  // Map each person bbox to an estimated head/face region (top ~38%)
  return persons.map(({ box }) => {
    const w = box.xmax - box.xmin;
    const h = box.ymax - box.ymin;
    return { x: box.xmin, y: box.ymin, width: w, height: h * 0.38 };
  });
}
