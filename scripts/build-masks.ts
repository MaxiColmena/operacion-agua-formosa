// Construye las máscaras de la grilla: río Paraguay (borde de nivel fijo), línea de defensa y cuerpos de agua.
// Salida: public/data/masks.bin (Uint8, bits: 1 = río, 2 = defensa, 4 = agua permanente).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { OUT_DIR } from './config';

const meta = JSON.parse(readFileSync(`${OUT_DIR}/terrain.json`, 'utf8'));
const z = new Float32Array(readFileSync(`${OUT_DIR}/terrain.bin`).buffer.slice(0));
const { width: w, height: h, bounds } = meta;
const n = w * h;
const RIVER = 1, DEFENSE = 2, WATER = 4, RIVER_CANDIDATE = 8;
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
    if (l.kind === 'defensa') drawLine(l.c, DEFENSE, 0);
    else if (l.kind === 'river' || l.kind === 'canal') drawLine(l.c, WATER, 0);
  }
}
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

writeFileSync(`${OUT_DIR}/masks.bin`, mask);
const count = (bit: number) => mask.reduce((c, v) => c + (v & bit ? 1 : 0), 0);
console.log({ river: count(RIVER), defense: defenseCells, water: count(WATER) });
