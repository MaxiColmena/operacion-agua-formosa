// Descarga calles, plazas, escuelas, salud y agua de Formosa Capital desde OpenStreetMap (Overpass)
// y los guarda simplificados en public/datos/formosa-osm.json.
// Uso: node scripts/bajar-osm.mjs   (solo hace falta correrlo para actualizar los datos)
// Datos © colaboradores de OpenStreetMap, licencia ODbL.

import { writeFile, readFile, mkdir } from 'node:fs/promises';

const AREA = { oeste: -58.255, este: -58.125, sur: -26.245, norte: -26.125 };
const bbox = `${AREA.sur},${AREA.oeste},${AREA.norte},${AREA.este}`;

// Consultas chicas (los servidores públicos rechazan una sola consulta grande).
// out geom(bbox) recorta la geometría al área: el río Paraguay entero sería enorme.
const PARTES = [
  `way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"](${bbox});`,
  `way["highway"~"^(unclassified|residential|living_street|pedestrian)$"](${bbox});`,
  `way["leisure"~"^(park|garden|pitch|playground)$"](${bbox}); way["place"="square"](${bbox});`,
  `nwr["amenity"~"^(school|kindergarten|college|university)$"](${bbox});`,
  `nwr["amenity"~"^(hospital|clinic)$"](${bbox}); nwr["healthcare"~"^(hospital|clinic|centre)$"](${bbox});`,
  `way["natural"="water"](${bbox}); way["waterway"~"^(river|riverbank|stream|canal)$"](${bbox}); way["man_made"="dyke"](${bbox}); way["embankment"="yes"](${bbox});`,
  `relation["natural"="water"](${bbox});`,
].map((p) => `[out:json][timeout:90];(${p});out geom(${bbox});`);

const SERVIDORES = process.env.SIN_RED
  ? []
  : [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.private.coffee/api/interpreter',
      'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
      'https://overpass-api.de/api/interpreter',
    ];

async function pedir() {
  // Cada parte se guarda en data/raw/ (ignorado por git) para no repetirla si otra falla.
  await mkdir('data/raw', { recursive: true });
  const elementos = [];
  for (const [k, consulta] of PARTES.entries()) {
    const cache = `data/raw/osm-parte-${k}.json`;
    let json;
    try {
      json = JSON.parse(await readFile(cache, 'utf8'));
    } catch {
      try {
        json = await pedirUna(consulta);
        await writeFile(cache, JSON.stringify(json));
      } catch (error) {
        // La última parte (el polígono del río Paraguay) es enorme y suele fallar: se dibuja con su línea.
        if (k !== PARTES.length - 1) throw error;
        console.error(`parte ${k} (opcional) no disponible: ${error.message}`);
        json = { elements: [] };
      }
    }
    console.error(`parte ${k}: ${json.elements.length} elementos`);
    elementos.push(...json.elements);
  }
  return { elements: elementos };
}

async function pedirUna(consulta) {
  for (const url of SERVIDORES) {
    try {
      console.error('Probando', url);
      const r = await fetch(url, {
        signal: AbortSignal.timeout(150000),
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'operacion-agua-prototipo' },
        body: 'data=' + encodeURIComponent(consulta),
      });
      if (r.ok) return await r.json();
      console.error(url, r.status);
    } catch (e) {
      console.error(url, e.message);
    }
  }
  throw new Error('Ningún servidor de Overpass respondió.');
}

const r5 = (n) => Math.round(n * 1e5) / 1e5;
// out geom(bbox) deja null en los puntos fuera del área.
const linea = (geom) => geom.filter(Boolean).map((p) => [r5(p.lon), r5(p.lat)]);
function tramos(geom) {
  const salida = [];
  let actual = [];
  for (const p of geom) {
    if (p) actual.push([r5(p.lon), r5(p.lat)]);
    else {
      if (actual.length > 1) salida.push(actual);
      actual = [];
    }
  }
  if (actual.length > 1) salida.push(actual);
  return salida;
}

