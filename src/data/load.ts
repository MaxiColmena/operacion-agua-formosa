// Carga de los datos precalculados en public/data.
import type { Surface } from './surface';

export interface TerrainMeta {
  width: number;
  height: number;
  bounds: { west: number; north: number; east: number; south: number };
  cellX: number;
  cellY: number;
  min: number;
  max: number;
  source: string;
}

export type FacilityCat = 'hospital' | 'salud' | 'escuela' | 'seguridad' | 'servicios' | 'publico' | 'transporte';

export interface Facility {
  id: string;
  cat: FacilityCat;
  name: string;
  lon: number;
  lat: number;
  /** Fuente del punto: OpenStreetMap o Mapa Educativo Nacional. */
  source?: string;
  /** Detalle oficial (CUE, niveles, gestión, precisión de la ubicación). */
  detail?: string;
}

/** Padrón oficial de escuelas (Mapa Educativo Nacional), agrupado por edificio. */
export interface EscuelasMen {
  fuente: string;
  url: string;
  fecha: string;
  escuelas: {
    pos: [number, number];
    precision: string;
    establecimientos: { nombre: string; cue: string; niveles: string; gestion: string }[];
  }[];
}

/** Censo 2022 (INDEC) repartido en una grilla regular. Fila 0 = borde sur. */
export interface Poblacion {
  fuente: string;
  url: string;
  fecha: string;
  metodo: string;
  area: { oeste: number; este: number; sur: number; norte: number };
  columnas: number;
  filas: number;
  radios: number;
  poblacion: number[];
  viviendas: number[];
  definiciones?: Record<string, string>;
  hogares?: number[];
  hogaresNbi?: number[];
  hogaresHacinamiento?: number[];
  hogaresSinAguaRed?: number[];
  hogaresSinCloaca?: number[];
  personas?: number[];
  menores14?: number[];
  mayores65?: number[];
  sinCobertura?: number[];
  viviendasHabitadas?: number[];
  viviendasPrecarias?: number[];
}

export interface OsmData {
  source: string;
  facilities: Facility[];
  /** py = la calle está en la margen paraguaya (Alberdi): se dibuja pero no cuenta en los resultados. */
  /** s: tipo de calzada (p pavimentada · t tierra · ? sin dato, ver data/surface.ts). */
  roads: { k: number; paved: boolean; s?: Surface; n?: string; c: number[][]; py?: boolean }[];
  waterLines: { kind: string; name: string; c: number[][] }[];
  waterAreas: { kind: string; name: string; rings: number[][][] }[];
  barrios: { name: string; lon: number; lat: number }[];
}

export interface ZonesMeta {
  generated: string;
  resolution: string;
  threshold: number;
  levels: { id: string; short: string; label: string; why: string }[];
  stats: { id: string; km2: number }[];
}

/** Metadatos de thresholds.bin: altura del río a la que cada celda empieza a recibir agua del río. */
export interface ThresholdsMeta {
  generated: string;
  gaugeZero: number;
  defenseCrest: number;
  wetThreshold: number;
  capStage: number;
  variants: string[];
  method: string;
  units: string;
}

/** Umbral de exposición al río por celda (cm de escala; 65535 = no llega hasta capStage). */
export interface Thresholds {
  sana: Uint16Array;
  brecha: Uint16Array;
  meta: ThresholdsMeta | null;
}

export const THRESHOLD_NONE = 65535;

/** Metadatos de drainage.json (scripts/build-drainage.ts). */
export interface DrainageMeta {
  generated: string;
  source: string;
  radii: { street: number; corner: number; paved: number };
  totalKm2: number;
  entries: { id: string; label: string; group: number; ok: boolean; km2: number; note?: string }[];
}

export interface AppData {
  meta: TerrainMeta;
  z: Float32Array;
  mask: Uint8Array;
  zones: Uint8Array | null;
  zonesMeta: ZonesMeta | null;
  osm: OsmData | null;
  buildings: Buildings | null;
  thresholds: Thresholds | null;
  /** Red pluvial relevada por celda (0 = sin red, 1..3 = grupo). */
  drainage: Uint8Array | null;
  drainageMeta: DrainageMeta | null;
  /** Escuelas del padrón oficial (si se cargó, reemplazan a las de OSM). */
  escuelas: EscuelasMen | null;
  /** Censo 2022 con indicadores sociodemográficos por celda. */
  poblacion: Poblacion | null;
}

