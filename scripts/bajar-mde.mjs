// Descarga el terreno de Formosa Capital y lo pasa a la grilla del modelo (150 x 150 celdas).
// Fuente: Copernicus DEM GLO-30 (ESA / Airbus, licencia abierta), alturas en m sobre el geoide EGM2008.
// Es un modelo de SUPERFICIE (incluye edificios y árboles): por eso en cada celda se toma el
// percentil 20 de los píxeles, que se acerca más al suelo que el promedio.
// El MDE-Ar del IGN (recomendado por la guía) no tiene descarga automática: queda como mejora.
// Uso: node scripts/bajar-mde.mjs

import { writeFile, mkdir } from 'node:fs/promises';
import { fromUrl } from 'geotiff';

const AREA = { oeste: -58.255, este: -58.125, sur: -26.245, norte: -26.125 };
const COLUMNAS = 150;
const FILAS = 150;
const PERCENTIL = 0.2;
const URL = 'https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_S27_00_W059_00_DEM/Copernicus_DSM_COG_10_S27_00_W059_00_DEM.tif';

const tif = await fromUrl(URL);
const img = await tif.getImage();
const [x0, y1, x1, y0] = img.getBoundingBox(); // oeste, sur, este, norte
const ancho = img.getWidth();
const alto = img.getHeight();
const aPx = (lon) => ((lon - x0) / (x1 - x0)) * ancho;
const aPy = (lat) => ((y0 - lat) / (y0 - y1)) * alto;

// Ventana de píxeles que cubre el área (con un pequeño margen).
const px0 = Math.floor(aPx(AREA.oeste)) - 2;
const px1 = Math.ceil(aPx(AREA.este)) + 2;
const py0 = Math.floor(aPy(AREA.norte)) - 2;
const py1 = Math.ceil(aPy(AREA.sur)) + 2;
const [datos] = await img.readRasters({ window: [px0, py0, px1, py1] });
const anchoV = px1 - px0;
console.error(`ventana ${anchoV} x ${py1 - py0} píxeles`);

const cota = new Array(COLUMNAS * FILAS);
for (let fy = 0; fy < FILAS; fy++) {
  for (let fx = 0; fx < COLUMNAS; fx++) {
    const lonO = AREA.oeste + (fx / COLUMNAS) * (AREA.este - AREA.oeste);
    const lonE = AREA.oeste + ((fx + 1) / COLUMNAS) * (AREA.este - AREA.oeste);
    const latS = AREA.sur + (fy / FILAS) * (AREA.norte - AREA.sur);
    const latN = AREA.sur + ((fy + 1) / FILAS) * (AREA.norte - AREA.sur);
    const valores = [];
    for (let py = Math.floor(aPy(latN)); py <= Math.floor(aPy(latS)); py++) {
      for (let px = Math.floor(aPx(lonO)); px <= Math.floor(aPx(lonE)); px++) {
        const v = datos[(py - py0) * anchoV + (px - px0)];
        if (Number.isFinite(v) && v > -100) valores.push(v);
      }
    }
    valores.sort((a, b) => a - b);
    const v = valores.length ? valores[Math.floor((valores.length - 1) * PERCENTIL)] : null;
    cota[fy * COLUMNAS + fx] = v == null ? null : Math.round(v * 100) / 100;
  }
}

await mkdir('public/datos', { recursive: true });
await writeFile(
  'public/datos/terreno.json',
  JSON.stringify({
    fuente: 'Copernicus DEM GLO-30 (ESA/Airbus), tile S27 W059',
    url: URL,
    datum: 'EGM2008 (m)',
    metodo: `percentil ${PERCENTIL * 100} de los píxeles de 30 m en cada celda`,
    fecha: new Date().toISOString().slice(0, 10),
    area: AREA,
    columnas: COLUMNAS,
    filas: FILAS,
    cota,
  }),
);
const v = cota.filter((x) => x != null).sort((a, b) => a - b);
console.log('celdas', v.length, 'min', v[0], 'p10', v[Math.floor(v.length * 0.1)], 'p50', v[Math.floor(v.length / 2)], 'p90', v[Math.floor(v.length * 0.9)], 'max', v.at(-1));
