// Tests del motor de agua sobre grillas chicas (sin datos reales).
import { describe, expect, it } from 'vitest';
import { FloodSim, MASK_BREACH, MASK_DEFENSE, MASK_RIVER, downsample, splitMasks, type Assumptions, type Scenario } from '../src/sim/engine';

const ASSUME: Assumptions = {
  gaugeZero: 0, defenseCrest: 8, manning: 0.045, wetThreshold: 0.15, drainFactorHighRiver: 0.4, alertStage: 7.8, drainNoNetwork: 0.5,
};
const DRY: Scenario = { rainMmH: 0, rainHours: 0, riverStage: 0, drainMmH: 0, defenseFails: false };

/** Fila de 5 celdas: río | 3 | defensa con brecha (cota 1, coronamiento 8) | 2 | 4. */
function rowWithDefense() {
  const z = new Float32Array([0, 3, 1, 2, 4]);
  const mask = new Uint8Array([MASK_RIVER, 0, MASK_DEFENSE | MASK_BREACH, 0, 0]);
  return { grid: { width: 5, height: 1, cellX: 30, cellY: 30, z }, mask };
}

describe('motor de inercia local', () => {
  it('estado inicial «bañadera conectada»: el río llena lo conectado y por debajo de su nivel', () => {
    const g = rowWithDefense();
    const sim = new FloodSim(g.grid, splitMasks(g.mask), { ...DRY, riverStage: 5 }, ASSUME);
    expect(sim.d[1]).toBeCloseTo(2, 5); // 5 − 3
    expect(sim.byRiver[1]).toBe(1);
    expect(sim.d[3]).toBe(0); // protegida por la defensa
    expect(sim.byRiver[3]).toBe(0);
  });

  it('si la defensa se rompe en la brecha, el agua del río entra detrás', () => {
    const g = rowWithDefense();
    const sim = new FloodSim(g.grid, splitMasks(g.mask), { ...DRY, riverStage: 5, defenseFails: true }, ASSUME);
    expect(sim.d[3]).toBeCloseTo(3, 5); // 5 − 2
    expect(sim.d[4]).toBeCloseTo(1, 5); // 5 − 4
  });

  it('conserva la masa: sin río ni desagüe, el agua en la grilla es igual a la lluvia caída', () => {
    const w = 12, h = 10;
    const z = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) z[y * w + x] = 50 + Math.hypot(x - 6, y - 5) * 0.3;
    const sim = new FloodSim({ width: w, height: h, cellX: 30, cellY: 30, z }, splitMasks(new Uint8Array(w * h)),
      { rainMmH: 60, rainHours: 1, riverStage: 0, drainMmH: 0, defenseFails: false }, ASSUME);
    sim.advance(2 * 3600);
    const stored = sim.d.reduce((a, v) => a + v, 0) * 30 * 30;
    // 60 mm/h durante 1 h exacta: la lluvia no sigue cayendo después de que termina la tormenta.
    expect(sim.rainVolume).toBeCloseTo(w * h * 30 * 30 * 0.06, 0);
    expect(stored / sim.rainVolume).toBeCloseTo(1, 4);
    // El agua escurre hacia el bajo del centro.
    expect(sim.d[5 * w + 6]).toBeGreaterThan(sim.d[0]);
  });

  it('el desagüe se reduce con el río en alerta (solo bombeo)', () => {
    const run = (riverStage: number) => {
      const z = new Float32Array(16).fill(100);
      const sim = new FloodSim({ width: 4, height: 4, cellX: 30, cellY: 30, z }, splitMasks(new Uint8Array(16)),
        { rainMmH: 50, rainHours: 1, riverStage, drainMmH: 20, defenseFails: false }, ASSUME);
      sim.advance(3600);
      return sim.drainVolume;
    };
    expect(run(8) / run(4)).toBeCloseTo(ASSUME.drainFactorHighRiver, 2);
  });

  it('al remuestrear no se pierden diques finos', () => {
    const z = new Float32Array([1, 1, 1, 1, 1, 9, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    const mask = new Uint8Array(16); mask[5] = MASK_DEFENSE;
    const ds = downsample({ width: 4, height: 4, cellX: 30, cellY: 30, z }, mask, 2);
    expect(ds.mask[0] & MASK_DEFENSE).toBeTruthy();
    expect(ds.grid.z[0]).toBe(9);
  });
});

describe('tipo de calzada (OpenStreetMap)', async () => {
  const { surfaceClass } = await import('../src/data/surface');
  it('separa pavimentada, tierra y sin dato', () => {
    for (const t of ['paved', 'asphalt', 'concrete', 'paving_stones', 'sett']) expect(surfaceClass(t)).toBe('p');
    for (const t of ['unpaved', 'dirt', 'ground', 'mud', 'arena', 'sand', 'gravel', 'compacted']) expect(surfaceClass(t)).toBe('t');
    // Sin etiqueta: NO se cuenta como asfaltada (antes sí).
    expect(surfaceClass(undefined)).toBe('?');
    expect(surfaceClass('')).toBe('?');
  });
});
