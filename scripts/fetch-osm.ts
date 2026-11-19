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
  c: line(e.geometry),
}));

// 3) Agua y defensas
const waterRaw = await overpass('water', `
  way[waterway~"^(river|stream|canal|drain|ditch)$"];
  nwr[natural=water]; nwr[waterway=riverbank]; nwr[landuse=reservoir]; nwr[natural=wetland];
  way[man_made=dyke]; way[embankment=yes]; way[barrier=flood_wall];`);
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
    waterAreas.push({ kind: t.natural === 'wetland' ? 'humedal' : 'agua', name, rings: [line(e.geometry)] });
  } else if (e.members) {
    waterAreas.push({ kind: t.natural === 'wetland' ? 'humedal' : 'agua', name,
      rings: e.members.filter((m) => m.role !== 'inner').map((m) => line(m.geometry)) });
  }
}

// 4) Barrios
const placesRaw = await overpass('places', `nwr[place~"^(suburb|neighbourhood|quarter)$"];`);
const barrios = (placesRaw.elements as El[]).flatMap((e) => {
  const p = point(e); const n = e.tags?.name;
  return p && n ? [{ name: n, lon: p[0], lat: p[1] }] : [];
});

// 5) Edificios (huellas)
const bRaw = await overpass('buildings', `way[building];`);
const buildings = (bRaw.elements as El[]).map((e) => {
  const lv = parseFloat(e.tags?.['building:levels'] ?? '');
  const hgt = parseFloat(e.tags?.height ?? '');
  return { h: hgt || (lv ? lv * 3 : 0), c: line(e.geometry) };
});

writeFileSync('public/data/osm.json', JSON.stringify({
  source: 'OpenStreetMap contributors (ODbL), consulta Overpass ' + new Date().toISOString().slice(0, 10),
  facilities, roads, waterLines, waterAreas, barrios,
}));
writeFileSync('public/data/buildings.json', JSON.stringify(buildings));
const count = (a: { cat: string }[]) => a.reduce((m, f) => ((m[f.cat] = (m[f.cat] ?? 0) + 1), m), {} as Record<string, number>);
console.log({ facilities: count(facilities), roads: roads.length, waterLines: waterLines.length,
  defensas: waterLines.filter((w) => w.kind === 'defensa').length, waterAreas: waterAreas.length,
  barrios: barrios.length, buildings: buildings.length });
