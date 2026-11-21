// Decision-support metrics derived from data the app already has: river exposure thresholds,
// the defense ring, precomputed reference zones and the live simulation.
import type { BarrioInfo, BarrioLive, FacilityInfo, FacilityLive, StreetLive } from './analysis';
import type { FacilityCat } from './data/load';

/** Categories whose loss stops emergency response (health, rescue, water and power). */
export const CRITICAL: FacilityCat[] = ['hospital', 'salud', 'seguridad', 'servicios'];
export const isCritical = (c: FacilityCat) => CRITICAL.includes(c);

// ---------- live timeline ----------

export interface TimelinePoint {
  t: number; // simulated seconds
  areaKm2: number;
  curbKm: number;
  impassableKm: number;
  buildingsWet: number;
  facilitiesAffected: number;
  barriosAffected: number;
}

export interface CriticalEvent {
  t: number;
  kind: 'hospital' | 'critical' | 'barrio' | 'road';
  text: string;
}

/** Records the live run so the dashboard can show curves, peaks and the first critical events. */
export class RunRecorder {
  points: TimelinePoint[] = [];
  events: CriticalEvent[] = [];
  private seen = new Set<string>();

  reset() {
    this.points = [];
    this.events = [];
    this.seen.clear();
  }

  push(p: TimelinePoint, facilities: FacilityInfo[], facLive: FacilityLive[], barrios: BarrioInfo[], barLive: BarrioLive[]) {
    const last = this.points[this.points.length - 1];
    if (last && p.t < last.t) this.reset(); // the run restarted
    if (last && p.t === last.t) return;
    this.points.push(p);
    const once = (key: string, e: CriticalEvent) => { if (!this.seen.has(key)) { this.seen.add(key); this.events.push(e); } };
    facLive.forEach((l, i) => {
      const f = facilities[i];
      if (!f || l.status !== 'afectado') return;
      if (f.cat === 'hospital') once(`h${i}`, { t: p.t, kind: 'hospital', text: `Agua en ${f.name}` });
      else if (isCritical(f.cat)) once(`c${i}`, { t: p.t, kind: 'critical', text: `Agua en ${f.name}` });
    });
    if (p.barriosAffected > 0) {
      const i = barLive.findIndex((b) => b.status === 'afectado');
      if (i >= 0) once('barrio', { t: p.t, kind: 'barrio', text: `Primer barrio afectado: ${barrios[i]?.name ?? '—'}` });
    }
    if (p.impassableKm >= 1) once('road', { t: p.t, kind: 'road', text: `Más de 1 km de calles intransitables` });
  }

  peak<K extends keyof TimelinePoint>(k: K) {
    let best: TimelinePoint | null = null;
    for (const p of this.points) if (!best || p[k] > best[k]) best = p;
    return best;
  }
}

// ---------- river exposure curve (static, from thresholds) ----------

export interface ExposureCurve {
  stages: number[];
  facilities: number[];
  critical: number[];
  barrios: number[];
}

/** How many facilities / barrios start receiving river water at each gauge height (step 0.1 m). */
export function exposureCurve(facilities: FacilityInfo[], barrios: BarrioInfo[], breach: boolean, from = 2, to = 13): ExposureCurve {
  const stageOf = (x: { stageSana: number | null; stageBrecha: number | null }) => (breach ? x.stageBrecha : x.stageSana);
  const stages: number[] = [], fac: number[] = [], crit: number[] = [], bar: number[] = [];
  const fs = facilities.map((f) => ({ s: stageOf(f), c: isCritical(f.cat) }));
  const bs = barrios.map(stageOf);
  for (let s = from; s <= to + 1e-6; s += 0.1) {
    const v = +s.toFixed(1);
    stages.push(v);
    let a = 0, b = 0;
    for (const f of fs) if (f.s != null && f.s <= v) { a++; if (f.c) b++; }
    fac.push(a); crit.push(b);
    bar.push(bs.filter((x) => x != null && x <= v).length);
  }
  return { stages, facilities: fac, critical: crit, barrios: bar };
}

export interface RiverMargin {
  /** Next facilities reached if the river rises, ordered by threshold. */
  next: { name: string; cat: FacilityCat; stage: number; rise: number }[];
  within50: number;
  within100: number;
  within200: number;
  reachedNow: number;
}

export function riverMargin(facilities: FacilityInfo[], river: number, breach: boolean): RiverMargin {
  const rows = facilities
    .map((f) => ({ name: f.name, cat: f.cat, stage: breach ? f.stageBrecha : f.stageSana }))
    .filter((r): r is { name: string; cat: FacilityCat; stage: number } => r.stage != null);
  const ahead = rows.filter((r) => r.stage > river).sort((a, z) => a.stage - z.stage);
  const within = (m: number) => ahead.filter((r) => r.stage <= river + m).length;
  return {
    next: ahead.slice(0, 5).map((r) => ({ ...r, rise: r.stage - river })),
    within50: within(0.5), within100: within(1), within200: within(2),
    reachedNow: rows.length - ahead.length,
  };
}

