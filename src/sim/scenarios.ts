import type { Assumptions, Scenario } from './engine';

/**
 * Supuestos del modelo. Se muestran en pantalla junto al resultado (pauta de la guía CITF).
 * Cada valor es un SUPUESTO declarado, no un dato oficial.
 */
export const ASSUMPTIONS: Assumptions = {
  // Cero de la escala de Puerto Formosa = 47,30 m IGN, deducido del dato oficial (Gobierno de Formosa,
  // 08/12/2015): "cota IGN 59 m = 11,70 m en el hidrómetro del puerto" (59 − 11,70 = 47,30).
  // OJO DATUM: las cotas oficiales son IGN (SRVN); el terreno FABDEM está en EGM2008. En la zona la
  // diferencia es probablemente menor a 1 m, pero NO está verificada: sigue siendo un supuesto a
  // verificar con el INA (cero de escala oficial) y el IGN.
  // (El valor anterior, 46,3 m, salía de la superficie del río en el MDE menos ~3,7 m de escala.)
  gaugeZero: 47.3,
  // Coronamiento del anillo de defensa: cota IGN 59 m (= 11,70 m de escala), mismo dato oficial de 2015.
  // Misma salvedad de datum. En 2018 se informó "cota 12 m" (no usada).
  defenseCrest: 59.0,
  manning: 0.045,
  wetThreshold: 0.15,
  drainFactorHighRiver: 0.4,
  alertStage: 7.8,
  // Sin red pluvial relevada (bocas de tormenta, sumideros) solo quedan cunetas e infiltración: la mitad.
  drainNoNetwork: 0.5,
};

export const RIVER_REF = {
  observed: {
    stage: 4.96, date: '17/11/2026', trend: 'estable',
    // Categoría tal como la informa la fuente (escala de 5 categorías del INA, frecuencias 1991–2020).
    inaCategory: 'aguas medias',
    source: 'Parte «Situación hídrica y agroambiental» de la Subsecretaría de Producción Sustentable de Formosa (alturas de Prefectura Naval e INA)',
  },
  alert: 7.8,
  evacuation: 8.3,
  record1983: 10.73,
};

/**
 * Escala del INA: cinco categorías por frecuencia en 1991–2020 (aguas bajas, medias bajas, medias,
 * medias altas, altas). El INA no publica sus límites en metros: solo informa la categoría de cada
 * lectura. Por eso NO clasificamos alturas hipotéticas: mostramos lecturas reales ya clasificadas por el INA.
 */
export const INA_SCALE = ['aguas bajas', 'aguas medias bajas', 'aguas medias', 'aguas medias altas', 'aguas altas'] as const;
export const INA_CATEGORY_REF: { stage: number; cat: string; date: string; source: string }[] = [
  { stage: 2.87, cat: 'aguas medias bajas', date: 'nov. 2025', source: 'Reporte diario INA' },
  { stage: 4.05, cat: 'aguas medias', date: 'jul. 2026', source: 'Reporte diario INA' },
  { stage: 4.49, cat: 'aguas medias', date: 'jun. 2026', source: 'Reporte diario INA' },
  { stage: 4.96, cat: 'aguas medias', date: '17/11/2026', source: 'Parte provincial (Prefectura / INA)' },
];

/** Pronóstico de lluvia a 7 días para el departamento Formosa (ESTIMADO, Open-Meteo, emitido el 17/11/2026). */
export const RAIN_FORECAST_7D = { meanMm: 129, maxMm: 150, issued: '17/11/2026', source: 'Open-Meteo vía parte provincial del 17/11/2026' };

/**
 * Previsión del INA a corto plazo para Puerto Formosa (ESTIMADO). Leída a ojo del gráfico «Previsión de
 * niveles a corto plazo» del reporte diario del 19/11/2026: valores aproximados. Actualizar a mano.
 */
export const FORECAST_INA = {
  until: '25/11/2026',
  stage: 4.55,
  margin: 0.3,
  text: 'Oscilante / leve descenso a corto plazo; posible aumento de los valores semanales por lluvias en el tramo medio e inferior.',
  source: 'INA · Reporte hidrometeorológico diario del 19/11/2026 (gráfico de previsión, valores aproximados)',
  url: 'https://alerta.ina.gob.ar/ina/06-INFORMES/diario/pdf/reporte_diario_2026-11-19.pdf',
};

/**
 * Ritmo de subida del río para declarar "en cuántos días" llegaría a la altura del escenario (guía CITF, sección 03:
 * "cada escenario debe declarar sus supuestos: cuánto sube el río, en cuántos días").
 * Observado en la crecida de octubre de 2026: 2,88 m el 11/10 → 5,59 m el 30/10 (2,71 m en 19 días ≈ 14 cm/día).
 * Es un SUPUESTO para expresar el escenario, no un pronóstico.
 */
export const RISE_REF = {
  cmPerDay: 14,
  source: 'crecida de oct. 2026: 2,88 m (11/10) → 5,59 m (30/10), lecturas de Prefectura/INA publicadas en medios',
};

/** Días que tardaría el río en pasar de `from` a `stage` al ritmo de RISE_REF (0 si no sube). */
export function daysToRise(stage: number, from: number = RIVER_REF.observed.stage) {
  return stage <= from + 0.05 ? 0 : Math.ceil(((stage - from) * 100) / RISE_REF.cmPerDay);
}

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
    rainMmH: 40, rainHours: 1, riverStage: 4.96, drainMmH: 15, defenseFails: false, afterHours: 1,
    why: '40 mm en 1 h con el río como el 17/11/2026 (4,96 m, aguas medias). Tormenta de verano frecuente.',
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
    id: 'p7d', short: '7 días', label: 'Pronóstico concentrado',
    rainMmH: 50, rainHours: 3, riverStage: 4.96, drainMmH: 10, defenseFails: false, afterHours: 1,
    why: 'Horizonte de 7 días: el pronóstico (ESTIMADO, Open-Meteo, 17/11/2026) da 129 mm de promedio y hasta 150 mm en el departamento Formosa. SUPUESTO del escenario: ese máximo cae en una sola tormenta de 3 h, con el río como hoy (4,96 m) y desagüe reducido a 10 mm/h porque el 67 % del suelo provincial está húmedo o muy húmedo (Sentinel-1, 16/09–31/10).',
  },
  {
    id: 'h1983', short: 'Histórico', label: 'Crecida 1983 + lluvia',
    rainMmH: 50, rainHours: 2, riverStage: 10.73, drainMmH: 15, defenseFails: false, afterHours: 1,
    why: 'Río al récord de 1983 (10,73 m) con 100 mm de lluvia. Probar también con "Rotura de la defensa" (opciones avanzadas).',
  },
  {
    id: 'h2015', short: '2015-16', label: 'Crecida 2015-16 + lluvia',
    rainMmH: 50, rainHours: 2, riverStage: 9.45, drainMmH: 15, defenseFails: false, afterHours: 1,
    why: 'Río a 9,45 m (dic. 2015, emergencia hídrica, ~800 familias evacuadas) con 100 mm de lluvia. La defensa (11,70 m) contiene al río; se inundan los barrios fuera del anillo.',
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
