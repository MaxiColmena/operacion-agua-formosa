// Descarga de OpenStreetMap (Overpass) la infraestructura crítica, calles, agua, barrios y edificios.
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { BBOX } from './config';

const bb = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`;
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

async function overpass(name: string, body: string) {
  const cache = `data-raw/osm_${name}.json`;
  if (existsSync(cache)) return JSON.parse(readFileSync(cache, 'utf8'));
  const q = `[out:json][timeout:180][bbox:${bb}];(${body});out geom;`;
  let res: Response | null = null;
  for (let attempt = 0; attempt < 8 && !res; attempt++) {
    const url = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'operacion-agua-hackathon/0.1' },
        body: 'data=' + encodeURIComponent(q),
        signal: AbortSignal.timeout(240_000),
      });
      if (r.ok) res = r; else console.warn(`${name}: ${url} -> HTTP ${r.status}, reintento`);
    } catch (err) { console.warn(`${name}: ${url} -> ${(err as Error).message}, reintento`); }
    if (!res) await new Promise((ok) => setTimeout(ok, 3000));
  }
  if (!res) throw new Error(`${name}: ningún servidor Overpass respondió`);
  console.log(`${name}: ok`);
  const json = await res.json();
  mkdirSync('data-raw', { recursive: true });
  writeFileSync(cache, JSON.stringify(json));
  return json;
}

type El = { type: string; id: number; tags?: Record<string, string>; lat?: number; lon?: number;
  center?: { lat: number; lon: number }; geometry?: { lat: number; lon: number }[];
  members?: { geometry?: { lat: number; lon: number }[]; role: string }[] };

const r5 = (n: number) => Math.round(n * 1e5) / 1e5;
const line = (g?: { lat: number; lon: number }[]) => (g ?? []).map((p) => [r5(p.lon), r5(p.lat)]);
function point(e: El): [number, number] | null {
  if (e.lat != null) return [r5(e.lon!), r5(e.lat)];
  const g = e.geometry ?? e.members?.flatMap((m) => m.geometry ?? []);
  if (!g?.length) return null;
  let x = 0, y = 0; for (const p of g) { x += p.lon; y += p.lat; }
  return [r5(x / g.length), r5(y / g.length)];
}

// 1) Infraestructura crítica
const infra = await overpass('infra', `
  nwr[amenity~"^(school|kindergarten|college|university|hospital|clinic|doctors|fire_station|police|townhall|social_facility)$"];
  nwr[healthcare];
  nwr[emergency=assembly_point];
  nwr[man_made~"^(water_works|wastewater_plant|pumping_station|water_tower)$"];
  nwr[power=substation];
  nwr[aeroway=aerodrome];
  nwr[amenity=bus_station];`);
function category(t: Record<string, string>): string | null {
  const a = t.amenity, hc = t.healthcare;
  if (a === 'pharmacy' || a === 'dentist' || /pharmacy|dentist|optometrist/.test(hc ?? '')) return null;
  if (a === 'hospital' || hc === 'hospital') return 'hospital';
  if (a === 'clinic' || a === 'doctors' || hc) return 'salud';
  if (a && /school|kindergarten|college|university/.test(a)) return 'escuela';
  if (a === 'fire_station' || a === 'police') return 'seguridad';
  if (t.man_made || t.power) return 'servicios';
  if (t.emergency === 'assembly_point' || a === 'social_facility' || a === 'townhall') return 'refugio';
  if (t.aeroway || a === 'bus_station') return 'transporte';
  return null;
}
const seen = new Set<string>();
const facilities = (infra.elements as El[]).flatMap((e) => {
  const t = e.tags ?? {}; const cat = category(t); const p = point(e);
  if (!cat || !p) return [];
  const name = t.name ?? t['name:es'] ?? '';
  const key = `${cat}|${name}|${p[0].toFixed(3)}|${p[1].toFixed(3)}`;
  if (seen.has(key)) return []; seen.add(key);
  return [{ id: `${e.type[0]}${e.id}`, cat, name: name || `(${cat} sin nombre en OSM)`, lon: p[0], lat: p[1] }];
});

// 2) Calles
const roadsRaw = await overpass('roads', `way[highway~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|service)$"];`);
const roads = (roadsRaw.elements as El[]).map((e) => ({
  k: /motorway|trunk|primary/.test(e.tags!.highway) ? 1 : /secondary|tertiary/.test(e.tags!.highway) ? 2 : 3,
  paved: !/unpaved|dirt|ground|earth|sand|gravel/.test(e.tags!.surface ?? ''),
  n: e.tags!.name ?? '',
  c: line(e.geometry),
}));

