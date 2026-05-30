import { ParamStore, defaultParams } from './store.js';
const GROUPS = [
    {
        title: 'Geometry',
        controls: [
            {
                kind: 'range',
                key: 'widthMm',
                label: 'Width',
                min: 30,
                max: 250,
                step: 1,
                format: (v)=>`${v.toFixed(0)} mm`
            },
            {
                kind: 'range',
                key: 'minThicknessMm',
                label: 'Min thickness',
                min: 0.4,
                max: 1.5,
                step: 0.05,
                format: (v)=>`${v.toFixed(2)} mm`
            },
            {
                kind: 'range',
                key: 'maxThicknessMm',
                label: 'Max thickness',
                min: 1.5,
                max: 4.5,
                step: 0.05,
                format: (v)=>`${v.toFixed(2)} mm`
            },
            {
                kind: 'range',
                key: 'pixelsPerMm',
                label: 'Resolution',
                min: 4,
                max: 14,
                step: 1,
                format: (v)=>`${v.toFixed(0)} px/mm`
            }
        ]
    },
    {
        title: 'Image',
        controls: [
            {
                kind: 'toggle',
                key: 'mirror',
                label: 'Mirror horizontally'
            },
            {
                kind: 'toggle',
                key: 'invert',
                label: 'Invert'
            },
            {
                kind: 'range',
                key: 'gamma',
                label: 'Gamma',
                min: 0.5,
                max: 3.0,
                step: 0.05,
                format: (v)=>v.toFixed(2)
            },
            {
                kind: 'range',
                key: 'brightness',
                label: 'Brightness',
                min: -50,
                max: 50,
                step: 1,
                format: (v)=>`${v > 0 ? '+' : ''}${v.toFixed(0)}`
            },
            {
                kind: 'range',
                key: 'contrast',
                label: 'Contrast',
                min: -50,
                max: 50,
                step: 1,
                format: (v)=>`${v > 0 ? '+' : ''}${v.toFixed(0)}`
            },
            {
                kind: 'range',
                key: 'smoothingPx',
                label: 'Smoothing',
                min: 0,
                max: 4,
                step: 1,
                format: (v)=>`${v.toFixed(0)} px`
            }
        ]
    },
    {
        title: 'Border',
        controls: [
            {
                kind: 'range',
                key: 'borderMm',
                label: 'Border width',
                min: 0,
                max: 8,
                step: 0.5,
                format: (v)=>`${v.toFixed(1)} mm`
            }
        ]
    },
    {
        title: 'Base',
        controls: [
            {
                kind: 'range',
                key: 'baseExtendMm',
                label: 'Width',
                min: 0,
                max: 30,
                step: 0.5,
                format: (v)=>`${v.toFixed(1)} mm`
            },
            {
                kind: 'range',
                key: 'baseHeightMm',
                label: 'Depth',
                min: 0,
                max: 10,
                step: 0.5,
                format: (v)=>`${v.toFixed(1)} mm`
            },
            {
                kind: 'range',
                key: 'baseTabWidthMm',
                label: 'Tab width',
                min: 0,
                max: 10,
                step: 0.5,
                format: (v)=>v === 0 ? 'solid' : `${v.toFixed(1)} mm`
            }
        ]
    },
    {
        title: 'Output',
        controls: [
            {
                kind: 'toggle',
                key: 'asciiStl',
                label: 'ASCII STL (debug)'
            }
        ]
    }
];
export function mountControls(host, store) {
    host.innerHTML = '';
    const valueEls = new Map();
    const inputEls = new Map();
    for (const g of GROUPS){
        const groupEl = document.createElement('div');
        groupEl.className = 'control-group';
        const h = document.createElement('h3');
        h.textContent = g.title;
        groupEl.appendChild(h);
        for (const c of g.controls){
            const row = document.createElement('div');
            row.className = c.kind === 'toggle' ? 'control-row toggle' : 'control-row';
            const lbl = document.createElement('label');
            lbl.textContent = c.label;
            row.appendChild(lbl);
            if (c.kind === 'range') {
                const input = document.createElement('input');
                input.type = 'range';
                input.min = String(c.min);
                input.max = String(c.max);
                input.step = String(c.step);
                const cur = store.get()[c.key];
                input.value = String(cur);
                const valEl = document.createElement('span');
                valEl.className = 'value';
                valEl.textContent = c.format ? c.format(cur) : String(cur);
                input.addEventListener('input', ()=>{
                    const v = Number(input.value);
                    store.set(c.key, v);
                    valEl.textContent = c.format ? c.format(v) : String(v);
                });
                row.appendChild(input);
                row.appendChild(valEl);
                valueEls.set(c.key, valEl);
                inputEls.set(c.key, input);
            } else {
                const input = document.createElement('input');
                input.type = 'checkbox';
                input.checked = Boolean(store.get()[c.key]);
                input.addEventListener('change', ()=>{
                    store.set(c.key, input.checked);
                });
                row.appendChild(input);
                inputEls.set(c.key, input);
            }
            lbl.htmlFor = `ctl-${c.key}`;
            groupEl.appendChild(row);
        }
        host.appendChild(groupEl);
    }
    const resetWrap = document.createElement('div');
    resetWrap.className = 'control-group';
    const btn = document.createElement('button');
    btn.textContent = 'Reset to defaults';
    btn.addEventListener('click', ()=>{
        store.setMany({
            ...defaultParams
        });
        for (const [k, el] of inputEls){
            const v = store.get()[k];
            if (el.type === 'checkbox') el.checked = Boolean(v);
            else el.value = String(v);
        }
        for (const g of GROUPS)for (const c of g.controls)if (c.kind === 'range') {
            const v = store.get()[c.key];
            const el = valueEls.get(c.key);
            if (el) el.textContent = c.format ? c.format(v) : String(v);
        }
    });
    resetWrap.appendChild(btn);
    host.appendChild(resetWrap);
}
export function showStatus(host, text, hideAfterMs = 1500) {
    host.textContent = text;
    host.classList.add('show');
    host.classList.toggle('loading', hideAfterMs === 0);
    if (hideAfterMs > 0) {
        window.setTimeout(()=>{
            host.classList.remove('show', 'loading');
        }, hideAfterMs);
    }
}
