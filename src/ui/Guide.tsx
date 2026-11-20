import { useEffect } from 'react';

const KEY = 'oa-guide-seen-v1';

/** ¿Ya vio la guía? Si el almacenamiento falla (modo privado, etc.), se muestra igual. */
export function guideSeen(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}
export function markGuideSeen() {
  try { localStorage.setItem(KEY, '1'); } catch { /* sin almacenamiento: no pasa nada */ }
}

const STEPS = [
  { t: 'Elegí un escenario', d: 'Arriba a la izquierda: Nivel 1, 2, 3 o la crecida histórica de 1983. Cada uno combina cuánta lluvia cae y qué tan alto está el río Paraguay.' },
  { t: 'Hacé llover', d: 'Tocá el botón azul «Hacer llover». El agua cae, corre por las pendientes y se junta en los bajos, en tiempo acelerado.' },
  { t: 'Mirá qué se afecta primero', d: 'A la derecha aparecen las calles, barrios e instalaciones (hospitales, escuelas…) ordenados por cuándo les llega el agua. Hacé clic en uno para verlo en el mapa.' },
  { t: 'Revisá supuestos y límites', d: 'Es un escenario hipotético, no un pronóstico. En «Supuestos y límites» (abajo a la derecha) está qué datos usamos y qué no podemos asegurar.' },
];

export function WelcomeGuide({ onClose, onShowInfo }: { onClose: () => void; onShowInfo: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal guide" role="dialog" aria-modal="true" aria-labelledby="guide-title" onClick={(e) => e.stopPropagation()}>
        <button className="x" onClick={onClose} aria-label="Cerrar la guía">×</button>
        <small className="guide-kicker">¿Qué es esto?</small>
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
          Mover el mapa: arrastrá para rotar, rueda para acercar, clic derecho para desplazar. Pasá el mouse por cualquier botón para ver qué hace.
        </p>
        <div className="guide-actions">
          <button className="btn ghost" onClick={() => { onClose(); onShowInfo(); }}>Ver supuestos y límites</button>
          <button className="btn primary" onClick={onClose} autoFocus>Empezar</button>
        </div>
        <p className="hint guide-foot">Podés volver a ver esta guía con el botón «¿Cómo se usa?» de arriba.</p>
      </div>
    </div>
  );
}
