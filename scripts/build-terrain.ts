// Recorta el MDE Copernicus GLO-30 a Formosa Capital y lo exporta como Float32 binario.
import { fromFile } from 'geotiff';
import { mkdirSync, writeFileSync } from 'node:fs';
import { BBOX, DEM_FILE, OUT_DIR } from './config';

const tiff = await fromFile(DEM_FILE);
const img = await tiff.getImage();
const [ox, oy] = img.getOrigin();
const [rx, ry] = img.getResolution();
const x0 = Math.round((BBOX.west - ox) / rx);
const x1 = Math.round((BBOX.east - ox) / rx);
const y0 = Math.round((BBOX.north - oy) / ry);
const y1 = Math.round((BBOX.south - oy) / ry);
const w = x1 - x0, h = y1 - y0;
const [raw] = (await img.readRasters({ window: [x0, y0, x1, y1] })) as unknown as Float32Array[];

// Mediana 3x3: reduce picos aislados (árboles, techos) del modelo de superficie.
const elev = new Float32Array(w * h);
const buf: number[] = [];
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  buf.length = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const xx = Math.min(w - 1, Math.max(0, x + dx)), yy = Math.min(h - 1, Math.max(0, y + dy));
    buf.push(raw[yy * w + xx]);
  }
  buf.sort((a, b) => a - b);
  elev[y * w + x] = buf[4];
}

let min = Infinity, max = -Infinity;
for (const v of elev) { if (v < min) min = v; if (v > max) max = v; }
const west = ox + x0 * rx, north = oy + y0 * ry;
const meta = {
  width: w, height: h,
  bounds: { west, north, east: west + w * rx, south: north + h * ry },
  // Tamaño de celda en metros (aprox. en esta latitud).
  cellX: Math.abs(rx) * 111320 * Math.cos((north * Math.PI) / 180),
  cellY: Math.abs(ry) * 110540,
  min, max,
  source: 'Copernicus DEM GLO-30 (ESA, 2021) · tile S27 W059 · filtro mediana 3x3',
};
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(`${OUT_DIR}/terrain.bin`, Buffer.from(elev.buffer));
writeFileSync(`${OUT_DIR}/terrain.json`, JSON.stringify(meta, null, 2));
console.log(meta);
