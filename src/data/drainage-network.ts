// Red pluvial relevada por el equipo (bocas de tormenta, sumideros, conductos y cámaras).
// Fuente: relevamiento del equipo a partir de información municipal y de prensa. SIN VERIFICAR en campo:
// se usa como REFERENCIA para repartir la capacidad de desagüe, no como catastro de la red.
// scripts/build-drainage.ts ubica cada entrada sobre las calles y barrios de OpenStreetMap.

/** Un extremo de un tramo: el cruce con otra calle, un riacho o un barrio (punto de OSM). */
export type TramoEnd = { street: string } | { water: string } | { barrio: string };

export type DrainEntry = { id: string; group: 1 | 2 | 3; label: string; detail: string } & (
  | { kind: 'casco' }
  /** Calle completa o entre dos extremos. Con `near`, solo la parte a menos de `radius` m de ese barrio. */
  | { kind: 'street'; street: string; from?: TramoEnd; to?: TramoEnd; near?: string; radius?: number }
  | { kind: 'corner'; a: string; b: string }
  /** Zona alrededor del punto del barrio en OSM; con `pavedOnly`, solo sobre calles pavimentadas. */
  | { kind: 'barrio'; barrio: string; radius: number; pavedOnly?: boolean }
);

export const DRAIN_GROUPS: Record<1 | 2 | 3, string> = {
  1: 'Casco céntrico (conductos cerrados y sumideros)',
  2: 'Grandes avenidas y conectores de cuencas',
  3: 'Puntos de captación en barrios',
};

