// TODO lo de este archivo es FICTICIO. Sirve para el prototipo visual.
// No representa el terreno, la defensa ni la infraestructura reales de Formosa.
// Lo único real son los umbrales del INA para Puerto Formosa (alerta 7,80 m y evacuación 8,30 m).

import { desplazarOeste } from './geo.js';
import { DEFENSA_REAL, BRECHA_REAL } from './defensa-formosa.js';

export const AREA = { oeste: -58.255, este: -58.125, sur: -26.245, norte: -26.125 };
export const CENTRO = [-58.19, -26.185];

export const COLUMNAS = 150;
export const FILAS = 150;

// Cota del cero de la escala de Puerto Formosa (m IGN). REAL: la defensa está a cota IGN 59 m = 11,70 m en el
// hidrómetro del puerto (Gobierno de Formosa, 08/12/2015), así que el cero es 59 - 11,70 = 47,30 m.
export const CERO_ESCALA = 47.3;

// Umbrales reales del INA para Puerto Formosa (m en la escala).
export const UMBRALES_INA = { alerta: 7.8, evacuacion: 8.3 };

// Traza aproximada del río Paraguay frente a la ciudad (simplificada a mano).
export const RIO = [
  [-58.176, -26.118],
  [-58.168, -26.14],
  [-58.163, -26.16],
  [-58.158, -26.18],
  [-58.152, -26.2],
  [-58.145, -26.22],
  [-58.136, -26.25],
];
export const ANCHO_RIO_M = 650;

// Riacho ficticio que entra desde el oeste y desemboca en el río.
export const RIACHO = [
  [-58.252, -26.214],
  [-58.23, -26.21],
  [-58.205, -26.216],
  [-58.185, -26.212],
  [-58.165, -26.205],
  [-58.153, -26.199],
];

// Anillo de defensa ficticio: borde costero desplazado 900 m tierra adentro y cerrado al oeste.
const COSTA_DEFENSA = desplazarOeste(
  RIO.filter(([, lat]) => lat <= -26.145 && lat >= -26.225),
  900,
);
export const DEFENSA = [
  ...COSTA_DEFENSA,
  [-58.215, -26.225],
  [-58.218, -26.145],
];

// Supuestos para armar el modelo sobre la geografía real de OSM. El río y las lagunas son reales.
// La defensa es la traza aproximada del anillo real (ver defensa-formosa.js). El ancho del río y
// el lugar de la brecha son supuestos.
export const GEOGRAFIA = {
  semiAnchoParaguayM: 230, // el Paraguay frente a Formosa tiene ~450 m de ancho [Probable]
  semiAnchoRiachoM: 45, // riachos y arroyos: una celda
  defensa: DEFENSA_REAL,
  brechaCerca: BRECHA_REAL, // la brecha se abre en el tramo del anillo más cercano a este punto
};

// Punto donde se abre la brecha cuando se activa "falla de la defensa".
export const BRECHA = [-58.1672, -26.18];
export const RADIO_BRECHA_M = 260;

// Coronamiento de la defensa: 11,70 m en la escala del puerto (dato oficial de 2015).
export const NIVEL_CORONAMIENTO = 11.7;
export const CORONAMIENTO = CERO_ESCALA + NIVEL_CORONAMIENTO;

// Lagunas y bajos ficticios (depresiones del terreno).
export const BAJOS = [
  { nombre: 'Bajo Norte (ficticio)', centro: [-58.2, -26.155], radio: 650, profundidad: 3.2 },
  { nombre: 'Laguna Oeste (ficticia)', centro: [-58.235, -26.175], radio: 800, profundidad: 3.6 },
  { nombre: 'Bajo Centro (ficticio)', centro: [-58.188, -26.192], radio: 420, profundidad: 2.4 },
  { nombre: 'Bajo Sur (ficticio)', centro: [-58.2, -26.228], radio: 600, profundidad: 2.8 },
  { nombre: 'Bañado Ribereño (ficticio)', centro: [-58.162, -26.235], radio: 900, profundidad: 2.2 },
];

