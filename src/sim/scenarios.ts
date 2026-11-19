import type { Assumptions, Scenario } from './engine';

/**
 * Supuestos del modelo. Se muestran en pantalla junto al resultado (pauta de la guía CITF).
 * Cada valor es un SUPUESTO declarado, no un dato oficial.
 */
export const ASSUMPTIONS: Assumptions = {
  // Superficie del río en el MDE (~49,5 m) menos una altura típica de la escala durante la toma (~3,7 m).
  // Falta el cero de escala IGN oficial de Puerto Formosa (INA): reemplazar cuando se consiga.
  gaugeZero: 45.8,
  // Defensa pensada por encima de la crecida de 1983 (10,73 m): coronamiento supuesto ≈ 11,7 m de escala.
  defenseCrest: 57.5,
  manning: 0.045,
  wetThreshold: 0.15,
  drainFactorHighRiver: 0.4,
  alertStage: 7.8,
};

export const RIVER_REF = {
  observed: { stage: 4.81, date: '17/11/2026', source: 'Prefectura Naval / INA vía Agrofy', trend: 'bajando' },
  alert: 7.8,
  evacuation: 8.3,
  lowWater: 1.6,
  record1983: 10.73,
};

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
    rainMmH: 40, rainHours: 1, riverStage: 4.81, drainMmH: 15, defenseFails: false, afterHours: 1,
    why: '40 mm en 1 h con el río como hoy (4,81 m). Tormenta de verano frecuente.',
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
