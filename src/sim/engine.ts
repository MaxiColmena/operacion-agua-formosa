// Motor de inundación 2D de "inercia local" (Bates, Horritt y Fewtrell, 2010 — base de LISFLOOD-FP).
// Corre igual en un Web Worker (navegador) y en Node (scripts de precálculo).
//
// Variables por celda: z (terreno, m s. n. m.), d (profundidad del agua, m).
// Caudales por unidad de ancho en las caras: qx (entre columnas), qy (entre filas), en m²/s.

export const G = 9.81;

export interface Grid {
  width: number;
  height: number;
  cellX: number; // m
  cellY: number; // m
  z: Float32Array; // cota del terreno
}

export interface Scenario {
  /** Intensidad de lluvia en mm/h. */
  rainMmH: number;
  /** Duración de la lluvia en horas. */
  rainHours: number;
  /** Altura del río Paraguay en la escala de Puerto Formosa (m). */
  riverStage: number;
  /** Capacidad de desagüe pluvial + infiltración en mm/h (supuesto declarado). */
  drainMmH: number;
  /** Si la defensa falla, se abre la brecha (MASK_BREACH) frente al puerto; el resto del anillo sigue en pie. */
  defenseFails: boolean;
}

export interface Assumptions {
  /** Cota IGN aproximada del cero de la escala de Puerto Formosa (m). SUPUESTO a reemplazar por el dato del INA. */
  gaugeZero: number;
  /** Cota del coronamiento de la defensa (m s. n. m.). SUPUESTO. */
  defenseCrest: number;
  /** Coeficiente de Manning (rugosidad). */
  manning: number;
  /** Profundidad a partir de la cual una celda se considera "afectada" (m). */
  wetThreshold: number;
  /** Con el río en alerta o más, el desagüe por gravedad se corta y queda solo el bombeo: factor del desagüe. */
  drainFactorHighRiver: number;
  /** Altura de alerta en Puerto Formosa (INA). */
  alertStage: number;
}

export const DEFAULT_ASSUMPTIONS: Assumptions = {
  gaugeZero: 47.3,
  defenseCrest: 59.0,
  manning: 0.045,
  wetThreshold: 0.15,
  drainFactorHighRiver: 0.4,
  alertStage: 7.8,
};

/** Máscaras estáticas que acompañan a la grilla. */
export interface Masks {
  /** 1 = celda del río Paraguay (borde de nivel fijo). */
  river: Uint8Array;
  /** 1 = celda sobre la línea de defensa. */
  defense: Uint8Array;
  /** 1 = cuerpo de agua permanente (laguna, riacho) que no cuenta como "afectado". */
  water: Uint8Array;
  /** 1 = celda de la brecha simulada (parte de la defensa que se rompe con `defenseFails`). */
  breach: Uint8Array;
}

export class FloodSim {
  readonly n: number;
  readonly d: Float32Array;
  readonly maxD: Float32Array;
  /** Tiempo (s) en que la celda superó el umbral por primera vez; -1 si nunca. */
  readonly tWet: Float32Array;
  private zEff: Float32Array;
  private qx: Float32Array;
  private qy: Float32Array;
  time = 0;
  rainVolume = 0; // m³ caídos
  drainVolume = 0; // m³ evacuados por desagüe/infiltración
  lastDt = 0;

  constructor(
    readonly grid: Grid,
    readonly masks: Masks,
    public scenario: Scenario,
    public assumptions: Assumptions = DEFAULT_ASSUMPTIONS,
  ) {
    const { width: w, height: h } = grid;
    this.n = w * h;
    this.d = new Float32Array(this.n);
    this.maxD = new Float32Array(this.n);
    this.tWet = new Float32Array(this.n).fill(-1);
    this.zEff = new Float32Array(this.n);
    this.qx = new Float32Array((w + 1) * h);
    this.qy = new Float32Array(w * (h + 1));
    this.reset();
  }

  get riverLevel() {
    return this.assumptions.gaugeZero + this.scenario.riverStage;
  }

  /** Cambiar río o defensa reinicia el estado; cambiar lluvia o desagüe no. */
  setScenario(s: Scenario) {
    const structural = s.defenseFails !== this.scenario.defenseFails || s.riverStage !== this.scenario.riverStage;
    this.scenario = s;
    if (structural) this.reset();
  }

