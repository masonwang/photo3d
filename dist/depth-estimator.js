import { pipeline, env } from '@huggingface/transformers';
env.allowLocalModels = false;
env.allowRemoteModels = true;
const MODEL_ID = 'onnx-community/depth-anything-v2-small';
let pipelinePromise = null;
function getDepthPipeline(onProgress) {
    if (!pipelinePromise) {
        pipelinePromise = pipeline('depth-estimation', MODEL_ID, {
            progress_callback: onProgress ? (info)=>{
                if (info.status === 'downloading') {
                    const pct = info.progress != null ? ` ${Math.round(info.progress)}%` : '';
                    onProgress(`Downloading AI model…${pct}`);
                } else if (info.status === 'loading') {
                    onProgress('Loading AI model…');
                }
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
