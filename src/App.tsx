import { useEffect, useMemo, useRef, useState } from 'react';
import { loadAll, type AppData, type FacilityCat } from './data/load';
import { DEFAULT_EXAG, EXAG_MAX, EXAG_MIN, MapScene, type Layers, type WaterMode } from './scene/MapScene';
import type { WorkerIn, WorkerOut, SimStats } from './sim/worker';
import type { Scenario } from './sim/engine';
import { ASSUMPTIONS, PRESETS, RIVER_REF, LEVELS, STREET, FORECAST_INA, CATEGORIES_INA, UNCERTAINTY, RISE_REF, daysToRise } from './sim/scenarios';
import { longitudKm } from './sim/defensa-formosa';
import {
  computeExposure, evalBarrios, evalFacilities, evalStreets, fmtStage, fmtTime, prepareBarrios,
  prepareFacilities, prepareStreets,
  type BarrioInfo, type BarrioLive, type FacilityInfo, type FacilityLive, type StreetLive,
  type StreetSamples, type Tier,
} from './analysis';
import {
  censusToSim, exposedProfile, groupLive, groupPriority, heatValues, pct, priorityCells, roughCount, simTiers,
  vulnerabilityShares, IVS_MAX, IVS_MIN, URGENCY,
  type CensusGrid, type Profile, type ZoneLive, type ZonePriority,
} from './priority';
import { validate, type ValidationRow } from './validation';

const SIM_FACTOR = 2; // celdas de ~60 m en vivo

const CAT_LABEL: Record<FacilityCat, string> = {
  hospital: 'Hospital', salud: 'Salud', escuela: 'Escuela', seguridad: 'Bomberos / Policía',
  servicios: 'Agua / Energía', refugio: 'Refugio / Municipio', transporte: 'Transporte',
};
const CAT_ICON: Record<FacilityCat, string> = {
  hospital: '✚', salud: '+', escuela: '▲', seguridad: '◆', servicios: '⚡', refugio: '⌂', transporte: '✈',
};
const TIER_LABEL = ['—', '1º', '2º', '3º'];
/** Rango del control del río (m en la escala de Puerto Formosa). */
const RIVER_MIN = 1.5, RIVER_MAX = 12.5;
const fmtM = (v: number) => v.toFixed(2).replace('.', ',');

