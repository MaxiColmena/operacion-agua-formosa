import { useEffect } from 'react';
import { Icon } from './icons';

const STEPS = [
  { t: 'Elegí un escenario', d: 'Lluvia y altura del río Paraguay, con niveles de referencia y crecidas históricas.' },
  { t: 'Hacé llover', d: 'El agua cae, escurre por las pendientes y se junta en los bajos, en tiempo acelerado.' },
  { t: 'Mirá qué se afecta primero', d: 'Calles, barrios e instalaciones ordenados por cuándo les llega el agua.' },
  { t: 'Decidí con datos', d: 'El tablero de análisis resume prioridades, márgenes del río y el valor de la defensa.' },
];

/**
 * Welcome screen shown every time the app starts. «Empezar» launches the automatic guided tour.
 */
export function WelcomeGuide({ ready, onStart, onSkip, onPresent }: { ready: boolean; onStart: () => void; onSkip: () => void; onPresent: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onSkip(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSkip]);

  return (
    <div className="modal-bg welcome-bg">
      <div className="modal guide" role="dialog" aria-modal="true" aria-labelledby="guide-title">
        <span className="eyebrow">Operación Agua · Formosa Capital</span>
        <h2 id="guide-title">Qué pasa en Formosa cuando llueve fuerte y crece el río</h2>
        <p className="lead">
          Un simulador 3D de la ciudad: elegís cuánta lluvia cae y a qué altura está el río, y muestra
          <b> por dónde corre el agua, qué calles se cortan y qué barrios e instalaciones se afectan primero</b>.
        </p>
        <ol className="guide-steps">
          {STEPS.map((s, i) => (
            <li key={s.t}><span className="guide-n">{i + 1}</span><div><b>{s.t}</b><p>{s.d}</p></div></li>
          ))}
        </ol>
        <div className="guide-actions">
          <button className="btn ghost" onClick={onSkip}>Explorar por mi cuenta</button>
          <button className="btn" onClick={onPresent} disabled={!ready}><Icon name="film" size={16} />Presentación</button>
          <button className="btn primary lg" onClick={onStart} disabled={!ready} autoFocus>
            <Icon name="play" size={16} />{ready ? 'Empezar' : 'Cargando el modelo…'}
          </button>
        </div>
        <p className="hint guide-foot">«Empezar» inicia un recorrido automático por todas las funciones (Esc para salir en cualquier momento).</p>
      </div>
    </div>
  );
}
