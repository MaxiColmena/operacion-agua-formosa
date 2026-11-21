// Decision dashboard: priorities, live curves, river exposure and the value of the defense ring.
import { useMemo, useState, type ReactNode } from 'react';
import type { BarrioInfo, BarrioLive, FacilityInfo, FacilityLive, StreetLive } from '../analysis';
import { fmtTime } from '../analysis';
import type { ZonesMeta } from '../data/load';
import { defenseValue, exposureCurve, recommendations, riverMargin, type RunRecorder, type TimelinePoint } from '../insights';
import { RIVER_REF, LEVELS } from '../sim/scenarios';
import { fmtStage } from './threshold';
import { Icon, type IconName } from './icons';

/** Two categorical series validated for the dark surface (CVD ΔE 20.8, contrast ≥ 3:1). */
const SERIES_A = '#2f9fd0';
const SERIES_B = '#c8743a';

export interface AnalyticsProps {
  open: boolean;
  onClose: () => void;
  facilities: FacilityInfo[];
  facLive: FacilityLive[];
  barrios: BarrioInfo[];
  barLive: BarrioLive[];
  streets: StreetLive | null;
  recorder: RunRecorder;
  /** Bumps whenever the recorder gets a new point, so curves re-render. */
  version: number;
  river: number;
  breach: boolean;
  crest: number;
  zonesMeta: ZonesMeta | null;
  hasThresholds: boolean;
  onFocusFacility: (name: string) => void;
}

const TONE_ICON: Record<string, IconName> = { bad: 'alert', warn: 'alert', ok: 'check', info: 'info' };

