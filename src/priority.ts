// Prioridad de atención según la POBLACIÓN real (Censo 2022) y el ORDEN en que se afecta cada zona.
//
// Idea: una zona que se afecta primero pero donde viven pocas familias no pesa lo mismo que un barrio
// denso que también se afecta primero. La prioridad combina tres cosas, todas a la vista:
//   1. Cuánta gente vive ahí (Censo 2022, INDEC).
//   2. Qué tan pronto se afecta (zona 1º, 2º o 3º; o en la simulación, si el agua llegó antes o después).
//   3. Qué tan vulnerable es esa población (hogares con NBI, niños y mayores, gente sin cobertura de salud).
//
//   puntaje de una celda = personas × urgencia × índice de vulnerabilidad
//
// Es un criterio para ORDENAR la evaluación, declarado y editable. No decide nada: las decisiones son humanas.
// Sin dependencias de Three.js: se puede testear en Node.
import type { AppData } from './data/load';
import { lonLatToCell } from './data/load';

/** Indicadores del censo que se llevan a la grilla de la simulación. */
export const SOCIO_FIELDS = [
  'poblacion', 'viviendas', 'hogares', 'hogaresNbi', 'hogaresHacinamiento', 'hogaresSinAguaRed',
  'hogaresSinCloaca', 'menores14', 'mayores65', 'sinCobertura', 'viviendasPrecarias',
] as const;
export type SocioField = (typeof SOCIO_FIELDS)[number];
export type Profile = Record<SocioField, number>;

/** Urgencia según el nivel de referencia en que se afecta la zona (índice = nivel; 0 = no se afecta). SUPUESTO. */
export const URGENCY = [0, 3, 2, 1] as const;

/** Límites del índice de vulnerabilidad, para que un radio chico con un dato raro no domine la lista. */
export const IVS_MIN = 0.5, IVS_MAX = 2;

export interface SimGridShape {
  width: number;
  height: number;
  factor: number;
}

/** Censo en la grilla de la simulación (~60 m): conteos por celda e índice de vulnerabilidad. */
export interface CensusGrid {
  fields: Record<SocioField, Float32Array>;
  /** Índice de vulnerabilidad social de cada celda (1 = promedio de la ciudad). */
  ivs: Float32Array;
  /** Totales del área. */
  city: Profile;
  /** true si el archivo trae los indicadores sociodemográficos (no solo población). */
  hasSocio: boolean;
}

const emptyProfile = (): Profile => Object.fromEntries(SOCIO_FIELDS.map((f) => [f, 0])) as Profile;
const share = (a: number, b: number) => (b > 0 ? a / b : 0);

/** Proporciones que forman el índice: hogares con NBI, personas dependientes (≤14 y ≥65) y sin cobertura de salud. */
export function vulnerabilityShares(p: Profile) {
  return {
    nbi: share(p.hogaresNbi, p.hogares),
    dependientes: share(p.menores14 + p.mayores65, p.poblacion),
    sinCobertura: share(p.sinCobertura, p.poblacion),
  };
}

/**
 * Índice de vulnerabilidad social (IVS): promedio de las tres proporciones, cada una dividida por la de toda la
 * ciudad. 1 = como el promedio de Formosa Capital; 2 = el doble de vulnerable. Acotado entre IVS_MIN e IVS_MAX.
 */
export function vulnerabilityIndex(p: Profile, city: Profile) {
  const s = vulnerabilityShares(p), c = vulnerabilityShares(city);
  if (p.poblacion <= 0) return 1;
  const parts = [share(s.nbi, c.nbi), share(s.dependientes, c.dependientes), share(s.sinCobertura, c.sinCobertura)];
  const v = parts.reduce((a, b) => a + b, 0) / parts.length;
  return Math.min(IVS_MAX, Math.max(IVS_MIN, v));
}

/** Lleva el censo (grilla de ~87 m) a la grilla de la simulación, repartiendo cada celda en 3×3 muestras. */
export function censusToSim(data: AppData, sim: SimGridShape): CensusGrid | null {
  const p = data.poblacion;
  if (!p) return null;
  const n = sim.width * sim.height;
  const fields = Object.fromEntries(SOCIO_FIELDS.map((f) => [f, new Float32Array(n)])) as Record<SocioField, Float32Array>;
  const src = SOCIO_FIELDS.map((f) => (p as unknown as Record<string, number[] | undefined>)[f] ?? null);
  const hasSocio = !!p.hogaresNbi && !!p.menores14;
  const { area: a, columnas: nx, filas: ny } = p;
  const dLon = (a.este - a.oeste) / nx, dLat = (a.norte - a.sur) / ny;
  const S = 3, w = 1 / (S * S);
  const city = emptyProfile();
  for (let y = 0; y < ny; y++)
    for (let x = 0; x < nx; x++) {
      const k = y * nx + x;
      if (!p.poblacion[k] && !p.viviendas[k]) continue;
      for (let sy = 0; sy < S; sy++)
        for (let sx = 0; sx < S; sx++) {
          const lon = a.oeste + (x + (sx + 0.5) / S) * dLon;
          const lat = a.sur + (y + (sy + 0.5) / S) * dLat; // fila 0 = sur
          const [cx, cy] = lonLatToCell(data.meta, lon, lat);
          const ix = Math.floor(cx / sim.factor), iy = Math.floor(cy / sim.factor);
          if (ix < 0 || iy < 0 || ix >= sim.width || iy >= sim.height) continue;
          const c = iy * sim.width + ix;
          SOCIO_FIELDS.forEach((f, j) => {
            const v = src[j]?.[k];
            if (v) { fields[f][c] += v * w; city[f] += v * w; }
          });
        }
    }
  const ivs = new Float32Array(n).fill(1);
  if (hasSocio) {
    const cell = emptyProfile();
    for (let c = 0; c < n; c++) {
      if (!fields.poblacion[c]) continue;
      for (const f of SOCIO_FIELDS) cell[f] = fields[f][c];
      ivs[c] = vulnerabilityIndex(cell, city);
    }
  }
  return { fields, ivs, city, hasSocio };
}

