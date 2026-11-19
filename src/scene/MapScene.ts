import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { AppData, Buildings, Facility, TerrainMeta } from '../data/load';
import { lonLatToCell } from '../data/load';
import { MASK_DEFENSE, MASK_RIVER } from '../sim/engine';
import { STREET } from '../sim/scenarios';

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
  facilities: boolean;
}

const STATUS_COLOR: Record<FacilityStatus, THREE.Color> = {
  seco: new THREE.Color('#38e8ff'),
  atencion: new THREE.Color('#ffc53d'),
  afectado: new THREE.Color('#ff3b5c'),
};

const CAT_HEIGHT: Record<string, number> = {
  hospital: 1.1, salud: 0.7, escuela: 0.55, seguridad: 0.6, servicios: 0.8, refugio: 0.6, transporte: 0.7,
};

/** Profundidad del agua en la calzada: en zona urbana el agua de la celda se concentra en la calle. */
export function streetDepth(d: number, urban: number) {
  return urban ? d / STREET.share : d;
}

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
    if (data.buildings) this.buildBuildings(data.buildings);
    if (data.osm) {
      this.buildFacilities(data.osm.facilities);
      this.buildBarrioLabels(data.osm.barrios);
      this.buildStreetLabels(data.osm.roads);
      this.buildFacilityLabels(data.osm.facilities);
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

    const { lines: linesTex, roads: roadsTex } = this.buildLinesTexture(data);
    this.streetTex = new THREE.DataTexture(new Float32Array(2), 1, 1, THREE.RGFormat, THREE.FloatType);

    this.terrainMat = new THREE.ShaderMaterial({
      uniforms: {
        uZones: { value: zoneTex },
        uLines: { value: linesTex },
        uRoads: { value: roadsTex },
        uWater: { value: this.streetTex },
        uWaterSize: { value: new THREE.Vector2(1, 1) },
        uStreet: { value: new THREE.Vector3(STREET.wet, STREET.curb, STREET.impassable) },
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
        uniform sampler2D uZones; uniform sampler2D uLines; uniform sampler2D uRoads; uniform sampler2D uWater;
        uniform vec2 uWaterSize; uniform vec3 uStreet;
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
          // Calles: color base (asfalto celeste / tierra ocre) y agua en la calzada.
          vec4 rd = texture2D(uRoads, tuv);
          if (rd.a > 0.01 && uShowLines > 0.5) {
            vec3 road = mix(vec3(0.42, 0.3, 0.16), vec3(0.26, 0.29, 0.34), rd.g);
            col = mix(col, road, rd.a * 0.8);
            // Profundidad en la calle (canal G): bilineal manual sobre la grilla de simulación.
            vec2 p = tuv * uWaterSize - 0.5;
            vec2 f = fract(p); vec2 i0 = (floor(p) + 0.5) / uWaterSize; vec2 dt = 1.0 / uWaterSize;
            float s = mix(mix(texture2D(uWater, i0).g, texture2D(uWater, i0 + vec2(dt.x, 0.0)).g, f.x),
                          mix(texture2D(uWater, i0 + vec2(0.0, dt.y)).g, texture2D(uWater, i0 + dt).g, f.x), f.y);
            if (s > uStreet.x) {
              vec3 wc = s < uStreet.y ? mix(vec3(0.0, 0.8, 1.0), vec3(0.0, 0.45, 1.0), (s - uStreet.x) / (uStreet.y - uStreet.x))
                      : s < uStreet.z ? mix(vec3(0.05, 0.2, 1.0), vec3(0.4, 0.1, 0.95), (s - uStreet.y) / (uStreet.z - uStreet.y))
                      : vec3(1.0, 0.2, 0.32) * (0.8 + 0.25 * sin(uTime * 5.0));
              col = mix(col, wc * 0.95, min(1.0, rd.a * 1.6) * smoothstep(uStreet.x, uStreet.x + 0.03, s));
            }
          }
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
    const rcv = document.createElement('canvas');
    rcv.width = W; rcv.height = H;
    const rg = rcv.getContext('2d')!;
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
      // Calles en su propia textura: R = 1, G = asfaltada (1) o de tierra (0), A = jerarquía.
      rg.lineCap = 'round'; rg.lineJoin = 'round';
      for (const k of [3, 2, 1]) {
        for (const r of osm.roads) {
          if (r.k !== k) continue;
          const a = k === 1 ? 1 : k === 2 ? 0.9 : 0.7;
          rg.strokeStyle = r.paved ? `rgba(255,255,0,${a})` : `rgba(255,0,0,${a})`;
          rg.lineWidth = k === 1 ? 4.5 : k === 2 ? 3 : 1.8;
          rg.beginPath();
          r.c.forEach(([lon, lat], i) => { const [x, y] = toPx(lon, lat); if (i) rg.lineTo(x, y); else rg.moveTo(x, y); });
          rg.stroke();
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
    const mk = (c: HTMLCanvasElement) => {
      const tex = new THREE.CanvasTexture(c);
      tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      tex.flipY = false;
      tex.colorSpace = THREE.NoColorSpace;
      return tex;
    };
    return { lines: mk(cv), roads: mk(rcv) };
  }

  // ---------- agua ----------
  initWater(width: number, height: number, zEff: Float32Array) {
    this.waterGrid = { w: width, h: height };
    this.zEffSim = zEff;
    const f = this.meta.width / width;
    const geo = new THREE.PlaneGeometry(this.widthKm * (1 - 1 / width), this.heightKm * (1 - 1 / height), width - 1, height - 1);
    geo.rotateX(-Math.PI / 2);
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
    if (this.waterTex && this.bldMat) {
      this.waterTex.dispose();
      this.waterTex = new THREE.DataTexture(new Float32Array(n), width, height, THREE.RedFormat, THREE.FloatType);
      this.waterTex.magFilter = THREE.NearestFilter;
      this.waterTex.minFilter = THREE.NearestFilter;
      this.waterTex.needsUpdate = true;
      this.bldMat.uniforms.uWater.value = this.waterTex;
      this.bldMat.uniforms.uThr.value = 0.15;
    }
    this.urbanCell = new Uint8Array(n);
    if (this.bldCentroid) {
      const nb = this.bldCentroid.length / 2;
      this.buildingSimCell = new Int32Array(nb);
      const count = new Uint16Array(n);
      for (let i = 0; i < nb; i++) {
        const sx = Math.min(width - 1, Math.floor(this.bldCentroid[i * 2] / f));
        const sy = Math.min(height - 1, Math.floor(this.bldCentroid[i * 2 + 1] / f));
        this.buildingSimCell[i] = sy * width + sx;
        count[sy * width + sx]++;
      }
      for (let i = 0; i < n; i++) this.urbanCell[i] = count[i] >= STREET.minBuildings ? 1 : 0;
    }
    this.streetTex?.dispose();
    this.streetTex = new THREE.DataTexture(new Float32Array(n * 2), width, height, THREE.RGFormat, THREE.FloatType);
    this.streetTex.magFilter = THREE.NearestFilter;
    this.streetTex.minFilter = THREE.NearestFilter;
    this.streetTex.needsUpdate = true;
    this.terrainMat.uniforms.uWater.value = this.streetTex;
    this.terrainMat.uniforms.uWaterSize.value.set(width, height);
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
    if (this.streetTex && this.urbanCell && (this.streetTex.image.data as Float32Array).length === d.length * 2) {
      const sd = this.streetTex.image.data as Float32Array;
      const u = this.urbanCell;
      for (let i = 0; i < d.length; i++) {
        sd[i * 2] = d[i];
        sd[i * 2 + 1] = mask[i] & MASK_RIVER ? 0 : streetDepth(d[i], u[i]);
      }
      this.streetTex.needsUpdate = true;
    }
    if (this.waterTex && this.waterTex.image.data && (this.waterTex.image.data as Float32Array).length === d.length) {
      (this.waterTex.image.data as Float32Array).set(d);
      this.waterTex.needsUpdate = true;
    }
    this.waterMat.uniforms.uSimTime.value = simTime;
  }

  setWaterMode(mode: WaterMode) {
    if (this.waterMat) this.waterMat.uniforms.uMode.value = mode === 'order' ? 1 : 0;
  }

  /** 1 = celda de simulación urbana (≥ STREET.minBuildings edificios). Se llena en initWater. */
  urbanCell: Uint8Array | null = null;
  private streetTex: THREE.DataTexture | null = null;

  // ---------- edificios ----------
  private waterTex: THREE.DataTexture | null = null;
  private bldMat: THREE.ShaderMaterial | null = null;
  /** Celda de la grilla de simulación en la que cae cada edificio (se llena en initWater). */
  buildingSimCell: Int32Array | null = null;
  private bldCentroid: Float32Array | null = null;

  private buildBuildings(b: Buildings) {
    const pos: number[] = [];
    const rel: number[] = [];
    const uvs: number[] = [];
    const idx: number[] = [];
    const cent = new Float32Array(b.count * 2);
    const v2: THREE.Vector2[] = [];
    for (let i = 0; i < b.count; i++) {
      const n = b.size[i], s0 = b.start[i];
      v2.length = 0;
      let cx = 0, cy = 0;
      for (let j = 0; j < n; j++) {
        const x = b.xy[(s0 + j) * 2], y = b.xy[(s0 + j) * 2 + 1];
        cx += x; cy += y;
        v2.push(new THREE.Vector2((x / this.meta.width - 0.5) * this.widthKm, (y / this.meta.height - 0.5) * this.heightKm));
      }
      cx /= n; cy /= n;
      cent[i * 2] = cx; cent[i * 2 + 1] = cy;
      const base = this.cellToWorld(cx, cy, this.elevAt(cx, cy)).y;
      const hm = b.height[i] > 0 ? b.height[i] : 3 + (Math.abs(Math.sin(cx * 12.9898 + cy * 78.233) * 43758.5453) % 1) * 3.5;
      const top = base + (hm * BLD_EXAG) / 1000;
      const u = cx / this.meta.width, v = cy / this.meta.height;
      const o = pos.length / 3;
      for (const p of v2) { pos.push(p.x, base, p.y); rel.push(0); uvs.push(u, v); }
      for (const p of v2) { pos.push(p.x, top, p.y); rel.push(1); uvs.push(u, v); }
      for (let j = 0; j < n; j++) {
        const a = o + j, c = o + ((j + 1) % n);
        idx.push(a, c, c + n, a, c + n, a + n);
      }
      const tris = n === 4 ? [[0, 1, 2], [0, 2, 3]] : THREE.ShapeUtils.triangulateShape(v2, []);
      for (const t of tris) idx.push(o + n + t[0], o + n + t[1], o + n + t[2]);
    }
    if (!pos.length) return;
    this.bldCentroid = cent;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aRel', new THREE.Float32BufferAttribute(rel, 1));
    geo.setAttribute('aCell', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    this.waterTex = new THREE.DataTexture(new Float32Array(1), 1, 1, THREE.RedFormat, THREE.FloatType);
    this.bldMat = new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.DoubleSide,
      uniforms: { uWater: { value: this.waterTex }, uThr: { value: 0.15 }, uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute float aRel; attribute vec2 aCell;
        uniform sampler2D uWater;
        varying float vRel; varying float vDepth;
        void main() {
          vRel = aRel;
          vDepth = texture2D(uWater, vec2(aCell.x, 1.0 - aCell.y)).r;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uThr; uniform float uTime;
        varying float vRel; varying float vDepth;
        void main() {
          vec3 wall = mix(vec3(0.03, 0.08, 0.17), vec3(0.1, 0.38, 0.55), smoothstep(0.7, 1.0, vRel));
          if (vDepth >= uThr) wall = mix(vec3(0.35, 0.03, 0.08), vec3(1.0, 0.25, 0.35), smoothstep(0.5, 1.0, vRel) * (0.8 + 0.2 * sin(uTime * 4.0)));
          else if (vDepth >= 0.1) wall = mix(vec3(0.3, 0.2, 0.02), vec3(1.0, 0.75, 0.2), smoothstep(0.6, 1.0, vRel));
          gl_FragColor = vec4(wall, 0.95);
        }`,
    });
    this.buildings = new THREE.Mesh(geo, this.bldMat);
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
    this.facilityLabels.forEach((o) => { o.element.dataset.state = status[o.userData.index] ?? 'seco'; });
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
  private streetLabels: CSS2DObject[] = [];
  private facilityLabels: CSS2DObject[] = [];

  /** Un rótulo por avenida o calle principal con nombre, en el medio de su tramo más largo. */
  private buildStreetLabels(roads: { k: number; n?: string; c: number[][] }[]) {
    const best = new Map<string, { len: number; c: number[][] }>();
    for (const r of roads) {
      if (!r.n || r.k > 2 || r.c.length < 2) continue;
      let len = 0;
      for (let i = 1; i < r.c.length; i++) len += Math.hypot(r.c[i][0] - r.c[i - 1][0], r.c[i][1] - r.c[i - 1][1]);
      const cur = best.get(r.n);
      if (!cur || len > cur.len) best.set(r.n, { len, c: r.c });
    }
    for (const [name, { c, len }] of best) {
      if (len < 0.004) continue; // tramos de menos de ~400 m no se rotulan
      const mid = c[Math.floor(c.length / 2)];
      const el = document.createElement('div');
      el.className = 'street-label';
      el.textContent = name;
      const obj = new CSS2DObject(el);
      obj.position.copy(this.lonLatToWorld(mid[0], mid[1], 0.02));
      this.streetLabels.push(obj);
      this.scene.add(obj);
    }
  }

  /** Rótulos permanentes para hospitales; el resto se ve al pasar el mouse. */
  private buildFacilityLabels(list: Facility[]) {
    list.forEach((f, i) => {
      if (f.cat !== 'hospital' || f.name.startsWith('(')) return;
      const el = document.createElement('div');
      el.className = 'facility-label';
      el.textContent = '✚ ' + f.name;
      const obj = new CSS2DObject(el);
      obj.position.copy(this.facilityPos[i]).add(new THREE.Vector3(0, CAT_HEIGHT.hospital + 0.03, 0));
      obj.userData.index = i;
      this.facilityLabels.push(obj);
      this.scene.add(obj);
    });
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
    this.streetLabels.forEach((o) => (o.visible = l.lines && l.labels));
    this.facilityLabels.forEach((o) => (o.visible = l.labels && l.facilities));
    if (this.beams) this.beams.visible = l.facilities;
    if (this.bases) this.bases.visible = l.facilities;
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
    if (this.bldMat) this.bldMat.uniforms.uTime.value = t;
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
    if (++this.frame % 12 === 0) this.declutter();
  };

  private frame = 0;
  /** Oculta rótulos que se pisan: primero hospitales, después barrios, después calles. */
  private declutter() {
    const kept: DOMRect[] = [];
    const far = this.camera.position.distanceTo(this.controls.target) > 9;
    for (const group of [this.facilityLabels, this.labels, this.streetLabels]) {
      for (const o of group) {
        const el = o.element;
        if (!o.visible) continue;
        if (group === this.streetLabels && far) { el.classList.add('declutter'); continue; }
        const r = el.getBoundingClientRect();
        if (!r.width) continue;
        const hit = kept.some((k) => r.left < k.right + 4 && r.right > k.left - 4 && r.top < k.bottom + 2 && r.bottom > k.top - 2);
        el.classList.toggle('declutter', hit);
        if (!hit) kept.push(r);
      }
    }
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
