// Right panel: live KPIs and ordered lists of streets, barrios and facilities; facility card.
import { memo, useMemo } from 'react';
import type { BarrioInfo, BarrioLive, FacilityInfo, FacilityLive, StreetLive, Tier } from '../analysis';
import { fmtTime } from '../analysis';
import type { FacilityCat } from '../data/load';
import type { SimStats } from '../sim/worker';
import { LEVELS, STREET } from '../sim/scenarios';
import { fmtStage, stageContext, thresholdState, RISK_MARGIN, type ThresholdState } from './threshold';
import { CAT_ICON, CAT_LABEL, CAT_SHORT, TIER_LABEL, nf, statusText } from './format';
import type { ResultsTab } from './demo';
import { Icon, type IconName } from './icons';

const THR_ROW: Record<ThresholdState, string> = { alcanzado: 'st-afectado', riesgo: 'st-atencion', lejos: '' };
const FILTERS: (FacilityCat | 'todas')[] = ['todas', 'hospital', 'salud', 'escuela', 'seguridad', 'servicios', 'publico'];

type StageOf = (x: { stageSana: number | null; stageBrecha: number | null }) => number | null;

export interface ResultsPanelProps {
  stats: SimStats | null;
  streets: StreetLive | null;
  bld: { wet: number; near: number };
  totalBuildings: number;
  facilities: FacilityInfo[];
  facLive: FacilityLive[];
  barrios: BarrioInfo[];
  barLive: BarrioLive[];
  tab: ResultsTab;
  onTab: (t: ResultsTab) => void;
  order: 'sim' | 'rio';
  onOrder: (o: 'sim' | 'rio') => void;
  catFilter: FacilityCat | 'todas';
  onCatFilter: (c: FacilityCat | 'todas') => void;
  hasThr: boolean;
  river: number;
  breach: boolean;
  selected: number | null;
  onSelectFacility: (i: number) => void;
  onFocusBarrio: (lon: number, lat: number) => void;
  collapsed: boolean;
  onCollapse: () => void;
}

export function ResultsPanel(p: ResultsPanelProps) {
  const { stats: _stats, ...listProps } = p;
  const affected = useMemo(() => {
    const c = { afectado: 0, atencion: 0 };
    p.facLive.forEach((f) => { if (f.status !== 'seco') c[f.status]++; });
    return c;
  }, [p.facLive]);
  const t = p.stats?.time ?? 0;
  return (
    <aside className={`panel right ${p.collapsed ? 'collapsed' : ''}`} aria-label="Resultados">
      <header className="panel-h">
        <button className="icon-btn sm collapse" onClick={p.onCollapse} aria-expanded={!p.collapsed}
          aria-label={p.collapsed ? 'Mostrar los resultados' : 'Ocultar los resultados'} data-tip={p.collapsed ? 'Mostrar los resultados' : 'Ocultar para ver más mapa'}>
          <Icon name={p.collapsed ? 'chevronL' : 'chevronR'} size={16} />
        </button>
        <div>
          <span className="eyebrow">Resultados en vivo</span>
          <h2>¿Qué se afecta?</h2>
        </div>
        <span className="sim-time mono" data-tip="Tiempo simulado y lluvia caída hasta ahora (1 mm = 1 litro por m²)">
          <Icon name="clock" size={14} />{fmtTime(t).replace('t=0 (río)', '0 min')} · {(p.stats?.rainMm ?? 0).toFixed(0)} mm
        </span>
      </header>

      <div className="kpis" data-tour="kpis">
        <Kpi icon="road" label="Calles sobre el cordón" value={`${(p.streets?.curbKm ?? 0).toFixed(1)}`} unit="km"
          sub={`${(p.streets?.impassableKm ?? 0).toFixed(1)} km intransitables`} hot={(p.streets?.curbKm ?? 0) > 0}
          tip={`Kilómetros de calle con más de ${STREET.curb * 100} cm de agua. Intransitable: más de ${STREET.impassable * 100} cm.`} />
        <Kpi icon="building" label="Edificios con agua" value={nf(p.bld.wet)} sub={`${nf(p.bld.near)} con agua cerca · de ${nf(p.totalBuildings)}`} hot={p.bld.wet > 0}
          tip="Edificios con al menos 15 cm de agua alrededor" />
        <Kpi icon="area" label="Área con agua" value={(p.stats?.areaKm2 ?? 0).toFixed(1)} unit="km²" sub="≥ 15 cm · incluye el río que entra"
          tip="Superficie cubierta por 15 cm de agua o más" />
        <Kpi icon="hospital" label="Instalaciones afectadas" value={`${affected.afectado}`} sub={`${affected.atencion} con agua cerca`} hot={affected.afectado > 0}
          tip="Hospitales, escuelas, bomberos, etc. Afectada: ≥ 15 cm. Con agua cerca: en las inmediaciones." />
      </div>

      <div className="tabs" role="tablist" data-tour="tabs">
        {([['calles', 'Calles', p.streets?.top.length ?? 0], ['barrios', 'Barrios', p.barrios.length], ['infra', 'Instalaciones', p.facilities.length]] as const).map(([id, l, n]) => (
          <button key={id} role="tab" aria-selected={p.tab === id} className={p.tab === id ? 'on' : ''} onClick={() => p.onTab(id)}>
            {l}<span className="count">{n}</span>
          </button>
        ))}
      </div>
      <ResultsList {...listProps} />
    </aside>
  );
}

