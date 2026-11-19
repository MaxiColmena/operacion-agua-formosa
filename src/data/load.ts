// Carga de los datos precalculados en public/data.

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
  const [meta, zBuf, mBuf, zonesBuf, zonesMeta, osm, bBuf, bMeta] = await Promise.all([
    json<TerrainMeta>(base + 'terrain.json'),
    bin(base + 'terrain.bin'),
    bin(base + 'masks.bin'),
    bin(base + 'zones.bin').catch(() => null),
    json<ZonesMeta>(base + 'zones.json'),
    json<OsmData>(base + 'osm.json'),
    bin(base + 'buildings.bin').catch(() => null),
    json<Buildings['meta']>(base + 'buildings.json'),
  ]);
  if (!meta) throw new Error('Falta public/data/terrain.json: correr "npm run data"');
  return {
    meta,
    z: new Float32Array(zBuf),
    mask: new Uint8Array(mBuf),
    zones: zonesBuf ? new Uint8Array(zonesBuf) : null,
    zonesMeta,
    osm,
    buildings: bBuf ? decodeBuildings(bBuf, meta, bMeta) : null,
  };
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
