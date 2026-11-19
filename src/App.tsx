import { useEffect, useMemo, useRef, useState } from 'react';
import { loadAll, type AppData, type FacilityCat } from './data/load';
import { MapScene, type Layers, type WaterMode } from './scene/MapScene';
import type { WorkerIn, WorkerOut, SimStats } from './sim/worker';
import type { Scenario } from './sim/engine';
import { ASSUMPTIONS, PRESETS, RIVER_REF, LEVELS } from './sim/scenarios';
import {
  evalBarrios, evalFacilities, fmtTime, prepareBarrios, prepareFacilities,
  type BarrioInfo, type BarrioLive, type FacilityInfo, type FacilityLive, type Tier,
} from './analysis';

const SIM_FACTOR = 2; // celdas de ~60 m en vivo

const CAT_LABEL: Record<FacilityCat, string> = {
  hospital: 'Hospital', salud: 'Salud', escuela: 'Escuela', seguridad: 'Bomberos / Policía',
  servicios: 'Agua / Energía', refugio: 'Refugio / Municipio', transporte: 'Transporte',
};
const CAT_ICON: Record<FacilityCat, string> = {
  hospital: '✚', salud: '+', escuela: '▲', seguridad: '◆', servicios: '⚡', refugio: '⌂', transporte: '✈',
};
const TIER_LABEL = ['—', '1º', '2º', '3º'];