export const DRAIN_NETWORK: DrainEntry[] = [
  // 1. Casco céntrico
  { id: 'casco', group: 1, kind: 'casco', label: 'Casco céntrico', detail: 'Entre Av. González Lelong, Av. Pantaleón Gómez y Av. Napoleón Uriburu: bocas de tormenta de mampostería en casi todas las esquinas.' },
  { id: '9julio', group: 1, kind: 'street', street: '9 de julio', from: { street: 'gonzalez lelong' }, to: { street: 'napoleon uriburu' }, label: 'Av. 9 de Julio', detail: 'Alturas 100 a 2200: sumideros de calzada y cordón conectados al caño maestro.' },
  { id: 'fotheringham', group: 1, kind: 'corner', a: 'fotheringham', b: 'rivadavia', label: 'Fotheringham y Rivadavia', detail: 'Cámara de inspección pluvial y bocas de tormenta profundas.' },
  { id: 'jmuriburu', group: 1, kind: 'corner', a: 'jose maria uriburu', b: '17 de octubre', label: 'José María Uriburu y 17 de Octubre', detail: 'Bocas de tormenta de gran sección (B° Libertad).' },
  { id: 'jujuy', group: 1, kind: 'street', street: 'jujuy', from: { street: 'junin' }, to: { street: 'gonzalez lelong' }, label: 'Jujuy (Junín – González Lelong)', detail: 'Serie de rejillas pluviales (B° Independencia).' },
  { id: 'madariaga', group: 1, kind: 'street', street: 'madariaga', label: 'Madariaga', detail: 'Conducto principal de hormigón y 168 sumideros (cuenca suroeste).' },
  { id: 'mitre', group: 1, kind: 'street', street: 'mitre', from: { street: 'espana' }, to: { street: 'corrientes' }, label: 'Mitre (España – Corrientes)', detail: 'Rejillas de captación en cordón cuneta.' },
  { id: 'deanfunes', group: 1, kind: 'street', street: 'dean funes', from: { street: 'pringles' }, to: { street: 'brandsen' }, label: 'Deán Funes (Pringles – Brandsen)', detail: 'Cámaras de inspección y sumideros de piso.' },
  { id: 'moreno9j', group: 1, kind: 'corner', a: 'mariano moreno', b: '9 de julio', label: 'Mariano Moreno y 9 de Julio', detail: 'Sumideros dobles de hormigón.' },
  { id: 'morenosaav', group: 1, kind: 'corner', a: 'mariano moreno', b: 'saavedra', label: 'Mariano Moreno y Saavedra', detail: 'Sumideros dobles de hormigón.' },
  // 2. Grandes avenidas
  { id: 'kirchner', group: 2, kind: 'street', street: 'nestor kirchner', from: { street: 'calle 17' }, to: { barrio: 'nueva formosa' }, label: 'Av. Néstor Kirchner (Calle 17 – La Nueva Formosa)', detail: 'Nodos pluviales de gran diámetro y conducto de salida hacia la cuenca sur.' },
  { id: 'lelong9j', group: 2, kind: 'corner', a: 'gonzalez lelong', b: '9 de julio', label: 'González Lelong y 9 de Julio', detail: 'Cabecera de desagües pluviales principales.' },
  { id: 'lelonggn', group: 2, kind: 'corner', a: 'gonzalez lelong', b: 'gendarmeria nacional', label: 'González Lelong y Gendarmería Nacional', detail: 'Cabecera de desagües pluviales principales.' },
  { id: 'italia', group: 2, kind: 'street', street: 'avenida italia', from: { water: 'pucu' }, to: { street: 'avellaneda' }, label: 'Av. Italia (Riacho El Pucú – Av. Avellaneda)', detail: 'Drenaje pluvial paralelo, cámaras subterráneas y cordones (B° Evita).' },
  { id: 'constituyentes', group: 2, kind: 'corner', a: 'constituyentes', b: 'beata nazaria', label: 'Av. Los Constituyentes y Beata Nazaria March', detail: 'Nodo de cámaras pluviales y conductos cerrados (zona norte).' },
  { id: 'antartida', group: 2, kind: 'street', street: 'antartida argentina', label: 'Av. Antártida Argentina (rotonda de la Kirchner – Procrear)', detail: 'Bocas de tormenta sobre el eje de la calzada.' },
  { id: 'pueyrredon', group: 2, kind: 'street', street: 'pueyrredon', near: 'mariano moreno', radius: 700, label: 'Av. Pueyrredón (B° Mariano Moreno)', detail: 'Cámaras de desagüe superficial y cruces entubados.' },
  { id: 'gendcabral', group: 2, kind: 'corner', a: 'gendarmeria nacional', b: 'cabral', label: 'Gendarmería Nacional y Cabral', detail: 'Sumideros e interconexión con canales pluviales.' },
  { id: 'diagonal', group: 2, kind: 'street', street: 'avenida diagonal', from: { street: 'avenida italia' }, to: { street: 'gendarmeria nacional' }, label: 'Av. Diagonal (Italia – Gendarmería)', detail: 'Cámaras de tormenta y cruces entubados (B° Divino Niño).' },
  // 3. Barrios
  { id: 'trinidad', group: 3, kind: 'street', street: 'trinidad gonzalez', label: 'Trinidad González (B° Ibirá Pitá)', detail: 'Cámaras y bocas de tormenta.' },
  { id: 'ocleppo', group: 3, kind: 'corner', a: 'ocleppo', b: 'viciconte', label: 'Ocleppo y Viciconte (B° Eva Perón)', detail: 'Bocas de tormenta y sumideros.' },
  { id: 'brunelli', group: 3, kind: 'corner', a: 'brunelli', b: 'alem', label: 'Brunelli y Alem (B° San Miguel)', detail: 'Cámaras pluviales y rejillas.' },
  { id: 'chacosf', group: 3, kind: 'corner', a: 'avenida chaco', b: 'santa fe', label: 'Av. Chaco y Santa Fe (B° Lote 4)', detail: 'Cámaras y sumideros manuales.' },
  { id: 'chacomoreno', group: 3, kind: 'corner', a: 'avenida chaco', b: 'moreno', label: 'Av. Chaco y Moreno (B° Lote 4)', detail: 'Cámaras y sumideros manuales.' },
  { id: 'pilar', group: 3, kind: 'barrio', barrio: 'virgen del pilar', radius: 450, pavedOnly: true, label: 'B° Virgen del Pilar', detail: 'Cámaras pluviales en las esquinas de calles pavimentadas.' },
  { id: 'pumas', group: 3, kind: 'street', street: 'los pumas', label: 'Av. Los Pumas (B° Nueva Formosa)', detail: 'Drenaje pluvial mecánico (con Calle 6, La Paulina).' },
  { id: 'sjbautista', group: 3, kind: 'barrio', barrio: 'san juan bautista', radius: 450, label: 'B° San Juan Bautista', detail: 'Cámaras pluviales distribuidas (cuenca sudoeste, periferia de Villa del Rosario). Ubicación aproximada.' },
];
