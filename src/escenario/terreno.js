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

export function crearModelo() {
  const base = generarTerreno();
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

  const infraestructura = INFRAESTRUCTURA.map((item) => {
    const celda = celdaDePunto(item.pos);
    return {
      ...item,
      celda,
      cota: base.cotaTerreno[celda],
      dentroDefensa: !!base.dentroDefensa[celda],
      umbral: {
        normal: precalculo.normal.desborde[celda] - CERO_ESCALA,
        falla: precalculo.falla.desborde[celda] - CERO_ESCALA,
      },
    };
  });

  return { ...base, columnas, filas, precalculo, infraestructura, cotaMin: minimo, cotaMax: maximo };
}
