// Construye las máscaras de la grilla: río Paraguay (borde de nivel fijo), línea de defensa y cuerpos de agua.
// Salida: public/data/masks.bin (Uint8, bits: 1 = río, 2 = defensa, 4 = agua permanente, 8 = brecha).
// Defensa: anillo cerrado reconstruido por M. Colman (src/sim/defensa.ts) + líneas 'defensa' de OSM.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { OUT_DIR } from './config';
import { BRECHA, DEFENSA_ANILLO, LARGO_BRECHA_M, distanciaM, longitudKm, type LonLat } from '../src/sim/defensa';
import { ASSUMPTIONS } from '../src/sim/scenarios';
import { downsample } from '../src/sim/engine';

const meta = JSON.parse(readFileSync(`${OUT_DIR}/terrain.json`, 'utf8'));
const z = new Float32Array(readFileSync(`${OUT_DIR}/terrain.bin`).buffer.slice(0));
const { width: w, height: h, bounds } = meta;
const n = w * h;
const RIVER = 1, DEFENSE = 2, WATER = 4, BREACH = 8, RIVER_CANDIDATE = 64; // 64: bit temporal, se limpia al final
const mask = new Uint8Array(n);

const toCell = (lon: number, lat: number): [number, number] => [
  ((lon - bounds.west) / (bounds.east - bounds.west)) * w,
  ((bounds.north - lat) / (bounds.north - bounds.south)) * h,
];

// --- Río: celdas muy bajas (superficie de agua en el MDE) conectadas, componente más grande.
const RIVER_MAX_Z = 50.4;
const comp = new Int32Array(n).fill(-1);
const sizes: number[] = [];
for (let s = 0; s < n; s++) {
  if (comp[s] >= 0 || z[s] > RIVER_MAX_Z) continue;
  const id = sizes.length; let size = 0; const stack = [s]; comp[s] = id;
  while (stack.length) {
    const i = stack.pop()!; size++;
    const x = i % w, y = (i / w) | 0;
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
      if (j >= 0 && comp[j] < 0 && z[j] <= RIVER_MAX_Z) { comp[j] = id; stack.push(j); }
    }
  }
  sizes.push(size);
}
// Se toman los componentes grandes (el cauce puede quedar cortado en tramos por el filtro).
for (let i = 0; i < n; i++) if (comp[i] >= 0 && sizes[comp[i]] > 400) mask[i] |= RIVER;

// --- Rasterizado de líneas (Bresenham con grosor) y polígonos (scanline).
function drawLine(c: number[][], bit: number, radius = 0) {
  for (let k = 1; k < c.length; k++) {
    let [x0, y0] = toCell(c[k - 1][0], c[k - 1][1]);
    const [x1, y1] = toCell(c[k][0], c[k][1]);
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
    for (let s = 0; s <= steps; s++) {
      const x = Math.floor(x0 + ((x1 - x0) * s) / steps), y = Math.floor(y0 + ((y1 - y0) * s) / steps);
      for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h) mask[yy * w + xx] |= bit;
      }
    }
    x0 = x1; y0 = y1;
  }
}
/**
 * Línea 4-conexa: recorre cada segmento celda por celda (un eje por vez, "supercover" de Amanatides-Woo),
 * así dos celdas seguidas siempre comparten un lado y el agua (modelo de 4 vecinos) no se cuela en diagonal.
 * `onCell` recibe la celda y la distancia (m) recorrida sobre la polilínea al entrar en ella.
 */
