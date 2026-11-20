import { useEffect, useMemo, useRef, useState } from 'react';
import { loadAll, type AppData, type FacilityCat } from './data/load';
import { DEFAULT_EXAG, EXAG_MAX, EXAG_MIN, MapScene, type Layers, type WaterMode } from './scene/MapScene';
import type { WorkerIn, WorkerOut, SimStats } from './sim/worker';
import type { Scenario } from './sim/engine';
import { ASSUMPTIONS, PRESETS, RIVER_REF, LEVELS, STREET, INA_SCALE, INA_CATEGORY_REF, RAIN_FORECAST_7D } from './sim/scenarios';
import {
  evalBarrios, evalFacilities, evalStreets, fmtTime, prepareBarrios, prepareFacilities, prepareStreets,
  type BarrioInfo, type BarrioLive, type FacilityInfo, type FacilityLive, type StreetLive, type StreetSamples, type Tier,
} from './analysis';
import { WelcomeGuide, guideSeen, markGuideSeen } from './ui/Guide';
import { TipLayer } from './ui/TipLayer';
import { fmtStage, stageContext, thresholdState, RISK_MARGIN, type ThresholdState } from './ui/threshold';

const SIM_FACTOR = 2; // celdas de ~60 m en vivo
/** Coronamiento de la defensa expresado en la escala de Puerto Formosa (m). */
const DEFENSE_CREST_STAGE = +(ASSUMPTIONS.defenseCrest - ASSUMPTIONS.gaugeZero).toFixed(2);

const CAT_LABEL: Record<FacilityCat, string> = {
  hospital: 'Hospital', salud: 'Salud', escuela: 'Escuela', seguridad: 'Bomberos / Policía',
  servicios: 'Agua / Energía', publico: 'Municipio / Asistencia social', transporte: 'Transporte',
};
const CAT_ICON: Record<FacilityCat, string> = {
  hospital: '✚', salud: '+', escuela: '▲', seguridad: '◆', servicios: '⚡', publico: '⌂', transporte: '✈',
};
const TIER_LABEL = ['—', '1º', '2º', '3º'];
const THR_ROW: Record<ThresholdState, string> = { alcanzado: 'st-afectado', riesgo: 'st-atencion', lejos: '' };