/** Nivel 1º/2º/3º de cada celda de la simulación (el más temprano de las celdas de 30 m que contiene). */
export function simTiers(data: AppData, sim: SimGridShape): Uint8Array {
  const out = new Uint8Array(sim.width * sim.height);
  if (!data.zones) return out;
  const w = data.meta.width, f = sim.factor;
  for (let y = 0; y < sim.height; y++)
    for (let x = 0; x < sim.width; x++) {
      let t = 0;
      for (let dy = 0; dy < f; dy++)
        for (let dx = 0; dx < f; dx++) {
          const v = data.zones[(y * f + dy) * w + x * f + dx] & 3;
          if (v && (!t || v < t)) t = v;
        }
      out[y * sim.width + x] = t;
    }
  return out;
}

/** Puntaje de prioridad de cada celda para el plan (zonas 1º/2º/3º): personas × urgencia × IVS. */
export function priorityCells(cg: CensusGrid, tiers: Uint8Array): Float32Array {
  const out = new Float32Array(tiers.length);
  for (let c = 0; c < out.length; c++) {
    const t = tiers[c];
    if (t) out[c] = cg.fields.poblacion[c] * URGENCY[t] * cg.ivs[c];
  }
  return out;
}

/** Urgencia en la simulación en curso: el agua que llegó en el primer tercio del tiempo pesa 3; la del último, 1. */
export function liveUrgency(tWet: number, byRiver: boolean, elapsed: number) {
  if (byRiver || tWet <= 0) return 3;
  const f = tWet / Math.max(elapsed, 1);
  return f <= 1 / 3 ? 3 : f <= 2 / 3 ? 2 : 1;
}

export interface ZonePriority {
  /** Puntaje del plan (zonas 1º/2º/3º). */
  score: number;
  /** Personas en zona 1º, 2º y 3º. */
  peopleByTier: [number, number, number];
  /** Perfil del censo de toda la zona (conteos). */
  profile: Profile;
  ivs: number;
}

/** Prioridad del plan para cada grupo de celdas (por ejemplo, cada barrio). */
export function groupPriority(groups: number[][], cg: CensusGrid, tiers: Uint8Array, cellScore: Float32Array): ZonePriority[] {
  return groups.map((cells) => {
    const profile = emptyProfile();
    const byTier: [number, number, number] = [0, 0, 0];
    let score = 0;
    for (const c of cells) {
      for (const f of SOCIO_FIELDS) profile[f] += cg.fields[f][c];
      const t = tiers[c];
      if (t) byTier[t - 1] += cg.fields.poblacion[c];
      score += cellScore[c];
    }
    return { score, peopleByTier: byTier, profile, ivs: cg.hasSocio ? vulnerabilityIndex(profile, cg.city) : 1 };
  });
}

export interface ZoneLive {
  /** Personas en celdas con agua ≥ umbral ahora. */
  people: number;
  /** Hogares (familias, Censo 2022) en celdas con agua ≥ umbral ahora. */
  homes: number;
  /** Niños de hasta 14 años y personas de 65 o más en celdas con agua ≥ umbral ahora. */
  children: number;
  elders: number;
  /** Puntaje del escenario en curso: personas con agua × urgencia por llegada × IVS. */
  score: number;
}

export function groupLive(
  groups: number[][], cg: CensusGrid, d: Float32Array, tWet: Float32Array, byRiver: Uint8Array, thr: number, elapsed: number,
): ZoneLive[] {
  return groups.map((cells) => {
    let people = 0, homes = 0, children = 0, elders = 0, score = 0;
    for (const c of cells) {
      if (d[c] < thr) continue;
      const pop = cg.fields.poblacion[c];
      if (!pop) continue;
      people += pop;
      homes += cg.fields.hogares[c];
      children += cg.fields.menores14[c];
      elders += cg.fields.mayores65[c];
      score += pop * liveUrgency(tWet[c], !!byRiver[c], elapsed) * cg.ivs[c];
    }
    return { people, homes, children, elders, score };
  });
}

/** Totales del censo en celdas con agua ≥ umbral (toda el área, no solo barrios). */
export function exposedProfile(cg: CensusGrid, d: Float32Array, thr: number): Profile {
  const p = emptyProfile();
  for (let c = 0; c < d.length; c++) {
    if (d[c] < thr || !cg.fields.poblacion[c]) continue;
    for (const f of SOCIO_FIELDS) p[f] += cg.fields[f][c];
  }
  return p;
}

/** Normaliza un mapa de puntajes a 0–1 (percentil 97 de las celdas con valor = 1), para el mapa de calor. */
export function heatValues(score: Float32Array): Float32Array {
  const vals = Array.from(score).filter((v) => v > 0).sort((a, b) => a - b);
  const ref = vals.length ? vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.97))] : 1;
  const out = new Float32Array(score.length);
  for (let i = 0; i < out.length; i++) out[i] = score[i] > 0 ? Math.min(1, score[i] / ref) : 0;
  return out;
}

/** Redondeo para no aparentar precisión: decenas debajo de 100, centenas arriba. */
export function roughCount(n: number) {
  return n < 100 ? Math.round(n / 10) * 10 : Math.round(n / 100) * 100;
}

export const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)} %` : '—');