// Simplificación Douglas-Peucker en grados (tolerancia ~3 m).
function simplificar(puntos, tol = 0.00003) {
  if (puntos.length < 3) return puntos;
  const [ax, ay] = puntos[0];
  const [bx, by] = puntos[puntos.length - 1];
  let max = 0;
  let idx = 0;
  for (let i = 1; i < puntos.length - 1; i++) {
    const [px, py] = puntos[i];
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy || 1e-18;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
    const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    if (d > max) {
      max = d;
      idx = i;
    }
  }
  if (max <= tol) return [puntos[0], puntos[puntos.length - 1]];
  return [...simplificar(puntos.slice(0, idx + 1), tol).slice(0, -1), ...simplificar(puntos.slice(idx), tol)];
}

function centro(el) {
  if (el.type === 'node') return [r5(el.lon), r5(el.lat)];
  const b = el.bounds;
  if (b) return [r5((b.minlon + b.maxlon) / 2), r5((b.minlat + b.maxlat) / 2)];
  return null;
}

const JERARQUIA = {
  motorway: 1, trunk: 1, primary: 1, secondary: 2, tertiary: 2,
  unclassified: 3, residential: 3, living_street: 3, pedestrian: 3,
};

const datos = await pedir();
const salida = { fuente: 'OpenStreetMap (ODbL)', fecha: new Date().toISOString().slice(0, 10), area: AREA, calles: [], plazas: [], escuelas: [], salud: [], agua: [], diques: [] };
const vistos = new Set();

for (const el of datos.elements) {
  const t = el.tags || {};
  const nombre = t.name || '';

  if (t.highway && el.geometry) {
    for (const tramo of tramos(el.geometry)) salida.calles.push({ n: JERARQUIA[t.highway] || 3, c: simplificar(tramo) });
    continue;
  }

  const esEscuela = /^(school|kindergarten|college|university)$/.test(t.amenity || '');
  const esSalud = /^(hospital|clinic)$/.test(t.amenity || '') || /^(hospital|clinic|centre)$/.test(t.healthcare || '');
  if (esEscuela || esSalud) {
    const pos = centro(el);
    if (!pos) continue;
    const clave = `${esEscuela ? 'e' : 's'}|${nombre}|${pos[0].toFixed(3)}|${pos[1].toFixed(3)}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    const tipo = t.amenity || t.healthcare;
    const item = { nombre, tipo, pos };
    if (el.type === 'way' && el.geometry) item.contorno = simplificar(linea(el.geometry));
    (esEscuela ? salida.escuelas : salida.salud).push(item);
    continue;
  }

  if ((t.leisure || t.place === 'square') && el.geometry) {
    salida.plazas.push({ nombre, c: simplificar(linea(el.geometry)) });
    continue;
  }

  if (t.man_made === 'dyke' || t.embankment === 'yes') {
    if (el.geometry) for (const tramo of tramos(el.geometry)) salida.diques.push(simplificar(tramo));
    continue;
  }

  if (t.natural === 'water' || t.waterway) {
    if (el.type === 'way' && el.geometry) {
      const cerrado = el.nodes?.[0] === el.nodes?.at(-1);
      if (cerrado) {
        const c = simplificar(linea(el.geometry));
        if (c.length > 3) salida.agua.push({ tipo: t.water || 'agua', nombre, cerrado, c: [...c.slice(0, -1), c[0]] });
      } else {
        for (const tramo of tramos(el.geometry)) salida.agua.push({ tipo: t.waterway || 'agua', nombre, cerrado: false, c: simplificar(tramo) });
      }
    } else if (el.type === 'relation') {
      for (const m of el.members || []) {
        if (m.role === 'outer' && m.geometry) salida.agua.push({ tipo: t.water || 'agua', nombre, cerrado: false, parte: true, c: simplificar(linea(m.geometry)) });
      }
    }
  }
}

await mkdir('public/datos', { recursive: true });
await writeFile('public/datos/formosa-osm.json', JSON.stringify(salida));
console.log(
  Object.fromEntries(Object.entries(salida).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.length])),
);