  reset() {
    this.d.fill(0);
    this.maxD.fill(0);
    this.tWet.fill(-1);
    this.qx.fill(0);
    this.qy.fill(0);
    this.time = 0;
    this.rainVolume = 0;
    this.drainVolume = 0;
    this.buildEffectiveTerrain();
    this.applyRiverBoundary();
    this.fillFromRiver();
  }

  /** 1 = la celda arranca bajo agua porque está conectada al río por debajo de su nivel ("bañadera conectada"). */
  readonly byRiver: Uint8Array = new Uint8Array(0);

  /**
   * Estado inicial: toda celda conectada al río y por debajo de su nivel arranca con agua (equilibrio estático).
   * Así el escenario del río es un dato de partida y la lluvia es la parte dinámica.
   */
  private fillFromRiver() {
    const { width: w, height: h } = this.grid;
    const { river } = this.masks;
    const lvl = this.riverLevel;
    const z = this.zEff;
    const by = this.byRiver.length === this.n ? this.byRiver : ((this as { byRiver: Uint8Array }).byRiver = new Uint8Array(this.n));
    by.fill(0);
    const stack: number[] = [];
    for (let i = 0; i < this.n; i++) if (river[i]) { by[i] = 1; stack.push(i); }
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w, y = (i / w) | 0;
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
      for (const j of nb) {
        if (j < 0 || by[j] || z[j] >= lvl) continue;
        by[j] = 1;
        this.d[j] = lvl - z[j];
        this.maxD[j] = this.d[j];
        if (this.d[j] >= this.assumptions.wetThreshold && !this.masks.water[j]) this.tWet[j] = 0;
        stack.push(j);
      }
    }
  }

  /**
   * Terreno efectivo: el terreno con la defensa elevada a su coronamiento.
   * Con falla, solo las celdas de la brecha pierden el coronamiento y además se erosionan hasta el pie
   * del terraplén (la cota más baja del terreno natural a ~60 m a los costados): en el MDE la propia
   * traza puede tener 1–2 m de relleno que en una rotura real se lava.
   */
  private buildEffectiveTerrain() {
    const { z, width: w, height: h, cellX, cellY } = this.grid;
    const { defense, breach } = this.masks;
    const crest = this.assumptions.defenseCrest;
    const fails = this.scenario.defenseFails;
    const r = Math.max(1, Math.round(60 / Math.min(cellX, cellY)));
    for (let i = 0; i < this.n; i++) {
      if (!defense[i]) { this.zEff[i] = z[i]; continue; }
      if (!(fails && breach[i])) { this.zEff[i] = Math.max(z[i], crest); continue; }
      const x = i % w, y = (i / w) | 0;
      let floor = z[i];
      for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy++)
        for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx++) {
          const j = yy * w + xx;
          if (!defense[j] && z[j] < floor) floor = z[j];
        }
      this.zEff[i] = floor;
    }
  }

  get terrain() {
    return this.zEff;
  }

  private applyRiverBoundary() {
    const lvl = this.riverLevel;
    const { river } = this.masks;
    for (let i = 0; i < this.n; i++) {
      if (river[i]) this.d[i] = Math.max(0, lvl - this.zEff[i]);
    }
  }

  /** Avanza la simulación hasta `targetTime` (s) o hasta `maxSteps` pasos. Devuelve los pasos hechos. */
  advance(seconds: number, maxSteps = 100000): number {
    const end = this.time + seconds;
    let steps = 0;
    while (this.time < end - 1e-6 && steps < maxSteps) {
      const dt = Math.min(this.stableDt(), end - this.time);
      this.step(dt);
      steps++;
    }
    return steps;
  }

  private stableDt(): number {
    const { river } = this.masks;
    let hMax = 0.01;
    for (let i = 0; i < this.n; i++) if (!river[i] && this.d[i] > hMax) hMax = this.d[i];
    // Las caras río-tierra pueden tener más tirante: lo acotamos con la profundidad del río sobre la orilla.
    const dx = Math.min(this.grid.cellX, this.grid.cellY);
    const dt = (0.7 * dx) / Math.sqrt(G * Math.max(hMax, Math.min(this.edgeDepth(), 6)));
    return Math.min(dt, 30);
  }

  private edgeDepthCache = -1;
  private edgeDepth() {
    // Profundidad máxima que el río puede tener sobre una celda vecina de tierra (aprox.).
    if (this.edgeDepthCache >= 0 && this.edgeLvl === this.riverLevel) return this.edgeDepthCache;
    const { width: w, height: h } = this.grid;
    const { river } = this.masks;
    let m = 0.01;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (river[i]) continue;
        const near = (x > 0 && river[i - 1]) || (x < w - 1 && river[i + 1]) || (y > 0 && river[i - w]) || (y < h - 1 && river[i + w]);
        if (near) m = Math.max(m, this.riverLevel - this.zEff[i]);
      }
    this.edgeLvl = this.riverLevel;
    this.edgeDepthCache = m;
    return m;
  }
  private edgeLvl = NaN;

  step(dt: number) {
    const { width: w, height: h, cellX: dx, cellY: dy } = this.grid;
    const { river, water } = this.masks;
    const z = this.zEff;
    const d = this.d;
    const qx = this.qx;
    const qy = this.qy;
    const n2 = this.assumptions.manning ** 2;
    const s = this.scenario;
    const raining = this.time < s.rainHours * 3600;
    const rain = raining ? s.rainMmH / 1000 / 3600 : 0; // m/s
    const highRiver = s.riverStage >= this.assumptions.alertStage;
    const drain = (s.drainMmH / 1000 / 3600) * (highRiver ? this.assumptions.drainFactorHighRiver : 1);

    // 1) Caudales en caras verticales (entre x-1 y x).
    for (let y = 0; y < h; y++) {
      const row = y * w;
      const qrow = y * (w + 1);
      for (let x = 1; x < w; x++) {
        const i = row + x - 1, j = row + x;
        const k = qrow + x;
        const di = d[i], dj = d[j];
        if ((di === 0 && dj === 0) || (river[i] && river[j])) { qx[k] = 0; continue; }
        const etaI = z[i] + di, etaJ = z[j] + dj;
        const hf = Math.max(etaI, etaJ) - Math.max(z[i], z[j]);
        if (hf <= 1e-4) { qx[k] = 0; continue; }
        const q0 = qx[k];
        const slope = (etaJ - etaI) / dx;
        qx[k] = (q0 - G * hf * dt * slope) / (1 + (G * dt * n2 * Math.abs(q0)) / (hf * hf * Math.cbrt(hf)));
      }
    }
    // 2) Caudales en caras horizontales (entre y-1 e y).
    for (let y = 1; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y - 1) * w + x, j = y * w + x;
        const k = y * w + x;
        const di = d[i], dj = d[j];
        if ((di === 0 && dj === 0) || (river[i] && river[j])) { qy[k] = 0; continue; }
        const etaI = z[i] + di, etaJ = z[j] + dj;
        const hf = Math.max(etaI, etaJ) - Math.max(z[i], z[j]);
        if (hf <= 1e-4) { qy[k] = 0; continue; }
        const q0 = qy[k];
        const slope = (etaJ - etaI) / dy;
        qy[k] = (q0 - G * hf * dt * slope) / (1 + (G * dt * n2 * Math.abs(q0)) / (hf * hf * Math.cbrt(hf)));
      }
    }
    // 3) Limitador: ninguna celda puede entregar más agua de la que tiene.
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (river[i]) continue;
        const kL = y * (w + 1) + x, kR = kL + 1, kT = i, kB = i + w;
        const out =
          (Math.max(0, -qx[kL]) + Math.max(0, qx[kR])) * dy * dt +
          (Math.max(0, -qy[kT]) + Math.max(0, qy[kB])) * dx * dt;
        const avail = d[i] * dx * dy;
        if (out > avail && out > 0) {
          const f = avail / out;
          if (qx[kL] < 0) qx[kL] *= f;
          if (qx[kR] > 0) qx[kR] *= f;
          if (qy[kT] < 0) qy[kT] *= f;
          if (qy[kB] > 0) qy[kB] *= f;
        }
      }
    }
    // 4) Continuidad + lluvia + desagüe.
    const area = dx * dy;
    let rainV = 0, drainV = 0;
    const t1 = this.time + dt;
    const thr = this.assumptions.wetThreshold;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (river[i]) continue;
        const kL = y * (w + 1) + x;
        const dq = ((qx[kL] - qx[kL + 1]) / dx + (qy[i] - qy[i + w]) / dy) * dt;
        let di = d[i] + dq + rain * dt;
        rainV += rain * dt * area;
        if (!water[i] && di > 0) {
          const out = Math.min(di, drain * dt);
          di -= out;
          drainV += out * area;
        }
        di = di > 0 ? di : 0;
        d[i] = di;
        if (di > this.maxD[i]) this.maxD[i] = di;
        if (di >= thr && this.tWet[i] < 0 && !water[i]) this.tWet[i] = t1;
      }
    }
    this.rainVolume += rainV;
    this.drainVolume += drainV;
    this.applyRiverBoundary();
    this.time = t1;
    this.lastDt = dt;
  }

  /** Superficie (km²) de celdas con agua ≥ umbral, sin contar río ni cuerpos de agua permanentes. */
  floodedAreaKm2(): number {
    const { river, water } = this.masks;
    const thr = this.assumptions.wetThreshold;
    let c = 0;
    for (let i = 0; i < this.n; i++) if (!river[i] && !water[i] && this.d[i] >= thr) c++;
    return (c * this.grid.cellX * this.grid.cellY) / 1e6;
  }
}

