/**
 * Wire-up: file load -> image processor -> mesh generator -> preview, and
 * route parameter changes through the hot/cold paths.
 */

import { ParamStore, HOT_KEYS, COLD_KEYS } from './store';
import type { Params } from './store';
import {
  decodeImageToRgba,
  resampleRgba,
  resampleRgbaFocused,
  rgbaToLuminance,
  rgbaToGrey,
  resampleFloat32Bilinear,
  resampleFloat32Focused,
  applyImageParams,
  computeFocusMap,
  type Rgba,
  type Luminance,
} from './image-processor';
import { buildCurvedMesh, addBaseMesh, updateFrontCurved, type Mesh } from './mesh-generator';
import { meshToBinaryStl, validateBinaryStlBuffer } from './stl-writer';
import { Preview } from './preview';
import type { RenderMode, ViewPreset } from './preview';
import { mountControls, showStatus } from './ui';
import { estimateDepth } from './depth-estimator';
import { showCropModal } from './crop';
import { detectFaceRegions } from './face-detector';

const store = new ParamStore();
const controlsHost = document.getElementById('controls') as HTMLElement;
const previewHost = document.getElementById('preview-canvas') as HTMLElement;
const emptyMsg = document.getElementById('preview-empty') as HTMLElement;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const cropBtn = document.getElementById('crop-btn') as HTMLButtonElement;
const downloadBtn = document.getElementById('download-btn') as HTMLButtonElement;
const statusPill = document.getElementById('status-pill') as HTMLElement;
const dimsEl = document.getElementById('preview-dims') as HTMLElement;
const presetButtons = document.querySelectorAll<HTMLButtonElement>('#view-presets button');
const modeButtons = document.querySelectorAll<HTMLButtonElement>('#render-modes button');
const resetBtn = document.getElementById('reset-view') as HTMLButtonElement;
const backlitControls = document.getElementById('backlit-controls') as HTMLElement;
const blContrast = document.getElementById('bl-contrast') as HTMLInputElement;
const blBrightness = document.getElementById('bl-brightness') as HTMLInputElement;
const blContrastVal = document.getElementById('bl-contrast-val') as HTMLElement;
const blBrightnessVal = document.getElementById('bl-brightness-val') as HTMLElement;

let sourceRgba: Rgba | null = null;
let sourceBlob: Blob | null = null;  // original file for AI inference
let originalRgba: Rgba | null = null;  // full-res pre-crop image for re-cropping
let originalBlob: Blob | null = null;
let lastLum: Luminance | null = null;
let lastMesh: Mesh | null = null;
let lastRawDepth: Luminance | null = null; // cached AI depth at model resolution
type NormalizedRegion = { x: number; y: number; w: number; h: number };
let lastFaceRegions: NormalizedRegion[] = []; // detected faces in [0,1] of active source
let useDepthAI = true;
// 0 = pure photo luminance, 1 = pure AI depth; blends the two for portraits
let depthBlend = 0.7;
const { commonHost } = mountControls(controlsHost, store, (_shapeId) => {
  // store.setMany(shape.defaults) already fired cold-key subscriptions → rebuild
});
mountDepthAiButton(commonHost);
const preview = new Preview(previewHost);

let coldPathTimer: number | null = null;

function updateDims(): void {
  if (!lastMesh) return;
  const p = store.get();
  const w = lastMesh.bbox.max[0] - lastMesh.bbox.min[0];
  const h = lastMesh.bbox.max[1] - lastMesh.bbox.min[1];
  const triCount = lastMesh.indices.length / 3;
  let text = `${w.toFixed(0)} × ${h.toFixed(0)} × ${p.maxThicknessMm.toFixed(1)} mm · ${triCount.toLocaleString()} triangles`;
  if (lastFaceRegions.length > 0) {
    const faceRes = p.pixelsPerMm * 5;
    text += ` · face: ${faceRes.toFixed(0)} px/mm`;
  }
  dimsEl.textContent = text;
  dimsEl.style.display = 'block';
}

/** Derive the target grid size from current params and source aspect ratio. */
function gridSize(): { gridW: number; gridH: number } {
  const p = store.get();
  const gridW = Math.max(8, Math.round(p.widthMm * p.pixelsPerMm));
  let gridH: number;
  if (p.heightMm > 0) {
    gridH = Math.max(8, Math.round(p.heightMm * p.pixelsPerMm));
  } else if (sourceRgba) {
    const aspect = sourceRgba.height / sourceRgba.width;
    gridH = Math.max(8, Math.round(gridW * aspect));
  } else {
    gridH = gridW;
  }
  return { gridW, gridH };
}

