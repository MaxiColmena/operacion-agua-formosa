// Genera el terreno FICTICIO de la grilla y precalcula lo necesario para animar el agua.

import {
  AREA,
  COLUMNAS,
  FILAS,
  CERO_ESCALA,
  RIO,
  ANCHO_RIO_M,
  RIACHO,
  DEFENSA,
  BRECHA,
  RADIO_BRECHA_M,
  CORONAMIENTO,
  BAJOS,
  INFRAESTRUCTURA,
} from './datos-ficticios.js';
import { distanciaAPolilinea, puntoEnPoligono, aMetros, metrosPorGradoLon, METROS_POR_GRADO_LAT } from './geo.js';
import { calcularCotaDeDesborde, calcularProfundidadDeBajos } from './inundacion.js';

const ANCHO_CELDA_LON = (AREA.este - AREA.oeste) / COLUMNAS;
const ALTO_CELDA_LAT = (AREA.norte - AREA.sur) / FILAS;

export function centroDeCelda(i) {
  const x = i % COLUMNAS;
  const y = (i - x) / COLUMNAS;
  return [AREA.oeste + (x + 0.5) * ANCHO_CELDA_LON, AREA.sur + (y + 0.5) * ALTO_CELDA_LAT];
}

export function poligonoDeCelda(i) {
  const x = i % COLUMNAS;
  const y = (i - x) / COLUMNAS;
  const o = AREA.oeste + x * ANCHO_CELDA_LON;
  const s = AREA.sur + y * ALTO_CELDA_LAT;
  return [
    [o, s],
    [o + ANCHO_CELDA_LON, s],
    [o + ANCHO_CELDA_LON, s + ALTO_CELDA_LAT],
    [o, s + ALTO_CELDA_LAT],
  ];
}

export function celdaDePunto([lon, lat]) {
  const x = Math.min(COLUMNAS - 1, Math.max(0, Math.floor((lon - AREA.oeste) / ANCHO_CELDA_LON)));
  const y = Math.min(FILAS - 1, Math.max(0, Math.floor((lat - AREA.sur) / ALTO_CELDA_LAT)));
  return y * COLUMNAS + x;
}

export const TAMANO_CELDA_M = Math.round(
  Math.min(ANCHO_CELDA_LON * metrosPorGradoLon(-26.185), ALTO_CELDA_LAT * METROS_POR_GRADO_LAT),
);

// Ruido suave y determinístico (siempre da el mismo terreno).
function ruido(x, y) {
  return (
    0.55 * Math.sin(x * 0.0021 + 1.3) * Math.cos(y * 0.0017 - 0.4) +
    0.3 * Math.sin(x * 0.0053 - y * 0.0041 + 2.1) +
    0.15 * Math.cos(x * 0.011 + y * 0.009)
  );
}

function generarTerreno() {
  const total = COLUMNAS * FILAS;
  const cotaTerreno = new Float64Array(total);
  const esRio = new Uint8Array(total);
  const dentroDefensa = new Uint8Array(total);
  const esDefensa = new Uint8Array(total);
  const esBrecha = new Uint8Array(total);
  const origen = [AREA.oeste, AREA.sur];
  const bordeDefensa = [...DEFENSA, DEFENSA[0]];

  for (let i = 0; i < total; i++) {
    const p = centroDeCelda(i);
    const [mx, my] = aMetros(p, origen);
    const dRio = distanciaAPolilinea(p, RIO);

    if (dRio < ANCHO_RIO_M / 2) {
      esRio[i] = 1;
      cotaTerreno[i] = CERO_ESCALA - 3 - 2 * (1 - dRio / (ANCHO_RIO_M / 2));
      continue;
    }

    const distanciaCosta = dRio - ANCHO_RIO_M / 2;
    let z = CERO_ESCALA + 6.2 + 8.5 * (1 - Math.exp(-distanciaCosta / 2600));
    z += 1.1 * ruido(mx, my);

    const dRiacho = distanciaAPolilinea(p, RIACHO);
    if (dRiacho < 220) z -= 3.2 * (1 - dRiacho / 220);

    for (const bajo of BAJOS) {
      const d = Math.hypot(...aMetros(p, bajo.centro));
      if (d < bajo.radio * 1.6) z -= bajo.profundidad * Math.exp(-((d / bajo.radio) ** 2));
    }
    cotaTerreno[i] = z;

    dentroDefensa[i] = puntoEnPoligono(p, DEFENSA) ? 1 : 0;
    const dDefensa = distanciaAPolilinea(p, bordeDefensa);
    if (dDefensa < TAMANO_CELDA_M * 0.75) {
      esDefensa[i] = 1;
      const dBrecha = Math.hypot(...aMetros(p, BRECHA));
      if (dBrecha < RADIO_BRECHA_M) esBrecha[i] = 1;
    }
  }
  return { cotaTerreno, esRio, dentroDefensa, esDefensa, esBrecha };
}

