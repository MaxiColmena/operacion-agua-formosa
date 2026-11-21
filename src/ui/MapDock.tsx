// Floating map toolbar: layer toggles, the «Vista» menu and a contextual color legend.
import type { ReactNode } from 'react';
import { EXAG_MAX, EXAG_MIN, type Layers, type WaterMode } from '../scene/MapScene';
import { ASSUMPTIONS } from '../sim/scenarios';
import { Icon } from './icons';

export interface MapDockProps {
  layers: Layers;
  onLayers: (patch: Partial<Layers>) => void;
  hasDrainage: boolean;
  waterMode: WaterMode;
  onWaterMode: (m: WaterMode) => void;
  viewOpen: boolean;
  onViewOpen: (v: boolean) => void;
  exag: number;
  onExag: (v: number) => void;
  freeCam: boolean;
  onFreeCam: () => void;
}

export function MapDock(p: MapDockProps) {
  const L = p.layers;
  return (
    <div className="dock-wrap">
      <Legend layers={L} mode={p.waterMode} />
      {p.viewOpen && (
        <div className="popover view-menu" role="dialog" aria-label="Opciones de vista">
          <div className="pop-row">
            <span className="pop-l">Color del agua</span>
            <div className="seg" role="radiogroup" aria-label="Cómo se colorea el agua">
              <button role="radio" aria-checked={p.waterMode === 'depth'} className={p.waterMode === 'depth' ? 'on' : ''} onClick={() => p.onWaterMode('depth')}
                data-tip="Más oscuro = más profundo (de 0 a 1,5 m)">Profundidad</button>
              <button role="radio" aria-checked={p.waterMode === 'order'} className={p.waterMode === 'order' ? 'on' : ''} onClick={() => p.onWaterMode('order')}
                data-tip="Según cuándo llegó el agua: rojo lo primero, amarillo lo último">Cuándo llegó</button>
            </div>
          </div>
          <div className="pop-row">
            <span className="pop-l">Mostrar</span>
            <div className="pop-toggles">
              <Toggle on={L.lines} onClick={() => p.onLayers({ lines: !L.lines })} tip="Calles (se pintan cuando el agua pasa el cordón), riachos y defensa">Calles</Toggle>
              <Toggle on={L.labels} onClick={() => p.onLayers({ labels: !L.labels })} tip="Nombres de barrios y calles sobre el mapa">Nombres</Toggle>
            </div>
          </div>
          <label className="pop-row" data-tip="Exagera la altura del terreno para que se vean los bajos. Formosa es casi plana: 1× es la escala real.">
            <span className="pop-l">Relieve <b className="mono">×{p.exag}</b></span>
            <input type="range" min={EXAG_MIN} max={EXAG_MAX} step={1} value={p.exag} onChange={(e) => p.onExag(+e.target.value)}
              style={{ ['--fill' as string]: `${((p.exag - EXAG_MIN) / (EXAG_MAX - EXAG_MIN)) * 100}%` }} aria-label="Exageración vertical del relieve" />
          </label>
          <button className={`btn block ${p.freeCam ? 'on' : ''}`} aria-pressed={p.freeCam}
            onClick={(e) => { e.currentTarget.blur(); p.onFreeCam(); }} data-tip="Recorré la ciudad como un dron con el teclado (tecla F para entrar o salir)">
            <Icon name="drone" size={16} />{p.freeCam ? 'Salir de la cámara libre' : 'Cámara libre (F)'}
          </button>
        </div>
      )}
      <nav className="dock" aria-label="Capas del mapa">
        <div className="dock-layers" data-tour="layers" role="group" aria-label="Capas visibles">
          <Icon name="layers" size={16} className="dock-ic" />
          <Toggle on={L.water} onClick={() => p.onLayers({ water: !L.water })} tip="El agua de la simulación, moviéndose en tiempo real">Agua</Toggle>
          <Toggle on={L.zones} onClick={() => p.onLayers({ zones: !L.zones })}
            tip="Mapa precalculado: qué se inunda con lluvia fuerte (1º), temporal severo (2º) o solo en el extremo (3º)">Zonas 1º–3º</Toggle>
          {p.hasDrainage && (
            <Toggle on={L.drainage} onClick={() => p.onLayers({ drainage: !L.drainage })}
              tip={`Red pluvial relevada: bocas de tormenta o sumideros (sin verificar). Ahí el desagüe es el 100 % del elegido; en el resto, el ${Math.round(ASSUMPTIONS.drainNoNetwork * 100)} %.`}>Red pluvial</Toggle>
          )}
          <Toggle on={L.facilities} onClick={() => p.onLayers({ facilities: !L.facilities })} tip="Hospitales, escuelas, bomberos y otros servicios. Clic en uno para ver su ficha.">Instalaciones</Toggle>
          <Toggle on={L.buildings} onClick={() => p.onLayers({ buildings: !L.buildings })} tip="Edificios en 3D">Edificios</Toggle>
        </div>
        <span className="dock-sep" aria-hidden="true" />
        <button className={`toggle ${p.viewOpen ? 'on' : ''}`} aria-expanded={p.viewOpen} onClick={() => p.onViewOpen(!p.viewOpen)} data-tour="view"
          data-tip="Color del agua, relieve, calles, nombres y cámara libre">
          <Icon name="eye" size={16} />Vista<Icon name="chevronD" size={14} className={`chev ${p.viewOpen ? 'up' : ''}`} />
        </button>
      </nav>
    </div>
  );
}

