// Reparte la población del Censo 2022 (INDEC, por radio censal) en la grilla del modelo.
// Fuente: radios.parquet de source.coop/nlebovits/censo-argentino/2022 (Censo 2022, INDEC).
// Bajarlo una vez:  curl -o data/raw/radios.parquet https://data.source.coop/nlebovits/censo-argentino/2022/radios.parquet
// Uso:             node scripts/procesar-censo.mjs
//
// Método: cada radio reparte su población en partes iguales entre las celdas cuyo centro cae
// dentro del radio. Si un radio es más chico que una celda, toda su población va a la celda
// de su centro. Es una aproximación: supone población pareja dentro de cada radio.

import { readFileSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import { parquetReadObjects } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';

const AREA = { oeste: -58.255, este: -58.125, sur: -26.245, norte: -26.125 };
const N = 150;
const anchoLon = (AREA.este - AREA.oeste) / N;
const altoLat = (AREA.norte - AREA.sur) / N;

const b = readFileSync('data/raw/radios.parquet');
const file = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
const filas = await parquetReadObjects({
  file,
  compressors,
  columns: ['POB_TOT_P', 'VIV_TOT_P', 'geometry', 'bbox'],
  utf8: false, // la geometría es WKB binario: no decodificarla como texto
});

// WKB -> lista de anillos exteriores [[lon, lat], ...] (Polygon y MultiPolygon).
function leerWKB(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 0;
  const poligonos = [];
  function geom() {
    const le = dv.getUint8(o) === 1;
    o += 1;
    let tipo = dv.getUint32(o, le);
    o += 4;
    if (tipo > 1000) tipo %= 1000;
    if (tipo === 3) {
      const nAnillos = dv.getUint32(o, le);
      o += 4;
      const anillos = [];
      for (let r = 0; r < nAnillos; r++) {
        const nPts = dv.getUint32(o, le);
        o += 4;
        const pts = [];
        for (let k = 0; k < nPts; k++) {
          pts.push([dv.getFloat64(o, le), dv.getFloat64(o + 8, le)]);
          o += 16;
        }
        anillos.push(pts);
      }
      poligonos.push(anillos);
    } else if (tipo === 6) {
      const n = dv.getUint32(o, le);
      o += 4;
      for (let k = 0; k < n; k++) geom();
    } else {
      throw new Error(`tipo WKB no soportado: ${tipo}`);
    }
  }
  geom();
  return poligonos;
}

function dentro([x, y], anillo) {
  let d = false;
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
    const [xi, yi] = anillo[i];
    const [xj, yj] = anillo[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) d = !d;
  }
  return d;
}
const enPoligono = (p, anillos) => dentro(p, anillos[0]) && !anillos.slice(1).some((h) => dentro(p, h));

const poblacion = new Float64Array(N * N);
const viviendas = new Float64Array(N * N);
let radios = 0;
let total = 0;
for (const f of filas) {
  const bb = f.bbox;
  if (!bb || bb.xmax < AREA.oeste || bb.xmin > AREA.este || bb.ymax < AREA.sur || bb.ymin > AREA.norte) continue;
  const pob = Number(f.POB_TOT_P) || 0;
  const viv = Number(f.VIV_TOT_P) || 0;
  const polis = leerWKB(f.geometry);
  const celdas = [];
  const x0 = Math.max(0, Math.floor((bb.xmin - AREA.oeste) / anchoLon));
  const x1 = Math.min(N - 1, Math.floor((bb.xmax - AREA.oeste) / anchoLon));
  const y0 = Math.max(0, Math.floor((bb.ymin - AREA.sur) / altoLat));
  const y1 = Math.min(N - 1, Math.floor((bb.ymax - AREA.sur) / altoLat));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const c = [AREA.oeste + (x + 0.5) * anchoLon, AREA.sur + (y + 0.5) * altoLat];
      if (polis.some((p) => enPoligono(c, p))) celdas.push(y * N + x);
    }
  }
  if (!celdas.length) {
    const cx = (bb.xmin + bb.xmax) / 2;
    const cy = (bb.ymin + bb.ymax) / 2;
    if (cx < AREA.oeste || cx > AREA.este || cy < AREA.sur || cy > AREA.norte) continue;
    celdas.push(Math.floor((cy - AREA.sur) / altoLat) * N + Math.floor((cx - AREA.oeste) / anchoLon));
  }
  for (const i of celdas) {
    poblacion[i] += pob / celdas.length;
    viviendas[i] += viv / celdas.length;
  }
  radios++;
  total += pob;
}

await mkdir('public/datos', { recursive: true });
await writeFile(
  'public/datos/poblacion.json',
  JSON.stringify({
    fuente: 'INDEC – Censo 2022, población y viviendas por radio censal (vía source.coop/nlebovits/censo-argentino)',
    url: 'https://source.coop/nlebovits/censo-argentino/2022',
    fecha: '2022 (censo) · procesado ' + new Date().toISOString().slice(0, 10),
    metodo: 'población del radio repartida en partes iguales entre las celdas de ~87 m que cubre',
    radios,
    poblacion: Array.from(poblacion, (v) => Math.round(v)),
    viviendas: Array.from(viviendas, (v) => Math.round(v)),
  }),
);
console.log(`radios en el área: ${radios} · población total: ${Math.round(total)}`);