// Cota "efectiva" que ve el agua: el terreno, salvo en la defensa (salvo que haya falla).
function cotaConDefensa(base, conFalla) {
  const { cotaTerreno, esDefensa, esBrecha } = base;
  const cota = new Float64Array(cotaTerreno);
  for (let i = 0; i < cota.length; i++) {
    if (esDefensa[i] && !(conFalla && esBrecha[i])) cota[i] = Math.max(cota[i], CORONAMIENTO);
  }
  return cota;
}

// ---------- Terreno a partir de la geografía real (OpenStreetMap) ----------
// Río y lagunas en su lugar real. La cota sigue siendo FICTICIA: crece al alejarse del agua.
// geo: { rios: [{ linea, semiAnchoM }], lagunas: [[lon, lat], ...][], urbano: [[lon, lat], ...], brechaCerca: [lon, lat] }

const SEPARACION_DEFENSA_CELDAS = 4; // el anillo pasa a ~4 celdas (~350 m) del agua

function cajaDe(poligono) {
  let [o, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [lon, lat] of poligono) {
    o = Math.min(o, lon);
    e = Math.max(e, lon);
    s = Math.min(s, lat);
    n = Math.max(n, lat);
  }
  return { o, s, e, n };
}

function distanciaEnCeldas(fuentes) {
  const total = COLUMNAS * FILAS;
  const dist = new Int32Array(total).fill(-1);
  const cola = new Int32Array(total);
  let ini = 0;
  let fin = 0;
  for (let i = 0; i < total; i++) {
    if (fuentes[i]) {
      dist[i] = 0;
      cola[fin++] = i;
    }
  }
  while (ini < fin) {
    const i = cola[ini++];
    const x = i % COLUMNAS;
    const y = (i - x) / COLUMNAS;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= COLUMNAS || ny >= FILAS) continue;
      const v = ny * COLUMNAS + nx;
      if (dist[v] >= 0) continue;
      dist[v] = dist[i] + 1;
      cola[fin++] = v;
    }
  }
  return dist;
}

