// Capas de deck.gl. Sirven igual sobre Google Maps o en el modo sin Google.

import { SolidPolygonLayer, PathLayer, ColumnLayer, TextLayer, ScatterplotLayer } from '@deck.gl/layers';
import {
  RIO,
  DEFENSA,
  BRECHA,
  CORONAMIENTO,
  CERO_ESCALA,
  TIPOS_INFRA,
  COLUMNAS,
  FILAS,
} from '../escenario/datos-ficticios.js';
import { poligonoDeCelda, centroDeCelda } from '../escenario/terreno.js';

const COTA_BASE = CERO_ESCALA - 6;

const TODAS_LAS_CELDAS = Array.from({ length: COLUMNAS * FILAS }, (_, i) => i);
const POLIGONOS = TODAS_LAS_CELDAS.map(poligonoDeCelda);

// Manzanas ficticias: un bloque en parte de las celdas dentro del anillo.
function generarManzanas(modelo) {
  const manzanas = [];
  for (let i = 0; i < modelo.cotaTerreno.length; i++) {
    if (!modelo.dentroDefensa[i] || modelo.esDefensa[i]) continue;
    const semilla = Math.sin(i * 12.9898) * 43758.5453;
    const azar = semilla - Math.floor(semilla);
    if (azar < 0.45) continue;
    const [c0, , c2] = POLIGONOS[i];
    const margenLon = (c2[0] - c0[0]) * 0.17;
    const margenLat = (c2[1] - c0[1]) * 0.17;
    manzanas.push({
      celda: i,
      altura: 4 + Math.round(azar * 14),
      contorno: [
        [c0[0] + margenLon, c0[1] + margenLat],
        [c2[0] - margenLon, c0[1] + margenLat],
        [c2[0] - margenLon, c2[1] - margenLat],
        [c0[0] + margenLon, c2[1] - margenLat],
      ],
    });
  }
  return manzanas;
}

let cacheManzanas = null;

function colorTerreno(cota, modelo) {
  const t = Math.min(1, Math.max(0, (cota - modelo.cotaMin) / (modelo.cotaMax - modelo.cotaMin)));
  return [16 + 34 * t, 26 + 52 * t, 34 + 48 * t, 255];
}

function colorAgua(profundidad, origen) {
  if (origen === 3) return [25, 110, 220, 170];
  const t = Math.min(1, profundidad / 3);
  if (origen === 2) return [70, 235 - 60 * t, 255, 150 + 80 * t];
  return [30, 165 - 95 * t, 255, 160 + 80 * t];
}

export function colorEstadoInfra(item) {
  if (item.estado === 'afectado') return [255, 70, 80, 255];
  if (item.estado === 'riesgo') return [255, 200, 60, 255];
  return [...TIPOS_INFRA[item.tipo].color, 255];
}

