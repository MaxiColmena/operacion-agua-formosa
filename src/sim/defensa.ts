// Traza APROXIMADA del anillo de defensa de Formosa Capital.
// Traza reconstruida por M. Colman (rama dev-colman, src/escenario/defensa-formosa.js, 19/11/2026),
// portada a TypeScript para el modelo de grilla FABDEM.
//
// Datos oficiales (Gobierno de Formosa, 08/12/2015, "El anillo de defensas de la ciudad a lo largo de
// sus 15 kilómetros fue fortalecido"):
//   - Terraplén de ~15 km, 6 m de ancho de coronamiento.
//   - Cota IGN 59 m = 11,70 m en el hidrómetro del puerto  ->  cero de la escala = 47,30 m IGN.
//   - Barrios con compuertas sobre la defensa: Bernardino Rivadavia (Lote 4), Laguna Siam,
//     San Juan Bautista, Liborsi, San Juan, La Floresta, San Martín, San Agustín.
//   - Asentamientos por fuera de la defensa: San Juan y Fachini.
// En 2018 se informó "cota 12 m" y 32 km de defensas (Siempre Formosa); usamos el dato de 2015.
//
// Cómo se armó la traza:
//   - TRAMOS REALES de OpenStreetMap (ids de way): 452549503 y 452549014 ("Defensa contra
//     inundaciones", noreste), 1046912527 (Lote 4), 1043100548 (sur, frente a los bañados) y
//     1069689861 (Liborsi).
//   - CONECTORES ESTIMADOS entre tramos: antes eran rectas que cruzaban barrios; ahora bordean la zona
//     edificada sin cortar manzanas, río, riachos ni lagunas (scripts/route-defensa.ts).
// El perímetro resultante es mayor que los 15 km oficiales: es una aproximación.
// Para la versión final hay que pedir la traza a la Provincia (Vialidad / UPCA).

import { TRAMOS, type LonLat } from './defensa-tramos';
import { CONECTORES } from './defensa-rutas';

export type { LonLat };

/**
 * Anillo CERRADO en sentido horario empezando por el oeste (el último punto empalma con el primero).
 * Tramos reales de OSM unidos por conectores estimados que bordean la zona edificada
 * (scripts/route-defensa.ts → src/sim/defensa-rutas.ts).
 */
export const DEFENSA_ANILLO: LonLat[] = [
  ...TRAMOS.liborsi,
  ...CONECTORES.oeste,
  ...CONECTORES.norte,
  ...TRAMOS.noreste,
  ...CONECTORES.este,
  ...TRAMOS.lote4,
  ...CONECTORES.sureste,
  ...TRAMOS.sur,
  ...CONECTORES.suroeste,
];

/**
 * Punto de la brecha simulada: frente al puerto, donde el río pega más cerca.
 * scripts/build-masks.ts centra la brecha en la celda del anillo más cercana a este punto que el río
 * toca con la crecida de 1983 en las grillas de 30 m y 60 m (en el MDE queda ~350 m al sureste,
 * sobre el arranque de Lote 4): justo frente a este punto la franja portuaria está por encima de 10,73 m.
 */
export const BRECHA: LonLat = [-58.161, -26.1905];

/** Largo de la brecha simulada a lo largo del anillo (m). SUPUESTO de escenario. */
export const LARGO_BRECHA_M = 200;

/** Distancia aproximada en metros entre dos puntos (equirectangular; sobra para ~20 km). */
export function distanciaM(a: LonLat, b: LonLat): number {
  const dx = (b[0] - a[0]) * 111320 * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  const dy = (b[1] - a[1]) * 111320;
  return Math.hypot(dx, dy);
}

/** Longitud de un anillo cerrado en km (para mostrarla y comparar con los 15 km oficiales). */
export function longitudKm(anillo: LonLat[] = DEFENSA_ANILLO): number {
  let total = 0;
  for (let i = 0; i < anillo.length; i++) total += distanciaM(anillo[i], anillo[(i + 1) % anillo.length]);
  return total / 1000;
}
