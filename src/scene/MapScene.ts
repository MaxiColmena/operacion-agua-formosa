import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { AppData, Facility, TerrainMeta } from '../data/load';
import { lonLatToCell } from '../data/load';
import { MASK_DEFENSE, MASK_RIVER } from '../sim/engine';

/** Exageración vertical del terreno: la ciudad tiene ~20 m de desnivel en 16 km. */
export const EXAG = 30;
const BASE = 48;
const BLD_EXAG = 3;

export type WaterMode = 'depth' | 'order';
export type FacilityStatus = 'seco' | 'atencion' | 'afectado';

export interface Layers {
  water: boolean;
  zones: boolean;
  buildings: boolean;
  lines: boolean;
  labels: boolean;
}

const STATUS_COLOR: Record<FacilityStatus, THREE.Color> = {
  seco: new THREE.Color('#38e8ff'),
  atencion: new THREE.Color('#ffc53d'),
  afectado: new THREE.Color('#ff3b5c'),
};

const CAT_HEIGHT: Record<string, number> = {
  hospital: 1.1, salud: 0.7, escuela: 0.55, seguridad: 0.6, servicios: 0.8, refugio: 0.6, transporte: 0.7,
};

export class MapScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private composer: EffectComposer;
  private labelRenderer: CSS2DRenderer;
  private meta: TerrainMeta;
  private widthKm: number;
  private heightKm: number;
  private z: Float32Array;
  private terrainMat!: THREE.ShaderMaterial;
  private terrain!: THREE.Mesh;
  private water!: THREE.Mesh;
  private waterMat!: THREE.ShaderMaterial;
  private waterGrid = { w: 0, h: 0 };
  private zEffSim: Float32Array | null = null;
  private buildings: THREE.Mesh | null = null;
  private beams: THREE.InstancedMesh | null = null;
  private bases: THREE.InstancedMesh | null = null;
  private facilityPos: THREE.Vector3[] = [];
  private facilities: Facility[] = [];
  private rain!: THREE.LineSegments;
  private rainCount = 0;
  private labels: CSS2DObject[] = [];
  private clock = new THREE.Clock();
  private raf = 0;
  private disposed = false;
  private highlight: THREE.Mesh;

  constructor(private container: HTMLElement, data: AppData) {
    this.meta = data.meta;
    this.z = data.z;
    this.widthKm = (data.meta.width * data.meta.cellX) / 1000;
    this.heightKm = (data.meta.height * data.meta.cellY) / 1000;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.setSize(container.clientWidth, container.clientHeight);
    this.labelRenderer.domElement.className = 'label-layer';
    container.appendChild(this.labelRenderer.domElement);

    this.scene.background = new THREE.Color('#030812');
    this.scene.fog = new THREE.FogExp2('#030812', 0.028);

    this.camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.01, 200);
    this.camera.position.set(2.5, 12.5, 12.5);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0.8, 0.2, 0.2);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.minDistance = 0.6;
    this.controls.maxDistance = 30;

    this.scene.add(new THREE.AmbientLight('#7fb6ff', 0.6));
    const sun = new THREE.DirectionalLight('#ffffff', 1.0);
    sun.position.set(-5, 10, 4);
    this.scene.add(sun);

    this.buildTerrain(data);
    this.buildRain();
    if (data.buildings.length) this.buildBuildings(data.buildings);
    if (data.osm) {
      this.buildFacilities(data.osm.facilities);
      this.buildBarrioLabels(data.osm.barrios);
    }

    this.highlight = new THREE.Mesh(
      new THREE.RingGeometry(0.08, 0.11, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
    );
    this.highlight.visible = false;
    this.scene.add(this.highlight);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(container.clientWidth, container.clientHeight), 0.5, 0.4, 0.62));
    this.composer.addPass(new OutputPass());

    window.addEventListener('resize', this.onResize);
    this.animate();
  }

  // ---------- coordenadas ----------
  /** Celda fraccionaria de la grilla completa → mundo (km). */
  cellToWorld(cx: number, cy: number, elev: number) {
    return new THREE.Vector3(
      (cx / this.meta.width - 0.5) * this.widthKm,
      ((elev - BASE) * EXAG) / 1000,
      (cy / this.meta.height - 0.5) * this.heightKm,
    );
  }
  elevAt(cx: number, cy: number) {
    const { width: w, height: h } = this.meta;
    const x = Math.min(w - 1.001, Math.max(0, cx - 0.5)), y = Math.min(h - 1.001, Math.max(0, cy - 0.5));
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const i = y0 * w + x0;
    const a = this.z[i], b = this.z[i + 1], c = this.z[i + w], d = this.z[i + w + 1];
    return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
  }
  lonLatToWorld(lon: number, lat: number, lift = 0) {
    const [cx, cy] = lonLatToCell(this.meta, lon, lat);
    const p = this.cellToWorld(cx, cy, this.elevAt(cx, cy));
    p.y += lift;
    return p;
  }

  // ---------- terreno ----------
  private buildTerrain(data: AppData) {
    const { width: w, height: h } = this.meta;
    const geo = new THREE.PlaneGeometry(this.widthKm, this.heightKm, w - 1, h - 1);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const elev = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      elev[i] = data.z[i];
      pos.setY(i, ((data.z[i] - BASE) * EXAG) / 1000);
    }
    geo.setAttribute('aElev', new THREE.BufferAttribute(elev, 1));
    geo.computeVertexNormals();

    // Textura de zonas (1ª, 2ª, 3ª) a resolución completa.
    const zoneData = new Uint8Array(w * h);
    if (data.zones) for (let i = 0; i < w * h; i++) zoneData[i] = (data.zones[i] & 3) * 60;
    const zoneTex = new THREE.DataTexture(zoneData, w, h, THREE.RedFormat, THREE.UnsignedByteType);
    zoneTex.magFilter = THREE.NearestFilter;
    zoneTex.minFilter = THREE.NearestFilter;
    zoneTex.needsUpdate = true;

    const linesTex = this.buildLinesTexture(data);

    this.terrainMat = new THREE.ShaderMaterial({
      uniforms: {
        uZones: { value: zoneTex },
        uLines: { value: linesTex },
        uShowZones: { value: 0 },
        uShowLines: { value: 1 },
        uTime: { value: 0 },
        fogColor: { value: new THREE.Color('#030812') },
        fogDensity: { value: 0.028 },
      },
      vertexShader: /* glsl */ `
        attribute float aElev;
        varying float vElev; varying vec2 vUv; varying vec3 vN; varying vec3 vW; varying float vFogDepth;
        void main() {
          vElev = aElev; vUv = uv; vN = normal;
          vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz;
          vec4 mv = viewMatrix * wp; vFogDepth = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uZones; uniform sampler2D uLines;
        uniform float uShowZones; uniform float uShowLines; uniform float uTime;
        uniform vec3 fogColor; uniform float fogDensity;
        varying float vElev; varying vec2 vUv; varying vec3 vN; varying vec3 vW; varying float vFogDepth;
        float lineAt(float v, float w) { float f = fract(v); float d = min(f, 1.0 - f) / max(fwidth(v), 1e-4); return 1.0 - clamp(d / w, 0.0, 1.0); }
        void main() {
          vec2 tuv = vec2(vUv.x, 1.0 - vUv.y);
          float t = clamp((vElev - 49.0) / 14.0, 0.0, 1.0);
          vec3 col = mix(vec3(0.02, 0.13, 0.17), vec3(0.06, 0.09, 0.22), smoothstep(0.0, 0.7, t));
          col = mix(col, vec3(0.16, 0.12, 0.30), smoothstep(0.75, 1.0, t));
          float sh = clamp(dot(normalize(vN), normalize(vec3(-0.4, 0.75, -0.5))), 0.0, 1.0);
          col *= 0.45 + 0.85 * sh;
          // Curvas de nivel: cada 1 m finas, cada 5 m marcadas.
          float c1 = lineAt(vElev, 1.0) * 0.18;
          float c5 = lineAt(vElev / 5.0, 1.2) * 0.55;
          col += vec3(0.15, 0.75, 0.95) * max(c1, c5) * 0.6;
          // Grilla de 1 km.
          float g = max(lineAt(vW.x, 1.0), lineAt(vW.z, 1.0));
          col += vec3(0.1, 0.4, 0.6) * g * 0.12;
          // Calles, riachos y defensa.
          vec4 ln = texture2D(uLines, tuv);
          col = mix(col, ln.rgb * 1.6, ln.a * uShowLines);
          // Zonas 1ª / 2ª / 3ª.
          float zone = floor(texture2D(uZones, tuv).r * 255.0 / 60.0 + 0.5);
          if (uShowZones > 0.5 && zone > 0.5) {
            vec3 zc = zone < 1.5 ? vec3(1.0, 0.18, 0.28) : zone < 2.5 ? vec3(1.0, 0.55, 0.12) : vec3(1.0, 0.88, 0.25);
            float pulse = 0.55 + 0.12 * sin(uTime * 2.0 + vW.x * 3.0);
            col = mix(col, zc, pulse * (zone < 1.5 ? 0.85 : 0.7));
          }
          float fog = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
          gl_FragColor = vec4(mix(col, fogColor, fog), 1.0);
        }`,
      extensions: { derivatives: true } as unknown as THREE.ShaderMaterial['extensions'],
    });
    this.terrain = new THREE.Mesh(geo, this.terrainMat);
    this.scene.add(this.terrain);

    // Base del "tablero" holográfico.
    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(this.widthKm, 0.02, this.heightKm)),
      new THREE.LineBasicMaterial({ color: '#2ad4ff', transparent: true, opacity: 0.5 }),
    );
    edge.position.y = -0.01;
    this.scene.add(edge);
  }

  private buildLinesTexture(data: AppData) {
    const W = 4096, H = Math.round((4096 * this.meta.height) / this.meta.width);
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d')!;
    const toPx = (lon: number, lat: number): [number, number] => {
      const [cx, cy] = lonLatToCell(this.meta, lon, lat);
      return [(cx / this.meta.width) * W, (cy / this.meta.height) * H];
    };
    const stroke = (c: number[][]) => {
      g.beginPath();
      c.forEach(([lon, lat], i) => { const [x, y] = toPx(lon, lat); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
      g.stroke();
    };
    g.lineCap = 'round'; g.lineJoin = 'round';
    const osm = data.osm;
    if (osm) {
      for (const k of [3, 2, 1]) {
        for (const r of osm.roads) {
          if (r.k !== k) continue;
          g.strokeStyle = k === 1 ? 'rgba(120,240,255,0.95)' : k === 2 ? 'rgba(80,200,255,0.75)' : r.paved ? 'rgba(60,160,230,0.45)' : 'rgba(170,140,90,0.45)';
          g.lineWidth = k === 1 ? 4 : k === 2 ? 2.6 : 1.4;
          stroke(r.c);
        }
      }
      for (const l of osm.waterLines) {
        if (l.kind === 'defensa') { g.strokeStyle = 'rgba(255,90,220,0.95)'; g.lineWidth = 5; }
        else { g.strokeStyle = 'rgba(40,140,255,0.8)'; g.lineWidth = l.kind === 'river' ? 4 : 2; }
        stroke(l.c);
      }
    }
    // Contorno del río Paraguay (máscara).
    const { width: w, height: h } = this.meta;
    g.fillStyle = 'rgba(10,60,160,0.55)';
    const sx = W / w, sy = H / h;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data.mask[y * w + x] & MASK_RIVER) g.fillRect(x * sx, y * sy, sx + 0.5, sy + 0.5);
    g.fillStyle = 'rgba(255,90,220,0.9)';
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data.mask[y * w + x] & MASK_DEFENSE) g.fillRect(x * sx, y * sy, sx + 0.5, sy + 0.5);
    const tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    tex.flipY = false;
    tex.colorSpace = THREE.NoColorSpace;
    return tex;
  }

  // ---------- agua ----------
  initWater(width: number, height: number, zEff: Float32Array) {
    this.waterGrid = { w: width, h: height };
    this.zEffSim = zEff;
    const f = this.meta.width / width;
    const geo = new THREE.PlaneGeometry(this.widthKm * (1 - 1 / width), this.heightKm * (1 - 1 / height), width - 1, height - 1);
    geo.rotateX(-Math.PI / 2);
    void f;
    const n = width * height;
    geo.setAttribute('aDepth', new THREE.BufferAttribute(new Float32Array(n), 1));
    geo.setAttribute('aTWet', new THREE.BufferAttribute(new Float32Array(n).fill(-1), 1));
    geo.setAttribute('aRiver', new THREE.BufferAttribute(new Float32Array(n), 1));
    this.waterMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uSimTime: { value: 0 }, uMode: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute float aDepth; attribute float aTWet; attribute float aRiver;
        varying float vDepth; varying float vTWet; varying float vRiver; varying vec3 vW;
        void main() {
          vDepth = aDepth; vTWet = aTWet; vRiver = aRiver;
          vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform float uSimTime; uniform float uMode;
        varying float vDepth; varying float vTWet; varying float vRiver; varying vec3 vW;
        void main() {
          if (vDepth < 0.03 && vRiver < 0.5) discard;
          float d = clamp(vDepth / 1.5, 0.0, 1.0);
          vec3 shallow = vec3(0.12, 0.62, 0.85), deep = vec3(0.02, 0.16, 0.6);
          vec3 col = mix(shallow, deep, sqrt(d));
          if (vRiver > 0.5) col = vec3(0.03, 0.2, 0.65);
          else if (uMode > 0.5 && vTWet >= 0.0) {
            float f = clamp(vTWet / max(uSimTime, 1.0), 0.0, 1.0);
            col = f < 0.3334 ? vec3(1.0, 0.2, 0.3) : f < 0.6667 ? vec3(1.0, 0.55, 0.15) : vec3(1.0, 0.88, 0.3);
            if (vTWet == 0.0) col = vec3(0.35, 0.45, 1.0);
          }
          // Frente de avance: celdas mojadas hace poco brillan.
          float age = uSimTime - vTWet;
          if (vRiver < 0.5 && vTWet > 0.0 && age < 900.0) col += vec3(0.35, 0.7, 0.9) * (1.0 - age / 900.0) * 0.35;
          float ripple = 0.035 * sin(vW.x * 40.0 + uTime * 1.7) * sin(vW.z * 37.0 - uTime * 1.3);
          col += ripple;
          float a = vRiver > 0.5 ? 0.8 : smoothstep(0.03, 0.3, vDepth) * 0.88;
          gl_FragColor = vec4(col, a);
        }`,
    });
    this.water = new THREE.Mesh(geo, this.waterMat);
    this.water.renderOrder = 2;
    this.scene.add(this.water);
  }

  setTerrainEff(zEff: Float32Array) {
    this.zEffSim = zEff;
  }

  setWaterFrame(d: Float32Array, tWet: Float32Array, byRiver: Uint8Array, mask: Uint8Array, simTime: number) {
    if (!this.water || !this.zEffSim) return;
    const geo = this.water.geometry;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const aD = geo.attributes.aDepth as THREE.BufferAttribute;
    const aT = geo.attributes.aTWet as THREE.BufferAttribute;
    const aR = geo.attributes.aRiver as THREE.BufferAttribute;
    const z = this.zEffSim;
    for (let i = 0; i < d.length; i++) {
      const river = mask[i] & MASK_RIVER;
      const dep = d[i];
      const y = dep > 0.01 || river ? ((z[i] + dep - BASE) * EXAG) / 1000 + 0.004 : ((z[i] - BASE) * EXAG) / 1000 - 0.02;
      pos.setY(i, y);
      (aD.array as Float32Array)[i] = dep;
      (aT.array as Float32Array)[i] = byRiver[i] && !river ? 0 : tWet[i];
      (aR.array as Float32Array)[i] = river ? 1 : 0;
    }
    pos.needsUpdate = true; aD.needsUpdate = true; aT.needsUpdate = true; aR.needsUpdate = true;
    this.waterMat.uniforms.uSimTime.value = simTime;
  }

  setWaterMode(mode: WaterMode) {
    if (this.waterMat) this.waterMat.uniforms.uMode.value = mode === 'order' ? 1 : 0;
  }

  // ---------- edificios ----------
  private buildBuildings(list: { h: number; c: number[][] }[]) {
    const positions: number[] = [];
    const rel: number[] = [];
    for (const b of list) {
      const ring = b.c.slice(0, b.c.length > 1 && b.c[0][0] === b.c[b.c.length - 1][0] && b.c[0][1] === b.c[b.c.length - 1][1] ? -1 : undefined);
      if (ring.length < 3) continue;
      const pts = ring.map(([lon, lat]) => lonLatToCell(this.meta, lon, lat));
      let cx = 0, cy = 0;
      for (const p of pts) { cx += p[0]; cy += p[1]; }
      cx /= pts.length; cy /= pts.length;
      const base = this.cellToWorld(cx, cy, this.elevAt(cx, cy)).y;
      const hm = b.h > 0 ? b.h : 3.5 + (Math.abs(Math.sin(cx * 12.9898 + cy * 78.233)) * 43758.5453 % 1) * 4;
      const top = base + (hm * BLD_EXAG) / 1000;
      const v2 = pts.map(([x, y]) => new THREE.Vector2((x / this.meta.width - 0.5) * this.widthKm, (y / this.meta.height - 0.5) * this.heightKm));
      // Paredes
      for (let k = 0; k < v2.length; k++) {
        const a = v2[k], c = v2[(k + 1) % v2.length];
        positions.push(a.x, base, a.y, c.x, base, c.y, c.x, top, c.y, a.x, base, a.y, c.x, top, c.y, a.x, top, a.y);
        rel.push(0, 0, 1, 0, 1, 1);
      }
      // Techo
      const tris = THREE.ShapeUtils.triangulateShape(v2, []);
      for (const t of tris) for (const idx of t) { positions.push(v2[idx].x, top, v2[idx].y); rel.push(1.2); }
    }
    if (!positions.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('aRel', new THREE.Float32BufferAttribute(rel, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.DoubleSide,
      uniforms: {},
      vertexShader: `attribute float aRel; varying float vRel; void main(){ vRel = aRel; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying float vRel; void main(){
        vec3 c = mix(vec3(0.05,0.12,0.25), vec3(0.2,0.75,1.0), smoothstep(0.75, 1.0, vRel));
        if (vRel > 1.1) c = vec3(0.12,0.35,0.55);
        gl_FragColor = vec4(c, vRel > 1.1 ? 0.85 : 0.75); }`,
    });
    this.buildings = new THREE.Mesh(geo, mat);
    this.buildings.renderOrder = 1;
    this.scene.add(this.buildings);
  }

  // ---------- infraestructura ----------
  private buildFacilities(list: Facility[]) {
    this.facilities = list;
    const n = list.length;
    if (!n) return;
    const beamGeo = new THREE.CylinderGeometry(0.012, 0.03, 1, 10, 1, true).translate(0, 0.5, 0);
    const beamMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false });
    this.beams = new THREE.InstancedMesh(beamGeo, beamMat, n);
    const baseGeo = new THREE.RingGeometry(0.025, 0.05, 24).rotateX(-Math.PI / 2);
    const baseMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });
    this.bases = new THREE.InstancedMesh(baseGeo, baseMat, n);
    const m = new THREE.Matrix4();
    list.forEach((f, i) => {
      const p = this.lonLatToWorld(f.lon, f.lat, 0.003);
      this.facilityPos.push(p);
      m.compose(p, new THREE.Quaternion(), new THREE.Vector3(1, CAT_HEIGHT[f.cat] ?? 0.5, 1));
      this.beams!.setMatrixAt(i, m);
      m.compose(p, new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
      this.bases!.setMatrixAt(i, m);
      this.beams!.setColorAt(i, STATUS_COLOR.seco);
      this.bases!.setColorAt(i, STATUS_COLOR.seco);
    });
    this.scene.add(this.beams, this.bases);
  }

  setFacilityStatus(status: FacilityStatus[]) {
    if (!this.beams || !this.bases) return;
    status.forEach((s, i) => {
      this.beams!.setColorAt(i, STATUS_COLOR[s]);
      this.bases!.setColorAt(i, STATUS_COLOR[s]);
    });
    this.beams.instanceColor!.needsUpdate = true;
    this.bases.instanceColor!.needsUpdate = true;
  }

  /** Busca la instalación más cercana al punto de pantalla (px), dentro de 14 px. */
  pickFacility(clientX: number, clientY: number): number {
    const rect = this.renderer.domElement.getBoundingClientRect();
    let best = -1, bestD = 14 * 14;
    const v = new THREE.Vector3();
    this.facilityPos.forEach((p, i) => {
      for (const lift of [0, (CAT_HEIGHT[this.facilities[i].cat] ?? 0.5) * 0.5]) {
        v.copy(p); v.y += lift; v.project(this.camera);
        if (v.z > 1) continue;
        const x = ((v.x + 1) / 2) * rect.width + rect.left, y = ((1 - v.y) / 2) * rect.height + rect.top;
        const d = (x - clientX) ** 2 + (y - clientY) ** 2;
        if (d < bestD) { bestD = d; best = i; }
      }
    });
    return best;
  }

  focusFacility(i: number | null) {
    if (i == null || i < 0 || !this.facilityPos[i]) { this.highlight.visible = false; return; }
    const p = this.facilityPos[i];
    this.highlight.position.copy(p);
    this.highlight.visible = true;
    const offset = this.camera.position.clone().sub(this.controls.target);
    const dist = Math.min(offset.length(), 4);
    offset.setLength(dist);
    this.flyTo(p, p.clone().add(offset));
  }

  focusLonLat(lon: number, lat: number) {
    this.highlight.visible = false;
    const p = this.lonLatToWorld(lon, lat);
    this.flyTo(p, p.clone().add(new THREE.Vector3(0.6, 2.2, 2.6)));
  }

  private fly: { from: THREE.Vector3; to: THREE.Vector3; tFrom: THREE.Vector3; tTo: THREE.Vector3; t: number } | null = null;
  flyTo(target: THREE.Vector3, camPos: THREE.Vector3) {
    this.fly = { from: this.camera.position.clone(), to: camPos, tFrom: this.controls.target.clone(), tTo: target.clone(), t: 0 };
  }

  // ---------- barrios ----------
  private buildBarrioLabels(barrios: { name: string; lon: number; lat: number }[]) {
    for (const b of barrios) {
      const el = document.createElement('div');
      el.className = 'barrio-label';
      el.textContent = b.name;
      const obj = new CSS2DObject(el);
      obj.position.copy(this.lonLatToWorld(b.lon, b.lat, 0.06));
      this.labels.push(obj);
      this.scene.add(obj);
    }
  }
  setBarrioLabelState(state: ('seco' | 'atencion' | 'afectado')[]) {
    this.labels.forEach((l, i) => { l.element.dataset.state = state[i] ?? 'seco'; });
  }

  // ---------- lluvia ----------
  private buildRain() {
    const MAX = 9000;
    const pos = new Float32Array(MAX * 6);
    const speed = new Float32Array(MAX);
    for (let i = 0; i < MAX; i++) {
      const x = (Math.random() - 0.5) * this.widthKm, z = (Math.random() - 0.5) * this.heightKm, y = Math.random() * 4;
      pos.set([x, y, z, x, y - 0.06, z], i * 6);
      speed[i] = 3 + Math.random() * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.userData.speed = speed;
    geo.setDrawRange(0, 0);
    this.rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#9fe7ff', transparent: true, opacity: 0.45 }));
    this.scene.add(this.rain);
  }
  setRain(mmPerHour: number, raining: boolean) {
    this.rainCount = raining ? Math.round(Math.min(9000, mmPerHour * 70)) : 0;
    this.rain.geometry.setDrawRange(0, this.rainCount * 2);
  }
  private updateRain(dt: number) {
    if (!this.rainCount) return;
    const geo = this.rain.geometry;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const speed = geo.userData.speed as Float32Array;
    for (let i = 0; i < this.rainCount; i++) {
      const k = i * 6;
      let y = arr[k + 1] - speed[i] * dt;
      if (y < 0) y += 4;
      arr[k + 1] = y; arr[k + 4] = y - 0.07;
    }
    pos.needsUpdate = true;
  }

  // ---------- capas ----------
  setLayers(l: Layers) {
    if (this.water) this.water.visible = l.water;
    this.terrainMat.uniforms.uShowZones.value = l.zones ? 1 : 0;
    this.terrainMat.uniforms.uShowLines.value = l.lines ? 1 : 0;
    if (this.buildings) this.buildings.visible = l.buildings;
    this.labels.forEach((o) => (o.visible = l.labels));
  }

  // ---------- ciclo ----------
  private onResize = () => {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
  };

  private animate = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.animate);
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const t = this.clock.elapsedTime;
    this.terrainMat.uniforms.uTime.value = t;
    if (this.waterMat) this.waterMat.uniforms.uTime.value = t;
    if (this.fly) {
      this.fly.t = Math.min(1, this.fly.t + dt * 1.2);
      const e = 1 - Math.pow(1 - this.fly.t, 3);
      this.camera.position.lerpVectors(this.fly.from, this.fly.to, e);
      this.controls.target.lerpVectors(this.fly.tFrom, this.fly.tTo, e);
      if (this.fly.t >= 1) this.fly = null;
    }
    if (this.highlight.visible) {
      const s = 1 + 0.25 * Math.sin(t * 4);
      this.highlight.scale.set(s, 1, s);
    }
    this.updateRain(dt);
    this.controls.update();
    this.composer.render();
    this.labelRenderer.render(this.scene, this.camera);
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelRenderer.domElement.remove();
  }
}
