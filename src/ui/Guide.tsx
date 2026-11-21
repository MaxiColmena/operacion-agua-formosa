import { useEffect, useRef } from 'react';
import { Icon } from './Icon';

const KEY = 'oa-guide-seen-v1';

/** ¿Ya vio la guía? Si el almacenamiento falla (modo privado, etc.), se muestra igual. */
export function guideSeen(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}
export function markGuideSeen() {
  try { localStorage.setItem(KEY, '1'); } catch { /* sin almacenamiento: no pasa nada */ }
}

const STEPS = [
  { t: 'Elegí un escenario', d: 'En el panel Escenario: Nivel 1, 2, 3 o la crecida histórica de 1983. Cada uno combina cuánta lluvia cae y qué tan alto está el río Paraguay.' },
  { t: 'Hacé llover', d: 'Tocá «Hacer llover» (en el celular, el botón redondo de abajo). El agua cae, corre por las pendientes y se junta en los bajos, en tiempo acelerado.' },
  { t: 'Mirá qué se afecta primero', d: 'En Resultados aparecen las calles, barrios e instalaciones (hospitales, escuelas…) ordenados por cuándo les llega el agua. Hacé clic en uno para verlo en el mapa.' },
  { t: 'Revisá supuestos y límites', d: 'Es un escenario hipotético, no un pronóstico. En «Supuestos y límites»  está qué datos usamos y qué no podemos asegurar.' },
];

/**
 * Welcome screen, shown every time the app starts. «Empezar» launches the automatic guided tour;
 * closing it (×, Esc or the backdrop) goes straight to the simulator.
 */
export function WelcomeGuide({ ready, onClose, onStart, onPresent, onShowInfo }: {
  ready: boolean; onClose: () => void; onStart: () => void; onPresent: () => void; onShowInfo: () => void;
}) {
  const startRef = useRef<HTMLButtonElement>(null);
  // Focus the main action without scrolling the dialog: on phones autoFocus jumped past the title.
  useEffect(() => { startRef.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal guide" role="dialog" aria-modal="true" aria-labelledby="guide-title" onClick={(e) => e.stopPropagation()}>
        <button className="x" onClick={onClose} aria-label="Cerrar la guía"><Icon name="close" /></button>
        <h2 id="guide-title">Un simulador de qué pasa en Formosa cuando llueve fuerte y crece el río</h2>
        <p className="lead">
          Ves la ciudad en 3D. Elegís cuánta lluvia cae y a qué altura está el río Paraguay, y el programa muestra
          <b> por dónde corre el agua, qué calles se cortan y qué barrios e instalaciones se afectan primero</b>.
        </p>
        <ol className="guide-steps">
          {STEPS.map((s, i) => (
            <li key={s.t}><span className="guide-n">{i + 1}</span><div><b>{s.t}</b><p>{s.d}</p></div></li>
          ))}
        </ol>
        <p className="hint">
          Mover el mapa: arrastrá para rotar, rueda o pellizco para acercar, clic derecho o dos dedos para desplazar. Para saber qué hace un botón, pasá el mouse por encima (en el celular, mantenelo presionado).
        </p>
        <div className="guide-actions">
          <button className="btn ghost" onClick={() => { onClose(); onShowInfo(); }}>Ver supuestos y límites</button>
          <button className="btn" onClick={onPresent} disabled={!ready}><Icon name="film" size={16} />Presentación</button>
          <button ref={startRef} className="btn primary" onClick={onStart} disabled={!ready}>
            <Icon name="play" size={16} />{ready ? 'Empezar' : 'Cargando el modelo…'}
          </button>
        </div>
        <p className="hint guide-foot">«Empezar» inicia un recorrido automático por todas las funciones (Esc para salir). Podés volver a esta guía con «Cómo se usa», arriba.</p>
      </div>
    </div>
  );
}
