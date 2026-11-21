import { useEffect, useMemo, useRef, useState } from 'react';
import { loadAll, type AppData, type FacilityCat } from './data/load';
import { DEFAULT_EXAG, EXAG_MAX, EXAG_MIN, MapScene, barrioKey, fmtDepth, type Layers, type WaterMode } from './scene/MapScene';
import type { WorkerIn, WorkerOut, SimStats } from './sim/worker';
import type { Scenario } from './sim/engine';
import { ASSUMPTIONS, PRESETS, RIVER_REF, LEVELS, STREET, INA_SCALE, INA_CATEGORY_REF, RAIN_FORECAST_7D, FORECAST_INA, RISE_REF, daysToRise } from './sim/scenarios';
import {
  evalBarrios, evalFacilities, evalStreets, fmtTime, prepareBarrios, prepareFacilities, prepareStreets,
  type BarrioInfo, type BarrioLive, type FacilityInfo, type FacilityLive, type StreetLive, type StreetSamples, type Tier,
} from './analysis';
import {
  censusToSim, exposedProfile, groupLive, groupPriority, heatValues, pct, priorityCells, roughCount, simTiers,
  vulnerabilityShares, IVS_MAX, IVS_MIN, URGENCY,
  type CensusGrid, type Profile, type ZoneLive, type ZonePriority,
} from './priority';
import { validate, type ValidationRow } from './validation';
import { WelcomeGuide, guideSeen, markGuideSeen } from './ui/Guide';
import { TipLayer } from './ui/TipLayer';
import { Icon } from './ui/Icon';
import { fmtStage, stageContext, thresholdState, RISK_MARGIN, type ThresholdState } from './ui/threshold';

const SIM_FACTOR = 2; // celdas de ~60 m en vivo
/** Coronamiento de la defensa expresado en la escala de Puerto Formosa (m). */
const DEFENSE_CREST_STAGE = +(ASSUMPTIONS.defenseCrest - ASSUMPTIONS.gaugeZero).toFixed(2);

