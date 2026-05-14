export async function decodeImageToRgba(source) {
    const bmp = await createImageBitmap(source);
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
export function rgbaToLuminance(src, p) {
    const { width: W, height: H, data } = src;
    const out = new Float32Array(W * H);
    for(let i = 0, j = 0; i < data.length; i += 4, j++){
        out[j] = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
    }
    if (p.mirror) {
        for(let y = 0; y < H; y++){
            const row = y * W;
            for(let x = 0; x < W / 2; x++){
                const a = row + x;
                const b = row + (W - 1 - x);
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
        for(let i = 0; i < out.length; i++){
            out[i] = clamp01(out[i] + bAdd);
        }
    }
    const c = (p.contrast + 100) / 100;
    if (c !== 1) {
        for(let i = 0; i < out.length; i++){
            out[i] = clamp01((out[i] - 0.5) * c + 0.5);
        }
    }
    const g = p.gamma;
    if (g !== 1) {
        for(let i = 0; i < out.length; i++){
            out[i] = Math.pow(out[i], g);
        }
    }
    const r = Math.max(0, Math.round(p.smoothingPx));
    if (r > 0) {
        return {
            width: W,
            height: H,
            data: boxBlur(out, W, H, r)
        };
    }
    return {
        width: W,
        height: H,
        data: out
    };
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
