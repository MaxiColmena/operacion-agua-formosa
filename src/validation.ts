// Validación contra eventos reales: barrios que la prensa reportó con agua en Formosa Capital.
// La guía pide "comprobar cómo funciona": comparamos esos barrios con lo que marca el modelo.
// Fuentes en docs/casos-y-alerta-refsa.md. No es una validación estadística (son pocos casos y la prensa
// no reporta todos los barrios): sirve para detectar si el modelo contradice lo que ya pasó.

export interface ReportedBarrio {
  /** Nombre como figura en OpenStreetMap. */
  name: string;
  kind: 'lluvia' | 'río';
  event: string;
  source: string;
  url: string;
}

export const REPORTED_BARRIOS: ReportedBarrio[] = [
  {
    name: 'Parque Urbano', kind: 'lluvia', event: '17/11/2024 · 48 mm en ~1 h: calles convertidas en ríos, autos atrapados',
    source: 'Exprés Diario', url: 'https://www.expresdiario.com.ar/el-temporal-dejo-calles-anegadas-y-complicaciones-para-la-circulacion/',
  },
  {
    name: 'Colluccio', kind: 'lluvia', event: '17/11/2024 · 48 mm en ~1 h: anegamientos y agua en viviendas',
    source: 'Exprés Diario', url: 'https://www.expresdiario.com.ar/el-temporal-dejo-calles-anegadas-y-complicaciones-para-la-circulacion/',
  },
  {
    name: '28 de Junio', kind: 'lluvia', event: '60 mm hasta las 17 h: anegamientos',
    source: 'La Mañana', url: 'https://www.xn--lamaanaonline-lkb.com.ar/noticia/103149/nuevamente-un-temporal-intenso-afect-a-ms-de-media-provincia-con-abundantes-lluvias/',
  },
  {
    name: 'Salvador Gurrieri', kind: 'lluvia', event: '60 mm hasta las 17 h: anegamientos',
    source: 'La Mañana', url: 'https://www.xn--lamaanaonline-lkb.com.ar/noticia/103149/nuevamente-un-temporal-intenso-afect-a-ms-de-media-provincia-con-abundantes-lluvias/',
  },
  {
    name: 'La Floresta', kind: 'río', event: 'Dic. 2015 · río sobre 8 m: barrio fuera del anillo afectado',
    source: 'Diario Jornada', url: 'https://diariojornada.com.ar/147550/magazine/continua_la_crecida_del_rio_paraguay_y_amenaza_a_formosa',
  },
  {
    name: 'Laguna Siam', kind: 'río', event: 'Dic. 2015 · río sobre 8 m: barrio fuera del anillo afectado',
    source: 'Diario Jornada', url: 'https://diariojornada.com.ar/147550/magazine/continua_la_crecida_del_rio_paraguay_y_amenaza_a_formosa',
  },
];

export interface ValidationRow extends ReportedBarrio {
  found: boolean;
  /** Nivel de referencia en que el modelo lo afecta (0 = no se afecta en ninguno). */
  tier: number;
  /** Puesto en la lista de prioridad (1 = primero); 0 si no tiene puntaje. */
  rank: number;
}

/** Cruza los barrios reportados con los niveles y el orden de prioridad del modelo. */
export function validate(barrios: { name: string; tier: number }[], scores: number[]): { rows: ValidationRow[]; ranked: number } {
  const order = scores.map((s, i) => ({ s, i })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.i);
  const rows = REPORTED_BARRIOS.map((r) => {
    const i = barrios.findIndex((b) => b.name.toLowerCase() === r.name.toLowerCase());
    return { ...r, found: i >= 0, tier: i >= 0 ? barrios[i].tier : 0, rank: i >= 0 ? order.indexOf(i) + 1 : 0 };
  });
  return { rows, ranked: order.length };
}
