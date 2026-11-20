// Ubica la red pluvial relevada (src/data/drainage-network.ts) sobre la grilla de 30 m.
// Salida: public/data/drainage.bin (Uint8 por celda: 0 = sin red relevada, 1..3 = grupo) y drainage.json
// (qué entradas se pudieron ubicar en OpenStreetMap y cuánta superficie cubren).
import { readFileSync, writeFileSync } from 'node:fs';
import { DRAIN_NETWORK, type DrainEntry, type TramoEnd } from '../src/data/drainage-network';
import { MASK_DEFENSE, MASK_RIVER } from '../src/sim/engine';
import { OUT_DIR } from './config';

/** Radios de influencia (m): cuánto alrededor de cada elemento drena hacia la red. SUPUESTOS. */
const R_STREET = 50; // media cuadra a cada lado de la calle con sumideros
const R_CORNER = 100; // una cuadra alrededor de la esquina
const R_PAVED = 40;
const MAX_CROSS_GAP = 90; // distancia máxima para dar por buena una esquina entre dos calles

type P = [number, number]; // metros (x hacia el este, y hacia el sur)
type Line = P[];

const meta = JSON.parse(readFileSync(`${OUT_DIR}/terrain.json`, 'utf8'));
const masks = new Uint8Array(readFileSync(`${OUT_DIR}/masks.bin`));
const osm = JSON.parse(readFileSync(`${OUT_DIR}/osm.json`, 'utf8'));
const { width: W, height: H, cellX: CX, cellY: CY, bounds: B } = meta;
const N = W * H;

const toM = (lon: number, lat: number): P => [((lon - B.west) / (B.east - B.west)) * W * CX, ((B.north - lat) / (B.north - B.south)) * H * CY];
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const roads: { n: string; paved: boolean; line: Line }[] = osm.roads
  .filter((r: { n?: string }) => r.n)
  .map((r: { n: string; paved: boolean; c: number[][] }) => ({ n: norm(r.n), paved: r.paved, line: r.c.map(([x, y]) => toM(x, y)) }));
const pavedLines: Line[] = osm.roads.filter((r: { paved: boolean }) => r.paved).map((r: { c: number[][] }) => r.c.map(([x, y]) => toM(x, y)));
const waters: { n: string; line: Line }[] = osm.waterLines.map((w: { name: string; c: number[][] }) => ({ n: norm(w.name ?? ''), line: w.c.map(([x, y]) => toM(x, y)) }));
const barrios: { n: string; p: P }[] = osm.barrios.map((b: { name: string; lon: number; lat: number }) => ({ n: norm(b.name), p: toM(b.lon, b.lat) }));

const streetLines = (pat: string) => roads.filter((r) => r.n.includes(pat)).map((r) => r.line);
const waterLines = (pat: string) => waters.filter((w) => w.n.includes(pat)).map((w) => w.line);
const barrioPoint = (pat: string) => barrios.find((b) => b.n.includes(pat))?.p ?? null;

function closestOnSeg(p: P, a: P, b: P): P {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0;
  return [a[0] + t * dx, a[1] + t * dy];
}
const dist = (a: P, b: P) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Punto de `as` más cercano a `bs` (aprox. el cruce) y su distancia. */
function nearest(as: Line[], bs: Line[]): { p: P; d: number } | null {
  let best: { p: P; d: number } | null = null;
  for (const la of as) for (const pa of la) for (const lb of bs) for (let k = 1; k < lb.length; k++) {
    const q = closestOnSeg(pa, lb[k - 1], lb[k]);
    const d = dist(pa, q);
    if (!best || d < best.d) best = { p: [(pa[0] + q[0]) / 2, (pa[1] + q[1]) / 2], d };
  }
  return best;
}
function nearestToPoint(ls: Line[], p: P): P | null {
  let best: P | null = null, bd = Infinity;
  for (const l of ls) for (let k = 1; k < l.length; k++) { const q = closestOnSeg(p, l[k - 1], l[k]); const d = dist(p, q); if (d < bd) { bd = d; best = q; } }
  return best;
}

/** Muestras cada ~10 m a lo largo de las líneas. */
function samples(ls: Line[]): P[] {
  const out: P[] = [];
  for (const l of ls) for (let k = 1; k < l.length; k++) {
    const n = Math.max(1, Math.ceil(dist(l[k - 1], l[k]) / 10));
    for (let s = 0; s <= n; s++) out.push([l[k - 1][0] + ((l[k][0] - l[k - 1][0]) * s) / n, l[k - 1][1] + ((l[k][1] - l[k - 1][1]) * s) / n]);
  }
  return out;
}

const grid = new Uint8Array(N);
function paint(p: P, r: number, group: number, count: Set<number>) {
  const x0 = Math.max(0, Math.floor((p[0] - r) / CX)), x1 = Math.min(W - 1, Math.floor((p[0] + r) / CX));
  const y0 = Math.max(0, Math.floor((p[1] - r) / CY)), y1 = Math.min(H - 1, Math.floor((p[1] + r) / CY));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (Math.hypot((x + 0.5) * CX - p[0], (y + 0.5) * CY - p[1]) > r) continue;
    const i = y * W + x;
    if (masks[i] & MASK_RIVER) continue;
    count.add(i);
    if (!grid[i] || group < grid[i]) grid[i] = group;
  }
}