// estado: { exageracion, mostrarTerreno, mostrarManzanas, conFalla, agua, infra, tiempoClave }
export function crearCapas(modelo, estado, alPasar) {
  const exag = estado.exageracion;
  const { profundidad, origen, cotaAgua } = estado.agua;
  const zTerreno = (i) => (estado.mostrarTerreno ? (modelo.cotaTerreno[i] - COTA_BASE) * exag : 0);
  const claveAgua = estado.tiempoClave;
  const capas = [];

  if (estado.mostrarTerreno) {
    capas.push(
      new SolidPolygonLayer({
        id: 'terreno',
        data: TODAS_LAS_CELDAS,
        getPolygon: (i) => POLIGONOS[i],
        extruded: true,
        wireframe: false,
        getElevation: (i) => Math.max(1, zTerreno(i)),
        getFillColor: (i) => colorTerreno(modelo.cotaTerreno[i], modelo),
        material: { ambient: 0.6, diffuse: 0.45, shininess: 8, specularColor: [10, 30, 40] },
        pickable: true,
        onHover: alPasar,
        updateTriggers: { getElevation: [exag] },
      }),
    );
  }

  capas.push(
    new SolidPolygonLayer({
      id: 'agua',
      data: TODAS_LAS_CELDAS,
      getPolygon: (i) => POLIGONOS[i],
      extruded: true,
      getElevation: (i) => {
        if (profundidad[i] <= 0) return 0;
        if (estado.mostrarTerreno) return (Math.max(cotaAgua, modelo.cotaTerreno[i] + profundidad[i]) - COTA_BASE) * exag;
        return Math.max(2, profundidad[i] * exag);
      },
      getFillColor: (i) => (profundidad[i] > 0 ? colorAgua(profundidad[i], origen[i]) : [0, 0, 0, 0]),
      material: { ambient: 0.6, diffuse: 0.5, shininess: 80, specularColor: [180, 230, 255] },
      parameters: { depthWriteEnabled: false },
      pickable: !estado.mostrarTerreno,
      onHover: alPasar,
      transitions: { getElevation: 250 },
      updateTriggers: {
        getElevation: [claveAgua, exag, estado.mostrarTerreno],
        getFillColor: [claveAgua],
      },
    }),
  );

  if (estado.mostrarManzanas) {
    cacheManzanas ??= generarManzanas(modelo);
    capas.push(
      new SolidPolygonLayer({
        id: 'manzanas',
        data: cacheManzanas,
        getPolygon: (m) => m.contorno.map(([lon, lat]) => [lon, lat, zTerreno(m.celda)]),
        extruded: true,
        wireframe: true,
        getElevation: (m) => m.altura * 3,
        getFillColor: (m) => (profundidad[m.celda] > 0 ? [255, 90, 110, 200] : [70, 190, 255, 70]),
        getLineColor: (m) => (profundidad[m.celda] > 0 ? [255, 140, 150, 255] : [120, 230, 255, 200]),
        material: { ambient: 0.7, diffuse: 0.4 },
        updateTriggers: {
          getPolygon: [exag, estado.mostrarTerreno],
          getFillColor: [claveAgua],
          getLineColor: [claveAgua],
        },
      }),
    );
  }

  const zRio = estado.mostrarTerreno ? (cotaAgua - COTA_BASE) * exag + 4 : 6;
  capas.push(
    new PathLayer({
      id: 'rio-brillo',
      data: [RIO],
      getPath: (p) => p.map(([lon, lat]) => [lon, lat, zRio]),
      getColor: [60, 200, 255, 50],
      getWidth: 420,
      widthMinPixels: 6,
      updateTriggers: { getPath: [claveAgua, exag, estado.mostrarTerreno] },
    }),
  );

  const zDefensa = estado.mostrarTerreno ? (CORONAMIENTO - COTA_BASE) * exag + 6 : 12;
  const anillo = [...DEFENSA, DEFENSA[0]].map(([lon, lat]) => [lon, lat, zDefensa]);
  capas.push(
    new PathLayer({
      id: 'defensa-brillo',
      data: [anillo],
      getPath: (p) => p,
      getColor: [255, 170, 60, 60],
      getWidth: 120,
      widthMinPixels: 7,
      updateTriggers: { getPath: [exag, estado.mostrarTerreno] },
    }),
    new PathLayer({
      id: 'defensa',
      data: [anillo],
      getPath: (p) => p,
      getColor: [255, 190, 90, 255],
      getWidth: 25,
      widthMinPixels: 2,
      updateTriggers: { getPath: [exag, estado.mostrarTerreno] },
    }),
  );

  if (estado.conFalla) {
    capas.push(
      new ScatterplotLayer({
        id: 'brecha',
        data: [BRECHA],
        getPosition: ([lon, lat]) => [lon, lat, zDefensa + 10],
        getRadius: 260,
        radiusMinPixels: 6,
        stroked: true,
        filled: true,
        getFillColor: [255, 50, 70, 90],
        getLineColor: [255, 80, 90, 255],
        lineWidthMinPixels: 2,
        updateTriggers: { getPosition: [exag, estado.mostrarTerreno] },
      }),
    );
  }

  const zInfra = (item) => zTerreno(item.celda) + (estado.mostrarManzanas ? 10 : 0);
  capas.push(
    new ColumnLayer({
      id: 'infra-haz',
      data: estado.infra,
      getPosition: (item) => [...item.pos, zInfra(item)],
      diskResolution: 12,
      radius: 38,
      extruded: true,
      getElevation: (item) => (item.estado === 'afectado' ? 900 : 650),
      getFillColor: (item) => {
        const c = colorEstadoInfra(item);
        return [c[0], c[1], c[2], 170];
      },
      material: { ambient: 0.9, diffuse: 0.3 },
      pickable: true,
      onHover: alPasar,
      updateTriggers: {
        getPosition: [exag, estado.mostrarTerreno, estado.mostrarManzanas],
        getElevation: [claveAgua],
        getFillColor: [claveAgua],
      },
    }),
    new ScatterplotLayer({
      id: 'infra-base',
      data: estado.infra,
      getPosition: (item) => [...item.pos, zInfra(item) + 1],
      getRadius: 110,
      radiusMinPixels: 4,
      stroked: true,
      filled: true,
      getFillColor: (item) => {
        const c = colorEstadoInfra(item);
        return [c[0], c[1], c[2], 60];
      },
      getLineColor: colorEstadoInfra,
      lineWidthMinPixels: 1.5,
      updateTriggers: {
        getPosition: [exag, estado.mostrarTerreno, estado.mostrarManzanas],
        getFillColor: [claveAgua],
        getLineColor: [claveAgua],
      },
    }),
    new TextLayer({
      id: 'infra-etiqueta',
      data: estado.infra,
      getPosition: (item) => [...item.pos, zInfra(item) + (item.estado === 'afectado' ? 930 : 680)],
      getText: (item) => item.id,
      getSize: 13,
      getColor: colorEstadoInfra,
      fontFamily: 'Consolas, "Courier New", monospace',
      fontWeight: 700,
      outlineWidth: 2,
      outlineColor: [5, 12, 25, 255],
      fontSettings: { sdf: true },
      billboard: true,
      updateTriggers: {
        getPosition: [exag, estado.mostrarTerreno, estado.mostrarManzanas, claveAgua],
        getColor: [claveAgua],
      },
    }),
  );

  return capas;
}

export function textoDeAyuda(info, modelo, estado) {
  if (!info || !info.object && info.index < 0) return null;
  if (info.layer?.id === 'infra-haz') {
    const item = info.object;
    const umbral = estado.conFalla ? item.umbral.falla : item.umbral.normal;
    const umbralTexto = umbral > 30 ? 'no se alcanza' : `${umbral.toFixed(2)} m`;
    return `${item.nombre}\n${TIPOS_INFRA[item.tipo].etiqueta} · ${item.dentroDefensa ? 'dentro' : 'fuera'} de la defensa\nSe afecta por río con: ${umbralTexto}\nEstado: ${item.estado}`;
  }
  const i = typeof info.object === 'number' ? info.object : info.index;
  if (i == null || i < 0) return null;
  const p = estado.agua.profundidad[i];
  const origenes = ['seco', 'río', 'lluvia', 'cauce'];
  const [lon, lat] = centroDeCelda(i);
  return `Celda ${i} · ${lat.toFixed(4)}, ${lon.toFixed(4)}\nCota ficticia: ${modelo.cotaTerreno[i].toFixed(2)} m\nAgua: ${p > 0 ? p.toFixed(2) + ' m (' + origenes[estado.agua.origen[i]] + ')' : 'seco'}`;
}
