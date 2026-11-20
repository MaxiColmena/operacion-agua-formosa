// Precalcula, para cada celda de la grilla completa (30 m), el "umbral de exposición": la altura del río
// Paraguay en la escala de Puerto Formosa (m) a partir de la cual la celda recibe ≥ wetThreshold de agua
// QUE VIENE DEL RÍO ("esta escuela se afecta con el río a 8,45 m").
//
// ALCANCE: es una estimación ESTÁTICA de "bañadera conectada", solo para el río. No hay lluvia, ni tiempo,
// ni caudales: se supone que el río sostiene su nivel el tiempo suficiente para llenar todo lo que está
// conectado a él por debajo de ese nivel. Es exactamente el estado inicial de FloodSim (fillFromRiver)
// para cada altura de río, sin la parte dinámica.
//
// MÉTODO: "priority-flood" (camino minimax / cota de desborde) desde todas las celdas del río sobre el
// terreno EFECTIVO (el mismo que usa FloodSim: effectiveTerrain de src/sim/engine.ts), 4-conexo como el
// modelo hidráulico. spill[i] = mínimo, sobre los caminos desde el río, de la cota máxima a lo largo del
// camino (incluida la propia celda). El agua llega a la celda cuando el río supera spill[i], y la celda
// queda con ≥ wetThreshold cuando el río supera z_eff[i] + wetThreshold:
//   umbral_i = max(spill[i], z_eff[i] + wetThreshold) − gaugeZero
// Dos variantes: defensa sana y defensa con brecha (defenseFails = true en FloodSim).
//
// Salida (contrato que consume la interfaz):
//   public/data/thresholds.bin: Uint16 little-endian, largo 2n (n = ancho × alto, filas norte→sur).
//     Primeros n = defensa sana, siguientes n = con brecha. Valor = umbral en cm de escala (redondeado
//     hacia arriba), en [0, 65534]; 65535 = no se alcanza con el río ≤ CAP_STAGE. Celdas de río = 0.
//   public/data/thresholds.json: metadatos.
import { readFileSync, writeFileSync } from 'node:fs';
import { effectiveTerrain, splitMasks, type Grid } from '../src/sim/engine';
import { ASSUMPTIONS } from '../src/sim/scenarios';
import { OUT_DIR } from './config';

const CAP_STAGE = 20; // m de escala
const NEVER = 65535;

const meta = JSON.parse(readFileSync(`${OUT_DIR}/terrain.json`, 'utf8'));
const z = new Float32Array(readFileSync(`${OUT_DIR}/terrain.bin`).buffer.slice(0));
const masks = splitMasks(new Uint8Array(readFileSync(`${OUT_DIR}/masks.bin`)));
const grid: Grid = { width: meta.width, height: meta.height, cellX: meta.cellX, cellY: meta.cellY, z };
const { width: w, height: h } = grid;
const n = w * h;
const { gaugeZero, defenseCrest, wetThreshold } = ASSUMPTIONS;

/** Cota de desborde desde el río (camino minimax, 4-conexo). Río = −∞. */
function spillFromRiver(zEff: Float32Array, river: Uint8Array, width: number, height: number): Float64Array {
  const N = width * height;
  const spill = new Float64Array(N).fill(Infinity);
  const done = new Uint8Array(N);
  // Montículo binario mínimo (clave = spill), con entradas repetidas y descarte perezoso.
  let heapK = new Float64Array(1024), heapI = new Int32Array(1024), size = 0;
  const push = (k: number, i: number) => {
    if (size === heapK.length) {
      const nk = new Float64Array(size * 2); nk.set(heapK); heapK = nk;
      const ni = new Int32Array(size * 2); ni.set(heapI); heapI = ni;
    }
    let p = size++;
    while (p > 0) {
      const q = (p - 1) >> 1;
      if (heapK[q] <= k) break;
      heapK[p] = heapK[q]; heapI[p] = heapI[q]; p = q;
    }
    heapK[p] = k; heapI[p] = i;
  };
  const pop = (): number => {
    const top = heapI[0];
    const k = heapK[--size], i = heapI[size];
    let p = 0;
    for (;;) {
      let c = 2 * p + 1;
      if (c >= size) break;
      if (c + 1 < size && heapK[c + 1] < heapK[c]) c++;
      if (heapK[c] >= k) break;
      heapK[p] = heapK[c]; heapI[p] = heapI[c]; p = c;
    }
    heapK[p] = k; heapI[p] = i;
    return top;
  };
  for (let i = 0; i < N; i++) if (river[i]) { spill[i] = -Infinity; push(-Infinity, i); }
  while (size) {
    const i = pop();
    if (done[i]) continue;
    done[i] = 1;
    const s = spill[i];
    const x = i % width, y = (i / width) | 0;
    for (let k = 0; k < 4; k++) {
      const j = k === 0 ? (x > 0 ? i - 1 : -1) : k === 1 ? (x < width - 1 ? i + 1 : -1) : k === 2 ? (y > 0 ? i - width : -1) : (y < height - 1 ? i + width : -1);
      if (j < 0 || done[j]) continue;
      const sj = Math.max(s, zEff[j]);
      if (sj < spill[j]) { spill[j] = sj; push(sj, j); }
    }
  }
  return spill;
}

const out = new Uint16Array(2 * n);
const variants = [false, true];
for (const [v, fails] of variants.entries()) {
  const zEff = effectiveTerrain(grid, masks, defenseCrest, fails);
  const spill = spillFromRiver(zEff, masks.river, w, h);
  const off = v * n;
  let reached = 0;
  for (let i = 0; i < n; i++) {
    if (masks.river[i]) { out[off + i] = 0; continue; }
    const stage = Math.max(spill[i], zEff[i] + wetThreshold) - gaugeZero;
    if (!(stage <= CAP_STAGE)) { out[off + i] = NEVER; continue; }
    reached++;
    out[off + i] = Math.min(65534, Math.max(0, Math.ceil(stage * 100 - 1e-6)));
  }
  console.log(fails ? 'brecha' : 'sana', `${reached} celdas alcanzadas con río ≤ ${CAP_STAGE} m`);
}

// Uint16Array usa el orden de bytes de la máquina; lo escribimos explícitamente little-endian.
const buf = Buffer.alloc(out.length * 2);
for (let i = 0; i < out.length; i++) buf.writeUInt16LE(out[i], i * 2);
writeFileSync(`${OUT_DIR}/thresholds.bin`, buf);
writeFileSync(`${OUT_DIR}/thresholds.json`, JSON.stringify({
  generated: new Date().toISOString(),
  gaugeZero,
  defenseCrest,
  wetThreshold,
  capStage: CAP_STAGE,
  variants: ['sana', 'brecha'],
  method: 'Bañadera conectada estática solo del río (sin lluvia ni tiempo): cota de desborde minimax 4-conexa desde el río sobre el terreno efectivo de FloodSim; umbral = max(desborde, terreno + umbral de mojado) − cero de escala.',
  units: 'cm de escala (Puerto Formosa)',
}, null, 2));
console.log(`escrito ${OUT_DIR}/thresholds.bin (${buf.length} bytes) y thresholds.json`);
