// Automatic guided tour: runs the whole flow of the app step by step, spotlighting each control.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DemoApi } from './demo';
import { CameraPath, LANDMARKS, PathPlayer, orbitKeys } from '../scene/Cinematic';
import './demo.css';
import { Icon } from './Icon';

interface TourStep {
  /** `data-tour` id of the element to spotlight; none = the map itself. */
  target?: string;
  title: string;
  body: string;
  ms: number;
  enter?: (api: DemoApi, ctx: { orbit: (secs: number) => void }) => void;
}

const STEPS: TourStep[] = [
  {
    title: 'Formosa Capital en 3D',
    body: 'Terreno, 81.695 edificios, calles, riachos y el anillo de defensa. En poco más de un minuto te muestro todo el flujo: elegir un escenario, hacer llover, leer resultados y decidir.',
    ms: 8000,
    enter: (api, ctx) => { api.setAnalytics(false); api.setViewMenu(false); api.clearSelection(); api.setPanels({ left: false, right: false }); api.reset(); ctx.orbit(8); },
  },
  {
    target: 'presets', title: '1 · Elegí un escenario',
    body: 'Cada tarjeta combina lluvia y altura del río. Cargo «Nivel 2 · Temporal severo»: 105 mm en 1 h 30 min con el río en alerta (7,80 m).',
    ms: 7000, enter: (api) => { api.applyPreset('n2'); api.frame(LANDMARKS.center[0], LANDMARKS.center[1], [-1.2, 4.6, 5.2]); },
  },
  {
    target: 'rain', title: 'Ajustá la lluvia',
    body: 'Intensidad y duración se cambian con los controles; el total en milímetros (litros por m²) se calcula solo.',
    ms: 5500,
  },
  {
    target: 'river', title: 'Altura del río Paraguay',
    body: 'Las marcas ponen el río en alturas reales: hoy, alerta, evacuación, la crecida de 1983 y el coronamiento de la defensa.',
    ms: 6500,
  },
  {
    target: 'play', title: '2 · Hacé llover',
    body: 'La simulación corre acelerada: 15 minutos simulados por cada segundo. El agua cae, escurre por las pendientes y se junta en los bajos.',
    ms: 5000, enter: (api) => { api.setSpeed(900); api.play(); },
  },
  {
    title: 'El agua avanza sobre la ciudad',
    body: 'Azul más oscuro es más profundo. Las calles se pintan cuando el agua pasa el cordón y los edificios cambian de color cuando les llega.',
    ms: 8500, enter: (api) => api.frame(LANDMARKS.center[0], LANDMARKS.center[1], [0.9, 1.6, 2.2]),
  },
  {
    target: 'kpis', title: '3 · Resultados en vivo',
    body: 'Kilómetros de calles con agua sobre el cordón, edificios con agua, superficie inundada e instalaciones afectadas.',
    ms: 6500,
  },
  {
    target: 'results', title: 'Dónde actuar primero',
    body: 'Barrios ordenados por personas (Censo 2022) × urgencia × vulnerabilidad. Ordena la evaluación en terreno; no decide.',
    ms: 6500, enter: (api) => api.setTab('prioridad'),
  },
  {
    target: 'results', title: 'Calles que se cortan',
    body: 'Ordenadas por kilómetros con agua sobre el cordón y su profundidad máxima en la calzada.',
    ms: 5500, enter: (api) => api.setTab('calles'),
  },
  {
    target: 'results', title: 'Barrios, por orden de llegada',
    body: 'Arriba, lo primero que toca el agua. La etiqueta 1º, 2º o 3º dice desde qué escenario de referencia se afecta. Clic en uno para ir al mapa.',
    ms: 6000, enter: (api) => api.setTab('barrios'),
  },
  {
    target: 'card', title: 'Ficha de cada instalación',
    body: 'Estado ahora, profundidad cerca, primer contacto con el agua y a qué altura del río empieza a llegarle agua, con la defensa sana o rota.',
    ms: 8000, enter: (api) => { api.setTab('infra'); if (!api.selectWorstFacility()) api.setTab('infra'); },
  },
  {
    target: 'layers', title: 'Capas del mapa',
    body: 'Prendo «Zonas 1º/2º/3º»: el mapa precalculado de qué se inunda con lluvia fuerte, con temporal severo y solo en el extremo.',
    ms: 7000, enter: (api) => { api.clearSelection(); api.setLayers({ zones: true }); api.frame(LANDMARKS.center[0], LANDMARKS.center[1], [-0.6, 6.5, 6.2]); },
  },
  {
    target: 'view', title: 'Vista: cuándo llegó el agua',
    body: 'En «Vista» cambiás el color del agua, el relieve y entrás a la cámara libre. Rojo es lo primero que se mojó; amarillo, lo último.',
    ms: 7000, enter: (api) => { api.setLayers({ zones: false }); api.setViewMenu(true); api.setWaterMode('order'); },
  },
  {
    target: 'analytics', title: 'Análisis para decidir',
    body: 'Prioridades del escenario, curvas de la corrida, margen del río hasta el próximo umbral y qué protege la defensa.',
    ms: 9500, enter: (api) => { api.setViewMenu(false); api.setWaterMode('depth'); api.setAnalytics(true); },
  },
  {
    target: 'assumptions', title: 'Supuestos y límites',
    body: 'Es un escenario hipotético, no un pronóstico. Acá está qué datos usamos y qué no podemos asegurar.',
    ms: 5500, enter: (api) => api.setAnalytics(false),
  },
  {
    title: 'Listo: ahora probá vos',
    body: 'Cambiá la lluvia, subí el río o rompé la defensa en «Opciones avanzadas». Podés repetir este recorrido o ver la presentación cuando quieras.',
    ms: Infinity,
  },
];