// 3) Agua y defensas
const waterRaw = await overpass('water', `
  way[waterway~"^(river|stream|canal|drain|ditch)$"];
  nwr[natural=water]; nwr[waterway=riverbank]; nwr[landuse=reservoir]; nwr[natural=wetland];
  way[man_made=dyke]; way[embankment=yes]; way[barrier=flood_wall];`);
/** Une los tramos de una multipolígono (ways sueltos) en anillos cerrados, empalmando por los extremos. */
function assembleRings(parts: number[][][]): number[][][] {
  const same = (p: number[], q: number[]) => Math.abs(p[0] - q[0]) < 1e-6 && Math.abs(p[1] - q[1]) < 1e-6;
  const pool = parts.filter((p) => p.length > 1).map((p) => p.slice());
  const rings: number[][][] = [];
  while (pool.length) {
    let ring = pool.shift()!;
    let grew = true;
    while (!same(ring[0], ring[ring.length - 1]) && grew) {
      grew = false;
      for (let k = 0; k < pool.length; k++) {
        const p = pool[k];
        const end = ring[ring.length - 1];
        if (same(end, p[0])) ring = ring.concat(p.slice(1));
        else if (same(end, p[p.length - 1])) ring = ring.concat(p.slice(0, -1).reverse());
        else continue;
        pool.splice(k, 1); grew = true; break;
      }
    }
    // Solo se usan anillos cerrados (los que cortan el borde de la consulta quedan abiertos y se descartan).
    if (same(ring[0], ring[ring.length - 1]) && ring.length > 3) rings.push(ring);
  }
  return rings;
}

const areaKind = (t: Record<string, string>) =>
  t.natural === 'wetland' ? 'humedal' : t.water === 'river' || t.waterway === 'riverbank' ? 'rio' : 'agua';
const waterLines: { kind: string; name: string; c: number[][] }[] = [];
const waterAreas: { kind: string; name: string; rings: number[][][] }[] = [];
for (const e of waterRaw.elements as El[]) {
  const t = e.tags ?? {};
  const name = t.name ?? '';
  if (t.man_made === 'dyke' || t.embankment === 'yes' || t.barrier === 'flood_wall') {
    waterLines.push({ kind: 'defensa', name, c: line(e.geometry) });
  } else if (t.waterway && e.type === 'way' && !t.natural) {
    waterLines.push({ kind: t.waterway, name, c: line(e.geometry) });
  } else if (e.type === 'way') {
    waterAreas.push({ kind: areaKind(t), name, rings: [line(e.geometry)] });
  } else if (e.members) {
    waterAreas.push({ kind: areaKind(t), name,
      rings: assembleRings(e.members.filter((m) => m.role !== 'inner').map((m) => line(m.geometry))) });
  }
}

// 4) Barrios
const placesRaw = await overpass('places', `nwr[place~"^(suburb|neighbourhood|quarter)$"];`);
const barrios = (placesRaw.elements as El[]).flatMap((e) => {
  const p = point(e); const n = e.tags?.name;
  return p && n ? [{ name: n, lon: p[0], lat: p[1] }] : [];
});

// 5) Edificios: opcional (consulta pesada). Microsoft ya cubre casi todas las viviendas.
// Con OSM_BUILDINGS=1 se baja el caché crudo (data-raw/osm_buildings.json) y build-buildings lo combina.
if (process.env.OSM_BUILDINGS === '1') await overpass('buildings', `way[building];`);

writeFileSync('public/data/osm.json', JSON.stringify({
  source: 'OpenStreetMap contributors (ODbL), consulta Overpass ' + new Date().toISOString().slice(0, 10),
  facilities, roads, waterLines, waterAreas, barrios,
}));
const count = (a: { cat: string }[]) => a.reduce((m, f) => ((m[f.cat] = (m[f.cat] ?? 0) + 1), m), {} as Record<string, number>);
console.log({ facilities: count(facilities), roads: roads.length, waterLines: waterLines.length,
  defensas: waterLines.filter((w) => w.kind === 'defensa').length, waterAreas: waterAreas.length,
  barrios: barrios.length });
