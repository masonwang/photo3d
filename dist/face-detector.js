import { pipeline } from '@huggingface/transformers';
let _detector = null;
async function getDetector(onProgress) {
    if (_detector) return _detector;
    _detector = await pipeline('object-detection', 'Xenova/yolos-tiny', {
        progress_callback: (info)=>{
            if (info.status === 'progress' && info.total) {
                const pct = Math.round(info.loaded / info.total * 100);
                onProgress?.(`Loading face model ${pct}%…`);
            }
        }
    });
    return _detector;
}
export async function detectFaceRegions(imgCanvas, onProgress) {
    const detector = await getDetector(onProgress);
    onProgress?.('Detecting faces…');
    let results;
    try {
        results = await detector(imgCanvas, {
            threshold: 0.35
        });
    } catch (e) {
        console.error('[FaceDetect] inference error:', e);
        return [];
    }
    const persons = results.filter((r)=>r.label === 'person');
    if (persons.length === 0) return [];
    return persons.map(({ box })=>{
        const w = box.xmax - box.xmin;
        const h = box.ymax - box.ymin;
        return {
            x: box.xmin,
            y: box.ymin,
            width: w,
            height: h * 0.38
        };
    });
}