export default function App() {
  const [data, setData] = useState<AppData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scenario, setScenario] = useState<Scenario>(() => ({ ...LEVELS[1] }));
  const [presetId, setPresetId] = useState<string | null>('n2');
  const [stats, setStats] = useState<SimStats | null>(null);
  const [speed, setSpeed] = useState(900);
  const [layers, setLayers] = useState<Layers>({ water: true, zones: false, buildings: true, lines: true, labels: true, facilities: true, priority: true });
  const [waterMode, setWaterMode] = useState<WaterMode>('depth');
  const [exag, setExag] = useState(DEFAULT_EXAG);
  const [tab, setTab] = useState<'prioridad' | 'barrios' | 'infra' | 'calles'>('prioridad');
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
  const [pop, setPop] = useState<Profile | null>(null);
  const cgRef = useRef<CensusGrid | null>(null);
  const [census, setCensus] = useState<CensusGrid | null>(null);
  const [barPrio, setBarPrio] = useState<ZonePriority[]>([]);
  const [barPrioLive, setBarPrioLive] = useState<ZoneLive[]>([]);
  const [prioMode, setPrioMode] = useState<'plan' | 'escenario'>('plan');
  const [selBarrio, setSelBarrio] = useState<number | null>(null);
  const [infraSort, setInfraSort] = useState<'llegada' | 'rio'>('llegada');

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
        // Umbral de exposición al río (priority-flood sobre la grilla de 30 m, con y sin defensa).
        const exposure = computeExposure(data, ASSUMPTIONS.gaugeZero, ASSUMPTIONS.defenseCrest);
        facRef.current = prepareFacilities(data, info, exposure);
        barRef.current = prepareBarrios(data, info);
        // Prioridad por población (Censo 2022): personas × urgencia (zona 1º/2º/3º) × vulnerabilidad.
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
          scene.setBarrioLabelState(bl.map((b) => b.status));
          setFacLive(fl);
          setBarLive(bl);
          if (streetRef.current) setStreets(evalStreets(streetRef.current, m.d));
          const cg = cgRef.current;
          if (cg) {
            setPop(exposedProfile(cg, m.d, ASSUMPTIONS.wetThreshold));
            setBarPrioLive(groupLive(barRef.current.map((b) => b.cells), cg, m.d, m.tWet, m.byRiver, ASSUMPTIONS.wetThreshold, m.stats.time));
          }
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
      mask: data.mask, factor: SIM_FACTOR, scenario, assumptions: ASSUMPTIONS,
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

  const barrioRows = useMemo(() => barrios.map((b, i) => ({ b, l: barLive[i], i }))
    .sort((a, z) => rank(a.l?.firstAffected, a.b.tier) - rank(z.l?.firstAffected, z.b.tier)), [barrios, barLive]);
  // Orden de prioridad de los barrios: en el plan (zonas 1º/2º/3º) o en el escenario que se está simulando.
  const prioRows = useMemo(() => barrios.map((b, i) => ({ b, i, p: barPrio[i], l: barPrioLive[i] }))
    .filter((r) => r.p && (prioMode === 'plan' ? r.p.score > 0 : (r.l?.score ?? 0) > 0))
    .sort((a, z) => (prioMode === 'plan' ? z.p.score - a.p.score : (z.l?.score ?? 0) - (a.l?.score ?? 0))),
  [barrios, barPrio, barPrioLive, prioMode]);
  const prioMax = prioRows.length ? (prioMode === 'plan' ? prioRows[0].p.score : prioRows[0].l?.score ?? 1) : 1;
  const stageOf = (f: FacilityInfo) => (scenario.defenseFails ? f.riverStageFail : f.riverStage);
  const facRows = useMemo(() => facilities.map((f, i) => ({ f, l: facLive[i], i }))
    .filter((r) => catFilter === 'todas' || r.f.cat === catFilter)
    .sort((a, z) => infraSort === 'rio'
      ? stageOf(a.f) - stageOf(z.f)
      : rank(a.l?.firstWet, a.f.tier) - rank(z.l?.firstWet, z.f.tier)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [facilities, facLive, catFilter, infraSort, scenario.defenseFails]);
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
  // El escenario se compara solo con los umbrales oficiales del INA: no se inventan categorías.
  const riverRel = scenario.riverStage >= RIVER_REF.evacuation ? 'supera la evacuación INA (8,30 m)'
    : scenario.riverStage >= RIVER_REF.alert ? 'supera la alerta INA (7,80 m)' : 'debajo de la alerta INA (7,80 m)';
  const sel = selected != null ? facilities[selected] : null;
  const selLive = selected != null ? facLive[selected] : null;

  return (
    <div className="app">
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
          <a className="tag tag-obs" href={RIVER_REF.observed.url} target="_blank" rel="noreferrer" title={RIVER_REF.observed.source}>
            OBSERVADO · {fmtM(RIVER_REF.observed.stage)} m · {RIVER_REF.observed.categoryINA} · INA {RIVER_REF.observed.date}
          </a>
          <a className="tag tag-ina" href={FORECAST_INA.url} target="_blank" rel="noreferrer" title={`${FORECAST_INA.text} ${FORECAST_INA.source}`}>
            PREVISIÓN INA · ~{fmtM(FORECAST_INA.stage)} m ± {FORECAST_INA.margin.toFixed(1).replace('.', ',')} al {FORECAST_INA.until.slice(0, 5)}
          </a>
          <span className={`tag tag-user river-${riverCat}`} title="Escenario hipotético elegido por el usuario: no es un pronóstico">
            ESCENARIO DEL USUARIO · río {fmtM(scenario.riverStage)} m · {riverRel}
          </span>
        </div>
      </header>

      <aside className={`panel left ${collapsed.left ? 'collapsed' : ''}`}>
        <button className="collapse" onClick={() => setCollapsed((c) => ({ ...c, left: !c.left }))} title="Mostrar u ocultar">{collapsed.left ? '›' : '‹'}</button>
        <h2>Escenario</h2>
        <div className="presets">
          {PRESETS.map((p) => (
            <button key={p.id} className={`preset ${presetId === p.id ? 'on' : ''} lvl-${p.id}`} onClick={() => applyPreset(p.id)}>
              <b>{p.short}</b><span>{p.label}</span>
            </button>
          ))}
        </div>
        {preset && <p className="why">{preset.why}</p>}
        <p className="why assumption">
          <b>Supuesto del escenario:</b> {scenario.riverStage > RIVER_REF.observed.stage + 0.05 ? <>el río sube de {fmtM(RIVER_REF.observed.stage)} m (hoy) a {fmtM(scenario.riverStage)} m en ~{daysToRise(scenario.riverStage, RIVER_REF.observed.stage)} días (ritmo de oct. 2026, ~{RISE_REF.cmPerDay} cm/día) y se mantiene ahí;</> : <>el río se mantiene en {fmtM(scenario.riverStage)} m;</>} sobre ese río llueven{' '}
          {(scenario.rainMmH * scenario.rainHours).toFixed(0)} mm en {fmtHours(scenario.rainHours)}. Horizonte: {fmtHours(scenario.rainHours + 1)} simuladas.
          Hipotético, no es un pronóstico · confianza baja.
        </p>

        <section>
          <label className="row"><span>Lluvia</span><b className="mono">{scenario.rainMmH} mm/h</b></label>
          <input type="range" min={0} max={200} step={5} value={scenario.rainMmH} onChange={(e) => update({ rainMmH: +e.target.value })} />
          <div className="permin">
            <input
              type="number" min={0} max={3.33} step={0.05} value={+rainMmMin.toFixed(2)}
              onChange={(e) => update({ rainMmH: Math.max(0, Math.min(200, Math.round(+e.target.value * 60))) })}
            />
            <span>mm por minuto = litros por m² por minuto</span>
          </div>
          <label className="row"><span>Duración</span><b className="mono">{fmtHours(scenario.rainHours)}</b></label>
          <input type="range" min={0.25} max={6} step={0.25} value={scenario.rainHours} onChange={(e) => update({ rainHours: +e.target.value })} />
          <div className="hint mono">Total: {(scenario.rainMmH * scenario.rainHours).toFixed(0)} mm ({(scenario.rainMmH * scenario.rainHours).toFixed(0)} L/m²)</div>
        </section>

        <section>
          <label className="row"><span>Río Paraguay · Puerto Formosa</span><b className={`mono river-${riverCat}`}>{scenario.riverStage.toFixed(2)} m</b></label>
          <input type="range" min={RIVER_MIN} max={RIVER_MAX} step={0.05} value={scenario.riverStage} onChange={(e) => update({ riverStage: +e.target.value })} />
          <div className="scale">
            {[
              { v: RIVER_REF.observed.stage, t: 'hoy' },
              { v: RIVER_REF.alert, t: 'alerta' },
              { v: RIVER_REF.evacuation, t: 'evac.' },
              { v: RIVER_REF.record1983, t: '1983' },
              { v: RIVER_REF.defenseStage, t: 'defensa' },
            ].map((m) => (
              <button key={m.t} style={{ left: `${((m.v - RIVER_MIN) / (RIVER_MAX - RIVER_MIN)) * 100}%` }} onClick={() => update({ riverStage: m.v })} title={`${m.v} m`}>
                <i />{m.t}
              </button>
            ))}
          </div>
          <div className="hint">Cota supuesta del agua: {(ASSUMPTIONS.gaugeZero + scenario.riverStage).toFixed(1)} m IGN (cero de la escala {ASSUMPTIONS.gaugeZero.toFixed(2)} m). Cambiar el río reinicia la simulación.</div>
        </section>

        <section>
          <label className="row"><span>Desagüe + infiltración</span><b className="mono">{scenario.drainMmH} mm/h</b></label>
          <input type="range" min={0} max={40} step={1} value={scenario.drainMmH} onChange={(e) => update({ drainMmH: +e.target.value })} />
          {scenario.riverStage >= ASSUMPTIONS.alertStage && (
            <div className="hint warn">Río en alerta o más: se supone que el desagüe por gravedad se corta y solo queda el bombeo ({Math.round(ASSUMPTIONS.drainFactorHighRiver * 100)} %).</div>
          )}
          <label className="check">
            <input type="checkbox" checked={scenario.defenseFails} onChange={(e) => update({ defenseFails: e.target.checked })} />
            Falla de la línea de defensa
          </label>
          <div className="hint">Anillo aproximado de {longitudKm().toFixed(1)} km (5 tramos de OSM + conectores estimados). Coronamiento oficial: {fmtM(RIVER_REF.defenseStage)} m en la escala (cota IGN 59 m, Gobierno de Formosa 2015).</div>
        </section>

        <div className="controls">
          {stats?.running ? (
            <button className="btn primary" onClick={() => send({ type: 'pause' })}>❚❚ Pausar</button>
          ) : (
            <button className="btn primary" onClick={() => send({ type: 'play' })}>▶ {stats && stats.time > 0 && !stats.finished ? 'Seguir' : 'Hacer llover'}</button>
          )}
          <button className="btn" onClick={() => send({ type: 'reset' })}>↺ Reiniciar</button>
          <select value={speed} onChange={(e) => setSpeed(+e.target.value)} title="Velocidad de la simulación">
            <option value={300}>5 min/s</option>
            <option value={900}>15 min/s</option>
            <option value={1800}>30 min/s</option>
          </select>
        </div>
        <div className="timeline">
          <div className="bar"><i style={{ width: `${Math.min(100, ((stats?.time ?? 0) / totalSeconds) * 100)}%` }} /><em style={{ left: `${(scenario.rainHours / (scenario.rainHours + 1)) * 100}%` }} /></div>
          <div className="row mono small"><span>{fmtTime(stats?.time ?? 0).replace('t=0 (río)', '0 min')}</span><span>{raining ? 'lloviendo' : stats?.finished ? 'fin' : stats && stats.time > scenario.rainHours * 3600 ? 'escurriendo' : ''}</span><span>{fmtHours(scenario.rainHours + 1)}</span></div>
        </div>
      </aside>

      <aside className={`panel right ${collapsed.right ? 'collapsed' : ''}`}>
        <button className="collapse" onClick={() => setCollapsed((c) => ({ ...c, right: !c.right }))} title="Mostrar u ocultar">{collapsed.right ? '‹' : '›'}</button>
        <div className="stats">
          <Stat label="Tiempo simulado" value={fmtTime(stats?.time ?? 0).replace('t=0 (río)', '0 min')} />
          <Stat label="Lluvia caída" value={`${(stats?.rainMm ?? 0).toFixed(0)} mm`} />
          <Stat label="Calles con agua sobre el cordón" value={`${(streets?.curbKm ?? 0).toFixed(1)} km`} sub={`${(streets?.impassableKm ?? 0).toFixed(1)} km intransitables`} accent />
          <Stat label="Edificios con agua ≥ 15 cm" value={bld.wet.toLocaleString('es-AR')} sub={`${bld.near.toLocaleString('es-AR')} con agua cerca · de ${(data?.buildings?.count ?? 0).toLocaleString('es-AR')}`} accent />
          <Stat label="Área con agua ≥ 15 cm" value={`${(stats?.areaKm2 ?? 0).toFixed(1)} km²`} sub="estimado" />
          {census && (
            <Stat label="Personas en zonas con agua" value={`~${roughCount(pop?.poblacion ?? 0).toLocaleString('es-AR')}`}
              sub={census.hasSocio && pop
                ? `~${roughCount(pop.menores14).toLocaleString('es-AR')} niños ≤ 14 · ~${roughCount(pop.mayores65).toLocaleString('es-AR')} mayores ≥ 65 · ~${roughCount(pop.hogaresNbi).toLocaleString('es-AR')} hogares con NBI · Censo 2022`
                : 'Censo 2022, orden de magnitud'} accent />
          )}
          <Stat label="Instalaciones" value={`${affectedCounts.afectado}`} sub={`afectadas · ${affectedCounts.atencion} en atención`} accent />
        </div>

        <div className="tabs">
          <button className={tab === 'prioridad' ? 'on' : ''} onClick={() => setTab('prioridad')} title="Barrios ordenados por población, vulnerabilidad y orden de afectación">Prioridad</button>
          <button className={tab === 'calles' ? 'on' : ''} onClick={() => setTab('calles')}>Calles</button>
          <button className={tab === 'barrios' ? 'on' : ''} onClick={() => setTab('barrios')}>Barrios ({barrios.length})</button>
          <button className={tab === 'infra' ? 'on' : ''} onClick={() => setTab('infra')}>Infra ({facilities.length})</button>
        </div>
        {tab === 'calles' ? (
          <div className="street-sum">
            <div><b className="mono">{(streets?.wetKm ?? 0).toFixed(1)}</b><span>km con agua en la calzada (≥ {STREET.wet * 100} cm)</span></div>
            <div className="c2"><b className="mono">{(streets?.curbKm ?? 0).toFixed(1)}</b><span>km con agua sobre el cordón (≥ {STREET.curb * 100} cm)</span></div>
            <div className="c3"><b className="mono">{(streets?.impassableKm ?? 0).toFixed(1)}</b><span>km intransitables (≥ {STREET.impassable * 100} cm)</span></div>
            <div className="c4"><b className="mono">{(streets?.dirtCurbKm ?? 0).toFixed(1)}</b><span>km de calles de tierra sobre el cordón</span></div>
            <p className="list-help">Calles con más kilómetros de agua sobre el cordón. Profundidad estimada: en zona urbana se supone que el agua de la manzana se junta en la calzada.</p>
          </div>
        ) : tab === 'prioridad' ? (
          <div className="prio-help">
            <div className="filters sort">
              <button className={prioMode === 'plan' ? 'on' : ''} onClick={() => setPrioMode('plan')} title="Zonas 1º, 2º y 3º precalculadas: sirve para planificar recursos">Plan (zonas 1º·2º·3º)</button>
              <button className={prioMode === 'escenario' ? 'on' : ''} onClick={() => setPrioMode('escenario')} title="Agua de la simulación en curso">Escenario en curso</button>
            </div>
            <p className="list-help">
              <b>Dónde actuar primero.</b> Puntaje = <b>personas</b> (Censo 2022) × <b>urgencia</b> ({prioMode === 'plan' ? `zona 1º ×${URGENCY[1]} · 2º ×${URGENCY[2]} · 3º ×${URGENCY[3]}` : 'agua que llegó antes ×3 · después ×2 · al final ×1'}) × <b>vulnerabilidad</b> (NBI, niños y mayores, sin cobertura de salud; 1 = promedio de la ciudad).
              Un barrio chico que se afecta primero puede quedar abajo de uno denso y vulnerable. Ordena la evaluación: <b>no decide</b>.
            </p>
            {!census?.hasSocio && <p className="list-help warn">Falta el detalle sociodemográfico: se usa solo la población.</p>}
          </div>
        ) : (
        <p className="list-help">Orden de afectación en esta simulación. <b>Nivel</b> = en qué escenario de referencia se afecta primero (1º lluvia fuerte · 2º temporal severo · 3º extremo).</p>
        )}

        {tab === 'infra' && (
          <div className="filters sort">
            <span>Ordenar por</span>
            <button className={infraSort === 'llegada' ? 'on' : ''} onClick={() => setInfraSort('llegada')}>llegada del agua</button>
            <button className={infraSort === 'rio' ? 'on' : ''} onClick={() => setInfraSort('rio')} title="Altura del río desde la que queda conectada al agua">nivel del río que la alcanza</button>
          </div>
        )}
        {tab === 'infra' && (
          <div className="filters">
            {(['todas', 'hospital', 'salud', 'escuela', 'seguridad', 'servicios', 'refugio'] as const).map((c) => (
              <button key={c} className={catFilter === c ? 'on' : ''} onClick={() => setCatFilter(c)}>{c === 'todas' ? 'Todas' : CAT_LABEL[c]}</button>
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
                <span className="rank mono">{k + 1}</span>
                <div className="li-main">
                  <b>{b.name}</b>
                  <span>~{roughCount(people).toLocaleString('es-AR')} personas {prioMode === 'plan' ? 'en zonas 1º-3º' : 'con agua'} · NBI {Math.round(nbi * 100)} % · vuln. ×{p.ivs.toFixed(2).replace('.', ',')}</span>
                  <i className="bar"><i style={{ width: `${Math.max(3, (score / prioMax) * 100)}%` }} /></i>
                </div>
                <TierBadge t={b.tier} />
              </li>
            );
          })}
          {tab === 'prioridad' && !prioRows.length && <li className="empty">{prioMode === 'plan' ? 'Sin datos del censo o de las zonas.' : 'Todavía no hay agua en barrios poblados. Probá "Hacer llover".'}</li>}
          {tab === 'barrios' && barrioRows.map(({ b, l, i }) => (
            <li key={i} className={`st-${l?.status ?? 'seco'}`} onClick={() => { setSelBarrio(i); setSelected(null); sceneRef.current?.focusLonLat(b.lon, b.lat); }}>
              <TierBadge t={b.tier} />
              <div className="li-main"><b>{b.name}</b><span>{l ? `${Math.round(l.share * 100)} % con agua` : ''}</span></div>
              <span className="mono time">{fmtTime(l?.firstAffected ?? -1)}</span>
            </li>
          ))}
          {tab === 'infra' && facRows.map(({ f, l, i }) => (
            <li key={f.id} className={`st-${l?.status ?? 'seco'} ${selected === i ? 'sel' : ''}`} onClick={() => { setSelected(i); sceneRef.current?.focusFacility(i); }}>
              <TierBadge t={f.tier} />
              <div className="li-main"><b><span className="icon">{CAT_ICON[f.cat]}</span>{f.name}</b><span>{CAT_LABEL[f.cat]}{l && l.status !== 'seco' ? ` · ${(l.depth * 100).toFixed(0)} cm` : ''} · {f.inside ? 'dentro' : 'fuera'} de la defensa</span></div>
              <span className="mono time">{infraSort === 'rio' ? shortStage(stageOf(f)) : fmtTime(l?.firstWet ?? -1)}</span>
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
          <span>{statusText(facLive[hover.i])}{facilities[hover.i].tier ? ` · nivel ${TIER_LABEL[facilities[hover.i].tier]}` : ''}</span>
          <span>{fmtStage(stageOf(facilities[hover.i]))}</span>
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
          <button className="x" onClick={() => { setSelected(null); sceneRef.current?.focusFacility(null); }}>×</button>
          <small>{CAT_LABEL[sel.cat]}</small>
          <h3>{sel.name}</h3>
          <dl>
            <dt>Estado ahora</dt><dd className={`st-${selLive?.status}`}>{statusText(selLive)}</dd>
            <dt>Agua máx. cerca (±60 m)</dt><dd className="mono">{selLive ? `${(selLive.depth * 100).toFixed(0)} cm` : '—'}</dd>
            <dt>Primer contacto con agua</dt><dd className="mono">{fmtTime(selLive?.firstWet ?? -1)}{selLive?.byRiver ? ' · por el río' : ''}</dd>
            <dt>Nivel de referencia</dt><dd>{sel.tier ? `${TIER_LABEL[sel.tier]} (${LEVELS[sel.tier - 1].label})${sel.tierByRiver ? ' · por el río' : ''}` : 'No se afecta en los 3 escenarios'}</dd>
            <dt>Umbral de exposición al río</dt><dd className="mono">{fmtStage(sel.riverStage)}{Number.isFinite(sel.riverStageFail) && sel.riverStageFail < sel.riverStage - 0.05 ? ` · con falla de defensa: ${fmtM(sel.riverStageFail)} m` : ''}</dd>
            <dt>Defensa</dt><dd>{sel.inside ? 'Dentro del anillo' : 'Fuera del anillo'} (traza aproximada)</dd>
          </dl>
          {sel.detail && <p className="hint">{sel.detail}</p>}
          <p className="hint">Zona a evaluar, no veredicto: el MDE tiene 1 a 2 m de error vertical. Fuente: {sel.source ?? 'OpenStreetMap'}.</p>
        </div>
      )}

      <footer className="dock">
        <div className="layers">
          <Toggle on={layers.water} onClick={() => setLayers({ ...layers, water: !layers.water })}>Agua en vivo</Toggle>
          <Toggle on={layers.priority} onClick={() => setLayers({ ...layers, priority: !layers.priority })}>Prioridad (población)</Toggle>
          <Toggle on={layers.zones} onClick={() => setLayers({ ...layers, zones: !layers.zones })}>Zonas 1º · 2º · 3º</Toggle>
          <Toggle on={layers.buildings} onClick={() => setLayers({ ...layers, buildings: !layers.buildings })}>Edificios</Toggle>
          <Toggle on={layers.lines} onClick={() => setLayers({ ...layers, lines: !layers.lines })}>Calles y riachos</Toggle>
          <Toggle on={layers.facilities} onClick={() => setLayers({ ...layers, facilities: !layers.facilities })}>Instalaciones</Toggle>
          <Toggle on={layers.labels} onClick={() => setLayers({ ...layers, labels: !layers.labels })}>Nombres</Toggle>
          <label className="exag" title="Exageración vertical: Formosa es casi plana; 1× es la escala real">
            <span>Relieve ×{exag}</span>
            <input type="range" min={EXAG_MIN} max={EXAG_MAX} step={1} value={exag} onChange={(e) => setExag(Number(e.target.value))}
              aria-label="Exageración vertical del relieve" />
          </label>
          <button className={`toggle freecam-btn ${freeCam.active ? 'on' : ''}`} title="Navegar como un dron (tecla F)"
            onClick={(e) => { e.currentTarget.blur(); sceneRef.current?.setFreeCamera(!freeCam.active); }}>
            ✈ Cámara libre
          </button>
          <span className="sep" />
          <Toggle on={waterMode === 'order'} onClick={() => setWaterMode(waterMode === 'order' ? 'depth' : 'order')}>Color: {waterMode === 'order' ? 'orden de llegada' : 'profundidad'}</Toggle>
          <button className="btn ghost" onClick={() => setShowInfo(true)}>ⓘ Supuestos, datos y límites</button>
        </div>
        <Legend layers={layers} mode={waterMode} />
      </footer>

      {freeCam.active && (
        <div className="freecam-help" role="status">
          <div><b>Cámara libre</b> · velocidad ×{freeCam.speed.toFixed(2).replace(/\.?0+$/, '')}</div>
          <span>WASD / flechas: mover · Q/E: bajar/subir · Shift: rápido · arrastrar: mirar · rueda: velocidad · F o Esc: salir</span>
        </div>
      )}

      {showInfo && <InfoModal data={data} validation={barPrio.length ? validate(barrios, barPrio.map((x) => x.score)) : null} onClose={() => setShowInfo(false)} />}
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
      <button className="x" onClick={onClose}>×</button>
      <small>Barrio · perfil del Censo 2022</small>
      <h3>{name}</h3>
      <p className="prio-rank">{prio.score > 0 ? <>Prioridad <b>{rank}º</b> de {ranked} barrios en el plan</> : 'Fuera de las zonas 1º, 2º y 3º'}{tier ? ` · se afecta en el nivel ${TIER_LABEL[tier]}` : ''}</p>
      <dl>
        <dt>Población</dt><dd className="mono">{n(p.poblacion)} personas · {n(p.hogares)} hogares</dd>
        <dt>En zona 1º · 2º · 3º</dt><dd className="mono">{n(prio.peopleByTier[0])} · {n(prio.peopleByTier[1])} · {n(prio.peopleByTier[2])}</dd>
        {live && <><dt>Con agua ahora</dt><dd className="mono">{n(live.people)} personas</dd></>}
        {hasSocio && <>
          <dt>Hogares con NBI</dt><dd className="mono">{pct(p.hogaresNbi, p.hogares)} ({n(p.hogaresNbi)})</dd>
          <dt>Niños ≤ 14 · mayores ≥ 65</dt><dd className="mono">{n(p.menores14)} · {n(p.mayores65)}</dd>
          <dt>Sin cobertura de salud</dt><dd className="mono">{pct(p.sinCobertura, p.poblacion)}</dd>
          <dt>Hacinamiento crítico</dt><dd className="mono">{pct(p.hogaresHacinamiento, p.hogares)} de los hogares</dd>
          <dt>Sin cloaca · sin agua de red</dt><dd className="mono">{pct(p.hogaresSinCloaca, p.hogares)} · {pct(p.hogaresSinAguaRed, p.hogares)}</dd>
          <dt>Viviendas precarias</dt><dd className="mono">{n(p.viviendasPrecarias)} (rancho, casilla y similares)</dd>
          <dt>Índice de vulnerabilidad</dt><dd className="mono">×{prio.ivs.toFixed(2).replace('.', ',')} (1 = promedio de la ciudad; entre {String(IVS_MIN).replace('.', ',')} y {IVS_MAX})</dd>
        </>}
      </dl>
      <p className="hint">Barrio aproximado: celdas a menos de 1,2 km del punto del barrio en OpenStreetMap. Censo repartido parejo en cada radio. Fuente: {source}.</p>
    </div>
  );
}

function rank(t: number | undefined, tier: Tier) {
  const live = t != null && t >= 0 ? t : 1e9;
  return live + (tier ? tier : 9) * 1e-3 + (live === 1e9 ? (tier || 9) * 1e7 : 0);
}
function shortStage(s: number) {
  if (!Number.isFinite(s) || s > 30) return 'no llega';
  return s <= 0 ? 'siempre' : `río ${fmtM(s)} m`;
}
function fmtHours(h: number) {
  const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
  return hh ? `${hh} h${mm ? ` ${mm} min` : ''}` : `${mm} min`;
}
function statusText(l: FacilityLive | null | undefined) {
  if (!l) return '—';
  return l.status === 'afectado' ? 'Con agua (≥ 15 cm)' : l.status === 'atencion' ? 'Agua en las inmediaciones' : 'Sin agua';
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`stat ${accent ? 'accent' : ''}`}>
      <span>{label}</span>
      <b className="mono">{value}</b>
      {sub && <small>{sub}</small>}
    </div>
  );
}
function TierBadge({ t }: { t: Tier }) {
  return <span className={`tier t${t}`} title={t ? `Se afecta en el escenario de nivel ${t}` : 'No se afecta en los escenarios de referencia'}>{TIER_LABEL[t]}</span>;
}
function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button className={`toggle ${on ? 'on' : ''}`} onClick={onClick}>{children}</button>;
}
function Legend({ layers, mode }: { layers: Layers; mode: WaterMode }) {
  return (
    <div className="legend">
      {layers.priority && <span><i className="grad-prio" />prioridad baja → alta (población × urgencia × vulnerabilidad)</span>}
      {layers.zones && (<>
        <span><i style={{ background: '#ff2e47' }} />1º lluvia fuerte</span>
        <span><i style={{ background: '#ff8c1f' }} />2º temporal</span>
        <span><i style={{ background: '#ffe040' }} />3º extremo</span>
      </>)}
      {layers.water && mode === 'depth' && <span><i className="grad" />agua 0 → 1,5 m</span>}
      {layers.water && mode === 'order' && (<>
        <span><i style={{ background: '#5a73ff' }} />río (inicio)</span>
        <span><i style={{ background: '#ff334d' }} />1er tercio</span>
        <span><i style={{ background: '#ff8c26' }} />2do</span>
        <span><i style={{ background: '#ffe04d' }} />3er</span>
      </>)}
      {layers.lines && (<>
        <span><i style={{ background: '#73e0ff' }} />calle mojada</span>
        <span><i style={{ background: '#1a66ff' }} />sobre el cordón</span>
        <span><i style={{ background: '#ff3352' }} />calle intransitable</span>
      </>)}
      {layers.facilities && (<>
        <span><i style={{ background: '#a9b6c9' }} />instalación sin agua</span>
        <span><i style={{ background: '#ffc53d' }} />atención (haz)</span>
        <span><i style={{ background: '#ff3b5c' }} />afectada (haz + pulso)</span>
      </>)}
    </div>
  );
}

