// Traza los CONECTORES ESTIMADOS del anillo de defensa por el borde de la zona edificada.
// En OpenStreetMap solo hay 5 tramos reales del terraplén. Antes se unían con rectas, que cruzaban barrios.
// Ahora cada conector es el camino de menor costo sobre la grilla de 30 m, donde:
//   - pasar por manzanas edificadas cuesta mucho (densidad de edificios en ~60 m a la redonda),
//   - el río, los riachos y las lagunas no se pueden cruzar,
// así que el conector bordea la ciudad por el lado del bañado o del riacho, como un terraplén real.
// Salida: src/sim/defensa-rutas.ts (generado). Correr antes de `npm run data:masks`.
import { readFileSync, writeFileSync } from 'node:fs';
import { OUT_DIR } from './config';
import { TRAMOS, type LonLat } from '../src/sim/defensa-tramos';

const meta = JSON.parse(readFileSync(`${OUT_DIR}/terrain.json`, 'utf8'));
const masks = new Uint8Array(readFileSync(`${OUT_DIR}/masks.bin`));
const { width: W, height: H, bounds: B, cellX: CX } = meta;
const N = W * H;
const toCell = (p: LonLat) => {
  const x = Math.floor(((p[0] - B.west) / (B.east - B.west)) * W), y = Math.floor(((B.north - p[1]) / (B.north - B.south)) * H);
  return y * W + x;
};
const toLonLat = (i: number): LonLat => {
  const x = i % W, y = (i / W) | 0;
  return [+(B.west + ((x + 0.5) / W) * (B.east - B.west)).toFixed(5), +(B.north - ((y + 0.5) / H) * (B.north - B.south)).toFixed(5)];
};

// --- Edificios por celda (centroides de buildings.bin).
const bld = new Uint8Array(N);
{
  const buf = readFileSync(`${OUT_DIR}/buildings.bin`);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const count = dv.getUint32(0, true);
  let o = 4;
  for (let b = 0; b < count; b++) {
    const n = dv.getUint8(o); o += 2;
    let sx = 0, sy = 0;
    for (let j = 0; j < n; j++) { sx += dv.getUint16(o, true) / 65535; sy += dv.getUint16(o + 2, true) / 65535; o += 4; }
    const x = Math.floor((sx / n) * W), y = Math.floor((sy / n) * H);
    if (x >= 0 && y >= 0 && x < W && y < H) bld[y * W + x] = 1;
  }
}
// Densidad suavizada: fracción de celdas con edificios en un radio de 2 celdas (~60 m), para que el
// camino no se cuele por las calles entre manzanas.
const R = 2;
const dens = new Float32Array(N);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  let c = 0, t = 0;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const xx = x + dx, yy = y + dy;
    if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
    t++; c += bld[yy * W + xx];
  }
  dens[y * W + x] = c / t;
}
// Río Paraguay y bañados conectados (bit 1) y riachos, canales y lagunas (bit 4): se pueden cruzar
// (un terraplén cruza un canal con una compuerta y apoya en la orilla) pero cuesta mucho, así que se evitan.
const WATER_COST = 300, RIVER_COST = 600;
/**
 * Costo por celda. «estricto»: cualquier edificio pesa (bordea toda la mancha urbana).
 * «suave»: solo pesan las manzanas consolidadas (densidad > 25 %), el periurbano disperso se cruza.
 */
function buildCost(mode: 'estricto' | 'suave'): Float32Array {
  const c = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    c[i] = mode === 'estricto' ? 1 + 80 * dens[i] : 1 + (60 * Math.max(0, dens[i] - 0.25)) / 0.75;
    if (masks[i] & 1) c[i] += RIVER_COST;
    else if (masks[i] & 4) c[i] += WATER_COST;
  }
  return c;
}
const COSTS = { estricto: buildCost('estricto'), suave: buildCost('suave') };
let cost = COSTS.estricto;
const blocked = new Uint8Array(N);
/** Los extremos se apoyan en el agua (el terraplén llega a la orilla): se liberan unas celdas alrededor. */
function freeAround(i: number) {
  const x = i % W, y = (i / W) | 0;
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    const xx = x + dx, yy = y + dy;
    if (xx >= 0 && yy >= 0 && xx < W && yy < H) blocked[yy * W + xx] = 0;
  }
}

/** Dijkstra 4-vecinos (con heap binario) entre dos celdas. */
function route(a: number, b: number): number[] {
  const dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1);
  const heap: [number, number][] = [];
  const push = (d: number, i: number) => {
    heap.push([d, i]);
    let k = heap.length - 1;
    while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]]; k = m;
      }
    }
    return top;
  };
  dist[a] = 0; push(0, a);
  while (heap.length) {
    const [d, i] = pop();
    if (d > dist[i]) continue;
    if (i === b) break;
    const x = i % W, y = (i / W) | 0;
    for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
      // Los extremos pueden estar pegados al agua (el terraplén apoya en el riacho): se permiten.
      if (j < 0 || blocked[j]) continue;
      const nd = d + (cost[i] + cost[j]) / 2;
      if (nd < dist[j]) { dist[j] = nd; prev[j] = i; push(nd, j); }
    }
  }
  if (prev[b] < 0) { let r = 0; for (let k = 0; k < N; k++) if (dist[k] < Infinity) r++; throw new Error(`sin camino: ${r} celdas alcanzables desde el inicio`); }
  const path: number[] = [];
  for (let i = b; i >= 0; i = prev[i]) path.push(i);
  return path.reverse();
}