function Kpi({ icon, label, value, unit, sub, hot, tip }: { icon: IconName; label: string; value: string; unit?: string; sub: string; hot?: boolean; tip: string }) {
  return (
    <div className={`kpi ${hot ? 'hot' : ''}`} data-tip={tip}>
      <span className="kpi-l"><Icon name={icon} size={15} />{label}</span>
      <b className="kpi-v mono">{value}{unit && <small>{unit}</small>}</b>
      <span className="kpi-s">{sub}</span>
    </div>
  );
}

/** The list re-renders only when results change (every ~250 ms), not on every simulation frame. */
const ResultsList = memo(function ResultsList(p: Omit<ResultsPanelProps, 'stats'>) {
  const byRiver = p.hasThr && p.order === 'rio';
  const stageOf: StageOf = (x) => (p.breach ? x.stageBrecha : x.stageSana);
  const thrRow = (st: number | null) => THR_ROW[thresholdState(st, p.river)];

  const barrioRows = useMemo(() => p.barrios.map((b, i) => ({ b, l: p.barLive[i], i }))
    .sort(byRiver
      ? (a, z) => stageRank(stageOf(a.b)) - stageRank(stageOf(z.b)) || a.b.name.localeCompare(z.b.name)
      : (a, z) => rank(a.l?.firstAffected, a.b.tier) - rank(z.l?.firstAffected, z.b.tier)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p.barrios, p.barLive, byRiver, p.breach]);
  const facRows = useMemo(() => p.facilities.map((f, i) => ({ f, l: p.facLive[i], i }))
    .filter((r) => p.catFilter === 'todas' || r.f.cat === p.catFilter)
    .sort(byRiver
      ? (a, z) => stageRank(stageOf(a.f)) - stageRank(stageOf(z.f)) || a.f.name.localeCompare(z.f.name)
      : (a, z) => rank(a.l?.firstWet, a.f.tier) - rank(z.l?.firstWet, z.f.tier)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p.facilities, p.facLive, p.catFilter, byRiver, p.breach]);
  const catCount = useMemo(() => {
    const c: Record<string, number> = { todas: p.facilities.length };
    p.facilities.forEach((f) => { c[f.cat] = (c[f.cat] ?? 0) + 1; });
    return c;
  }, [p.facilities]);
  const tierCounts = useMemo(() => {
    const c = [0, 0, 0, 0];
    p.facilities.forEach((f) => c[f.tier]++);
    return c;
  }, [p.facilities]);

  return (
    <div className="results" data-tour="results">
      {p.tab === 'calles' ? (
        <div className="list-intro">
          <p><b className="mono">{(p.streets?.dirtCurbKm ?? 0).toFixed(1)} km</b> de calles de tierra con agua sobre el cordón.</p>
          <p className="hint" data-tip="En zona urbana se supone que el agua de la manzana se junta en la calzada, porque lotes y veredas están más altos.">Calles con más kilómetros de agua sobre el cordón y su profundidad máxima estimada.</p>
        </div>
      ) : (
        <div className="list-intro">
          {p.hasThr && (
            <div className="seg" role="radiogroup" aria-label="Orden de la lista">
              <button role="radio" aria-checked={p.order === 'sim'} className={p.order === 'sim' ? 'on' : ''} onClick={() => p.onOrder('sim')}
                data-tip="Por cuándo les llega el agua en esta simulación">Por llegada del agua</button>
              <button role="radio" aria-checked={p.order === 'rio'} className={p.order === 'rio' ? 'on' : ''} onClick={() => p.onOrder('rio')}
                data-tip="Por la altura del río a la que empieza a llegarles agua del río (estimación estática, sin lluvia)">Por altura del río</button>
            </div>
          )}
          {byRiver ? (
            <p className="hint">
              Altura del río a la que empieza a llegar agua del río{p.breach ? ', con la defensa rota' : ', con la defensa sana'}.{' '}
              <span className="key bad">Rojo</span> ya alcanzada con {fmtStage(p.river)} · <span className="key warn">ámbar</span> faltan menos de {RISK_MARGIN * 100} cm. Estimación estática, sin lluvia.
            </p>
          ) : (
            <p className="hint">
              Arriba lo primero que toca el agua. Etiqueta: desde qué escenario se afecta{' '}
              <span className="tier t1 inline">1º</span> lluvia fuerte · <span className="tier t2 inline">2º</span> temporal ·{' '}
              <span className="tier t3 inline">3º</span> extremo · <span className="tier t0 inline">—</span> ninguno.
            </p>
          )}
        </div>
      )}

      {p.tab === 'infra' && (
        <div className="chips" role="radiogroup" aria-label="Filtrar por tipo">
          {FILTERS.map((c) => (
            <button key={c} role="radio" aria-checked={p.catFilter === c} className={`chip ${p.catFilter === c ? 'on' : ''}`} onClick={() => p.onCatFilter(c)}>
              {c === 'todas' ? 'Todas' : CAT_SHORT[c]}<span className="count">{catCount[c] ?? 0}</span>
            </button>
          ))}
        </div>
      )}

      <ol className="list">
        {p.tab === 'barrios' && barrioRows.map(({ b, l, i }) => (
          <li key={i}>
            <button className={`row ${byRiver ? thrRow(stageOf(b)) : `st-${l?.status ?? 'seco'}`}`} onClick={() => p.onFocusBarrio(b.lon, b.lat)}>
              <TierBadge t={b.tier} />
              <span className="row-main"><b>{b.name}</b><span>{l ? `${Math.round(l.share * 100)} % con agua` : '—'}{byRiver && b.protectedByDefense && !p.breach ? ' · tras la defensa' : ''}</span></span>
              {byRiver
                ? <span className="mono row-v" data-tip={stageTip(stageOf(b), 'el 5 % del barrio')}>{fmtStage(stageOf(b))}</span>
                : <span className="mono row-v">{fmtTime(l?.firstAffected ?? -1)}</span>}
            </button>
          </li>
        ))}
        {p.tab === 'infra' && facRows.map(({ f, l, i }) => (
          <li key={f.id}>
            <button className={`row ${byRiver ? thrRow(stageOf(f)) : `st-${l?.status ?? 'seco'}`} ${p.selected === i ? 'sel' : ''}`} onClick={() => p.onSelectFacility(i)}>
              <TierBadge t={f.tier} />
              <span className="row-main">
                <b><Icon name={CAT_ICON[f.cat]} size={14} className="row-ic" />{f.name}</b>
                <span>{CAT_LABEL[f.cat]}{l && l.status !== 'seco' ? ` · ${(l.depth * 100).toFixed(0)} cm` : ''}{byRiver && f.protectedByDefense && !p.breach ? ' · tras la defensa' : ''}</span>
              </span>
              {byRiver
                ? <span className="mono row-v" data-tip={stageTip(stageOf(f), 'esta instalación')}>{fmtStage(stageOf(f))}</span>
                : <span className="mono row-v">{fmtTime(l?.firstWet ?? -1)}</span>}
            </button>
          </li>
        ))}
        {p.tab === 'calles' && p.streets?.top.map((s) => (
          <li key={s.name}>
            <div className={`row static ${s.maxDepth >= STREET.impassable ? 'st-afectado' : 'st-atencion'}`}>
              <span className="row-main"><b>{s.name}</b><span>máx. {(s.maxDepth * 100).toFixed(0)} cm en la calzada</span></span>
              <span className="mono row-v">{s.km.toFixed(2)} km</span>
            </div>
          </li>
        ))}
        {p.tab === 'calles' && !p.streets?.top.length && <li className="empty">Sin calles con agua sobre el cordón. Probá «Hacer llover».</li>}
        {p.tab === 'barrios' && !p.barrios.length && <li className="empty">Sin barrios de OpenStreetMap cargados.</li>}
        {p.tab === 'infra' && !p.facilities.length && <li className="empty">Sin infraestructura de OpenStreetMap cargada.</li>}
      </ol>
      {p.tab === 'infra' && p.facilities.length > 0 && (
        <p className="foot mono">Nivel 1º {tierCounts[1]} · 2º {tierCounts[2]} · 3º {tierCounts[3]} · fuera {tierCounts[0]}</p>
      )}
    </div>
  );
});

