/**
 * Wire-up: file load -> image processor -> mesh generator -> preview, and
 * route parameter changes through the hot/cold/free paths.
 */

import { ParamStore, HOT_KEYS, COLD_KEYS, FREE_KEYS } from './store';
import type { Params } from './store';
import {
  decodeImageToRgba,
  resampleRgba,
  rgbaToLuminance,
  type Rgba,
  type Luminance,
} from './image-processor';
import { buildMesh, updateFrontZ, type Mesh } from './mesh-generator';
import { meshToBinaryStl, validateBinaryStlBuffer } from './stl-writer';
import { Preview } from './preview';
import type { RenderMode, ViewPreset } from './preview';
import { mountControls, showStatus } from './ui';

const store = new ParamStore();
const controlsHost = document.getElementById('controls') as HTMLElement;
const previewHost = document.getElementById('preview-canvas') as HTMLElement;
const emptyMsg = document.getElementById('preview-empty') as HTMLElement;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const downloadBtn = document.getElementById('download-btn') as HTMLButtonElement;
const statusPill = document.getElementById('status-pill') as HTMLElement;
const dimsEl = document.getElementById('preview-dims') as HTMLElement;
const presetButtons = document.querySelectorAll<HTMLButtonElement>('#view-presets button');
const modeButtons = document.querySelectorAll<HTMLButtonElement>('#render-modes button');
const resetBtn = document.getElementById('reset-view') as HTMLButtonElement;

mountControls(controlsHost, store);
const preview = new Preview(previewHost);

let sourceRgba: Rgba | null = null;
let lastLum: Luminance | null = null;
let lastMesh: Mesh | null = null;

let coldPathTimer: number | null = null;

function updateDims(): void {
  if (!lastMesh) return;
  const p = store.get();
  const w = lastMesh.bbox.max[0] - lastMesh.bbox.min[0];
  const h = lastMesh.bbox.max[1] - lastMesh.bbox.min[1];
  dimsEl.textContent = `${w.toFixed(0)} × ${h.toFixed(0)} × ${p.maxThicknessMm.toFixed(1)} mm`;
  dimsEl.style.display = 'block';
}

function buildAndShow(): void {
  if (!sourceRgba) return;
  const p = store.get();
  // Determine grid resolution from physical size.
  const gridW = Math.max(8, Math.round(p.widthMm * p.pixelsPerMm));
  const aspect = sourceRgba.height / sourceRgba.width;
  const gridH = Math.max(8, Math.round(gridW * aspect));
  const resampled = resampleRgba(sourceRgba, gridW, gridH);
  const lum = rgbaToLuminance(resampled, p);
  lastLum = lum;
  const mesh = buildMesh(
    { width: lum.width, height: lum.height, data: lum.data },
    {
      widthMm: p.widthMm,
      minThicknessMm: p.minThicknessMm,
      maxThicknessMm: p.maxThicknessMm,
      borderMm: p.borderMm,
    },
  );
  lastMesh = mesh;
  preview.setMesh(mesh);
  emptyMsg.style.display = 'none';
  downloadBtn.disabled = false;
  updateDims();
}

function hotZUpdate(): void {
  if (!sourceRgba || !lastMesh || !lastLum) return;
  const p = store.get();
  // Re-derive luminance with new image params.
  const resampled = resampleRgba(sourceRgba, lastLum.width, lastLum.height);
  const lum = rgbaToLuminance(resampled, p);
  lastLum = lum;
  updateFrontZ(
    lastMesh.positions,
    { width: lum.width, height: lum.height, data: lum.data },
    p.borderMm,
    p.widthMm / lum.width,
    p.minThicknessMm,
    p.maxThicknessMm,
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

store.subscribe(FREE_KEYS, () => {
  // Width is "free": rebuild the mesh structurally (we encode width during
  // build so the bounding box is correct for the slicer). Treat as cold for v1.
  if (!sourceRgba) return;
  scheduleColdRebuild();
});

// --- File input ---
fileInput.addEventListener('change', async () => {
  const f = fileInput.files?.[0];
  if (!f) return;
  showStatus(statusPill, 'Decoding image…', 0);
  try {
    sourceRgba = await decodeImageToRgba(f);
    buildAndShow();
    showStatus(statusPill, `Loaded ${sourceRgba.width}×${sourceRgba.height}`, 1500);
  } catch (err) {
    console.error(err);
    showStatus(statusPill, 'Failed to load image', 2000);
  }
});

// --- Download ---
downloadBtn.addEventListener('click', () => {
  if (!sourceRgba) return;
  // Always export at the user's chosen resolution (no separate "export LOD" yet).
  buildAndShow(); // ensures lastMesh is fresh
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
modeButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    modeButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    preview.setMode(btn.dataset.mode as RenderMode);
  });
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
    case 'l': preview.setMode('lit'); break;
    case 'k': preview.setMode('backlit'); break;
    case 'w': preview.setMode('wireframe'); break;
  }
});
