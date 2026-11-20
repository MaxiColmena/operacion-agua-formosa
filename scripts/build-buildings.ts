// Edificios y viviendas: huellas de Microsoft Global ML Building Footprints (detectadas con IA sobre imágenes
// satelitales) + edificios de OpenStreetMap que no estén ya cubiertos. Salida binaria compacta:
//   public/data/buildings.bin  →  [uint32 cantidad] y por edificio: [uint8 nPuntos][uint8 alto en m*4][uint16 x, uint16 y]*n
//   coordenadas cuantizadas a 16 bits dentro del BBOX (~0,25 m de precisión).
import { createReadStream, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { BBOX, OUT_DIR } from './config';

type Ring = number[][];
const inBox = (lon: number, lat: number) => lon >= BBOX.west && lon <= BBOX.east && lat >= BBOX.south && lat <= BBOX.north;
const centroid = (r: Ring) => {
  let x = 0, y = 0;
  for (const p of r) { x += p[0]; y += p[1]; }
  return [x / r.length, y / r.length];
};

const out: { h: number; r: Ring; src: 'ms' | 'osm' }[] = [];
const hash = new Set<string>();
const key = (lon: number, lat: number) => `${Math.round(lon / 0.0001)}|${Math.round(lat / 0.0001)}`; // ~10 m

// 1) Microsoft
const files = readdirSync('data-raw').filter((f) => /^msb_\d+\.csv\.gz$/.test(f));
for (const f of files) {
  const rl = createInterface({ input: createReadStream(`data-raw/${f}`).pipe(createGunzip()) });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const ft = JSON.parse(line);
    if (ft.geometry?.type !== 'Polygon') continue;
    const ring: Ring = ft.geometry.coordinates[0];
    const [cx, cy] = centroid(ring);
    if (!inBox(cx, cy)) continue;
    const h = ft.properties?.height > 0 ? ft.properties.height : 0;
    out.push({ h, r: ring.slice(0, -1), src: 'ms' });
    hash.add(key(cx, cy));
  }
}
const nMs = out.length;

// 2) OSM (solo los que no se superponen con una huella de Microsoft)
let nOsm = 0;
if (existsSync('data-raw/osm_buildings.json')) {
  const osm = JSON.parse(readFileSync('data-raw/osm_buildings.json', 'utf8'));
  for (const e of osm.elements as { tags?: Record<string, string>; geometry?: { lat: number; lon: number }[] }[]) {
    const g = e.geometry;
    if (!g || g.length < 4) continue;
    const ring = g.map((p) => [p.lon, p.lat]).slice(0, -1);
    const [cx, cy] = centroid(ring);
    if (!inBox(cx, cy)) continue;
    let dup = false;
    const kx = Math.round(cx / 0.0001), ky = Math.round(cy / 0.0001);
    for (let dx = -1; dx <= 1 && !dup; dx++) for (let dy = -1; dy <= 1 && !dup; dy++) if (hash.has(`${kx + dx}|${ky + dy}`)) dup = true;
    const lv = parseFloat(e.tags?.['building:levels'] ?? '');
    const hm = parseFloat(e.tags?.height ?? '') || (lv ? lv * 3 : 0);
    if (dup) continue;
    out.push({ h: hm, r: ring, src: 'osm' });
    nOsm++;
  }
}

// 3) Empaquetado binario
const W = BBOX.east - BBOX.west, H = BBOX.north - BBOX.south;
const q = (v: number, a: number, s: number) => Math.max(0, Math.min(65535, Math.round(((v - a) / s) * 65535)));
let bytes = 4;
const kept = out.filter((b) => b.r.length >= 3 && b.r.length <= 255);
for (const b of kept) bytes += 2 + b.r.length * 4;
const buf = Buffer.alloc(bytes);
buf.writeUInt32LE(kept.length, 0);
let o = 4;
for (const b of kept) {
  buf.writeUInt8(b.r.length, o); buf.writeUInt8(Math.min(255, Math.round(b.h * 4)), o + 1); o += 2;
  for (const [lon, lat] of b.r) { buf.writeUInt16LE(q(lon, BBOX.west, W), o); buf.writeUInt16LE(q(BBOX.north - lat + BBOX.south, BBOX.south, H), o + 2); o += 4; }
}
writeFileSync(`${OUT_DIR}/buildings.bin`, buf);
writeFileSync(`${OUT_DIR}/buildings.json`, JSON.stringify({
  count: kept.length, microsoft: nMs, osm: nOsm,
  source: 'Microsoft Global ML Building Footprints (ODbL, 2026-02) + OpenStreetMap',
}, null, 2));
console.log({ total: kept.length, microsoft: nMs, osm: nOsm, MB: +(bytes / 1e6).toFixed(2) });
