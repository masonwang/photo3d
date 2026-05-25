import { ParamStore, HOT_KEYS, COLD_KEYS, FREE_KEYS } from './store.js';
import { decodeImageToRgba, resampleRgba, rgbaToLuminance, rgbaToGrey, resampleFloat32Bilinear, applyImageParams } from './image-processor.js';
import { buildMesh, updateFrontZ } from './mesh-generator.js';
import { meshToBinaryStl, validateBinaryStlBuffer } from './stl-writer.js';
import { Preview } from './preview.js';
import { mountControls, showStatus } from './ui.js';
import { estimateDepth, setHfToken } from './depth-estimator.js';
const store = new ParamStore();
const controlsHost = document.getElementById('controls');
const previewHost = document.getElementById('preview-canvas');
const emptyMsg = document.getElementById('preview-empty');
const fileInput = document.getElementById('file-input');
const downloadBtn = document.getElementById('download-btn');
const statusPill = document.getElementById('status-pill');
const dimsEl = document.getElementById('preview-dims');
const presetButtons = document.querySelectorAll('#view-presets button');
const modeButtons = document.querySelectorAll('#render-modes button');
const resetBtn = document.getElementById('reset-view');
let sourceRgba = null;
let sourceBlob = null;
let lastLum = null;
let lastMesh = null;
let lastRawDepth = null;
let useDepthAI = false;
let depthBlend = 0.5;
mountControls(controlsHost, store);
mountDepthAiButton(controlsHost);
const preview = new Preview(previewHost);
let coldPathTimer = null;
function updateDims() {
    if (!lastMesh) return;
    const p = store.get();
    const w = lastMesh.bbox.max[0] - lastMesh.bbox.min[0];
    const h = lastMesh.bbox.max[1] - lastMesh.bbox.min[1];
    dimsEl.textContent = `${w.toFixed(0)} × ${h.toFixed(0)} × ${p.maxThicknessMm.toFixed(1)} mm`;
    dimsEl.style.display = 'block';
}
function gridSize() {
    if (!sourceRgba) return {
        gridW: 8,
        gridH: 8
    };
    const p = store.get();
    const gridW = Math.max(8, Math.round(p.widthMm * p.pixelsPerMm));
    const aspect = sourceRgba.height / sourceRgba.width;
    const gridH = Math.max(8, Math.round(gridW * aspect));
    return {
        gridW,
        gridH
    };
}
function deriveLuminance(gridW, gridH) {
    const p = store.get();
    if (useDepthAI && lastRawDepth) {
        const depth = resampleFloat32Bilinear(lastRawDepth.data, lastRawDepth.width, lastRawDepth.height, gridW, gridH);
        if (depthBlend >= 1) {
            return applyImageParams(depth, gridW, gridH, p);
        }
        const photo = rgbaToGrey(resampleRgba(sourceRgba, gridW, gridH));
        const mixed = new Float32Array(gridW * gridH);
        for(let i = 0; i < mixed.length; i++){
            mixed[i] = depthBlend * depth[i] + (1 - depthBlend) * photo[i];
        }
        return applyImageParams(mixed, gridW, gridH, p);
    }
    const resampled = resampleRgba(sourceRgba, gridW, gridH);
    return rgbaToLuminance(resampled, p);
}
function buildAndShow() {
    if (!sourceRgba) return;
    const p = store.get();
    const { gridW, gridH } = gridSize();
    const lum = deriveLuminance(gridW, gridH);
    lastLum = lum;
    const mesh = buildMesh({
        width: lum.width,
        height: lum.height,
        data: lum.data
    }, {
        widthMm: p.widthMm,
        minThicknessMm: p.minThicknessMm,
        maxThicknessMm: p.maxThicknessMm,
        borderMm: p.borderMm
    });
    lastMesh = mesh;
    preview.setMesh(mesh);
    emptyMsg.style.display = 'none';
    downloadBtn.disabled = false;
    updateDims();
}
function hotZUpdate() {
    if (!sourceRgba || !lastMesh || !lastLum) return;
    const p = store.get();
    const { gridW, gridH } = gridSize();
    const lum = deriveLuminance(gridW, gridH);
    lastLum = lum;
    updateFrontZ(lastMesh.positions, {
        width: lum.width,
        height: lum.height,
        data: lum.data
    }, p.borderMm, p.widthMm / lum.width, p.minThicknessMm, p.maxThicknessMm);
    preview.notifyZUpdated();
    updateDims();
}
function scheduleColdRebuild() {
    if (coldPathTimer != null) clearTimeout(coldPathTimer);
    showStatus(statusPill, 'Updating preview…', 0);
    coldPathTimer = window.setTimeout(()=>{
        buildAndShow();
        showStatus(statusPill, 'Updated', 800);
        coldPathTimer = null;
    }, 150);
}
store.subscribe(HOT_KEYS, ()=>{
    if (!sourceRgba) return;
    hotZUpdate();
});
store.subscribe(COLD_KEYS, ()=>{
    if (!sourceRgba) return;
    scheduleColdRebuild();
});
store.subscribe(FREE_KEYS, ()=>{
    if (!sourceRgba) return;
    scheduleColdRebuild();
});
fileInput.addEventListener('change', async ()=>{
    const f = fileInput.files?.[0];
    if (!f) return;
    showStatus(statusPill, 'Decoding image…', 0);
    try {
        sourceBlob = f;
        sourceRgba = await decodeImageToRgba(f);
        if (useDepthAI) {
            await runDepthEstimation();
        } else {
            buildAndShow();
        }
        showStatus(statusPill, `Loaded ${sourceRgba.width}×${sourceRgba.height}`, 1500);
    } catch (err) {
        console.error(err);
        showStatus(statusPill, 'Failed to load image', 2000);
    }
});
downloadBtn.addEventListener('click', ()=>{
    if (!sourceRgba) return;
    buildAndShow();
    if (!lastMesh) return;
    const buf = meshToBinaryStl(lastMesh, 'lithophane-app v0.1');
    const err = validateBinaryStlBuffer(buf);
    if (err) {
        showStatus(statusPill, `STL invalid: ${err}`, 4000);
        return;
    }
    const blob = new Blob([
        buf
    ], {
        type: 'application/octet-stream'
    });
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
presetButtons.forEach((btn)=>{
    btn.addEventListener('click', ()=>{
        presetButtons.forEach((b)=>b.classList.remove('active'));
        btn.classList.add('active');
        preview.applyPreset(btn.dataset.preset);
    });
});
modeButtons.forEach((btn)=>{
    btn.addEventListener('click', ()=>{
        modeButtons.forEach((b)=>b.classList.remove('active'));
        btn.classList.add('active');
        preview.setMode(btn.dataset.mode);
    });
});
resetBtn.addEventListener('click', ()=>preview.resetView());
window.addEventListener('keydown', (e)=>{
    if (e.target instanceof HTMLInputElement) return;
    switch(e.key.toLowerCase()){
        case 'f':
            preview.applyPreset('front');
            break;
        case 'b':
            preview.applyPreset('back');
            break;
        case 't':
            preview.applyPreset('top');
            break;
        case 'r':
            preview.resetView();
            break;
        case 'l':
            preview.setMode('lit');
            break;
        case 'k':
            preview.setMode('backlit');
            break;
        case 'w':
            preview.setMode('wireframe');
            break;
    }
});
async function runDepthEstimation() {
    if (!sourceBlob || !sourceRgba) return;
    try {
        lastRawDepth = await estimateDepth(sourceBlob, (msg)=>{
            showStatus(statusPill, msg, 0);
        });
        buildAndShow();
    } catch (err) {
        console.error('AI depth estimation failed:', err);
        const isAuth = String(err).includes('Unauthorized') || String(err).includes('401');
        showStatus(statusPill, isAuth ? 'Auth failed — check HuggingFace token below' : 'AI depth failed — using photo luminance', isAuth ? 5000 : 3000);
        useDepthAI = false;
        lastRawDepth = null;
        updateDepthAiButton();
        buildAndShow();
    }
}
function updateDepthAiButton() {
    const btn = document.getElementById('depth-ai-btn');
    const note = document.getElementById('depth-ai-note');
    if (!btn) return;
    btn.textContent = useDepthAI ? 'Disable AI Depth' : 'Enable AI Depth';
    btn.classList.toggle('active', useDepthAI);
    if (note) note.style.display = useDepthAI ? 'block' : 'none';
}
function mountDepthAiButton(host) {
    const section = document.createElement('div');
    section.className = 'control-group';
    const h = document.createElement('h3');
    h.textContent = 'AI Depth';
    section.appendChild(h);
    const btn = document.createElement('button');
    btn.id = 'depth-ai-btn';
    btn.textContent = 'Enable AI Depth';
    btn.title = 'Use Depth Anything to estimate real geometry instead of photo brightness';
    btn.addEventListener('click', async ()=>{
        if (!sourceRgba) {
            showStatus(statusPill, 'Open a photo first', 1500);
            return;
        }
        if (!localStorage.getItem('hf-token')) {
            showStatus(statusPill, 'Save a HuggingFace token below first', 2500);
            document.getElementById('hf-token-input')?.focus();
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
    const tokenRow = document.createElement('div');
    tokenRow.className = 'control-row';
    tokenRow.style.marginTop = '8px';
    const tokenLabel = document.createElement('label');
    tokenLabel.htmlFor = 'hf-token-input';
    tokenLabel.textContent = 'HF Token';
    tokenLabel.title = 'Free HuggingFace access token — required to download the depth model';
    const tokenInput = document.createElement('input');
    tokenInput.type = 'password';
    tokenInput.id = 'hf-token-input';
    tokenInput.placeholder = 'hf_…';
    tokenInput.value = localStorage.getItem('hf-token') || '';
    tokenInput.style.cssText = 'flex:1;min-width:0;font-size:11px;padding:3px 6px;border-radius:4px;border:1px solid var(--border);';
    const tokenSave = document.createElement('button');
    tokenSave.textContent = 'Save';
    tokenSave.style.cssText = 'flex-shrink:0;padding:3px 8px;font-size:11px;';
    tokenSave.addEventListener('click', ()=>{
        const t = tokenInput.value.trim();
        if (t) {
            localStorage.setItem('hf-token', t);
        } else {
            localStorage.removeItem('hf-token');
        }
        setHfToken(t);
        showStatus(statusPill, t ? 'Token saved' : 'Token cleared', 1500);
    });
    tokenRow.appendChild(tokenLabel);
    tokenRow.appendChild(tokenInput);
    tokenRow.appendChild(tokenSave);
    section.appendChild(tokenRow);
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
    blendSlider.addEventListener('input', ()=>{
        depthBlend = Number(blendSlider.value) / 100;
        blendVal.textContent = blendSlider.value + '%';
        if (useDepthAI && sourceRgba && lastMesh && lastRawDepth) hotZUpdate();
    });
    blendRow.appendChild(blendLabel);
    blendRow.appendChild(blendSlider);
    blendRow.appendChild(blendVal);
    section.appendChild(blendRow);
    const getTokenNote = document.createElement('p');
    getTokenNote.className = 'depth-ai-note';
    getTokenNote.innerHTML = 'Free token: <a href="https://huggingface.co/settings/tokens" target="_blank" ' + 'style="color:var(--accent)">huggingface.co/settings/tokens</a>';
    section.appendChild(getTokenNote);
    const note = document.createElement('p');
    note.id = 'depth-ai-note';
    note.className = 'depth-ai-note';
    note.textContent = 'Tip: toggle "Invert" to swap near↔far. For portraits, raise Contrast to amplify subtle depth differences, or use normal (luminance) mode for finer facial detail.';
    note.style.display = 'none';
    section.appendChild(note);
    host.appendChild(section);
    const saved = localStorage.getItem('hf-token');
    if (saved) setHfToken(saved);
}