function generarTerrenoReal(geo) {
  const total = COLUMNAS * FILAS;
  const cotaTerreno = new Float64Array(total);
  const esRio = new Uint8Array(total);
  const dentroDefensa = new Uint8Array(total);
  const esDefensa = new Uint8Array(total);
  const esBrecha = new Uint8Array(total);
  const profLaguna = new Float64Array(total);
  const origen = [AREA.oeste, AREA.sur];

  // 1. Río: franja alrededor de cada línea de río.
  const rios = geo.rios.map((r) => ({ ...r, caja: cajaDe(r.linea) }));
  for (let i = 0; i < total; i++) {
    const p = centroDeCelda(i);
    for (const r of rios) {
      const m = r.semiAnchoM / METROS_POR_GRADO_LAT + 0.001;
      if (p[0] < r.caja.o - m * 1.2 || p[0] > r.caja.e + m * 1.2 || p[1] < r.caja.s - m || p[1] > r.caja.n + m) continue;
      if (distanciaAPolilinea(p, r.linea) < r.semiAnchoM) {
        esRio[i] = 1;
        break;
      }
    }
  }

  // 2. Lagunas y bañados reales: bajos del terreno.
  const lagunas = geo.lagunas.map((c) => ({ c, caja: cajaDe(c) }));
  for (let i = 0; i < total; i++) {
    if (esRio[i]) continue;
    const p = centroDeCelda(i);
    for (const l of lagunas) {
      if (p[0] < l.caja.o || p[0] > l.caja.e || p[1] < l.caja.s || p[1] > l.caja.n) continue;
      if (puntoEnPoligono(p, l.c)) {
        profLaguna[i] = 2.6;
        break;
      }
    }
  }

  // 2b. Arroyos y canales internos: cauces bajos (no traen agua del río).
  const cauces = (geo.cauces || []).map((linea) => ({ linea, caja: cajaDe(linea) }));
  for (let i = 0; i < total; i++) {
    if (esRio[i]) continue;
    const p = centroDeCelda(i);
    for (const c of cauces) {
      if (p[0] < c.caja.o - 0.001 || p[0] > c.caja.e + 0.001 || p[1] < c.caja.s - 0.001 || p[1] > c.caja.n + 0.001) continue;
      const d = distanciaAPolilinea(p, c.linea);
      if (d < 60) profLaguna[i] = Math.max(profLaguna[i], 2.2 * (1 - d / 90));
    }
  }

  // 3. Cota ficticia: sube al alejarse del agua, con ruido suave.
  const distRio = distanciaEnCeldas(esRio);
  for (let i = 0; i < total; i++) {
    const p = centroDeCelda(i);
    if (esRio[i]) {
      cotaTerreno[i] = CERO_ESCALA - 4;
      continue;
    }
    const [mx, my] = aMetros(p, origen);
    const d = distRio[i] * TAMANO_CELDA_M;
    let z = CERO_ESCALA + 6.4 + 8.5 * (1 - Math.exp(-d / 2600)) + 1.1 * ruido(mx, my);
    z -= profLaguna[i];
    cotaTerreno[i] = z;
  }

  // 4. Defensa: borde de (casco urbano ∩ celdas a más de N celdas del agua).
  const region = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    if (distRio[i] >= SEPARACION_DEFENSA_CELDAS && puntoEnPoligono(centroDeCelda(i), geo.urbano)) region[i] = 1;
  }
  let mejorBrecha = -1;
  let distBrecha = Infinity;
  for (let i = 0; i < total; i++) {
    if (!region[i]) continue;
    const x = i % COLUMNAS;
    const y = (i - x) / COLUMNAS;
    const borde =
      x === 0 || y === 0 || x === COLUMNAS - 1 || y === FILAS - 1 ||
      !region[i - 1] || !region[i + 1] || !region[i - COLUMNAS] || !region[i + COLUMNAS];
    if (borde) {
      esDefensa[i] = 1;
      const db = Math.hypot(...aMetros(centroDeCelda(i), geo.brechaCerca));
      if (db < distBrecha) {
        distBrecha = db;
        mejorBrecha = i;
      }
    } else {
      dentroDefensa[i] = 1;
    }
  }
  // Brecha: unas pocas celdas del anillo alrededor del punto más cercano al río.
  if (mejorBrecha >= 0) {
    const centro = centroDeCelda(mejorBrecha);
    for (let i = 0; i < total; i++) {
      if (esDefensa[i] && Math.hypot(...aMetros(centroDeCelda(i), centro)) < RADIO_BRECHA_M) esBrecha[i] = 1;
    }
  }

  return { cotaTerreno, esRio, dentroDefensa, esDefensa, esBrecha, brecha: mejorBrecha >= 0 ? centroDeCelda(mejorBrecha) : null };
}

export function crearModelo(geo = null) {
  const base = geo ? generarTerrenoReal(geo) : generarTerreno();
  const columnas = COLUMNAS;
  const filas = FILAS;

  const precalculo = {};
  for (const conFalla of [false, true]) {
    const cota = cotaConDefensa(base, conFalla);
    precalculo[conFalla ? 'falla' : 'normal'] = {
      desborde: calcularCotaDeDesborde({ cota, esRio: base.esRio, columnas, filas }),
      profundidadBajos: calcularProfundidadDeBajos({ cota, esRio: base.esRio, columnas, filas }),
    };
  }

  let minimo = Infinity;
  let maximo = -Infinity;
  for (let i = 0; i < base.cotaTerreno.length; i++) {
    if (base.esRio[i]) continue;
    minimo = Math.min(minimo, base.cotaTerreno[i]);
    maximo = Math.max(maximo, base.cotaTerreno[i]);
  }

  const modelo = { ...base, columnas, filas, precalculo, cotaMin: minimo, cotaMax: maximo };
  modelo.brecha ??= BRECHA;
  modelo.infraestructura = geo ? [] : ubicarInfraestructura(modelo, INFRAESTRUCTURA);
  return modelo;
}

// Ubica cada punto de infraestructura en su celda y calcula a qué nivel del río se afecta.
export function ubicarInfraestructura(modelo, lista) {
  const { precalculo, cotaTerreno, dentroDefensa } = modelo;
  return lista.map((item) => {
    const celda = celdaDePunto(item.pos);
    return {
      ...item,
      celda,
      cota: cotaTerreno[celda],
      dentroDefensa: !!dentroDefensa[celda],
      umbral: {
        normal: precalculo.normal.desborde[celda] - CERO_ESCALA,
        falla: precalculo.falla.desborde[celda] - CERO_ESCALA,
      },
    };
  });
}