function rank(t: number | undefined, tier: Tier) {
  const live = t != null && t >= 0 ? t : 1e9;
  return live + (tier ? tier : 9) * 1e-3 + (live === 1e9 ? (tier || 9) * 1e7 : 0);
}
function stageRank(s: number | null) { return s == null ? 1e9 : s; }
function stageTip(s: number | null, what: string) {
  return s == null
    ? `El río no llega a ${what} aunque suba a 20 m: solo puede afectarse por lluvia.`
    : `Con el río a ${fmtStage(s)} en Puerto Formosa empieza a llegarle agua del río a ${what}. Estimación estática, sin lluvia.`;
}

export function TierBadge({ t }: { t: Tier }) {
  return <span className={`tier t${t}`} title={t ? `Se afecta en el escenario de nivel ${t}` : 'No se afecta en los escenarios de referencia'}>{TIER_LABEL[t]}</span>;
}

// ---------- facility card ----------

export function FacilityCard({ f, live, hasThr, crest, river, breach, onClose }: {
  f: FacilityInfo; live: FacilityLive | null; hasThr: boolean; crest: number; river: number; breach: boolean; onClose: () => void;
}) {
  return (
    <div className="card" data-tour="card" role="dialog" aria-label={`Ficha: ${f.name}`}>
      <button className="icon-btn sm x" onClick={onClose} aria-label="Cerrar ficha"><Icon name="close" size={16} /></button>
      <span className="eyebrow"><Icon name={CAT_ICON[f.cat]} size={13} />{CAT_LABEL[f.cat]}</span>
      <h3>{f.name}</h3>
      <div className={`card-status st-${live?.status ?? 'seco'}`}><i />{statusText(live)}</div>
      <dl>
        <dt>Agua máx. cerca (±60 m)</dt><dd className="mono">{live ? `${(live.depth * 100).toFixed(0)} cm` : '—'}</dd>
        <dt>Primer contacto</dt><dd className="mono">{fmtTime(live?.firstWet ?? -1)}{live?.byRiver ? ' · por el río' : ''}</dd>
        <dt>Nivel de referencia</dt><dd>{f.tier ? `${TIER_LABEL[f.tier]} · ${LEVELS[f.tier - 1].label}${f.tierByRiver ? ' · por el río' : ''}` : 'No se afecta en los 3 escenarios'}</dd>
      </dl>
      {hasThr && <ThresholdBlock f={f} crest={crest} river={river} breach={breach} />}
      <p className="hint">Zona a evaluar, no veredicto: el terreno tiene ~2 m de error vertical. Fuente: OpenStreetMap.</p>
    </div>
  );
}

