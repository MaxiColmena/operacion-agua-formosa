// Checks sobre los datos reales ya procesados en public/data, la prioridad por población y la validación.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MASK_DEFENSE, downsample } from '../src/sim/engine';
import { LEVELS, RIVER_REF, daysToRise } from '../src/sim/scenarios';
import { DEFENSA_ANILLO, longitudKm } from '../src/sim/defensa';
import { withOfficialSchools, lonLatToCell, THRESHOLD_NONE, type AppData, type EscuelasMen, type OsmData, type Poblacion, type TerrainMeta } from '../src/data/load';
import { prepareBarrios, prepareStreets } from '../src/analysis';
import {
  censusToSim, exposedProfile, groupLive, groupPriority, liveUrgency, priorityCells, simTiers, vulnerabilityIndex, IVS_MAX, IVS_MIN, SOCIO_FIELDS, type Profile,
} from '../src/priority';
import { validate, REPORTED_BARRIOS } from '../src/validation';

const read = (f: string) => readFileSync(`public/data/${f}`);
const meta: TerrainMeta = JSON.parse(read('terrain.json').toString());
const z = new Float32Array(read('terrain.bin').buffer.slice(0));
const mask = new Uint8Array(read('masks.bin'));
const osmRaw: OsmData = JSON.parse(read('osm.json').toString());
const men: EscuelasMen = JSON.parse(read('escuelas-men.json').toString());
const pob: Poblacion = JSON.parse(read('poblacion.json').toString());
const osm = withOfficialSchools(osmRaw, men);
const n = meta.width * meta.height;
const thrBuf = read('thresholds.bin');
const thrSana = new Uint16Array(n);
for (let i = 0; i < n; i++) thrSana[i] = thrBuf.readUInt16LE(i * 2);
const data = {
  meta, z, mask, zones: new Uint8Array(read('zones.bin')), zonesMeta: null, osm, buildings: null,
  thresholds: null, drainage: null, drainageMeta: null, escuelas: men, poblacion: pob,
} as AppData;
const ds = downsample({ width: meta.width, height: meta.height, cellX: meta.cellX, cellY: meta.cellY, z }, mask, 2);
const sim = { width: ds.grid.width, height: ds.grid.height, factor: 2, mask: ds.mask };

describe('datos de base', () => {
  it('terreno, máscaras, zonas y umbrales tienen el mismo tamaño', () => {
    expect(z.length).toBe(n);
    expect(mask.length).toBe(n);
    expect(read('zones.bin').length).toBe(n);
    expect(thrBuf.length).toBe(n * 4);
  });

  it('las zonas 1º/2º/3º se calcularon con los escenarios actuales', () => {
    const zones = JSON.parse(read('zones.json').toString());
    expect(zones.levels.map((l: { why: string }) => l.why)).toEqual(LEVELS.map((l) => l.why));
    const km2 = zones.stats.map((s: { km2: number }) => s.km2);
    expect(km2[0]).toBeLessThan(km2[1]);
    expect(km2[1]).toBeLessThan(km2[2]);
  });

  it('el anillo de defensa está cerrado como barrera y protege el centro hasta el coronamiento', () => {
    expect(longitudKm(DEFENSA_ANILLO)).toBeGreaterThan(15);
    expect(mask.reduce((c, v) => c + (v & MASK_DEFENSE ? 1 : 0), 0)).toBeGreaterThan(500);
    const [cx, cy] = lonLatToCell(meta, -58.178, -26.183); // microcentro
    const v = thrSana[Math.floor(cy) * meta.width + Math.floor(cx)];
    expect(v === THRESHOLD_NONE || v / 100 >= 11.6).toBe(true);
  });
});

describe('escuelas oficiales y margen paraguaya', () => {
  it('las escuelas vienen del Mapa Educativo Nacional', () => {
    const esc = osm.facilities.filter((f) => f.cat === 'escuela');
    expect(esc.length).toBe(men.escuelas.length);
    expect(esc.every((f) => f.source === 'Mapa Educativo Nacional')).toBe(true);
  });

  it('saca las instalaciones de Alberdi (Paraguay) y deja las de Formosa', () => {
    const names = osm.facilities.map((f) => f.name);
    expect(names).not.toContain('Hospital De Alberdi');
    expect(names.some((x) => /Hospital Central/i.test(x))).toBe(true);
  });

  it('las calles de Alberdi no cuentan en los resultados', () => {
    const st = prepareStreets(data, sim, new Uint8Array(sim.width * sim.height))!;
    for (const calle of ['Parapití', 'Curupayty', 'Soldado Paraguayo']) expect(st.names).not.toContain(calle);
    expect(st.names).toContain('Avenida 25 de Mayo');
  });
});

describe('supuesto del escenario: en cuántos días sube el río', () => {
  it('declara días de subida desde el dato observado y 0 si no sube', () => {
    expect(daysToRise(RIVER_REF.observed.stage)).toBe(0);
    expect(daysToRise(7.8)).toBeGreaterThan(15);
    expect(daysToRise(7.8)).toBeLessThan(30);
  });
});

// ---------- prioridad por población ----------
const profile = (p: Partial<Profile>): Profile => ({ ...Object.fromEntries(SOCIO_FIELDS.map((f) => [f, 0])), ...p }) as Profile;

