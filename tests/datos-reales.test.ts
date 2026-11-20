// Checks sobre los datos reales ya procesados en public/data (no descarga nada).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MASK_DEFENSE, MASK_RIVER } from '../src/sim/engine';
import { overflowElevation } from '../src/sim/exposure';
import { ASSUMPTIONS, LEVELS, RIVER_REF } from '../src/sim/scenarios';
import { DEFENSA_REAL, dentroDeDefensa, longitudKm } from '../src/sim/defensa-formosa';
import { withOfficialSchools, lonLatToCell, type EscuelasMen, type OsmData, type Poblacion, type TerrainMeta } from '../src/data/load';

const read = (f: string) => readFileSync(`public/data/${f}`);
const meta: TerrainMeta = JSON.parse(read('terrain.json').toString());
const z = new Float32Array(read('terrain.bin').buffer.slice(0));
const mask = new Uint8Array(read('masks.bin'));
const osm: OsmData = JSON.parse(read('osm.json').toString());
const men: EscuelasMen = JSON.parse(read('escuelas-men.json').toString());
const pob: Poblacion = JSON.parse(read('poblacion.json').toString());

const CENTRO: [number, number] = [-58.178, -26.183]; // microcentro, cerca de la plaza San Martín
const cellOf = ([lon, lat]: [number, number]) => {
  const [cx, cy] = lonLatToCell(meta, lon, lat);
  return Math.floor(cy) * meta.width + Math.floor(cx);
};

describe('datos de base', () => {
  it('terreno, máscaras y zonas tienen el mismo tamaño', () => {
    const n = meta.width * meta.height;
    expect(z.length).toBe(n);
    expect(mask.length).toBe(n);
    expect(read('zones.bin').length).toBe(n);
  });

  it('las zonas 1º/2º/3º se calcularon con los escenarios actuales', () => {
    const zones = JSON.parse(read('zones.json').toString());
    expect(zones.levels.map((l: { why: string }) => l.why)).toEqual(LEVELS.map((l) => l.why));
    const km2 = zones.stats.map((s: { km2: number }) => s.km2);
    expect(km2[0]).toBeLessThan(km2[1]);
    expect(km2[1]).toBeLessThan(km2[2]);
  });

  it('padrón escolar oficial y censo cargados', () => {
    expect(men.escuelas.length).toBeGreaterThan(200);
    const total = pob.poblacion.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(200_000); // Formosa Capital: ~250 mil habitantes (Censo 2022)
    expect(pob.poblacion.length).toBe(pob.columnas * pob.filas);
  });
});

describe('defensa', () => {
  it('la traza aproximada mide del orden de los 15–25 km', () => {
    const km = longitudKm(DEFENSA_REAL);
    expect(km).toBeGreaterThan(15);
    expect(km).toBeLessThan(25);
  });

  it('el centro queda dentro del anillo y el río afuera', () => {
    expect(dentroDeDefensa(CENTRO)).toBe(true);
    expect(dentroDeDefensa([-58.14, -26.18])).toBe(false);
  });

  it('el anillo está rasterizado como barrera en las máscaras', () => {
    const cells = mask.reduce((c, v) => c + (v & MASK_DEFENSE ? 1 : 0), 0);
    expect(cells).toBeGreaterThan(500); // ~20 km a 30 m por celda
  });

  it('con la defensa sana el centro no se expone al río hasta superar el coronamiento', () => {
    const normal = overflowElevation(meta.width, meta.height, z, mask, ASSUMPTIONS.defenseCrest);
    const fail = overflowElevation(meta.width, meta.height, z, mask, null);
    const i = cellOf(CENTRO);
    expect(normal[i] - ASSUMPTIONS.gaugeZero).toBeGreaterThanOrEqual(RIVER_REF.defenseStage - 0.01);
    expect(fail[i]).toBeLessThanOrEqual(normal[i]);
  });

  it('con el río de hoy (observado INA) casi nada queda conectado al río', () => {
    const o = overflowElevation(meta.width, meta.height, z, mask, ASSUMPTIONS.defenseCrest);
    const lvl = ASSUMPTIONS.gaugeZero + RIVER_REF.observed.stage;
    let wet = 0;
    for (let i = 0; i < o.length; i++) if (!(mask[i] & MASK_RIVER) && o[i] < lvl) wet++;
    const km2 = (wet * meta.cellX * meta.cellY) / 1e6;
    expect(km2).toBeLessThan(5);
  });
});

describe('escuelas oficiales', () => {
  it('reemplazan a las de OSM y se marca si están dentro de la defensa', () => {
    const out = withOfficialSchools(osm, men);
    const esc = out.facilities.filter((f) => f.cat === 'escuela');
    expect(esc.length).toBe(men.escuelas.length);
    expect(esc.every((f) => f.source === 'Mapa Educativo Nacional')).toBe(true);
    expect(out.facilities.some((f) => f.cat === 'hospital')).toBe(true);
    expect(esc.some((f) => f.inside) && esc.some((f) => !f.inside)).toBe(true);
  });

  it('saca lo que está en la margen paraguaya (Alberdi) y deja lo de Formosa', () => {
    const out = withOfficialSchools(osm, men);
    const names = out.facilities.map((f) => f.name);
    expect(names).not.toContain('Hospital De Alberdi');
    expect(names).not.toContain('Municipalidad de Alberdi');
    expect(names.some((n) => /Hospital Central/i.test(n))).toBe(true);
  });
});
