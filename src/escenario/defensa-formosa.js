// Traza APROXIMADA del anillo de defensa de Formosa Capital (reconstruida el 19/11/2026).
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
//   - CONECTORES ESTIMADOS entre tramos, pasando al sur de La Floresta, El Resguardo y San Juan
//     (barrios críticos o fuera de la defensa según las noticias) y al norte de Laguna Siam.
// El perímetro resultante (~20 km) es mayor que los 15 km oficiales: es una aproximación.
// Para la versión final hay que pedir la traza a la Provincia (Vialidad / UPCA).

const OSM_452549503 = [
  [-58.16867, -26.15938], [-58.16802, -26.15884], [-58.16701, -26.15893], [-58.16491, -26.16007],
  [-58.16443, -26.16022], [-58.16297, -26.15986], [-58.16253, -26.1588], [-58.15872, -26.15759],
  [-58.15757, -26.16046],
];

// Tramo de 452549014 desde el empalme con 452549503 hacia el sur (se omite el ramal a la desembocadura).
const OSM_452549014 = [
  [-58.15762, -26.16149], [-58.15835, -26.16179], [-58.16016, -26.1622], [-58.16079, -26.16255],
  [-58.16144, -26.16327], [-58.16228, -26.16414], [-58.1631, -26.16437], [-58.16411, -26.1644],
  [-58.16577, -26.16513], [-58.16615, -26.16541], [-58.16693, -26.16683], [-58.1672, -26.16778],
  [-58.16724, -26.1684], [-58.16703, -26.1687], [-58.16643, -26.16926], [-58.16633, -26.16952],
  [-58.16649, -26.172], [-58.16661, -26.1732], [-58.16715, -26.17381],
];

// Lote 4 (Bernardino Rivadavia), de oeste a este.
const OSM_1046912527 = [
  [-58.15603, -26.19207], [-58.15557, -26.19262], [-58.15472, -26.19305], [-58.15339, -26.19338],
  [-58.15273, -26.19362], [-58.15204, -26.1941], [-58.15118, -26.19515], [-58.14991, -26.19673],
  [-58.14914, -26.19754], [-58.14839, -26.19781],
];

// Sur, de este a oeste.
const OSM_1043100548 = [
  [-58.17499, -26.19999], [-58.17505, -26.20061], [-58.17632, -26.2012], [-58.17758, -26.20146],
  [-58.17892, -26.20164], [-58.18069, -26.2022], [-58.1836, -26.20282], [-58.1858, -26.20321],
  [-58.18779, -26.20284], [-58.19035, -26.20241], [-58.19402, -26.20182],
];

// Liborsi, de sur a norte.
const OSM_1069689861 = [
  [-58.22029, -26.20003], [-58.22118, -26.19868], [-58.22155, -26.19823], [-58.22237, -26.19849],
  [-58.22291, -26.19854], [-58.22335, -26.19791], [-58.22387, -26.19661],
];

// Anillo en sentido horario empezando por el noroeste. Los puntos sueltos son conectores estimados.
export const DEFENSA_REAL = [
  // Oeste y norte (estimado): sube desde Liborsi y corre al sur del Riacho Formosa.
  [-58.2245, -26.188],
  [-58.222, -26.178],
  [-58.216, -26.17],
  [-58.207, -26.1655],
  [-58.197, -26.164],
  [-58.187, -26.1632],
  [-58.178, -26.1625],
  [-58.1715, -26.161],
  // Noreste (OSM).
  ...OSM_452549503,
  ...OSM_452549014,
  // Este, frente al puerto (estimado).
  [-58.1665, -26.18],
  [-58.164, -26.186],
  [-58.161, -26.1905],
  // Lote 4 (OSM).
  ...OSM_1046912527,
  // Sureste (estimado): cierra Lote 4 y empalma con el terraplén sur.
  [-58.1505, -26.201],
  [-58.158, -26.202],
  [-58.166, -26.201],
  // Sur (OSM).
  ...OSM_1043100548,
  // Suroeste (estimado): al norte de Laguna Siam y San Juan Bautista.
  [-58.203, -26.2028],
  [-58.212, -26.2015],
  // Liborsi (OSM).
  ...OSM_1069689861,
];

// Punto de la brecha simulada: frente al puerto, donde el río pega más cerca.
export const BRECHA_REAL = [-58.161, -26.1905];

// Longitud de la traza en km (para mostrarla y comparar con los 15 km oficiales).
export function longitudKm(anillo) {
  let total = 0;
  for (let i = 0; i < anillo.length; i++) {
    const [a, b] = [anillo[i], anillo[(i + 1) % anillo.length]];
    const dx = (b[0] - a[0]) * 111320 * Math.cos((a[1] * Math.PI) / 180);
    const dy = (b[1] - a[1]) * 111320;
    total += Math.hypot(dx, dy);
  }
  return total / 1000;
}
