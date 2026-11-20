// Recorta el modelo de terreno a Formosa Capital y lo exporta como Float32 binario.
//
// Fuente preferida: FABDEM v1-2 (Copernicus con edificios y bosques removidos con aprendizaje
// automático; Hawker et al. 2022). Ya es terreno desnudo: solo se aplica un suavizado gaussiano 3x3.
// Respaldo: Copernicus GLO-30. GLO-30 es un modelo de SUPERFICIE (DSM): en la ciudad los techos grandes, tanques
// y arboledas aparecen como lomas falsas de 2–5 m. Como Formosa es una llanura casi
// plana, aproximamos el terreno desnudo con:
//   1. Apertura morfológica (erosión gris + dilatación) con disco de 7 celdas de diámetro (~200 m):
//      elimina objetos positivos más chicos que la ventana. La apertura nunca sube
//      celdas, así que valles de riachos, lagunas y el cauce del río conservan su cota.
//   2. Mezcla suave: diferencias < 0,3 m (ruido/pendiente natural) se respetan y la
//      corrección completa se aplica desde 1 m; solo se BAJAN celdas.
//   3. Suavizado gaussiano 3x3 y min(original): nunca queda por encima del DSM.
import { fromFile } from 'geotiff';
import { mkdirSync, writeFileSync } from 'node:fs';
import { BBOX, DEM_FILE, DEM_IS_FABDEM, OUT_DIR } from './config';

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

const R = 3; // radio del disco: 7 celdas de diámetro ≈ 200 m
const D_MIN = 0.3, D_FULL = 1.0; // rampa de la corrección (m)

// Filtro min/max con elemento estructurante en disco (evita artefactos cuadrados).
const DISK: [number, number][] = [];
for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++)
  if (dx * dx + dy * dy <= R * R + R) DISK.push([dx, dy]);
function rankFilter(src: Float32Array, useMin: boolean): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = src[y * w + x];
    for (const [dx, dy] of DISK) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const s = src[yy * w + xx];
      if (useMin ? s < v : s > v) v = s;
    }
    out[y * w + x] = v;
  }
  return out;
}

// FABDEM ya no tiene edificios: la apertura se saltea (opened = raw).
const opened = DEM_IS_FABDEM ? raw : rankFilter(rankFilter(raw, true), false);

// Solo bajar: corrección ponderada según la altura del objeto removido.
const cleaned = new Float32Array(w * h);
for (let i = 0; i < w * h; i++) {
  const d = raw[i] - opened[i]; // >= 0 por construcción
  const k = Math.max(0, Math.min(1, (d - D_MIN) / (D_FULL - D_MIN)));
  cleaned[i] = raw[i] - k * d;
}

// Gaussiano 3x3 (1-2-1) y tope en el DSM original.
const G = [1, 2, 1];
const elev = new Float32Array(w * h);
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  let s = 0, ws = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const xx = x + dx, yy = y + dy;
    if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
    const g = G[dx + 1] * G[dy + 1];
    s += g * cleaned[yy * w + xx]; ws += g;
  }
  elev[y * w + x] = Math.min(raw[y * w + x], s / ws);
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
  source: DEM_IS_FABDEM
    ? 'FABDEM v1-2 (Univ. de Bristol / Fathom, CC BY-NC-SA 4.0) · Copernicus GLO-30 sin edificios ni bosques · tile S27 W059 · suavizado gaussiano 3x3'
    : 'Copernicus DEM GLO-30 (ESA, 2021) · tile S27 W059 · terreno desnudo aprox.: apertura morfológica con disco de ~200 m (solo baja objetos >0,3 m) + suavizado gaussiano 3x3',
};
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(`${OUT_DIR}/terrain.bin`, Buffer.from(elev.buffer));
writeFileSync(`${OUT_DIR}/terrain.json`, JSON.stringify(meta, null, 2));
console.log(meta);