function Toggle({ on, onClick, children, tip }: { on: boolean; onClick: () => void; children: ReactNode; tip?: string }) {
  return (
    <button className={`toggle ${on ? 'on' : ''}`} onClick={onClick} aria-pressed={on} data-tip={tip ? `${tip}. Clic para ${on ? 'ocultar' : 'mostrar'}.` : undefined}>
      <span className="tg-dot" aria-hidden="true" />{children}
    </button>
  );
}

/** Color references for the visible layers only. */
function Legend({ layers, mode }: { layers: Layers; mode: WaterMode }) {
  const groups: { t: string; items: ReactNode }[] = [];
  if (layers.water && mode === 'depth') groups.push({ t: 'Agua', items: <span><i className="grad" />poca → 1,5 m o más</span> });
  if (layers.water && mode === 'order') groups.push({ t: 'Agua: cuándo llegó', items: (<>
    <span><i style={{ background: '#5266bd' }} />río</span>
    <span><i style={{ background: '#d9424d' }} />primero</span>
    <span><i style={{ background: '#de8538' }} />después</span>
    <span><i style={{ background: '#dec757' }} />al final</span>
  </>) });
  if (layers.zones) groups.push({ t: 'Zonas', items: (<>
    <span><i style={{ background: '#d13d47' }} />1º lluvia fuerte</span>
    <span><i style={{ background: '#d98033' }} />2º temporal</span>
    <span><i style={{ background: '#d9c252' }} />3º extremo</span>
  </>) });
  if (layers.drainage) groups.push({ t: 'Bocas de tormenta', items: <span><i style={{ background: '#2ec79e' }} />red relevada</span> });
  if (layers.lines) groups.push({ t: 'Calles', items: (<>
    <span><i style={{ background: '#2952c7' }} />agua sobre el cordón</span>
    <span><i style={{ background: '#e5424d' }} />intransitable</span>
  </>) });
  if (layers.facilities) groups.push({ t: 'Instalaciones', items: (<>
    <span><i style={{ background: '#7b8593' }} />sin agua</span>
    <span><i style={{ background: '#e3b04a' }} />agua cerca</span>
    <span><i style={{ background: '#e5525f' }} />afectada</span>
  </>) });
  if (!groups.length) return null;
  return (
    <div className="legend" aria-label="Referencias de colores">
      {groups.map((g) => <span key={g.t} className="lg-group"><em>{g.t}</em>{g.items}</span>)}
    </div>
  );
}
