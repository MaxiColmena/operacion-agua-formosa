// Censo 2022 (INDEC) por radio censal → grilla del modelo, con datos sociodemográficos reales.
//
// Fuentes (CC BY 4.0, vía source.coop/nlebovits/censo-argentino/2022):
//   - data-raw/radios.parquet       límites de los radios (Rodriguez y de Grande, CONICET) + población y viviendas
//   - data-raw/census-data.parquet  todas las variables del censo por radio (formato largo, REDATAM de INDEC)
// Bajarlos una vez:
//   curl -o data-raw/radios.parquet      https://data.source.coop/nlebovits/censo-argentino/2022/radios.parquet
//   curl -o data-raw/census-data.parquet https://data.source.coop/nlebovits/censo-argentino/2022/census-data.parquet
// Uso: node scripts/build-censo.mjs   (o npm run data:censo)
//
// Método (dasimétrico): cada radio reparte sus conteos entre las celdas (~87 m) según la superficie de
// EDIFICIOS que hay en cada una (Microsoft Global ML Building Footprints, public/data/buildings.bin): la gente
// vive donde hay casas, no en el campo ni en el río. Cada edificio pesa su superficie, con un tope de 400 m²
// para que un galpón o un supermercado no se lleve a todo el radio. Si un radio no tiene edificios, se reparte
// parejo entre las celdas que cubre (método anterior). Sigue siendo una aproximación.

import { readFileSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import { parquetMetadata, parquetReadObjects } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';

const AREA = { oeste: -58.255, este: -58.125, sur: -26.245, norte: -26.125 };
const N = 150;
const PROV = '34'; // Formosa
const DEPTO = '014'; // departamento Formosa (la capital)
const anchoLon = (AREA.este - AREA.oeste) / N;
const altoLat = (AREA.norte - AREA.sur) / N;

const abrir = (ruta) => {
  const b = readFileSync(ruta);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};

// ---------- 1) Variables por radio (census-data.parquet, formato largo) ----------
// Indicadores que se guardan (conteos). Cada uno: variable del censo, categorías que suman y a qué universo pertenece.
const INDICADORES = {
  hogares: { variable: 'HOGAR_NBI_TOT', categorias: null }, // total de hogares (Sí + No)
  hogaresNbi: { variable: 'HOGAR_NBI_TOT', categorias: ['1'] }, // hogares con al menos una NBI
  hogaresHacinamiento: { variable: 'HOGAR_NBI_HAC', categorias: ['1'] }, // más de 3 personas por cuarto
  hogaresSinAguaRed: { variable: 'HOGAR_H14', categorias: ['2', '3', '4', '5', '6'] }, // agua que no es de red pública
  hogaresSinCloaca: { variable: 'HOGAR_H15_17_18', categorias: ['2', '3', '4'] }, // desagüe que no es a red pública
  personas: { variable: 'PERSONA_EDADGRU', categorias: null },
  menores14: { variable: 'PERSONA_EDADGRU', categorias: ['1'] },
  mayores65: { variable: 'PERSONA_EDADGRU', categorias: ['3'] },
  sinCobertura: { variable: 'PERSONA_P19', categorias: ['3'] }, // sin obra social, prepaga ni plan estatal
  viviendasHabitadas: { variable: 'VIVIENDA_V01', categorias: null },
  viviendasPrecarias: { variable: 'VIVIENDA_V01', categorias: ['2', '3', '6', '7'] }, // rancho, casilla, local, móvil
};
const porVariable = new Map();
for (const [clave, ind] of Object.entries(INDICADORES)) {
  if (!porVariable.has(ind.variable)) porVariable.set(ind.variable, []);
  porVariable.get(ind.variable).push([clave, ind.categorias]);
}

const datos = abrir('data-raw/census-data.parquet');
const md = parquetMetadata(datos);
const porRadio = new Map(); // id_geo → { indicador: conteo }
let inicio = 0;
for (const rg of md.row_groups) {
  const n = Number(rg.num_rows);
  const st = rg.columns.find((c) => c.meta_data.path_in_schema[0] === 'valor_provincia').meta_data.statistics;
  const min = st?.min_value ?? st?.min, max = st?.max_value ?? st?.max;
  if (!(typeof min === 'string' && min > PROV) && !(typeof max === 'string' && max < PROV)) {
    const filas = await parquetReadObjects({
      file: datos, compressors, rowStart: inicio, rowEnd: inicio + n,
      columns: ['id_geo', 'valor_provincia', 'valor_departamento', 'codigo_variable', 'valor_categoria', 'conteo'],
    });
    for (const f of filas) {
      if (f.valor_provincia !== PROV || f.valor_departamento !== DEPTO) continue;
      const usos = porVariable.get(f.codigo_variable);
      if (!usos) continue;
      let r = porRadio.get(f.id_geo);
      if (!r) porRadio.set(f.id_geo, (r = {}));
      for (const [clave, cats] of usos) {
        if (cats && !cats.includes(f.valor_categoria)) continue;
        r[clave] = (r[clave] ?? 0) + Number(f.conteo);
      }
    }
  }
  inicio += n;
}
console.log(`variables del censo: ${porRadio.size} radios del departamento Formosa`);

// ---------- 2) Geometría de los radios y reparto en la grilla ----------
const filas = await parquetReadObjects({
  file: abrir('data-raw/radios.parquet'), compressors,
  columns: ['COD_2022', 'POB_TOT_P', 'VIV_TOT_P', 'geometry', 'bbox'],
  utf8: false, // la geometría es WKB binario: no decodificarla como texto
});

// WKB → lista de polígonos (cada uno: anillos [[lon, lat], ...]); soporta Polygon y MultiPolygon.
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
        for (let k = 0; k < nPts; k++) { pts.push([dv.getFloat64(o, le), dv.getFloat64(o + 8, le)]); o += 16; }
        anillos.push(pts);
      }
      poligonos.push(anillos);
    } else if (tipo === 6) {
      const n = dv.getUint32(o, le);
      o += 4;
      for (let k = 0; k < n; k++) geom();
    } else throw new Error(`tipo WKB no soportado: ${tipo}`);
  }
  geom();
  return poligonos;
}
/** Las versiones nuevas de hyparquet ya devuelven la geometría como GeoJSON; las viejas, como WKB. */
function geometria(g) {
  if (g instanceof Uint8Array) return leerWKB(g);
  if (g?.type === 'Polygon') return [g.coordinates];
  if (g?.type === 'MultiPolygon') return g.coordinates;
  throw new Error(`geometría no soportada: ${g?.type}`);
}
function dentro([x, y], anillo) {
  let d = false;
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
    const [xi, yi] = anillo[i], [xj, yj] = anillo[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) d = !d;
  }
  return d;
}
const enPoligono = (p, anillos) => dentro(p, anillos[0]) && !anillos.slice(1).some((h) => dentro(p, h));

