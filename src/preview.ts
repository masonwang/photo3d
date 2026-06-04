/**
 * Three.js preview pane: scene, OrbitControls, view presets, lit/backlit modes.
 *
 * Renders on demand: only redraws when something changes (orbit, parameter,
 * preset). Two materials kept around: opaque "lit" for inspecting geometry,
 * and a ShaderMaterial for "backlit" lithophane simulation that reads each
 * vertex's Z coordinate directly and maps it to brightness.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { Mesh as MyMesh } from './mesh-generator';

export type RenderMode = 'lit' | 'backlit' | 'wireframe';
export type ViewPreset = 'front' | 'back' | 'top' | 'three-quarter';

const BACKLIT_VERT = /* glsl */`
  varying float vZ;
  void main() {
    vZ = position.z;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const BACKLIT_FRAG = /* glsl */`
  varying float vZ;
  uniform float uZMin;
  uniform float uZMax;
  uniform float uContrast;   // gamma on the brightness curve
  uniform float uBrightness; // overall multiplier

  // thin areas → warm backlight; thick areas → near-black
  const vec3 LIGHT = vec3(1.00, 0.97, 0.88);
  const vec3 DARK  = vec3(0.03, 0.02, 0.01);

  void main() {
    float t  = clamp((vZ - uZMin) / max(uZMax - uZMin, 0.001), 0.0, 1.0);
    float br = clamp(pow(1.0 - t, uContrast) * uBrightness, 0.0, 1.0);
    gl_FragColor = vec4(mix(DARK, LIGHT, br), 1.0);
  }