function InfoModal({ data, validation, onClose }: {
  data: AppData | null; validation: { rows: ValidationRow[]; ranked: number } | null; onClose: () => void;
}) {
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
          <li><b>Umbral de exposición al río</b> de cada instalación: la altura del río desde la que queda conectada al agua (camino más bajo desde el cauce, <i>priority-flood</i>, con la defensa como barrera). Ordena "qué se afecta primero" en una crecida sin inventar tiempos.</li>
        </ul>

        <h3>Escenarios de referencia (zonas 1º, 2º y 3º)</h3>
        <ul>{LEVELS.map((l, i) => <li key={l.id}><b>{i + 1}º · {l.label}:</b> {l.why}</li>)}</ul>
        {data?.zonesMeta && <p className="hint">Superficie afectada: {data.zonesMeta.stats.map((s, i) => `${i + 1}º ${s.km2} km²`).join(' · ')} (acumulada por escenario).</p>}

        <h3>Prioridad por población (Censo 2022)</h3>
        <ul>
          <li><b>Puntaje de cada celda</b> = personas que viven ahí × urgencia × índice de vulnerabilidad. El de un barrio es la suma de sus celdas.</li>
          <li><b>Urgencia</b> (supuesto): zona 1º ×{URGENCY[1]}, 2º ×{URGENCY[2]}, 3º ×{URGENCY[3]}. En "escenario en curso", el agua que llegó en el primer tercio del tiempo simulado ×3, en el segundo ×2 y en el último ×1.</li>
          <li><b>Índice de vulnerabilidad</b>: promedio de tres proporciones del radio censal (hogares con NBI, personas de hasta 14 o desde 65 años, personas sin obra social ni plan de salud), cada una dividida por la de toda la ciudad. 1 = promedio; se acota entre {String(IVS_MIN).replace('.', ',')} y {IVS_MAX}.</li>
          <li>Así, un barrio alejado con pocas familias que se afecta primero puede quedar por debajo de un barrio denso y vulnerable que también se afecta. Sirve para <b>ordenar dónde evaluar y asignar recursos</b>; la decisión es de las autoridades.</li>
        </ul>

        <h3>Supuestos declarados</h3>
        <table>
          <tbody>
            <tr><td>Cero de la escala de Puerto Formosa</td><td className="mono">{ASSUMPTIONS.gaugeZero.toFixed(2)} m IGN</td><td>Sale de la cota oficial de la defensa (Gobierno de Formosa, 08/12/2015): 59 m IGN = 11,70 m en el hidrómetro del puerto → 59 − 11,70. <b>Probable: confirmar con la tabla del INA.</b> Se supone que el MDE (EGM2008) y el IGN coinciden.</td></tr>
            <tr><td>Defensa</td><td className="mono">{ASSUMPTIONS.defenseCrest} m IGN</td><td>Coronamiento oficial (11,70 m en la escala). Traza aproximada de {longitudKm().toFixed(1)} km: 5 tramos reales de OpenStreetMap + conectores estimados por el equipo (los 15 km oficiales no están publicados como mapa). Con "falla" deja de actuar en todo el anillo.</td></tr>
            <tr><td>Subida del río</td><td className="mono">~{RISE_REF.cmPerDay} cm/día</td><td>Para declarar en cuántos días se llegaría a la altura del escenario. {RISE_REF.source}. No es un pronóstico: el río puede subir más rápido o no subir.</td></tr>
            <tr><td>Desagüe + infiltración</td><td className="mono">editable</td><td>No hay datos públicos de la red pluvial. Con el río en alerta queda un {Math.round(ASSUMPTIONS.drainFactorHighRiver * 100)} % (solo bombeo).</td></tr>
            <tr><td>Agua en las calles</td><td className="mono">{Math.round(STREET.share * 100)} %</td><td>En zona urbana (≥ {STREET.minBuildings} edificios por celda de ~60 m) se supone que la calzada ocupa ese porcentaje de la manzana y junta toda su agua, porque lotes y veredas están más altos. Cordón: {STREET.curb * 100} cm. Intransitable: {STREET.impassable * 100} cm.</td></tr>
            <tr><td>Rugosidad (Manning)</td><td className="mono">{ASSUMPTIONS.manning}</td><td>Valor típico de llanura urbana y periurbana.</td></tr>
            <tr><td>Umbral de afectación</td><td className="mono">{ASSUMPTIONS.wetThreshold * 100} cm</td><td>Agua que dificulta el tránsito y entra a veredas.</td></tr>
          </tbody>
        </table>

        <h3>Datos utilizados</h3>
        <table>
          <tbody>
            <tr><td><span className="tag tag-obs">OBSERVADO</span></td><td>Río Paraguay en Puerto Formosa: {fmtM(RIVER_REF.observed.stage)} m el {RIVER_REF.observed.date} ({RIVER_REF.observed.trend}, <b>{RIVER_REF.observed.categoryINA}</b> según el INA). <a href={RIVER_REF.observed.url} target="_blank" rel="noreferrer">{RIVER_REF.observed.source}</a>.</td></tr>
            <tr><td><span className="tag tag-obs">REFERENCIA INA</span></td><td>Alerta {fmtM(RIVER_REF.alert)} m · Evacuación {fmtM(RIVER_REF.evacuation)} m · Aguas bajas {fmtM(RIVER_REF.lowWater)} m (Puerto Formosa). Récord de 1983: {fmtM(RIVER_REF.record1983)} m.</td></tr>
            <tr><td><span className="tag tag-ina">PREVISIÓN INA</span></td><td>~{fmtM(FORECAST_INA.stage)} m ± {FORECAST_INA.margin.toFixed(1).replace('.', ',')} al {FORECAST_INA.until}. {FORECAST_INA.text} <a href={FORECAST_INA.url} target="_blank" rel="noreferrer">{FORECAST_INA.source}</a>. No se integra en vivo: se actualiza a mano en <code>src/sim/scenarios.ts</code>.</td></tr>
            <tr><td><span className="tag tag-obs">OBSERVADO</span></td><td>Monitoreo Hídrico y Agroambiental de Formosa (Subsecretaría de Producción Sustentable), parte del 17/11/2026: Puerto Formosa 4,96 m (Prefectura, 16/11), <b>−0,37 m en 7 días</b>, a 2,84 m de la alerta. Pronóstico de lluvia a 7 días para el departamento Formosa: 129 mm promedio, hasta 150 mm (Open-Meteo, <b>estimado</b>).</td></tr>
            <tr><td><span className="tag tag-ina">ESTIMADO</span></td><td>SMN · Boletín El Niño N.º 8 (22/10/2026): 100 % de probabilidad de seguir en fase El Niño en oct-nov-dic 2026; más lluvia que lo normal en el extremo este de Pilcomayo-Bermejo (donde está Formosa).</td></tr>
            <tr><td><span className="tag tag-ina">ESTIMADO</span></td><td>Pronóstico estacional CFS v2 (NOAA, 20 miembros), emitido el 29/10/2026 para Formosa: nov 2026–jul 2027 ~1.623 mm (+32 % sobre lo normal); <b>marzo 2027 ~308 mm</b> (normal 149) con 75 % de probabilidad de superar 200 mm. Sirve para elegir escenarios de lluvia creíbles, no como pronóstico diario.</td></tr>
            <tr><td><span className="tag tag-user">ESCENARIO</span></td><td>Lo elige el usuario. Es hipotético y se compara solo con los umbrales oficiales del INA (alerta y evacuación), sin inventar categorías.</td></tr>
            <tr><td><span className="tag">TERRENO</span></td><td>{data?.meta.source}. Terreno desnudo estimado con aprendizaje automático a partir de un modelo satelital de superficie: puede quedar algún resto de edificios o árboles. Precisión vertical de 1 a 2 m en zonas planas.</td></tr>
            {data?.escuelas && <tr><td><span className="tag">REFERENCIA</span></td><td><a href={data.escuelas.url} target="_blank" rel="noreferrer">{data.escuelas.fuente}</a>: {data.escuelas.escuelas.reduce((a, e) => a + e.establecimientos.length, 0)} establecimientos activos en {data.escuelas.escuelas.length} edificios (descarga {data.escuelas.fecha}). Reemplazan a las escuelas de OSM. Muchas ubicaciones son aproximadas.</td></tr>}
            {data?.poblacion && <tr><td><span className="tag">REFERENCIA</span></td><td><a href={data.poblacion.url} target="_blank" rel="noreferrer">{data.poblacion.fuente}</a>: {data.poblacion.radios} radios censales. Método: {data.poblacion.metodo}. Es un orden de magnitud, no un conteo.</td></tr>}
            <tr><td><span className="tag">BASE</span></td><td>{data?.osm?.source ?? 'OpenStreetMap (no cargado)'}: hospitales, salud, seguridad, servicios, calles, riachos, barrios y tramos de la defensa.</td></tr>
            <tr><td><span className="tag">BASE</span></td><td>{data?.buildings?.meta?.source ?? 'Microsoft Global ML Building Footprints'}: {(data?.buildings?.count ?? 0).toLocaleString('es-AR')} edificios.</td></tr>
          </tbody>
        </table>

        <h3>Categorías del INA</h3>
        <p className="hint">Según la frecuencia de superación 1991–2020. Se aplican solo al dato observado: los cortes en metros de Puerto Formosa no están publicados, así que el escenario no recibe categoría.</p>
        <ul>{CATEGORIES_INA.map(([c, d]) => <li key={c}><b>{c}</b>: {d}</li>)}</ul>

        <h3>Incertidumbre</h3>
        <p><span className="tag tag-user">CONFIANZA BAJA</span> Los resultados ordenan zonas para evaluar. No son un pronóstico.</p>
        <ul>{UNCERTAINTY.map((t) => <li key={t}>{t}</li>)}</ul>

        <h3>Dónde entra la IA</h3>
        <ul>
          <li>El cálculo del agua <b>no usa IA</b>: es un modelo físico (inercia local) y un <i>priority-flood</i> que se pueden verificar paso a paso.</li>
          <li>El terreno sí sale de un modelo aprendido: FABDEM quita edificios y árboles del modelo satelital con aprendizaje automático.</li>
          <li>El equipo usó un asistente de IA para investigar fuentes y programar. Cada dato tiene su fuente y fecha en este panel.</li>
          <li>La IA <b>no predice</b> el río (eso es del INA) y <b>no decide</b> evacuaciones ni cortes de luz: esas decisiones son humanas.</li>
        </ul>

        <h3>¿Funciona? Validación con barrios reportados con agua</h3>
        <p className="hint">Barrios que la prensa reportó con agua, comparados con lo que marca el modelo. Son pocos casos: sirve para detectar contradicciones, no es una validación estadística.</p>
        {validation ? (
          <table>
            <tbody>
              {validation.rows.map((r) => (
                <tr key={r.name}>
                  <td><b>{r.name}</b><br /><span className="hint">{r.kind === 'lluvia' ? 'por lluvia' : 'por el río'}</span></td>
                  <td>{r.event}. <a href={r.url} target="_blank" rel="noreferrer">{r.source}</a></td>
                  <td className="mono">{!r.found ? 'no está en OSM' : r.tier ? `zona ${TIER_LABEL[r.tier]} · prioridad ${r.rank}º de ${validation.ranked}` : 'el modelo NO lo marca'}</td>
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
            <tr><td>✔</td><td>Seleccionar un escenario hipotético de lluvias o crecida</td><td>Niveles 1º/2º/3º, crecida 1983 y valores a mano (lluvia, duración, río, desagüe, falla de la defensa)</td></tr>
            <tr><td>✔</td><td>Identificar sectores o infraestructuras expuestos</td><td>Barrios, calles, escuelas (padrón oficial), salud, seguridad y servicios, con nivel del río que los alcanza</td></tr>
            <tr><td>✔</td><td>Visualizar los elementos que requieren atención</td><td>Mapa 3D, mapa de calor de prioridad por población y lista ordenada</td></tr>
            <tr><td>✔</td><td>Mostrar qué datos y supuestos se usaron</td><td>Este panel: fuentes con tipo, fecha y enlace, y cada supuesto con su valor</td></tr>
            <tr><td>✔</td><td>Indicar horizonte temporal e incertidumbre</td><td>Horizonte y "confianza baja" junto al escenario; lista de incertidumbres</td></tr>
            <tr><td>✔</td><td>Escala del INA (5 categorías) sin inventar categorías</td><td>Solo para el dato observado; el escenario se compara con alerta y evacuación</td></tr>
            <tr><td>✔</td><td>Supuestos del escenario (cuánto sube el río, en cuántos días)</td><td>Junto al escenario, con el ritmo de subida de octubre de 2026</td></tr>
            <tr><td>✔</td><td>Distinguir observado, previsión INA y escenario</td><td>Tres etiquetas siempre visibles arriba</td></tr>
            <tr><td>✔</td><td>Zonas a evaluar, no veredictos</td><td>Textos y lista de límites; el MDE tiene 1 a 2 m de error</td></tr>
            <tr><td>✔</td><td>Decisiones operativas bajo responsabilidad humana</td><td>La prioridad ordena, no decide</td></tr>
            <tr><td>◐</td><td>MDE-Ar del IGN</td><td>Se usa FABDEM (30 m, sin edificios): el MDE-Ar no tiene descarga automática</td></tr>
          </tbody>
        </table>

        <h3>Lo que NO podemos asegurar</h3>
        <ul>
          <li>Qué manzana o casa se inunda: el error vertical del MDE es mayor que muchas diferencias de nivel de la ciudad.</li>
          <li>Tiempos reales de llegada del agua: no conocemos la red de desagües, sus obstrucciones ni el estado de las bombas. Los tiempos sirven para <b>ordenar</b>, no para planificar al minuto.</li>
          <li>Que el río suba igual en toda la costa: la escala mide un solo punto.</li>
          <li>Que la lista de infraestructura esté completa: OpenStreetMap y el padrón escolar pueden tener faltantes o ubicaciones aproximadas.</li>
          <li>Cuánta gente se ve afectada: el censo se reparte parejo dentro de cada radio censal.</li>
          <li>Horizonte temporal: los escenarios son hipotéticos e instantáneos, no un pronóstico. El pronóstico oficial es del INA y del SMN.</li>
        </ul>
      </div>
    </div>
  );
}
