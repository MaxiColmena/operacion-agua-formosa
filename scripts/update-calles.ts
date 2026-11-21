// Actualiza solo las calles de public/data/osm.json con el tipo de calzada (pavimentada / tierra / sin dato),
// sin tocar instalaciones, barrios ni agua. Usa el caché data-raw/osm_roads.json (Overpass); si no está, lo baja.
// Uso: npm run data:calles
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { BBOX } from './config';
import { surfaceClass, SURFACE_LABEL, type Surface } from '../src/data/surface';

const CACHE = 'data-raw/osm_roads.json';
const QUERY = `[out:json][timeout:180][bbox:${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}];` +
  '(way[highway~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|service)$"];);out geom;';

if (!existsSync(CACHE)) {
  const r = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'operacion-agua-hackathon/0.1' },
    body: 'data=' + encodeURIComponent(QUERY),
  });
  if (!r.ok) throw new Error(`Overpass: HTTP ${r.status}`);
  mkdirSync('data-raw', { recursive: true });
  writeFileSync(CACHE, await r.text());
}

type Way = { tags: Record<string, string>; geometry?: { lat: number; lon: number }[] };
const raw = JSON.parse(readFileSync(CACHE, 'utf8')) as { elements: Way[] };
const r5 = (n: number) => Math.round(n * 1e5) / 1e5;
const roads = raw.elements.filter((e) => e.geometry?.length).map((e) => {
  const s = surfaceClass(e.tags.surface);
  return {
    k: /motorway|trunk|primary/.test(e.tags.highway) ? 1 : /secondary|tertiary/.test(e.tags.highway) ? 2 : 3,
    // «paved» se mantiene por compatibilidad: solo las de tierra confirmada cuentan como no pavimentadas.
    paved: s !== 't',
    s,
    n: e.tags.name ?? '',
    c: e.geometry!.map((p) => [r5(p.lon), r5(p.lat)]),
  };
});

const osmPath = 'public/data/osm.json';
const osm = JSON.parse(readFileSync(osmPath, 'utf8'));
osm.roads = roads;
const hoy = new Date().toISOString().slice(0, 10);
osm.source = String(osm.source).replace(/ · calles: consulta \d{4}-\d{2}-\d{2}$/, '') + ` · calles: consulta ${hoy}`;
writeFileSync(osmPath, JSON.stringify(osm));

// Resumen en km.
const km: Record<Surface, number> = { p: 0, t: 0, '?': 0 };
for (const r of roads) {
  let m = 0;
  for (let i = 1; i < r.c.length; i++) {
    const [x0, y0] = r.c[i - 1], [x1, y1] = r.c[i];
    m += Math.hypot((x1 - x0) * 111320 * Math.cos((y0 * Math.PI) / 180), (y1 - y0) * 111320);
  }
  km[r.s] += m / 1000;
}
const tot = km.p + km.t + km['?'];
console.log(`calles: ${roads.length}`);
for (const s of ['p', 't', '?'] as Surface[]) console.log(`  ${SURFACE_LABEL[s].padEnd(12)} ${km[s].toFixed(0).padStart(5)} km (${((km[s] / tot) * 100).toFixed(0)} %)`);
