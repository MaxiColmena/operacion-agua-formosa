// Cruce de la simulación con la infraestructura y los barrios: qué se afecta, cuándo y en qué nivel.
import type { AppData, Facility } from './data/load';
import { lonLatToCell } from './data/load';
import { MASK_RIVER, MASK_WATER } from './sim/engine';
import type { FacilityStatus } from './scene/MapScene';

export interface SimGridInfo {
  width: number;
  height: number;
  factor: number;
  mask: Uint8Array;
}

/** Nivel precalculado (1, 2, 3) o 0 si no se afecta ni en el escenario extremo. */
export type Tier = 0 | 1 | 2 | 3;

export interface FacilityInfo extends Facility {
  cells: number[]; // celdas de la grilla de simulación alrededor (radio ~60 m)
  tier: Tier;
  tierByRiver: boolean;
}

export interface BarrioInfo {
  name: string;
  lon: number;
  lat: number;
  cells: number[];
  tier: Tier;
  tierShare: [number, number, number];
}

export interface FacilityLive {
  status: FacilityStatus;
  depth: number;
  firstWet: number; // s, -1 si nunca
  byRiver: boolean;
}

export interface BarrioLive {
  share: number; // fracción con agua ≥ umbral
  firstAffected: number; // s en que superó el 5 % afectado; -1 si no
  status: FacilityStatus;
}

const AFFECTED_SHARE = 0.05;

function tierAt(data: AppData, cx: number, cy: number, r: number): { tier: Tier; river: boolean } {
  if (!data.zones) return { tier: 0, river: false };
  const { width: w, height: h } = data.meta;
  let best: Tier = 0, river = false;
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      const x = Math.floor(cx) + dx, y = Math.floor(cy) + dy;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const v = data.zones[y * w + x];
      const t = (v & 3) as Tier;
      if (t && (!best || t < best)) { best = t; river = !!(v & 4); }
    }
  return { tier: best, river };
}

export function prepareFacilities(data: AppData, sim: SimGridInfo): FacilityInfo[] {
  if (!data.osm) return [];
  return data.osm.facilities.map((f) => {
    const [cx, cy] = lonLatToCell(data.meta, f.lon, f.lat);
    const sx = Math.floor(cx / sim.factor), sy = Math.floor(cy / sim.factor);
    const cells: number[] = [];
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const x = sx + dx, y = sy + dy;
        if (x >= 0 && y >= 0 && x < sim.width && y < sim.height) cells.push(y * sim.width + x);
      }
    const t = tierAt(data, cx, cy, 1);
    return { ...f, cells, tier: t.tier, tierByRiver: t.river };
  });
}

/** Asigna cada celda al barrio (punto OSM) más cercano dentro de 1,2 km: aproximación tipo Voronoi. */
export function prepareBarrios(data: AppData, sim: SimGridInfo): BarrioInfo[] {
  if (!data.osm?.barrios.length) return [];
  const pts = data.osm.barrios.map((b) => {
    const [cx, cy] = lonLatToCell(data.meta, b.lon, b.lat);
    return { ...b, sx: cx / sim.factor, sy: cy / sim.factor, cells: [] as number[] };
  });
  const cellM = data.meta.cellX * sim.factor;
  const maxR2 = (1200 / cellM) ** 2;
  for (let y = 0; y < sim.height; y++)
    for (let x = 0; x < sim.width; x++) {
      const i = y * sim.width + x;
      if (sim.mask[i] & (MASK_RIVER | MASK_WATER)) continue;
      let best = -1, bd = maxR2;
      for (let k = 0; k < pts.length; k++) {
        const d = (pts[k].sx - x - 0.5) ** 2 + (pts[k].sy - y - 0.5) ** 2;
        if (d < bd) { bd = d; best = k; }
      }
      if (best >= 0) pts[best].cells.push(i);
    }
  return pts
    .filter((p) => p.cells.length > 10)
    .map((p) => {
      const share: [number, number, number] = [0, 0, 0];
      if (data.zones) {
        const w = data.meta.width, f = sim.factor;
        for (const i of p.cells) {
          const x = (i % sim.width) * f, y = Math.floor(i / sim.width) * f;
          let t = 0;
          for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) {
            const v = data.zones[(y + dy) * w + x + dx] & 3;
            if (v && (!t || v < t)) t = v;
          }
          if (t) share[t - 1]++;
        }
        for (let k = 0; k < 3; k++) share[k] /= p.cells.length;
      }
      let tier: Tier = 0, acc = 0;
      for (let k = 0; k < 3; k++) { acc += share[k]; if (!tier && acc >= AFFECTED_SHARE) tier = (k + 1) as Tier; }
      return { name: p.name, lon: p.lon, lat: p.lat, cells: p.cells, tier, tierShare: share };
    });
}

export function evalFacilities(fs: FacilityInfo[], d: Float32Array, tWet: Float32Array, byRiver: Uint8Array, thr: number): FacilityLive[] {
  return fs.map((f) => {
    let depth = 0, first = -1, river = false;
    // Celda central: profundidad; vecinas: alcanza con que estén mojadas para "atención".
    for (const c of f.cells) {
      if (d[c] > depth) depth = d[c];
      const t = byRiver[c] ? 0 : tWet[c];
      if (t >= 0 && (first < 0 || t < first)) { first = t; river = !!byRiver[c]; }
    }
    const center = f.cells[Math.floor(f.cells.length / 2)];
    const dc = d[center] ?? 0;
    const status: FacilityStatus = dc >= thr ? 'afectado' : depth >= 0.05 ? 'atencion' : 'seco';
    return { status, depth, firstWet: status === 'seco' ? -1 : first, byRiver: river };
  });
}

export function evalBarrios(bs: BarrioInfo[], tWet: Float32Array, byRiver: Uint8Array, d: Float32Array, thr: number): BarrioLive[] {
  return bs.map((b) => {
    const times: number[] = [];
    let wetNow = 0;
    for (const c of b.cells) {
      const t = byRiver[c] ? 0 : tWet[c];
      if (t >= 0) times.push(t);
      if (d[c] >= thr) wetNow++;
    }
    const k = Math.ceil(b.cells.length * AFFECTED_SHARE);
    let first = -1;
    if (times.length >= k) { times.sort((a, z) => a - z); first = times[k - 1]; }
    const share = wetNow / b.cells.length;
    return { share, firstAffected: first, status: share >= AFFECTED_SHARE ? 'afectado' : share > 0.01 ? 'atencion' : 'seco' };
  });
}

export function fmtTime(s: number) {
  if (s < 0) return '—';
  if (s === 0) return 't=0 (río)';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
}
