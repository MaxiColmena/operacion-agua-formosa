// Umbral de exposición al río: textos y estados para la interfaz.
import { RIVER_REF } from '../sim/scenarios';

/** Margen por encima del río actual en el que un umbral se marca "en riesgo" (m). */
export const RISK_MARGIN = 0.6;

export type ThresholdState = 'alcanzado' | 'riesgo' | 'lejos';

export function fmtStage(s: number | null): string {
  return s == null ? 'no llega' : `${s.toFixed(2).replace('.', ',')} m`;
}

/** Estado del umbral respecto de la altura actual del río del escenario. */
export function thresholdState(stage: number | null, river: number): ThresholdState {
  if (stage == null) return 'lejos';
  if (stage <= river) return 'alcanzado';
  if (stage <= river + RISK_MARGIN) return 'riesgo';
  return 'lejos';
}

/** Ubica la altura respecto de las referencias del INA y el coronamiento de la defensa. */
export function stageContext(stage: number, crest: number): string {
  const f = (v: number) => v.toFixed(2).replace('.', ',');
  if (stage >= crest - 0.05) return `solo si el río supera el coronamiento de la defensa (≈${f(crest)} m)`;
  if (stage >= RIVER_REF.record1983) return `solo por encima del récord de 1983 (${f(RIVER_REF.record1983)} m)`;
  if (stage >= RIVER_REF.evacuation) return `sobre el nivel de evacuación (${f(RIVER_REF.evacuation)} m), por debajo del récord de 1983`;
  if (stage >= RIVER_REF.alert) return `entre alerta (${f(RIVER_REF.alert)} m) y evacuación (${f(RIVER_REF.evacuation)} m)`;
  return `por debajo del nivel de alerta (${f(RIVER_REF.alert)} m)`;
}
