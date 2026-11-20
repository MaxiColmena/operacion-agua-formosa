import type { Assumptions, Scenario } from './engine';

/**
 * Supuestos del modelo. Se muestran en pantalla junto al resultado (pauta de la guía CITF).
 * Cada valor es un SUPUESTO declarado, no un dato oficial.
 */
export const ASSUMPTIONS: Assumptions = {
  // Gobierno de Formosa (08/12/2015): la defensa está a cota IGN 59 m, que equivale a 11,70 m en el
  // hidrómetro del puerto → cero de la escala = 59 − 11,70 = 47,30 m IGN. [Probable: confirmar con el INA]
  // Se supone que el MDE (EGM2008) y el IGN coinciden; no está verificado.
  gaugeZero: 47.3,
  // Coronamiento oficial de la defensa: cota IGN 59 m (11,70 m en la escala del puerto).
  defenseCrest: 59.0,
  manning: 0.045,
  wetThreshold: 0.15,
  drainFactorHighRiver: 0.4,
  alertStage: 7.8,
};

export const RIVER_REF = {
  observed: {
    stage: 4.7,
    date: '19/11/2026',
    trend: 'en descenso',
    // Categoría que asigna el INA según la frecuencia de superación 1991–2020.
    categoryINA: 'aguas medias',
    source: 'INA · Reporte hidrometeorológico diario de la Cuenca del Plata, 19/11/2026',
    url: 'https://alerta.ina.gob.ar/ina/06-INFORMES/diario/pdf/reporte_diario_2026-11-19.pdf',
  },
  alert: 7.8,
  evacuation: 8.3,
  lowWater: 1.6,
  record1983: 10.73,
  /** Coronamiento de la defensa en la escala del puerto (Gobierno de Formosa, 2015). */
  defenseStage: 11.7,
};

/**
 * Ritmo de subida del río usado para declarar "en cuántos días" llegaría a la altura del escenario (guía, sección 03).
 * Observado en la crecida de octubre de 2026: 2,88 m el 11/10 → 5,59 m el 30/10 (2,71 m en 19 días ≈ 14 cm/día).
 * Es un SUPUESTO para expresar el escenario, no un pronóstico: el pronóstico es del INA.
 */
export const RISE_REF = {
  cmPerDay: 14,
  source: 'Crecida de oct. 2026: 2,88 m (11/10) → 5,59 m (30/10), lecturas de Prefectura/INA publicadas en medios',
};

/** Días que tardaría el río en pasar de la altura observada a `stage` al ritmo de RISE_REF (0 si no sube). */
export function daysToRise(stage: number, from = 4.7) {
  return stage <= from ? 0 : Math.ceil(((stage - from) * 100) / RISE_REF.cmPerDay);
}

/** Previsión del INA a corto plazo. Leída a ojo del gráfico del reporte diario: valores aproximados. */
export const FORECAST_INA = {
  until: '25/11/2026',
  stage: 4.55,
  margin: 0.3,
  text: 'Oscilante / leve descenso a corto plazo; posible aumento de los valores semanales por lluvias en el tramo medio e inferior.',
  source: 'INA · Reporte diario 19/11/2026 (gráfico de previsión, valores aproximados)',
  url: 'https://alerta.ina.gob.ar/ina/06-INFORMES/diario/pdf/reporte_diario_2026-11-19.pdf',
};

/** Categorías oficiales del INA. Los cortes en metros de Puerto Formosa no están publicados en el reporte:
 * por eso NO se le asigna categoría al escenario, solo al dato observado. */
export const CATEGORIES_INA: [string, string][] = [
  ['aguas altas', 'se iguala o supera en el 5 % o menos de los registros'],
  ['aguas medias altas', 'entre el 25 % y el 5 % (por encima de lo normal)'],
  ['aguas medias', 'entre el 75 % y el 25 % (normales)'],
  ['aguas medias bajas', 'entre el 95 % y el 75 % (por debajo de lo normal)'],
  ['aguas bajas', 'en más del 95 % de los registros'],
];

/** Incertidumbre que se muestra junto al resultado. */
export const UNCERTAINTY = [
  'Terreno de 30 m con 1 a 2 m de error vertical: orienta, no indica qué manzana se inunda.',
  'La referencia vertical del MDE (EGM2008) y la del puerto (IGN) se suponen iguales; no está verificado.',
  'La escala del río mide un solo punto (el puerto); el agua no sube igual en toda la costa.',
  'La traza de la defensa es aproximada; no se modelan bombas ni compuertas una por una.',
  'No hay datos públicos de la red de desagües: los tiempos sirven para ordenar, no para planificar al minuto.',
];

export interface NamedScenario extends Scenario {
  id: string;
  label: string;
  short: string;
  why: string;
  /** Horas que se simulan después de que para la lluvia. */
  afterHours: number;
}

/** Los tres niveles que definen las zonas "1ª, 2ª y 3ª en afectarse". */
export const LEVELS: NamedScenario[] = [
  {
    id: 'n1', short: 'Nivel 1', label: 'Lluvia fuerte',
    rainMmH: 40, rainHours: 1, riverStage: 4.7, drainMmH: 15, defenseFails: false, afterHours: 1,
    why: '40 mm en 1 h con el río como hoy (4,70 m, INA 19/11/2026). Tormenta de verano frecuente.',
  },
  {
    id: 'n2', short: 'Nivel 2', label: 'Temporal severo',
    rainMmH: 70, rainHours: 1.5, riverStage: 7.8, drainMmH: 15, defenseFails: false, afterHours: 1,
    why: '105 mm en 1,5 h (crónicas de 70 mm en 1 h) con el río en alerta (7,80 m): el desagüe por gravedad se corta.',
  },
  {
    id: 'n3', short: 'Nivel 3', label: 'Extremo',
    rainMmH: 90, rainHours: 2, riverStage: 8.3, drainMmH: 15, defenseFails: false, afterHours: 1,
    why: '180 mm en 2 h (acumulado de marzo de 2021 concentrado) con el río en evacuación (8,30 m).',
  },
];

export const PRESETS: NamedScenario[] = [
  ...LEVELS,
  {
    id: 'h1983', short: 'Histórico', label: 'Crecida 1983 + lluvia',
    rainMmH: 50, rainHours: 2, riverStage: 10.73, drainMmH: 15, defenseFails: false, afterHours: 1,
    why: 'Río al récord de 1983 (10,73 m) con 100 mm de lluvia. Probar también con "falla de defensa".',
  },
];

/**
 * Agua en las calles. Con celdas de 30–60 m las calles no existen en el MDE: el agua de la manzana
 * escurre a la calzada porque lotes y veredas están más altos. SUPUESTO: en zona urbana la calle
 * ocupa ~35 % de la celda y concentra el agua de toda la celda.
 */
export const STREET = {
  /** Fracción de la celda ocupada por calzada en zona urbana. */
  share: 0.35,
  /** Mínimo de edificios por celda de simulación (~60 m) para considerarla urbana. */
  minBuildings: 4,
  /** Desde esta profundidad se ve agua en la calzada (m). */
  wet: 0.02,
  /** Agua sobre el cordón: dificulta el tránsito (m). */
  curb: 0.1,
  /** Intransitable para autos y peatones (m). */
  impassable: 0.3,
};