export default function App() {
  const [data, setData] = useState<AppData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scenario, setScenario] = useState<Scenario>(() => ({ ...LEVELS[1] }));
  const [presetId, setPresetId] = useState<string | null>('n2');
  const [stats, setStats] = useState<SimStats | null>(null);
  const [speed, setSpeed] = useState(900);
  const [layers, setLayers] = useState<Layers>({ water: true, zones: false, buildings: true, lines: true, labels: true });
  const [waterMode, setWaterMode] = useState<WaterMode>('depth');
  const [tab, setTab] = useState<'barrios' | 'infra'>('barrios');
  const [facLive, setFacLive] = useState<FacilityLive[]>([]);
  const [barLive, setBarLive] = useState<BarrioLive[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [catFilter, setCatFilter] = useState<FacilityCat | 'todas'>('todas');

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
    scene.renderer.domElement.addEventListener('dblclick', onClick);
    scene.renderer.domElement.addEventListener('click', onClick);
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
  const facRows = useMemo(() => facilities.map((f, i) => ({ f, l: facLive[i], i }))
    .filter((r) => catFilter === 'todas' || r.f.cat === catFilter)
    .sort((a, z) => rank(a.l?.firstWet, a.f.tier) - rank(z.l?.firstWet, z.f.tier)), [facilities, facLive, catFilter]);
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
          <span className="tag tag-obs" title={RIVER_REF.observed.source}>
            OBSERVADO · río {RIVER_REF.observed.stage.toFixed(2)} m · {RIVER_REF.observed.date}
          </span>
          <a className="tag tag-ina" href="https://alerta.ina.gob.ar/a5/secciones" target="_blank" rel="noreferrer">PREVISIÓN INA · consultar ↗</a>
          <span className="tag tag-user">ESCENARIO DEL USUARIO · hipotético</span>
        </div>
      </header>

      <aside className="panel left">
        <h2>Escenario</h2>
        <div className="presets">
          {PRESETS.map((p) => (
            <button key={p.id} className={`preset ${presetId === p.id ? 'on' : ''} lvl-${p.id}`} onClick={() => applyPreset(p.id)}>
              <b>{p.short}</b><span>{p.label}</span>
            </button>
          ))}
        </div>
        {preset && <p className="why">{preset.why}</p>}

        <section>
          <label className="row"><span>Lluvia</span><b className="mono">{scenario.rainMmH} mm/h</b></label>
          <input type="range" min={0} max={200} step={5} value={scenario.rainMmH} onChange={(e) => update({ rainMmH: +e.target.value })} />
          <div className="hint mono">
            = {rainMmMin.toFixed(2)} mm/min = {rainMmMin.toFixed(2)} L por m² por minuto
          </div>
          <label className="row"><span>Duración</span><b className="mono">{fmtHours(scenario.rainHours)}</b></label>
          <input type="range" min={0.25} max={6} step={0.25} value={scenario.rainHours} onChange={(e) => update({ rainHours: +e.target.value })} />
          <div className="hint mono">Total: {(scenario.rainMmH * scenario.rainHours).toFixed(0)} mm ({(scenario.rainMmH * scenario.rainHours).toFixed(0)} L/m²)</div>
        </section>

        <section>
          <label className="row"><span>Río Paraguay · Puerto Formosa</span><b className={`mono river-${riverCat}`}>{scenario.riverStage.toFixed(2)} m</b></label>
          <input type="range" min={1.5} max={11.5} step={0.05} value={scenario.riverStage} onChange={(e) => update({ riverStage: +e.target.value })} />
          <div className="scale">
            {[
              { v: RIVER_REF.observed.stage, t: 'hoy' },
              { v: RIVER_REF.alert, t: 'alerta' },
              { v: RIVER_REF.evacuation, t: 'evac.' },
              { v: RIVER_REF.record1983, t: '1983' },
            ].map((m) => (
              <button key={m.t} style={{ left: `${((m.v - 1.5) / 10) * 100}%` }} onClick={() => update({ riverStage: m.v })} title={`${m.v} m`}>
                <i />{m.t}
              </button>
            ))}
          </div>
          <div className="hint">Cota supuesta del agua: {(ASSUMPTIONS.gaugeZero + scenario.riverStage).toFixed(1)} m s. n. m. Cambiar el río reinicia la simulación.</div>
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

      <aside className="panel right">
        <div className="stats">
          <Stat label="Tiempo simulado" value={fmtTime(stats?.time ?? 0).replace('t=0 (río)', '0 min')} />
          <Stat label="Lluvia caída" value={`${(stats?.rainMm ?? 0).toFixed(0)} mm`} />
          <Stat label="Área con agua ≥ 15 cm" value={`${(stats?.areaKm2 ?? 0).toFixed(1)} km²`} sub="estimado" />
          <Stat label="Instalaciones" value={`${affectedCounts.afectado}`} sub={`afectadas · ${affectedCounts.atencion} en atención`} accent />
        </div>

        <div className="tabs">
          <button className={tab === 'barrios' ? 'on' : ''} onClick={() => setTab('barrios')}>Barrios ({barrios.length})</button>
          <button className={tab === 'infra' ? 'on' : ''} onClick={() => setTab('infra')}>Infraestructura ({facilities.length})</button>
        </div>
        <p className="list-help">Orden de afectación en esta simulación. <b>Nivel</b> = en qué escenario de referencia se afecta primero (1º lluvia fuerte · 2º temporal severo · 3º extremo).</p>

        {tab === 'infra' && (
          <div className="filters">
            {(['todas', 'hospital', 'salud', 'escuela', 'seguridad', 'servicios', 'refugio'] as const).map((c) => (
              <button key={c} className={catFilter === c ? 'on' : ''} onClick={() => setCatFilter(c)}>{c === 'todas' ? 'Todas' : CAT_LABEL[c]}</button>
            ))}
          </div>
        )}

        <ol className="list">
          {tab === 'barrios' && barrioRows.map(({ b, l, i }) => (
            <li key={i} className={`st-${l?.status ?? 'seco'}`} onClick={() => sceneRef.current?.focusLonLat(b.lon, b.lat)}>
              <TierBadge t={b.tier} />
              <div className="li-main"><b>{b.name}</b><span>{l ? `${Math.round(l.share * 100)} % con agua` : ''}</span></div>
              <span className="mono time">{fmtTime(l?.firstAffected ?? -1)}</span>
            </li>
          ))}
          {tab === 'infra' && facRows.map(({ f, l, i }) => (
            <li key={f.id} className={`st-${l?.status ?? 'seco'} ${selected === i ? 'sel' : ''}`} onClick={() => { setSelected(i); sceneRef.current?.focusFacility(i); }}>
              <TierBadge t={f.tier} />
              <div className="li-main"><b><span className="icon">{CAT_ICON[f.cat]}</span>{f.name}</b><span>{CAT_LABEL[f.cat]}{l && l.status !== 'seco' ? ` · ${(l.depth * 100).toFixed(0)} cm` : ''}</span></div>
              <span className="mono time">{fmtTime(l?.firstWet ?? -1)}</span>
            </li>
          ))}
          {tab === 'barrios' && !barrios.length && <li className="empty">Sin barrios de OpenStreetMap cargados.</li>}
          {tab === 'infra' && !facilities.length && <li className="empty">Sin infraestructura de OpenStreetMap cargada.</li>}
        </ol>
        {tab === 'infra' && facilities.length > 0 && (
          <div className="tier-sum mono">Nivel 1º: {tierCounts[1]} · 2º: {tierCounts[2]} · 3º: {tierCounts[3]} · fuera: {tierCounts[0]}</div>
        )}
      </aside>

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
          </dl>
          <p className="hint">Zona a evaluar, no veredicto: el MDE tiene ~2 m de error vertical. Fuente: OpenStreetMap.</p>
        </div>
      )}

      <footer className="dock">
        <div className="layers">
          <Toggle on={layers.water} onClick={() => setLayers({ ...layers, water: !layers.water })}>Agua en vivo</Toggle>
          <Toggle on={layers.zones} onClick={() => setLayers({ ...layers, zones: !layers.zones })}>Zonas 1º · 2º · 3º</Toggle>
          <Toggle on={layers.buildings} onClick={() => setLayers({ ...layers, buildings: !layers.buildings })}>Edificios</Toggle>
          <Toggle on={layers.lines} onClick={() => setLayers({ ...layers, lines: !layers.lines })}>Calles y riachos</Toggle>
          <Toggle on={layers.labels} onClick={() => setLayers({ ...layers, labels: !layers.labels })}>Barrios</Toggle>
          <span className="sep" />
          <Toggle on={waterMode === 'order'} onClick={() => setWaterMode(waterMode === 'order' ? 'depth' : 'order')}>Color: {waterMode === 'order' ? 'orden de llegada' : 'profundidad'}</Toggle>
          <button className="btn ghost" onClick={() => setShowInfo(true)}>ⓘ Supuestos, datos y límites</button>
        </div>
        <Legend layers={layers} mode={waterMode} />
      </footer>

      {showInfo && <InfoModal data={data} onClose={() => setShowInfo(false)} />}
    </div>
  );
}