type FocusMaps = { colMap: Float32Array; rowMap: Float32Array };

/** Build non-uniform col/row sampling maps from stored face regions, or null if none. */
function buildFocusMaps(gridW: number, gridH: number): FocusMaps | null {
  if (lastFaceRegions.length === 0) return null;
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const r of lastFaceRegions) {
    if (r.x < minX) minX = r.x;
    if (r.y < minY) minY = r.y;
    if (r.x + r.w > maxX) maxX = r.x + r.w;
    if (r.y + r.h > maxY) maxY = r.y + r.h;
  }
  if (maxX <= minX || maxY <= minY) return null;
  return {
    colMap: computeFocusMap(gridW, minX, maxX, 5),
    rowMap: computeFocusMap(gridH, minY, maxY, 5),
  };
}

/** Compute luminance buffer from whichever source is active (photo or AI depth). */
function deriveLuminance(gridW: number, gridH: number, focus: FocusMaps | null): Luminance {
  const p = store.get();
  if (useDepthAI && lastRawDepth) {
    const depth = focus
      ? resampleFloat32Focused(lastRawDepth.data, lastRawDepth.width, lastRawDepth.height, focus.colMap, focus.rowMap)
      : resampleFloat32Bilinear(lastRawDepth.data, lastRawDepth.width, lastRawDepth.height, gridW, gridH);
    if (depthBlend >= 1) {
      return applyImageParams(depth, gridW, gridH, p);
    }
    const photo = rgbaToGrey(focus
      ? resampleRgbaFocused(sourceRgba!, gridW, gridH, focus.colMap, focus.rowMap)
      : resampleRgba(sourceRgba!, gridW, gridH));
    const mixed = new Float32Array(gridW * gridH);
    for (let i = 0; i < mixed.length; i++) {
      mixed[i] = depthBlend * depth[i] + (1 - depthBlend) * photo[i];
    }
    return applyImageParams(mixed, gridW, gridH, p);
  }
  const resampled = focus
    ? resampleRgbaFocused(sourceRgba!, gridW, gridH, focus.colMap, focus.rowMap)
    : resampleRgba(sourceRgba!, gridW, gridH);
  return rgbaToLuminance(resampled, p);
}

function curvedParams(p: Readonly<Params>) {
  return {
    widthMm: p.widthMm,
    arcDeg: p.arcDeg,
    minThicknessMm: p.minThicknessMm,
    maxThicknessMm: p.maxThicknessMm,
    borderMm: p.borderMm,
  };
}

function buildAndShow(): void {
  if (!sourceRgba) return;
  const p = store.get();
  const { gridW, gridH } = gridSize();
  const focus = buildFocusMaps(gridW, gridH);
  const lum = deriveLuminance(gridW, gridH, focus);
  lastLum = lum;
  const cp = curvedParams(p);
  const panel = buildCurvedMesh(
    { width: lum.width, height: lum.height, data: lum.data },
    cp,
    focus?.colMap,
    focus?.rowMap,
  );
  const arcRad = cp.arcDeg * Math.PI / 180;
  const R = cp.widthMm / arcRad;
  const mesh = addBaseMesh(panel, { R, arcRad }, p.baseHeightMm, p.baseExtendMm, p.baseTabWidthMm);
  lastMesh = mesh;
  const yMid = (panel.bbox.min[1] + panel.bbox.max[1]) / 2;
  preview.setLightCenter(R, yMid);
  preview.setIsLamp(cp.arcDeg >= 360);
  preview.setMesh(mesh);
  emptyMsg.style.display = 'none';
  downloadBtn.disabled = false;
  updateDims();
}

function hotZUpdate(): void {
  if (!sourceRgba || !lastMesh || !lastLum) return;
  const p = store.get();
  const { gridW, gridH } = gridSize();
  const focus = buildFocusMaps(gridW, gridH);
  const lum = deriveLuminance(gridW, gridH, focus);
  lastLum = lum;
  updateFrontCurved(
    lastMesh.positions,
    { width: lum.width, height: lum.height, data: lum.data },
    curvedParams(p),
    lastMesh.colMap,
  );
  preview.notifyZUpdated();
  updateDims();
}