export default function App() {
  const [data, setData] = useState<AppData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scenario, setScenario] = useState<Scenario>(() => ({ ...LEVELS[1] }));
  const [presetId, setPresetId] = useState<string | null>('n2');
  const [stats, setStats] = useState<SimStats | null>(null);
  const [speed, setSpeed] = useState(900);
  const [layers, setLayers] = useState<Layers>({ water: true, zones: false, drainage: false, buildings: true, lines: true, labels: true, facilities: true });
  const [waterMode, setWaterMode] = useState<WaterMode>('depth');
  const [exag, setExag] = useState(DEFAULT_EXAG);
  const [tab, setTab] = useState<'barrios' | 'infra' | 'calles'>('calles');
  const [streets, setStreets] = useState<StreetLive | null>(null);
  const streetRef = useRef<StreetSamples | null>(null);
  const [facLive, setFacLive] = useState<FacilityLive[]>([]);
  const [barLive, setBarLive] = useState<BarrioLive[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [catFilter, setCatFilter] = useState<FacilityCat | 'todas'>('todas');
  const [collapsed, setCollapsed] = useState({ left: false, right: false });
  const [bld, setBld] = useState({ wet: 0, near: 0 });
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  const [freeCam, setFreeCam] = useState({ active: false, speed: 1 });
  const [showGuide, setShowGuide] = useState(() => !guideSeen());
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showView, setShowView] = useState(false);
  /** Orden de las listas de barrios e infraestructura: por la simulación o por la altura del río a la que se afectan. */
  const [order, setOrder] = useState<'sim' | 'rio'>('sim');
  const closeGuide = () => { markGuideSeen(); setShowGuide(false); };
  // Los paneles laterales terminan justo arriba del dock, que cambia de alto según el ancho y las capas visibles.
  const appRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const dock = dockRef.current, app = appRef.current;
    if (!dock || !app) return;
    const ro = new ResizeObserver(() => app.style.setProperty('--dock-h', `${dock.offsetHeight}px`));
    ro.observe(dock);
    return () => ro.disconnect();
  }, []);

  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<MapScene | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const simMaskRef = useRef<Uint8Array | null>(null);
  const facRef = useRef<FacilityInfo[]>([]);
  const barRef = useRef<BarrioInfo[]>([]);
  const [facilities, setFacilities] = useState<FacilityInfo[]>([]);
  const [barrios, setBarrios] = useState<BarrioInfo[]>([]);
  const lastEval = useRef(0);

  const send = (m: WorkerIn) => workerRef.current?.postMessage(m);

  useEffect(() => {
    loadAll().then(setData).catch((e) => setError(String(e)));
  }, []);

  // Escena + worker.
  useEffect(() => {
    if (!data || !mountRef.current) return;
    const scene = new MapScene(mountRef.current, data);
    sceneRef.current = scene;
    scene.onFreeCameraChange = (s) => setFreeCam(s);
    const worker = new Worker(new URL('./sim/worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    worker.onmessage = (e: MessageEvent<WorkerOut>) => {
      const m = e.data;
      if (m.type === 'ready') {
        simMaskRef.current = m.mask;
        scene.initWater(m.width, m.height, m.zEff);
        const info = { width: m.width, height: m.height, factor: SIM_FACTOR, mask: m.mask };
        facRef.current = prepareFacilities(data, info);
        barRef.current = prepareBarrios(data, info);
        setFacilities(facRef.current);
        setBarrios(barRef.current);
        streetRef.current = scene.urbanCell ? prepareStreets(data, info, scene.urbanCell) : null;
      } else if (m.type === 'frame') {
        if (m.zEff) scene.setTerrainEff(m.zEff);
        if (simMaskRef.current) scene.setWaterFrame(m.d, m.tWet, m.byRiver, simMaskRef.current, m.stats.time);
        setStats(m.stats);
        const now = performance.now();
        if (now - lastEval.current > 250) {
          lastEval.current = now;
          const fl = evalFacilities(facRef.current, m.d, m.tWet, m.byRiver, ASSUMPTIONS.wetThreshold);
          const bl = evalBarrios(barRef.current, m.tWet, m.byRiver, m.d, ASSUMPTIONS.wetThreshold);
          scene.setFacilityStatus(fl.map((f) => f.status));
          scene.setBarrioLabelState(bl.map((b) => b.status));
          setFacLive(fl);
          setBarLive(bl);
          if (streetRef.current) setStreets(evalStreets(streetRef.current, m.d));
          const cells = scene.buildingSimCell;
          if (cells) {
            let wet = 0, near = 0;
            for (let k = 0; k < cells.length; k++) { const dv = m.d[cells[k]]; if (dv >= ASSUMPTIONS.wetThreshold) wet++; else if (dv >= 0.1) near++; }
            setBld({ wet, near });
          }
        }
      }
    };
    worker.postMessage({
      type: 'init',
      grid: { width: data.meta.width, height: data.meta.height, cellX: data.meta.cellX, cellY: data.meta.cellY, z: data.z },
      mask: data.mask, factor: SIM_FACTOR, scenario, assumptions: ASSUMPTIONS, drainage: data.drainage,
    } satisfies WorkerIn);

    const onClick = (ev: MouseEvent) => {
      const i = scene.pickFacility(ev.clientX, ev.clientY);
      if (i >= 0) { setSelected(i); setTab('infra'); scene.focusFacility(i); }
    };
    let lastMove = 0;
    const onMove = (ev: MouseEvent) => {
      const now = performance.now();
      if (now - lastMove < 60) return;
      lastMove = now;
      const i = scene.pickFacility(ev.clientX, ev.clientY);
      setHover(i >= 0 ? { i, x: ev.clientX, y: ev.clientY } : null);
      scene.renderer.domElement.style.cursor = i >= 0 ? 'pointer' : '';
    };
    scene.renderer.domElement.addEventListener('click', onClick);
    scene.renderer.domElement.addEventListener('mousemove', onMove);
    return () => {
      worker.terminate();
      scene.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  useEffect(() => { send({ type: 'scenario', scenario }); send({ type: 'stopAt', seconds: (scenario.rainHours + 1) * 3600 }); }, [scenario]);
  useEffect(() => { send({ type: 'speed', value: speed }); }, [speed]);
  useEffect(() => { sceneRef.current?.setLayers(layers); }, [layers, facilities]);
  useEffect(() => { sceneRef.current?.setWaterMode(waterMode); }, [waterMode, stats === null]);
  // Exageración vertical: se aplica una vez por cuadro aunque el slider dispare muchos eventos.
  useEffect(() => {
    const id = requestAnimationFrame(() => sceneRef.current?.setExaggeration(exag));
    return () => cancelAnimationFrame(id);
  }, [exag, data]);
  const raining = !!stats && stats.time < scenario.rainHours * 3600 && stats.running;
  useEffect(() => { sceneRef.current?.setRain(scenario.rainMmH, raining); }, [raining, scenario.rainMmH]);

  const update = (patch: Partial<Scenario>) => { setPresetId(null); setScenario((s) => ({ ...s, ...patch })); };
  const applyPreset = (id: string) => {
    const p = PRESETS.find((x) => x.id === id)!;
    setPresetId(id);
    setScenario({ rainMmH: p.rainMmH, rainHours: p.rainHours, riverStage: p.riverStage, drainMmH: p.drainMmH, defenseFails: p.defenseFails });
    send({ type: 'reset' });
  };

  const totalSeconds = (scenario.rainHours + 1) * 3600;
  const preset = PRESETS.find((p) => p.id === presetId);

  const hasThr = !!data?.thresholds;
  const byRiverOrder = hasThr && order === 'rio';
  /** Umbral de la variante del escenario: con brecha si la defensa falla. */
  const stageOf = (x: { stageSana: number | null; stageBrecha: number | null }) => (scenario.defenseFails ? x.stageBrecha : x.stageSana);
  const barrioRows = useMemo(() => barrios.map((b, i) => ({ b, l: barLive[i], i }))
    .sort(byRiverOrder
      ? (a, z) => stageRank(stageOf(a.b)) - stageRank(stageOf(z.b)) || a.b.name.localeCompare(z.b.name)
      : (a, z) => rank(a.l?.firstAffected, a.b.tier) - rank(z.l?.firstAffected, z.b.tier)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [barrios, barLive, byRiverOrder, scenario.defenseFails]);
  const facRows = useMemo(() => facilities.map((f, i) => ({ f, l: facLive[i], i }))
    .filter((r) => catFilter === 'todas' || r.f.cat === catFilter)
    .sort(byRiverOrder
      ? (a, z) => stageRank(stageOf(a.f)) - stageRank(stageOf(z.f)) || a.f.name.localeCompare(z.f.name)
      : (a, z) => rank(a.l?.firstWet, a.f.tier) - rank(z.l?.firstWet, z.f.tier)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [facilities, facLive, catFilter, byRiverOrder, scenario.defenseFails]);
  const thrMeta = data?.thresholds?.meta;
  const crestStage = thrMeta ? +(thrMeta.defenseCrest - thrMeta.gaugeZero).toFixed(2) : DEFENSE_CREST_STAGE;
  /** Clase de fila en el orden por altura del río: rojo si ya se alcanzó, ámbar si está a menos de 60 cm. */
  const thrRowClass = (st: number | null) => THR_ROW[thresholdState(st, scenario.riverStage)];
  const affectedCounts = useMemo(() => {
    const c = { afectado: 0, atencion: 0 };
    facLive.forEach((f) => { if (f.status !== 'seco') c[f.status]++; });
    return c;
  }, [facLive]);
  const tierCounts = useMemo(() => {
    const c = [0, 0, 0, 0];
    facilities.forEach((f) => c[f.tier]++);
    return c;
  }, [facilities]);

  if (error) return <div className="fatal">No se pudieron cargar los datos: {error}</div>;

  const rainMmMin = scenario.rainMmH / 60;
  const riverCat = scenario.riverStage >= RIVER_REF.evacuation ? 'evac' : scenario.riverStage >= RIVER_REF.alert ? 'alerta' : 'normal';
  const sel = selected != null ? facilities[selected] : null;
  const selLive = selected != null ? facLive[selected] : null;

  // Línea de estado en lenguaje simple: qué está pasando y qué hacer ahora.
  const simT = stats?.time ?? 0;
  const clock = `${fmtClock(simT)} de ${fmtClock(totalSeconds)}`;
  const phase: { cls: string; text: string } =
    !data || !stats ? { cls: 'idle', text: 'Cargando el modelo…' }
    : stats.finished ? { cls: 'done', text: 'Terminó: mirá la lista de la derecha para ver qué se afectó primero.' }
    : stats.running && raining ? { cls: 'rain', text: `Lloviendo… ${clock}` }
    : stats.running ? { cls: 'drain', text: `Ya no llueve: el agua sigue escurriendo… ${clock}` }
    : simT > 0 ?{ cls: 'pause', text: `En pausa · ${clock}. Tocá «Seguir» para continuar.` }
    : { cls: 'idle', text: 'Listo para simular: tocá «Hacer llover».' };

  return (
    <div className="app" ref={appRef}>
      <div ref={mountRef} className="viewport" />
      {!data && <div className="loading"><div className="spinner" />Cargando terreno de Formosa…</div>}

      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">◈</span>
          <div>
            <h1>Operación Agua</h1>
            <p>Simulador de afectaciones por lluvia y crecida · Formosa Capital</p>
          </div>
        </div>
        <div className="sources">
          <button className="tag tag-help" onClick={() => setShowGuide(true)} data-tip="Guía rápida: qué es este simulador y cómo usarlo en 4 pasos">
            ? ¿Cómo se usa?
          </button>
          <span className="tag tag-obs" data-tip={`Altura real del río Paraguay medida en Puerto Formosa (${RIVER_REF.observed.trend}). Categoría según la escala del INA. Fuente: ${RIVER_REF.observed.source}.`}>
            OBSERVADO · río {fmtStage(RIVER_REF.observed.stage)} · {RIVER_REF.observed.inaCategory} (INA) · {RIVER_REF.observed.date}
          </span>
          <a className="tag tag-ina" href="https://alerta.ina.gob.ar/a5/secciones" target="_blank" rel="noreferrer"
            data-tip="Abre el sitio del INA (pronóstico oficial del río) en otra pestaña. No se carga automáticamente aquí.">PREVISIÓN INA · consultar ↗</a>
          <span className="tag tag-user" data-tip="Lo que ves en el mapa es un escenario que elegís vos: hipotético, no un pronóstico.">ESCENARIO DEL USUARIO · hipotético</span>
        </div>
      </header>

      <aside className={`panel left ${collapsed.left ? 'collapsed' : ''}`}>
        <button className="collapse" onClick={() => setCollapsed((c) => ({ ...c, left: !c.left }))}
          data-tip={collapsed.left ? 'Mostrar el panel del escenario' : 'Ocultar este panel para ver más mapa'} aria-label="Mostrar u ocultar el panel del escenario">{collapsed.left ? '›' : '‹'}</button>
        <h2>Escenario</h2>

        <div className="step">
          <h3 className="step-h"><span className="step-n">1</span>Elegí un escenario</h3>
          <p className="step-help">Cada botón carga una combinación típica de lluvia y altura del río.</p>
          <div className="presets">
            {PRESETS.map((p) => (
              <button key={p.id} className={`preset ${presetId === p.id ? 'on' : ''} lvl-${p.id}`} onClick={() => applyPreset(p.id)}
                data-tip={`${p.label}: ${p.why}`} aria-pressed={presetId === p.id}>
                <b>{p.short}</b><span>{p.label}</span>
              </button>
            ))}
          </div>
          {preset ? <p className="why">{preset.why}</p> : <p className="why custom">Escenario personalizado (cambiaste algún valor a mano).</p>}
        </div>

        <div className="step">
          <h3 className="step-h"><span className="step-n">2</span>Ajustá <em>(opcional)</em></h3>
          <p className="step-help">Mové los controles para probar tu propio escenario.</p>
          <section>
            <label className="row" data-tip="Intensidad: cuántos milímetros de agua caen por hora. 40 mm/h ya es una tormenta fuerte; más de 100 mm/h es excepcional.">
              <span>Lluvia (intensidad)</span><b className="mono">{scenario.rainMmH} mm/h</b>
            </label>
            <input type="range" min={0} max={200} step={5} value={scenario.rainMmH} onChange={(e) => update({ rainMmH: +e.target.value })}
              aria-label="Intensidad de la lluvia en milímetros por hora" data-tip="Arrastrá para cambiar cuánta lluvia cae por hora" />
            <div className="permin">
              <input
                type="number" min={0} max={3.33} step={0.05} value={+rainMmMin.toFixed(2)}
                onChange={(e) => update({ rainMmH: Math.max(0, Math.min(200, Math.round(+e.target.value * 60))) })}
                aria-label="Lluvia en milímetros por minuto" data-tip="La misma intensidad, expresada por minuto. Podés escribir el valor directamente."
              />
              <span>mm por minuto = litros por m² por minuto</span>
            </div>
            <label className="row" data-tip="Cuánto tiempo dura la lluvia. Después la simulación sigue 1 hora más para ver cómo escurre el agua.">
              <span>Duración de la lluvia</span><b className="mono">{fmtHours(scenario.rainHours)}</b>
            </label>
            <input type="range" min={0.25} max={6} step={0.25} value={scenario.rainHours} onChange={(e) => update({ rainHours: +e.target.value })}
              aria-label="Duración de la lluvia" data-tip="Arrastrá para cambiar cuánto dura la lluvia" />
            <div className="hint mono">Total: {(scenario.rainMmH * scenario.rainHours).toFixed(0)} mm ({(scenario.rainMmH * scenario.rainHours).toFixed(0)} L/m²)</div>
          </section>

          <section>
            <label className="row" data-tip="Altura del río Paraguay en la escala de Puerto Formosa. Con el río alto, el agua de lluvia no puede salir y el río entra a los bajos.">
              <span>Altura del río Paraguay</span><b className={`mono river-${riverCat}`}>{scenario.riverStage.toFixed(2)} m</b>
            </label>
            {/* Hasta 13 m: por encima del coronamiento de la defensa (11,70 m) para poder mostrar el desborde. */}
            <input type="range" min={1.5} max={13} step={0.05} value={scenario.riverStage} onChange={(e) => update({ riverStage: +e.target.value })}
              aria-label="Altura del río Paraguay en metros" data-tip="Arrastrá para subir o bajar el río. Cambiarlo reinicia la simulación." />
            <div className="scale">
              {[
                { v: RIVER_REF.observed.stage, t: 'hoy', d: `Altura medida el ${RIVER_REF.observed.date} (${RIVER_REF.observed.inaCategory} según el INA)` },
                { v: RIVER_REF.alert, t: 'alerta', d: 'Nivel de alerta del INA' },
                { v: RIVER_REF.evacuation, t: 'evac.', d: 'Nivel de evacuación del INA' },
                { v: RIVER_REF.record1983, t: '1983', d: 'Récord histórico de la crecida de 1983' },
                { v: DEFENSE_CREST_STAGE, t: 'defensa', d: 'Coronamiento de la defensa (dato oficial 2015): por encima, el río la desborda' },
              ].map((m) => (
                <button key={m.t} style={{ left: `${((m.v - 1.5) / 11.5) * 100}%` }} onClick={() => update({ riverStage: m.v })} data-tip={`${m.d}: ${m.v} m. Clic para poner el río a esa altura.`}>
                  <i />{m.t}
                </button>
              ))}
            </div>
            <div className="hint">Tocá una marca (hoy, alerta, evacuación, 1983, defensa) para usar esa altura. Cambiar el río reinicia la simulación.</div>
            <div className="hint" data-tip={`Escala del INA (frecuencia 1991–2020): ${INA_SCALE.join(' · ')}. El INA no publica los límites en metros, así que no clasificamos alturas hipotéticas. Lecturas reales clasificadas por el INA: ${INA_CATEGORY_REF.map((r) => `${fmtStage(r.stage)} = ${r.cat} (${r.date})`).join('; ')}.`}>
              Escala INA: hoy <b>{RIVER_REF.observed.inaCategory}</b>. Referencias reales: {INA_CATEGORY_REF.slice(0, 2).map((r) => `${fmtStage(r.stage)} = ${r.cat}`).join(' · ')}. Alerta {fmtStage(RIVER_REF.alert)} · evacuación {fmtStage(RIVER_REF.evacuation)}.
            </div>
          </section>

          <button className={`advanced-toggle ${showAdvanced ? 'open' : ''}`} onClick={() => setShowAdvanced((v) => !v)} aria-expanded={showAdvanced}
            data-tip="Desagüe de la ciudad y falla de la defensa costera. Ya vienen con valores razonables.">
            <span>{showAdvanced ? '▾' : '▸'}</span> Opciones avanzadas
            {!showAdvanced && (scenario.defenseFails ? <em className="adv-flag">defensa falla</em> : null)}
          </button>
          {showAdvanced && (
            <section className="advanced">
              <label className="row" data-tip="Cuánta agua por hora se va por los desagües pluviales y se infiltra en el suelo. Más alto = la ciudad drena mejor.">
                <span>Desagüe + infiltración</span><b className="mono">{scenario.drainMmH} mm/h</b>
              </label>
              <input type="range" min={0} max={40} step={1} value={scenario.drainMmH} onChange={(e) => update({ drainMmH: +e.target.value })}
                aria-label="Desagüe más infiltración en milímetros por hora" data-tip="Arrastrá para cambiar cuánto drena la ciudad" />
              <div className="hint">{data?.drainage
                ? `Es el desagüe donde hay bocas de tormenta o sumideros relevados (capa «Bocas de tormenta»). En el resto de la ciudad se usa el ${Math.round(ASSUMPTIONS.drainNoNetwork * 100)} % de este valor. Es un supuesto.`
                : 'No hay datos de la red pluvial: es un supuesto.'}</div>
              {scenario.riverStage >= ASSUMPTIONS.alertStage && (
                <div className="hint warn">Río en alerta o más: se supone que el desagüe por gravedad se corta y solo queda el bombeo ({Math.round(ASSUMPTIONS.drainFactorHighRiver * 100)} %).</div>
              )}
              <label className="check" data-tip="Simula una rotura de unos 200 m en el terraplén de defensa, sobre la costa del puerto (inicio del Lote 4): el resto del anillo sigue funcionando y el río entra por la brecha.">
                <input type="checkbox" checked={scenario.defenseFails} onChange={(e) => update({ defenseFails: e.target.checked })} />
                Rotura de la defensa (brecha frente al puerto)
              </label>
            </section>
          )}
        </div>

        <div className="step">
          <h3 className="step-h"><span className="step-n">3</span>Simulá</h3>
          <div className="controls">
            {stats?.running ? (
              <button className="btn primary" onClick={() => send({ type: 'pause' })} data-tip="Congela la simulación en este momento">❚❚ Pausar</button>
            ) : (
              <button className="btn primary big" onClick={() => send({ type: 'play' })}
                data-tip="Empieza a llover sobre la ciudad con el escenario elegido. El tiempo corre acelerado.">
                ▶ {stats && stats.time > 0 && !stats.finished ? 'Seguir' : 'Hacer llover'}
              </button>
            )}
            <button className="btn" onClick={() => send({ type: 'reset' })} data-tip="Vuelve a cero: saca el agua de lluvia y deja solo el río">↺ Reiniciar</button>
            <label className="speed" data-tip="Velocidad: cuántos minutos simulados pasan por cada segundo real">
              <span>Velocidad</span>
              <select value={speed} onChange={(e) => setSpeed(+e.target.value)} aria-label="Velocidad de la simulación">
                <option value={300}>5 min/s</option>
                <option value={900}>15 min/s</option>
                <option value={1800}>30 min/s</option>
              </select>
            </label>
          </div>
          <div className={`status-line st-${phase.cls}`} role="status" aria-live="polite"><i />{phase.text}</div>
          <div className="timeline" data-tip="Barra de tiempo: la marca amarilla indica cuándo para de llover; después se simula 1 hora más de escurrimiento.">
            <div className="bar"><i style={{ width: `${Math.min(100, ((stats?.time ?? 0) / totalSeconds) * 100)}%` }} /><em style={{ left: `${(scenario.rainHours / (scenario.rainHours + 1)) * 100}%` }} /></div>
            <div className="row mono small"><span>{fmtTime(stats?.time ?? 0).replace('t=0 (río)', '0 min')}</span><span>{raining ? 'lloviendo' : stats?.finished ? 'fin' : stats && stats.time > scenario.rainHours * 3600 ? 'escurriendo' : ''}</span><span>{fmtHours(scenario.rainHours + 1)}</span></div>
          </div>
        </div>
      </aside>

      <aside className={`panel right ${collapsed.right ? 'collapsed' : ''}`}>
        <button className="collapse" onClick={() => setCollapsed((c) => ({ ...c, right: !c.right }))}
          data-tip={collapsed.right ? 'Mostrar los resultados' : 'Ocultar este panel para ver más mapa'} aria-label="Mostrar u ocultar el panel de resultados">{collapsed.right ? '‹' : '›'}</button>
        <h2 className="right-h">Resultados</h2>
        <p className="step-help">Se actualizan en vivo mientras llueve. Hacé clic en un elemento de la lista para verlo en el mapa.</p>
        <div className="stats">
          <Stat label="Tiempo simulado" value={fmtTime(stats?.time ?? 0).replace('t=0 (río)', '0 min')} tip="Tiempo transcurrido dentro de la simulación (no tiempo real)" />
          <Stat label="Lluvia caída" value={`${(stats?.rainMm ?? 0).toFixed(0)} mm`} tip="Milímetros de lluvia acumulados hasta ahora (1 mm = 1 litro por m²)" />
          <Stat label="Calles con agua sobre el cordón" value={`${(streets?.curbKm ?? 0).toFixed(1)} km`} sub={`${(streets?.impassableKm ?? 0).toFixed(1)} km intransitables`} accent
            tip={`Kilómetros de calle con más de ${STREET.curb * 100} cm de agua (pasa el cordón). Intransitable: más de ${STREET.impassable * 100} cm.`} />
          <Stat label="Edificios con agua ≥ 15 cm" value={bld.wet.toLocaleString('es-AR')} sub={`${bld.near.toLocaleString('es-AR')} con agua cerca · de ${(data?.buildings?.count ?? 0).toLocaleString('es-AR')}`} accent
            tip="Edificios de OpenStreetMap con al menos 15 cm de agua alrededor" />
          <Stat label="Área con agua ≥ 15 cm" value={`${(stats?.areaKm2 ?? 0).toFixed(1)} km²`} sub="estimado" tip="Superficie total cubierta por 15 cm de agua o más (incluye lo que entra desde el río)" />
          <Stat label="Instalaciones" value={`${affectedCounts.afectado}`} sub={`afectadas · ${affectedCounts.atencion} en atención`} accent
            tip="Hospitales, escuelas, bomberos, etc. Afectada: tiene agua (≥ 15 cm). En atención: hay agua cerca." />
        </div>

        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'calles'} className={tab === 'calles' ? 'on' : ''} onClick={() => setTab('calles')} data-tip="Qué calles se llenan de agua y cuántos km">Calles</button>
          <button role="tab" aria-selected={tab === 'barrios'} className={tab === 'barrios' ? 'on' : ''} onClick={() => setTab('barrios')} data-tip="Barrios ordenados por cuándo les llega el agua">Barrios ({barrios.length})</button>
          <button role="tab" aria-selected={tab === 'infra'} className={tab === 'infra' ? 'on' : ''} onClick={() => setTab('infra')} data-tip="Hospitales, escuelas, bomberos, etc. ordenados por cuándo les llega el agua">Infraestructura ({facilities.length})</button>
        </div>
        {tab === 'calles' ? (
          <div className="street-sum">
            <div className="c4"><b className="mono">{(streets?.dirtCurbKm ?? 0).toFixed(1)}</b><span>km de calles de tierra sobre el cordón</span></div>
            <p className="list-help">Calles con más kilómetros de agua sobre el cordón. Profundidad estimada: en zona urbana se supone que el agua de la manzana se junta en la calzada.</p>
          </div>
        ) : (<>
        {hasThr && (
          <div className="order-row">
            <span>Orden:</span>
            <div className="seg">
              <button className={order === 'sim' ? 'on' : ''} aria-pressed={order === 'sim'} onClick={() => setOrder('sim')}
                data-tip="Ordena por cuándo les llega el agua en la simulación en curso">simulación</button>
              <button className={order === 'rio' ? 'on' : ''} aria-pressed={order === 'rio'} onClick={() => setOrder('rio')}
                data-tip="Ordena por la altura del río en Puerto Formosa a la que empieza a llegarles agua del río (estimación estática, sin lluvia)">altura del río</button>
            </div>
          </div>
        )}
        {byRiverOrder ? (
          <p className="list-help">
            A la derecha, la <b>altura del río en Puerto Formosa</b> a la que empieza a llegar agua del río
            {scenario.defenseFails ? ' con la defensa rota (como en el escenario)' : ' con la defensa sana'}.{' '}
            <span className="thr-key bad">Rojo</span>: ya alcanzada con el río a {fmtStage(scenario.riverStage)} ·{' '}
            <span className="thr-key warn">ámbar</span>: faltan menos de {RISK_MARGIN * 100} cm.{' '}
            Es una <b>estimación estática</b> a partir del terreno y la defensa, no un pronóstico: no incluye lluvia ni tiempos.
          </p>
        ) : (
        <p className="list-help">
          Arriba, lo primero que toca el agua en esta simulación (a la derecha, cuándo). La etiqueta de color indica desde qué escenario se afecta:{' '}
          <span className="tier t1 inline">1º</span> ya con lluvia fuerte · <span className="tier t2 inline">2º</span> con temporal severo ·{' '}
          <span className="tier t3 inline">3º</span> solo en el extremo · <span className="tier t0 inline">—</span> en ninguno.
        </p>
        )}
        </>)}

        {tab === 'infra' && (
          <div className="filters">
            {(['todas', 'hospital', 'salud', 'escuela', 'seguridad', 'servicios', 'publico'] as const).map((c) => (
              <button key={c} className={catFilter === c ? 'on' : ''} onClick={() => setCatFilter(c)} aria-pressed={catFilter === c}
                data-tip={c === 'todas' ? 'Mostrar todas las instalaciones' : `Mostrar solo: ${CAT_LABEL[c]}`}>{c === 'todas' ? 'Todas' : CAT_LABEL[c]}</button>
            ))}
          </div>
        )}

        <ol className="list">
          {tab === 'barrios' && barrioRows.map(({ b, l, i }) => (
            <li key={i} className={byRiverOrder ? thrRowClass(stageOf(b)) : `st-${l?.status ?? 'seco'}`} onClick={() => sceneRef.current?.focusLonLat(b.lon, b.lat)}>
              <TierBadge t={b.tier} />
              <div className="li-main"><b>{b.name}</b><span>{l ? `${Math.round(l.share * 100)} % con agua` : ''}{byRiverOrder && b.protectedByDefense && !scenario.defenseFails ? ' · tras la defensa' : ''}</span></div>
              {byRiverOrder
                ? <span className="mono time" data-tip={stageTip(stageOf(b), 'el 5 % del barrio')}>{fmtStage(stageOf(b))}</span>
                : <span className="mono time">{fmtTime(l?.firstAffected ?? -1)}</span>}
            </li>
          ))}
          {tab === 'infra' && facRows.map(({ f, l, i }) => (
            <li key={f.id} className={`${byRiverOrder ? thrRowClass(stageOf(f)) : `st-${l?.status ?? 'seco'}`} ${selected === i ? 'sel' : ''}`} onClick={() => { setSelected(i); sceneRef.current?.focusFacility(i); }}>
              <TierBadge t={f.tier} />
              <div className="li-main"><b><span className="icon">{CAT_ICON[f.cat]}</span>{f.name}</b><span>{CAT_LABEL[f.cat]}{l && l.status !== 'seco' ? ` · ${(l.depth * 100).toFixed(0)} cm` : ''}{byRiverOrder && f.protectedByDefense && !scenario.defenseFails ? ' · tras la defensa' : ''}</span></div>
              {byRiverOrder
                ? <span className="mono time" data-tip={stageTip(stageOf(f), 'esta instalación')}>{fmtStage(stageOf(f))}</span>
                : <span className="mono time">{fmtTime(l?.firstWet ?? -1)}</span>}
            </li>
          ))}
          {tab === 'calles' && streets?.top.map((t) => (
            <li key={t.name} className={t.maxDepth >= STREET.impassable ? 'st-afectado' : 'st-atencion'}>
              <div className="li-main"><b>{t.name}</b><span>máx. {(t.maxDepth * 100).toFixed(0)} cm en la calzada</span></div>
              <span className="mono time">{t.km.toFixed(2)} km</span>
            </li>
          ))}
          {tab === 'calles' && !streets?.top.length && <li className="empty">Sin calles con agua sobre el cordón. Probá "Hacer llover".</li>}
          {tab === 'barrios' && !barrios.length && <li className="empty">Sin barrios de OpenStreetMap cargados.</li>}
          {tab === 'infra' && !facilities.length && <li className="empty">Sin infraestructura de OpenStreetMap cargada.</li>}
        </ol>
        {tab === 'infra' && facilities.length > 0 && (
          <div className="tier-sum mono">Nivel 1º: {tierCounts[1]} · 2º: {tierCounts[2]} · 3º: {tierCounts[3]} · fuera: {tierCounts[0]}</div>
        )}
      </aside>

      {hover && facilities[hover.i] && (
        <div className="tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          <small>{CAT_LABEL[facilities[hover.i].cat]}</small>
          <b>{facilities[hover.i].name}</b>
          <span>{statusText(facLive[hover.i])}{facilities[hover.i].tier ? ` · nivel ${TIER_LABEL[facilities[hover.i].tier]}` : ''}
            {hasThr ? (stageOf(facilities[hover.i]) == null ? ' · el río no llega' : ` · río a ${fmtStage(stageOf(facilities[hover.i]))}`) : ''}</span>
        </div>
      )}

      {sel && (
        <div className="card">
          <button className="x" onClick={() => { setSelected(null); sceneRef.current?.focusFacility(null); }} aria-label="Cerrar ficha" data-tip="Cerrar la ficha">×</button>
          <small>{CAT_LABEL[sel.cat]}</small>
          <h3>{sel.name}</h3>
          <dl>
            <dt>Estado ahora</dt><dd className={`st-${selLive?.status}`}>{statusText(selLive)}</dd>
            <dt>Agua máx. cerca (±60 m)</dt><dd className="mono">{selLive ? `${(selLive.depth * 100).toFixed(0)} cm` : '—'}</dd>
            <dt>Primer contacto con agua</dt><dd className="mono">{fmtTime(selLive?.firstWet ?? -1)}{selLive?.byRiver ? ' · por el río' : ''}</dd>
            <dt>Nivel de referencia</dt><dd>{sel.tier ? `${TIER_LABEL[sel.tier]} (${LEVELS[sel.tier - 1].label})${sel.tierByRiver ? ' · por el río' : ''}` : 'No se afecta en los 3 escenarios'}</dd>
          </dl>
          {hasThr && <ThresholdBlock f={sel} crest={crestStage} river={scenario.riverStage} breach={scenario.defenseFails} />}
          <p className="hint">Zona a evaluar, no veredicto: el MDE tiene ~2 m de error vertical. Fuente: OpenStreetMap.</p>
        </div>
      )}

      <footer className="dock" ref={dockRef}>
        <div className="layers">
          <div className="dock-group" role="group" aria-label="Capas visibles en el mapa">
            <span className="dock-label">Mostrar en el mapa</span>
            <Toggle on={layers.water} onClick={() => setLayers({ ...layers, water: !layers.water })}
              tip="El agua de la simulación, moviéndose en tiempo real">Agua</Toggle>
            <Toggle on={layers.zones} onClick={() => setLayers({ ...layers, zones: !layers.zones })}
              tip="Mapa fijo, precalculado: qué zonas se inundan con lluvia fuerte (1º), con temporal severo (2º) o solo en un evento extremo (3º)">Zonas 1º/2º/3º</Toggle>
            {data?.drainage && (
              <Toggle on={layers.drainage} onClick={() => setLayers({ ...layers, drainage: !layers.drainage })}
                tip={`Dónde hay bocas de tormenta o sumideros según el relevamiento del equipo (sin verificar). Ahí el desagüe es el 100 % del elegido; en el resto, el ${Math.round(ASSUMPTIONS.drainNoNetwork * 100)} %.`}>Bocas de tormenta</Toggle>
            )}
            <Toggle on={layers.facilities} onClick={() => setLayers({ ...layers, facilities: !layers.facilities })}
              tip="Hospitales, escuelas, bomberos y otros servicios. Clic en uno para ver su ficha.">Instalaciones</Toggle>
            <Toggle on={layers.buildings} onClick={() => setLayers({ ...layers, buildings: !layers.buildings })}
              tip="Edificios en 3D">Edificios</Toggle>
          </div>
          <div className="dock-group help" role="group" aria-label="Vista y ayuda">
            <button className={`toggle ${showView ? 'on' : ''}`} aria-expanded={showView} onClick={() => setShowView((v) => !v)}
              data-tip="Color del agua, relieve, calles y cámara libre">⚙ Vista</button>
            <button className="btn ghost" onClick={() => setShowInfo(true)} data-tip="Qué datos usamos, qué suponemos y qué NO podemos asegurar">ⓘ Supuestos y límites</button>
          </div>
        </div>
        {showView && (
          <div className="layers view-panel">
            <div className="dock-group" role="group" aria-label="Cómo se colorea el agua">
              <span className="dock-label">Color del agua</span>
              <div className="seg">
                <button className={waterMode === 'depth' ? 'on' : ''} aria-pressed={waterMode === 'depth'} onClick={() => setWaterMode('depth')}
                  data-tip="Más oscuro = más profundo (de 0 a 1,5 m)">Profundidad</button>
                <button className={waterMode === 'order' ? 'on' : ''} aria-pressed={waterMode === 'order'} onClick={() => setWaterMode('order')}
                  data-tip="Colorea según cuándo llegó el agua: rojo lo primero, amarillo lo último">Cuándo llegó</button>
              </div>
            </div>
            <div className="dock-group" role="group" aria-label="Calles y nombres">
              <Toggle on={layers.lines} onClick={() => setLayers({ ...layers, lines: !layers.lines })}
                tip="Calles (se pintan cuando el agua pasa el cordón), riachos y defensa">Calles</Toggle>
              <Toggle on={layers.labels} onClick={() => setLayers({ ...layers, labels: !layers.labels })}
                tip="Nombres de barrios y calles sobre el mapa">Nombres</Toggle>
            </div>
            <div className="dock-group" role="group" aria-label="Cámara">
              <label className="exag" data-tip="Exagera la altura del terreno para que se vean los bajos. Formosa es casi plana: 1× es la escala real.">
                <span>Relieve ×{exag}</span>
                <input type="range" min={EXAG_MIN} max={EXAG_MAX} step={1} value={exag} onChange={(e) => setExag(Number(e.target.value))}
                  aria-label="Exageración vertical del relieve" />
              </label>
              <button className={`toggle freecam-btn ${freeCam.active ? 'on' : ''}`} data-tip="Recorré la ciudad como un dron con el teclado (tecla F para entrar o salir)"
                aria-pressed={freeCam.active}
                onClick={(e) => { e.currentTarget.blur(); sceneRef.current?.setFreeCamera(!freeCam.active); }}>
                ✈ Cámara libre
              </button>
            </div>
          </div>
        )}
        <Legend layers={layers} mode={waterMode} />
      </footer>

      {freeCam.active && (
        <div className="freecam-help" role="status">
          <div><b>Cámara libre</b> · velocidad ×{freeCam.speed.toFixed(2).replace(/\.?0+$/, '')}</div>
          <span>WASD / flechas: mover · Q/E: bajar/subir · Shift: rápido · arrastrar: mirar · rueda: velocidad · F o Esc: salir</span>
        </div>
      )}

      {showInfo && <InfoModal data={data} onClose={() => setShowInfo(false)} />}
      {showGuide && <WelcomeGuide onClose={closeGuide} onShowInfo={() => setShowInfo(true)} />}
      <TipLayer />
    </div>
  );
}

function rank(t: number | undefined, tier: Tier) {
  const live = t != null && t >= 0 ? t : 1e9;
  return live + (tier ? tier : 9) * 1e-3 + (live === 1e9 ? (tier || 9) * 1e7 : 0);
}
/** Orden por umbral: los que el río no alcanza van al final. */
function stageRank(s: number | null) { return s == null ? 1e9 : s; }
function stageTip(s: number | null, what: string) {
  return s == null
    ? `El río no llega a ${what} aunque suba a 20 m: solo puede afectarse por lluvia.`
    : `Con el río a ${fmtStage(s)} en Puerto Formosa empieza a llegarle agua del río a ${what}. Estimación estática, sin lluvia.`;
}

/** Ficha: a qué altura del río se afecta la instalación, con defensa sana y con rotura. */
function ThresholdBlock({ f, crest, river, breach }: { f: FacilityInfo; crest: number; river: number; breach: boolean }) {
  const line = (s: number | null, variant: 'sana' | 'brecha') => {
    const active = breach === (variant === 'brecha');
    const st = thresholdState(s, river);
    const ctx = s == null ? 'el río no llega aunque suba a 20 m'
      : variant === 'sana' && f.protectedByDefense ? `protegida por la defensa hasta su coronamiento (≈${fmtStage(crest)})`
      : stageContext(s, crest);
    return (
      <div className={`thr-line ${active ? 'active' : ''} thr-${st}`}
        data-tip={active ? 'Variante del escenario actual (opción «La defensa falla», en las opciones avanzadas)' : 'Otra variante: cambiala con «La defensa falla», en las opciones avanzadas'}>
        <span>{variant === 'sana' ? 'Se afecta con el río a' : 'Con rotura de la defensa:'} <b className="mono">{fmtStage(s)}</b>
          {active && st === 'alcanzado' ? <em> · ya alcanzada</em> : active && st === 'riesgo' ? <em> · faltan menos de {RISK_MARGIN * 100} cm</em> : null}</span>
        <small>{ctx}</small>
      </div>
    );
  };
  return (
    <div className="thr">
      <div className="thr-h">
        <span>Umbral de exposición al río</span>
        <span className="tag tag-est" data-tip="Estimación estática a partir del terreno y la defensa: no es un pronóstico y no incluye lluvia, desagües ni tiempos de llegada.">ESTIMADO</span>
      </div>
      {f.stageSana == null && f.stageBrecha == null
        ? <p className="thr-none">El río no llega aunque suba a 20 m: solo puede afectarse por lluvia.</p>
        : <>{line(f.stageSana, 'sana')}{line(f.stageBrecha, 'brecha')}</>}
      <p className="thr-foot">Altura en la escala de Puerto Formosa a la que le empieza a llegar agua del río (entorno de ±30 m). Solo río, sin lluvia.</p>
    </div>
  );
}

function fmtHours(h: number) {
  const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
  return hh ? `${hh} h${mm ? ` ${mm} min` : ''}` : `${mm} min`;
}
function fmtClock(s: number) {
  const m = Math.max(0, Math.floor(s / 60));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}
function statusText(l: FacilityLive | null | undefined) {
  if (!l) return '—';
  return l.status === 'afectado' ? 'Con agua (≥ 15 cm)' : l.status === 'atencion' ? 'Agua en las inmediaciones' : 'Sin agua';
}

function Stat({ label, value, sub, accent, tip }: { label: string; value: string; sub?: string; accent?: boolean; tip?: string }) {
  return (
    <div className={`stat ${accent ? 'accent' : ''}`} data-tip={tip}>
      <span>{label}</span>
      <b className="mono">{value}</b>
      {sub && <small>{sub}</small>}
    </div>
  );
}
function TierBadge({ t }: { t: Tier }) {
  return <span className={`tier t${t}`} title={t ? `Se afecta en el escenario de nivel ${t}` : 'No se afecta en los escenarios de referencia'}>{TIER_LABEL[t]}</span>;
}
function Toggle({ on, onClick, children, tip }: { on: boolean; onClick: () => void; children: React.ReactNode; tip?: string }) {
  return (
    <button className={`toggle ${on ? 'on' : ''}`} onClick={onClick} aria-pressed={on} data-tip={tip ? `${tip}. Clic para ${on ? 'ocultar' : 'mostrar'}.` : undefined}>
      <span className="tg-dot" aria-hidden="true" />{children}
    </button>
  );
}
/** Referencias de color: solo de las capas visibles, cada grupo con su título. */
function Legend({ layers, mode }: { layers: Layers; mode: WaterMode }) {
  const groups: { t: string; items: React.ReactNode }[] = [];
  if (layers.water && mode === 'depth') groups.push({ t: 'Agua', items: <span><i className="grad" />poca → 1,5 m o más</span> });
  if (layers.water && mode === 'order') groups.push({ t: 'Agua: cuándo llegó', items: (<>
    <span><i style={{ background: '#5266bd' }} />río (desde el inicio)</span>
    <span><i style={{ background: '#d9424d' }} />primero</span>
    <span><i style={{ background: '#de8538' }} />después</span>
    <span><i style={{ background: '#dec757' }} />al final</span>
  </>) });
  if (layers.zones) groups.push({ t: 'Zonas de riesgo', items: (<>
    <span><i style={{ background: '#d13d47' }} />1º lluvia fuerte</span>
    <span><i style={{ background: '#d98033' }} />2º temporal</span>
    <span><i style={{ background: '#d9c252' }} />3º extremo</span>
  </>) });
  if (layers.drainage) groups.push({ t: 'Bocas de tormenta', items: <span><i style={{ background: '#2ec79e' }} />con red relevada (desagüe 100 %)</span> });
  if (layers.lines) groups.push({ t: 'Calles', items: (<>
    <span><i style={{ background: '#2952c7' }} />agua sobre el cordón</span>
    <span><i style={{ background: '#e5424d' }} />intransitable</span>
  </>) });
  if (layers.facilities) groups.push({ t: 'Instalaciones', items: (<>
    <span><i style={{ background: '#7b8593' }} />sin agua</span>
    <span><i style={{ background: '#e3b04a' }} />agua cerca</span>
    <span><i style={{ background: '#e5525f' }} />afectada (late)</span>
  </>) });
  if (!groups.length) return null;
  return (
    <div className="legend" aria-label="Referencias de colores">
      <span className="dock-label">Referencias</span>
      {groups.map((g) => <span key={g.t} className="lg-group"><em>{g.t}:</em>{g.items}</span>)}
    </div>
  );
}

function InfoModal({ data, onClose }: { data: AppData | null; onClose: () => void }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="x" onClick={onClose}>×</button>
        <h2>Supuestos, datos y límites</h2>
        <p className="lead">Herramienta para <b>explorar escenarios hipotéticos</b>. Muestra <b>zonas a evaluar, no veredictos</b>. Las decisiones operativas y de emergencia son responsabilidad de las autoridades.</p>

        <h3>Cómo funciona</h3>
        <ul>
          <li><b>Modelo hidráulico 2D de inercia local</b> (Bates et al. 2010, base de LISFLOOD-FP): la lluvia cae en cada celda, escurre según la pendiente y se acumula en los bajos.</li>
          <li>Simulación en vivo con celdas de ~60 m. Mapa de zonas 1º/2º/3º precalculado con celdas de ~30 m.</li>
          <li>El río Paraguay es un borde de nivel fijo. Las zonas conectadas al río por debajo de su nivel arrancan con agua ("bañadera conectada").</li>
          <li>El <b>relieve está exagerado</b> en altura (×{DEFAULT_EXAG} por defecto) para que se vean los bajos: Formosa es casi plana. Con el control «Relieve» del panel inferior se puede poner en 1× (escala real).</li>
          <li>Una celda está <b>afectada</b> cuando tiene 15 cm de agua o más. Un barrio está afectado cuando lo está al menos el 5 % de su superficie.</li>
        </ul>

        <h3>Escenarios de referencia (zonas 1º, 2º y 3º)</h3>
        <ul>{LEVELS.map((l, i) => <li key={l.id}><b>{i + 1}º · {l.label}:</b> {l.why}</li>)}</ul>
        {data?.zonesMeta && <p className="hint">Superficie afectada: {data.zonesMeta.stats.map((s, i) => `${i + 1}º ${s.km2} km²`).join(' · ')} (acumulada por escenario).</p>}

        <h3>Supuestos declarados</h3>
        <table>
          <tbody>
            <tr><td>Cero de la escala de Puerto Formosa</td><td className="mono">{ASSUMPTIONS.gaugeZero} m</td><td>Dato oficial (Gobierno de Formosa, 08/12/2015): la cota IGN 59 m equivale a 11,70 m en la escala del puerto, de donde sale el cero 47,30 m IGN. <b>A confirmar con el INA.</b> El terreno (FABDEM) usa otro dátum (EGM2008); la diferencia no está verificada.</td></tr>
            <tr><td>Coronamiento de la defensa</td><td className="mono">{ASSUMPTIONS.defenseCrest} m</td><td>Dato oficial 2015: 11,70 m de escala. Traza reconstruida (~38,6 km; el dato oficial es ~15 km): los 5 tramos reales de OpenStreetMap unidos con conectores estimados que bordean la zona edificada sin cortar manzanas (al norte sigue el riacho Formosa). Es una aproximación: falta la traza oficial. La rotura simulada es una brecha de ~200 m frente al puerto.</td></tr>
            <tr><td>Desagüe + infiltración</td><td className="mono">editable</td><td>{data?.drainageMeta
              ? <>Varía por zona según la red pluvial relevada ({data.drainageMeta.totalKm2} km²): con bocas de tormenta o sumideros, el 100 % del valor elegido; en el resto (solo cunetas e infiltración), el {Math.round(ASSUMPTIONS.drainNoNetwork * 100)} %. Alrededor de cada calle se toman {data.drainageMeta.radii.street} m y alrededor de cada esquina {data.drainageMeta.radii.corner} m.</>
              : 'No hay datos de la red pluvial: toda la ciudad drena igual.'} Con el río en alerta queda un {Math.round(ASSUMPTIONS.drainFactorHighRiver * 100)} % (solo bombeo).</td></tr>
            <tr><td>Agua en las calles</td><td className="mono">{Math.round(STREET.share * 100)} %</td><td>En zona urbana (≥ {STREET.minBuildings} edificios por celda de ~60 m) se supone que la calzada ocupa ese porcentaje de la manzana y junta toda su agua, porque lotes y veredas están más altos. Cordón: {STREET.curb * 100} cm. Intransitable: {STREET.impassable * 100} cm.</td></tr>
            <tr><td>Rugosidad (Manning)</td><td className="mono">{ASSUMPTIONS.manning}</td><td>Valor típico de llanura urbana y periurbana.</td></tr>
            {data?.thresholds && (
              <tr><td>Umbral de exposición al río</td><td className="mono">estimado</td><td>Para cada celda de ~30 m, la altura mínima del río en Puerto Formosa a la que el agua del río llega por superficie («bañadera conectada»: priority-flood desde el río sobre el terreno), calculada con la <b>defensa sana</b> y <b>con la brecha</b> de ~200 m. Una instalación toma el valor más bajo de su entorno (±30 m); un barrio, la altura a la que se expone el 5 % de su superficie. Se evalúa hasta 20 m de escala. <b>No incluye lluvia, desagües, filtraciones ni tiempos de llegada</b>: indica desde qué altura del río conviene mirar cada lugar, no cuándo ni si va a pasar.</td></tr>
            )}
            <tr><td>Umbral de afectación</td><td className="mono">{ASSUMPTIONS.wetThreshold * 100} cm</td><td>Agua que dificulta el tránsito y entra a veredas.</td></tr>
          </tbody>
        </table>

        <h3>Datos utilizados</h3>
        <table>
          <tbody>
            <tr><td><span className="tag tag-obs">OBSERVADO</span></td><td>Río Paraguay en Puerto Formosa: {fmtStage(RIVER_REF.observed.stage)} el {RIVER_REF.observed.date} ({RIVER_REF.observed.trend}, {RIVER_REF.observed.inaCategory}). {RIVER_REF.observed.source}.</td></tr>
            <tr><td><span className="tag tag-obs">REFERENCIA INA</span></td><td>Alerta {fmtStage(RIVER_REF.alert)} · Evacuación {fmtStage(RIVER_REF.evacuation)} (Puerto Formosa). Récord de 1983: {fmtStage(RIVER_REF.record1983)}. Escala de cinco categorías por frecuencia 1991–2020 ({INA_SCALE.join(', ')}): el INA informa la categoría de cada lectura pero no publica los límites en metros, por eso la herramienta no clasifica alturas hipotéticas. Lecturas clasificadas: {INA_CATEGORY_REF.map((r) => `${fmtStage(r.stage)} = ${r.cat} (${r.date}, ${r.source})`).join('; ')}.</td></tr>
            <tr><td><span className="tag tag-ina">PREVISIÓN INA</span></td><td>No se integra en vivo. Consultar <a href="https://alerta.ina.gob.ar/a5/secciones" target="_blank" rel="noreferrer">alerta.ina.gob.ar</a> y cargar el valor como escenario.</td></tr>
            <tr><td><span className="tag tag-ina">ESTIMADO</span></td><td>Pronóstico de lluvia a 7 días, departamento Formosa: {RAIN_FORECAST_7D.meanMm} mm de promedio, hasta {RAIN_FORECAST_7D.maxMm} mm ({RAIN_FORECAST_7D.source}). Es un pronóstico, no una medición. El escenario «7 días» supone que el máximo cae en una sola tormenta de 3 h.</td></tr>
            <tr><td><span className="tag">TERRENO</span></td><td>{data?.meta.source}. Terreno desnudo estimado con aprendizaje automático a partir de un modelo satelital de superficie: puede quedar algún resto de edificios o árboles. Precisión vertical de 1 a 2 m en zonas planas.</td></tr>
            <tr><td><span className="tag">BASE</span></td><td>{data?.osm?.source ?? 'OpenStreetMap (no cargado)'}: infraestructura, calles, riachos, barrios y edificios.</td></tr>
          </tbody>
        </table>

        {data?.drainageMeta && (<>
          <h3>Red pluvial relevada</h3>
          <p className="hint">{data.drainageMeta.source}. Ubicada sobre las calles y barrios de OpenStreetMap. Es una referencia para repartir el desagüe, no un catastro de la red: no sabemos el diámetro de los caños ni si están obstruidos.</p>
          <ul className="drain-list">
            {data.drainageMeta.entries.map((e) => (
              <li key={e.id} className={e.ok ? '' : 'missing'}>{e.ok ? '✓' : '✗'} {e.label}{e.ok ? ` · ${e.km2} km²` : ''}{e.note ? ` (${e.note})` : ''}</li>
            ))}
          </ul>
        </>)}

        <h3>Lo que NO podemos asegurar</h3>
        <ul>
          <li>Qué manzana o casa se inunda: el error vertical del MDE es mayor que muchas diferencias de nivel de la ciudad.</li>
          <li>Tiempos reales de llegada del agua: la red pluvial está relevada solo en parte, sin diámetros ni estado de limpieza, y no conocemos el estado de las bombas. Los tiempos sirven para <b>ordenar</b>, no para planificar al minuto.</li>
          <li>Que el río suba igual en toda la costa: la escala mide un solo punto.</li>
          <li>Que la lista de infraestructura esté completa: OpenStreetMap puede tener faltantes o errores.</li>
          <li>Horizonte temporal: los escenarios son hipotéticos e instantáneos, no un pronóstico. El pronóstico oficial es del INA y del SMN.</li>
        </ul>
      </div>
    </div>
  );
}
