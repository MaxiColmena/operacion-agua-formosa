// Datos REALES con fecha y procedencia. Separados de lo ficticio a propósito:
// la guía pide distinguir en pantalla el dato observado, la previsión del INA y el escenario del usuario.
// Actualizar a mano desde el reporte diario del INA (alerta.ina.gob.ar).

export const OBSERVADO = {
  estacion: 'Puerto Formosa (río Paraguay)',
  nivelM: 4.7,
  tendencia: 'en descenso',
  fecha: '19/11/2026',
  // Categoría que asigna el INA según la frecuencia de superación en 1991–2020.
  categoriaINA: 'aguas medias',
  fuente: 'INA · Reporte hidrometeorológico diario de la Cuenca del Plata, 19/11/2026',
  url: 'https://alerta.ina.gob.ar/ina/06-INFORMES/diario/pdf/reporte_diario_2026-11-19.pdf',
};

export const PREVISION_INA = {
  hasta: '25/11/2026',
  // Leído a ojo del gráfico "Previsión de niveles a corto plazo en Puerto Formosa" del reporte: aproximado.
  nivelFinalM: 4.55,
  margenM: 0.3,
  texto: 'Oscilante / leve descenso a corto plazo; posible aumento de los valores semanales por lluvias en el tramo medio e inferior.',
  fuente: 'INA · Reporte diario 19/11/2026 (gráfico de previsión, valores aproximados)',
  url: 'https://alerta.ina.gob.ar/ina/06-INFORMES/diario/pdf/reporte_diario_2026-11-19.pdf',
};

// Umbrales oficiales del INA para Puerto Formosa (m en la escala del puerto).
export const REFERENCIAS_INA = { aguasBajas: 1.6, alerta: 7.8, evacuacion: 8.3 };

// Categorías del INA (definición oficial). Los cortes en metros para Puerto Formosa no están publicados
// en el reporte: por eso NO se le asigna categoría al escenario, solo al dato observado.
export const CATEGORIAS_INA = [
  ['aguas altas', 'se iguala o supera en el 5 % o menos de los registros'],
  ['aguas medias altas', 'entre el 25 % y el 5 % (por encima de lo normal)'],
  ['aguas medias', 'entre el 75 % y el 25 % (normales)'],
  ['aguas medias bajas', 'entre el 95 % y el 75 % (por debajo de lo normal)'],
  ['aguas bajas', 'en más del 95 % de los registros'],
];

// Fuentes que usa el prototipo, con el tipo que pide la guía.
export const FUENTES = [
  {
    tipo: 'OBSERVADO',
    nombre: 'INA · Reporte diario',
    que: 'Nivel en Puerto Formosa: 4,70 m (m en la escala del puerto), aguas medias',
    fecha: '19/11/2026',
    url: OBSERVADO.url,
  },
  {
    tipo: 'ESTIMADO',
    nombre: 'INA · Previsión a corto plazo',
    que: 'Leve descenso hasta ~4,55 m (±0,3 m) al 25/11. Leído del gráfico',
    fecha: '19/11/2026',
    url: PREVISION_INA.url,
  },
  {
    tipo: 'REFERENCIA',
    nombre: 'INA · Umbrales de Puerto Formosa',
    que: 'Alerta 7,80 m · Evacuación 8,30 m · Aguas bajas 1,60 m',
    fecha: '19/11/2026',
    url: 'https://www.ina.gob.ar/alerta/',
  },
  {
    tipo: 'REFERENCIA',
    nombre: 'Gobierno de Formosa · Anillo de defensa',
    que: 'Coronamiento 11,70 m en la escala (cota IGN 59 m); ~15 km',
    fecha: '08/12/2015',
    url: 'https://www.formosa.gob.ar/noticia/19246/39/el_anillo_de_defensas_de_la_ciudad_a_lo_largo_de_sus_15_kilometros_fue_fortalecido',
  },
  {
    tipo: 'BASE',
    nombre: 'OpenStreetMap',
    que: 'Calles, plazas, escuelas, salud, ríos, lagunas y tramos de la defensa (ODbL)',
    fecha: 'descarga 19/11/2026',
    url: 'https://www.openstreetmap.org/',
  },
  {
    tipo: 'ESTIMADO',
    nombre: 'Traza de la defensa',
    que: '5 tramos reales de OSM + conectores estimados por el equipo (~23,5 km)',
    fecha: '19/11/2026',
    url: null,
  },
  {
    tipo: 'FICTICIO',
    nombre: 'Terreno, drenaje y casos',
    que: 'Cota del terreno, capacidad del drenaje (45 / 20 mm), series de los 4 casos y brecha',
    fecha: '—',
    url: null,
  },
];

// Incertidumbre que se muestra junto al resultado.
export const INCERTIDUMBRE = [
  'Terreno ficticio: no indica qué manzana se inunda. Con el MDE-Ar real el error vertical sería de ~2 m.',
  'La escala del río mide un solo punto (el puerto); el agua no sube igual en toda la costa.',
  'La traza de la defensa es aproximada; no se modelan bombas ni compuertas una por una.',
  'Los días del caso son un supuesto, no tiempos de llegada reales.',
];
