// Capas de deck.gl. Sirven igual sobre Google Maps o en el modo sin Google.
// Ciudad real (OpenStreetMap): calles, plazas, agua, escuelas y salud.
// Agua de la simulación: un cubo por celda mojada (GridCellLayer con datos binarios: rápido).

import { SolidPolygonLayer, PathLayer, ColumnLayer, GridCellLayer, TextLayer, ScatterplotLayer } from '@deck.gl/layers';
import { TIPOS_INFRA, COLUMNAS, FILAS, AREA } from '../escenario/datos-ficticios.js';
import { centroDeCelda, TAMANO_CELDA_M } from '../escenario/terreno.js';

const ANCHO_CELDA_LON = (AREA.este - AREA.oeste) / COLUMNAS;
const ALTO_CELDA_LAT = (AREA.norte - AREA.sur) / FILAS;
const TOTAL = COLUMNAS * FILAS;

// Esquina suroeste de cada celda (lo que espera GridCellLayer).
const ESQUINAS = new Float32Array(TOTAL * 2);
for (let i = 0; i < TOTAL; i++) {
  const x = i % COLUMNAS;
  const y = (i - x) / COLUMNAS;
  ESQUINAS[i * 2] = AREA.oeste + x * ANCHO_CELDA_LON;
  ESQUINAS[i * 2 + 1] = AREA.sur + y * ALTO_CELDA_LAT;
}
// El lado de la celda en metros (un poco más para que no queden rendijas entre cubos).
const LADO_CELDA_M = Math.max(ANCHO_CELDA_LON * 99900, ALTO_CELDA_LAT * 111320) + 1;

// Buffers del agua, se reutilizan entre cuadros.
const bufPos = new Float32Array(TOTAL * 2);
const bufAlto = new Float32Array(TOTAL);
const bufColor = new Uint8Array(TOTAL * 4);
const bufCelda = new Int32Array(TOTAL);
let cacheAgua = { clave: null, datos: null };

function datosDelAgua(agua, clave) {
  if (cacheAgua.clave === clave) return cacheAgua.datos;
  const { profundidad, origen } = agua;
  let n = 0;
  for (let i = 0; i < TOTAL; i++) {
    const p = profundidad[i];
    if (p <= 0) continue;
    bufPos[n * 2] = ESQUINAS[i * 2];
    bufPos[n * 2 + 1] = ESQUINAS[i * 2 + 1];
    const t = Math.min(1, p / 3);
    const k = n * 4;
    if (origen[i] === 3) {
      // Cauce: lámina plana (su profundidad real no aporta nada visual).
      bufAlto[n] = 0.2;
      bufColor[k] = 25;
      bufColor[k + 1] = 105;
      bufColor[k + 2] = 215;
      bufColor[k + 3] = 200;
    } else if (origen[i] === 2) {
      bufAlto[n] = Math.max(0.15, p);
      bufColor[k] = 70;
      bufColor[k + 1] = 235 - 60 * t;
      bufColor[k + 2] = 255;
      bufColor[k + 3] = 170 + 70 * t;
    } else {
      bufAlto[n] = Math.max(0.15, p);
      bufColor[k] = 30;
      bufColor[k + 1] = 165 - 95 * t;
      bufColor[k + 2] = 255;
      bufColor[k + 3] = 180 + 70 * t;
    }
    bufCelda[n] = i;
    n++;
  }
  // subarray crea vistas nuevas: deck.gl detecta el cambio y sube solo lo necesario.
  const datos = {
    length: n,
    celdas: bufCelda.subarray(0, n),
    attributes: {
      getPosition: { value: bufPos.subarray(0, n * 2), size: 2 },
      getElevation: { value: bufAlto.subarray(0, n), size: 1 },
      getFillColor: { value: bufColor.subarray(0, n * 4), size: 4, normalized: true },
    },
  };
  cacheAgua = { clave, datos };
  return datos;
}

export function colorEstadoInfra(item) {
  if (item.estado === 'afectado') return [255, 70, 80, 255];
  if (item.estado === 'riesgo') return [255, 200, 60, 255];
  return [...TIPOS_INFRA[item.tipo].color, 255];
}

