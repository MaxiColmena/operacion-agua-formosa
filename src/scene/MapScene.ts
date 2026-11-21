import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { AppData, Buildings, Facility, TerrainMeta } from '../data/load';
import { lonLatToCell } from '../data/load';
import { MASK_RIVER, MASK_WATER } from '../sim/engine';
import { DEFENSA_ANILLO } from '../sim/defensa';
import { STREET } from '../sim/scenarios';
import { FreeCamera, type FreeCameraState } from './FreeCamera';

/** Exageración vertical por defecto: la ciudad tiene ~20 m de desnivel en 16 km (casi plana). */
export const DEFAULT_EXAG = 8;
export const EXAG_MIN = 1;
export const EXAG_MAX = 20;
const BASE = 48;
const BLD_EXAG = 3;

export type WaterMode = 'depth' | 'order';
export type FacilityStatus = 'seco' | 'atencion' | 'afectado';

export interface Layers {
  water: boolean;
  zones: boolean;
  /** Red pluvial relevada (bocas de tormenta y sumideros). */
  drainage: boolean;
  buildings: boolean;
  lines: boolean;
  labels: boolean;
  facilities: boolean;
  /** Mapa de calor de prioridad: zonas 1º/2º/3º ponderadas por población y vulnerabilidad (Censo 2022). */
  priority: boolean;
  /** Tipo de calzada: pavimentada, de tierra o sin dato (OpenStreetMap). */
  surface: boolean;
}

/** Seco: tono apagado (por debajo del umbral de bloom); atención/afectado: vivos para resaltar. */
const STATUS_COLOR: Record<FacilityStatus, THREE.Color> = {
  seco: new THREE.Color('#7b8593'),
  // Escala del agua: celeste = agua cerca, azul intenso = con agua (más oscuro, más peligroso). Sin rojos.
  atencion: new THREE.Color('#8fd8ff'),
  afectado: new THREE.Color('#3d63ff'),
};

/** Altura (km) del poste de cada instalación en estado seco: marcadores bajos y discretos. */
const CAT_HEIGHT: Record<string, number> = {
  hospital: 0.09, salud: 0.065, escuela: 0.045, seguridad: 0.05, servicios: 0.055, publico: 0.05, transporte: 0.05,
};
/** Tamaño relativo del marcador por categoría (los hospitales algo mayores). */
const CAT_SIZE: Record<string, number> = { hospital: 1.45, salud: 1.15 };
/** Altura (km) del haz cuando la instalación requiere atención o está afectada. */
const ALERT_HEIGHT: Record<FacilityStatus, number> = { seco: 0, atencion: 0.28, afectado: 0.5 };

/** Profundidad del agua en la calzada: en zona urbana el agua de la celda se concentra en la calle. */
export function streetDepth(d: number, urban: number) {
  return urban ? d / STREET.share : d;
}

/** Clave única de un barrio: OpenStreetMap repite algunos nombres (por ejemplo, «República Argentina»). */
export function barrioKey(b: { name: string; lon: number; lat: number }) {
  return `${b.name}|${b.lon.toFixed(5)}|${b.lat.toFixed(5)}`;
}

