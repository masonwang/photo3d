import { pipeline, env } from '@huggingface/transformers';
env.allowLocalModels = false;
env.allowRemoteModels = true;
const MODEL_ID = 'Xenova/depth-anything-small-hf';
const CACHE_NAME = 'hf-model-cache';
let hfToken = '';
let pipelinePromise = null;
export function setHfToken(token) {
    hfToken = token;
    pipelinePromise = null;
}
function installAuthCache(token, onProgress) {
    const mem = new Map();
    env.useCustomCache = true;
    env.customCache = {
        async match (url) {
            const hit = mem.get(url);
            if (hit) return new Response(hit.buf.slice(0), {
                headers: {
                    'Content-Type': hit.ct
                }
            });
            if (typeof caches !== 'undefined') {
                try {
                    const c = await caches.open(CACHE_NAME);
                    const cached = await c.match(url);
                    if (cached) {
                        const buf = await cached.arrayBuffer();
                        const ct = cached.headers.get('Content-Type') ?? 'application/octet-stream';
                        mem.set(url, {
                            buf,
                            ct
                        });
                        return new Response(buf.slice(0), {
                            headers: {
                                'Content-Type': ct
                            }
                        });
                    }
                } catch (_) {}
            }
            if (/huggingface\.co|hf\.co/.test(url)) {
                const resp = await fetch(url, {
                    headers: {
                        Authorization: `Bearer ${token}`
                    }
                });
                if (!resp.ok) {
                    return undefined;
                }
                const ct = resp.headers.get('Content-Type') ?? 'application/octet-stream';
                const total = parseInt(resp.headers.get('Content-Length') ?? '0', 10);
                const reader = resp.body.getReader();
                const chunks = [];
                let received = 0;
                while(true){
                    const { done, value } = await reader.read();
                    if (done) break;
                    chunks.push(value);
                    received += value.byteLength;
                    if (total > 0 && onProgress) {
                        onProgress(`Downloading AI model… ${Math.round(received / total * 100)}%`);
                    }
                }
                const buf = new Uint8Array(received);
                let offset = 0;
                for (const chunk of chunks){
                    buf.set(chunk, offset);
                    offset += chunk.byteLength;
                }
                const arrayBuf = buf.buffer;
                mem.set(url, {
                    buf: arrayBuf,
                    ct
                });
                if (typeof caches !== 'undefined') {
                    try {
                        const c = await caches.open(CACHE_NAME);
                        await c.put(url, new Response(arrayBuf.slice(0), {
                            headers: {
                                'Content-Type': ct
                            }
                        }));
                    } catch (_) {}
                }
                return new Response(arrayBuf.slice(0), {
                    headers: {
                        'Content-Type': ct
                    }
                });
            }
            return undefined;
        },
        async put () {}
    };
}
function getDepthPipeline(onProgress) {
    if (!pipelinePromise) {
        installAuthCache(hfToken, onProgress);
        pipelinePromise = pipeline('depth-estimation', MODEL_ID, {
            progress_callback: onProgress ? (info)=>{
                if (info.status === 'loading') onProgress('Loading AI model…');
            } : undefined
        }).catch((err)=>{
            pipelinePromise = null;
            throw err;
        });
    }
    return pipelinePromise;
}
export async function estimateDepth(source, onProgress) {
    const estimator = await getDepthPipeline(onProgress);
    onProgress?.('Running depth estimation…');
    const url = URL.createObjectURL(source);
    try {
        const output = await estimator(url);
        const predicted_depth = output.predicted_depth;
        const rawData = predicted_depth.data;
        const dims = predicted_depth.dims;
        const W = dims[dims.length - 1];
        const H = dims[dims.length - 2];
        const offset = rawData.length - W * H;
        const n = W * H;
        let maxVal = 0;
        for(let i = 0; i < n; i++){
            if (rawData[offset + i] > maxVal) maxVal = rawData[offset + i];
        }
        if (maxVal === 0) maxVal = 1;
        const out = new Float32Array(n);
        for(let i = 0; i < n; i++){
            out[i] = rawData[offset + i] / maxVal;
        }
        return {
            width: W,
            height: H,
            data: out
        };
    } finally{
        URL.revokeObjectURL(url);
    }
}