export function AnalyticsPanel(p: AnalyticsProps) {
  const { facilities, facLive, barrios, barLive, streets, recorder, river, breach, crest } = p;
  const ran = recorder.points.length > 1;
  const margin = useMemo(() => (p.hasThresholds ? riverMargin(facilities, river, breach) : null), [facilities, river, breach, p.hasThresholds]);
  const defense = useMemo(() => (p.hasThresholds ? defenseValue(facilities, barrios) : null), [facilities, barrios, p.hasThresholds]);
  const curve = useMemo(() => (p.hasThresholds ? exposureCurve(facilities, barrios, breach) : null), [facilities, barrios, breach, p.hasThresholds]);
  const recs = useMemo(() => recommendations({ facilities, facLive, barrios, barLive, streets, margin, defense, river, breach, ran }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [facilities, facLive, barrios, barLive, streets, margin, defense, river, breach, ran]);

  return (
    <aside className={`drawer ${p.open ? 'open' : ''}`} aria-hidden={!p.open} aria-label="Análisis para decidir" data-tour="analytics">
      <header className="drawer-h">
        <div>
          <span className="eyebrow">Tablero</span>
          <h2>Análisis para decidir</h2>
          <p>Qué priorizar con el escenario actual y cuánto margen queda antes del próximo umbral.</p>
        </div>
        <button className="icon-btn" onClick={p.onClose} aria-label="Cerrar el análisis"><Icon name="close" /></button>
      </header>

      {p.open && <div className="drawer-body">
        <Section title="Prioridades" hint="Reglas simples sobre los resultados en vivo y los umbrales del río. Orientan; no reemplazan la evaluación en terreno.">
          <ul className="recs">
            {recs.map((r) => (
              <li key={r.title} className={`rec rec-${r.tone}`}>
                <Icon name={TONE_ICON[r.tone]} size={18} />
                <div><b>{r.title}</b><p>{r.detail}</p></div>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Cómo evolucionó la simulación" hint={ran ? 'Pasá el mouse por las curvas para ver cada momento.' : 'Las curvas aparecen al correr una simulación.'}>
          {ran ? (
            <div className="multiples">
              <Spark points={recorder.points} k="curbKm" label="Calles sobre el cordón" unit="km" digits={1} />
              <Spark points={recorder.points} k="buildingsWet" label="Edificios con agua" unit="" digits={0} />
              <Spark points={recorder.points} k="areaKm2" label="Área con agua ≥ 15 cm" unit="km²" digits={1} />
            </div>
          ) : <p className="empty-note">Todavía no hay datos de esta corrida.</p>}
          {recorder.events.length > 0 && (
            <ol className="events">
              {recorder.events.slice(0, 8).map((e) => (
                <li key={e.kind + e.text} className={`ev ev-${e.kind}`}>
                  <span className="mono">{fmtTime(e.t).replace('t=0 (río)', '0 min')}</span>
                  <button onClick={() => p.onFocusFacility(e.text.replace(/^Agua en /, ''))} disabled={!e.text.startsWith('Agua en ')}>{e.text}</button>
                </li>
              ))}
            </ol>
          )}
        </Section>

        {curve && margin && (
          <Section title="Exposición al río" hint={`Instalaciones a las que llega agua del río según la altura en Puerto Formosa${breach ? ', con la defensa rota' : ', con la defensa sana'}. Estimación estática: sin lluvia ni tiempos.`}>
            <div className="kpi-row">
              <Kpi value={margin.reachedNow} label="ya alcanzadas" tone={margin.reachedNow ? 'bad' : undefined} />
              <Kpi value={margin.within50} label="a menos de 50 cm" tone={margin.within50 ? 'warn' : undefined} />
              <Kpi value={margin.within100} label="hasta +1 m" />
              <Kpi value={margin.within200} label="hasta +2 m" />
            </div>
            <ExposureChart curve={curve} river={river} crest={crest} />
            <details className="table-view">
              <summary>Ver como tabla</summary>
              <table>
                <thead><tr><th>Altura del río</th><th>Instalaciones</th><th>Críticas</th><th>Barrios</th></tr></thead>
                <tbody>
                  {refMarks(crest, river).map((m) => {
                    const i = Math.max(0, Math.min(curve.stages.length - 1, Math.round((m.v - curve.stages[0]) * 10)));
                    return <tr key={m.t}><td>{m.t} · {fmtStage(m.v)}</td><td className="mono">{curve.facilities[i]}</td><td className="mono">{curve.critical[i]}</td><td className="mono">{curve.barrios[i]}</td></tr>;
                  })}
                </tbody>
              </table>
            </details>
          </Section>
        )}

        {defense && (
          <Section title="Qué protege la defensa" hint="Lugares que solo reciben agua del río si el terraplén se rompe (brecha de ~200 m frente al puerto).">
            <div className="kpi-row">
              <Kpi value={defense.facilities} label="instalaciones" />
              <Kpi value={defense.critical} label="servicios críticos" />
              <Kpi value={defense.schools} label="escuelas" />
              <Kpi value={defense.barrios} label="barrios" />
            </div>
          </Section>
        )}

        {p.zonesMeta && (
          <Section title="Escenarios de referencia" hint="Superficie con agua ≥ 15 cm en cada nivel precalculado (acumulada).">
            <Bars rows={p.zonesMeta.stats.map((s, i) => ({ label: `${LEVELS[i]?.short ?? s.id} · ${LEVELS[i]?.label ?? ''}`, value: s.km2 }))} unit="km²" />
          </Section>
        )}
      </div>}
    </aside>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="an-section">
      <h3>{title}</h3>
      {hint && <p className="an-hint">{hint}</p>}
      {children}
    </section>
  );
}

function Kpi({ value, label, tone }: { value: number; label: string; tone?: 'bad' | 'warn' }) {
  return <div className={`kpi-mini ${tone ?? ''}`}><b className="mono">{value}</b><span>{label}</span></div>;
}

function refMarks(crest: number, river: number) {
  return [
    { v: RIVER_REF.observed.stage, t: 'Hoy' },
    { v: RIVER_REF.alert, t: 'Alerta' },
    { v: RIVER_REF.evacuation, t: 'Evacuación' },
    { v: RIVER_REF.record1983, t: '1983' },
    { v: crest, t: 'Defensa' },
    { v: river, t: 'Escenario' },
  ];
}

/** Step chart: facilities reached vs river height, two series, reference rules and a hover crosshair. */
function ExposureChart({ curve, river, crest }: { curve: ReturnType<typeof exposureCurve>; river: number; crest: number }) {
  const [hi, setHi] = useState<number | null>(null);
  const W = 480, H = 210, L = 34, R = 12, T = 26, B = 26;
  const s0 = curve.stages[0], s1 = curve.stages[curve.stages.length - 1];
  const yMax = Math.max(4, ...curve.facilities);
  const x = (s: number) => L + ((s - s0) / (s1 - s0)) * (W - L - R);
  const y = (v: number) => T + (1 - v / yMax) * (H - T - B);
  const step = (vals: number[]) => vals.map((v, i) => `${i ? 'H' : 'M'}${x(curve.stages[i]).toFixed(1)}${i ? '' : `,${y(v).toFixed(1)}`} V${y(v).toFixed(1)}`).join(' ');
  const ticks = [0, Math.round(yMax / 2), yMax];
  const marks = refMarks(crest, river).filter((m) => m.t !== 'Escenario' && m.v >= s0 && m.v <= s1);
  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const sx = s0 + ((e.clientX - r.left) / r.width) * (s1 - s0);
    setHi(Math.max(0, Math.min(curve.stages.length - 1, Math.round((sx - s0) * 10))));
  };
  const last = curve.stages.length - 1;
  return (
    <figure className="chart">
      <div className="legend-row">
        <span><i style={{ background: SERIES_A }} />Todas las instalaciones</span>
        <span><i style={{ background: SERIES_B }} />Servicios críticos</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Instalaciones alcanzadas por el río según su altura">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="grid" />
            <text x={L - 6} y={y(t) + 4} className="axis" textAnchor="end">{t}</text>
          </g>
        ))}
        {marks.map((m, i) => (
          <g key={m.t}>
            <line x1={x(m.v)} x2={x(m.v)} y1={T - 4} y2={H - B} className="ref" />
            <text x={x(m.v)} y={i % 2 ? T - 14 : T - 6} className="axis" textAnchor="middle">{m.t}</text>
          </g>
        ))}
        <line x1={x(river)} x2={x(river)} y1={T} y2={H - B} className="now" />
        <path d={step(curve.facilities)} fill="none" stroke={SERIES_A} strokeWidth={2} />
        <path d={step(curve.critical)} fill="none" stroke={SERIES_B} strokeWidth={2} />
        <text x={W - R} y={y(curve.facilities[last]) - 6} className="dlabel" textAnchor="end">{curve.facilities[last]}</text>
        <text x={W - R} y={y(curve.critical[last]) - 6} className="dlabel" textAnchor="end">{curve.critical[last]}</text>
        {[2, 4, 6, 8, 10, 12].map((s) => <text key={s} x={x(s)} y={H - 8} className="axis" textAnchor="middle">{s} m</text>)}
        {hi != null && (
          <g pointerEvents="none">
            <line x1={x(curve.stages[hi])} x2={x(curve.stages[hi])} y1={T} y2={H - B} className="cross" />
            <circle cx={x(curve.stages[hi])} cy={y(curve.facilities[hi])} r={4} fill={SERIES_A} className="dot" />
            <circle cx={x(curve.stages[hi])} cy={y(curve.critical[hi])} r={4} fill={SERIES_B} className="dot" />
          </g>
        )}
        <rect x={L} y={T} width={W - L - R} height={H - T - B} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHi(null)} />
      </svg>
      {hi != null && (
        <div className="chart-tip" style={{ left: `${(x(curve.stages[hi]) / W) * 100}%` }}>
          <b>Río a {fmtStage(curve.stages[hi])}</b>
          <span><i style={{ background: SERIES_A }} />{curve.facilities[hi]} instalaciones</span>
          <span><i style={{ background: SERIES_B }} />{curve.critical[hi]} críticas</span>
          <span>{curve.barrios[hi]} barrios</span>
        </div>
      )}
    </figure>
  );
}