/** Bits de la máscara combinada (public/data/masks.bin). MASK_BREACH: tramo de la defensa que se rompe. */
export const MASK_RIVER = 1, MASK_DEFENSE = 2, MASK_WATER = 4, MASK_BREACH = 8;

export function splitMasks(m: Uint8Array): Masks {
  const river = new Uint8Array(m.length), defense = new Uint8Array(m.length), water = new Uint8Array(m.length);
  const breach = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) {
    river[i] = m[i] & MASK_RIVER ? 1 : 0;
    defense[i] = m[i] & MASK_DEFENSE ? 1 : 0;
    water[i] = m[i] & MASK_WATER ? 1 : 0;
    breach[i] = m[i] & MASK_DEFENSE && m[i] & MASK_BREACH ? 1 : 0;
  }
  return { river, defense, water, breach };
}

/**
 * Remuestrea la grilla por un factor entero (2 = celdas de ~60 m) para la simulación en vivo.
 * Terreno: promedio. Río: mayoría. Defensa: cualquiera (no se pierden diques finos). Agua: mayoría.
 * Brecha: cualquiera. Con "cualquiera", una línea de defensa 4-conexa a 30 m sigue 4-conexa a 60 m
 * (dos celdas vecinas caen en el mismo bloque o en bloques vecinos), así que el anillo sigue cerrado.
 */
