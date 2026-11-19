import { describe, it, expect } from 'vitest';
import {
  calcularCotaDeDesborde,
  calcularProfundidadDeBajos,
  calcularAgua,
  interpolarSerie,
  capacidadDeDrenaje,
} from '../src/escenario/inundacion.js';
import { crearModelo } from '../src/escenario/terreno.js';
import { CERO_ESCALA, UMBRALES_INA, NIVEL_CORONAMIENTO } from '../src/escenario/datos-ficticios.js';

// Grilla 5x1: río | 3 | 8 (barrera) | 2 | 4
function grillaConBarrera() {
  return {
    cota: new Float64Array([0, 3, 8, 2, 4]),
    esRio: new Uint8Array([1, 0, 0, 0, 0]),
    columnas: 5,
    filas: 1,
  };
}

describe('calcularCotaDeDesborde', () => {
  it('detrás de una barrera el agua necesita superar la barrera', () => {
    const d = calcularCotaDeDesborde(grillaConBarrera());
    expect(Array.from(d)).toEqual([0, 3, 8, 8, 8]);
  });

  it('sin barrera, cada celda se inunda al superar el punto más alto del camino', () => {
    const g = grillaConBarrera();
    g.cota[2] = 1;
    const d = calcularCotaDeDesborde(g);
    expect(Array.from(d)).toEqual([0, 3, 3, 3, 4]);
  });
});

describe('calcularProfundidadDeBajos', () => {
  it('mide cuánta agua junta un pozo', () => {
    const g = {
      cota: new Float64Array([5, 5, 5, 5, 2, 5, 5, 5, 5]),
      esRio: new Uint8Array(9),
      columnas: 3,
      filas: 3,
    };
    const p = calcularProfundidadDeBajos(g);
    expect(p[4]).toBe(3);
    expect(p[0]).toBe(0);
  });
});

describe('calcularAgua', () => {
  const drenaje = { capacidadNormalMm: 40, capacidadRioAltoMm: 10, umbralRioAltoM: 6, mmParaLlenarBajos: 100 };

  it('el río inunda solo lo que está conectado y por debajo', () => {
    const g = grillaConBarrera();
    const desborde = calcularCotaDeDesborde(g);
    const { profundidad, origen } = calcularAgua({
      cotaTerreno: g.cota,
      esRio: g.esRio,
      desborde,
      profundidadBajos: new Float64Array(5),
      nivelRio: 5,
      lluviaMm: 0,
      ceroEscala: 0,
      drenaje,
    });
    expect(profundidad[1]).toBeCloseTo(2);
    expect(origen[1]).toBe(1);
    expect(profundidad[3]).toBe(0);
  });

  it('con el río alto, la misma lluvia anega más', () => {
    const base = {
      cotaTerreno: new Float64Array([10]),
      esRio: new Uint8Array([0]),
      desborde: new Float64Array([Infinity]),
      profundidadBajos: new Float64Array([2]),
      lluviaMm: 60,
      ceroEscala: 0,
      drenaje,
    };
    const bajo = calcularAgua({ ...base, nivelRio: 3 }).profundidad[0];
    const alto = calcularAgua({ ...base, nivelRio: 7 }).profundidad[0];
    expect(bajo).toBeCloseTo(0.4);
    expect(calcularAgua({ ...base, nivelRio: 7, profundidadBajos: new Float64Array([0.2]) }).profundidad[0]).toBe(0);
    expect(alto).toBeCloseTo(1.0);
    expect(capacidadDeDrenaje(7, drenaje)).toBe(10);
  });
});

describe('interpolarSerie', () => {
  const serie = [
    [0, 4, 0],
    [10, 6, 50],
  ];
  it('interpola y respeta los extremos', () => {
    expect(interpolarSerie(serie, 5)).toEqual({ nivel: 5, lluvia: 25 });
    expect(interpolarSerie(serie, -1)).toEqual({ nivel: 4, lluvia: 0 });
    expect(interpolarSerie(serie, 99)).toEqual({ nivel: 6, lluvia: 50 });
  });
});