/** Single-series small multiple with peak annotation and hover readout. */
function Spark({ points, k, label, unit, digits }: { points: TimelinePoint[]; k: keyof TimelinePoint; label: string; unit: string; digits: number }) {
  const [hi, setHi] = useState<number | null>(null);
  const W = 300, H = 64, P = 4;
  const tMax = Math.max(1, points[points.length - 1].t);
  const vMax = Math.max(1e-6, ...points.map((p) => p[k]));
  const x = (t: number) => P + (t / tMax) * (W - 2 * P);
  const y = (v: number) => H - P - (v / vMax) * (H - 2 * P);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p[k]).toFixed(1)}`).join(' ');
  const peak = points.reduce((a, b) => (b[k] > a[k] ? b : a), points[0]);
  const fmt = (v: number) => `${v.toLocaleString('es-AR', { maximumFractionDigits: digits, minimumFractionDigits: digits })}${unit ? ` ${unit}` : ''}`;
  const cur = hi != null ? points[hi] : null;
  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const t = ((e.clientX - r.left) / r.width) * tMax;
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(points[i].t - t) < Math.abs(points[best].t - t)) best = i;
    setHi(best);
  };
  return (
    <div className="spark">
      <div className="spark-h">
        <span>{label}</span>
        <b className="mono">{fmt(cur ? cur[k] : points[points.length - 1][k])}</b>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${label}: máximo ${fmt(peak[k])} a los ${fmtTime(peak.t)}`}>
        <path d={`${line} L${x(tMax)},${H - P} L${x(0)},${H - P} Z`} className="spark-area" />
        <path d={line} fill="none" stroke={SERIES_A} strokeWidth={2} vectorEffect="non-scaling-stroke" />
        {cur && <line x1={x(cur.t)} x2={x(cur.t)} y1={0} y2={H} className="cross" vectorEffect="non-scaling-stroke" />}
        <rect x={0} y={0} width={W} height={H} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHi(null)} />
      </svg>
      <small>{cur ? `a los ${fmtTime(cur.t).replace('t=0 (río)', '0 min')}` : `máximo ${fmt(peak[k])} · a los ${fmtTime(peak.t).replace('t=0 (río)', '0 min')}`}</small>
    </div>
  );
}

function Bars({ rows, unit }: { rows: { label: string; value: number }[]; unit: string }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="bars">
      {rows.map((r) => (
        <li key={r.label} title={`${r.label}: ${r.value} ${unit}`}>
          <span className="bars-l">{r.label}</span>
          <span className="bars-track"><i style={{ width: `${(r.value / max) * 100}%` }} /></span>
          <b className="mono">{r.value.toLocaleString('es-AR')} {unit}</b>
        </li>
      ))}
    </ul>
  );
}