/** Edificios decodificados de buildings.bin: anillos en coordenadas de celda de la grilla completa. */
export interface Buildings {
  count: number;
  /** Inicio de cada edificio en `xy` (en puntos). */
  start: Uint32Array;
  size: Uint8Array;
  height: Float32Array;
  /** Coordenadas de celda (x, y) intercaladas. */
  xy: Float32Array;
  meta: { count: number; microsoft: number; osm: number; source: string } | null;
}

async function bin(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.arrayBuffer();
}
async function json<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

export async function loadAll(): Promise<AppData> {
  const base = `${import.meta.env.BASE_URL}data/`;
  const [meta, zBuf, mBuf, zonesBuf, zonesMeta, osm, bBuf, bMeta, tBuf, tMeta, dBuf, dMeta, escuelas, poblacion] = await Promise.all([
    json<TerrainMeta>(base + 'terrain.json'),
    bin(base + 'terrain.bin'),
    bin(base + 'masks.bin'),
    bin(base + 'zones.bin').catch(() => null),
    json<ZonesMeta>(base + 'zones.json'),
    json<OsmData>(base + 'osm.json'),
    bin(base + 'buildings.bin').catch(() => null),
    json<Buildings['meta']>(base + 'buildings.json'),
    bin(base + 'thresholds.bin').catch(() => null),
    json<ThresholdsMeta>(base + 'thresholds.json'),
    bin(base + 'drainage.bin').catch(() => null),
    json<DrainageMeta>(base + 'drainage.json'),
    json<EscuelasMen>(base + 'escuelas-men.json'),
    json<Poblacion>(base + 'poblacion.json'),
  ]);
  if (!meta) throw new Error('Falta public/data/terrain.json: correr "npm run data"');
  return {
    meta,
    z: new Float32Array(zBuf),
    mask: new Uint8Array(mBuf),
    zones: zonesBuf ? new Uint8Array(zonesBuf) : null,
    zonesMeta,
    osm: osm ? withOfficialSchools(osm, escuelas) : null,
    buildings: bBuf ? decodeBuildings(bBuf, meta, bMeta) : null,
    thresholds: tBuf ? decodeThresholds(tBuf, meta, tMeta) : null,
    // Si el archivo no existe, el servidor de desarrollo devuelve index.html: se descarta por tamaño.
    drainage: dBuf && dBuf.byteLength === meta.width * meta.height ? new Uint8Array(dBuf) : null,
    drainageMeta: dMeta,
    escuelas,
    poblacion,
  };
}

/**
 * Prepara la base de OpenStreetMap para Formosa:
 * - Escuelas: si está el padrón oficial del Mapa Educativo Nacional (el que recomienda la guía CITF),
 *   reemplaza a las escuelas de OSM, que pueden faltar o estar desactualizadas.
 * - Margen paraguaya (Alberdi): no es jurisdicción de Formosa. Se sacan sus instalaciones y barrios, y sus
 *   calles se marcan (py) para que no cuenten en los resultados.
 */
export function withOfficialSchools(osm: OsmData, men: EscuelasMen | null): OsmData {
  let facilities: Facility[] = osm.facilities.map((f) => ({ ...f, source: f.source ?? 'OpenStreetMap' }));
  if (men?.escuelas.length) {
    facilities = facilities.filter((f) => f.cat !== 'escuela');
    men.escuelas.forEach((e, k) => {
      const [first, ...rest] = e.establecimientos;
      facilities.push({
        id: `men${k}`,
        cat: 'escuela',
        name: rest.length ? `${first.nombre} (+${rest.length} en el mismo edificio)` : first.nombre,
        lon: e.pos[0],
        lat: e.pos[1],
        source: 'Mapa Educativo Nacional',
        detail: `${e.establecimientos.map((x) => `CUE ${x.cue}: ${x.niveles} (${x.gestion})`).join(' · ')} · ubicación ${e.precision.toLowerCase()}`,
      });
    });
  }
  const river = osm.waterLines.filter((l) => l.kind === 'river' && /paraguay/i.test(l.name)).map((l) => l.c);
  facilities = facilities.filter((f) => f.source === 'Mapa Educativo Nacional' || !eastOfRiver(f.lon, f.lat, river));
  const barrios = osm.barrios.filter((b) => !eastOfRiver(b.lon, b.lat, river));
  // OpenStreetMap no tiene el microcentro como barrio: sin esto, todo el centro se contaba dentro de
  // «San Martín» (cuyo punto de OSM está en la Catedral). Se agrega «Centro» en la Plaza San Martín
  // (plaza principal, OSM). Los límites siguen siendo aproximados (barrio = celdas más cercanas a su punto).
  if (!barrios.some((b) => /^centro$/i.test(b.name))) barrios.push({ name: 'Centro', lon: -58.17439, lat: -26.18525 });
  const roads = osm.roads.map((r) => {
    const m = r.c[Math.floor(r.c.length / 2)];
    return m && eastOfRiver(m[0], m[1], river) ? { ...r, py: true } : r;
  });
  return { ...osm, facilities, barrios, roads };
}

