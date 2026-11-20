// Checks de la prioridad por población (Censo 2022) y validación contra barrios reportados con agua.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  censusToSim, groupPriority, liveUrgency, priorityCells, simTiers, vulnerabilityIndex, IVS_MAX, IVS_MIN, SOCIO_FIELDS,
  type Profile,
} from '../src/priority';
import { prepareBarrios } from '../src/analysis';
import { downsample } from '../src/sim/engine';
import { withOfficialSchools, type AppData } from '../src/data/load';
import { validate, REPORTED_BARRIOS } from '../src/validation';

const profile = (p: Partial<Profile>): Profile => ({ ...Object.fromEntries(SOCIO_FIELDS.map((f) => [f, 0])), ...p }) as Profile;

describe('índice de vulnerabilidad', () => {
  const city = profile({ poblacion: 1000, hogares: 300, hogaresNbi: 30, menores14: 200, mayores65: 100, sinCobertura: 400 });

  it('vale 1 para una zona igual al promedio de la ciudad', () => {
    expect(vulnerabilityIndex(city, city)).toBeCloseTo(1, 6);
  });

  it('sube con más NBI, más dependientes y menos cobertura, con tope', () => {
    const pobre = profile({ poblacion: 100, hogares: 30, hogaresNbi: 9, menores14: 40, mayores65: 5, sinCobertura: 80 });
    const v = vulnerabilityIndex(pobre, city);
    expect(v).toBeGreaterThan(1.5);
    expect(v).toBeLessThanOrEqual(IVS_MAX);
    const rica = profile({ poblacion: 100, hogares: 40, hogaresNbi: 0, menores14: 10, mayores65: 10, sinCobertura: 5 });
    expect(vulnerabilityIndex(rica, city)).toBe(IVS_MIN);
  });
});

describe('urgencia por llegada del agua', () => {
  it('el agua del río o la que llega primero pesa más', () => {
    expect(liveUrgency(0, true, 3600)).toBe(3);
    expect(liveUrgency(600, false, 3600)).toBe(3);
    expect(liveUrgency(2000, false, 3600)).toBe(2);
    expect(liveUrgency(3500, false, 3600)).toBe(1);
  });
});

// ---------- con los datos reales ----------
const read = (f: string) => readFileSync(`public/data/${f}`);
const meta = JSON.parse(read('terrain.json').toString());
const z = new Float32Array(read('terrain.bin').buffer.slice(0));
const mask = new Uint8Array(read('masks.bin'));
const data = {
  meta, z, mask,
  zones: new Uint8Array(read('zones.bin')),
  zonesMeta: null,
  osm: withOfficialSchools(JSON.parse(read('osm.json').toString()), JSON.parse(read('escuelas-men.json').toString())),
  buildings: null, escuelas: null,
  poblacion: JSON.parse(read('poblacion.json').toString()),
} as AppData;
const ds = downsample({ width: meta.width, height: meta.height, cellX: meta.cellX, cellY: meta.cellY, z }, mask, 2);
const sim = { width: ds.grid.width, height: ds.grid.height, factor: 2, mask: ds.mask };
const cg = censusToSim(data, sim)!;
const tiers = simTiers(data, sim);
const cellScore = priorityCells(cg, tiers);
const barrios = prepareBarrios(data, sim);
const prio = groupPriority(barrios.map((b) => b.cells), cg, tiers, cellScore);

describe('censo en la grilla de la simulación', () => {
  it('conserva la población del área (Censo 2022: ~254 mil en el recorte)', () => {
    const total = cg.fields.poblacion.reduce((a, b) => a + b, 0);
    expect(cg.hasSocio).toBe(true);
    expect(total).toBeGreaterThan(240_000);
    expect(total).toBeLessThan(260_000);
    // Los hogares con NBI son un subconjunto de los hogares.
    expect(cg.city.hogaresNbi).toBeLessThan(cg.city.hogares);
    expect(cg.city.hogaresNbi / cg.city.hogares).toBeGreaterThan(0.05);
  });

  it('el puntaje es cero fuera de las zonas 1º/2º/3º y positivo en zonas pobladas', () => {
    let fuera = 0, dentro = 0;
    for (let c = 0; c < cellScore.length; c++) {
      if (!tiers[c] && cellScore[c] > 0) fuera++;
      if (tiers[c] && cg.fields.poblacion[c] > 0 && cellScore[c] > 0) dentro++;
    }
    expect(fuera).toBe(0);
    expect(dentro).toBeGreaterThan(100);
  });

  it('un barrio chico que se afecta primero (nivel 1º) queda debajo del barrio de nivel 2º más poblado', () => {
    const lista = prio.map((p, i) => ({ p, b: barrios[i], gente: p.peopleByTier[0] + p.peopleByTier[1] + p.peopleByTier[2] }))
      .filter((x) => x.p.score > 0).sort((a, b) => b.p.score - a.p.score);
    expect(lista.length).toBeGreaterThan(20);
    const pos = (x: (typeof lista)[number]) => lista.indexOf(x);
    const nivel2Grande = lista.filter((x) => x.b.tier === 2).sort((a, b) => b.gente - a.gente)[0];
    const nivel1Chicos = lista.filter((x) => x.b.tier === 1 && x.gente < 500);
    expect(nivel1Chicos.length).toBeGreaterThan(0);
    for (const chico of nivel1Chicos) expect(pos(chico)).toBeGreaterThan(pos(nivel2Grande));
  });
});

describe('validación con barrios reportados con agua (prensa)', () => {
  const { rows, ranked } = validate(barrios, prio.map((p) => p.score));

  it('todos los barrios reportados existen en OpenStreetMap', () => {
    expect(rows.filter((r) => !r.found).map((r) => r.name)).toEqual([]);
  });

  it('el modelo marca a los barrios reportados dentro de las zonas 1º/2º/3º', () => {
    const marcados = rows.filter((r) => r.tier > 0).length;
    // Se exige la mayoría; los que falten se muestran en la app como desacuerdos, no se esconden.
    expect(marcados).toBeGreaterThanOrEqual(Math.ceil(REPORTED_BARRIOS.length * 0.66));
  });

  it('los barrios reportados por lluvia quedan en la mitad superior de la lista de prioridad', () => {
    const lluvia = rows.filter((r) => r.kind === 'lluvia' && r.rank > 0);
    const arriba = lluvia.filter((r) => r.rank <= ranked / 2).length;
    expect(arriba).toBeGreaterThanOrEqual(Math.ceil(lluvia.length / 2));
  });
});