function traceLine4(c: LonLat[], closed: boolean, onCell: (i: number, s: number) => void) {
  const segs = closed ? c.length : c.length - 1;
  let s0 = 0;
  for (let k = 0; k < segs; k++) {
    const a = c[k], b = c[(k + 1) % c.length];
    const segLen = distanciaM(a, b);
    const [x0, y0] = toCell(a[0], a[1]);
    const [x1, y1] = toCell(b[0], b[1]);
    let cx = Math.floor(x0), cy = Math.floor(y0);
    const fx = Math.floor(x1), fy = Math.floor(y1);
    const dx = x1 - x0, dy = y1 - y0;
    const sx = Math.sign(dx), sy = Math.sign(dy);
    const tdx = dx !== 0 ? Math.abs(1 / dx) : Infinity, tdy = dy !== 0 ? Math.abs(1 / dy) : Infinity;
    let tx = dx > 0 ? (cx + 1 - x0) / dx : dx < 0 ? (x0 - cx) / -dx : Infinity;
    let ty = dy > 0 ? (cy + 1 - y0) / dy : dy < 0 ? (y0 - cy) / -dy : Infinity;
    const put = (t: number) => { if (cx >= 0 && cy >= 0 && cx < w && cy < h) onCell(cy * w + cx, s0 + t * segLen); };
    put(0);
    let guard = 0;
    while ((cx !== fx || cy !== fy) && guard++ < 100000) {
      let t: number;
      if (tx < ty) { t = tx; cx += sx; tx += tdx; } else { t = ty; cy += sy; ty += tdy; }
      put(Math.min(1, t));
    }
    s0 += segLen;
  }
}

function fillPolygon(ring: number[][], bit: number) {
  const pts = ring.map(([lon, lat]) => toCell(lon, lat));
  let minY = Infinity, maxY = -Infinity;
  for (const p of pts) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
  for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(h - 1, Math.ceil(maxY)); y++) {
    const yc = y + 0.5; const xs: number[] = [];
    for (let k = 0; k < pts.length; k++) {
      const [ax, ay] = pts[k], [bx, by] = pts[(k + 1) % pts.length];
      if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) xs.push(ax + ((yc - ay) / (by - ay)) * (bx - ax));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2)
      for (let x = Math.max(0, Math.ceil(xs[k] - 0.5)); x <= Math.min(w - 1, Math.floor(xs[k + 1] - 0.5)); x++) mask[y * w + x] |= bit;
  }
}

