// Carga de los datos precalculados en public/data.
import { dentroDeDefensa } from '../sim/defensa-formosa';

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

export type FacilityCat = 'hospital' | 'salud' | 'escuela' | 'seguridad' | 'servicios' | 'refugio' | 'transporte';

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
  /** true si queda dentro del anillo de defensa (traza aproximada). */
  inside?: boolean;
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
  /** Indicadores sociodemográficos (conteos por celda). Pueden faltar si se generó con una versión vieja. */
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
  roads: { k: number; paved: boolean; n?: string; c: number[][] }[];
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

export interface AppData {
  meta: TerrainMeta;
  z: Float32Array;
  mask: Uint8Array;
  zones: Uint8Array | null;
  zonesMeta: ZonesMeta | null;
  osm: OsmData | null;
  buildings: Buildings | null;
  /** Escuelas del padrón oficial (si se cargó, reemplazan a las de OSM). */
  escuelas: EscuelasMen | null;
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
  const [meta, zBuf, mBuf, zonesBuf, zonesMeta, osm, bBuf, bMeta, escuelas, poblacion] = await Promise.all([
    json<TerrainMeta>(base + 'terrain.json'),
    bin(base + 'terrain.bin'),
    bin(base + 'masks.bin'),
    bin(base + 'zones.bin').catch(() => null),
    json<ZonesMeta>(base + 'zones.json'),
    json<OsmData>(base + 'osm.json'),
    bin(base + 'buildings.bin').catch(() => null),
    json<Buildings['meta']>(base + 'buildings.json'),
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
    escuelas,
    poblacion,
  };
}

/**
 * Escuelas: si está el padrón oficial del Mapa Educativo Nacional, reemplaza a las escuelas de OSM
 * (que pueden faltar o estar desactualizadas). Marca además qué queda dentro del anillo de defensa.
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
  // Lo que está del otro lado del río Paraguay (Alberdi, Paraguay) no es jurisdicción de Formosa: se quita.
  const river = osm.waterLines.filter((l) => l.kind === 'river' && /paraguay/i.test(l.name)).map((l) => l.c);
  facilities = facilities.filter((f) => f.source === 'Mapa Educativo Nacional' || !eastOfRiver(f.lon, f.lat, river));
  for (const f of facilities) f.inside = dentroDeDefensa([f.lon, f.lat]);
  const barrios = osm.barrios.filter((b) => !eastOfRiver(b.lon, b.lat, river));
  return { ...osm, facilities, barrios };
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
