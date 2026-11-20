// Cruce de la simulación con la infraestructura y los barrios: qué se afecta, cuándo y en qué nivel.
import type { AppData, Facility } from './data/load';
import { lonLatToCell } from './data/load';
import { MASK_RIVER, MASK_WATER } from './sim/engine';
import type { FacilityStatus } from './scene/MapScene';
import { streetDepth } from './scene/MapScene';
import { STREET } from './sim/scenarios';
import { overflowElevation, overflowStage } from './sim/exposure';

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
  /** Altura del río (m, escala de Puerto Formosa) desde la que queda conectada al agua, con defensa sana. */
  riverStage: number;
  /** Lo mismo si falla la defensa. */
  riverStageFail: number;
}

/** Umbral de exposición al río de cada celda de la grilla completa (m de escala), con y sin defensa. */
export interface ExposureGrid {
  normal: Float32Array;
  fail: Float32Array;
}

export function computeExposure(data: AppData, gaugeZero: number, defenseCrest: number): ExposureGrid {
  const { width: w, height: h } = data.meta;
  return {
    normal: overflowStage(overflowElevation(w, h, data.z, data.mask, defenseCrest), gaugeZero),
    fail: overflowStage(overflowElevation(w, h, data.z, data.mask, null), gaugeZero),
  };
}

/** Mínimo del umbral en las celdas vecinas (radio en celdas de 30 m): el agua que llega "a la puerta". */
function stageAt(g: Float32Array, data: AppData, cx: number, cy: number, r: number) {
  const { width: w, height: h } = data.meta;
  let best = Infinity;
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      const x = Math.floor(cx) + dx, y = Math.floor(cy) + dy;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const i = y * w + x;
      if (data.mask[i] & (MASK_RIVER | MASK_WATER)) continue;
      if (g[i] < best) best = g[i];
    }
  return best;
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

export function prepareFacilities(data: AppData, sim: SimGridInfo, exposure: ExposureGrid | null = null): FacilityInfo[] {
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
    return {
      ...f, cells, tier: t.tier, tierByRiver: t.river,
      riverStage: exposure ? stageAt(exposure.normal, data, cx, cy, 1) : Infinity,
      riverStageFail: exposure ? stageAt(exposure.fail, data, cx, cy, 1) : Infinity,
    };
  });
}

/** Texto del umbral de exposición al río. */
export function fmtStage(s: number) {
  if (!Number.isFinite(s) || s > 30) return 'el río no la alcanza';
  if (s <= 0) return 'expuesta al río con cualquier nivel';
  return `expuesta al río desde ${s.toFixed(2).replace('.', ',')} m`;
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
    const status: FacilityStatus = dc >= thr ? 'afectado' : depth >= 0.1 ? 'atencion' : 'seco';
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

// ---------- calles ----------

/** Muestras cada ~15 m a lo largo de las calles de OSM, con su celda de simulación. */
export interface StreetSamples {
  cell: Int32Array;
  urban: Uint8Array;
  /** Índice del nombre de la calle en `names` (-1 = sin nombre). */
  name: Int32Array;
  paved: Uint8Array;
  /** Largo representado por cada muestra (m). */
  len: Float32Array;
  names: string[];
  totalKm: number;
}

export interface StreetLive {
  wetKm: number; // agua en la calzada (≥ 2 cm)
  curbKm: number; // agua sobre el cordón (≥ 10 cm)
  impassableKm: number; // intransitable (≥ 30 cm)
  dirtCurbKm: number; // calles de tierra con agua sobre el cordón
  top: { name: string; km: number; maxDepth: number }[];
}

export function prepareStreets(data: AppData, sim: SimGridInfo, urbanCell: Uint8Array): StreetSamples | null {
  if (!data.osm) return null;
  const STEP = 15; // m
  const mPerCellX = data.meta.cellX, mPerCellY = data.meta.cellY;
  const cell: number[] = [], urban: number[] = [], name: number[] = [], paved: number[] = [], len: number[] = [];
  const names: string[] = [];
  const nameIdx = new Map<string, number>();
  let total = 0;
  for (const r of data.osm.roads) {
    const n = r.n ?? '';
    let ni = -1;
    if (n) { ni = nameIdx.get(n) ?? -1; if (ni < 0) { ni = names.length; names.push(n); nameIdx.set(n, ni); } }
    for (let k = 1; k < r.c.length; k++) {
      const [ax, ay] = lonLatToCell(data.meta, r.c[k - 1][0], r.c[k - 1][1]);
      const [bx, by] = lonLatToCell(data.meta, r.c[k][0], r.c[k][1]);
      const segM = Math.hypot((bx - ax) * mPerCellX, (by - ay) * mPerCellY);
      const steps = Math.max(1, Math.round(segM / STEP));
      for (let t = 0; t < steps; t++) {
        const f = (t + 0.5) / steps;
        const sx = Math.floor((ax + (bx - ax) * f) / sim.factor), sy = Math.floor((ay + (by - ay) * f) / sim.factor);
        if (sx < 0 || sy < 0 || sx >= sim.width || sy >= sim.height) continue;
        const c = sy * sim.width + sx;
        if (sim.mask[c] & (MASK_RIVER | MASK_WATER)) continue; // puentes y costaneras sobre el agua
        cell.push(c); urban.push(urbanCell[c]); name.push(ni); paved.push(r.paved ? 1 : 0); len.push(segM / steps);
        total += segM / steps;
      }
    }
  }
  return {
    cell: Int32Array.from(cell), urban: Uint8Array.from(urban), name: Int32Array.from(name),
    paved: Uint8Array.from(paved), len: Float32Array.from(len), names, totalKm: total / 1000,
  };
}

export function evalStreets(st: StreetSamples, d: Float32Array): StreetLive {
  let wet = 0, curb = 0, imp = 0, dirt = 0;
  const byName = new Float64Array(st.names.length);
  const maxByName = new Float32Array(st.names.length);
  for (let i = 0; i < st.cell.length; i++) {
    const sd = streetDepth(d[st.cell[i]], st.urban[i]);
    if (sd < STREET.wet) continue;
    const l = st.len[i];
    wet += l;
    if (sd >= STREET.curb) {
      curb += l;
      if (!st.paved[i]) dirt += l;
      const ni = st.name[i];
      if (ni >= 0) { byName[ni] += l; if (sd > maxByName[ni]) maxByName[ni] = sd; }
    }
    if (sd >= STREET.impassable) imp += l;
  }
  const top = st.names
    .map((name, i) => ({ name, km: byName[i] / 1000, maxDepth: maxByName[i] }))
    .filter((t) => t.km > 0.03)
    .sort((a, b) => b.km - a.km)
    .slice(0, 40);
  return { wetKm: wet / 1000, curbKm: curb / 1000, impassableKm: imp / 1000, dirtCurbKm: dirt / 1000, top };
}
