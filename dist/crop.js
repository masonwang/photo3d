export function showCropModal(sourceRgba, onConfirm, onSkip) {
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
    const skipBtn = document.createElement('button');
    skipBtn.textContent = 'Use Full Image';
    skipBtn.className = 'crop-skip-btn';
    const applyBtn = document.createElement('button');
    applyBtn.textContent = 'Apply Crop';
    applyBtn.className = 'primary-btn';
    applyBtn.disabled = true;
    footer.appendChild(skipBtn);
    footer.appendChild(applyBtn);
    modal.appendChild(header);
    modal.appendChild(canvas);
    modal.appendChild(footer);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    const maxW = Math.min(window.innerWidth * 0.92 - 48, 960);
    const maxH = window.innerHeight * 0.78 - 130;
    const imgAspect = sourceRgba.width / sourceRgba.height;
    let canvasW, canvasH;
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
    const imgCanvas = document.createElement('canvas');
    imgCanvas.width = sourceRgba.width;
    imgCanvas.height = sourceRgba.height;
    imgCanvas.getContext('2d').putImageData(new ImageData(sourceRgba.data, sourceRgba.width, sourceRgba.height), 0, 0);
    const ctx = canvas.getContext('2d');
    let cropRect = null;
    let dragging = false;
    let startX = 0, startY = 0;
    function normalizeRect(r) {
        let x = r.w >= 0 ? r.x : r.x + r.w;
        let y = r.h >= 0 ? r.y : r.y + r.h;
        let w = Math.abs(r.w);
        let h = Math.abs(r.h);
        x = Math.max(0, x);
        y = Math.max(0, y);
        w = Math.min(w, canvasW - x);
        h = Math.min(h, canvasH - y);
        return {
            x,
            y,
            w,
            h
        };
    }
    function draw() {
        ctx.clearRect(0, 0, canvasW, canvasH);
        ctx.drawImage(imgCanvas, 0, 0, canvasW, canvasH);
        if (!cropRect || Math.abs(cropRect.w) < 2 || Math.abs(cropRect.h) < 2) return;
        const nr = normalizeRect(cropRect);
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(0, 0, canvasW, nr.y);
        ctx.fillRect(0, nr.y + nr.h, canvasW, canvasH - nr.y - nr.h);
        ctx.fillRect(0, nr.y, nr.x, nr.h);
        ctx.fillRect(nr.x + nr.w, nr.y, canvasW - nr.x - nr.w, nr.h);
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 1;
        ctx.setLineDash([
            4,
            3
        ]);
        ctx.strokeRect(nr.x + 0.5, nr.y + 0.5, nr.w - 1, nr.h - 1);
        ctx.setLineDash([]);
        ctx.strokeStyle = 'rgba(255,255,255,0.22)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        for(let i = 1; i <= 2; i++){
            ctx.moveTo(nr.x + nr.w * i / 3, nr.y);
            ctx.lineTo(nr.x + nr.w * i / 3, nr.y + nr.h);
            ctx.moveTo(nr.x, nr.y + nr.h * i / 3);
            ctx.lineTo(nr.x + nr.w, nr.y + nr.h * i / 3);
        }
        ctx.stroke();
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        const hl = Math.min(14, nr.w / 4, nr.h / 4);
        ctx.beginPath();
        ctx.moveTo(nr.x + hl, nr.y);
        ctx.lineTo(nr.x, nr.y);
        ctx.lineTo(nr.x, nr.y + hl);
        ctx.moveTo(nr.x + nr.w - hl, nr.y);
        ctx.lineTo(nr.x + nr.w, nr.y);
        ctx.lineTo(nr.x + nr.w, nr.y + hl);
        ctx.moveTo(nr.x, nr.y + nr.h - hl);
        ctx.lineTo(nr.x, nr.y + nr.h);
        ctx.lineTo(nr.x + hl, nr.y + nr.h);
        ctx.moveTo(nr.x + nr.w - hl, nr.y + nr.h);
        ctx.lineTo(nr.x + nr.w, nr.y + nr.h);
        ctx.lineTo(nr.x + nr.w, nr.y + nr.h - hl);
        ctx.stroke();
    }
    function canvasPos(e) {
        const r = canvas.getBoundingClientRect();
        return {
            x: Math.max(0, Math.min(canvasW, e.clientX - r.left)),
            y: Math.max(0, Math.min(canvasH, e.clientY - r.top))
        };
    }
    canvas.addEventListener('mousedown', (e)=>{
        const p = canvasPos(e);
        startX = p.x;
        startY = p.y;
        cropRect = {
            x: startX,
            y: startY,
            w: 0,
            h: 0
        };
        dragging = true;
        applyBtn.disabled = true;
        e.preventDefault();
    });
    const onMouseMove = (e)=>{
        if (!dragging) return;
        const p = canvasPos(e);
        cropRect = {
            x: startX,
            y: startY,
            w: p.x - startX,
            h: p.y - startY
        };
        draw();
    };
    const onMouseUp = ()=>{
        if (!dragging) return;
        dragging = false;
        if (cropRect && Math.abs(cropRect.w) > 5 && Math.abs(cropRect.h) > 5) {
            applyBtn.disabled = false;
        }
        draw();
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    function cleanup() {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        overlay.remove();
    }
    skipBtn.addEventListener('click', ()=>{
        cleanup();
        onSkip();
    });
    applyBtn.addEventListener('click', async ()=>{
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
        tmpCanvas.getContext('2d').putImageData(new ImageData(croppedRgba.data, iw, ih), 0, 0);
        const blob = await new Promise((res)=>tmpCanvas.toBlob((b)=>res(b), 'image/png'));
        cleanup();
        onConfirm({
            rgba: croppedRgba,
            blob
        });
    });
    draw();
}
function cropRgba(src, x, y, w, h) {
    const out = new Uint8ClampedArray(w * h * 4);
    for(let row = 0; row < h; row++){
        const srcOffset = ((y + row) * src.width + x) * 4;
        out.set(src.data.subarray(srcOffset, srcOffset + w * 4), row * w * 4);
    }
    return {
        width: w,
        height: h,
        data: out
    };
}