/**
 * true si el punto queda en la margen paraguaya: yendo hacia el oeste por su latitud, cruza el eje del
 * río Paraguay un número impar de veces. Contar cruces (y no mirar solo "al este del río") resuelve los
 * meandros, donde el río cruza la misma latitud varias veces.
 */
export function eastOfRiver(lon: number, lat: number, lines: number[][][]): boolean {
  let crossings = 0;
  for (const c of lines)
    for (let k = 1; k < c.length; k++) {
      const [x0, y0] = c[k - 1], [x1, y1] = c[k];
      if ((y0 <= lat && y1 > lat) || (y1 <= lat && y0 > lat)) {
        if (x0 + ((lat - y0) / (y1 - y0)) * (x1 - x0) < lon) crossings++;
      }
    }
  return crossings % 2 === 1;
}

/** thresholds.bin: Uint16 LE, 2·n valores (defensa sana, luego con brecha). Si no cuadra con la grilla, se ignora. */
function decodeThresholds(buf: ArrayBuffer, meta: TerrainMeta, tMeta: ThresholdsMeta | null): Thresholds | null {
  const n = meta.width * meta.height;
  if (buf.byteLength !== n * 4) {
    // El servidor de desarrollo devuelve index.html para archivos que no existen: eso no es un error.
    if (buf.byteLength && new Uint8Array(buf, 0, 1)[0] !== 0x3c) console.warn(`thresholds.bin: tamaño ${buf.byteLength} B, se esperaban ${n * 4} B; se ignora`);
    return null;
  }
  const dv = new DataView(buf);
  const all = new Uint16Array(2 * n);
  for (let i = 0; i < 2 * n; i++) all[i] = dv.getUint16(i * 2, true);
  return { sana: all.subarray(0, n), brecha: all.subarray(n), meta: tMeta };
}

/** lon/lat → coordenadas de celda (fraccionarias) de la grilla completa. */
export function lonLatToCell(meta: TerrainMeta, lon: number, lat: number): [number, number] {
  const { bounds: b, width: w, height: h } = meta;
  return [((lon - b.west) / (b.east - b.west)) * w, ((b.north - lat) / (b.north - b.south)) * h];
}

function decodeBuildings(buf: ArrayBuffer, meta: TerrainMeta, bMeta: Buildings['meta']): Buildings {
  const dv = new DataView(buf);
  const count = dv.getUint32(0, true);
  const start = new Uint32Array(count), size = new Uint8Array(count), height = new Float32Array(count);
  let total = 0, o = 4;
  for (let i = 0; i < count; i++) { const n = dv.getUint8(o); size[i] = n; start[i] = total; total += n; o += 2 + n * 4; }
  const xy = new Float32Array(total * 2);
  o = 4;
  let k = 0;
  for (let i = 0; i < count; i++) {
    const n = dv.getUint8(o);
    height[i] = dv.getUint8(o + 1) / 4;
    o += 2;
    for (let j = 0; j < n; j++) {
      xy[k++] = (dv.getUint16(o, true) / 65535) * meta.width;
      xy[k++] = (dv.getUint16(o + 2, true) / 65535) * meta.height;
      o += 4;
    }
  }
  return { count, start, size, height, xy, meta: bMeta };
}