function scheduleColdRebuild(): void {
  if (coldPathTimer != null) clearTimeout(coldPathTimer);
  showStatus(statusPill, 'Updating preview…', 0);
  coldPathTimer = window.setTimeout(() => {
    buildAndShow();
    showStatus(statusPill, 'Updated', 800);
    coldPathTimer = null;
  }, 150);
}

// --- Subscriptions ---
store.subscribe(HOT_KEYS, () => {
  if (!sourceRgba) return;
  hotZUpdate();
});

store.subscribe(COLD_KEYS, () => {
  if (!sourceRgba) return;
  scheduleColdRebuild();
});

async function runFaceDetection(): Promise<void> {
  if (!sourceRgba) return;
  const canvas = document.createElement('canvas');
  canvas.width = sourceRgba.width;
  canvas.height = sourceRgba.height;
  canvas.getContext('2d')!.putImageData(
    new ImageData(sourceRgba.data as unknown as Uint8ClampedArray<ArrayBuffer>, sourceRgba.width, sourceRgba.height), 0, 0,
  );
  try {
    const regions = await detectFaceRegions(canvas, (msg) => showStatus(statusPill, msg, 0));
    lastFaceRegions = regions.map(r => ({
      x: r.x / sourceRgba!.width,
      y: r.y / sourceRgba!.height,
      w: r.width / sourceRgba!.width,
      h: r.height / sourceRgba!.height,
    }));
  } catch {
    lastFaceRegions = [];
  }
}

async function proceedWithSource(): Promise<void> {
  if (!sourceRgba) return;
  showStatus(statusPill, 'Building…', 0);
  await new Promise<void>(r => setTimeout(r, 0));
  await runFaceDetection();
  if (useDepthAI) {
    await runDepthEstimation();
  } else {
    buildAndShow();
  }
  showStatus(statusPill, `Loaded ${sourceRgba.width}×${sourceRgba.height}`, 1500);
}

function openCropModal(): void {
  if (!originalRgba || !originalBlob) return;
  showCropModal(
    originalRgba,
    async (result) => {
      sourceBlob = result.blob;
      sourceRgba = result.rgba;
      lastRawDepth = null;
      await proceedWithSource();
    },
    async () => {
      sourceBlob = originalBlob!;
      sourceRgba = originalRgba!;
      lastRawDepth = null;
      await proceedWithSource();
    },
  );
}

// --- File input ---
fileInput.addEventListener('change', async () => {
  const f = fileInput.files?.[0];
  fileInput.value = '';
  if (!f) return;
  showStatus(statusPill, 'Decoding image…', 0);
  try {
    const rgba = await decodeImageToRgba(f);
    originalRgba = rgba;
    originalBlob = f;
    cropBtn.disabled = false;
    showStatus(statusPill, '', 1);
    openCropModal();
  } catch (err) {
    console.error(err);
    showStatus(statusPill, err instanceof Error ? err.message : 'Failed to load image', 3000, 'error');
  }
});

// --- Crop button ---
cropBtn.addEventListener('click', openCropModal);

// --- Download ---
downloadBtn.addEventListener('click', () => {
  if (!sourceRgba) return;
  buildAndShow();
  if (!lastMesh) return;
  const buf = meshToBinaryStl(lastMesh, 'lithophane-app v0.1');
  const err = validateBinaryStlBuffer(buf);
  if (err) {
    showStatus(statusPill, `STL invalid: ${err}`, 4000);
    return;
  }
  const blob = new Blob([buf], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const baseName = (fileInput.files?.[0]?.name ?? 'photo').replace(/\.[^.]+$/, '');
  a.download = `${baseName}_litho.stl`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showStatus(statusPill, `Saved ${(buf.byteLength / 1024).toFixed(0)} KB STL`, 2500);
});

// --- View preset buttons ---
presetButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    presetButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    preview.applyPreset(btn.dataset.preset as ViewPreset);
  });
});

// --- Render-mode buttons ---
function setRenderMode(mode: RenderMode) {
  preview.setMode(mode);
  backlitControls.classList.toggle('visible', mode === 'backlit');
  modeButtons.forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
}

modeButtons.forEach(btn => {
  btn.addEventListener('click', () => setRenderMode(btn.dataset.mode as RenderMode));
});