const COLOR_CALLE = { 1: [120, 220, 255, 230], 2: [90, 190, 240, 170], 3: [70, 150, 210, 95] };
const ANCHO_CALLE = { 1: 14, 2: 9, 3: 5 };
const MEDIDA_INFRA = {
  escuela: { radio: 42, alto: 70 },
  salud: { radio: 70, alto: 130 },
};

// Capas fijas de la ciudad: se crean una sola vez.
let capasCiudad = null;
function crearCapasCiudad(ciudad) {
  return {
    aguaReal: new SolidPolygonLayer({
      id: 'agua-osm',
      data: ciudad.aguaPoligonos,
      getPolygon: (d) => d,
      getFillColor: [18, 70, 140, 200],
      parameters: { depthWriteEnabled: false },
    }),
    aguaLineas: new PathLayer({
      id: 'agua-osm-lineas',
      data: ciudad.aguaLineas,
      getPath: (d) => d,
      getColor: [40, 140, 230, 200],
      getWidth: 12,
      widthMinPixels: 1.5,
    }),
    plazas: new SolidPolygonLayer({
      id: 'plazas',
      data: ciudad.plazas,
      getPolygon: (d) => d.c,
      extruded: true,
      getElevation: 3,
      getFillColor: [60, 210, 140, 110],
      material: { ambient: 0.8, diffuse: 0.3 },
    }),
  };
}

// Defensa: las celdas del anillo como un muro bajo (se arma una vez por modelo).
const cacheDefensa = new Map();
function capaDefensa(modelo, conFalla) {
  const clave = conFalla ? 'falla' : 'normal';
  if (cacheDefensa.get('modelo') !== modelo) {
    cacheDefensa.clear();
    cacheDefensa.set('modelo', modelo);
  }
  if (!cacheDefensa.has(clave)) {
    const celdas = [];
    for (let i = 0; i < TOTAL; i++) if (modelo.esDefensa[i] && !(conFalla && modelo.esBrecha[i])) celdas.push(i);
    const pos = new Float32Array(celdas.length * 2);
    celdas.forEach((i, k) => {
      pos[k * 2] = ESQUINAS[i * 2];
      pos[k * 2 + 1] = ESQUINAS[i * 2 + 1];
    });
    cacheDefensa.set(
      clave,
      new GridCellLayer({
        id: 'defensa',
        data: { length: celdas.length, attributes: { getPosition: { value: pos, size: 2 } } },
        cellSize: LADO_CELDA_M,
        coverage: 0.55,
        extruded: true,
        getElevation: 22,
        getFillColor: [255, 180, 70, 150],
        material: { ambient: 0.8, diffuse: 0.4 },
      }),
    );
  }
  return cacheDefensa.get(clave);
}

