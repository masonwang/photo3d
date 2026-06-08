import { ParamStore } from './store.js';
export const SHAPES = [
    {
        id: 'curve',
        name: 'Curve',
        shapeGroups: [
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
                        key: 'heightMm',
                        label: 'Height',
                        min: 0,
                        max: 300,
                        step: 1,
                        format: (v)=>v === 0 ? 'auto' : `${v.toFixed(0)} mm`
                    },
                    {
                        kind: 'range',
                        key: 'arcDeg',
                        label: 'Arc angle',
                        min: 10,
                        max: 150,
                        step: 5,
                        format: (v)=>`${v.toFixed(0)}°`
                    }
                ]
            }
        ],
        defaults: {
            widthMm: 100,
            arcDeg: 90,
            heightMm: 0,
            minThicknessMm: 0.5,
            maxThicknessMm: 2.0,
            pixelsPerMm: 10,
            borderMm: 0,
            baseExtendMm: 2,
            baseHeightMm: 2,
            baseTabWidthMm: 2,
            mirror: false,
            invert: true,
            gamma: 1.0,
            brightness: 0,
            contrast: 30,
            smoothingPx: 1,
            asciiStl: false
        }
    }
];
const COMMON_GROUPS = [
    {
        title: 'Lithophane',
        controls: [
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
                label: 'Foot depth',
                min: 0,
                max: 30,
                step: 0.5,
                format: (v)=>`${v.toFixed(1)} mm`
            },
            {
                kind: 'range',
                key: 'baseHeightMm',
                label: 'Base height',
                min: 0,
                max: 30,
                step: 0.5,
                format: (v)=>`${v.toFixed(1)} mm`
            },
            {
                kind: 'range',
                key: 'baseTabWidthMm',
                label: 'Rib width',
                min: 0,
                max: 10,
                step: 0.5,
                format: (v)=>v === 0 ? 'none' : `${v.toFixed(1)} mm`
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
export function mountControls(host, store, onShapeChange) {
    host.innerHTML = '';
    const inputEls = new Map();
    const valueEls = new Map();
    const formatFns = new Map();
    let shapeKeys = new Set();
    let currentShape = SHAPES[0];
    function buildControl(c, container, trackSet) {
        const row = document.createElement('div');
        row.className = c.kind === 'toggle' ? 'control-row toggle' : 'control-row';
        const lbl = document.createElement('label');
        lbl.textContent = c.label;
        lbl.htmlFor = `ctl-${c.key}`;
        row.appendChild(lbl);
        if (c.kind === 'range') {
            const input = document.createElement('input');
            input.type = 'range';
            input.id = `ctl-${c.key}`;
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
            formatFns.set(c.key, c.format);
        } else {
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.id = `ctl-${c.key}`;
            input.checked = Boolean(store.get()[c.key]);
            input.addEventListener('change', ()=>store.set(c.key, input.checked));
            row.appendChild(input);
        }
        inputEls.set(c.key, row.querySelector('input'));
        trackSet.add(c.key);
        container.appendChild(row);
    }
    function buildGroups(groups, container, trackSet) {
        for (const g of groups){
            const groupEl = document.createElement('div');
            groupEl.className = 'control-group';
            const h3 = document.createElement('h3');
            h3.textContent = g.title;
            groupEl.appendChild(h3);
            for (const c of g.controls)buildControl(c, groupEl, trackSet);
            container.appendChild(groupEl);
        }
    }
    function refreshInputs() {
        for (const [k, el] of inputEls){
            const v = store.get()[k];
            if (el.type === 'checkbox') {
                el.checked = Boolean(v);
            } else {
                el.value = String(v);
                const valEl = valueEls.get(k);
                if (valEl) {
                    const fmt = formatFns.get(k);
                    valEl.textContent = fmt ? fmt(v) : String(v);
                }
            }
        }
    }
    const shapeSectionEl = document.createElement('div');
    shapeSectionEl.className = 'control-group shape-selector-group';
    const shapeLabel = document.createElement('h3');
    shapeLabel.textContent = 'Shape';
    shapeSectionEl.appendChild(shapeLabel);
    const select = document.createElement('select');
    select.className = 'shape-select';
    for (const s of SHAPES){
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.name;
        select.appendChild(opt);
    }
    shapeSectionEl.appendChild(select);
    host.appendChild(shapeSectionEl);
    const shapeParamsHost = document.createElement('div');
    host.appendChild(shapeParamsHost);
    function renderShapeParams(shape) {
        for (const k of shapeKeys){
            inputEls.delete(k);
            valueEls.delete(k);
            formatFns.delete(k);
        }
        shapeKeys = new Set();
        shapeParamsHost.innerHTML = '';
        buildGroups(shape.shapeGroups, shapeParamsHost, shapeKeys);
    }
    renderShapeParams(currentShape);
    const customizeWrap = document.createElement('div');
    customizeWrap.className = 'customize-wrap';
    const customizeBtn = document.createElement('button');
    customizeBtn.className = 'customize-btn';
    customizeBtn.textContent = 'Customize ▸';
    customizeWrap.appendChild(customizeBtn);
    host.appendChild(customizeWrap);
    const commonHost = document.createElement('div');
    commonHost.className = 'common-params';
    commonHost.hidden = true;
    const commonKeys = new Set();
    buildGroups(COMMON_GROUPS, commonHost, commonKeys);
    host.appendChild(commonHost);
    customizeBtn.addEventListener('click', ()=>{
        const open = !commonHost.hidden;
        commonHost.hidden = open;
        customizeBtn.textContent = open ? 'Customize ▸' : 'Customize ▾';
    });
    const resetWrap = document.createElement('div');
    resetWrap.className = 'control-group';
    const resetBtn = document.createElement('button');
    resetBtn.textContent = 'Reset to defaults';
    resetBtn.addEventListener('click', ()=>{
        store.setMany({
            ...currentShape.defaults
        });
        refreshInputs();
    });
    resetWrap.appendChild(resetBtn);
    host.appendChild(resetWrap);
    select.addEventListener('change', ()=>{
        const shape = SHAPES.find((s)=>s.id === select.value) ?? SHAPES[0];
        currentShape = shape;
        store.setMany({
            ...shape.defaults
        });
        renderShapeParams(shape);
        refreshInputs();
        onShapeChange(shape.id);
    });
    return {
        commonHost
    };
}
export function showStatus(host, text, hideAfterMs = 1500, type = 'info') {
    host.textContent = text;
    host.classList.add('show');
    host.classList.toggle('loading', hideAfterMs === 0 && type === 'info');
    host.classList.toggle('error', type === 'error');
    if (hideAfterMs > 0) {
        window.setTimeout(()=>{
            host.classList.remove('show', 'loading', 'error');
        }, hideAfterMs);
    }
}