/** What the defense ring is worth: places that only get river water if it breaks. */
export function defenseValue(facilities: FacilityInfo[], barrios: BarrioInfo[]) {
  const fac = facilities.filter((f) => f.protectedByDefense);
  return {
    facilities: fac.length,
    critical: fac.filter((f) => isCritical(f.cat)).length,
    schools: fac.filter((f) => f.cat === 'escuela').length,
    barrios: barrios.filter((b) => b.protectedByDefense).length,
  };
}

// ---------- recommendations ----------

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export interface Recommendation {
  tone: 'bad' | 'warn' | 'ok' | 'info';
  title: string;
  detail: string;
}

export function recommendations(args: {
  facilities: FacilityInfo[];
  facLive: FacilityLive[];
  barrios: BarrioInfo[];
  barLive: BarrioLive[];
  streets: StreetLive | null;
  margin: RiverMargin | null;
  defense: ReturnType<typeof defenseValue> | null;
  river: number;
  breach: boolean;
  ran: boolean;
}): Recommendation[] {
  const { facilities, facLive, barrios, barLive, streets, margin, defense, river, breach, ran } = args;
  const out: Recommendation[] = [];
  // Unnamed OSM features ("(hospital sin nombre en OSM)") are counted but not listed by name.
  const names = (all: string[], n = 3) => {
    const xs = all.filter((x) => !x.startsWith('('));
    const rest = all.length - Math.min(n, xs.length);
    return xs.length ? xs.slice(0, n).join(', ') + (rest > 0 ? ` y ${rest} más` : '') : `${all.length} sin nombre en OpenStreetMap`;
  };

  if (ran) {
    const crit = facLive.map((l, i) => ({ l, f: facilities[i] })).filter(({ l, f }) => f && l.status === 'afectado' && isCritical(f.cat))
      .sort((a, z) => a.l.firstWet - z.l.firstWet);
    if (crit.length) out.push({
      tone: 'bad', title: `${crit.length} servicios críticos con agua`,
      detail: `Prever accesos alternativos y autonomía eléctrica en: ${names(crit.map((c) => c.f.name))}.`,
    });
    const roads = streets?.top.filter((t) => t.maxDepth >= 0.3) ?? [];
    if (roads.length) out.push({
      tone: 'warn', title: `${(streets?.impassableKm ?? 0).toFixed(1)} km de calles intransitables`,
      detail: `Planificar cortes y desvíos primero en: ${names(roads.map((r) => r.name))}.`,
    });
    const hit = barLive.map((l, i) => ({ l, b: barrios[i] })).filter(({ l, b }) => b && l.status === 'afectado')
      .sort((a, z) => z.l.share - a.l.share);
    if (hit.length) out.push({
      tone: 'warn', title: `${hit.length} barrios con más del 5 % de su superficie con agua`,
      detail: `Los más comprometidos: ${names(hit.map((h) => `${h.b.name} (${Math.round(h.l.share * 100)} %)`))}.`,
    });
    const dry = facLive.map((l, i) => ({ l, f: facilities[i] })).filter(({ l, f }) => f && f.cat === 'escuela' && l.status === 'seco' && f.tier === 0);
    if (dry.length) out.push({
      tone: 'ok', title: `${dry.length} escuelas secas y fuera de las zonas 1º/2º/3º`,
      detail: `Candidatas a evaluar como centros de evacuación (verificar accesos): ${names(dry.map((d) => d.f.name))}.`,
    });
  }
  if (margin && margin.next.length) {
    const n = margin.next.find((x) => !x.name.startsWith('(')) ?? margin.next[0];
    out.push({
      tone: margin.within50 ? 'warn' : 'info',
      title: margin.within50 ? `${margin.within50} instalaciones a menos de 50 cm del río` : `Próximo umbral a ${(n.rise * 100).toFixed(0)} cm`,
      detail: `Con el río a ${river.toFixed(2).replace('.', ',')} m${breach ? ' y la defensa rota' : ''}, la siguiente en recibir agua del río es ${n.name} (${n.stage.toFixed(2).replace('.', ',')} m). Hasta +1 m: ${margin.within100}; hasta +2 m: ${margin.within200}.`,
    });
  }
  if (defense && defense.facilities + defense.barrios > 0) out.push({
    tone: 'info', title: `La defensa protege ${plural(defense.facilities, 'instalación', 'instalaciones')} y ${plural(defense.barrios, 'barrio', 'barrios')}`,
    detail: `Entre ellas, ${plural(defense.critical, 'servicio crítico', 'servicios críticos')} y ${plural(defense.schools, 'escuela', 'escuelas')}: solo reciben agua del río si el terraplén se rompe. Mantener y vigilar el anillo es la medida de mayor alcance.`,
  });
  if (!ran) out.push({ tone: 'info', title: 'Corré una simulación', detail: 'Con «Hacer llover» se suman las prioridades del escenario: servicios críticos, calles, barrios y refugios posibles.' });
  return out;
}
