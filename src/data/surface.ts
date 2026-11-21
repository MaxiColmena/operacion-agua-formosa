// Tipo de calzada según la etiqueta `surface` de OpenStreetMap.
// En Formosa Capital ~88 % de las calles tiene el dato (consulta del 20/11/2026); el resto queda «sin dato»
// y NO se cuenta como asfaltada ni como de tierra.

/** p = pavimentada (asfalto, hormigón, adoquín) · t = tierra (o ripio, arena, barro) · ? = sin dato en OSM. */
export type Surface = 'p' | 't' | '?';

const PAVED = /^(paved|asphalt|concrete(:.*)?|paving_stones|sett|cobblestone|unhewn_cobblestone|metal|wood|chipseal)$/;
const UNPAVED = /^(unpaved|dirt|earth|ground|mud|sand|arena|gravel|fine_gravel|pebblestone|compacted|grass|grass_paver|rock|tierra|ripio)$/;

export function surfaceClass(tag: string | undefined | null): Surface {
  const t = (tag ?? '').trim().toLowerCase();
  if (!t) return '?';
  if (PAVED.test(t)) return 'p';
  if (UNPAVED.test(t)) return 't';
  return '?';
}

export const SURFACE_LABEL: Record<Surface, string> = { p: 'pavimentada', t: 'de tierra', '?': 'sin dato' };
