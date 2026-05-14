import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
export class Preview {
    container;
    renderer;
    scene;
    camera;
    controls;
    litMaterial;
    backlitMaterial;
    wireMaterial;
    group = new THREE.Group();
    mesh = null;
    geometry = null;
    litLights = [];
    backlitLights = [];
    mode = 'lit';
    renderRequested = false;
    resizeObserver;
    constructor(container){
        this.container = container;
        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true
        });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setClearColor(0x000000, 0);
        container.appendChild(this.renderer.domElement);
        this.scene = new THREE.Scene();
        this.scene.add(this.group);
        this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 5000);
        this.camera.position.set(150, 120, 200);
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.08;
        this.controls.maxPolarAngle = Math.PI * 0.49;
        this.controls.minDistance = 30;
        this.controls.maxDistance = 1500;
        this.controls.addEventListener('change', ()=>this.requestRender());
        this.controls.addEventListener('start', ()=>this.requestRender());
        const key = new THREE.DirectionalLight(0xffffff, 1.6);
        key.position.set(120, 200, 200);
        const fill = new THREE.DirectionalLight(0xffffff, 0.4);
        fill.position.set(-150, 60, 100);
        const amb = new THREE.AmbientLight(0xffffff, 0.35);
        this.litLights = [
            key,
            fill,
            amb
        ];
        const back = new THREE.PointLight(0xfff2c0, 80000, 2000, 1.6);
        back.position.set(0, 0, -200);
        const ambBack = new THREE.AmbientLight(0xffffff, 0.04);
        this.backlitLights = [
            back,
            ambBack
        ];
        this.litMaterial = new THREE.MeshStandardMaterial({
            color: 0xf7f3e8,
            roughness: 0.7,
            metalness: 0.0,
            side: THREE.DoubleSide
        });
        this.backlitMaterial = new THREE.MeshPhysicalMaterial({
            color: 0xfff5e0,
            transmission: 0.95,
            thickness: 1.2,
            roughness: 0.45,
            metalness: 0.0,
            attenuationColor: 0xfff0c8,
            attenuationDistance: 8,
            ior: 1.45,
            side: THREE.DoubleSide
        });
        this.wireMaterial = new THREE.MeshBasicMaterial({
            color: 0x444444,
            wireframe: true
        });
        this.applyMode('lit');
        this.resizeObserver = new ResizeObserver(()=>this.handleResize());
        this.resizeObserver.observe(container);
        this.handleResize();
        const tick = ()=>{
            requestAnimationFrame(tick);
            this.controls.update();
            if (this.renderRequested) {
                this.renderer.render(this.scene, this.camera);
                this.renderRequested = false;
            }
        };
        tick();
    }
    handleResize() {
        const { clientWidth: w, clientHeight: h } = this.container;
        if (w === 0 || h === 0) return;
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.requestRender();
    }
    requestRender() {
        this.renderRequested = true;
    }
    setMesh(m) {
        if (this.mesh) {
            this.group.remove(this.mesh);
            this.geometry?.dispose();
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
        geo.setIndex(new THREE.BufferAttribute(m.indices, 1));
        geo.computeVertexNormals();
        this.geometry = geo;
        const mat = this.currentMaterial();
        const threeMesh = new THREE.Mesh(geo, mat);
        const cx = (m.bbox.min[0] + m.bbox.max[0]) / 2;
        const cy = (m.bbox.min[1] + m.bbox.max[1]) / 2;
        const cz = (m.bbox.min[2] + m.bbox.max[2]) / 2;
        threeMesh.position.set(-cx, -cy, -cz);
        this.group.add(threeMesh);
        this.mesh = threeMesh;
        this.fitCamera(m);
        this.requestRender();
    }
    notifyZUpdated() {
        if (!this.geometry) return;
        this.geometry.attributes.position.needsUpdate = true;
        this.geometry.computeVertexNormals();
        this.requestRender();
    }
    setScale(scale) {
        this.group.scale.setScalar(scale);
        this.requestRender();
    }
    setMode(mode) {
        this.mode = mode;
        this.applyMode(mode);
        if (this.mesh) {
            this.mesh.material = this.currentMaterial();
        }
        this.requestRender();
    }
    applyMode(mode) {
        [
            ...this.litLights,
            ...this.backlitLights
        ].forEach((l)=>this.scene.remove(l));
        if (mode === 'lit' || mode === 'wireframe') {
            this.litLights.forEach((l)=>this.scene.add(l));
            this.scene.background = new THREE.Color(0xefeee9);
        } else if (mode === 'backlit') {
            this.backlitLights.forEach((l)=>this.scene.add(l));
            this.scene.background = new THREE.Color(0x141210);
        }
    }
    currentMaterial() {
        switch(this.mode){
            case 'lit':
                return this.litMaterial;
            case 'backlit':
                return this.backlitMaterial;
            case 'wireframe':
                return this.wireMaterial;
        }
    }
    applyPreset(p) {
        if (!this.mesh) return;
        const box = new THREE.Box3().setFromObject(this.group);
        const size = box.getSize(new THREE.Vector3());
        const diag = Math.max(size.x, size.y, size.z, 1);
        const dist = diag * 2.2;
        let target = new THREE.Vector3(0, 0, 0);
        switch(p){
            case 'front':
                this.camera.position.set(0, 0, dist);
                break;
            case 'back':
                this.camera.position.set(0, 0, -dist);
                break;
            case 'top':
                this.camera.position.set(0, dist, 0.001);
                break;
            case 'three-quarter':
                this.camera.position.set(dist * 0.6, dist * 0.5, dist * 0.7);
                break;
        }
        this.camera.lookAt(target);
        this.controls.target.copy(target);
        this.controls.update();
        this.requestRender();
    }
    resetView() {
        this.applyPreset('three-quarter');
    }
    fitCamera(m) {
        const sx = m.bbox.max[0] - m.bbox.min[0];
        const sy = m.bbox.max[1] - m.bbox.min[1];
        const sz = m.bbox.max[2] - m.bbox.min[2];
        const diag = Math.max(sx, sy, sz, 1);
        this.controls.minDistance = diag * 0.4;
        this.controls.maxDistance = diag * 8;
        this.applyPreset('three-quarter');
    }
}
