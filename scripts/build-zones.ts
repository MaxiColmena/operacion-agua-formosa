// Precalcula a resolución completa (30 m) las zonas que se afectan en 1er, 2do y 3er lugar.
// Zona k = celdas que superan el umbral en el escenario de nivel k y no en los anteriores.
// Salida: public/data/zones.bin (Uint8: 0 = no afectada, 1..3 = nivel) y zones.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { FloodSim, splitMasks } from '../src/sim/engine';
import { ASSUMPTIONS, LEVELS } from '../src/sim/scenarios';
import { encodePng } from './png';
import { OUT_DIR } from './config';

const meta = JSON.parse(readFileSync(`${OUT_DIR}/terrain.json`, 'utf8'));
const z = new Float32Array(readFileSync(`${OUT_DIR}/terrain.bin`).buffer.slice(0));
const maskAll = new Uint8Array(readFileSync(`${OUT_DIR}/masks.bin`));
const masks = splitMasks(maskAll);
const grid = { width: meta.width, height: meta.height, cellX: meta.cellX, cellY: meta.cellY, z };
const n = grid.width * grid.height;

const zones = new Uint8Array(n);
const byRiver = new Uint8Array(n); // 1 = afectada por el río (bañadera conectada) en ese nivel
const stats: Record<string, unknown>[] = [];
for (const [k, sc] of LEVELS.entries()) {
  const t0 = Date.now();
  const sim = new FloodSim(grid, masks, sc, ASSUMPTIONS);
  sim.advance((sc.rainHours + sc.afterHours) * 3600);
  let cells = 0;
  for (let i = 0; i < n; i++) {
    if (masks.river[i] || masks.water[i]) continue;
    if (sim.maxD[i] >= ASSUMPTIONS.wetThreshold) {
      cells++;
      if (!zones[i]) { zones[i] = k + 1; if (sim.byRiver[i]) byRiver[i] = 1; }
    }
  }
  const km2 = (cells * grid.cellX * grid.cellY) / 1e6;
  stats.push({ id: sc.id, km2: +km2.toFixed(2), seconds: Math.round((Date.now() - t0) / 1000) });
  console.log(sc.id, `${km2.toFixed(2)} km² afectados`, `${Math.round((Date.now() - t0) / 1000)} s`);
}

// Filtro de ruido: se descartan manchas aisladas de menos de MIN_CELLS celdas (~0,5 ha),
// que suelen ser pozos del modelo de superficie y no zonas de anegamiento reales.
const MIN_CELLS = 6;
{
  const { width: w, height: h } = grid;
  const seen = new Uint8Array(n);
  let removed = 0;
  for (let s = 0; s < n; s++) {
    if (!zones[s] || seen[s]) continue;
    const comp: number[] = [s]; seen[s] = 1;
    for (let k = 0; k < comp.length; k++) {
      const i = comp[k], x = i % w, y = (i / w) | 0;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (j >= 0 && zones[j] && !seen[j]) { seen[j] = 1; comp.push(j); }
      }
    }
    if (comp.length < MIN_CELLS) { for (const i of comp) { zones[i] = 0; byRiver[i] = 0; } removed += comp.length; }
  }
  console.log(`filtro de ruido: ${removed} celdas sueltas descartadas`);
}

// Bit 4 = afectada por el río en lugar de por la lluvia.
const out = new Uint8Array(n);
for (let i = 0; i < n; i++) out[i] = zones[i] | (byRiver[i] ? 4 : 0);
writeFileSync(`${OUT_DIR}/zones.bin`, out);
writeFileSync(`${OUT_DIR}/zones.json`, JSON.stringify({
  generated: new Date().toISOString(), resolution: '30 m', threshold: ASSUMPTIONS.wetThreshold,
  levels: LEVELS.map((l) => ({ id: l.id, short: l.short, label: l.label, why: l.why })), stats,
}, null, 2));

// Vista previa para revisar.
if (process.argv[2]) {
  const rgba = new Uint8Array(n * 4);
  const colors = [[20, 24, 32], [255, 60, 60], [255, 160, 40], [255, 230, 80]];
  for (let i = 0; i < n; i++) {
    const c = masks.river[i] ? [30, 80, 200] : colors[zones[i]];
    const shade = 0.6 + 0.4 * Math.min(1, Math.max(0, (z[i] - 49) / 13));
    rgba.set([c[0] * (zones[i] ? 1 : shade * 3), c[1] * (zones[i] ? 1 : shade * 3), c[2] * (zones[i] ? 1 : shade * 3), 255], i * 4);
  }
  writeFileSync(process.argv[2], encodePng(grid.width, grid.height, rgba));
}