`;

export class Preview {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private litMaterial: THREE.MeshStandardMaterial;
  private backlitUniforms = {
    uZMin:       { value: 0.5 },
    uZMax:       { value: 2.0 },
    uContrast:   { value: 2.2 },
    uBrightness: { value: 1.0 },
  };
  private backlitMaterial: THREE.ShaderMaterial;
  private wireMaterial: THREE.MeshBasicMaterial;
  private labelRenderer: CSS2DRenderer;
  private group = new THREE.Group();
  private scaleBarGroup = new THREE.Group();
  private scaleLineMat: THREE.LineBasicMaterial | null = null;
  private mesh: THREE.Mesh | null = null;
  private geometry: THREE.BufferGeometry | null = null;
  private litLights: THREE.Light[] = [];
  private backlitLights: THREE.Light[] = [];
  private mode: RenderMode = 'lit';
  private renderRequested = false;
  private resizeObserver: ResizeObserver;
  private frontGridW = 0;
  private frontGridH = 0;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.add(this.group);
    this.group.add(this.scaleBarGroup);

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.domElement.style.cssText =
      'position:absolute;top:0;left:0;pointer-events:none;z-index:1;';
    container.appendChild(this.labelRenderer.domElement);

    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 5000);
    this.camera.position.set(150, 120, 200);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.49; // can't fly under the bed
    this.controls.minDistance = 30;
    this.controls.maxDistance = 1500;
    this.controls.addEventListener('change', () => this.requestRender());
    this.controls.addEventListener('start', () => this.requestRender());

    // --- Lit setup: front+top key, soft fill, ambient ---
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(120, 200, 200);
    const fill = new THREE.DirectionalLight(0xffffff, 0.4);
    fill.position.set(-150, 60, 100);
    const amb = new THREE.AmbientLight(0xffffff, 0.35);
    this.litLights = [key, fill, amb];

    // --- Backlit setup: faint ambient only; shader handles all brightness ---
    const ambBack = new THREE.AmbientLight(0xffeedd, 0.02);
    this.backlitLights = [ambBack];

    // --- Materials ---
    this.litMaterial = new THREE.MeshStandardMaterial({
      color: 0xf7f3e8,
      roughness: 0.7,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });

    this.backlitMaterial = new THREE.ShaderMaterial({
      uniforms: this.backlitUniforms,
      vertexShader: BACKLIT_VERT,
      fragmentShader: BACKLIT_FRAG,
      side: THREE.DoubleSide,
    });

    this.wireMaterial = new THREE.MeshBasicMaterial({
      color: 0x444444,
      wireframe: true,
    });

    this.applyMode('lit');

    // --- Resize ---
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);
    this.handleResize();

    // Render loop: only when requested
    const tick = () => {
      requestAnimationFrame(tick);
      this.controls.update();
      if (this.renderRequested) {
        this.renderer.render(this.scene, this.camera);
        this.labelRenderer.render(this.scene, this.camera);
        this.renderRequested = false;
      }
    };
    tick();
  }

  private handleResize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.labelRenderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  requestRender() {
    this.renderRequested = true;
  }

  /** Replace the mesh entirely (cold path). */
  setMesh(m: MyMesh): void {
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.geometry?.dispose();
    }

    this.frontGridW = m.gridWidth;
    this.frontGridH = m.gridHeight;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
    geo.setIndex(new THREE.BufferAttribute(m.indices, 1));
    geo.computeVertexNormals();
    this.geometry = geo;

    this._updateZUniforms(m.positions);

    const mat = this.currentMaterial();
    const threeMesh = new THREE.Mesh(geo, mat);
    // Recenter at origin so OrbitControls orbits around the print center.
    const cx = (m.bbox.min[0] + m.bbox.max[0]) / 2;
    const cy = (m.bbox.min[1] + m.bbox.max[1]) / 2;
    const cz = (m.bbox.min[2] + m.bbox.max[2]) / 2;
    threeMesh.position.set(-cx, -cy, -cz);
    this.group.add(threeMesh);
    this.mesh = threeMesh;
    this.updateScaleBar(m);
    this.fitCamera(m);
    this.requestRender();
  }

  /** Hot path: front-grid Z values were rewritten in place. */
  notifyZUpdated(): void {
    if (!this.geometry) return;
    const posAttr = this.geometry.attributes.position as THREE.BufferAttribute;
    posAttr.needsUpdate = true;
    this.geometry.computeVertexNormals();
    this._updateZUniforms(posAttr.array as Float32Array);
    this.requestRender();
  }

  /** Free path: width/scale change. `scale` is multiplier vs. mesh's current size. */
  setScale(scale: number): void {
    this.group.scale.setScalar(scale);
    this.requestRender();
  }

  setMode(mode: RenderMode): void {
    this.mode = mode;
    this.applyMode(mode);
    if (this.mesh) {
      this.mesh.material = this.currentMaterial();
    }
    if (this.scaleLineMat) {
      this.scaleLineMat.color.set(mode === 'backlit' ? 0xffffff : 0x333333);
    }
    this.requestRender();
  }

  setBacklitContrast(v: number): void {
    this.backlitUniforms.uContrast.value = v;
    this.requestRender();
  }

  setBacklitBrightness(v: number): void {
    this.backlitUniforms.uBrightness.value = v;
    this.requestRender();
  }

  private _updateZUniforms(positions: Float32Array): void {
    const W = this.frontGridW;
    const H = this.frontGridH;
    if (W < 2 || H < 2) return;
    let zMin = Infinity, zMax = -Infinity;
    for (let k = 0; k < W * H; k++) {
      const z = positions[k * 3 + 2];
      if (z < zMin) zMin = z;
      if (z > zMax) zMax = z;
    }
    this.backlitUniforms.uZMin.value = zMin;
    this.backlitUniforms.uZMax.value = zMax;
  }

  private applyMode(mode: RenderMode): void {
    // Clear all current lights
    [...this.litLights, ...this.backlitLights].forEach(l => this.scene.remove(l));

    if (mode === 'lit' || mode === 'wireframe') {
      this.litLights.forEach(l => this.scene.add(l));
      this.scene.background = new THREE.Color(0xefeee9);
    } else if (mode === 'backlit') {
      this.backlitLights.forEach(l => this.scene.add(l));
      this.scene.background = new THREE.Color(0x0c0a08); // dark room
    }
  }

  private currentMaterial(): THREE.Material {
    switch (this.mode) {
      case 'lit': return this.litMaterial;
      case 'backlit': return this.backlitMaterial;
      case 'wireframe': return this.wireMaterial;
    }
  }

  applyPreset(p: ViewPreset): void {
    if (!this.mesh) return;
    const box = new THREE.Box3().setFromObject(this.group);
    const size = box.getSize(new THREE.Vector3());
    const diag = Math.max(size.x, size.y, size.z, 1);
    const dist = diag * 2.2;
    let target = new THREE.Vector3(0, 0, 0);

    switch (p) {
      case 'front': this.camera.position.set(0, 0, dist); break;
      case 'back':  this.camera.position.set(0, 0, -dist); break;
      case 'top':   this.camera.position.set(0, dist, 0.001); break;
      case 'three-quarter':
        this.camera.position.set(dist * 0.6, dist * 0.5, dist * 0.7);
        break;
    }
    this.camera.lookAt(target);
    this.controls.target.copy(target);
    this.controls.update();
    this.requestRender();
  }

  resetView(): void { this.applyPreset('three-quarter'); }

  private updateScaleBar(m: MyMesh): void {
    // Remove old children and detach any CSS2D label divs from the DOM.
    for (let i = this.scaleBarGroup.children.length - 1; i >= 0; i--) {
      const child = this.scaleBarGroup.children[i];
      if (child instanceof CSS2DObject) child.element.remove();
      this.scaleBarGroup.remove(child);
    }

    const sx = m.bbox.max[0] - m.bbox.min[0];
    const sy = m.bbox.max[1] - m.bbox.min[1];
    const sz = m.bbox.max[2] - m.bbox.min[2];

    // Pick the nearest "nice" length to ~30 % of model width.
    const candidates = [1, 2, 5, 10, 20, 25, 50, 100, 150, 200];
    const target = sx * 0.30;
    const barLen = candidates.reduce((p, c) =>
      Math.abs(c - target) < Math.abs(p - target) ? c : p);

    const tickH = Math.max(1, sy * 0.04);
    const yPos  = -sy / 2 - tickH * 2.5; // just below the model
    const zPos  =  sz / 2;                // at the front face

    // Line segments: horizontal bar + left tick + right tick.
    const pts = [
      new THREE.Vector3(-barLen / 2, 0, 0), new THREE.Vector3(barLen / 2, 0, 0),
      new THREE.Vector3(-barLen / 2, -tickH / 2, 0), new THREE.Vector3(-barLen / 2, tickH / 2, 0),
      new THREE.Vector3( barLen / 2, -tickH / 2, 0), new THREE.Vector3( barLen / 2, tickH / 2, 0),
    ];
    this.scaleLineMat = new THREE.LineBasicMaterial({
      color: this.mode === 'backlit' ? 0xffffff : 0x333333,
    });
    const bar = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(pts),
      this.scaleLineMat,
    );
    bar.position.set(0, yPos, zPos);
    this.scaleBarGroup.add(bar);

    // CSS2D label centred under the bar.
    const div = document.createElement('div');
    div.className = 'scale-label';
    div.textContent = `${barLen} mm`;
    const label = new CSS2DObject(div);
    label.position.set(0, yPos - tickH * 1.5, zPos);
    this.scaleBarGroup.add(label);
  }

  private fitCamera(m: MyMesh): void {
    const sx = m.bbox.max[0] - m.bbox.min[0];
    const sy = m.bbox.max[1] - m.bbox.min[1];
    const sz = m.bbox.max[2] - m.bbox.min[2];
    const diag = Math.max(sx, sy, sz, 1);
    this.controls.minDistance = diag * 0.4;
    this.controls.maxDistance = diag * 8;
    this.applyPreset('three-quarter');
  }
}
