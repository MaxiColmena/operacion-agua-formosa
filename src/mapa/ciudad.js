// Carga la ciudad real (OpenStreetMap) ya simplificada por scripts/bajar-osm.mjs.

import { celdaDePunto } from '../escenario/terreno.js';
import { AREA, GEOGRAFIA } from '../escenario/datos-ficticios.js';

const igual = (a, b) => a[0] === b[0] && a[1] === b[1];

// Une tramos sueltos (miembros "outer" de una relación) en anillos cerrados.
function unirAnillos(tramos) {
  const pendientes = tramos.map((t) => [...t]);
  const anillos = [];
  const abiertos = [];
  while (pendientes.length) {
    let anillo = pendientes.pop();
    let avanzo = true;
    while (!igual(anillo[0], anillo.at(-1)) && avanzo) {
      avanzo = false;
      for (let k = 0; k < pendientes.length; k++) {
        const t = pendientes[k];
        const fin = anillo.at(-1);
        if (igual(t[0], fin)) anillo = anillo.concat(t.slice(1));
        else if (igual(t.at(-1), fin)) anillo = anillo.concat([...t].reverse().slice(1));
        else if (igual(t.at(-1), anillo[0])) anillo = t.concat(anillo.slice(1));
        else if (igual(t[0], anillo[0])) anillo = [...t].reverse().concat(anillo.slice(1));
        else continue;
        pendientes.splice(k, 1);
        avanzo = true;
        break;
      }
    }
    (igual(anillo[0], anillo.at(-1)) ? anillos : abiertos).push(anillo);
  }
  return { anillos, abiertos };
}

const dentroDelArea = ([lon, lat]) =>
  lon >= AREA.oeste - 0.02 && lon <= AREA.este + 0.02 && lat >= AREA.sur - 0.02 && lat <= AREA.norte + 0.02;

function acortar(nombre, max = 26) {
  const limpio = nombre
    .replace(/^Escuela\s+(Provincial\s+)?(de\s+Educaci[oó]n\s+\w+\s+)?/i, 'Esc. ')
    .replace(/^Hospital\s+/i, 'Hosp. ')
    .replace(/^Centro de Salud\s+/i, 'C.S. ');
  return limpio.length > max ? `${limpio.slice(0, max - 1)}…` : limpio;
}

// Ríos que traen el agua del Paraguay: el propio río y el Riacho Formosa (desemboca en él).
// Los demás arroyos y canales son cauces bajos dentro del terreno: se llenan con lluvia.
// Exportada para usarla igual en Node (tests) y en el navegador.
export function armarGeografia(lineas, poligonos) {
  const rios = [];
  const cauces = [];
  for (const l of lineas) {
    if (/Paraguay/i.test(l.nombre)) rios.push({ linea: l.c, semiAnchoM: GEOGRAFIA.semiAnchoParaguayM });
    else if (/Riacho Formosa/i.test(l.nombre)) rios.push({ linea: l.c, semiAnchoM: GEOGRAFIA.semiAnchoRiachoM });
    else if (l.tipo === 'river' || l.tipo === 'stream' || l.tipo === 'canal') cauces.push(l.c);
  }
  return { rios, cauces, lagunas: poligonos, defensa: GEOGRAFIA.defensa, brechaCerca: GEOGRAFIA.brechaCerca };
}

export async function cargarCiudad() {
  const r = await fetch(`${import.meta.env.BASE_URL}datos/formosa-osm.json`);
  if (!r.ok) throw new Error(`No se pudo cargar formosa-osm.json (${r.status})`);
  const osm = await r.json();

  const calles = osm.calles.map((c) => ({ ...c, celda: celdaDePunto(c.c[Math.floor(c.c.length / 2)]) }));
  calles.sort((a, b) => b.n - a.n); // las principales se dibujan arriba

  const plazas = osm.plazas.filter((p) => p.c.length > 3 && igual(p.c[0], p.c.at(-1)));

  const aguaPoligonos = [];
  const aguaLineas = [];
  const partes = [];
  for (const a of osm.agua) {
    if (a.parte) partes.push(a.c);
    else if (a.cerrado) aguaPoligonos.push(a.c);
    else aguaLineas.push(a);
  }
  const { anillos, abiertos } = unirAnillos(partes);
  for (const anillo of anillos) {
    if (anillo.some(dentroDelArea)) aguaPoligonos.push(anillo);
  }
  for (const l of abiertos) if (l.some(dentroDelArea)) aguaLineas.push({ tipo: 'agua', nombre: '', c: l });

  // Geografía para el modelo de agua: ríos (con su semiancho) y lagunas reales.
  const geo = armarGeografia(aguaLineas, aguaPoligonos);

  const infra = [];
  osm.escuelas.forEach((e, k) => {
    const nombre = e.nombre || 'Escuela sin nombre en OSM';
    infra.push({ id: `E${k + 1}`, tipo: 'escuela', nombre, corto: acortar(nombre), pos: e.pos });
  });
  osm.salud.forEach((s, k) => {
    const nombre = s.nombre || 'Centro de salud sin nombre en OSM';
    infra.push({ id: `H${k + 1}`, tipo: 'salud', nombre, corto: acortar(nombre), pos: s.pos });
  });

  return {
    fecha: osm.fecha,
    calles,
    plazas,
    aguaPoligonos,
    aguaLineas: aguaLineas.map((l) => l.c),
    geo,
    diques: osm.diques,
    infra: infra.filter((i) => dentroDelArea(i.pos)),
  };
}