// estado: { exageracion, conFalla, agua, infra, claveAgua, mostrarCalles, mostrarPlazas, mostrarNombres }
export function crearCapas(modelo, ciudad, estado, alPasar) {
  capasCiudad ??= crearCapasCiudad(ciudad);
  const capas = [capasCiudad.aguaReal, capasCiudad.aguaLineas];
  if (estado.mostrarPlazas) capas.push(capasCiudad.plazas);

  if (estado.mostrarCalles) {
    const { profundidad } = estado.agua;
    capas.push(
      new PathLayer({
        id: 'calles',
        data: ciudad.calles,
        getPath: (d) => d.c,
        getColor: (d) => (profundidad[d.celda] > 0 ? [255, 90, 120, 230] : COLOR_CALLE[d.n]),
        getWidth: (d) => ANCHO_CALLE[d.n],
        widthMinPixels: 1,
        widthMaxPixels: 6,
        capRounded: false,
        updateTriggers: { getColor: [estado.claveAgua] },
      }),
    );
  }

  const datosAgua = datosDelAgua(estado.agua, estado.claveAgua);
  capas.push(
    new GridCellLayer({
      id: 'agua',
      data: datosAgua,
      cellSize: LADO_CELDA_M,
      extruded: true,
      elevationScale: estado.exageracion,
      material: { ambient: 0.55, diffuse: 0.5, shininess: 90, specularColor: [180, 230, 255] },
      parameters: { depthWriteEnabled: false },
      pickable: true,
      onHover: alPasar,
    }),
  );

  capas.push(capaDefensa(modelo, estado.conFalla));
  if (estado.conFalla) {
    capas.push(
      new ScatterplotLayer({
        id: 'brecha',
        data: [modelo.brecha],
        getPosition: ([lon, lat]) => [lon, lat, 12],
        getRadius: 260,
        radiusMinPixels: 6,
        stroked: true,
        getFillColor: [255, 50, 70, 90],
        getLineColor: [255, 80, 90, 255],
        lineWidthMinPixels: 2,
      }),
    );
  }

  // Escuelas y salud como cubos (cajas de 4 lados).
  // ColumnLayer usa un solo radio por capa: una capa por tipo.
  for (const tipo of ['escuela', 'salud']) {
    capas.push(
      new ColumnLayer({
        id: `infra-${tipo}`,
        data: estado.infraPorTipo[tipo],
        getPosition: (item) => item.pos,
        diskResolution: 4,
        angle: 45,
        radius: MEDIDA_INFRA[tipo].radio,
        getElevation: MEDIDA_INFRA[tipo].alto,
        extruded: true,
        wireframe: true,
        getFillColor: colorEstadoInfra,
        getLineColor: [230, 250, 255, 200],
        material: { ambient: 0.7, diffuse: 0.5 },
        pickable: true,
        autoHighlight: true,
        highlightColor: [255, 255, 255, 90],
        onHover: alPasar,
        updateTriggers: { getFillColor: [estado.claveInfra] },
      }),
    );
  }

  if (estado.mostrarNombres) {
    capas.push(
      new TextLayer({
        id: 'infra-etiqueta',
        data: estado.infra.filter((i) => i.tipo === 'salud' || i.estado !== 'normal'),
        getPosition: (item) => [...item.pos, MEDIDA_INFRA[item.tipo].alto + 25],
        getText: (item) => item.corto,
        getSize: 12,
        getColor: colorEstadoInfra,
        fontFamily: 'Consolas, "Courier New", monospace',
        fontWeight: 700,
        outlineWidth: 2,
        outlineColor: [5, 12, 25, 255],
        fontSettings: { sdf: true },
        characterSet: 'auto',
        billboard: true,
        updateTriggers: { getColor: [estado.claveInfra] },
      }),
    );
  }

  return capas;
}

export function textoDeAyuda(info, modelo, estado) {
  if (!info || !info.picked) return null;
  if (info.layer?.id.startsWith('infra-')) {
    const item = info.object;
    const umbralTexto = item.umbralActual > 30 ? 'el río no la alcanza' : `${item.umbralActual.toFixed(2)} m en la escala`;
    const prioridad = { afectado: 'EVALUAR (expuesta en este escenario)', riesgo: 'VIGILAR (a < 0,60 m)', normal: 'sin exposición en este escenario' }[item.estado];
    return `${item.nombre}\n${TIPOS_INFRA[item.tipo].etiqueta} · ${item.dentroDefensa ? 'dentro' : 'fuera'} de la defensa\nExpuesta al río desde: ${umbralTexto}\nPrioridad: ${prioridad}${item.detalle ? `\n${item.detalle}` : ''}\nFuente: ${item.fuente ?? 'OSM'} · zona a evaluar, no veredicto`;
  }
  if (info.layer?.id === 'agua') {
    const i = cacheAgua.datos?.celdas[info.index];
    if (i == null) return null;
    const p = estado.agua.profundidad[i];
    const [lon, lat] = centroDeCelda(i);
    const origen = ['seco', 'río', 'lluvia', 'cauce'][estado.agua.origen[i]];
    return `${lat.toFixed(4)}, ${lon.toFixed(4)} · celda de ${TAMANO_CELDA_M} m\nLámina del escenario: ~${p.toFixed(1)} m (${origen})\nTerreno: ${modelo.cotaTerreno[i].toFixed(1)} m (Copernicus, ±2 m) · orientativo`;
  }
  return null;
}
