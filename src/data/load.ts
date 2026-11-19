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
  roads: { k: number; paved: boolean; c: number[][] }[];
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
  buildings: { h: number; c: number[][] }[];
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
  const [meta, zBuf, mBuf, zonesBuf, zonesMeta, osm, buildings] = await Promise.all([
    json<TerrainMeta>(base + 'terrain.json'),
    bin(base + 'terrain.bin'),
    bin(base + 'masks.bin'),
    bin(base + 'zones.bin').catch(() => null),
    json<ZonesMeta>(base + 'zones.json'),
    json<OsmData>(base + 'osm.json'),
    json<{ h: number; c: number[][] }[]>(base + 'buildings.json'),
  ]);
  if (!meta) throw new Error('Falta public/data/terrain.json: correr "npm run data"');
  return {
    meta,
    z: new Float32Array(zBuf),
    mask: new Uint8Array(mBuf),
    zones: zonesBuf ? new Uint8Array(zonesBuf) : null,
    zonesMeta,
    osm,
    buildings: buildings ?? [],
  };
}

/** lon/lat → coordenadas de celda (fraccionarias) de la grilla completa. */
export function lonLatToCell(meta: TerrainMeta, lon: number, lat: number): [number, number] {
  const { bounds: b, width: w, height: h } = meta;
  return [((lon - b.west) / (b.east - b.west)) * w, ((b.north - lat) / (b.north - b.south)) * h];
}
