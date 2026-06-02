export function resampleFloat32(src, srcW, srcH, dstW, dstH) {
    if (srcW === dstW && srcH === dstH) return src;
    const out = new Float32Array(dstW * dstH);
    const sx = srcW / dstW;
    const sy = srcH / dstH;
    for(let y = 0; y < dstH; y++){
        const srcY = Math.min(srcH - 1, Math.floor(y * sy));
        for(let x = 0; x < dstW; x++){
            const srcX = Math.min(srcW - 1, Math.floor(x * sx));
            out[y * dstW + x] = src[srcY * srcW + srcX];
        }
    }
    return out;
}
export function resampleFloat32Bilinear(src, srcW, srcH, dstW, dstH) {
    if (srcW === dstW && srcH === dstH) return src;
    const out = new Float32Array(dstW * dstH);
    for(let y = 0; y < dstH; y++){
        const fy = (y + 0.5) * (srcH / dstH) - 0.5;
        const y0 = Math.max(0, Math.floor(fy));
        const y1 = Math.min(srcH - 1, y0 + 1);
        const dy = fy - y0;
        for(let x = 0; x < dstW; x++){
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
export function applyImageParams(src, W, H, p) {
    const out = src.slice();
    if (p.mirror) {
        for(let y = 0; y < H; y++){
            const row = y * W;
            for(let x = 0; x < W / 2; x++){
                const a = row + x, b = row + (W - 1 - x);
                const t = out[a];
                out[a] = out[b];
                out[b] = t;
            }
        }
    }
    if (p.invert) {
        for(let i = 0; i < out.length; i++)out[i] = 1 - out[i];
    }
    const bAdd = p.brightness / 100;
    if (bAdd !== 0) {
        for(let i = 0; i < out.length; i++)out[i] = clamp01(out[i] + bAdd);
    }
    const c = (p.contrast + 100) / 100;
    if (c !== 1) {
        for(let i = 0; i < out.length; i++)out[i] = clamp01((out[i] - 0.5) * c + 0.5);
    }
    const g = p.gamma;
    if (g !== 1) {
        for(let i = 0; i < out.length; i++)out[i] = Math.pow(out[i], g);
    }
    const r = Math.max(0, Math.round(p.smoothingPx));
    if (r > 0) return {
        width: W,
        height: H,
        data: boxBlur(out, W, H, r)
    };
    return {
        width: W,
        height: H,
        data: out
    };
}
function isHeic(blob) {
    if (blob.type === 'image/heic' || blob.type === 'image/heif') return true;
    const name = (blob.name ?? '').toLowerCase();
    return name.endsWith('.heic') || name.endsWith('.heif');
}
async function bitmapForHeic(blob) {
    try {
        return await createImageBitmap(blob);
    } catch  {}
    const ImageDecoder = window.ImageDecoder;
    if (typeof ImageDecoder !== 'undefined') {
        try {
            const type = blob.type || 'image/heic';
            if (await ImageDecoder.isTypeSupported(type)) {
                const dec = new ImageDecoder({
                    data: blob.stream(),
                    type
                });
                const { image } = await dec.decode();
                const bmp = await createImageBitmap(image);
                image.close?.();
                dec.close();
                return bmp;
            }
        } catch  {}
    }
    const url = URL.createObjectURL(blob);
    try {
        const img = new Image();
        await new Promise((res, rej)=>{
            img.onload = ()=>res();
            img.onerror = rej;
            img.src = url;
        });
        return await createImageBitmap(img);
    } catch  {
        throw new Error('HEIC not supported in this browser. Try Safari.');
    } finally{
        URL.revokeObjectURL(url);
    }
}
export async function decodeImageToRgba(source) {
    const bmp = await (isHeic(source) ? bitmapForHeic(source) : createImageBitmap(source));
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext('2d', {
        willReadFrequently: true
    });
    ctx.drawImage(bmp, 0, 0);
    const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
    return {
        width: img.width,
        height: img.height,
        data: img.data
    };
}
export function resampleRgba(src, targetW, targetH) {
    if (src.width === targetW && src.height === targetH) return src;
    const out = new Uint8ClampedArray(targetW * targetH * 4);
    const sx = src.width / targetW;
    const sy = src.height / targetH;
    for(let y = 0; y < targetH; y++){
        const srcY = Math.min(src.height - 1, Math.floor(y * sy));
        for(let x = 0; x < targetW; x++){
            const srcX = Math.min(src.width - 1, Math.floor(x * sx));
            const si = (srcY * src.width + srcX) * 4;
            const di = (y * targetW + x) * 4;
            out[di] = src.data[si];
            out[di + 1] = src.data[si + 1];
            out[di + 2] = src.data[si + 2];
            out[di + 3] = src.data[si + 3];
        }
    }
    return {
        width: targetW,
        height: targetH,
        data: out
    };
}
export function rgbaToGrey(src) {
    const { data } = src;
    const grey = new Float32Array(src.width * src.height);
    for(let i = 0, j = 0; i < data.length; i += 4, j++){
        grey[j] = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
    }
    return grey;
}
export function rgbaToLuminance(src, p) {
    const { width: W, height: H } = src;
    const grey = rgbaToGrey(src);
    return applyImageParams(grey, W, H, p);
}
function clamp01(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
}
function boxBlur(src, W, H, r) {
    const tmp = new Float32Array(src.length);
    const out = new Float32Array(src.length);
    for(let y = 0; y < H; y++){
        for(let x = 0; x < W; x++){
            let sum = 0, cnt = 0;
            for(let dx = -r; dx <= r; dx++){
                const nx = x + dx;
                if (nx >= 0 && nx < W) {
                    sum += src[y * W + nx];
                    cnt++;
                }
            }
            tmp[y * W + x] = sum / cnt;
        }
    }
    for(let y = 0; y < H; y++){
        for(let x = 0; x < W; x++){
            let sum = 0, cnt = 0;
            for(let dy = -r; dy <= r; dy++){
                const ny = y + dy;
                if (ny >= 0 && ny < H) {
                    sum += tmp[ny * W + x];
                    cnt++;
                }
            }
            out[y * W + x] = sum / cnt;
        }
    }
    return out;
}