function ThresholdBlock({ f, crest, river, breach }: { f: FacilityInfo; crest: number; river: number; breach: boolean }) {
  const line = (s: number | null, variant: 'sana' | 'brecha') => {
    const active = breach === (variant === 'brecha');
    const st = thresholdState(s, river);
    const ctx = s == null ? 'el río no llega aunque suba a 20 m'
      : variant === 'sana' && f.protectedByDefense ? `protegida por la defensa hasta su coronamiento (≈${fmtStage(crest)})`
      : stageContext(s, crest);
    return (
      <div className={`thr-line ${active ? 'active' : ''} thr-${st}`}
        data-tip={active ? 'Variante del escenario actual' : 'Otra variante: cambiala con «Rotura de la defensa», en las opciones avanzadas'}>
        <span>{variant === 'sana' ? 'Defensa sana' : 'Defensa rota'} <b className="mono">{fmtStage(s)}</b>
          {active && st === 'alcanzado' ? <em> · ya alcanzada</em> : active && st === 'riesgo' ? <em> · faltan menos de {RISK_MARGIN * 100} cm</em> : null}</span>
        <small>{ctx}</small>
      </div>
    );
  };
  return (
    <div className="thr">
      <div className="thr-h">
        <span>Altura del río a la que le llega agua</span>
        <span className="badge badge-est" data-tip="Estimación estática a partir del terreno y la defensa: no es un pronóstico y no incluye lluvia, desagües ni tiempos.">Estimado</span>
      </div>
      {f.stageSana == null && f.stageBrecha == null
        ? <p className="thr-none">El río no llega aunque suba a 20 m: solo puede afectarse por lluvia.</p>
        : <>{line(f.stageSana, 'sana')}{line(f.stageBrecha, 'brecha')}</>}
    </div>
  );
}