/** Simplificación de Douglas-Peucker en metros (tolerancia ~ media celda: el rasterizado queda igual). */
function simplify(pts: LonLat[], tol: number): LonLat[] {
  const kx = 111320 * Math.cos((26.18 * Math.PI) / 180), ky = 110574;
  const d = (p: LonLat, a: LonLat, b: LonLat) => {
    const ax = a[0] * kx, ay = a[1] * ky, bx = b[0] * kx, by = b[1] * ky, px = p[0] * kx, py = p[1] * ky;
    const L = Math.hypot(bx - ax, by - ay) || 1;
    return Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / L;
  };
  if (pts.length < 3) return pts;
  let idx = 0, max = 0;
  for (let i = 1; i < pts.length - 1; i++) { const v = d(pts[i], pts[0], pts[pts.length - 1]); if (v > max) { max = v; idx = i; } }
  if (max <= tol) return [pts[0], pts[pts.length - 1]];
  return [...simplify(pts.slice(0, idx + 1), tol).slice(0, -1), ...simplify(pts.slice(idx), tol)];
}

const names = ['oeste', 'norte', 'este', 'sureste', 'suroeste'] as const;
const out: Record<string, LonLat[]> = {};
const order = TRAMOS; // [liborsi, noreste, lote4, sur] en el orden del anillo
/**
 * Punto de paso estimado: donde el riacho Formosa dobla hacia el norte, al noroeste de la ciudad.
 * El conector oeste sube desde Liborsi hasta acá y el norte sigue el riacho hasta el tramo noreste de OSM.
 */
const PASO_NO: LonLat = [-58.2165, -26.1505];
const pairs: [LonLat, LonLat][] = [
  [order.liborsi[order.liborsi.length - 1], PASO_NO],
  [PASO_NO, order.noreste[0]],
  [order.noreste[order.noreste.length - 1], order.lote4[0]],
  [order.lote4[order.lote4.length - 1], order.sur[0]],
  [order.sur[order.sur.length - 1], order.liborsi[0]],
];
let km = 0;
/**
 * Ajustes por conector. Oeste: suave y sin ir al oeste de -58,232 (si no, rodea todo el periurbano oeste).
 * Norte: estricto, sigue el riacho Formosa. Suroeste: suave, pasa al norte de Laguna Siam.
 */
const OPTS: { mode: 'estricto' | 'suave'; minLon?: number }[] = [
  { mode: 'suave', minLon: -58.232 }, { mode: 'estricto' }, { mode: 'estricto' }, { mode: 'estricto' }, { mode: 'suave' },
];
pairs.forEach(([a, b], k) => {
  const o = OPTS[k];
  cost = COSTS[o.mode];
  blocked.fill(0);
  if (o.minLon != null) {
    const xMin = Math.floor(((o.minLon - B.west) / (B.east - B.west)) * W);
    for (let y = 0; y < H; y++) for (let x = 0; x < xMin; x++) blocked[y * W + x] = 1;
  }
  freeAround(toCell(a)); freeAround(toCell(b));
  const path = route(toCell(a), toCell(b));
  const pts = simplify(path.map(toLonLat), CX * 0.4);
  // Sin los extremos que son de los tramos de OSM; el punto de paso queda en el conector oeste.
  out[names[k]] = k === 0 ? pts.slice(1) : pts.slice(1, -1);
  const len = (path.length * CX) / 1000;
  km += len;
  console.log(`conector ${names[k]}: ${path.length} celdas (~${len.toFixed(1)} km), ${pts.length} vértices`);
});
console.log(`conectores: ~${km.toFixed(1)} km`);

const body = names.map((k) => `  ${k}: [\n${out[k].map((p) => `    [${p[0]}, ${p[1]}],`).join('\n')}\n  ],`).join('\n');
writeFileSync('src/sim/defensa-rutas.ts', `// GENERADO por scripts/route-defensa.ts — no editar a mano.
// Conectores estimados del anillo de defensa: camino de menor costo por el borde de la zona edificada
// (sin cruzar manzanas, río, riachos ni lagunas) entre los tramos reales de OpenStreetMap.
import type { LonLat } from './defensa-tramos';

export const CONECTORES: Record<'oeste' | 'norte' | 'este' | 'sureste' | 'suroeste', LonLat[]> = {
${body}
};
`);
