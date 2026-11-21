// Left panel: choose a scenario, tune it and run the simulation.
import { useState, type ReactNode } from 'react';
import type { Scenario } from '../sim/engine';
import type { SimStats } from '../sim/worker';
import { ASSUMPTIONS, PRESETS, RIVER_REF, INA_SCALE, INA_CATEGORY_REF } from '../sim/scenarios';
import { fmtStage } from './threshold';
import { fmtClock, fmtHours } from './format';
import { Icon } from './icons';

const SPEEDS = [{ v: 300, l: '5 min/s' }, { v: 900, l: '15 min/s' }, { v: 1800, l: '30 min/s' }];

export interface ScenarioPanelProps {
  scenario: Scenario;
  presetId: string | null;
  hasDrainage: boolean;
  stats: SimStats | null;
  raining: boolean;
  speed: number;
  crestStage: number;
  collapsed: boolean;
  loading: boolean;
  onCollapse: () => void;
  onPreset: (id: string) => void;
  onUpdate: (patch: Partial<Scenario>) => void;
  onPlay: () => void;
  onPause: () => void;
  onReset: () => void;
  onSpeed: (v: number) => void;
}

export function ScenarioPanel(p: ScenarioPanelProps) {
  const { scenario: s, stats } = p;
  const [advanced, setAdvanced] = useState(false);
  const preset = PRESETS.find((x) => x.id === p.presetId);
  const total = (s.rainHours + 1) * 3600;
  const simT = stats?.time ?? 0;
  const riverCat = s.riverStage >= RIVER_REF.evacuation ? 'bad' : s.riverStage >= RIVER_REF.alert ? 'warn' : '';
  const clock = `${fmtClock(simT)} de ${fmtClock(total)}`;
  const phase: { cls: string; text: string } =
    p.loading || !stats ? { cls: 'idle', text: 'Cargando el modelo…' }
    : stats.finished ? { cls: 'done', text: 'Terminó. Revisá los resultados y el análisis.' }
    : stats.running && p.raining ? { cls: 'rain', text: `Lloviendo · ${clock}` }
    : stats.running ? { cls: 'drain', text: `Ya no llueve, el agua escurre · ${clock}` }
    : simT > 0 ? { cls: 'pause', text: `En pausa · ${clock}` }
    : { cls: 'idle', text: 'Listo para simular' };
  const marks = [
    { v: RIVER_REF.observed.stage, t: 'Hoy', d: `Altura medida el ${RIVER_REF.observed.date} (${RIVER_REF.observed.inaCategory} según el INA)` },
    { v: RIVER_REF.alert, t: 'Alerta', d: 'Nivel de alerta del INA' },
    { v: RIVER_REF.evacuation, t: 'Evac.', d: 'Nivel de evacuación del INA' },
    { v: RIVER_REF.record1983, t: '1983', d: 'Récord histórico de la crecida de 1983' },
    { v: p.crestStage, t: 'Defensa', d: 'Coronamiento de la defensa (dato oficial 2015): por encima, el río la desborda' },
  ];

  return (
    <aside className={`panel left ${p.collapsed ? 'collapsed' : ''}`} aria-label="Escenario">
      <header className="panel-h">
        <div>
          <span className="eyebrow">Escenario</span>
          <h2>¿Qué querés simular?</h2>
        </div>
        <span className="badge badge-user" data-tip="Lo que ves en el mapa es un escenario que elegís vos: hipotético, no un pronóstico.">Hipotético</span>
        <button className="icon-btn sm collapse" onClick={p.onCollapse} aria-expanded={!p.collapsed}
          aria-label={p.collapsed ? 'Mostrar el panel del escenario' : 'Ocultar el panel del escenario'} data-tip={p.collapsed ? 'Mostrar el escenario' : 'Ocultar para ver más mapa'}>
          <Icon name={p.collapsed ? 'chevronR' : 'chevronL'} size={16} />
        </button>
      </header>

      <div className="panel-scroll">
        <div className="presets" data-tour="presets" role="radiogroup" aria-label="Escenarios predefinidos">
          {PRESETS.map((x) => (
            <button key={x.id} role="radio" aria-checked={p.presetId === x.id} className={`preset lvl-${x.id} ${p.presetId === x.id ? 'on' : ''}`}
              onClick={() => p.onPreset(x.id)} data-tip={x.why}>
              <span className="preset-k">{x.short}</span>
              <span className="preset-l">{x.label}</span>
            </button>
          ))}
        </div>
        <p className={`why ${preset ? '' : 'custom'}`}>{preset ? preset.why : 'Escenario personalizado: cambiaste algún valor a mano.'}</p>

        <Field icon="rain" title="Lluvia" tour="rain">
          <Range label="Intensidad" value={s.rainMmH} min={0} max={200} step={5} display={`${s.rainMmH} mm/h`}
            onChange={(v) => p.onUpdate({ rainMmH: v })} tip="Milímetros de agua por hora. 40 mm/h ya es una tormenta fuerte; más de 100 mm/h es excepcional." />
          <Range label="Duración" value={s.rainHours} min={0.25} max={6} step={0.25} display={fmtHours(s.rainHours)}
            onChange={(v) => p.onUpdate({ rainHours: v })} tip="Cuánto dura la lluvia. Después se simula 1 hora más para ver cómo escurre." />
          <p className="total">Total <b className="mono">{(s.rainMmH * s.rainHours).toFixed(0)} mm</b> <span>= litros por m²</span></p>
        </Field>

        <Field icon="river" title="Río Paraguay" tour="river">
          <Range label="Altura en Puerto Formosa" value={s.riverStage} min={1.5} max={13} step={0.05} display={`${s.riverStage.toFixed(2).replace('.', ',')} m`} tone={riverCat}
            onChange={(v) => p.onUpdate({ riverStage: v })} tip="Con el río alto el agua de lluvia no puede salir y el río entra a los bajos. Cambiarlo reinicia la simulación." />
          <div className="scale" aria-label="Alturas de referencia">
            {marks.map((m) => (
              <button key={m.t} style={{ left: `${((m.v - 1.5) / 11.5) * 100}%` }} onClick={() => p.onUpdate({ riverStage: m.v })}
                data-tip={`${m.d}: ${fmtStage(m.v)}. Clic para poner el río a esa altura.`} aria-label={`${m.t}: ${fmtStage(m.v)}`}>
                <i />{m.t}
              </button>
            ))}
          </div>
          <p className="hint" data-tip={`Escala del INA (frecuencia 1991–2020): ${INA_SCALE.join(' · ')}. El INA no publica los límites en metros, así que no clasificamos alturas hipotéticas. Lecturas reales: ${INA_CATEGORY_REF.map((r) => `${fmtStage(r.stage)} = ${r.cat} (${r.date})`).join('; ')}.`}>
            Hoy <b>{fmtStage(RIVER_REF.observed.stage)}</b> · {RIVER_REF.observed.inaCategory} (INA). Alerta {fmtStage(RIVER_REF.alert)}, evacuación {fmtStage(RIVER_REF.evacuation)}.
          </p>
        </Field>

        <button className={`disclosure ${advanced ? 'open' : ''}`} onClick={() => setAdvanced((v) => !v)} aria-expanded={advanced}>
          <Icon name="sliders" size={16} />Opciones avanzadas
          {!advanced && s.defenseFails && <span className="badge badge-bad">defensa rota</span>}
          <Icon name="chevronD" size={16} className="chev" />
        </button>
        {advanced && (
          <div className="advanced">
            <Range label="Desagüe + infiltración" value={s.drainMmH} min={0} max={40} step={1} display={`${s.drainMmH} mm/h`}
              onChange={(v) => p.onUpdate({ drainMmH: v })} tip="Cuánta agua por hora se va por los desagües y se infiltra. Más alto = la ciudad drena mejor." />
            <p className="hint">{p.hasDrainage
              ? `Es el desagüe donde hay bocas de tormenta relevadas; en el resto se usa el ${Math.round(ASSUMPTIONS.drainNoNetwork * 100)} %. Es un supuesto.`
              : 'No hay datos de la red pluvial: es un supuesto.'}</p>
            {s.riverStage >= ASSUMPTIONS.alertStage && (
              <p className="hint warn">Con el río en alerta o más, el desagüe por gravedad se corta y solo queda el bombeo ({Math.round(ASSUMPTIONS.drainFactorHighRiver * 100)} %).</p>
            )}
            <label className="field-inline" data-tip="La misma intensidad de lluvia, expresada por minuto.">
              <span>Lluvia por minuto</span>
              <span className="num-input">
                <input type="number" min={0} max={3.33} step={0.05} value={+(s.rainMmH / 60).toFixed(2)}
                  onChange={(e) => p.onUpdate({ rainMmH: Math.max(0, Math.min(200, Math.round(+e.target.value * 60))) })} aria-label="Lluvia en milímetros por minuto" />
                <em>mm/min</em>
              </span>
            </label>
            <label className="switch" data-tip="Simula una rotura de ~200 m en el terraplén frente al puerto (inicio del Lote 4): el resto del anillo sigue en pie y el río entra por la brecha.">
              <input type="checkbox" role="switch" checked={s.defenseFails} onChange={(e) => p.onUpdate({ defenseFails: e.target.checked })} />
              <span className="switch-ui" aria-hidden="true" />
              <span>Rotura de la defensa frente al puerto</span>
            </label>
          </div>
        )}
      </div>

      <footer className="sim-bar" data-tour="play">
        <div className="sim-controls">
          {stats?.running ? (
            <button className="btn primary lg grow" onClick={p.onPause} data-tip="Congela la simulación en este momento"><Icon name="pause" size={16} />Pausar</button>
          ) : (
            <button className="btn primary lg grow" onClick={p.onPlay} disabled={p.loading} data-tip="Empieza a llover sobre la ciudad con el escenario elegido">
              <Icon name="play" size={16} />{stats && stats.time > 0 && !stats.finished ? 'Seguir' : 'Hacer llover'}
            </button>
          )}
          <button className="icon-btn lg" onClick={p.onReset} aria-label="Reiniciar" data-tip="Vuelve a cero: saca el agua de lluvia y deja solo el río"><Icon name="reset" /></button>
        </div>
        <div className="seg seg-full" role="radiogroup" aria-label="Velocidad de la simulación" data-tip="Minutos simulados por cada segundo real">
          {SPEEDS.map((x) => (
            <button key={x.v} role="radio" aria-checked={p.speed === x.v} className={p.speed === x.v ? 'on' : ''} onClick={() => p.onSpeed(x.v)}>{x.l}</button>
          ))}
        </div>
        <div className={`status st-${phase.cls}`} role="status" aria-live="polite"><i />{phase.text}</div>
        <div className="timeline" data-tip="La marca indica cuándo para de llover; después se simula 1 hora más de escurrimiento.">
          <div className="bar"><i style={{ width: `${Math.min(100, (simT / total) * 100)}%` }} /><em style={{ left: `${(s.rainHours / (s.rainHours + 1)) * 100}%` }} /></div>
          <div className="timeline-l mono"><span>0</span><span>lluvia {fmtHours(s.rainHours)}</span><span>{fmtHours(s.rainHours + 1)}</span></div>
        </div>
      </footer>
    </aside>
  );
}

function Field({ icon, title, tour, children }: { icon: 'rain' | 'river'; title: string; tour: string; children: ReactNode }) {
  return (
    <section className="field" data-tour={tour}>
      <h3><Icon name={icon} size={17} />{title}</h3>
      {children}
    </section>
  );
}

function Range({ label, value, min, max, step, display, onChange, tip, tone }: {
  label: string; value: number; min: number; max: number; step: number; display: string; onChange: (v: number) => void; tip?: string; tone?: string;
}) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <label className="range">
      <span className="range-h"><span data-tip={tip}>{label}</span><b className={`mono ${tone ?? ''}`}>{display}</b></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)}
        style={{ ['--fill' as string]: `${fill}%` }} aria-label={label} aria-valuetext={display} />
    </label>
  );
}