// ---------- Edificios (peso del reparto) ----------
// buildings.bin: anillos en coordenadas de la grilla del terreno (ver src/data/load.ts, decodeBuildings).
const terreno = JSON.parse(readFileSync('public/data/terrain.json', 'utf8'));
const TOPE_M2 = 400;
const edificios = []; // { lon, lat, peso }
{
  const buf = readFileSync('public/data/buildings.bin');
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const { width: W, height: H, bounds: tb, cellX, cellY } = terreno;
  const n = dv.getUint32(0, true);
  let o = 4;
  for (let i = 0; i < n; i++) {
    const k = dv.getUint8(o); o += 2;
    const xs = [], ys = [];
    for (let j = 0; j < k; j++) { xs.push((dv.getUint16(o, true) / 65535) * W); ys.push((dv.getUint16(o + 2, true) / 65535) * H); o += 4; }
    let a = 0, cx = 0, cy = 0;
    for (let j = 0, m = k - 1; j < k; m = j++) a += (xs[m] + xs[j]) * (ys[m] - ys[j]);
    for (let j = 0; j < k; j++) { cx += xs[j]; cy += ys[j]; }
    const area = (Math.abs(a) / 2) * cellX * cellY; // m²
    cx /= k; cy /= k;
    edificios.push({
      lon: tb.west + (cx / W) * (tb.east - tb.west),
      lat: tb.north - (cy / H) * (tb.north - tb.south),
      peso: Math.min(TOPE_M2, Math.max(10, area)),
    });
  }
}
console.log(`edificios para el reparto: ${edificios.length}`);

