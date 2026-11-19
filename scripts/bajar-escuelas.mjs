// Descarga los establecimientos educativos del Mapa Educativo Nacional (Ministerio de Educación,
// padrón oficial, licencia CC BY 4.0) para el área del modelo y los guarda en public/datos/escuelas-men.json.
// Los establecimientos que comparten edificio (mismas coordenadas) se agrupan en un solo punto.
// Uso: node scripts/bajar-escuelas.mjs

import { writeFile, mkdir } from 'node:fs/promises';

const AREA = { oeste: -58.255, este: -58.125, sur: -26.245, norte: -26.125 };
const url =
  'https://mapa.educacion.gob.ar/geoserver/ows?service=WFS&version=2.0.0&request=GetFeature' +
  '&typeNames=publico:establecimiento_educativo&outputFormat=application/json&srsName=EPSG:4326' +
  `&bbox=${AREA.sur},${AREA.oeste},${AREA.norte},${AREA.este},urn:ogc:def:crs:EPSG::4326`;

const r = await fetch(url, { headers: { 'User-Agent': 'operacion-agua-prototipo' } });
if (!r.ok) throw new Error(`Mapa Educativo respondió ${r.status}`);
const geo = await r.json();

const grupos = new Map();
for (const f of geo.features) {
  const p = f.properties;
  if (p.fun && p.fun !== 'Activo') continue;
  const [lon, lat] = f.geometry.coordinates;
  const clave = `${lon.toFixed(5)}|${lat.toFixed(5)}`;
  const g = grupos.get(clave) ?? { pos: [Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5], establecimientos: [], precision: p.pre };
  g.establecimientos.push({
    nombre: p.nam || p.fna,
    cue: p.cue,
    niveles: (p.nen || '').replace(/;\s*$/, ''),
    gestion: p.ges,
  });
  grupos.set(clave, g);
}

const escuelas = [...grupos.values()];
await mkdir('public/datos', { recursive: true });
await writeFile(
  'public/datos/escuelas-men.json',
  JSON.stringify({
    fuente: 'Mapa Educativo Nacional – Ministerio de Educación (CC BY 4.0)',
    url: 'https://mapa.educacion.gob.ar/geoservicios',
    fecha: new Date().toISOString().slice(0, 10),
    escuelas,
  }),
);
console.log(`${geo.features.length} establecimientos → ${escuelas.length} edificios`);