describe('índice de vulnerabilidad y urgencia', () => {
  const city = profile({ poblacion: 1000, hogares: 300, hogaresNbi: 30, menores14: 200, mayores65: 100, sinCobertura: 400 });
  it('vale 1 para el promedio de la ciudad, sube con más vulnerabilidad y tiene topes', () => {
    expect(vulnerabilityIndex(city, city)).toBeCloseTo(1, 6);
    const pobre = profile({ poblacion: 100, hogares: 30, hogaresNbi: 9, menores14: 40, mayores65: 5, sinCobertura: 80 });
    expect(vulnerabilityIndex(pobre, city)).toBeGreaterThan(1.5);
    expect(vulnerabilityIndex(pobre, city)).toBeLessThanOrEqual(IVS_MAX);
    const rica = profile({ poblacion: 100, hogares: 40, hogaresNbi: 0, menores14: 10, mayores65: 10, sinCobertura: 5 });
    expect(vulnerabilityIndex(rica, city)).toBe(IVS_MIN);
  });
  it('el agua que llega primero pesa más', () => {
    expect(liveUrgency(0, true, 3600)).toBe(3);
    expect(liveUrgency(2000, false, 3600)).toBe(2);
    expect(liveUrgency(3500, false, 3600)).toBe(1);
  });
});

const cg = censusToSim(data, sim)!;
const tiers = simTiers(data, sim);
const cellScore = priorityCells(cg, tiers);
const barrios = prepareBarrios(data, sim);
const prio = groupPriority(barrios.map((b) => b.cells), cg, tiers, cellScore);

describe('prioridad por población con datos reales', () => {
  it('conserva la población del Censo 2022 en el área (~254 mil)', () => {
    const total = cg.fields.poblacion.reduce((a, b) => a + b, 0);
    expect(cg.hasSocio).toBe(true);
    expect(total).toBeGreaterThan(240_000);
    expect(total).toBeLessThan(260_000);
    expect(cg.city.hogaresNbi).toBeLessThan(cg.city.hogares);
  });

  it('el puntaje es cero fuera de las zonas 1º/2º/3º', () => {
    for (let c = 0; c < cellScore.length; c++) if (!tiers[c]) expect(cellScore[c]).toBe(0);
  });

  it('un barrio chico que se afecta primero (nivel 1º) queda debajo del barrio de nivel 2º más poblado', () => {
    const lista = prio.map((p, i) => ({ p, b: barrios[i], gente: p.peopleByTier[0] + p.peopleByTier[1] + p.peopleByTier[2] }))
      .filter((x) => x.p.score > 0).sort((a, b) => b.p.score - a.p.score);
    const nivel2Grande = lista.filter((x) => x.b.tier === 2).sort((a, b) => b.gente - a.gente)[0];
    const nivel1Chicos = lista.filter((x) => x.b.tier === 1 && x.gente < 500);
    expect(nivel1Chicos.length).toBeGreaterThan(0);
    for (const chico of nivel1Chicos) expect(lista.indexOf(chico)).toBeGreaterThan(lista.indexOf(nivel2Grande));
  });
});

describe('validación con barrios reportados con agua (prensa)', () => {
  const { rows, ranked } = validate(barrios, prio.map((p) => p.score));
  it('todos los barrios reportados existen en OpenStreetMap', () => {
    expect(rows.filter((r) => !r.found).map((r) => r.name)).toEqual([]);
  });
  it('el modelo marca a la mayoría dentro de las zonas 1º/2º/3º', () => {
    expect(rows.filter((r) => r.tier > 0).length).toBeGreaterThanOrEqual(Math.ceil(REPORTED_BARRIOS.length * 0.66));
  });
  it('la mayoría de los reportados por lluvia queda en la mitad superior de la lista de prioridad', () => {
    const lluvia = rows.filter((r) => r.kind === 'lluvia' && r.rank > 0);
    expect(lluvia.filter((r) => r.rank <= ranked / 2).length).toBeGreaterThanOrEqual(Math.ceil(lluvia.length / 2));
  });
});

describe('familias con agua por barrio', () => {
  it('las familias de los barrios no superan el total del área y son menos que las personas', () => {
    // Agua de 20 cm en toda la grilla: todos los barrios con gente quedan "con agua".
    const d = new Float32Array(sim.width * sim.height).fill(0.2);
    const tWet = new Float32Array(d.length).fill(600);
    const byRiver = new Uint8Array(d.length);
    const live = groupLive(barrios.map((b) => b.cells), cg, d, tWet, byRiver, 0.15, 3600);
    const total = exposedProfile(cg, d, 0.15);
    const suma = live.reduce((a, l) => a + l.homes, 0);
    expect(suma).toBeGreaterThan(0);
    expect(suma).toBeLessThanOrEqual(total.hogares + 1);
    for (const l of live) expect(l.homes).toBeLessThanOrEqual(l.people + 1e-6);
  });
});

describe('reparto de la población según los edificios', () => {
  it('casi nadie queda ubicado sobre el río o las lagunas (antes: 1,6 %)', () => {
    let total = 0, enAgua = 0;
    for (let c = 0; c < cg.fields.poblacion.length; c++) {
      total += cg.fields.poblacion[c];
      if (sim.mask[c] & 5) enAgua += cg.fields.poblacion[c]; // río (1) o agua permanente (4)
    }
    expect(enAgua / total).toBeLessThan(0.01);
  });

  it('el microcentro es su propio barrio («Centro») y no se cuenta dentro de San Martín', () => {
    const centro = barrios.find((b) => b.name === 'Centro');
    expect(centro).toBeDefined();
    const pob = centro!.cells.reduce((s, c) => s + cg.fields.poblacion[c], 0);
    expect(pob).toBeGreaterThan(1000);
  });
});
