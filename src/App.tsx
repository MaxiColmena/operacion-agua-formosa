import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { loadAll, type AppData, type FacilityCat } from './data/load';
import { DEFAULT_EXAG, MapScene, type Layers, type WaterMode } from './scene/MapScene';
import type { WorkerIn, WorkerOut, SimStats } from './sim/worker';
import type { Scenario } from './sim/engine';
import { ASSUMPTIONS, PRESETS, RIVER_REF, LEVELS } from './sim/scenarios';
import {
  evalBarrios, evalFacilities, evalStreets, prepareBarrios, prepareFacilities, prepareStreets,
  type BarrioInfo, type BarrioLive, type FacilityInfo, type FacilityLive, type StreetLive, type StreetSamples,
} from './analysis';
import { RunRecorder, isCritical } from './insights';
import { WelcomeGuide } from './ui/Guide';
import { TipLayer } from './ui/TipLayer';
import { fmtStage } from './ui/threshold';
import { ScenarioPanel } from './ui/ScenarioPanel';
import { FacilityCard, ResultsPanel } from './ui/ResultsPanel';
import { MapDock } from './ui/MapDock';
import { InfoModal } from './ui/InfoModal';
import { AnalyticsPanel } from './ui/AnalyticsPanel';
import { Tour } from './ui/Tour';
import { Presentation } from './ui/Presentation';
import type { DemoApi, DemoSnapshot, ResultsTab } from './ui/demo';
import { CAT_LABEL, TIER_LABEL, statusText } from './ui/format';
import { Icon } from './ui/icons';

const SIM_FACTOR = 2; // celdas de ~60 m en vivo
/** Coronamiento de la defensa expresado en la escala de Puerto Formosa (m). */
const DEFENSE_CREST_STAGE = +(ASSUMPTIONS.defenseCrest - ASSUMPTIONS.gaugeZero).toFixed(2);
const DEFAULT_LAYERS: Layers = { water: true, zones: false, drainage: false, buildings: true, lines: true, labels: true, facilities: true };

type Mode = 'welcome' | 'tour' | 'cinema' | 'free';