const CAMPOS = ['poblacion', 'viviendas', ...Object.keys(INDICADORES)];
const grilla = Object.fromEntries(CAMPOS.map((c) => [c, new Float64Array(N * N)]));
let radios = 0, total = 0, sinVariables = 0, radiosSinEdificios = 0, pobSinEdificios = 0;
const decod = new TextDecoder();
for (const f of filas) {
  const bb = f.bbox;
  if (!bb || bb.xmax < AREA.oeste || bb.xmin > AREA.este || bb.ymax < AREA.sur || bb.ymin > AREA.norte) continue;
  const cod = typeof f.COD_2022 === 'string' ? f.COD_2022 : decod.decode(f.COD_2022);
  const polis = geometria(f.geometry);
  const celdas = [];
  const x0 = Math.max(0, Math.floor((bb.xmin - AREA.oeste) / anchoLon));
  const x1 = Math.min(N - 1, Math.floor((bb.xmax - AREA.oeste) / anchoLon));
  const y0 = Math.max(0, Math.floor((bb.ymin - AREA.sur) / altoLat));
  const y1 = Math.min(N - 1, Math.floor((bb.ymax - AREA.sur) / altoLat));
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const c = [AREA.oeste + (x + 0.5) * anchoLon, AREA.sur + (y + 0.5) * altoLat];
      if (polis.some((p) => enPoligono(c, p))) celdas.push(y * N + x);
    }
  if (!celdas.length) {
    const cx = (bb.xmin + bb.xmax) / 2, cy = (bb.ymin + bb.ymax) / 2;
    if (cx < AREA.oeste || cx > AREA.este || cy < AREA.sur || cy > AREA.norte) continue;
    celdas.push(Math.floor((cy - AREA.sur) / altoLat) * N + Math.floor((cx - AREA.oeste) / anchoLon));
  }
  const v = { poblacion: Number(f.POB_TOT_P) || 0, viviendas: Number(f.VIV_TOT_P) || 0, ...(porRadio.get(cod) ?? {}) };
  if (!porRadio.has(cod) && v.poblacion > 0) sinVariables++;
  // Peso de cada celda = superficie de edificios del radio que caen en ella.
  const peso = new Map();
  let pesoTotal = 0;
  for (const e of edificios) {
    if (e.lon < bb.xmin || e.lon > bb.xmax || e.lat < bb.ymin || e.lat > bb.ymax) continue;
    if (e.lon < AREA.oeste || e.lon >= AREA.este || e.lat < AREA.sur || e.lat >= AREA.norte) continue;
    if (!polis.some((p) => enPoligono([e.lon, e.lat], p))) continue;
    const i = Math.floor((e.lat - AREA.sur) / altoLat) * N + Math.floor((e.lon - AREA.oeste) / anchoLon);
    peso.set(i, (peso.get(i) ?? 0) + e.peso);
    pesoTotal += e.peso;
  }
  if (!pesoTotal) { radiosSinEdificios++; pobSinEdificios += v.poblacion; }
  for (const campo of CAMPOS) {
    const val = v[campo] ?? 0;
    if (!val) continue;
    if (pesoTotal) for (const [i, w] of peso) grilla[campo][i] += (val * w) / pesoTotal;
    else for (const i of celdas) grilla[campo][i] += val / celdas.length;
  }
  radios++;
  total += v.poblacion;
}

await mkdir('public/data', { recursive: true });
const redondo = (a) => Array.from(a, (x) => Math.round(x * 10) / 10);
await writeFile(
  'public/data/poblacion.json',
  JSON.stringify({
    fuente: 'INDEC – Censo Nacional de Población, Hogares y Viviendas 2022, por radio censal (vía source.coop/nlebovits/censo-argentino; radios: Rodriguez y de Grande, CONICET)',
    url: 'https://source.coop/nlebovits/censo-argentino/2022',
    fecha: '2022 (censo) · procesado ' + new Date().toISOString().slice(0, 10),
    metodo: 'conteos de cada radio repartidos entre las celdas de ~87 m según la superficie de edificios (Microsoft Building Footprints, tope 400 m² por edificio); parejo si el radio no tiene edificios',
    area: AREA,
    columnas: N,
    filas: N,
    // Fila 0 = borde SUR (la latitud crece con la fila).
    radios,
    definiciones: {
      hogaresNbi: 'Hogares con al menos una necesidad básica insatisfecha (NBI, INDEC)',
      hogaresHacinamiento: 'Hogares con hacinamiento crítico (más de 3 personas por cuarto)',
      hogaresSinAguaRed: 'Hogares que no se abastecen de agua por red pública',
      hogaresSinCloaca: 'Hogares sin desagüe a red pública (cloaca)',
      menores14: 'Personas de hasta 14 años',
      mayores65: 'Personas de 65 años y más',
      sinCobertura: 'Personas sin obra social, prepaga ni plan estatal de salud',
      viviendasPrecarias: 'Viviendas habitadas tipo rancho, casilla, local no construido para habitación o vivienda móvil',
    },
    ...Object.fromEntries(CAMPOS.map((c) => [c === 'poblacion' ? 'poblacion' : c, redondo(grilla[c])])),
  }),
);
const suma = (c) => Math.round(grilla[c].reduce((a, b) => a + b, 0));
console.log(`radios en el área: ${radios} (sin variables: ${sinVariables}) · población: ${Math.round(total)}`);
console.log(`radios sin edificios (reparto parejo): ${radiosSinEdificios} · población en ellos: ${pobSinEdificios}`);
console.log(Object.fromEntries(CAMPOS.map((c) => [c, suma(c)])));