describe('modelo ficticio de Formosa', () => {
  const modelo = crearModelo();

  it('la defensa protege: dentro del anillo nada se inunda por río antes del coronamiento', () => {
    const umbralesDentro = modelo.infraestructura.filter((i) => i.dentroDefensa).map((i) => i.umbral.normal);
    expect(umbralesDentro.length).toBeGreaterThan(5);
    for (const u of umbralesDentro) expect(u).toBeGreaterThanOrEqual(NIVEL_CORONAMIENTO - 1e-9);
  });

  it('con falla de la defensa algo de adentro se afecta antes', () => {
    const conFalla = modelo.infraestructura.filter((i) => i.dentroDefensa && i.umbral.falla < NIVEL_CORONAMIENTO);
    expect(conFalla.length).toBeGreaterThan(0);
  });

  it('hay infraestructura fuera del anillo que se afecta cerca de la evacuación', () => {
    const fuera = modelo.infraestructura.filter((i) => !i.dentroDefensa);
    expect(fuera.some((i) => i.umbral.normal < UMBRALES_INA.evacuacion + 1)).toBe(true);
  });

  it('a 4,8 m (aguas medias) solo entra agua por la boca del riacho', () => {
    const { profundidad, origen } = calcularAgua({
      cotaTerreno: modelo.cotaTerreno,
      esRio: modelo.esRio,
      ...modelo.precalculo.normal,
      nivelRio: 4.8,
      lluviaMm: 0,
      ceroEscala: CERO_ESCALA,
      drenaje: { capacidadNormalMm: 45, capacidadRioAltoMm: 20, umbralRioAltoM: 6.5, mmParaLlenarBajos: 110 },
    });
    let fueraDelCauce = 0;
    for (let i = 0; i < profundidad.length; i++) if (origen[i] === 1) fueraDelCauce++;
    expect(fueraDelCauce).toBeLessThan(40);
    expect(profundidad.some((p) => p > 0)).toBe(true);
  });
});

describe('modelo sobre la geografía real (OSM)', async () => {
  const { readFileSync } = await import('node:fs');
  const { armarGeografia } = await import('../src/mapa/ciudad.js');
  const { DRENAJE } = await import('../src/escenario/datos-ficticios.js');
  const osm = JSON.parse(readFileSync(new URL('../public/datos/formosa-osm.json', import.meta.url), 'utf8'));
  const mde = JSON.parse(readFileSync(new URL('../public/datos/terreno.json', import.meta.url), 'utf8'));
  const geo = armarGeografia(
    osm.agua.filter((a) => !a.cerrado),
    osm.agua.filter((a) => a.cerrado).map((a) => a.c),
    mde,
  );
  const modelo = crearModelo(geo);
  const agua = (nivelRio, conFalla = false) =>
    calcularAgua({
      cotaTerreno: modelo.cotaTerreno,
      esRio: modelo.esRio,
      ...modelo.precalculo[conFalla ? 'falla' : 'normal'],
      nivelRio,
      lluviaMm: 0,
      ceroEscala: CERO_ESCALA,
      drenaje: DRENAJE,
    });
  const contar = ({ origen }, soloDentro) => {
    let n = 0;
    for (let i = 0; i < origen.length; i++) if (origen[i] === 1 && (!soloDentro || modelo.dentroDefensa[i])) n++;
    return n;
  };

  it('usa el Paraguay y el Riacho Formosa como ríos', () => {
    expect(geo.rios.length).toBeGreaterThanOrEqual(2);
    expect(modelo.esRio.some(Boolean)).toBe(true);
  });

  it('usa el terreno real (MDE) con alturas plausibles para Formosa', () => {
    expect(geo.mde.length).toBe(150 * 150);
    const centro = modelo.cotaTerreno[modelo.infraestructura.length]; // cualquier celda: solo que exista
    expect(Number.isFinite(centro)).toBe(true);
    expect(modelo.cotaMax).toBeLessThan(80);
    expect(modelo.cotaMin).toBeGreaterThan(40);
  });

  it('el agua del río crece con el nivel y a 4,70 m (hoy) no entra a la ciudad', () => {
    expect(contar(agua(4.7), true)).toBe(0);
    expect(contar(agua(7.8))).toBeGreaterThan(contar(agua(4.7)));
  });

  it('con la defensa sana no entra agua del río a la ciudad hasta el coronamiento', () => {
    expect(contar(agua(9.45), true)).toBe(0); // crecida de dic. 2015
    expect(contar(agua(10.73), true)).toBe(0); // récord de 1983, por debajo de los 11,70 m actuales
    expect(contar(agua(12), true)).toBeGreaterThan(0); // supera el coronamiento
    expect(contar(agua(9.1))).toBeGreaterThan(contar(agua(7.8)));
  });

  it('con falla de la defensa el agua entra a la ciudad', () => {
    expect(contar(agua(9.45, true), true)).toBeGreaterThan(0);
  });
});