export default function App() {
  const [data, setData] = useState<AppData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scenario, setScenario] = useState<Scenario>(() => ({ ...LEVELS[1] }));
  const [presetId, setPresetId] = useState<string | null>('n2');
  const [stats, setStats] = useState<SimStats | null>(null);
  const [speed, setSpeed] = useState(900);
  const [layers, setLayersState] = useState<Layers>(DEFAULT_LAYERS);
  const [waterMode, setWaterMode] = useState<WaterMode>('depth');
  const [exag, setExag] = useState(DEFAULT_EXAG);
  const [tab, setTab] = useState<ResultsTab>('calles');
  const [streets, setStreets] = useState<StreetLive | null>(null);
  const [facLive, setFacLive] = useState<FacilityLive[]>([]);
  const [barLive, setBarLive] = useState<BarrioLive[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [catFilter, setCatFilter] = useState<FacilityCat | 'todas'>('todas');
  const [collapsed, setCollapsed] = useState({ left: false, right: false });
  const [bld, setBld] = useState({ wet: 0, near: 0 });
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  const [freeCam, setFreeCam] = useState({ active: false, speed: 1 });
  const [mode, setMode] = useState<Mode>('welcome');
  const [showView, setShowView] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [order, setOrder] = useState<'sim' | 'rio'>('sim');
  const [recVersion, setRecVersion] = useState(0);
  const [facilities, setFacilities] = useState<FacilityInfo[]>([]);
  const [barrios, setBarrios] = useState<BarrioInfo[]>([]);

  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<MapScene | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const simMaskRef = useRef<Uint8Array | null>(null);
  const streetRef = useRef<StreetSamples | null>(null);
  const facRef = useRef<FacilityInfo[]>([]);
  const barRef = useRef<BarrioInfo[]>([]);
  const lastEval = useRef(0);
  const recorder = useRef(new RunRecorder());
  /** Latest live values for the scripted flows (read outside React renders). */
  const live = useRef<{ stats: SimStats | null; streets: StreetLive | null; bld: { wet: number; near: number }; fac: FacilityLive[]; bar: BarrioLive[] }>(
    { stats: null, streets: null, bld: { wet: 0, near: 0 }, fac: [], bar: [] });

  const send = useCallback((m: WorkerIn) => workerRef.current?.postMessage(m), []);

  useEffect(() => { loadAll().then(setData).catch((e) => setError(String(e))); }, []);

  // Escena + worker.
  useEffect(() => {
    if (!data || !mountRef.current) return;
    const scene = new MapScene(mountRef.current, data);
    sceneRef.current = scene;
    scene.onFreeCameraChange = (s) => setFreeCam(s);
    const worker = new Worker(new URL('./sim/worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    /** Crosses the latest frame with facilities, barrios, streets and buildings (throttled to ~4 per second). */
    let pending: Extract<WorkerOut, { type: 'frame' }> | null = null;
    let trailing = 0;
    const evaluate = () => {
      const m = pending;
      if (!m) return;
      pending = null;
      lastEval.current = performance.now();
      const fl = evalFacilities(facRef.current, m.d, m.tWet, m.byRiver, ASSUMPTIONS.wetThreshold);
      const bl = evalBarrios(barRef.current, m.tWet, m.byRiver, m.d, ASSUMPTIONS.wetThreshold);
      scene.setFacilityStatus(fl.map((f) => f.status));
      scene.setBarrioLabelState(bl.map((b) => b.status));
      setFacLive(fl);
      setBarLive(bl);
      const st = streetRef.current ? evalStreets(streetRef.current, m.d) : null;
      if (st) setStreets(st);
      let wet = 0, near = 0;
      const cells = scene.buildingSimCell;
      if (cells) {
        for (let k = 0; k < cells.length; k++) { const dv = m.d[cells[k]]; if (dv >= ASSUMPTIONS.wetThreshold) wet++; else if (dv >= 0.1) near++; }
        setBld({ wet, near });
      }
      live.current = { stats: m.stats, streets: st, bld: { wet, near }, fac: fl, bar: bl };
      if (m.stats.time > 0) {
        recorder.current.push({
          t: m.stats.time, areaKm2: m.stats.areaKm2, curbKm: st?.curbKm ?? 0, impassableKm: st?.impassableKm ?? 0, buildingsWet: wet,
          facilitiesAffected: fl.filter((f) => f.status === 'afectado').length, barriosAffected: bl.filter((b) => b.status === 'afectado').length,
        }, facRef.current, fl, barRef.current, bl);
      } else recorder.current.reset();
      setRecVersion((v) => v + 1);
    };
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
        live.current.stats = m.stats;
        // The worker only posts on change, so a throttled frame gets a trailing evaluation instead of being dropped.
        pending = m;
        const since = performance.now() - lastEval.current;
        if (since > 250) { window.clearTimeout(trailing); trailing = 0; evaluate(); }
        else if (!trailing) trailing = window.setTimeout(() => { trailing = 0; evaluate(); }, 260 - since);
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
      window.clearTimeout(trailing);
      worker.terminate();
      scene.dispose();
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  useEffect(() => { send({ type: 'scenario', scenario }); send({ type: 'stopAt', seconds: (scenario.rainHours + 1) * 3600 }); }, [scenario, send]);
  useEffect(() => { send({ type: 'speed', value: speed }); }, [speed, send]);
  useEffect(() => { sceneRef.current?.setLayers(layers); }, [layers, facilities]);
  useEffect(() => { sceneRef.current?.setWaterMode(waterMode); }, [waterMode, stats === null]);
  // Exageración vertical: se aplica una vez por cuadro aunque el slider dispare muchos eventos.
  useEffect(() => {
    const id = requestAnimationFrame(() => sceneRef.current?.setExaggeration(exag));
    return () => cancelAnimationFrame(id);
  }, [exag, data]);
  const raining = !!stats && stats.time < scenario.rainHours * 3600 && stats.running;
  useEffect(() => { sceneRef.current?.setRain(scenario.rainMmH, raining); }, [raining, scenario.rainMmH]);

  const update = useCallback((patch: Partial<Scenario>) => { setPresetId(null); setScenario((s) => ({ ...s, ...patch })); }, []);
  const applyPreset = useCallback((id: string) => {
    const p = PRESETS.find((x) => x.id === id)!;
    setPresetId(id);
    setScenario({ rainMmH: p.rainMmH, rainHours: p.rainHours, riverStage: p.riverStage, drainMmH: p.drainMmH, defenseFails: p.defenseFails });
    send({ type: 'reset' });
  }, [send]);
  const patchLayers = useCallback((patch: Partial<Layers>) => setLayersState((l) => ({ ...l, ...patch })), []);
  const selectFacility = useCallback((i: number) => { setSelected(i); sceneRef.current?.focusFacility(i); }, []);
  const clearSelection = useCallback(() => { setSelected(null); sceneRef.current?.focusFacility(null); }, []);
  const focusBarrio = useCallback((lon: number, lat: number) => sceneRef.current?.focusLonLat(lon, lat), []);
  const toggleLeft = useCallback(() => setCollapsed((c) => ({ ...c, left: !c.left })), []);
  const toggleRight = useCallback(() => setCollapsed((c) => ({ ...c, right: !c.right })), []);

  const hasThr = !!data?.thresholds;
  const thrMeta = data?.thresholds?.meta;
  const crestStage = thrMeta ? +(thrMeta.defenseCrest - thrMeta.gaugeZero).toFixed(2) : DEFENSE_CREST_STAGE;
  const stageOf = (x: { stageSana: number | null; stageBrecha: number | null }) => (scenario.defenseFails ? x.stageBrecha : x.stageSana);

  /** Imperative API for the guided tour and the presentation. */
  const demo = useMemo<DemoApi>(() => ({
    scene: () => sceneRef.current,
    applyPreset,
    play: () => send({ type: 'play' }),
    pause: () => send({ type: 'pause' }),
    reset: () => send({ type: 'reset' }),
    setSpeed,
    setTab,
    setLayers: patchLayers,
    setWaterMode,
    setAnalytics,
    setViewMenu: setShowView,
    setPanels: (v) => setCollapsed((c) => ({ left: v.left ?? c.left, right: v.right ?? c.right })),
    selectWorstFacility: () => {
      const fl = live.current.fac;
      let best = -1;
      fl.forEach((f, i) => { if (f.status !== 'seco' && (best < 0 || f.depth > fl[best].depth)) best = i; });
      if (best < 0) best = facRef.current.findIndex((f) => f.cat === 'hospital');
      if (best < 0) return false;
      setTab('infra');
      selectFacility(best);
      return true;
    },
    clearSelection,
    frame: (lon, lat, off) => {
      const sc = sceneRef.current;
      if (!sc) return;
      const t = sc.lonLatToWorld(lon, lat);
      sc.flyTo(t, t.clone().add(new THREE.Vector3(...off)));
    },
    snapshot: (): DemoSnapshot => {
      const l = live.current;
      const fac = facRef.current;
      let worst: string | null = null, wd = 0;
      l.fac.forEach((f, i) => { if (f.status === 'afectado' && f.depth > wd && fac[i] && !fac[i].name.startsWith('(')) { wd = f.depth; worst = fac[i].name; } });
      return {
        simSeconds: l.stats?.time ?? 0, finished: !!l.stats?.finished,
        curbKm: l.streets?.curbKm ?? 0, impassableKm: l.streets?.impassableKm ?? 0, buildingsWet: l.bld.wet, areaKm2: l.stats?.areaKm2 ?? 0,
        facilitiesAffected: l.fac.filter((f) => f.status === 'afectado').length,
        criticalAffected: l.fac.filter((f, i) => f.status === 'afectado' && fac[i] && isCritical(fac[i].cat)).length,
        barriosAffected: l.bar.filter((b) => b.status === 'afectado').length,
        worstFacility: worst,
      };
    },
  }), [applyPreset, send, patchLayers, selectFacility, clearSelection]);

  const exitFlow = useCallback(() => setMode('free'), []);
  const startPresentation = useCallback(() => { setAnalytics(false); setShowInfo(false); setMode('cinema'); }, []);
  const focusFacilityByName = useCallback((name: string) => {
    const i = facRef.current.findIndex((f) => f.name === name);
    if (i >= 0) { setTab('infra'); selectFacility(i); }
  }, [selectFacility]);

  if (error) return <div className="fatal">No se pudieron cargar los datos: {error}</div>;

  const sel = selected != null ? facilities[selected] : null;
  const ready = !!data && facilities.length > 0;

  return (
    <div className={`app ${mode === 'cinema' ? 'is-cinema' : ''} ${collapsed.left ? 'l-collapsed' : ''} ${collapsed.right ? 'r-collapsed' : ''}`}>
      <div ref={mountRef} className="viewport" />
      {!data && <div className="loading"><div className="spinner" />Cargando el terreno de Formosa…</div>}

      <header className="topbar">
        <div className="brand">
          <span className="brand-mark"><Icon name="logo" size={22} /></span>
          <div>
            <h1>Operación Agua</h1>
            <p>Lluvia y crecida · Formosa Capital</p>
          </div>
        </div>
        <div className="river-now" data-tip={`Altura real del río Paraguay medida en Puerto Formosa (${RIVER_REF.observed.trend}). Categoría según la escala del INA. Fuente: ${RIVER_REF.observed.source}.`}>
          <span className="badge badge-obs">Observado</span>
          <span>Río hoy <b className="mono">{fmtStage(RIVER_REF.observed.stage)}</b> · {RIVER_REF.observed.inaCategory} · {RIVER_REF.observed.date}</span>
          <a href="https://alerta.ina.gob.ar/a5/secciones" target="_blank" rel="noreferrer" className="ina-link"
            data-tip="Abre el pronóstico oficial del INA en otra pestaña. No se carga automáticamente aquí.">Previsión INA<Icon name="external" size={13} /></a>
        </div>
        <nav className="nav" aria-label="Herramientas">
          <button className="nav-btn" onClick={() => setMode('tour')} disabled={!ready} data-tip="Recorrido automático por todas las funciones"><Icon name="tour" />Recorrido</button>
          <button className="nav-btn" onClick={startPresentation} disabled={!ready} data-tip="Vuelo cinematográfico de la maqueta 3D, con opción de grabar video"><Icon name="film" />Presentación</button>
          <button className={`nav-btn ${analytics ? 'on' : ''}`} aria-pressed={analytics} onClick={() => setAnalytics((v) => !v)} disabled={!ready} data-tip="Prioridades, márgenes del río y curvas de la simulación"><Icon name="chart" />Análisis</button>
          <button className="nav-btn" onClick={() => setShowInfo(true)} data-tour="assumptions" data-tip="Qué datos usamos, qué suponemos y qué NO podemos asegurar"><Icon name="info" />Supuestos</button>
        </nav>
      </header>

      <ScenarioPanel
        scenario={scenario} presetId={presetId} hasDrainage={!!data?.drainage} stats={stats} raining={raining} speed={speed}
        crestStage={DEFENSE_CREST_STAGE} collapsed={collapsed.left} loading={!data} onCollapse={toggleLeft}
        onPreset={applyPreset} onUpdate={update} onPlay={() => send({ type: 'play' })} onPause={() => send({ type: 'pause' })}
        onReset={() => send({ type: 'reset' })} onSpeed={setSpeed}
      />

      <ResultsPanel
        stats={stats} streets={streets} bld={bld} totalBuildings={data?.buildings?.count ?? 0}
        facilities={facilities} facLive={facLive} barrios={barrios} barLive={barLive}
        tab={tab} onTab={setTab} order={order} onOrder={setOrder} catFilter={catFilter} onCatFilter={setCatFilter}
        hasThr={hasThr} river={scenario.riverStage} breach={scenario.defenseFails} selected={selected}
        onSelectFacility={selectFacility} onFocusBarrio={focusBarrio} collapsed={collapsed.right} onCollapse={toggleRight}
      />

      {hover && facilities[hover.i] && (
        <div className="tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          <small>{CAT_LABEL[facilities[hover.i].cat]}</small>
          <b>{facilities[hover.i].name}</b>
          <span>{statusText(facLive[hover.i])}{facilities[hover.i].tier ? ` · nivel ${TIER_LABEL[facilities[hover.i].tier]}` : ''}
            {hasThr ? (stageOf(facilities[hover.i]) == null ? ' · el río no llega' : ` · río a ${fmtStage(stageOf(facilities[hover.i]))}`) : ''}</span>
        </div>
      )}

      {sel && (
        <FacilityCard f={sel} live={selected != null ? facLive[selected] ?? null : null} hasThr={hasThr} crest={crestStage}
          river={scenario.riverStage} breach={scenario.defenseFails} onClose={clearSelection} />
      )}

      <MapDock
        layers={layers} onLayers={patchLayers} hasDrainage={!!data?.drainage} waterMode={waterMode} onWaterMode={setWaterMode}
        viewOpen={showView} onViewOpen={setShowView} exag={exag} onExag={setExag}
        freeCam={freeCam.active} onFreeCam={() => sceneRef.current?.setFreeCamera(!freeCam.active)}
      />

      <AnalyticsPanel
        open={analytics} onClose={() => setAnalytics(false)} facilities={facilities} facLive={facLive} barrios={barrios} barLive={barLive}
        streets={streets} recorder={recorder.current} version={recVersion} river={scenario.riverStage} breach={scenario.defenseFails}
        crest={crestStage} zonesMeta={data?.zonesMeta ?? null} hasThresholds={hasThr} onFocusFacility={focusFacilityByName}
      />

      {freeCam.active && (
        <div className="freecam-help" role="status">
          <b>Cámara libre · velocidad ×{freeCam.speed.toFixed(2).replace(/\.?0+$/, '')}</b>
          <span>WASD / flechas: mover · Q/E: bajar/subir · Shift: rápido · arrastrar: mirar · rueda: velocidad · F o Esc: salir</span>
        </div>
      )}

      {showInfo && <InfoModal data={data} onClose={() => setShowInfo(false)} />}
      {mode === 'welcome' && (
        <WelcomeGuide ready={ready} onStart={() => setMode('tour')} onSkip={exitFlow} onPresent={startPresentation} />
      )}
      {mode === 'tour' && ready && <Tour api={demo} onExit={exitFlow} onPresent={startPresentation} />}
      {mode === 'cinema' && ready && <Presentation api={demo} onExit={exitFlow} />}
      {mode !== 'cinema' && <TipLayer />}
    </div>
  );
}