function endPoint(end: TramoEnd, street: Line[]): P | null {
  if ('street' in end) { const r = nearest(street, streetLines(end.street)); return r && r.d < MAX_CROSS_GAP ? r.p : null; }
  // Riacho: si la calle no llega a cruzarlo en OSM, se toma el punto de la calle más cercano (hasta 800 m).
  if ('water' in end) { const r = nearest(street, waterLines(end.water)); return r && r.d < 800 ? r.p : null; }
  const bp = barrioPoint(end.barrio);
  return bp ? nearestToPoint(street, bp) : null;
}

/** Casco: celdas al sur de González Lelong, al norte de Napoleón Uriburu, al este de Pantaleón Gómez y al oeste de la defensa. */
function paintCasco(count: Set<number>): string | null {
  const lel = samples(streetLines('gonzalez lelong')), nap = samples(streetLines('napoleon uriburu')), pan = samples(streetLines('pantaleon gomez'));
  if (!lel.length || !nap.length || !pan.length) return 'faltan avenidas en OSM';
  // y de la avenida en función de x (Lelong, Napoleón) y x en función de y (Pantaleón), por la muestra más cercana.
  const yAt = (s: P[], x: number) => s.reduce((b, p) => (Math.abs(p[0] - x) < Math.abs(b[0] - x) ? p : b))[1];
  const xAt = (s: P[], y: number) => s.reduce((b, p) => (Math.abs(p[1] - y) < Math.abs(b[1] - y) ? p : b))[0];
  for (let y = 0; y < H; y++) {
    const ym = (y + 0.5) * CY;
    const xw = xAt(pan, ym);
    let x = Math.floor(xw / CX) + 1;
    if (x < 0 || x >= W) continue;
    for (; x < W; x++) {
      const i = y * W + x;
      if (masks[i] & (MASK_RIVER | MASK_DEFENSE)) break;
      const xm = (x + 0.5) * CX;
      if (ym > yAt(lel, xm) && ym < yAt(nap, xm)) { count.add(i); grid[i] = 1; }
    }
  }
  return null;
}

const report: { id: string; label: string; group: number; ok: boolean; km2: number; note?: string }[] = [];
for (const e of DRAIN_NETWORK as DrainEntry[]) {
  const cells = new Set<number>();
  let note: string | undefined;
  if (e.kind === 'casco') {
    note = paintCasco(cells) ?? undefined;
  } else if (e.kind === 'corner') {
    const r = nearest(streetLines(e.a), streetLines(e.b));
    if (r && r.d < MAX_CROSS_GAP) paint(r.p, R_CORNER, e.group, cells);
    else note = !streetLines(e.a).length ? `no está «${e.a}» en OSM` : !streetLines(e.b).length ? `no está «${e.b}» en OSM` : 'las calles no se cruzan en OSM';
  } else if (e.kind === 'barrio') {
    const bp = barrioPoint(e.barrio);
    if (!bp) note = 'barrio sin punto en OSM';
    else if (e.pavedOnly) { for (const s of samples(pavedLines)) if (dist(s, bp) < e.radius) paint(s, R_PAVED, e.group, cells); }
    else paint(bp, e.radius, e.group, cells);
  } else {
    const ls = streetLines(e.street);
    if (!ls.length) note = `no está «${e.street}» en OSM`;
    else {
      let ss = samples(ls);
      if (e.from && e.to) {
        const a = endPoint(e.from, ls), b = endPoint(e.to, ls);
        if (!a || !b) { note = `no se encontró el ${!a ? 'inicio' : 'fin'} del tramo`; ss = []; }
        else {
          const L = dist(a, b);
          if (L < 300) {
            // Tramo corto o mal definido en OSM: se toma la calle a menos de 400 m del punto medio.
            const m: P = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
            ss = ss.filter((s) => dist(s, m) < 400);
            note = 'tramo aproximado (400 m alrededor del cruce)';
          } else {
            const dx = (b[0] - a[0]) / L, dy = (b[1] - a[1]) / L;
            const tol = Math.max(150, 0.3 * L);
            ss = ss.filter((s) => { const t = (s[0] - a[0]) * dx + (s[1] - a[1]) * dy; const off = Math.abs((s[0] - a[0]) * dy - (s[1] - a[1]) * dx); return t >= -20 && t <= L + 20 && off < tol; });
          }
        }
      }
      if (e.near) {
        const bp = barrioPoint(e.near);
        if (!bp) { note = `barrio «${e.near}» sin punto en OSM`; ss = []; } else ss = ss.filter((s) => dist(s, bp) < (e.radius ?? 600));
      }
      for (const s of ss) paint(s, R_STREET, e.group, cells);
    }
  }
  const km2 = +((cells.size * CX * CY) / 1e6).toFixed(2);
  report.push({ id: e.id, label: e.label, group: e.group, ok: cells.size > 0, km2, ...(note ? { note } : {}) });
  console.log(`${cells.size ? '✓' : '✗'} ${e.label}: ${km2} km²${note ? ` (${note})` : ''}`);
}

let total = 0;
for (let i = 0; i < N; i++) if (grid[i]) total++;
const totalKm2 = +((total * CX * CY) / 1e6).toFixed(2);
console.log(`Superficie con red relevada: ${totalKm2} km²`);
writeFileSync(`${OUT_DIR}/drainage.bin`, grid);
writeFileSync(`${OUT_DIR}/drainage.json`, JSON.stringify({
  generated: new Date().toISOString(),
  source: 'Relevamiento del equipo (información municipal y de prensa), sin verificar en campo',
  radii: { street: R_STREET, corner: R_CORNER, paved: R_PAVED },
  totalKm2, entries: report,
}, null, 2));
