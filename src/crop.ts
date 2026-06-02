/**
 * Crop modal: shows the loaded image on a canvas and lets the user drag-select
 * a crop region before the pipeline runs.
 */

import type { Rgba } from './image-processor';

export type CropResult = { rgba: Rgba; blob: Blob };

type Rect = { x: number; y: number; w: number; h: number };

export function showCropModal(
  sourceRgba: Rgba,
  onConfirm: (result: CropResult) => void,
  onSkip: () => void,
  onCancel: () => void = () => {},
): void {
  const overlay = document.createElement('div');
  overlay.className = 'crop-overlay';

  const modal = document.createElement('div');
  modal.className = 'crop-modal';

  const header = document.createElement('div');
  header.className = 'crop-header';
  const title = document.createElement('h2');
  title.textContent = 'Crop Image';
  const hint = document.createElement('p');
  hint.className = 'crop-hint';
  hint.textContent = 'Drag to select a region to crop, or click "Use Full Image".';
  header.appendChild(title);
  header.appendChild(hint);

  const canvas = document.createElement('canvas');
  canvas.className = 'crop-canvas';

  const footer = document.createElement('div');
  footer.className = 'crop-footer';

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.className = 'crop-skip-btn';

  const skipBtn = document.createElement('button');
  skipBtn.textContent = 'Use Full Image';
  skipBtn.className = 'crop-skip-btn';

  const applyBtn = document.createElement('button');
  applyBtn.textContent = 'Apply Crop';
  applyBtn.className = 'primary-btn';
  applyBtn.disabled = true;

  const rightBtns = document.createElement('div');
  rightBtns.className = 'crop-footer-right';
  rightBtns.appendChild(skipBtn);
  rightBtns.appendChild(applyBtn);

  footer.appendChild(cancelBtn);
  footer.appendChild(rightBtns);
  modal.appendChild(header);
  modal.appendChild(canvas);
  modal.appendChild(footer);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // Size canvas to fit viewport while preserving aspect ratio
  const maxW = Math.min(window.innerWidth * 0.92 - 48, 960);
  const maxH = window.innerHeight * 0.78 - 130;
  const imgAspect = sourceRgba.width / sourceRgba.height;
  let canvasW: number, canvasH: number;
  if (imgAspect > maxW / maxH) {
    canvasW = Math.round(maxW);
    canvasH = Math.round(maxW / imgAspect);
  } else {
    canvasH = Math.round(maxH);
    canvasW = Math.round(maxH * imgAspect);
  }
  canvas.width = canvasW;
  canvas.height = canvasH;
  canvas.style.width = canvasW + 'px';
  canvas.style.height = canvasH + 'px';

  // Backing image canvas (full res) for clean redraws
  const imgCanvas = document.createElement('canvas');
  imgCanvas.width = sourceRgba.width;
  imgCanvas.height = sourceRgba.height;
  imgCanvas.getContext('2d')!.putImageData(
    new ImageData(sourceRgba.data, sourceRgba.width, sourceRgba.height), 0, 0,
  );

  const ctx = canvas.getContext('2d')!;
  let cropRect: Rect | null = null;
  let dragging = false;
  let startX = 0, startY = 0;

  function normalizeRect(r: Rect): Rect {
    let x = r.w >= 0 ? r.x : r.x + r.w;
    let y = r.h >= 0 ? r.y : r.y + r.h;
    let w = Math.abs(r.w);
    let h = Math.abs(r.h);
    x = Math.max(0, x);
    y = Math.max(0, y);
    w = Math.min(w, canvasW - x);
    h = Math.min(h, canvasH - y);
    return { x, y, w, h };
  }

  function draw(): void {
    ctx.clearRect(0, 0, canvasW, canvasH);
    ctx.drawImage(imgCanvas, 0, 0, canvasW, canvasH);
    if (!cropRect || Math.abs(cropRect.w) < 2 || Math.abs(cropRect.h) < 2) return;
    const nr = normalizeRect(cropRect);

    // Four dark rects surrounding the selection
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, canvasW, nr.y);
    ctx.fillRect(0, nr.y + nr.h, canvasW, canvasH - nr.y - nr.h);
    ctx.fillRect(0, nr.y, nr.x, nr.h);
    ctx.fillRect(nr.x + nr.w, nr.y, canvasW - nr.x - nr.w, nr.h);

    // Dashed border
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(nr.x + 0.5, nr.y + 0.5, nr.w - 1, nr.h - 1);
    ctx.setLineDash([]);

    // Rule-of-thirds grid inside selection
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let i = 1; i <= 2; i++) {
      ctx.moveTo(nr.x + (nr.w * i) / 3, nr.y);
      ctx.lineTo(nr.x + (nr.w * i) / 3, nr.y + nr.h);
      ctx.moveTo(nr.x, nr.y + (nr.h * i) / 3);
      ctx.lineTo(nr.x + nr.w, nr.y + (nr.h * i) / 3);
    }
    ctx.stroke();

    // L-shaped corner handles
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2;
    const hl = Math.min(14, nr.w / 4, nr.h / 4);
    ctx.beginPath();
    // TL
    ctx.moveTo(nr.x + hl, nr.y); ctx.lineTo(nr.x, nr.y); ctx.lineTo(nr.x, nr.y + hl);
    // TR
    ctx.moveTo(nr.x + nr.w - hl, nr.y); ctx.lineTo(nr.x + nr.w, nr.y); ctx.lineTo(nr.x + nr.w, nr.y + hl);
    // BL
    ctx.moveTo(nr.x, nr.y + nr.h - hl); ctx.lineTo(nr.x, nr.y + nr.h); ctx.lineTo(nr.x + hl, nr.y + nr.h);
    // BR
    ctx.moveTo(nr.x + nr.w - hl, nr.y + nr.h); ctx.lineTo(nr.x + nr.w, nr.y + nr.h); ctx.lineTo(nr.x + nr.w, nr.y + nr.h - hl);
    ctx.stroke();
  }

  function canvasPos(clientX: number, clientY: number): { x: number; y: number } {
    const r = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(canvasW, clientX - r.left)),
      y: Math.max(0, Math.min(canvasH, clientY - r.top)),
    };
  }

  function startDrag(clientX: number, clientY: number): void {
    const p = canvasPos(clientX, clientY);
    startX = p.x; startY = p.y;
    cropRect = { x: startX, y: startY, w: 0, h: 0 };
    dragging = true;
    applyBtn.disabled = true;
  }

  function moveDrag(clientX: number, clientY: number): void {
    if (!dragging) return;
    const p = canvasPos(clientX, clientY);
    cropRect = { x: startX, y: startY, w: p.x - startX, h: p.y - startY };
    draw();
  }

  function endDrag(): void {
    if (!dragging) return;
    dragging = false;
    if (cropRect && Math.abs(cropRect.w) > 5 && Math.abs(cropRect.h) > 5) {
      applyBtn.disabled = false;
    }
    draw();
  }

  canvas.addEventListener('mousedown', (e) => { startDrag(e.clientX, e.clientY); e.preventDefault(); });
  const onMouseMove = (e: MouseEvent) => moveDrag(e.clientX, e.clientY);
  const onMouseUp = () => endDrag();

  canvas.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    startDrag(t.clientX, t.clientY);
    e.preventDefault();
  }, { passive: false });
  const onTouchMove = (e: TouchEvent) => { moveDrag(e.touches[0].clientX, e.touches[0].clientY); e.preventDefault(); };
  const onTouchEnd = () => endDrag();

  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('touchmove', onTouchMove, { passive: false });
  window.addEventListener('touchend', onTouchEnd);

  function cleanup(): void {
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    window.removeEventListener('touchmove', onTouchMove);
    window.removeEventListener('touchend', onTouchEnd);
    overlay.remove();
  }

  cancelBtn.addEventListener('click', () => { cleanup(); onCancel(); });
  skipBtn.addEventListener('click', () => { cleanup(); onSkip(); });

  applyBtn.addEventListener('click', async () => {
    if (!cropRect) return;
    const nr = normalizeRect(cropRect);
    const scaleX = sourceRgba.width / canvasW;
    const scaleY = sourceRgba.height / canvasH;
    const ix = Math.round(nr.x * scaleX);
    const iy = Math.round(nr.y * scaleY);
    const iw = Math.max(1, Math.round(nr.w * scaleX));
    const ih = Math.max(1, Math.round(nr.h * scaleY));

    const croppedRgba = cropRgba(sourceRgba, ix, iy, iw, ih);

    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = iw;
    tmpCanvas.height = ih;
    tmpCanvas.getContext('2d')!.putImageData(new ImageData(croppedRgba.data, iw, ih), 0, 0);
    const blob = await new Promise<Blob>((res) =>
      tmpCanvas.toBlob(b => res(b!), 'image/png'),
    );

    cleanup();
    onConfirm({ rgba: croppedRgba, blob });
  });

  draw();
}

function cropRgba(src: Rgba, x: number, y: number, w: number, h: number): Rgba {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let row = 0; row < h; row++) {
    const srcOffset = ((y + row) * src.width + x) * 4;
    out.set(src.data.subarray(srcOffset, srcOffset + w * 4), row * w * 4);
  }
  return { width: w, height: h, data: out };
}