function rank(t: number | undefined, tier: Tier) {
  const live = t != null && t >= 0 ? t : 1e9;
  return live + (tier ? tier : 9) * 1e-3 + (live === 1e9 ? (tier || 9) * 1e7 : 0);
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
      <span><i style={{ background: '#38e8ff' }} />sin agua</span>
      <span><i style={{ background: '#ffc53d' }} />atención</span>
      <span><i style={{ background: '#ff3b5c' }} />afectada</span>
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
          <li>Una celda está <b>afectada</b> cuando tiene 15 cm de agua o más. Un barrio está afectado cuando lo está al menos el 5 % de su superficie.</li>
        </ul>

        <h3>Escenarios de referencia (zonas 1º, 2º y 3º)</h3>
        <ul>{LEVELS.map((l, i) => <li key={l.id}><b>{i + 1}º · {l.label}:</b> {l.why}</li>)}</ul>
        {data?.zonesMeta && <p className="hint">Superficie afectada: {data.zonesMeta.stats.map((s, i) => `${i + 1}º ${s.km2} km²`).join(' · ')} (acumulada por escenario).</p>}

        <h3>Supuestos declarados</h3>
        <table>
          <tbody>
            <tr><td>Cero de la escala de Puerto Formosa</td><td className="mono">{ASSUMPTIONS.gaugeZero} m</td><td>Estimado: superficie del río en el MDE menos una altura típica. <b>Falta el dato oficial del INA.</b></td></tr>
            <tr><td>Coronamiento de la defensa</td><td className="mono">{ASSUMPTIONS.defenseCrest} m</td><td>Supuesto (≈ 11,7 m de escala, por encima de 1983). Traza de OSM, si existe.</td></tr>
            <tr><td>Desagüe + infiltración</td><td className="mono">editable</td><td>No hay datos públicos de la red pluvial. Con el río en alerta queda un {Math.round(ASSUMPTIONS.drainFactorHighRiver * 100)} % (solo bombeo).</td></tr>
            <tr><td>Rugosidad (Manning)</td><td className="mono">{ASSUMPTIONS.manning}</td><td>Valor típico de llanura urbana y periurbana.</td></tr>
            <tr><td>Umbral de afectación</td><td className="mono">{ASSUMPTIONS.wetThreshold * 100} cm</td><td>Agua que dificulta el tránsito y entra a veredas.</td></tr>
          </tbody>
        </table>

        <h3>Datos utilizados</h3>
        <table>
          <tbody>
            <tr><td><span className="tag tag-obs">OBSERVADO</span></td><td>Río Paraguay en Puerto Formosa: {RIVER_REF.observed.stage} m el {RIVER_REF.observed.date} ({RIVER_REF.observed.trend}). {RIVER_REF.observed.source}.</td></tr>
            <tr><td><span className="tag tag-obs">REFERENCIA INA</span></td><td>Alerta {RIVER_REF.alert} m · Evacuación {RIVER_REF.evacuation} m (Puerto Formosa). Récord de 1983: {RIVER_REF.record1983} m.</td></tr>
            <tr><td><span className="tag tag-ina">PREVISIÓN INA</span></td><td>No se integra en vivo. Consultar <a href="https://alerta.ina.gob.ar/a5/secciones" target="_blank" rel="noreferrer">alerta.ina.gob.ar</a> y cargar el valor como escenario.</td></tr>
            <tr><td><span className="tag">TERRENO</span></td><td>{data?.meta.source}. Modelo de superficie (incluye árboles y techos): se atenúa con un filtro. Precisión vertical de algunos metros.</td></tr>
            <tr><td><span className="tag">BASE</span></td><td>{data?.osm?.source ?? 'OpenStreetMap (no cargado)'}: infraestructura, calles, riachos, barrios y edificios.</td></tr>
          </tbody>
        </table>

        <h3>Lo que NO podemos asegurar</h3>
        <ul>
          <li>Qué manzana o casa se inunda: el error vertical del MDE es mayor que muchas diferencias de nivel de la ciudad.</li>
          <li>Tiempos reales de llegada del agua: no conocemos la red de desagües, sus obstrucciones ni el estado de las bombas. Los tiempos sirven para <b>ordenar</b>, no para planificar al minuto.</li>
          <li>Que el río suba igual en toda la costa: la escala mide un solo punto.</li>
          <li>Que la lista de infraestructura esté completa: OpenStreetMap puede tener faltantes o errores.</li>
          <li>Horizonte temporal: los escenarios son hipotéticos e instantáneos, no un pronóstico. El pronóstico oficial es del INA y del SMN.</li>
        </ul>
      </div>
    </div>
  );
}