// --- Backlit parameter sliders ---
blContrast.addEventListener('input', () => {
  blContrastVal.textContent = Number(blContrast.value).toFixed(1);
  preview.setBacklitContrast(Number(blContrast.value));
});
blBrightness.addEventListener('input', () => {
  blBrightnessVal.textContent = Number(blBrightness.value).toFixed(2);
  preview.setBacklitBrightness(Number(blBrightness.value));
});

// --- Reset view ---
resetBtn.addEventListener('click', () => preview.resetView());

// Quick-keys
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  switch (e.key.toLowerCase()) {
    case 'f': preview.applyPreset('front'); break;
    case 'b': preview.applyPreset('back'); break;
    case 't': preview.applyPreset('top'); break;
    case 'r': preview.resetView(); break;
    case 'l': setRenderMode('lit'); break;
    case 'k': setRenderMode('backlit'); break;
    case 'w': setRenderMode('wireframe'); break;
  }
});

// --- AI Depth estimation ---
async function runDepthEstimation(): Promise<void> {
  if (!sourceBlob || !sourceRgba) return;
  try {
    lastRawDepth = await estimateDepth(sourceBlob, (msg) => {
      showStatus(statusPill, msg, 0);
    });
    buildAndShow();
  } catch (err) {
    console.error('AI depth estimation failed:', err);
    const isAuth = String(err).includes('Unauthorized') || String(err).includes('401');
    showStatus(
      statusPill,
      isAuth ? 'Auth failed — check HuggingFace token below' : 'AI depth failed — using photo luminance',
      isAuth ? 5000 : 3000,
    );
    useDepthAI = false;
    lastRawDepth = null;
    updateDepthAiButton();
    buildAndShow();
  }
}

function updateDepthAiButton(): void {
  const btn = document.getElementById('depth-ai-btn') as HTMLButtonElement | null;
  const note = document.getElementById('depth-ai-note') as HTMLElement | null;
  if (!btn) return;
  btn.textContent = useDepthAI ? 'Disable AI Depth' : 'Enable AI Depth';
  btn.classList.toggle('active', useDepthAI);
  if (note) note.style.display = useDepthAI ? 'block' : 'none';
}

function mountDepthAiButton(host: HTMLElement): void {
  const section = document.createElement('div');
  section.className = 'control-group';

  const h = document.createElement('h3');
  h.textContent = 'AI Depth';
  section.appendChild(h);

  const btn = document.createElement('button');
  btn.id = 'depth-ai-btn';
  btn.textContent = 'Enable AI Depth';
  btn.title = 'Use Depth Anything to estimate real geometry instead of photo brightness';
  btn.addEventListener('click', async () => {
    if (!sourceRgba) {
      showStatus(statusPill, 'Open a photo first', 1500);
      return;
    }
    useDepthAI = !useDepthAI;
    updateDepthAiButton();
    if (useDepthAI) {
      await runDepthEstimation();
    } else {
      lastRawDepth = null;
      buildAndShow();
    }
  });
  section.appendChild(btn);

  // Depth blend slider
  const blendRow = document.createElement('div');
  blendRow.className = 'control-row';
  blendRow.style.marginTop = '8px';

  const blendLabel = document.createElement('label');
  blendLabel.textContent = 'Depth mix';
  blendLabel.title = '0 = photo detail only · 100 = AI depth only · 50 = blend (best for portraits)';

  const blendSlider = document.createElement('input');
  blendSlider.type = 'range';
  blendSlider.min = '0';
  blendSlider.max = '100';
  blendSlider.value = String(Math.round(depthBlend * 100));

  const blendVal = document.createElement('span');
  blendVal.className = 'value';
  blendVal.textContent = blendSlider.value + '%';

  blendSlider.addEventListener('input', () => {
    depthBlend = Number(blendSlider.value) / 100;
    blendVal.textContent = blendSlider.value + '%';
    if (useDepthAI && sourceRgba && lastMesh && lastRawDepth) hotZUpdate();
  });

  blendRow.appendChild(blendLabel);
  blendRow.appendChild(blendSlider);
  blendRow.appendChild(blendVal);
  section.appendChild(blendRow);

  const note = document.createElement('p');
  note.id = 'depth-ai-note';
  note.className = 'depth-ai-note';
  note.textContent = 'Tip: toggle "Invert" to swap near↔far. For portraits, raise Contrast to amplify subtle depth differences, or lower Depth mix to blend in photo surface detail.';
  note.style.display = 'none';
  section.appendChild(note);

  host.appendChild(section);

  updateDepthAiButton();
}