export function downsample(grid: Grid, mask: Uint8Array, f: number): { grid: Grid; mask: Uint8Array } {
  if (f <= 1) return { grid, mask };
  const w = Math.floor(grid.width / f), h = Math.floor(grid.height / f);
  const z = new Float32Array(w * h);
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let sum = 0, river = 0, water = 0, def = 0, breach = 0, zMaxDef = -Infinity;
      for (let dy = 0; dy < f; dy++)
        for (let dx = 0; dx < f; dx++) {
          const i = (y * f + dy) * grid.width + x * f + dx;
          sum += grid.z[i];
          if (mask[i] & MASK_RIVER) river++;
          if (mask[i] & MASK_WATER) water++;
          if (mask[i] & MASK_DEFENSE) { def++; zMaxDef = Math.max(zMaxDef, grid.z[i]); if (mask[i] & MASK_BREACH) breach++; }
        }
      const k = y * w + x;
      z[k] = sum / (f * f);
      if (def) { m[k] |= MASK_DEFENSE | (breach ? MASK_BREACH : 0); z[k] = Math.max(z[k], zMaxDef); }
      else if (river * 2 > f * f) m[k] |= MASK_RIVER;
      else if (water * 2 > f * f) m[k] |= MASK_WATER;
    }
  return { grid: { width: w, height: h, cellX: grid.cellX * f, cellY: grid.cellY * f, z }, mask: m };
}