interface Rect { top: number; left: number; width: number; height: number }

export function Tour({ api, onExit, onPresent }: { api: DemoApi; onExit: () => void; onPresent: () => void }) {
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [rect, setRect] = useState<Rect | null>(null);
  const [progress, setProgress] = useState(0);
  const orbitRef = useRef<PathPlayer | null>(null);
  /** Elapsed ms of the current step; survives pauses, resets on every step change. */
  const elapsed = useRef(0);
  const step = STEPS[idx];

  const stopOrbit = useCallback(() => { orbitRef.current?.stop(); orbitRef.current = null; }, []);
  const exit = useCallback(() => { stopOrbit(); onExit(); }, [onExit, stopOrbit]);

  // Run the step's action once when it becomes active.
  useEffect(() => {
    stopOrbit();
    step.enter?.(api, {
      orbit: (secs) => {
        const sc = api.scene();
        if (!sc) return;
        const c = sc.lonLatToWorld(LANDMARKS.center[0], LANDMARKS.center[1]);
        const keys = orbitKeys(c, 7.5, 6.5, Math.PI * 0.62, Math.PI * 0.38, 0, secs + 2, 8);
        orbitRef.current = new PathPlayer(sc, new CameraPath(keys));
      },
    });
    elapsed.current = 0;
    setProgress(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);
  useEffect(() => () => stopOrbit(), [stopOrbit]);

  // Auto-advance clock (pauses with the tour).
  useEffect(() => {
    if (paused || !isFinite(step.ms)) return;
    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      // Wall-clock time, so slow devices keep the same pacing; long gaps (hidden tab) don't count.
      const d = now - last; last = now;
      if (d > 0 && d < 1000) elapsed.current += d;
      const p = Math.min(1, elapsed.current / step.ms);
      setProgress(p);
      if (p >= 1) { setIdx((i) => Math.min(STEPS.length - 1, i + 1)); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, paused]);

  useEffect(() => { if (orbitRef.current) orbitRef.current.paused = paused; }, [paused]);

  // Track the spotlight target (it can move or resize while panels animate).
  useLayoutEffect(() => {
    if (!step.target) { setRect(null); return; }
    let raf = 0;
    const measure = () => {
      const el = document.querySelector(`[data-tour="${step.target}"]`);
      const r = el?.getBoundingClientRect();
      setRect((prev) => {
        if (!r || !r.width) return null;
        const n = { top: r.top - 6, left: r.left - 6, width: r.width + 12, height: r.height + 12 };
        return prev && Math.abs(prev.top - n.top) + Math.abs(prev.left - n.left) + Math.abs(prev.width - n.width) + Math.abs(prev.height - n.height) < 1 ? prev : n;
      });
      raf = requestAnimationFrame(measure);
    };
    measure();
    return () => cancelAnimationFrame(raf);
  }, [step.target, idx]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exit();
      else if (e.key === 'ArrowRight') setIdx((i) => Math.min(STEPS.length - 1, i + 1));
      else if (e.key === 'ArrowLeft') setIdx((i) => Math.max(0, i - 1));
      else if (e.key === ' ') { e.preventDefault(); setPaused((p) => !p); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [exit]);

  const last = idx === STEPS.length - 1;
  const place = cardPlacement(rect);

  return (
    <div className="tour" role="dialog" aria-modal="false" aria-label="Recorrido guiado">
      {rect && <div className="tour-spot" style={rect} />}
      <div className={`tour-card ${place.cls}`} style={place.style} aria-live="polite">
        <div className="tour-meta">
          <span className="eyebrow">Recorrido guiado · {idx + 1} de {STEPS.length}</span>
          <button className="icon-btn sm" onClick={exit} aria-label="Salir del recorrido"><Icon name="close" size={16} /></button>
        </div>
        <h3>{step.title}</h3>
        <p>{step.body}</p>
        <div className="tour-progress" aria-hidden="true">
          {STEPS.map((_, i) => <i key={i} className={i < idx ? 'done' : i === idx ? 'now' : ''} style={i === idx ? { ['--p' as string]: progress } : undefined} />)}
        </div>
        <div className="tour-actions">
          {last ? (<>
            <button className="btn" onClick={() => setIdx(0)}><Icon name="reset" size={16} />Repetir</button>
            <button className="btn" onClick={() => { exit(); onPresent(); }}><Icon name="film" size={16} />Ver presentación</button>
            <button className="btn primary" onClick={exit} autoFocus>Explorar</button>
          </>) : (<>
            <button className="icon-btn" onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0} aria-label="Paso anterior"><Icon name="prev" size={16} /></button>
            <button className="icon-btn" onClick={() => setPaused((p) => !p)} aria-label={paused ? 'Seguir el recorrido' : 'Pausar el recorrido'}><Icon name={paused ? 'play' : 'pause'} size={16} /></button>
            <button className="icon-btn" onClick={() => setIdx((i) => Math.min(STEPS.length - 1, i + 1))} aria-label="Paso siguiente"><Icon name="skip" size={16} /></button>
            <span className="tour-keys">Espacio pausa · ← → pasos · Esc salir</span>
          </>)}
        </div>
      </div>
    </div>
  );
}

/** Put the caption next to the spotlight on the side with the most room; centered at the bottom otherwise. */
function cardPlacement(r: Rect | null): { cls: string; style: React.CSSProperties } {
  const W = window.innerWidth, H = window.innerHeight, CW = 380, gap = 18;
  if (!r || W < 760) return { cls: 'bottom', style: {} };
  const right = W - (r.left + r.width), left = r.left;
  const top = Math.min(Math.max(16, r.top), H - 300);
  if (right >= CW + gap * 2 && right >= left) return { cls: 'side', style: { left: r.left + r.width + gap, top } };
  if (left >= CW + gap * 2) return { cls: 'side', style: { left: r.left - CW - gap, top } };
  if (r.top > 320) return { cls: 'side', style: { left: Math.min(W - CW - 16, Math.max(16, r.left + r.width / 2 - CW / 2)), top: r.top - 250 } };
  return { cls: 'bottom', style: {} };
}