// Infraestructura crítica FICTICIA (nombres inventados).
export const INFRAESTRUCTURA = [
  { id: 'E1', tipo: 'escuela', nombre: 'Escuela Ficticia N° 1', pos: [-58.181, -26.17] },
  { id: 'E2', tipo: 'escuela', nombre: 'Escuela Ficticia N° 2', pos: [-58.198, -26.2] },
  { id: 'E3', tipo: 'escuela', nombre: 'Escuela Ficticia N° 3', pos: [-58.1715, -26.152] },
  { id: 'E4', tipo: 'escuela', nombre: 'Escuela Ficticia N° 4', pos: [-58.211, -26.165] },
  { id: 'E5', tipo: 'escuela', nombre: 'Escuela Ficticia N° 5', pos: [-58.158, -26.228] },
  { id: 'E6', tipo: 'escuela', nombre: 'Escuela Ficticia N° 6', pos: [-58.188, -26.215] },
  { id: 'H1', tipo: 'salud', nombre: 'Hospital Ficticio Central', pos: [-58.19, -26.182] },
  { id: 'H2', tipo: 'salud', nombre: 'Centro de Salud Ficticio Norte', pos: [-58.172, -26.142] },
  { id: 'H3', tipo: 'salud', nombre: 'Centro de Salud Ficticio Ribera', pos: [-58.162, -26.212] },
  { id: 'H4', tipo: 'salud', nombre: 'Centro de Salud Ficticio Oeste', pos: [-58.228, -26.195] },
  { id: 'C1', tipo: 'evacuados', nombre: 'Centro de Evacuados Ficticio A', pos: [-58.205, -26.18] },
  { id: 'C2', tipo: 'evacuados', nombre: 'Centro de Evacuados Ficticio B', pos: [-58.176, -26.198] },
  { id: 'B1', tipo: 'bombeo', nombre: 'Estación de Bombeo Ficticia 1', pos: [-58.171, -26.163] },
  { id: 'B2', tipo: 'bombeo', nombre: 'Estación de Bombeo Ficticia 2', pos: [-58.166, -26.19] },
  { id: 'B3', tipo: 'bombeo', nombre: 'Estación de Bombeo Ficticia 3', pos: [-58.159, -26.215] },
];

export const TIPOS_INFRA = {
  escuela: { etiqueta: 'Escuela', color: [80, 200, 255] },
  salud: { etiqueta: 'Salud', color: [120, 255, 170] },
  evacuados: { etiqueta: 'Centro de evacuados', color: [255, 210, 90] },
  bombeo: { etiqueta: 'Estación de bombeo', color: [200, 140, 255] },
};

// Supuestos ficticios del drenaje pluvial.
export const DRENAJE = {
  capacidadNormalMm: 45, // lluvia que el sistema absorbe sin anegar
  capacidadRioAltoMm: 20, // con el río alto, las bombas trabajan al límite
  umbralRioAltoM: 6.5, // nivel del río (escala) desde el que se reduce la capacidad
  mmParaLlenarBajos: 110, // exceso de lluvia que llena por completo un bajo
};

// Casos ficticios: serie temporal (horas) de nivel del río (m en la escala) y lluvia acumulada (mm).
export const CASOS = [
  {
    id: 'crecida-nino',
    nombre: 'Crecida lenta del río (tipo El Niño)',
    descripcion:
      'El río sube durante tres semanas por lluvias en la cuenca alta y el remanso del Paraná. Lluvias locales moderadas.',
    unidad: 'dias',
    duracionH: 30 * 24,
    serie: [
      [0, 4.8, 0],
      [5 * 24, 5.6, 10],
      [10 * 24, 6.7, 25],
      [15 * 24, 7.9, 40],
      [19 * 24, 8.7, 70],
      [22 * 24, 9.1, 85],
      [26 * 24, 8.4, 95],
      [30 * 24, 7.6, 100],
    ],
  },
  {
    id: 'tormenta',
    nombre: 'Tormenta intensa con río normal',
    descripcion: 'Caen 140 mm en 6 horas sobre la ciudad. El río está en aguas medias.',
    unidad: 'horas',
    duracionH: 12,
    serie: [
      [0, 4.8, 0],
      [1, 4.8, 20],
      [2, 4.8, 55],
      [3, 4.8, 95],
      [4, 4.8, 120],
      [6, 4.8, 140],
      [12, 4.8, 140],
    ],
  },
  {
    id: 'combinado',
    nombre: 'Combinado: río alto + tormenta',
    descripcion: 'Con el río en alerta, una tormenta de 120 mm. El agua de lluvia no puede salir por gravedad.',
    unidad: 'horas',
    duracionH: 24,
    serie: [
      [0, 7.9, 0],
      [3, 7.95, 30],
      [6, 8.0, 80],
      [9, 8.05, 115],
      [12, 8.1, 120],
      [24, 8.2, 120],
    ],
  },
  {
    id: 'extremo',
    nombre: 'Extremo (referencia 1983: 10,73 m)',
    descripcion:
      'El río llega a un nivel similar al récord de 1983. Probá activar la falla de la defensa.',
    unidad: 'dias',
    duracionH: 40 * 24,
    serie: [
      [0, 6.0, 0],
      [10 * 24, 7.8, 30],
      [20 * 24, 9.4, 70],
      [28 * 24, 10.7, 110],
      [34 * 24, 10.4, 120],
      [40 * 24, 9.6, 125],
    ],
  },
];