let defenseCells = 0;
if (existsSync(`${OUT_DIR}/osm.json`)) {
  const osm = JSON.parse(readFileSync(`${OUT_DIR}/osm.json`, 'utf8'));
  for (const a of osm.waterAreas as { kind: string; name: string; rings: number[][][] }[]) {
    if (a.kind === 'humedal') continue; // humedales: no se fuerzan como agua permanente
    // Polígonos de río: cuentan como río Paraguay solo en celdas bajas (cauce), si no como agua permanente.
    const isRiver = a.kind === 'rio' || /paraguay/i.test(a.name);
    for (const r of a.rings) if (r.length > 2) fillPolygon(r, isRiver ? RIVER_CANDIDATE : WATER);
  }
  for (const l of osm.waterLines as { kind: string; c: number[][] }[]) {
    if (l.kind === 'defensa') traceLine4(l.c as LonLat[], false, (i) => { mask[i] |= DEFENSE; });
    else if (l.kind === 'river' || l.kind === 'canal') drawLine(l.c, WATER, 0);
  }
}
// Anillo de defensa cerrado (M. Colman). La brecha se marca más abajo, cuando el cauce ya está definido.
const ringTrace: { i: number; s: number }[] = [];
traceLine4(DEFENSA_ANILLO, true, (i, s) => { mask[i] |= DEFENSE; ringTrace.push({ i, s }); });
// Cauce: polígonos de río conectados al cauce principal (por debajo de 53 m) pasan a ser río Paraguay;
// el resto de los polígonos de río (riachos altos) queda como agua permanente.
{
  const stack: number[] = [];
  for (let i = 0; i < n; i++) if (mask[i] & RIVER) stack.push(i);
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w, y = (i / w) | 0;
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
      if (j >= 0 && mask[j] & RIVER_CANDIDATE && !(mask[j] & RIVER) && z[j] < 53) { mask[j] |= RIVER; stack.push(j); }
    }
  }
  for (let i = 0; i < n; i++) if (mask[i] & RIVER_CANDIDATE) mask[i] = (mask[i] & ~RIVER_CANDIDATE) | (mask[i] & RIVER ? 0 : WATER);
}
for (let i = 0; i < n; i++) {
  if (mask[i] & RIVER) mask[i] &= ~WATER;
  if (mask[i] & DEFENSE) { mask[i] &= ~(RIVER | WATER); defenseCells++; }
}
// Brecha: celdas del anillo a menos de LARGO_BRECHA_M / 2 (medido sobre la traza) de su centro.
// El centro es la celda del anillo más cercana al punto BRECHA (frente al puerto) que el río toca con la
// crecida de 1983 (10,73 m de escala): en el MDE la franja portuaria justo frente a BRECHA queda a
// ~58,2–59 m, apenas por encima del río a 10,73 m (58,03 m), y una brecha ahí no recibiría agua.
// Se corre sobre la traza hasta donde el río efectivamente apoya sobre el terraplén, tanto en la grilla
// de 30 m (zonas) como en la de 60 m (simulación en vivo, ver downsample en engine.ts).
const BREACH_STAGE = 10.73;
let breachCenter = { s: 0, dist: Infinity, lon: 0, lat: 0 };
{
  const lvl = ASSUMPTIONS.gaugeZero + BREACH_STAGE;
  /** Celdas de defensa de la grilla `m` que tocan agua del río (bañadera conectada al nivel `lvl`). */
  const contact = (gw: number, gh: number, gz: Float32Array, m: Uint8Array) => {
    const gn = gw * gh, wet = new Uint8Array(gn), out = new Uint8Array(gn), st: number[] = [];
    const nb = (i: number) => { const x = i % gw, y = (i / gw) | 0; return [x > 0 ? i - 1 : -1, x < gw - 1 ? i + 1 : -1, y > 0 ? i - gw : -1, y < gh - 1 ? i + gw : -1]; };
    for (let i = 0; i < gn; i++) if (m[i] & RIVER) { wet[i] = 1; st.push(i); }
    while (st.length) for (const j of nb(st.pop()!)) if (j >= 0 && !wet[j] && !(m[j] & DEFENSE) && gz[j] < lvl) { wet[j] = 1; st.push(j); }
    for (let i = 0; i < gn; i++) if (m[i] & DEFENSE && nb(i).some((j) => j >= 0 && wet[j])) out[i] = 1;
    return out;
  };
  const c30 = contact(w, h, z, mask);
  const ds = downsample({ width: w, height: h, cellX: meta.cellX, cellY: meta.cellY, z }, mask, 2);
  const c60 = contact(ds.grid.width, ds.grid.height, ds.grid.z, ds.mask);
  for (const { i, s } of ringTrace) {
    const x = i % w, y = (i / w) | 0;
    if (!c30[i] || !c60[(y >> 1) * ds.grid.width + (x >> 1)]) continue;
    const lon = bounds.west + ((x + 0.5) / w) * (bounds.east - bounds.west);
    const lat = bounds.north - ((y + 0.5) / h) * (bounds.north - bounds.south);
    const dist = distanciaM([lon, lat], BRECHA);
    if (dist < breachCenter.dist) breachCenter = { s, dist, lon, lat };
  }
  if (!Number.isFinite(breachCenter.dist)) throw new Error('el río no toca el anillo: no se puede ubicar la brecha');
  const ringLen = longitudKm() * 1000;
  for (const { i, s } of ringTrace) {
    const ds = Math.abs(s - breachCenter.s);
    if (Math.min(ds, ringLen - ds) <= LARGO_BRECHA_M / 2) mask[i] |= BREACH;
  }
}
// Control: el anillo rasterizado tiene que quedar cerrado (4-conexo), si no el agua se cuela por un hueco.
const ringCells = ringTrace.map((c) => c.i);
{
  const set = new Set(ringCells), seen = new Set<number>([ringCells[0]]), st = [ringCells[0]];
  while (st.length) {
    const i = st.pop()!;
    for (const j of [i - 1, i + 1, i - w, i + w]) if (set.has(j) && !seen.has(j)) { seen.add(j); st.push(j); }
  }
  if (seen.size !== set.size) throw new Error(`anillo de defensa no 4-conexo: ${seen.size}/${set.size}`);
}

writeFileSync(`${OUT_DIR}/masks.bin`, mask);
const count = (bit: number) => mask.reduce((c, v) => c + (v & bit ? 1 : 0), 0);
console.log({ river: count(RIVER), defense: defenseCells, breach: count(BREACH), water: count(WATER), ringKm: +longitudKm().toFixed(2) });
console.log(`brecha centrada en [${breachCenter.lon.toFixed(5)}, ${breachCenter.lat.toFixed(5)}], a ${Math.round(breachCenter.dist)} m de BRECHA`);