const CAT_LABEL: Record<FacilityCat, string> = {
  hospital: 'Hospital', salud: 'Salud', escuela: 'Escuela', seguridad: 'Bomberos / Policía',
  servicios: 'Agua / Energía', publico: 'Municipio / Asistencia social', transporte: 'Transporte',
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
  const [layers, setLayers] = useState<Layers>({ water: true, zones: false, drainage: false, buildings: true, lines: true, labels: true, facilities: true, priority: true, surface: false });
  const [waterMode, setWaterMode] = useState<WaterMode>('depth');
  const layersRef = useRef(layers);
  layersRef.current = layers;
  const [exag, setExag] = useState(DEFAULT_EXAG);
  const [tab, setTab] = useState<'prioridad' | 'barrios' | 'infra' | 'calles'>('prioridad');
  // Prioridad por población (Censo 2022).
  const cgRef = useRef<CensusGrid | null>(null);
  const [census, setCensus] = useState<CensusGrid | null>(null);
  const [pop, setPop] = useState<Profile | null>(null);
  const [barPrio, setBarPrio] = useState<ZonePriority[]>([]);
  const [barPrioLive, setBarPrioLive] = useState<ZoneLive[]>([]);
  const [prioMode, setPrioMode] = useState<'plan' | 'escenario'>('plan');
  const [selBarrio, setSelBarrio] = useState<number | null>(null);
  /** Panel para autoridades: se habilita con el río en el nivel de evacuación del INA (8,30 m) o más. */
  const [showAuth, setShowAuth] = useState(false);
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
  /** Mobile only: which bottom sheet is open (panels become sheets under 760px). */
  const [sheet, setSheet] = useState<'left' | 'right' | 'dock' | null>('left');
  const toggleSheet = (s: 'left' | 'right' | 'dock') => setSheet((cur) => (cur === s ? null : s));
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
        // Prioridad: personas (Censo 2022) × urgencia (zona 1º/2º/3º) × vulnerabilidad.
        const cg = censusToSim(data, info);
        cgRef.current = cg;
        setCensus(cg);
        if (cg) {
          const tiers = simTiers(data, info);
          const cellScore = priorityCells(cg, tiers);
          scene.setPriorityHeat(heatValues(cellScore), m.width, m.height);
          setBarPrio(groupPriority(barRef.current.map((b) => b.cells), cg, tiers, cellScore));
        }
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
          setFacLive(fl);
          setBarLive(bl);
          scene.setBarrioLabels(new Map(barRef.current.map((b, i) => [barrioKey(b), bl[i].status])));
          const cg = cgRef.current;
          const live = cg ? groupLive(barRef.current.map((b) => b.cells), cg, m.d, m.tWet, m.byRiver, ASSUMPTIONS.wetThreshold, m.stats.time) : null;
          if (cg && live) {
            setPop(exposedProfile(cg, m.d, ASSUMPTIONS.wetThreshold));
            setBarPrioLive(live);
          }
          // Calles que podrían quedar intransitables: carteles animados en el mapa (las 6 con más km cortados).
          const st = streetRef.current ? evalStreets(streetRef.current, m.d) : null;
          setStreets(st);
          const cortadas = (st?.top ?? []).filter((t) => t.maxDepth >= STREET.impassable && t.cell >= 0).slice(0, 6);
          scene.setStreetAlerts(cortadas.map((t) => ({ name: t.name, depth: t.maxDepth, cell: t.cell })), layersRef.current.lines);
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
    // El efecto de [scenario] corre antes de que exista el worker: sin esto, la primera simulación no paraba al final.
    worker.postMessage({ type: 'stopAt', seconds: (scenario.rainHours + 1) * 3600 } satisfies WorkerIn);

    const onClick = (ev: MouseEvent) => {
      const i = scene.pickFacility(ev.clientX, ev.clientY);
      if (i >= 0) { setSelected(i); setSelBarrio(null); setTab('infra'); scene.focusFacility(i); }
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
  // Orden de prioridad de los barrios: en el plan (zonas 1º/2º/3º) o en el escenario que se está simulando.
  const prioRows = useMemo(() => barrios.map((b, i) => ({ b, i, p: barPrio[i], l: barPrioLive[i] }))
    .filter((r) => r.p && (prioMode === 'plan' ? r.p.score > 0 : (r.l?.score ?? 0) > 0))
    .sort((a, z) => (prioMode === 'plan' ? z.p.score - a.p.score : (z.l?.score ?? 0) - (a.l?.score ?? 0))),
  [barrios, barPrio, barPrioLive, prioMode]);
  const prioMax = prioRows.length ? (prioMode === 'plan' ? prioRows[0].p.score : prioRows[0].l?.score ?? 1) : 1;
  // Kilómetros de calles por tipo de calzada (sin la margen paraguaya).
  const surfaceKm = useMemo(() => {
    if (!data?.osm) return null;
    const km = { p: 0, t: 0, u: 0 };
    for (const r of data.osm.roads) {
      if (r.py) continue;
      let m = 0;
      for (let i = 1; i < r.c.length; i++) {
        const [x0, y0] = r.c[i - 1], [x1, y1] = r.c[i];
        m += Math.hypot((x1 - x0) * 111320 * Math.cos((y0 * Math.PI) / 180), (y1 - y0) * 111320);
      }
      const sf = r.s ?? (r.paved ? 'p' : 't');
      km[sf === 'p' ? 'p' : sf === 't' ? 't' : 'u'] += m / 1000;
    }
    const tot = km.p + km.t + km.u || 1;
    return {
      p: Math.round(km.p), t: Math.round(km.t), u: Math.round(km.u),
      pct: { p: (km.p / tot) * 100, t: (km.t / tot) * 100, u: (km.u / tot) * 100 },
    };
  }, [data]);
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
    <div className="app" ref={appRef} data-sheet={sheet ?? 'none'}>
      <div ref={mountRef} className="viewport" />
      {!data && <div className="loading"><div className="spinner" />Cargando terreno de Formosa…</div>}

      <header className="topbar">
        <div className="brand">
          <img className="brand-mark" src="/icons/icon.svg" alt="" width={36} height={36} />
          <div>
            <h1>Operación Agua</h1>
            <p>Lluvia y crecida · Formosa Capital</p>
          </div>
        </div>
        <div className="sources" aria-label="Fuentes: dato observado, previsión del INA y escenario hipotético">
          <span className="src src-obs" data-tip={`Altura real del río Paraguay medida en Puerto Formosa (${RIVER_REF.observed.trend}). Categoría según la escala del INA. Fuente: ${RIVER_REF.observed.source}.`}>
            <small><i aria-hidden="true" />Observado · {RIVER_REF.observed.date}</small>
            <b>Río {fmtStage(RIVER_REF.observed.stage)} · {RIVER_REF.observed.inaCategory}</b>
          </span>
          <a className="src src-ina" href={FORECAST_INA.url} target="_blank" rel="noreferrer"
            data-tip={`Estimación del INA, no una medición. ${FORECAST_INA.text} Fuente: ${FORECAST_INA.source}. Clic para abrir el reporte.`}>
            <small><i aria-hidden="true" />Previsión INA · al {FORECAST_INA.until.slice(0, 5)}</small>
            <b>~{fmtStage(FORECAST_INA.stage)} ± {FORECAST_INA.margin.toFixed(1).replace('.', ',')} <Icon name="external" size={13} /></b>
          </a>
          <span className="src src-user" data-tip="Lo que ves en el mapa es un escenario que elegís vos: hipotético, no un pronóstico.">
            <small><i aria-hidden="true" />Escenario del usuario</small>
            <b>Hipotético</b>
          </span>
        </div>
        <button className="btn ghost help-btn" onClick={() => setShowGuide(true)} data-tip="Guía rápida: qué es este simulador y cómo usarlo en 4 pasos">
          <Icon name="help" /><span>Cómo se usa</span>
        </button>
      </header>

      <aside className={`panel left ${collapsed.left ? 'collapsed' : ''}`}>
        <div className="panel-head">
          <h2>Escenario</h2>
          <button className="icon-btn collapse" onClick={() => setCollapsed((c) => ({ ...c, left: !c.left }))}
            data-tip={collapsed.left ? 'Mostrar el panel del escenario' : 'Ocultar este panel para ver más mapa'} aria-label="Mostrar u ocultar el panel del escenario"
            aria-expanded={!collapsed.left}><Icon name={collapsed.left ? 'chevronRight' : 'chevronLeft'} /></button>
        </div>

        <div className="step">
          <h3 className="step-h"><span className="step-n">1</span>Elegí un escenario</h3>
          <div className="presets" role="group" aria-label="Escenarios predefinidos">
            {PRESETS.map((p) => (
              <button key={p.id} className={`preset ${presetId === p.id ? 'on' : ''} lvl-${p.id}`} onClick={() => applyPreset(p.id)}
                data-tip={`${p.label}: ${p.why}`} aria-pressed={presetId === p.id}>
                <b>{p.short}</b><span>{p.label}</span>
              </button>
            ))}
          </div>
          {preset ? <p className="why">{preset.why}</p> : <p className="why custom">Escenario personalizado (cambiaste algún valor a mano).</p>}
          <details className="assumption" data-tip={`Ritmo de subida supuesto: ~${RISE_REF.cmPerDay} cm/día (${RISE_REF.source}). No es un pronóstico.`}>
            <summary>
              <span>Horizonte {fmtHours(scenario.rainHours + 1)} · <span className="conf">confianza baja</span></span>
              <Icon name="chevronDown" size={16} />
            </summary>
            <p>
              {daysToRise(scenario.riverStage) > 0
                ? <>El río sube de {fmtStage(RIVER_REF.observed.stage)} (hoy) a {fmtStage(scenario.riverStage)} en <b>~{daysToRise(scenario.riverStage)} días</b> (ritmo de oct. 2026, ~{RISE_REF.cmPerDay} cm/día) y se queda ahí;</>
                : <>El río se mantiene en {fmtStage(scenario.riverStage)};</>}
              {' '}llueven {(scenario.rainMmH * scenario.rainHours).toFixed(0)} mm en {fmtHours(scenario.rainHours)}. Escenario hipotético, no es un pronóstico.
            </p>
          </details>
        </div>

        <div className="step">
          <h3 className="step-h"><span className="step-n">2</span>Ajustá <em>opcional</em></h3>
          <section>
            <label className="row" data-tip="Intensidad: cuántos milímetros de agua caen por hora. 40 mm/h ya es una tormenta fuerte; más de 100 mm/h es excepcional.">
              <span>Lluvia (intensidad)</span><b className="num">{scenario.rainMmH} mm/h</b>
            </label>
            <input type="range" min={0} max={200} step={5} value={scenario.rainMmH} onChange={(e) => update({ rainMmH: +e.target.value })}
              aria-label="Intensidad de la lluvia en milímetros por hora" data-tip="Arrastrá para cambiar cuánta lluvia cae por hora" />
            <div className="permin">
              <input
                type="number" min={0} max={3.33} step={0.05} value={+rainMmMin.toFixed(2)}
                onChange={(e) => update({ rainMmH: Math.max(0, Math.min(200, Math.round(+e.target.value * 60))) })}
                aria-label="Lluvia en milímetros por minuto" data-tip="La misma intensidad, expresada por minuto. Podés escribir el valor directamente."
              />
              <span>mm/min (litros por m² por minuto)</span>
            </div>
            <label className="row" data-tip="Cuánto tiempo dura la lluvia. Después la simulación sigue 1 hora más para ver cómo escurre el agua.">
              <span>Duración de la lluvia</span><b className="num">{fmtHours(scenario.rainHours)}</b>
            </label>
            <input type="range" min={0.25} max={6} step={0.25} value={scenario.rainHours} onChange={(e) => update({ rainHours: +e.target.value })}
              aria-label="Duración de la lluvia" data-tip="Arrastrá para cambiar cuánto dura la lluvia" />
            <div className="hint">Total: <b className="num">{(scenario.rainMmH * scenario.rainHours).toFixed(0)} mm</b> ({(scenario.rainMmH * scenario.rainHours).toFixed(0)} L/m²)</div>
          </section>

          <section>
            <label className="row" data-tip="Altura del río Paraguay en la escala de Puerto Formosa. Con el río alto, el agua de lluvia no puede salir y el río entra a los bajos.">
              <span>Altura del río Paraguay</span><b className={`num river-${riverCat}`}>{scenario.riverStage.toFixed(2)} m</b>
            </label>
            {/* Hasta 13 m: por encima del coronamiento de la defensa (11,70 m) para poder mostrar el desborde. */}
            <input type="range" min={1.5} max={13} step={0.05} value={scenario.riverStage} onChange={(e) => update({ riverStage: +e.target.value })}
              aria-label="Altura del río Paraguay en metros" data-tip="Arrastrá para subir o bajar el río. Cambiarlo reinicia la simulación." />
            <div className="scale" role="group" aria-label="Alturas de referencia del río: tocá una para usarla">
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
            <div className="hint" data-tip={`Escala del INA (frecuencia 1991–2020): ${INA_SCALE.join(' · ')}. El INA no publica los límites en metros, así que no clasificamos alturas hipotéticas. Lecturas reales clasificadas por el INA: ${INA_CATEGORY_REF.map((r) => `${fmtStage(r.stage)} = ${r.cat} (${r.date})`).join('; ')}.`}>
              Tocá una marca para usar esa altura. Escala INA hoy: <b>{RIVER_REF.observed.inaCategory}</b> · alerta {fmtStage(RIVER_REF.alert)} · evacuación {fmtStage(RIVER_REF.evacuation)}.
            </div>
          </section>

          <button className={`advanced-toggle ${showAdvanced ? 'open' : ''}`} onClick={() => setShowAdvanced((v) => !v)} aria-expanded={showAdvanced}
            data-tip="Desagüe de la ciudad y falla de la defensa costera. Ya vienen con valores razonables.">
            <Icon name={showAdvanced ? 'chevronDown' : 'chevronRight'} size={16} /> Opciones avanzadas
            {!showAdvanced && (scenario.defenseFails ? <em className="adv-flag">defensa falla</em> : null)}
          </button>
          {showAdvanced && (
            <section className="advanced">
              <label className="row" data-tip="Cuánta agua por hora se va por los desagües pluviales y se infiltra en el suelo. Más alto = la ciudad drena mejor.">
                <span>Desagüe + infiltración</span><b className="num">{scenario.drainMmH} mm/h</b>
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
              <button className="btn primary" onClick={() => send({ type: 'pause' })} data-tip="Congela la simulación en este momento"><Icon name="pause" />Pausar</button>
            ) : (
              <button className="btn primary" onClick={() => send({ type: 'play' })}
                data-tip="Empieza a llover sobre la ciudad con el escenario elegido. El tiempo corre acelerado.">
                <Icon name="play" />{stats && stats.time > 0 && !stats.finished ? 'Seguir' : 'Hacer llover'}
              </button>
            )}
            <button className="btn" onClick={() => send({ type: 'reset' })} data-tip="Vuelve a cero: saca el agua de lluvia y deja solo el río"><Icon name="reset" />Reiniciar</button>
          </div>
          <div className="field-row" data-tip="Velocidad: cuántos minutos simulados pasan por cada segundo real">
            <span id="speed-label">Velocidad</span>
            <div className="seg" role="radiogroup" aria-labelledby="speed-label">
              {[[300, '5 min/s'], [900, '15 min/s'], [1800, '30 min/s']].map(([v, t]) => (
                <button key={v} role="radio" aria-checked={speed === v} className={speed === v ? 'on' : ''} onClick={() => setSpeed(+v)}>{t}</button>
              ))}
            </div>
          </div>
          <div className={`status-line st-${phase.cls}`} role="status" aria-live="polite"><i />{phase.text}</div>
          <div className="timeline" data-tip="Barra de tiempo: la marca amarilla indica cuándo para de llover; después se simula 1 hora más de escurrimiento.">
            <div className="bar"><i style={{ width: `${Math.min(100, ((stats?.time ?? 0) / totalSeconds) * 100)}%` }} /><em style={{ left: `${(scenario.rainHours / (scenario.rainHours + 1)) * 100}%` }} /></div>
            <div className="row small num"><span>{fmtTime(stats?.time ?? 0).replace('t=0 (río)', '0 min')}</span><span>{raining ? 'lloviendo' : stats?.finished ? 'fin' : stats && stats.time > scenario.rainHours * 3600 ? 'escurriendo' : ''}</span><span>{fmtHours(scenario.rainHours + 1)}</span></div>
          </div>
        </div>
      </aside>

      <aside className={`panel right ${collapsed.right ? 'collapsed' : ''}`}>
        <div className="panel-head">
          <button className="icon-btn collapse" onClick={() => setCollapsed((c) => ({ ...c, right: !c.right }))}
            data-tip={collapsed.right ? 'Mostrar los resultados' : 'Ocultar este panel para ver más mapa'} aria-label="Mostrar u ocultar el panel de resultados"
            aria-expanded={!collapsed.right}><Icon name={collapsed.right ? 'chevronLeft' : 'chevronRight'} /></button>
          <h2>Resultados</h2>
          <span className="panel-sub">en vivo</span>
        </div>
        <div className="stats">
          <Stat label="Tiempo simulado" value={fmtTime(stats?.time ?? 0).replace('t=0 (río)', '0 min')} tip="Tiempo transcurrido dentro de la simulación (no tiempo real)" />
          <Stat label="Lluvia caída" value={`${(stats?.rainMm ?? 0).toFixed(0)} mm`} tip="Milímetros de lluvia acumulados hasta ahora (1 mm = 1 litro por m²)" />
          <Stat label="Calles que podrían cortarse" value={<CountUp value={streets?.impassableKm ?? 0} decimals={1} suffix=" km" />} sub={`${(streets?.curbKm ?? 0).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km con agua sobre el cordón`} accent
            tip={`Kilómetros de calle con más de ${STREET.impassable * 100} cm de agua: podrían quedar intransitables para autos y peatones. Sobre el cordón: más de ${STREET.curb * 100} cm.`} />
          <Stat label="Edificios con agua ≥ 15 cm" value={bld.wet.toLocaleString('es-AR')} sub={`${bld.near.toLocaleString('es-AR')} con agua cerca · de ${(data?.buildings?.count ?? 0).toLocaleString('es-AR')}`} accent
            tip="Edificios de OpenStreetMap con al menos 15 cm de agua alrededor" />
          <Stat label="Área con agua ≥ 15 cm" value={`${(stats?.areaKm2 ?? 0).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km²`} sub="estimado" tip="Superficie total cubierta por 15 cm de agua o más (incluye lo que entra desde el río)" />
          {census && (
            <Stat label="Personas en zonas con agua" value={`~${roughCount(pop?.poblacion ?? 0).toLocaleString('es-AR')}`} accent
              sub={census.hasSocio && pop
                ? `~${roughCount(pop.menores14).toLocaleString('es-AR')} niños ≤ 14 · ~${roughCount(pop.mayores65).toLocaleString('es-AR')} mayores ≥ 65 · ~${roughCount(pop.hogaresNbi).toLocaleString('es-AR')} hogares con NBI`
                : 'Censo 2022'}
              tip="Personas que viven en celdas con 15 cm de agua o más, según el Censo 2022 (INDEC) por radio censal. Orden de magnitud, no un conteo." />
          )}
          <Stat label="Instalaciones" value={`${affectedCounts.afectado}`} sub={`afectadas · ${affectedCounts.atencion} en atención`} accent
            tip="Hospitales, escuelas, bomberos, etc. Afectada: tiene agua (≥ 15 cm). En atención: hay agua cerca." />
        </div>

        <div className="tabs" role="tablist" aria-label="Listas de resultados">
          <button role="tab" aria-selected={tab === 'prioridad'} className={tab === 'prioridad' ? 'on' : ''} onClick={() => setTab('prioridad')} data-tip="Dónde actuar primero: barrios ordenados por población, vulnerabilidad y orden de afectación (Censo 2022)">Prioridad</button>
          <button role="tab" aria-selected={tab === 'calles'} className={tab === 'calles' ? 'on' : ''} onClick={() => setTab('calles')} data-tip="Calles que podrían quedar intransitables (más de 30 cm de agua)">Calles</button>
          <button role="tab" aria-selected={tab === 'barrios'} className={tab === 'barrios' ? 'on' : ''} onClick={() => setTab('barrios')} data-tip="Barrios ordenados por cuándo les llega el agua">Barrios <em>{barrios.length}</em></button>
          <button role="tab" aria-selected={tab === 'infra'} className={tab === 'infra' ? 'on' : ''} onClick={() => setTab('infra')} data-tip="Hospitales, escuelas, bomberos, etc. ordenados por cuándo les llega el agua">Instalaciones <em>{facilities.length}</em></button>
        </div>
        <p className="list-lead">Tocá una fila para verla en el mapa.</p>
        {tab === 'prioridad' ? (
          <div className="prio-help">
            <div className="order-row">
              <span>Según:</span>
              <div className="seg">
                <button className={prioMode === 'plan' ? 'on' : ''} aria-pressed={prioMode === 'plan'} onClick={() => setPrioMode('plan')}
                  data-tip="Zonas 1º, 2º y 3º precalculadas: sirve para planificar dónde poner recursos">plan (zonas 1º·2º·3º)</button>
                <button className={prioMode === 'escenario' ? 'on' : ''} aria-pressed={prioMode === 'escenario'} onClick={() => setPrioMode('escenario')}
                  data-tip="El agua de la simulación en curso">escenario en curso</button>
              </div>
            </div>
            <p className="list-help" data-tip={`Urgencia: ${prioMode === 'plan' ? `zona 1º ×${URGENCY[1]} · 2º ×${URGENCY[2]} · 3º ×${URGENCY[3]}` : 'agua que llegó antes ×3 · después ×2 · al final ×1'}. Vulnerabilidad: hogares con NBI, niños y mayores, sin cobertura de salud (1 = promedio de la ciudad). Un barrio chico que se afecta primero puede quedar debajo de uno denso y vulnerable.`}>
              <b>Dónde actuar primero:</b> personas (Censo 2022) × urgencia × vulnerabilidad. Ordena la evaluación, <b>no decide</b>.
            </p>
            {census && !census.hasSocio && <p className="list-help warn">Falta el detalle sociodemográfico: se usa solo la población.</p>}
          </div>
        ) : tab === 'calles' ? (
          <div className="street-sum">
            <p className="list-help">
              Cada barra es el <b>agua en la calzada</b>: el vaso se llena con la profundidad y la línea marca {STREET.impassable * 100} cm, donde un auto ya no pasa.
              En el mapa aparecen carteles <NoPass /> en las calles más afectadas. {(streets?.dirtCurbKm ?? 0) > 0.05 ? `Incluye ${(streets?.dirtCurbKm ?? 0).toFixed(1)} km de calles de tierra.` : ''}
              Es una estimación: no indica qué cuadra exacta se corta.
            </p>
            {surfaceKm && (
              <div className="surf-sum" data-tip="Según la etiqueta «surface» de OpenStreetMap. Las calles sin dato no se cuentan como asfaltadas ni como de tierra.">
                <div className="surf-bar">
                  <i className="p" style={{ width: `${surfaceKm.pct.p}%` }} />
                  <i className="t" style={{ width: `${surfaceKm.pct.t}%` }} />
                  <i className="u" style={{ width: `${surfaceKm.pct.u}%` }} />
                </div>
                <span>Calles de Formosa: <b>{surfaceKm.p} km pavimentadas</b> · <b className="t">{surfaceKm.t} km de tierra</b> · {surfaceKm.u} km sin dato (OSM)</span>
                <button className="link" onClick={() => setLayers({ ...layers, surface: true, lines: true })}>Ver en el mapa</button>
              </div>
            )}
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
          Arriba, lo primero que toca el agua (a la derecha, cuándo). Se afecta desde:{' '}
          <span className="tier t1 inline">1º</span> lluvia fuerte · <span className="tier t2 inline">2º</span> temporal ·{' '}
          <span className="tier t3 inline">3º</span> extremo · <span className="tier t0 inline">—</span> ninguno.
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
          {tab === 'prioridad' && prioRows.map(({ b, i, p, l }, k) => {
            const score = prioMode === 'plan' ? p.score : l?.score ?? 0;
            const people = prioMode === 'plan' ? p.peopleByTier[0] + p.peopleByTier[1] + p.peopleByTier[2] : l?.people ?? 0;
            const nbi = vulnerabilityShares(p.profile).nbi;
            return (
              <li key={i} className={`prio ${selBarrio === i ? 'sel' : ''}`} onClick={() => { setSelBarrio(i); setSelected(null); sceneRef.current?.focusLonLat(b.lon, b.lat); }}>
                <span className="rank num">{k + 1}</span>
                <div className="li-main">
                  <b>{b.name}</b>
                  <span>{prioMode === 'plan'
                    ? <>~{roughCount(people).toLocaleString('es-AR')} personas en zonas 1º-3º</>
                    : <>~{roughCount(l?.people ?? 0).toLocaleString('es-AR')} personas con agua</>} · NBI {Math.round(nbi * 100)} % · vuln. ×{p.ivs.toFixed(2).replace('.', ',')}</span>
                  <i className="bar"><i style={{ width: `${Math.max(3, (score / prioMax) * 100)}%` }} /></i>
                </div>
                <TierBadge t={b.tier} />
              </li>
            );
          })}
          {tab === 'prioridad' && !prioRows.length && <li className="empty">{prioMode === 'plan' ? 'Sin datos del censo o de las zonas.' : 'Todavía no hay agua en barrios poblados. Probá «Hacer llover».'}</li>}
          {tab === 'barrios' && barrioRows.map(({ b, l, i }) => (
            <li key={i} className={byRiverOrder ? thrRowClass(stageOf(b)) : `st-${l?.status ?? 'seco'}`} onClick={() => { setSelBarrio(i); setSelected(null); sceneRef.current?.focusLonLat(b.lon, b.lat); }}>
              <TierBadge t={b.tier} />
              <div className="li-main"><b>{b.name}</b><span>{l ? `${Math.round(l.share * 100)} % con agua` : ''}{byRiverOrder && b.protectedByDefense && !scenario.defenseFails ? ' · tras la defensa' : ''}</span></div>
              {byRiverOrder
                ? <span className="num time" data-tip={stageTip(stageOf(b), 'el 5 % del barrio')}>{fmtStage(stageOf(b))}</span>
                : <span className="num time">{fmtTime(l?.firstAffected ?? -1)}</span>}
            </li>
          ))}
          {tab === 'infra' && facRows.map(({ f, l, i }) => (
            <li key={f.id} className={`${byRiverOrder ? thrRowClass(stageOf(f)) : `st-${l?.status ?? 'seco'}`} ${selected === i ? 'sel' : ''}`} onClick={() => { setSelected(i); sceneRef.current?.focusFacility(i); }}>
              <TierBadge t={f.tier} />
              <div className="li-main"><b>{f.name}</b><span>{CAT_LABEL[f.cat]}{l && l.status !== 'seco' ? ` · ${(l.depth * 100).toFixed(0)} cm` : ''}{byRiverOrder && f.protectedByDefense && !scenario.defenseFails ? ' · tras la defensa' : ''}</span></div>
              {byRiverOrder
                ? <span className="num time" data-tip={stageTip(stageOf(f), 'esta instalación')}>{fmtStage(stageOf(f))}</span>
                : <span className="num time">{fmtTime(l?.firstWet ?? -1)}</span>}
            </li>
          ))}
          {tab === 'calles' && streets?.top.map((t) => {
            const cut = t.maxDepth >= STREET.impassable;
            return (
              <li key={t.name} className={`street-row ${cut ? 'st-afectado cut' : 'st-atencion'}`}
                onClick={() => { if (t.cell >= 0) sceneRef.current?.focusSimCell(t.cell); }}
                data-tip={`${t.name}: agua en la calzada ${fmtDepth(t.maxDepth)}. Clic para verla en el mapa.`}>
                <WaterGauge depth={t.maxDepth} />
                <div className="li-main"><b>{cut && <NoPass />}{t.name}{t.dirt && <em className="dirt-tag" data-tip="Calle de tierra (OpenStreetMap): con agua queda con barro y se corta antes">tierra</em>}</b><span>{cut ? 'podría quedar intransitable' : 'agua sobre el cordón'} · {fmtDepth(t.maxDepth)}</span></div>
                <span className="num time">{t.km.toFixed(2)} km</span>
              </li>
            );
          })}
          {tab === 'calles' && !streets?.top.length && <li className="empty">Todavía no hay calles con agua sobre el cordón. Probá «Hacer llover».</li>}
          {tab === 'barrios' && !barrios.length && <li className="empty">Sin barrios de OpenStreetMap cargados.</li>}
          {tab === 'infra' && !facilities.length && <li className="empty">Sin infraestructura de OpenStreetMap cargada.</li>}
        </ol>
        {tab === 'infra' && facilities.length > 0 && (
          <div className="tier-sum num">Nivel 1º: {tierCounts[1]} · 2º: {tierCounts[2]} · 3º: {tierCounts[3]} · fuera: {tierCounts[0]}</div>
        )}
      </aside>

      {scenario.riverStage >= RIVER_REF.evacuation && census && (
        <button className="evac-alert" onClick={() => setShowAuth(true)}
          data-tip="Abre la evaluación para autoridades: barrios ordenados por prioridad y familias a evaluar para una posible evacuación">
          <i className="ea-dot" aria-hidden="true" />
          <span><b>Río en nivel de evacuación</b> ({fmtStage(scenario.riverStage)} ≥ {fmtStage(RIVER_REF.evacuation)}, INA)</span>
          <em>Ver evaluación para autoridades ›</em>
        </button>
      )}

      {(streets?.impassableKm ?? 0) > 0.1 && (
        <div className="impact" role="status" aria-live="polite">
          <div className="im-item">
            <NoPass big />
            <b className="num"><CountUp value={streets?.impassableKm ?? 0} decimals={1} suffix=" km" /></b>
            <span>de calles que podrían cortarse</span>
          </div>
          <em>Escenario hipotético</em>
        </div>
      )}

      {hover && facilities[hover.i] && (
        <div className="tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          <small>{CAT_LABEL[facilities[hover.i].cat]}</small>
          <b>{facilities[hover.i].name}</b>
          <span>{statusText(facLive[hover.i])}{facilities[hover.i].tier ? ` · nivel ${TIER_LABEL[facilities[hover.i].tier]}` : ''}
            {hasThr ? (stageOf(facilities[hover.i]) == null ? ' · el río no llega' : ` · río a ${fmtStage(stageOf(facilities[hover.i]))}`) : ''}</span>
        </div>
      )}

      {selBarrio != null && !sel && barrios[selBarrio] && barPrio[selBarrio] && (
        <BarrioCard
          name={barrios[selBarrio].name} tier={barrios[selBarrio].tier} prio={barPrio[selBarrio]} live={barPrioLive[selBarrio]}
          rank={[...barPrio].sort((a, z) => z.score - a.score).indexOf(barPrio[selBarrio]) + 1}
          ranked={barPrio.filter((x) => x.score > 0).length} hasSocio={!!census?.hasSocio} source={data?.poblacion?.fuente ?? ''}
          onClose={() => setSelBarrio(null)}
        />
      )}

      {sel && (
        <div className="card">
          <button className="x" onClick={() => { setSelected(null); sceneRef.current?.focusFacility(null); }} aria-label="Cerrar ficha" data-tip="Cerrar la ficha"><Icon name="close" /></button>
          <small>{CAT_LABEL[sel.cat]}</small>
          <h3>{sel.name}</h3>
          <dl>
            <dt>Estado ahora</dt><dd className={`st-${selLive?.status}`}>{statusText(selLive)}</dd>
            <dt>Agua máx. cerca (±60 m)</dt><dd className="num">{selLive ? `${(selLive.depth * 100).toFixed(0)} cm` : '—'}</dd>
            <dt>Primer contacto con agua</dt><dd className="num">{fmtTime(selLive?.firstWet ?? -1)}{selLive?.byRiver ? ' · por el río' : ''}</dd>
            <dt>Nivel de referencia</dt><dd>{sel.tier ? `${TIER_LABEL[sel.tier]} (${LEVELS[sel.tier - 1].label})${sel.tierByRiver ? ' · por el río' : ''}` : 'No se afecta en los 3 escenarios'}</dd>
          </dl>
          {hasThr && <ThresholdBlock f={sel} crest={crestStage} river={scenario.riverStage} breach={scenario.defenseFails} />}
          {sel.detail && <p className="hint">{sel.detail}</p>}
          <p className="hint">Zona a evaluar, no veredicto: el MDE tiene ~2 m de error vertical. Fuente: {sel.source ?? 'OpenStreetMap'}.</p>
        </div>
      )}

      <footer className="dock" ref={dockRef}>
        <div className="layers">
          <div className="dock-group" role="group" aria-label="Capas visibles en el mapa">
            <span className="dock-label"><Icon name="layers" size={16} />Capas</span>
            <Toggle on={layers.water} onClick={() => setLayers({ ...layers, water: !layers.water })}
              tip="El agua de la simulación, moviéndose en tiempo real">Agua</Toggle>
            {census && (
              <Toggle on={layers.priority} onClick={() => setLayers({ ...layers, priority: !layers.priority })}
                tip="Mapa de calor de dónde actuar primero: zonas 1º/2º/3º ponderadas por cuánta gente vive ahí y qué tan vulnerable es (Censo 2022)">Prioridad (población)</Toggle>
            )}
            <Toggle on={layers.surface} onClick={() => setLayers({ ...layers, surface: !layers.surface, lines: true })}
              tip="Colorea las calles según OpenStreetMap: pavimentadas (gris claro), de tierra (ocre) o sin dato (punteadas). Las de tierra se cortan antes y quedan con barro">Tipo de calle</Toggle>
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
            <button className={`btn ghost ${showView ? 'on' : ''}`} aria-expanded={showView} onClick={() => setShowView((v) => !v)}
              data-tip="Color del agua, relieve, calles y cámara libre"><Icon name="sliders" />Vista</button>
            <button className="btn ghost" onClick={() => setShowInfo(true)} data-tip="Qué datos usamos, qué suponemos y qué NO podemos asegurar"><Icon name="info" />Supuestos y límites</button>
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
                <Icon name="camera" size={16} />Cámara libre
              </button>
            </div>
          </div>
        )}
        <Legend layers={layers} mode={waterMode} />
      </footer>

      <nav className="mobile-nav" aria-label="Secciones">
        <button className={sheet === 'left' ? 'on' : ''} aria-pressed={sheet === 'left'} onClick={() => toggleSheet('left')}><Icon name="scenario" size={22} /><span>Escenario</span></button>
        <button className={sheet === 'right' ? 'on' : ''} aria-pressed={sheet === 'right'} onClick={() => toggleSheet('right')}><Icon name="results" size={22} /><span>Resultados</span></button>
        <button className="mn-play" onClick={() => send({ type: stats?.running ? 'pause' : 'play' })}
          aria-label={stats?.running ? 'Pausar la simulación' : 'Hacer llover'}><Icon name={stats?.running ? 'pause' : 'play'} size={26} /></button>
        <button className={sheet === 'dock' ? 'on' : ''} aria-pressed={sheet === 'dock'} onClick={() => toggleSheet('dock')}><Icon name="layers" size={22} /><span>Capas</span></button>
        <button onClick={() => setShowInfo(true)}><Icon name="info" size={22} /><span>Límites</span></button>
      </nav>

      {freeCam.active && (
        <div className="freecam-help" role="status">
          <div><b>Cámara libre</b> · velocidad ×{freeCam.speed.toFixed(2).replace(/\.?0+$/, '')}</div>
          <span>WASD / flechas: mover · Q/E: bajar/subir · Shift: rápido · arrastrar: mirar · rueda: velocidad · F o Esc: salir</span>
        </div>
      )}

      {showAuth && scenario.riverStage >= RIVER_REF.evacuation && (
        <AuthorityPanel
          rows={barrios.map((b, i) => ({ name: b.name, lon: b.lon, lat: b.lat, live: barPrioLive[i], prio: barPrio[i], stage: scenario.defenseFails ? b.stageBrecha : b.stageSana }))}
          total={pop} river={scenario.riverStage} rainMm={scenario.rainMmH * scenario.rainHours} simTime={stats?.time ?? 0}
          defenseFails={scenario.defenseFails}
          onFocus={(lon, lat) => { setShowAuth(false); sceneRef.current?.focusLonLat(lon, lat); }}
          onClose={() => setShowAuth(false)}
        />
      )}
      {showInfo && <InfoModal data={data} validation={barPrio.length ? validate(barrios, barPrio.map((x) => x.score)) : null} onClose={() => setShowInfo(false)} />}
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
        <span>{variant === 'sana' ? 'Se afecta con el río a' : 'Con rotura de la defensa:'} <b className="num">{fmtStage(s)}</b>
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

function BarrioCard({ name, tier, prio, live, rank, ranked, hasSocio, source, onClose }: {
  name: string; tier: Tier; prio: ZonePriority; live?: ZoneLive; rank: number; ranked: number; hasSocio: boolean; source: string; onClose: () => void;
}) {
  const p = prio.profile;
  const n = (v: number) => `~${roughCount(v).toLocaleString('es-AR')}`;
  return (
    <div className="card barrio-card">
      <button className="x" onClick={onClose} aria-label="Cerrar ficha" data-tip="Cerrar la ficha"><Icon name="close" /></button>
      <small>Barrio · perfil del Censo 2022</small>
      <h3>{name}</h3>
      <p className="prio-rank">{prio.score > 0 ? <>Prioridad <b>{rank}º</b> de {ranked} barrios en el plan</> : 'Fuera de las zonas 1º, 2º y 3º'}{tier ? ` · se afecta en el nivel ${TIER_LABEL[tier]}` : ''}</p>
      <dl>
        <dt>Población</dt><dd className="num">{n(p.poblacion)} personas · {n(p.hogares)} hogares</dd>
        <dt>En zona 1º · 2º · 3º</dt><dd className="num">{n(prio.peopleByTier[0])} · {n(prio.peopleByTier[1])} · {n(prio.peopleByTier[2])}</dd>
        {live && <><dt>Con agua ahora</dt><dd className="num">{n(live.people)} personas</dd></>}
        {hasSocio && <>
          <dt>Hogares con NBI</dt><dd className="num">{pct(p.hogaresNbi, p.hogares)} ({n(p.hogaresNbi)})</dd>
          <dt>Niños ≤ 14 · mayores ≥ 65</dt><dd className="num">{n(p.menores14)} · {n(p.mayores65)}</dd>
          <dt>Sin cobertura de salud</dt><dd className="num">{pct(p.sinCobertura, p.poblacion)}</dd>
          <dt>Hacinamiento crítico</dt><dd className="num">{pct(p.hogaresHacinamiento, p.hogares)} de los hogares</dd>
          <dt>Sin cloaca · sin agua de red</dt><dd className="num">{pct(p.hogaresSinCloaca, p.hogares)} · {pct(p.hogaresSinAguaRed, p.hogares)}</dd>
          <dt>Viviendas precarias</dt><dd className="num">{n(p.viviendasPrecarias)} (rancho, casilla y similares)</dd>
          <dt>Índice de vulnerabilidad</dt><dd className="num">×{prio.ivs.toFixed(2).replace('.', ',')} (1 = promedio de la ciudad)</dd>
        </>}
      </dl>
      <p className="hint">Barrio aproximado: celdas a menos de 1,2 km del punto del barrio en OpenStreetMap. Censo repartido parejo en cada radio. Fuente: {source}.</p>
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

/**
 * Evaluación para autoridades (solo con el río en nivel de evacuación): barrios con agua en el escenario,
 * ordenados por prioridad (personas con agua × urgencia por llegada × vulnerabilidad), con las familias a
 * evaluar. No decide nada: la decisión de evacuar es de Defensa Civil.
 */
function AuthorityPanel({ rows, total, river, rainMm, simTime, defenseFails, onFocus, onClose }: {
  rows: { name: string; lon: number; lat: number; live?: ZoneLive; prio?: ZonePriority; stage: number | null }[];
  total: Profile | null; river: number; rainMm: number; simTime: number; defenseFails: boolean;
  onFocus: (lon: number, lat: number) => void; onClose: () => void;
}) {
  const list = rows.filter((r) => r.live && r.live.homes >= 5).sort((a, z) => (z.live!.score) - (a.live!.score));
  const max = list.length ? list[0].live!.score : 1;
  const n = (v: number) => `~${roughCount(v).toLocaleString('es-AR')}`;
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal auth" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Evaluación para autoridades">
        <button className="x" onClick={onClose} aria-label="Cerrar"><Icon name="close" /></button>
        <div className="auth-head">
          <i className="ea-dot big" aria-hidden="true" />
          <div>
            <small>Para autoridades · escenario hipotético</small>
            <h2>Familias a evaluar para una posible evacuación</h2>
            <p>Río a <b>{fmtStage(river)}</b> en Puerto Formosa (evacuación INA: {fmtStage(RIVER_REF.evacuation)}) · lluvia {Math.round(rainMm)} mm
              {defenseFails ? ' · con rotura de la defensa' : ''} · {simTime > 0 ? `a ${fmtTime(simTime)} de simulación` : 'situación inicial (solo río)'}.</p>
          </div>
        </div>

        {total && (
          <div className="auth-sum">
            <div><b className="num"><CountUp value={total.hogares} prefix="~" round /></b><span><House /> familias en zonas con agua</span></div>
            <div><b className="num"><CountUp value={total.poblacion} prefix="~" round /></b><span>personas</span></div>
            <div><b className="num"><CountUp value={total.menores14} prefix="~" round /></b><span>niños de hasta 14 años</span></div>
            <div><b className="num"><CountUp value={total.mayores65} prefix="~" round /></b><span>personas de 65 años o más</span></div>
            <div><b className="num"><CountUp value={total.hogaresNbi} prefix="~" round /></b><span>hogares con NBI</span></div>
          </div>
        )}

        <h3>Orden de prioridad por barrio</h3>
        {list.length ? (
          <ol className="auth-list">
            {list.map((r, k) => (
              <li key={barrioKey(r)} onClick={() => onFocus(r.lon, r.lat)}
                data-tip="Clic para ver el barrio en el mapa">
                <span className="rank num">{k + 1}</span>
                <div className="al-main">
                  <b>{r.name}</b>
                  <span>
                    <House /> <b>{n(r.live!.homes)} familias</b> con agua{r.prio ? ` de ${n(r.prio.profile.hogares)} que viven ahí` : ''} · {n(r.live!.people)} personas
                    {' '}({n(r.live!.children)} niños, {n(r.live!.elders)} mayores)
                  </span>
                  <i className="bar"><i style={{ width: `${Math.max(3, (r.live!.score / max) * 100)}%` }} /></i>
                </div>
                <div className="al-side">
                  {r.prio && <span>NBI {pct(r.prio.profile.hogaresNbi, r.prio.profile.hogares)}</span>}
                  <span>{r.stage == null ? 'solo por lluvia' : `río desde ${fmtStage(r.stage)}`}</span>
                </div>
              </li>
            ))}
          </ol>
        ) : <p className="hint">Todavía no hay barrios poblados con agua. Probá «Hacer llover».</p>}

        <p className="auth-foot">
          <b>Cómo se ordena:</b> personas con agua (Censo 2022) × urgencia (el agua que llegó antes pesa más) × vulnerabilidad (hogares con NBI, niños y mayores,
          sin cobertura de salud). <b>Familias</b> = hogares del Censo 2022, ubicados según los edificios de cada radio: es un orden de magnitud, no un padrón.
          Barrios aproximados (OpenStreetMap). <b>Es una herramienta para evaluar, no una orden:</b> la decisión de evacuar, a quiénes y cómo, es de Defensa Civil
          y de las autoridades. Rutas y centros de evacuados: Equipo 3 (Evacuaciones).
        </p>
      </div>
    </div>
  );
}

/** Ícono de casa azul (el emoji 🏠 tiene el techo rojo y el rojo se lee como calor). */
function House({ className = '' }: { className?: string }) {
  return (
    <svg className={`ico-house ${className}`} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 1.5 1 7.5h2v7h4v-4h2v4h4v-7h2z" fill="currentColor" />
    </svg>
  );
}
/** Señal de "no pasar" en azul (en lugar de ⛔, que es rojo). */
function NoPass({ big = false }: { big?: boolean }) {
  return <i className={`no-pass ${big ? 'big' : ''}`} aria-hidden="true" />;
}

/** Número que sube o baja con una animación corta (para que el público vea el cambio). */
function CountUp({ value, decimals = 0, prefix = '', suffix = '', round = false }: { value: number; decimals?: number; prefix?: string; suffix?: string; round?: boolean }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const shownRef = useRef(value);
  shownRef.current = shown;
  useEffect(() => {
    from.current = shownRef.current;
    const t0 = performance.now(), dur = 700;
    let id = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      setShown(from.current + (value - from.current) * e);
      if (k < 1) id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [value]);
  const v = round ? roughCount(shown) : shown;
  return <>{prefix}{v.toLocaleString('es-AR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{suffix}</>;
}

/** Vaso de agua: se llena con la profundidad en la calzada; la línea marca el umbral de calle intransitable. */
function WaterGauge({ depth }: { depth: number }) {
  const MAX = 0.6; // m: el vaso lleno
  const fill = Math.min(1, depth / MAX);
  return (
    <span className={`gauge ${depth >= STREET.impassable ? 'cut' : ''}`} aria-hidden="true">
      <i className="g-fill" style={{ height: `${fill * 100}%` }} />
      <i className="g-line" style={{ bottom: `${(STREET.impassable / MAX) * 100}%` }} />
    </span>
  );
}

function Stat({ label, value, sub, accent, tip }: { label: string; value: React.ReactNode; sub?: string; accent?: boolean; tip?: string }) {
  return (
    <div className={`stat ${accent ? 'accent' : ''}`} data-tip={tip}>
      <span>{label}</span>
      <b className="num">{value}</b>
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
    <span><i style={{ background: '#1a2ed9' }} />primero</span>
    <span><i style={{ background: '#3885fa' }} />después</span>
    <span><i style={{ background: '#94dbff' }} />al final</span>
  </>) });
  if (layers.priority) groups.push({ t: 'Prioridad', items: <span><i className="grad-prio" />baja → alta (personas × urgencia × vulnerabilidad)</span> });
  if (layers.zones) groups.push({ t: 'Zonas de riesgo', items: (<>
    <span><i style={{ background: '#1f33e6' }} />1º lluvia fuerte</span>
    <span><i style={{ background: '#388cff' }} />2º temporal</span>
    <span><i style={{ background: '#94dbff' }} />3º extremo</span>
  </>) });
  if (layers.drainage) groups.push({ t: 'Bocas de tormenta', items: <span><i style={{ background: '#2ec79e' }} />con red relevada (desagüe 100 %)</span> });
  if (layers.surface) groups.push({ t: 'Calzada (OSM)', items: (<>
    <span><i style={{ background: '#d1e0f2' }} />pavimentada</span>
    <span><i style={{ background: '#db8f3d' }} />de tierra</span>
    <span><i className="dashed" />sin dato</span>
  </>) });
  if (layers.lines) groups.push({ t: 'Calles', items: (<>
    <span><i style={{ background: '#8cd9ff' }} />agua sobre el cordón</span>
    <span><i className="tape" />podría quedar intransitable</span>
  </>) });
  if (layers.facilities) groups.push({ t: 'Instalaciones', items: (<>
    <span><i style={{ background: '#7b8593' }} />sin agua</span>
    <span><i style={{ background: '#8fd8ff' }} />agua cerca</span>
    <span><i style={{ background: '#3d63ff' }} />con agua (late)</span>
  </>) });
  if (!groups.length) return null;
  return (
    <div className="legend" aria-label="Referencias de colores">
            {groups.map((g) => <span key={g.t} className="lg-group"><em>{g.t}:</em>{g.items}</span>)}
    </div>
  );
}

function InfoModal({ data, validation, onClose }: {
  data: AppData | null; validation: { rows: ValidationRow[]; ranked: number } | null; onClose: () => void;
}) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="x" onClick={onClose} aria-label="Cerrar"><Icon name="close" /></button>
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

        <h3>Prioridad por población (Censo 2022)</h3>
        <ul>
          <li><b>Puntaje de cada celda</b> = personas que viven ahí × urgencia × índice de vulnerabilidad. El de un barrio es la suma de sus celdas.</li>
          <li><b>Urgencia</b> (supuesto): zona 1º ×{URGENCY[1]}, 2º ×{URGENCY[2]}, 3º ×{URGENCY[3]}. En «escenario en curso», el agua que llegó en el primer tercio del tiempo simulado ×3, en el segundo ×2 y en el último ×1.</li>
          <li><b>Índice de vulnerabilidad</b>: promedio de tres proporciones del radio censal (hogares con NBI, personas de hasta 14 o desde 65 años, personas sin obra social ni plan de salud), cada una dividida por la de toda la ciudad. 1 = promedio; se acota entre {String(IVS_MIN).replace('.', ',')} y {IVS_MAX}.</li>
          <li>Así, un barrio alejado con pocas familias que se afecta primero puede quedar por debajo de un barrio denso y vulnerable. Sirve para <b>ordenar dónde evaluar y asignar recursos</b>; la decisión es de las autoridades.</li>
        </ul>

        <h3>Supuestos declarados</h3>
        <table>
          <tbody>
            <tr><td>Cero de la escala de Puerto Formosa</td><td className="num">{ASSUMPTIONS.gaugeZero} m</td><td>Dato oficial (Gobierno de Formosa, 08/12/2015): la cota IGN 59 m equivale a 11,70 m en la escala del puerto, de donde sale el cero 47,30 m IGN. <b>A confirmar con el INA.</b> El terreno (FABDEM) usa otro dátum (EGM2008); la diferencia no está verificada.</td></tr>
            <tr><td>Coronamiento de la defensa</td><td className="num">{ASSUMPTIONS.defenseCrest} m</td><td>Dato oficial 2015: 11,70 m de escala. Traza reconstruida (~38,6 km; el dato oficial es ~15 km): los 5 tramos reales de OpenStreetMap unidos con conectores estimados que bordean la zona edificada sin cortar manzanas (al norte sigue el riacho Formosa). Es una aproximación: falta la traza oficial. La rotura simulada es una brecha de ~200 m frente al puerto.</td></tr>
            <tr><td>Desagüe + infiltración</td><td className="num">editable</td><td>{data?.drainageMeta
              ? <>Varía por zona según la red pluvial relevada ({data.drainageMeta.totalKm2} km²): con bocas de tormenta o sumideros, el 100 % del valor elegido; en el resto (solo cunetas e infiltración), el {Math.round(ASSUMPTIONS.drainNoNetwork * 100)} %. Alrededor de cada calle se toman {data.drainageMeta.radii.street} m y alrededor de cada esquina {data.drainageMeta.radii.corner} m.</>
              : 'No hay datos de la red pluvial: toda la ciudad drena igual.'} Con el río en alerta queda un {Math.round(ASSUMPTIONS.drainFactorHighRiver * 100)} % (solo bombeo).</td></tr>
            <tr><td>Agua en las calles</td><td className="num">{Math.round(STREET.share * 100)} %</td><td>En zona urbana (≥ {STREET.minBuildings} edificios por celda de ~60 m) se supone que la calzada ocupa ese porcentaje de la manzana y junta toda su agua, porque lotes y veredas están más altos. Cordón: {STREET.curb * 100} cm. Intransitable: {STREET.impassable * 100} cm.</td></tr>
            <tr><td>Subida del río</td><td className="num">~{RISE_REF.cmPerDay} cm/día</td><td>Para declarar en cuántos días se llegaría a la altura del escenario: {RISE_REF.source}. No es un pronóstico: el río puede subir más rápido o no subir.</td></tr>
            <tr><td>Rugosidad (Manning)</td><td className="num">{ASSUMPTIONS.manning}</td><td>Valor típico de llanura urbana y periurbana.</td></tr>
            {data?.thresholds && (
              <tr><td>Umbral de exposición al río</td><td className="num">estimado</td><td>Para cada celda de ~30 m, la altura mínima del río en Puerto Formosa a la que el agua del río llega por superficie («bañadera conectada»: priority-flood desde el río sobre el terreno), calculada con la <b>defensa sana</b> y <b>con la brecha</b> de ~200 m. Una instalación toma el valor más bajo de su entorno (±30 m); un barrio, la altura a la que se expone el 5 % de su superficie. Se evalúa hasta 20 m de escala. <b>No incluye lluvia, desagües, filtraciones ni tiempos de llegada</b>: indica desde qué altura del río conviene mirar cada lugar, no cuándo ni si va a pasar.</td></tr>
            )}
            <tr><td>Umbral de afectación</td><td className="num">{ASSUMPTIONS.wetThreshold * 100} cm</td><td>Agua que dificulta el tránsito y entra a veredas.</td></tr>
          </tbody>
        </table>

        <h3>Datos utilizados</h3>
        <table>
          <tbody>
            <tr><td><span className="tag tag-obs">OBSERVADO</span></td><td>Río Paraguay en Puerto Formosa: {fmtStage(RIVER_REF.observed.stage)} el {RIVER_REF.observed.date} ({RIVER_REF.observed.trend}, {RIVER_REF.observed.inaCategory}). {RIVER_REF.observed.source}.</td></tr>
            <tr><td><span className="tag tag-obs">REFERENCIA INA</span></td><td>Alerta {fmtStage(RIVER_REF.alert)} · Evacuación {fmtStage(RIVER_REF.evacuation)} (Puerto Formosa). Récord de 1983: {fmtStage(RIVER_REF.record1983)}. Escala de cinco categorías por frecuencia 1991–2020 ({INA_SCALE.join(', ')}): el INA informa la categoría de cada lectura pero no publica los límites en metros, por eso la herramienta no clasifica alturas hipotéticas. Lecturas clasificadas: {INA_CATEGORY_REF.map((r) => `${fmtStage(r.stage)} = ${r.cat} (${r.date}, ${r.source})`).join('; ')}.</td></tr>
            <tr><td><span className="tag tag-ina">PREVISIÓN INA</span></td><td>~{fmtStage(FORECAST_INA.stage)} ± {FORECAST_INA.margin.toFixed(1).replace('.', ',')} al {FORECAST_INA.until}. {FORECAST_INA.text} <a href={FORECAST_INA.url} target="_blank" rel="noreferrer">{FORECAST_INA.source}</a>. Es una <b>estimación</b>; no se integra en vivo: se actualiza a mano en <code>src/sim/scenarios.ts</code>.</td></tr>
            <tr><td><span className="tag tag-ina">ESTIMADO</span></td><td>Pronóstico de lluvia a 7 días, departamento Formosa: {RAIN_FORECAST_7D.meanMm} mm de promedio, hasta {RAIN_FORECAST_7D.maxMm} mm ({RAIN_FORECAST_7D.source}). Es un pronóstico, no una medición. El escenario «7 días» supone que el máximo cae en una sola tormenta de 3 h.</td></tr>
            <tr><td><span className="tag">TERRENO</span></td><td>{data?.meta.source}. Terreno desnudo estimado con aprendizaje automático a partir de un modelo satelital de superficie: puede quedar algún resto de edificios o árboles. Precisión vertical de 1 a 2 m en zonas planas.</td></tr>
            {data?.escuelas && <tr><td><span className="tag">REFERENCIA</span></td><td><a href={data.escuelas.url} target="_blank" rel="noreferrer">{data.escuelas.fuente}</a>: {data.escuelas.escuelas.reduce((a, e) => a + e.establecimientos.length, 0)} establecimientos activos en {data.escuelas.escuelas.length} edificios (descarga {data.escuelas.fecha}). Reemplazan a las escuelas de OpenStreetMap. Muchas ubicaciones son aproximadas.</td></tr>}
            {data?.poblacion && <tr><td><span className="tag">REFERENCIA</span></td><td><a href={data.poblacion.url} target="_blank" rel="noreferrer">{data.poblacion.fuente}</a>: {data.poblacion.radios} radios censales. Método: {data.poblacion.metodo}. Es un orden de magnitud, no un conteo.</td></tr>}
            <tr><td><span className="tag">BASE</span></td><td>{data?.osm?.source ?? 'OpenStreetMap (no cargado)'}: infraestructura (salvo escuelas), calles, riachos, barrios y edificios. Lo que está en la margen paraguaya (Alberdi) no se cuenta en los resultados.</td></tr>
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

        <h3>¿Funciona? Validación con barrios reportados con agua</h3>
        <p className="hint">Barrios que la prensa reportó con agua, comparados con lo que marca el modelo. Son pocos casos: sirve para detectar contradicciones, no es una validación estadística.</p>
        {validation ? (
          <table>
            <tbody>
              {validation.rows.map((r) => (
                <tr key={r.name}>
                  <td><b>{r.name}</b><br /><span className="hint">{r.kind === 'lluvia' ? 'por lluvia' : 'por el río'}</span></td>
                  <td>{r.event}. <a href={r.url} target="_blank" rel="noreferrer">{r.source}</a></td>
                  <td className="num">{!r.found ? 'no está en OSM' : r.tier ? `zona ${TIER_LABEL[r.tier]} · prioridad ${r.rank}º de ${validation.ranked}` : 'el modelo NO lo marca'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="hint">Se calcula cuando terminan de cargar el censo y los barrios.</p>}
        {validation && (
          <p className="hint">
            Resultado: {validation.rows.filter((r) => r.tier > 0).length} de {validation.rows.length} barrios reportados quedan dentro de las zonas 1º/2º/3º;
            {' '}{validation.rows.filter((r) => r.rank > 0 && r.rank <= validation.ranked / 2).length} quedan en la mitad superior de la lista de prioridad.
            Los que quedan abajo se muestran igual: son desacuerdos para revisar con Defensa Civil.
          </p>
        )}

        <h3>Checklist de la guía CITF (v1.1)</h3>
        <table className="checklist">
          <tbody>
            <tr><td>✔</td><td>Seleccionar un escenario hipotético de lluvias o crecida</td><td>Niveles 1º/2º/3º, 7 días, crecidas de 1983 y 2015-16, y valores a mano</td></tr>
            <tr><td>✔</td><td>Identificar sectores o infraestructuras expuestos</td><td>Barrios, calles, escuelas (padrón oficial), salud, seguridad y servicios, con la altura del río que los alcanza</td></tr>
            <tr><td>✔</td><td>Visualizar los elementos que requieren atención</td><td>Mapa 3D, mapa de calor de prioridad por población y listas ordenadas</td></tr>
            <tr><td>✔</td><td>Mostrar qué datos y supuestos se usaron</td><td>Este panel: fuentes con tipo, fecha y enlace, y cada supuesto con su valor</td></tr>
            <tr><td>✔</td><td>Indicar horizonte temporal e incertidumbre</td><td>Horizonte y «confianza baja» junto al escenario; lista de límites</td></tr>
            <tr><td>✔</td><td>Escala del INA (5 categorías) sin inventar categorías</td><td>Solo para lecturas reales; el escenario se compara con alerta y evacuación</td></tr>
            <tr><td>✔</td><td>Supuestos del escenario (cuánto sube el río, en cuántos días)</td><td>Junto al escenario, con el ritmo de subida de octubre de 2026</td></tr>
            <tr><td>✔</td><td>Distinguir observado, previsión INA y escenario</td><td>Tres etiquetas siempre visibles arriba</td></tr>
            <tr><td>✔</td><td>Censo 2022 para estimar cuántas personas viven en un sector</td><td>Personas con agua, prioridad por población y ficha de cada barrio</td></tr>
            <tr><td>✔</td><td>Zonas a evaluar, no veredictos · decisiones humanas</td><td>Textos, lista de límites y «la prioridad ordena, no decide»</td></tr>
            <tr><td>◐</td><td>MDE-Ar del IGN</td><td>Se usa FABDEM (30 m, sin edificios): el MDE-Ar no tiene descarga automática</td></tr>
          </tbody>
        </table>

        <h3>Lo que NO podemos asegurar</h3>
        <ul>
          <li>Qué manzana o casa se inunda: el error vertical del MDE es mayor que muchas diferencias de nivel de la ciudad.</li>
          <li>Tiempos reales de llegada del agua: la red pluvial está relevada solo en parte, sin diámetros ni estado de limpieza, y no conocemos el estado de las bombas. Los tiempos sirven para <b>ordenar</b>, no para planificar al minuto.</li>
          <li>Que el río suba igual en toda la costa: la escala mide un solo punto.</li>
          <li>Que la lista de infraestructura esté completa: OpenStreetMap y el padrón escolar pueden tener faltantes o ubicaciones aproximadas.</li>
          <li>El tipo de calzada: sale de la etiqueta «surface» de OpenStreetMap, cargada por voluntarios. ~13 % de las calles no tiene el dato y algunas pueden estar desactualizadas (calles pavimentadas hace poco).</li>
          <li>Cuánta gente se ve afectada: el censo se reparte parejo dentro de cada radio. Las cifras son un orden de magnitud.</li>
          <li>Horizonte temporal: los escenarios son hipotéticos e instantáneos, no un pronóstico. El pronóstico oficial es del INA y del SMN.</li>
        </ul>
      </div>
    </div>
  );
}