/** Profundidad para mostrar: en cm hasta 1 m; más arriba, "más de 1 m" (el modelo no da más precisión). */
export function fmtDepth(m: number) {
  return m >= 1 ? 'más de 1 m' : `~${Math.round(m * 100)} cm`;
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
  private facilityStatus: FacilityStatus[] = [];
  private rain!: THREE.LineSegments;
  private rainCount = 0;
  private labels: CSS2DObject[] = [];
  private clock = new THREE.Clock();
  private raf = 0;
  private disposed = false;
  private highlight: THREE.Mesh;
  /** Exageración vertical actual (y = (elev - BASE) * exag / 1000 km). */
  private exag = DEFAULT_EXAG;
  /** Último cuadro de agua, para reubicar la malla al cambiar la exageración. */
  private lastWater: [Float32Array, Float32Array, Uint8Array, Uint8Array, number] | null = null;
  /** Por vértice de edificio: cota del terreno (m) y altura sobre el terreno (km). */
  private bldElev: Float32Array | null = null;
  private bldOff: Float32Array | null = null;

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

    this.scene.background = new THREE.Color('#080b10');
    this.scene.fog = new THREE.FogExp2('#080b10', 0.028);

    this.camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.01, 200);
    this.camera.position.set(2.5, 12.5, 12.5);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0.8, 0.2, 0.2);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.minDistance = 0.6;
    this.controls.maxDistance = 30;
    this.freeCam = new FreeCamera(this.camera, this.controls, this.renderer.domElement, {
      groundY: (x, z) => this.surfaceYAt(x, z),
      halfW: this.widthKm / 2,
      halfH: this.heightKm / 2,
    });
    this.freeCam.onChange = (s) => this.onFreeCameraChange?.(s);

    this.scene.add(new THREE.AmbientLight('#a9b8c8', 0.6));
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
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(container.clientWidth, container.clientHeight), 0.16, 0.25, 0.85));
    this.composer.addPass(new OutputPass());

    window.addEventListener('resize', this.onResize);
    // Al terminar de cargar una tipografía cambian los anchos de los rótulos: se vuelven a ubicar y despejar.
    document.fonts?.addEventListener?.('loadingdone', this.markLabelsDirty);
    this.maxPixelRatio = Math.min(window.devicePixelRatio, 2);
    this.perfWarmupUntil = performance.now() + 3000;
    this.labelsDirty = true;
    this.animate();
  }

  // ---------- ganchos públicos (recorrido guiado, presentación) ----------
  /** Se llama en cada cuadro dibujado, después del render y de los rótulos (p. ej. para copiar a una grabación). */
  onAfterRender: ((canvas: HTMLCanvasElement) => void) | null = null;
  private cameraDriver: ((dt: number, t: number) => void) | null = null;
  /**
   * Conductor de cámara: mientras está activo, en cada cuadro escribe `camera.position` y `controls.target`
   * (dt y t en segundos) y se omiten el vuelo, la cámara libre y OrbitControls.
   */
  setCameraDriver(driver: ((dt: number, t: number) => void) | null) {
    const had = this.cameraDriver != null;
    if (driver) {
      this.freeCam.set(false);
      this.fly = null;
    }
    this.cameraDriver = driver;
    if (!driver && had) this.controls.update();
  }
  /** Posición (mundo) del marcador de la instalación i. */
  facilityPosition(i: number): THREE.Vector3 | null {
    const p = this.facilityPos[i];
    return p ? p.clone() : null;
  }
  get sizeKm(): { w: number; h: number } {
    return { w: this.widthKm, h: this.heightKm };
  }
  /** Relación de píxeles actual del render (puede bajar sola si el equipo no llega a 30 fps). */
  get pixelRatio() {
    return this.renderer.getPixelRatio();
  }

  // ---------- coordenadas ----------
  /** Celda fraccionaria de la grilla completa → mundo (km). */
  cellToWorld(cx: number, cy: number, elev: number) {
    return new THREE.Vector3(
      (cx / this.meta.width - 0.5) * this.widthKm,
      this.elevToY(elev),
      (cy / this.meta.height - 0.5) * this.heightKm,
    );
  }
  /** Cota (m) → altura en mundo (km) con la exageración actual. */
  elevToY(elev: number) {
    return ((elev - BASE) * this.exag) / 1000;
  }
  get exaggeration() {
    return this.exag;
  }
  elevAt(cx: number, cy: number) {
    const { width: w, height: h } = this.meta;
    const x = Math.min(w - 1.001, Math.max(0, cx - 0.5)), y = Math.min(h - 1.001, Math.max(0, cy - 0.5));
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const i = y0 * w + x0;
    const a = this.z[i], b = this.z[i + 1], c = this.z[i + w], d = this.z[i + w + 1];
    return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
  }
  /** Altura del suelo (mundo, km) en una posición x/z de mundo, con la exageración actual. */
  groundYAt(x: number, z: number) {
    const cx = (x / this.widthKm + 0.5) * this.meta.width;
    const cy = (z / this.heightKm + 0.5) * this.meta.height;
    return this.elevToY(this.elevAt(cx, cy));
  }
  /** Como groundYAt pero sin meterse bajo la superficie del agua visible (río/inundación). */
  surfaceYAt(x: number, z: number) {
    let y = this.groundYAt(x, z);
    const { w, h } = this.waterGrid;
    if (this.water?.visible && w > 1 && h > 1) {
      const pos = this.water.geometry.attributes.position as THREE.BufferAttribute;
      const fx = (x / (this.widthKm * (1 - 1 / w)) + 0.5) * (w - 1);
      const fz = (z / (this.heightKm * (1 - 1 / h)) + 0.5) * (h - 1);
      const x0 = Math.max(0, Math.min(w - 2, Math.floor(fx))), z0 = Math.max(0, Math.min(h - 2, Math.floor(fz)));
      for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) y = Math.max(y, pos.getY((z0 + j) * w + x0 + i));
    }
    return y;
  }

  // ---------- cámara libre ----------
  private freeCam: FreeCamera;
  /** Se llama al entrar/salir de la cámara libre (botón, F o Esc) y al cambiar su velocidad. */
  onFreeCameraChange: ((s: FreeCameraState) => void) | null = null;
  get freeCamera() {
    return this.freeCam.active;
  }
  setFreeCamera(on: boolean) {
    if (on) this.fly = null;
    this.freeCam.set(on);
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
      pos.setY(i, this.elevToY(data.z[i]));
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

    // Textura de la red pluvial relevada (0 = sin red, 1..3 = grupo).
    const drainData = new Uint8Array(w * h);
    if (data.drainage) for (let i = 0; i < w * h; i++) drainData[i] = data.drainage[i] ? 255 : 0;
    const drainTex = new THREE.DataTexture(drainData, w, h, THREE.RedFormat, THREE.UnsignedByteType);
    drainTex.magFilter = THREE.LinearFilter;
    drainTex.minFilter = THREE.LinearFilter;
    drainTex.needsUpdate = true;

    const { lines: linesTex, roads: roadsTex } = this.buildLinesTexture(data);
    this.streetTex = new THREE.DataTexture(new Float32Array(2), 1, 1, THREE.RGFormat, THREE.FloatType);

    this.terrainMat = new THREE.ShaderMaterial({
      uniforms: {
        uZones: { value: zoneTex },
        uDrain: { value: drainTex },
        uShowDrain: { value: 0 },
        uShowSurf: { value: 0 },
        uSurfStart: { value: -100 },
        uLines: { value: linesTex },
        uRoads: { value: roadsTex },
        uWater: { value: this.streetTex },
        uWaterSize: { value: new THREE.Vector2(1, 1) },
        uStreet: { value: new THREE.Vector3(STREET.wet, STREET.curb, STREET.impassable) },
        uShowZones: { value: 0 },
        uPriority: { value: new THREE.DataTexture(new Uint8Array(1), 1, 1, THREE.RedFormat, THREE.UnsignedByteType) },
        uShowPriority: { value: 0 },
        uShowLines: { value: 1 },
        uTime: { value: 0 },
        fogColor: { value: new THREE.Color('#080b10') },
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
        uniform sampler2D uDrain; uniform float uShowDrain;
        uniform sampler2D uPriority; uniform float uShowPriority;
        uniform float uShowSurf; uniform float uSurfStart;
        uniform vec3 fogColor; uniform float fogDensity;
        varying float vElev; varying vec2 vUv; varying vec3 vN; varying vec3 vW; varying float vFogDepth;
        float lineAt(float v, float w) { float f = fract(v); float d = min(f, 1.0 - f) / max(fwidth(v), 1e-4); return 1.0 - clamp(d / w, 0.0, 1.0); }
        void main() {
          vec2 tuv = vec2(vUv.x, 1.0 - vUv.y);
          float t = clamp((vElev - 49.0) / 14.0, 0.0, 1.0);
          vec3 col = mix(vec3(0.045, 0.075, 0.085), vec3(0.07, 0.08, 0.11), smoothstep(0.0, 0.7, t));
          col = mix(col, vec3(0.13, 0.12, 0.16), smoothstep(0.75, 1.0, t));
          float sh = clamp(dot(normalize(vN), normalize(vec3(-0.4, 0.75, -0.5))), 0.0, 1.0);
          col *= 0.45 + 0.85 * sh;
          // Curvas de nivel: cada 1 m finas, cada 5 m marcadas.
          float c1 = lineAt(vElev, 1.0) * 0.18;
          float c5 = lineAt(vElev / 5.0, 1.2) * 0.55;
          col += vec3(0.4, 0.55, 0.62) * max(c1, c5) * 0.32;
          // Grilla de 1 km.
          float g = max(lineAt(vW.x, 1.0), lineAt(vW.z, 1.0));
          col += vec3(0.3, 0.38, 0.45) * g * 0.07;
          // Calles, riachos y defensa.
          vec4 ln = texture2D(uLines, tuv);
          col = mix(col, ln.rgb * 1.05, ln.a * uShowLines);
          // Calles: color base (asfalto celeste / tierra ocre) y agua en la calzada.
          vec4 rd = texture2D(uRoads, tuv);
          if (rd.a > 0.01 && uShowLines > 0.5) {
            vec3 road = mix(vec3(0.3, 0.25, 0.18), vec3(0.2, 0.21, 0.23), rd.g);
            col = mix(col, road, rd.a * 0.8);
            // Capa «Tipo de calle»: pavimentada gris claro, tierra ocre, sin dato gris tenue. Se revela en una onda
            // que sale del centro de la ciudad (≈ 6 km/s) con un borde brillante.
            if (uShowSurf > 0.5) {
              float rad = (uTime - uSurfStart) * 6.0;
              float dist = length(vW.xz);
              float shown = 1.0 - smoothstep(rad - 0.4, rad, dist);
              float front = smoothstep(rad - 0.5, rad - 0.1, dist) * (1.0 - smoothstep(rad - 0.1, rad + 0.05, dist));
              vec3 sc = rd.b > 0.5 ? vec3(0.42, 0.45, 0.5) : rd.g > 0.5 ? vec3(0.82, 0.88, 0.95) : vec3(0.86, 0.56, 0.24);
              col = mix(col, sc, rd.a * (rd.b > 0.5 ? 0.6 : 0.95) * shown);
              col += vec3(0.6, 0.85, 1.0) * front * rd.a * 0.8;
            }
            // Profundidad en la calle (canal G): bilineal manual sobre la grilla de simulación.
            vec2 p = tuv * uWaterSize - 0.5;
            vec2 f = fract(p); vec2 i0 = (floor(p) + 0.5) / uWaterSize; vec2 dt = 1.0 / uWaterSize;
            float s = mix(mix(texture2D(uWater, i0).g, texture2D(uWater, i0 + vec2(dt.x, 0.0)).g, f.x),
                          mix(texture2D(uWater, i0 + vec2(0.0, dt.y)).g, texture2D(uWater, i0 + dt).g, f.x), f.y);
            // Solo se pinta desde el cordón (10 cm): con menos, toda la grilla de calles se teñía de azul.
            if (s > uStreet.y) {
              // Agua sobre el cordón: celeste → azul. Intransitable: azul profundo con franjas que se mueven.
              float stripe = step(0.55, fract((vW.x + vW.z) * 28.0 - uTime * 1.4));
              vec3 wc = s < uStreet.z ? mix(vec3(0.55, 0.85, 1.0), vec3(0.2, 0.55, 1.0), (s - uStreet.y) / (uStreet.z - uStreet.y))
                      : mix(vec3(0.1, 0.18, 0.9), vec3(0.62, 0.9, 1.0), stripe * 0.55) * (0.88 + 0.16 * sin(uTime * 4.0));
              col = mix(col, wc * 0.95, min(1.0, rd.a * 1.6) * smoothstep(uStreet.y, uStreet.y + 0.03, s));
            }
          }
          // Zonas 1ª / 2ª / 3ª.
          float zone = floor(texture2D(uZones, tuv).r * 255.0 / 60.0 + 0.5);
          if (uShowZones > 0.5 && zone > 0.5) {
            // 1º (lo primero que se afecta) = azul más profundo; 3º = celeste.
            vec3 zc = zone < 1.5 ? vec3(0.12, 0.2, 0.9) : zone < 2.5 ? vec3(0.22, 0.55, 1.0) : vec3(0.58, 0.86, 1.0);
            float pulse = 0.52 + 0.06 * sin(uTime * 2.0 + vW.x * 3.0);
            col = mix(col, zc, pulse * (zone < 1.5 ? 0.85 : 0.7));
          }
          // Red pluvial relevada: rayado verde agua sobre las celdas que drenan al 100 %.
          float dr = texture2D(uDrain, tuv).r;
          if (uShowDrain > 0.5 && dr > 0.02) {
            float hatch = step(0.5, fract((vW.x + vW.z) * 9.0));
            col = mix(col, vec3(0.18, 0.78, 0.62), dr * (0.28 + 0.3 * hatch));
          }
          // Prioridad por población (Censo 2022): mapa de calor amarillo → naranja → rojo → magenta.
          if (uShowPriority > 0.5) {
            float pv = texture2D(uPriority, tuv).r;
            if (pv > 0.02) {
              // Celeste (prioridad baja) → azul profundo (alta), con un latido suave donde la prioridad es alta.
              vec3 hc = pv < 0.5 ? mix(vec3(0.6, 0.88, 1.0), vec3(0.22, 0.55, 1.0), pv / 0.5)
                      : mix(vec3(0.22, 0.55, 1.0), vec3(0.1, 0.16, 0.82), (pv - 0.5) / 0.5);
              float beat = 1.0 + 0.22 * pv * sin(uTime * 2.6 + vW.x * 2.0);
              col = mix(col, hc * beat, 0.32 + 0.55 * pv);
            }
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
      new THREE.LineBasicMaterial({ color: '#5d7482', transparent: true, opacity: 0.35 }),
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
          const sf = r.s ?? (r.paved ? 'p' : 't');
          rg.strokeStyle = sf === 'p' ? `rgba(255,255,0,${a})` : sf === 't' ? `rgba(255,0,0,${a})` : `rgba(255,0,255,${a})`;
          rg.setLineDash(sf === '?' ? [5, 4] : []);
          rg.lineWidth = k === 1 ? 4.5 : k === 2 ? 3 : 1.8;
          rg.beginPath();
          r.c.forEach(([lon, lat], i) => { const [x, y] = toPx(lon, lat); if (i) rg.lineTo(x, y); else rg.moveTo(x, y); });
          rg.stroke();
        }
      }
      for (const l of osm.waterLines) {
        if (l.kind === 'defensa') { g.strokeStyle = 'rgba(196,112,178,0.95)'; g.lineWidth = 5; }
        else { g.strokeStyle = 'rgba(56,118,190,0.8)'; g.lineWidth = l.kind === 'river' ? 4 : 2; }
        stroke(l.c);
      }
    }
    // Contorno del río Paraguay (máscara).
    const { width: w, height: h } = this.meta;
    // Un rectángulo por celda, con medio píxel de solape: el solape forma parte del tono final del río.
    g.fillStyle = 'rgba(18,58,128,0.55)';
    const sx = W / w, sy = H / h;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data.mask[y * w + x] & MASK_RIVER) g.fillRect(x * sx, y * sy, sx + 0.5, sy + 0.5);
    // Anillo de defensa como línea continua (la máscara de celdas queda escalonada).
    {
      const { west, east, north, south } = this.meta.bounds;
      g.strokeStyle = 'rgba(196,112,178,0.9)';
      g.lineWidth = 4;
      g.lineJoin = 'round';
      g.beginPath();
      DEFENSA_ANILLO.forEach(([lon, lat], i) => {
        const x = ((lon - west) / (east - west)) * W, y = ((north - lat) / (north - south)) * H;
        if (i) g.lineTo(x, y); else g.moveTo(x, y);
      });
      g.closePath();
      g.stroke();
    }
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
          vec3 shallow = vec3(0.13, 0.4, 0.58), deep = vec3(0.035, 0.12, 0.37);
          vec3 col = mix(shallow, deep, sqrt(d));
          if (vRiver > 0.5) col = vec3(0.05, 0.14, 0.34);
          else if (uMode > 0.5 && vTWet >= 0.0) {
            float f = clamp(vTWet / max(uSimTime, 1.0), 0.0, 1.0);
            // Lo que se mojó primero, azul profundo; lo último, celeste.
            col = f < 0.3334 ? vec3(0.1, 0.18, 0.85) : f < 0.6667 ? vec3(0.22, 0.52, 0.98) : vec3(0.58, 0.86, 1.0);
            if (vTWet == 0.0) col = vec3(0.16, 0.24, 0.5);
          }
          // Frente de avance: celdas mojadas hace poco brillan.
          float age = uSimTime - vTWet;
          if (vRiver < 0.5 && vTWet > 0.0 && age < 900.0) col += vec3(0.3, 0.55, 0.7) * (1.0 - age / 900.0) * 0.2;
          float ripple = 0.02 * sin(vW.x * 40.0 + uTime * 1.7) * sin(vW.z * 37.0 - uTime * 1.3);
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
    this.lastWater = [d, tWet, byRiver, mask, simTime];
    const geo = this.water.geometry;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const aD = geo.attributes.aDepth as THREE.BufferAttribute;
    const aT = geo.attributes.aTWet as THREE.BufferAttribute;
    const aR = geo.attributes.aRiver as THREE.BufferAttribute;
    const z = this.zEffSim;
    for (let i = 0; i < d.length; i++) {
      const river = mask[i] & MASK_RIVER;
      const dep = d[i];
      const y = dep > 0.01 || river ? this.elevToY(z[i] + dep) + 0.004 : this.elevToY(z[i]) - 0.02;
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
        // Río, riachos y lagunas no cuentan como agua en la calle (si no, las calles vecinas se tiñen).
        sd[i * 2 + 1] = mask[i] & (MASK_RIVER | MASK_WATER) ? 0 : streetDepth(d[i], u[i]);
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

  /**
   * Dos pasadas con arreglos tipados preasignados (sin arreglos JS que crecen ni un Vector2 por vértice):
   * la 1ª triangula los techos no cuadrangulares y cuenta vértices/índices; la 2ª escribe la malla.
   * El contenido (orden de vértices, atributos e índices) es el mismo que con la versión anterior.
   */
  private buildBuildings(b: Buildings) {
    const W = this.meta.width, H = this.meta.height, wk = this.widthKm, hkm = this.heightKm;
    const pool: THREE.Vector2[] = [];
    const v2: THREE.Vector2[] = [];
    const QUAD = [[0, 1, 2], [0, 2, 3]];
    const roofs: number[][][] = new Array(b.count);
    let nVert = 0, nIdx = 0;
    for (let i = 0; i < b.count; i++) {
      const n = b.size[i], s0 = b.start[i];
      let tris: number[][];
      if (n === 4) tris = QUAD;
      else {
        v2.length = 0;
        for (let j = 0; j < n; j++) {
          const p = pool[j] ?? (pool[j] = new THREE.Vector2());
          p.set((b.xy[(s0 + j) * 2] / W - 0.5) * wk, (b.xy[(s0 + j) * 2 + 1] / H - 0.5) * hkm);
          v2.push(p);
        }
        tris = THREE.ShapeUtils.triangulateShape(v2, []);
      }
      roofs[i] = tris;
      nVert += 2 * n;
      nIdx += 6 * n + 3 * tris.length;
    }
    if (!nVert) return;
    const pos = new Float32Array(nVert * 3);
    const rel = new Float32Array(nVert);
    const uvs = new Float32Array(nVert * 2);
    const elevV = new Float32Array(nVert);
    const offV = new Float32Array(nVert);
    const idx = nVert > 65535 ? new Uint32Array(nIdx) : new Uint16Array(nIdx);
    const cent = new Float32Array(b.count * 2);
    let o = 0, k = 0;
    for (let i = 0; i < b.count; i++) {
      const n = b.size[i], s0 = b.start[i];
      let cx = 0, cy = 0;
      for (let j = 0; j < n; j++) { cx += b.xy[(s0 + j) * 2]; cy += b.xy[(s0 + j) * 2 + 1]; }
      cx /= n; cy /= n;
      cent[i * 2] = cx; cent[i * 2 + 1] = cy;
      const ground = this.elevAt(cx, cy);
      const base = this.elevToY(ground);
      const hm = b.height[i] > 0 ? b.height[i] : 3 + (Math.abs(Math.sin(cx * 12.9898 + cy * 78.233) * 43758.5453) % 1) * 3.5;
      // La altura del edificio va en metros reales × BLD_EXAG: no sigue a la exageración del terreno.
      const hk = (hm * BLD_EXAG) / 1000;
      const top = base + hk;
      const u = cx / W, v = cy / H;
      for (let j = 0; j < n; j++) {
        const px = (b.xy[(s0 + j) * 2] / W - 0.5) * wk, pz = (b.xy[(s0 + j) * 2 + 1] / H - 0.5) * hkm;
        const lo = o + j, hi = o + n + j;
        pos[lo * 3] = px; pos[lo * 3 + 1] = base; pos[lo * 3 + 2] = pz;
        pos[hi * 3] = px; pos[hi * 3 + 1] = top; pos[hi * 3 + 2] = pz;
        rel[hi] = 1;
        uvs[lo * 2] = u; uvs[lo * 2 + 1] = v;
        uvs[hi * 2] = u; uvs[hi * 2 + 1] = v;
        elevV[lo] = ground; elevV[hi] = ground;
        offV[hi] = hk;
      }
      for (let j = 0; j < n; j++) {
        const a = o + j, c = o + ((j + 1) % n);
        idx[k++] = a; idx[k++] = c; idx[k++] = c + n;
        idx[k++] = a; idx[k++] = c + n; idx[k++] = a + n;
      }
      for (const t of roofs[i]) { idx[k++] = o + n + t[0]; idx[k++] = o + n + t[1]; idx[k++] = o + n + t[2]; }
      o += 2 * n;
    }
    this.bldCentroid = cent;
    this.bldElev = elevV;
    this.bldOff = offV;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aRel', new THREE.BufferAttribute(rel, 1));
    geo.setAttribute('aCell', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
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
          vec3 wall = mix(vec3(0.07, 0.08, 0.1), vec3(0.2, 0.24, 0.28), smoothstep(0.7, 1.0, vRel));
          // Casas con agua: azul intenso que late, con el borde de arriba brillante. Agua cerca: celeste.
          if (vDepth >= uThr) wall = mix(vec3(0.05, 0.08, 0.38), vec3(0.35, 0.58, 1.0), smoothstep(0.5, 1.0, vRel)) * (0.85 + 0.22 * sin(uTime * 4.0));
          else if (vDepth >= 0.1) wall = mix(vec3(0.08, 0.16, 0.24), vec3(0.6, 0.88, 1.0), smoothstep(0.6, 1.0, vRel));
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
    // Poste fino que se apaga hacia la punta (color por vértice × color por instancia).
    const beamGeo = new THREE.CylinderGeometry(0.007, 0.011, 1, 8, 1, false).translate(0, 0.5, 0);
    const fade = new Float32Array(beamGeo.attributes.position.count * 3);
    for (let k = 0; k < beamGeo.attributes.position.count; k++) {
      const g = 1 - 0.6 * beamGeo.attributes.position.getY(k);
      fade.set([g, g, g], k * 3);
    }
    beamGeo.setAttribute('color', new THREE.BufferAttribute(fade, 3));
    const beamMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.75, depthWrite: false });
    this.beams = new THREE.InstancedMesh(beamGeo, beamMat, n);
    // Disco chato tipo "badge": centro tenue y borde algo más marcado. Se dibuja por encima
    // de los edificios (sin depthTest) para que el punto se lea aun entre manzanas densas.
    const R = 0.032;
    const baseGeo = new THREE.CircleGeometry(R, 24).rotateX(-Math.PI / 2);
    const rim = new Float32Array(baseGeo.attributes.position.count * 3);
    for (let k = 0; k < baseGeo.attributes.position.count; k++) {
      const r = Math.hypot(baseGeo.attributes.position.getX(k), baseGeo.attributes.position.getZ(k)) / R;
      const g = 0.4 + 0.6 * r;
      rim.set([g, g, g], k * 3);
    }
    baseGeo.setAttribute('color', new THREE.BufferAttribute(rim, 3));
    const baseMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.65, side: THREE.DoubleSide, depthWrite: false, depthTest: false });
    this.bases = new THREE.InstancedMesh(baseGeo, baseMat, n);
    this.bases.renderOrder = 3;
    this.beams.renderOrder = 2;
    list.forEach((_, i) => {
      this.facilityPos.push(new THREE.Vector3());
      this.facilityStatus.push('seco');
      this.beams!.setColorAt(i, STATUS_COLOR.seco);
      this.bases!.setColorAt(i, STATUS_COLOR.seco);
    });
    this.placeFacilities();
    this.scene.add(this.beams, this.bases);
  }

  /** Altura actual del marcador: poste bajo si está seco, haz más alto si requiere atención. */
  private facilityHeight(i: number) {
    const s = this.facilityStatus[i] ?? 'seco';
    const base = CAT_HEIGHT[this.facilities[i].cat] ?? 0.05;
    return s === 'seco' ? base : ALERT_HEIGHT[s] * (CAT_SIZE[this.facilities[i].cat] ?? 1) ** 0.5;
  }

  /** Escribe las matrices del poste y del disco de la instalación i (pulse: factor del disco). */
  private setFacilityMatrix(i: number, pulse = 1) {
    const m = this._fm, q = this._fq, s = this._fs;
    const p = this.facilityPos[i];
    const size = CAT_SIZE[this.facilities[i].cat] ?? 1;
    const alert = this.facilityStatus[i] !== 'seco';
    s.set(size * (alert ? 1.15 : 1), this.facilityHeight(i), size * (alert ? 1.15 : 1));
    m.compose(p, q, s);
    this.beams!.setMatrixAt(i, m);
    const b = size * pulse;
    s.set(b, 1, b);
    m.compose(p, q, s);
    this.bases!.setMatrixAt(i, m);
  }
  private _fm = new THREE.Matrix4();
  private _fq = new THREE.Quaternion();
  private _fs = new THREE.Vector3();

  /** Ubica postes y discos sobre el terreno con la exageración actual. */
  private placeFacilities() {
    if (!this.beams || !this.bases) return;
    this.facilities.forEach((f, i) => {
      this.facilityPos[i].copy(this.lonLatToWorld(f.lon, f.lat, 0.003));
      this.setFacilityMatrix(i);
    });
    this.beams.instanceMatrix.needsUpdate = true;
    this.bases.instanceMatrix.needsUpdate = true;
    this.beams.computeBoundingSphere();
    this.bases.computeBoundingSphere();
  }

  /** Late el disco de las instalaciones en atención/afectadas; las secas quedan quietas. */
  private updateFacilityPulse(t: number) {
    if (!this.beams || !this.bases || !this.bases.visible) return;
    let any = false;
    for (let i = 0; i < this.facilityStatus.length; i++) {
      const s = this.facilityStatus[i];
      if (s === 'seco') continue;
      any = true;
      const w = 0.5 + 0.5 * Math.sin(t * (s === 'afectado' ? 3.2 : 2) + i * 0.7);
      this.setFacilityMatrix(i, s === 'afectado' ? 1.5 + 0.9 * w : 1.25 + 0.4 * w);
    }
    if (any) this.bases.instanceMatrix.needsUpdate = true;
  }

  setFacilityStatus(status: FacilityStatus[]) {
    this.facilityLabels.forEach((o) => { o.element.dataset.state = status[o.userData.index] ?? 'seco'; });
    this.labelsDirty = true;
    if (!this.beams || !this.bases) return;
    let changed = false;
    status.forEach((s, i) => {
      if (this.facilityStatus[i] !== s) {
        this.facilityStatus[i] = s;
        this.setFacilityMatrix(i);
        changed = true;
      }
      this.beams!.setColorAt(i, STATUS_COLOR[s]);
      this.bases!.setColorAt(i, STATUS_COLOR[s]);
    });
    this.beams.instanceColor!.needsUpdate = true;
    this.bases.instanceColor!.needsUpdate = true;
    if (changed) {
      this.beams.instanceMatrix.needsUpdate = true;
      this.bases.instanceMatrix.needsUpdate = true;
      this.beams.computeBoundingSphere();
    }
  }

  /** Busca la instalación más cercana al punto de pantalla (px), dentro de 14 px. */
  pickFacility(clientX: number, clientY: number): number {
    const rect = this.renderer.domElement.getBoundingClientRect();
    let best = -1, bestD = 14 * 14;
    const v = new THREE.Vector3();
    this.facilityPos.forEach((p, i) => {
      for (const lift of [0, this.facilityHeight(i) * 0.5, this.facilityHeight(i)]) {
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
    if (i == null || i < 0 || !this.facilityPos[i]) { this.highlight.visible = false; this.highlightIndex = null; return; }
    this.highlightIndex = i;
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

  /** Vuela hasta una celda de la grilla de la simulación (por ejemplo, el punto más profundo de una calle). */
  focusSimCell(cell: number) {
    const { w } = this.waterGrid;
    if (!w) return;
    const f = this.meta.width / w;
    const cx = ((cell % w) + 0.5) * f, cy = (Math.floor(cell / w) + 0.5) * f;
    this.highlight.visible = false;
    const p = this.cellToWorld(cx, cy, this.elevAt(cx, cy));
    this.flyTo(p, p.clone().add(new THREE.Vector3(0.4, 1.4, 1.7)));
  }

  private highlightIndex: number | null = null;
  private fly: { from: THREE.Vector3; to: THREE.Vector3; tFrom: THREE.Vector3; tTo: THREE.Vector3; t: number } | null = null;
  flyTo(target: THREE.Vector3, camPos: THREE.Vector3) {
    // Desde la cámara libre: se sale (sin salto) y se vuela en modo órbita.
    this.freeCam.set(false);
    this.fly = { from: this.camera.position.clone(), to: camPos, tFrom: this.controls.target.clone(), tTo: target.clone(), t: 0 };
  }

  // ---------- barrios ----------
  private buildBarrioLabels(barrios: { name: string; lon: number; lat: number }[]) {
    for (const b of barrios) {
      const el = document.createElement('div');
      el.className = 'barrio-label';
      el.textContent = b.name;
      const obj = new CSS2DObject(el);
      obj.userData.anchor = [b.lon, b.lat, 0.06];
      obj.userData.name = b.name;
      obj.userData.key = barrioKey(b);
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
      obj.userData.anchor = [mid[0], mid[1], 0.02];
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
    this.labelsDirty = true;
  }

  /**
   * Estado de cada barrio por clave (nombre + ubicación; ver barrioKey): la lista de análisis no tiene el mismo
   * orden que los rótulos (descarta barrios muy chicos) y hay nombres repetidos en OpenStreetMap.
   */
  setBarrioLabels(state: Map<string, 'seco' | 'atencion' | 'afectado'>) {
    for (const l of this.labels) l.element.dataset.state = state.get(l.userData.key as string) ?? 'seco';
    this.labelsDirty = true;
  }

  // ---------- calles que podrían quedar intransitables ----------
  private streetAlerts: CSS2DObject[] = [];
  /**
   * Carteles animados sobre el mapa en las calles más afectadas. `cell` es una celda de la grilla de la
   * simulación (la del punto más profundo de esa calle).
   */
  setStreetAlerts(items: { name: string; depth: number; cell: number }[], visible = true) {
    const { w, h } = this.waterGrid;
    // Labels only re-render when something marks them dirty (or the camera moves).
    this.labelsDirty = true;
    while (this.streetAlerts.length < items.length) {
      const el = document.createElement('div');
      el.className = 'street-alert';
      const obj = new CSS2DObject(el);
      this.streetAlerts.push(obj);
      this.scene.add(obj);
    }
    this.streetAlerts.forEach((o, k) => {
      const it = items[k];
      o.visible = !!it && visible && w > 0;
      if (!it || !w) { o.element.innerHTML = ''; return; }
      const f = this.meta.width / w;
      const cx = ((it.cell % w) + 0.5) * f, cy = (Math.floor(it.cell / w) + 0.5) * f;
      o.userData.cell = [cx, cy];
      o.position.copy(this.cellToWorld(cx, cy, this.elevAt(cx, cy))).add(new THREE.Vector3(0, 0.05, 0));
      const key = `${it.name}|${fmtDepth(it.depth)}`;
      if (o.userData.key === key) return;
      const isNew = !o.userData.key || !String(o.userData.key).startsWith(it.name + '|');
      o.userData.key = key;
      o.element.replaceChildren();
      const icon = document.createElement('span');
      icon.className = 'sa-icon no-pass';
      const txt = document.createElement('span');
      txt.className = 'sa-text';
      const nm = document.createElement('b');
      nm.textContent = it.name;
      const dp = document.createElement('small');
      dp.textContent = `agua ${fmtDepth(it.depth)} · podría cortarse`;
      txt.append(nm, dp);
      o.element.append(icon, txt);
      if (isNew) { o.element.classList.remove('sa-in'); void o.element.offsetWidth; o.element.classList.add('sa-in'); }
    });
    void h;
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
    this.rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#a7bfcc', transparent: true, opacity: 0.35 }));
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

  // ---------- exageración vertical ----------
  /**
   * Cambia la exageración vertical del relieve (1× = escala real) y reubica todo lo que depende de ella:
   * terreno, agua, bases de edificios (su altura no cambia), instalaciones, rótulos, anillo y cámara.
   */
  setExaggeration(x: number) {
    const nx = Math.min(EXAG_MAX, Math.max(EXAG_MIN, x));
    if (nx === this.exag) return;
    const ratio = nx / this.exag;
    this.exag = nx;
    this.labelsDirty = true;

    // Terreno.
    const tg = this.terrain.geometry;
    const tp = tg.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < this.z.length; i++) tp.setY(i, this.elevToY(this.z[i]));
    tp.needsUpdate = true;
    tg.computeVertexNormals();
    tg.computeBoundingSphere();

    // Agua: se recalcula con el último cuadro.
    if (this.lastWater) {
      this.setWaterFrame(...this.lastWater);
      this.water.geometry.computeBoundingSphere();
    }

    // Edificios: se mueve la base, la altura queda en metros reales × BLD_EXAG.
    if (this.buildings && this.bldElev && this.bldOff) {
      const bg = this.buildings.geometry;
      const bp = bg.attributes.position as THREE.BufferAttribute;
      const arr = bp.array as Float32Array;
      const e = this.bldElev, o = this.bldOff;
      for (let i = 0; i < e.length; i++) arr[i * 3 + 1] = this.elevToY(e[i]) + o[i];
      bp.needsUpdate = true;
      bg.computeBoundingSphere();
    }

    // Instalaciones y rótulos.
    this.placeFacilities();
    for (const o of this.streetAlerts) {
      const c = o.userData.cell as [number, number] | undefined;
      if (c) o.position.copy(this.cellToWorld(c[0], c[1], this.elevAt(c[0], c[1]))).add(new THREE.Vector3(0, 0.05, 0));
    }
    for (const o of [...this.labels, ...this.streetLabels]) {
      const a = o.userData.anchor as [number, number, number] | undefined;
      if (a) o.position.copy(this.lonLatToWorld(a[0], a[1], a[2]));
    }
    for (const o of this.facilityLabels) {
      o.position.copy(this.facilityPos[o.userData.index]).add(new THREE.Vector3(0, CAT_HEIGHT.hospital + 0.03, 0));
    }
    if (this.highlightIndex != null && this.facilityPos[this.highlightIndex]) {
      this.highlight.position.copy(this.facilityPos[this.highlightIndex]);
    }

    // Cámara: objetivo y cámara suben/bajan juntos con el suelo, sin cambiar el encuadre.
    const dy = this.controls.target.y * (ratio - 1);
    this.controls.target.y += dy;
    this.camera.position.y += dy;
    if (this.fly) {
      const fdy = this.fly.tTo.y * (ratio - 1);
      this.fly.tTo.y += fdy;
      this.fly.to.y += fdy;
    }
  }

  // ---------- prioridad por población ----------
  /** Carga el mapa de calor de prioridad (valores 0–1 sobre la grilla de la simulación). */
  setPriorityHeat(values: Float32Array, width: number, height: number) {
    const old = this.terrainMat.uniforms.uPriority.value as THREE.DataTexture;
    // 8 bits alcanzan para colorear y el filtrado lineal funciona en cualquier placa (los float no siempre).
    const bytes = new Uint8Array(values.length);
    for (let i = 0; i < values.length; i++) bytes[i] = Math.round(Math.min(1, Math.max(0, values[i])) * 255);
    const tex = new THREE.DataTexture(bytes, width, height, THREE.RedFormat, THREE.UnsignedByteType);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    this.terrainMat.uniforms.uPriority.value = tex;
    old.dispose();
  }

  // ---------- capas ----------
  setLayers(l: Layers) {
    this.terrainMat.uniforms.uShowPriority.value = l.priority ? 1 : 0;
    // Al prender «Tipo de calle», la onda arranca de nuevo desde el centro.
    if (l.surface && !this.terrainMat.uniforms.uShowSurf.value) this.terrainMat.uniforms.uSurfStart.value = this.clock.elapsedTime;
    this.terrainMat.uniforms.uShowSurf.value = l.surface ? 1 : 0;
    if (this.water) this.water.visible = l.water;
    this.terrainMat.uniforms.uShowZones.value = l.zones ? 1 : 0;
    this.terrainMat.uniforms.uShowDrain.value = l.drainage ? 1 : 0;
    this.terrainMat.uniforms.uShowLines.value = l.lines ? 1 : 0;
    if (this.buildings) this.buildings.visible = l.buildings;
    this.labels.forEach((o) => (o.visible = l.labels));
    this.streetLabels.forEach((o) => (o.visible = l.lines && l.labels));
    this.streetAlerts.forEach((o) => (o.visible = l.lines && !!o.element.childElementCount));
    this.facilityLabels.forEach((o) => (o.visible = l.labels && l.facilities));
    if (this.beams) this.beams.visible = l.facilities;
    if (this.bases) this.bases.visible = l.facilities;
    this.labelsDirty = true;
  }

  // ---------- ciclo ----------
  private onResize = () => {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
    this.labelsDirty = true;
  };

  /** Intervalo objetivo (ms): en pantallas de 120 Hz o más se dibuja cada k refrescos (~60 fps parejos). */
  private static readonly FRAME_MS = 1000 / 60;
  private lastRenderAt = -Infinity;
  /** Intervalo medido entre refrescos de la pantalla (media móvil, ms). */
  private refreshMs = 1000 / 60;
  private lastTickAt = -1;
  private tickCount = 0;

  private animate = (now: number = performance.now()) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.animate);
    // Tope de ~60 fps solo en pantallas rápidas (≥ ~105 Hz): se dibuja un refresco de cada k, con k entero, así
    // el ritmo es parejo (120 Hz → 60, 144 Hz → 72, 165 Hz → 55). En 60/75/90/100 Hz se dibujan todos los refrescos.
    // El dt sale del reloj (tiempo desde el último cuadro dibujado), así las animaciones no cambian de velocidad.
    if (this.lastTickAt >= 0) {
      const d = now - this.lastTickAt;
      if (d > 2 && d < 50) this.refreshMs += (d - this.refreshMs) * 0.05;
    }
    this.lastTickAt = now;
    const k = this.refreshMs <= 9.5 ? Math.max(1, Math.round(MapScene.FRAME_MS / this.refreshMs)) : 1;
    if (++this.tickCount % k !== 0) return;
    const elapsedMs = now - this.lastRenderAt;
    this.lastRenderAt = now;
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const t = this.clock.elapsedTime;
    this.terrainMat.uniforms.uTime.value = t;
    if (this.waterMat) this.waterMat.uniforms.uTime.value = t;
    if (this.bldMat) this.bldMat.uniforms.uTime.value = t;
    this.updateFacilityPulse(t);
    if (!this.cameraDriver && this.fly) {
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
    if (this.cameraDriver) {
      this.cameraDriver(dt, t);
      this.camera.lookAt(this.controls.target);
    } else {
      this.freeCam.update(dt);
      if (!this.freeCam.active) this.controls.update();
    }
    this.composer.render();
    this.renderLabels(now);
    this.onAfterRender?.(this.renderer.domElement);
    this.adaptResolution(now, elapsedMs);
  };

  // ---------- rótulos ----------
  /** Algo cambió en los rótulos (capas, estados, tamaño, exageración, tipografía) y hay que volver a ubicarlos. */
  private labelsDirty = true;
  private markLabelsDirty = () => { this.labelsDirty = true; };
  private lastLabelView = new THREE.Matrix4();
  private lastLabelProj = new THREE.Matrix4();
  private lastLabelRenderAt = -Infinity;
  private lastDeclutterFrame = -Infinity;
  private declutterPending = false;

  /**
   * El CSS2DRenderer recorre y reubica cientos de rótulos del DOM: solo se llama cuando la cámara se movió
   * (matriz de mundo o proyección distinta) o cuando algo marcó los rótulos como sucios. El despeje
   * (solapamientos) mantiene su cadencia de cada 12 cuadros mientras hay movimiento, y corre una vez más
   * al quedar quieta la cámara para que el estado final quede despejado.
   */
  private renderLabels(now: number) {
    this.frame++;
    const cam = this.camera;
    const moved = !cam.matrixWorld.equals(this.lastLabelView) || !cam.projectionMatrix.equals(this.lastLabelProj);
    if (moved || this.labelsDirty) {
      this.labelRenderer.render(this.scene, cam);
      this.lastLabelView.copy(cam.matrixWorld);
      this.lastLabelProj.copy(cam.projectionMatrix);
      this.labelsDirty = false;
      this.lastLabelRenderAt = now;
      this.declutterPending = true;
    }
    const sinceDeclutter = this.frame - this.lastDeclutterFrame;
    const due = this.declutterPending && (sinceDeclutter >= 12 || now - this.lastLabelRenderAt >= 150);
    // Red de seguridad con la cámara quieta (~1,5 s): cambios de estilo del DOM ajenos a la escena.
    if (due || sinceDeclutter >= 90) {
      this.declutter();
      this.lastDeclutterFrame = this.frame;
      // Si la cámara sigue moviéndose, el próximo render de rótulos lo vuelve a marcar pendiente.
      this.declutterPending = false;
    }
  }

  // ---------- resolución adaptativa (solo como resguardo) ----------
  private maxPixelRatio = 1;
  private perfWarmupUntil = 0;
  private perfSlow = { sum: 0, n: 0, start: 0 };
  private perfFast = { sum: 0, n: 0, start: 0 };
  private prCeil = Infinity;
  private prCeilUntil = 0;

  /**
   * Si el equipo no sostiene 30 fps (promedio > 36 ms en ~2 s; margen para el tope de 30 fps del ahorro de energía) y la pantalla es de alta densidad,
   * baja la relación de píxeles de a 0,25 (nunca por debajo de 1). Si después anda holgado (< 20 ms en ~4 s),
   * la vuelve a subir hasta min(devicePixelRatio, 2). En equipos capaces nunca se activa.
   */
  private adaptResolution(now: number, elapsedMs: number) {
    if (this.maxPixelRatio <= 1) return;
    const slow = this.perfSlow, fast = this.perfFast;
    // Pestaña oculta, carga inicial o cuadros sueltos muy largos (pausas del hilo) no cuentan.
    if (now < this.perfWarmupUntil || !(elapsedMs < 250)) {
      slow.sum = slow.n = 0; slow.start = now;
      fast.sum = fast.n = 0; fast.start = now;
      return;
    }
    slow.sum += elapsedMs; slow.n++;
    fast.sum += elapsedMs; fast.n++;
    const pr = this.renderer.getPixelRatio();
    if (now - slow.start >= 2000) {
      if (slow.sum / slow.n > 36 && pr > 1) {
        const next = Math.max(1, pr - 0.25);
        this.prCeil = pr;
        this.prCeilUntil = now + 30000;
        this.applyPixelRatio(next);
        fast.sum = fast.n = 0; fast.start = now;
      }
      slow.sum = slow.n = 0; slow.start = now;
    }
    if (now - fast.start >= 4000) {
      if (fast.sum / fast.n < 20 && pr < this.maxPixelRatio) {
        const next = Math.min(this.maxPixelRatio, pr + 0.25);
        if (next < this.prCeil || now > this.prCeilUntil) this.applyPixelRatio(next);
      }
      fast.sum = fast.n = 0; fast.start = now;
    }
  }

  private applyPixelRatio(pr: number) {
    if (pr === this.renderer.getPixelRatio()) return;
    this.renderer.setPixelRatio(pr);
    // EffectComposer.setPixelRatio redimensiona sus render targets y los pases (bloom incluido).
    this.composer.setPixelRatio(pr);
  }

  private frame = 0;
  /** Oculta rótulos que se pisan: primero hospitales, después barrios, después calles. */
  private declutter() {
    const kept: DOMRect[] = [];
    const far = this.camera.position.distanceTo(this.controls.target) > 9;
    for (const group of [this.streetAlerts, this.facilityLabels, this.labels, this.streetLabels]) {
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

  /**
   * Libera todo lo que creó la escena (geometrías, materiales, texturas, render targets y rótulos del DOM):
   * StrictMode y HMR recrean la escena y sin esto la memoria de GPU se acumula.
   */
  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    document.fonts?.removeEventListener?.('loadingdone', this.markLabelsDirty);
    this.cameraDriver = null;
    this.onAfterRender = null;
    this.freeCam.dispose();
    this.controls.dispose();

    const textures = new Set<THREE.Texture>();
    const materials = new Set<THREE.Material>();
    const geometries = new Set<THREE.BufferGeometry>();
    const labels: CSS2DObject[] = [];
    this.scene.traverse((o) => {
      if (o instanceof CSS2DObject) { labels.push(o); return; }
      const m = o as THREE.Mesh;
      if (m.geometry) geometries.add(m.geometry);
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (mat) for (const x of Array.isArray(mat) ? mat : [mat]) materials.add(x);
    });
    for (const mat of materials) {
      const uniforms = (mat as THREE.ShaderMaterial).uniforms;
      if (uniforms) for (const u of Object.values(uniforms)) if (u?.value instanceof THREE.Texture) textures.add(u.value);
      for (const v of Object.values(mat)) if (v instanceof THREE.Texture) textures.add(v);
    }
    if (this.waterTex) textures.add(this.waterTex);
    if (this.streetTex) textures.add(this.streetTex);
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    textures.forEach((t) => t.dispose());
    for (const o of labels) {
      o.element.remove();
      o.removeFromParent();
    }
    this.labels = [];
    this.streetLabels = [];
    this.facilityLabels = [];
    for (const pass of this.composer.passes) (pass as { dispose?: () => void }).dispose?.();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    this.labelRenderer.domElement.remove();
  }
}
