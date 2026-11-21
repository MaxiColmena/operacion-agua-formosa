// Cinematic presentation: an architectural-model style fly-through of the whole flow, with titles,
// that can be recorded to a video file straight from the WebGL canvas (MediaRecorder).
import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { DemoApi, DemoSnapshot } from './demo';
import { CameraPath, LANDMARKS, PathPlayer, type CamKey } from '../scene/Cinematic';
import { Icon } from './icons';

interface Chapter {
  t0: number;
  t1: number;
  kicker?: string;
  title: string;
  /** Static subtitle, or built from live results. */
  sub: string | ((s: DemoSnapshot) => string);
  style?: 'hero' | 'lower' | 'summary';
  enter?: (api: DemoApi) => void;
}

const nf = (v: number, d = 0) => v.toLocaleString('es-AR', { maximumFractionDigits: d, minimumFractionDigits: d });

const CHAPTERS: Chapter[] = [
  {
    t0: 0, t1: 7.5, style: 'hero', title: 'Operación Agua', sub: 'Simulador de lluvia y crecida · Formosa Capital',
    enter: (api) => {
      api.setAnalytics(false); api.setViewMenu(false); api.clearSelection();
      api.setLayers({ water: true, zones: false, buildings: true, lines: true, labels: false, facilities: true, drainage: false });
      api.setWaterMode('depth'); api.applyPreset('n2'); api.setSpeed(900);
    },
  },
  { t0: 7.5, t1: 21, kicker: 'El modelo', title: 'La ciudad como maqueta', sub: '81.695 edificios sobre un terreno de 30 m, con calles, riachos y lagunas' },
  { t0: 21, t1: 35, kicker: 'El borde', title: 'El río Paraguay y la defensa', sub: 'Un anillo de terraplén con coronamiento a 11,70 m de escala protege la ciudad' },
  {
    t0: 35, t1: 52, kicker: 'Escenario · Nivel 2', title: 'Llueve: 105 mm en 1 h 30 min', sub: 'Temporal severo con el río en alerta (7,80 m): el desagüe por gravedad se corta',
    enter: (api) => api.play(),
  },
  {
    t0: 52, t1: 62, kicker: 'Resultados en vivo', title: 'Calles y edificios con agua',
    sub: (s) => `${nf(s.curbKm, 1)} km de calles sobre el cordón · ${nf(s.buildingsWet)} edificios con agua`,
  },
  {
    t0: 62, t1: 70, kicker: 'Infraestructura', title: 'Servicios críticos',
    sub: (s) => s.facilitiesAffected
      ? `${s.facilitiesAffected} instalaciones con agua, ${s.criticalAffected} críticas${s.worstFacility ? ` · la más comprometida: ${s.worstFacility}` : ''}`
      : 'Hospitales, salud, bomberos, agua y energía: en qué orden les llega el agua',
  },
  {
    t0: 70, t1: 80, kicker: 'Mapa precalculado', title: 'Zonas 1º, 2º y 3º', sub: 'Qué se inunda con lluvia fuerte, con temporal severo y solo en el extremo',
    enter: (api) => api.setLayers({ zones: true }),
  },
  {
    t0: 80, t1: 88, style: 'summary', kicker: 'Para decidir', title: 'Lo que deja este escenario', sub: '',
    enter: (api) => api.setLayers({ zones: false }),
  },
  { t0: 88, t1: 95, style: 'hero', title: 'Simulá. Anticipá. Decidí.', sub: 'Operación Agua · Juegos Provinciales Tecnológicos · 5ª edición' },
];
const TOTAL = CHAPTERS[CHAPTERS.length - 1].t1;

function buildPath(api: DemoApi): CameraPath | null {
  const sc = api.scene();
  if (!sc) return null;
  const at = (ll: readonly [number, number]) => sc.lonLatToWorld(ll[0], ll[1]);
  const C = at(LANDMARKS.center), P = at(LANDMARKS.port), H = at(LANDMARKS.hospitalCentral);
  const k = (t: number, base: THREE.Vector3, off: [number, number, number], tgt: THREE.Vector3, toff: [number, number, number] = [0, 0, 0]): CamKey => ({
    t, pos: base.clone().add(new THREE.Vector3(...off)), target: tgt.clone().add(new THREE.Vector3(...toff)),
  });
  return new CameraPath([
    k(0, C, [-6.5, 9.5, 9.5], C, [0, 0, 1]),
    k(8, C, [-2.4, 3.4, 4.4], C),
    k(14, C, [0.35, 0.6, 1.3], C, [0, 0, -0.2]),
    k(21, C, [1.35, 0.38, 0.35], C, [0.35, 0, -0.65]),
    k(28, P, [1.7, 0.95, 1.05], P),
    k(35, P, [0.45, 0.75, -2.3], P, [-0.3, 0, -1.0]),
    k(43, C, [3.6, 4.6, 4.6], C),
    k(52, C, [-3.6, 3.9, 3.9], C),
    k(61, C, [-0.85, 0.85, 1.45], C, [0, 0, 0.2]),
    k(69, H, [0.55, 0.5, 0.75], H),
    k(79, C, [0.2, 9.8, 2.3], C),
    k(88, C, [4.2, 6.2, 8.2], C),
    k(95, C, [-6.5, 10.5, 10.5], C),
  ]);
}

type Phase = 'menu' | 'playing' | 'done';

export function Presentation({ api, onExit }: { api: DemoApi; onExit: () => void }) {
  const [phase, setPhase] = useState<Phase>('menu');
  const [recording, setRecording] = useState(false);
  const [video, setVideo] = useState<{ url: string; name: string; size: number; saved?: string } | null>(null);
  const [recError, setRecError] = useState<string | null>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<PathPlayer | null>(null);
  const recRef = useRef<{ rec: MediaRecorder; canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null>(null);
  const entered = useRef(new Set<number>());

  const cleanup = useCallback(() => {
    const sc = api.scene();
    playerRef.current?.stop();
    playerRef.current = null;
    if (sc) sc.onAfterRender = null;
    if (recRef.current && recRef.current.rec.state !== 'inactive') recRef.current.rec.stop();
  }, [api]);

  useEffect(() => () => cleanup(), [cleanup]);
  useEffect(() => () => { if (video) URL.revokeObjectURL(video.url); }, [video]);

  const finish = useCallback(() => {
    cleanup();
    setPhase('done');
  }, [cleanup]);

  const start = (record: boolean) => {
    const sc = api.scene();
    const path = buildPath(api);
    if (!sc || !path) return;
    setRecError(null);
    entered.current.clear();
    api.reset();
    const gl = sc.renderer.domElement;
    const overlay = overlayRef.current!;
    overlay.width = gl.width; overlay.height = gl.height;
    const octx = overlay.getContext('2d')!;

    if (record) {
      const canvas = document.createElement('canvas');
      canvas.width = gl.width; canvas.height = gl.height;
      const ctx = canvas.getContext('2d')!;
      const mime = ['video/mp4;codecs=avc1.640028', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
        .find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m));
      if (!mime) { setRecError('Este navegador no permite grabar video desde la página. Probá con Chrome o Edge.'); return; }
      const rec = new MediaRecorder(canvas.captureStream(60), { mimeType: mime, videoBitsPerSecond: 16_000_000 });
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = () => {
        const blob = new Blob(chunks, { type: mime.split(';')[0] });
        const name = `operacion-agua-presentacion.${mime.startsWith('video/mp4') ? 'mp4' : 'webm'}`;
        const url = URL.createObjectURL(blob);
        setVideo({ url, name, size: blob.size });
        setRecording(false);
        if (import.meta.env.DEV) {
          // Dev only: the Vite dev server keeps a copy in ./presentacion (see vite.config.ts).
          fetch(`/__save-recording?name=${encodeURIComponent(name)}`, { method: 'POST', body: blob })
            .then((r) => (r.ok ? r.text() : Promise.reject(r.statusText)))
            .then((path) => setVideo((v) => (v ? { ...v, saved: path } : v)))
            .catch(() => { /* saving to disk is a convenience */ });
        }
      };
      rec.start(1000);
      recRef.current = { rec, canvas, ctx };
      setRecording(true);
    }

    sc.onAfterRender = (src) => {
      const t = playerRef.current?.time ?? 0;
      drawOverlay(octx, overlay, t, api);
      const r = recRef.current;
      if (r && r.rec.state === 'recording') {
        r.ctx.drawImage(src, 0, 0, r.canvas.width, r.canvas.height);
        r.ctx.drawImage(overlay, 0, 0, r.canvas.width, r.canvas.height);
      }
      CHAPTERS.forEach((c, i) => {
        if (t >= c.t0 && !entered.current.has(i)) { entered.current.add(i); c.enter?.(api); }
      });
    };
    playerRef.current = new PathPlayer(sc, path, finish);
    setPhase('playing');
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (phase === 'playing') finish(); else onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, finish, onExit]);

  return (
    <div className={`cinema cinema-${phase}`}>
      <canvas ref={overlayRef} className="cinema-overlay" />
      {phase === 'playing' && (
        <div className="cinema-hud">
          {recording && <span className="rec-dot"><Icon name="record" size={12} />Grabando</span>}
          <button className="btn ghost sm" onClick={finish}>Terminar (Esc)</button>
        </div>
      )}
      {phase !== 'playing' && (
        <div className="modal-bg" onClick={onExit}>
          <div className="modal cinema-menu" role="dialog" aria-modal="true" aria-labelledby="cine-title" onClick={(e) => e.stopPropagation()}>
            <button className="icon-btn x" onClick={onExit} aria-label="Cerrar"><Icon name="close" /></button>
            <span className="eyebrow">Presentación</span>
            <h2 id="cine-title">{phase === 'done' ? 'Presentación terminada' : 'Recorrido cinematográfico'}</h2>
            <p className="lead">
              Un vuelo de {Math.round(TOTAL)} segundos sobre la maqueta 3D de Formosa: la ciudad, el río y la defensa, un temporal severo en vivo,
              las calles e instalaciones que se afectan, las zonas de riesgo y un resumen para decidir.
            </p>
            {video && (
              <div className="video-ready">
                <video src={video.url} controls muted playsInline />
                <div>
                  <b>Video listo · {(video.size / 1e6).toFixed(1)} MB</b>
                  {video.saved && <small>Copia guardada en {video.saved}</small>}
                  <a className="btn primary" href={video.url} download={video.name}><Icon name="download" size={16} />Descargar {video.name.split('.').pop()?.toUpperCase()}</a>
                </div>
              </div>
            )}
            {recError && <p className="hint warn">{recError}</p>}
            <div className="guide-actions">
              <button className="btn" onClick={() => start(true)}><Icon name="record" size={14} />Reproducir y grabar video</button>
              <button className="btn primary" onClick={() => start(false)} autoFocus><Icon name="play" size={14} />{phase === 'done' ? 'Ver de nuevo' : 'Reproducir'}</button>
            </div>
            <p className="hint">Para un video nítido, poné la ventana en pantalla completa (F11) antes de grabar. Durante la reproducción, Esc termina.</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- titles drawn on a canvas, so the recording carries them too ----------

function drawOverlay(ctx: CanvasRenderingContext2D, cv: HTMLCanvasElement, t: number, api: DemoApi) {
  const W = cv.width, H = cv.height, u = H / 1080;
  ctx.clearRect(0, 0, W, H);
  // Letterbox bars (cinema 2.2:1 feel), easing in during the first second.
  const bar = H * 0.085 * Math.min(1, t / 1.2) * Math.min(1, Math.max(0, (TOTAL - t) / 1.2) + 0.0001);
  ctx.fillStyle = '#05070a';
  ctx.fillRect(0, 0, W, bar);
  ctx.fillRect(0, H - bar, W, bar);
  // Progress hairline in the bottom bar.
  ctx.fillStyle = 'rgba(120, 190, 215, 0.55)';
  ctx.fillRect(0, H - 3 * u, W * (t / TOTAL), 3 * u);

  const ch = CHAPTERS.find((c) => t >= c.t0 && t < c.t1);
  if (!ch) return;
  const fadeIn = Math.min(1, (t - ch.t0) / 0.9), fadeOut = Math.min(1, (ch.t1 - t) / 0.7);
  const a = Math.max(0, Math.min(fadeIn, fadeOut));
  const rise = (1 - fadeIn) * 14 * u;
  const snap = api.snapshot();
  const sub = typeof ch.sub === 'function' ? ch.sub(snap) : ch.sub;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(0,0,0,0.65)';
  ctx.shadowBlur = 18 * u;
  if (ch.style === 'hero') {
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f2f6f8';
    ctx.font = `700 ${Math.round(92 * u)}px "Bricolage Grotesque", system-ui, sans-serif`;
    ctx.fillText(ch.title, W / 2, H * 0.47 + rise);
    ctx.fillStyle = 'rgba(214, 228, 236, 0.86)';
    ctx.font = `400 ${Math.round(32 * u)}px "Atkinson Hyperlegible Next", system-ui, sans-serif`;
    ctx.fillText(sub, W / 2, H * 0.47 + 62 * u + rise);
  } else if (ch.style === 'summary') {
    const x = 96 * u, y0 = H * 0.3;
    ctx.textAlign = 'left';
    kickerText(ctx, ch.kicker ?? '', x, y0 + rise, u);
    ctx.fillStyle = '#f2f6f8';
    ctx.font = `700 ${Math.round(56 * u)}px "Bricolage Grotesque", system-ui, sans-serif`;
    ctx.fillText(ch.title, x, y0 + 64 * u + rise);
    const rows: [string, string][] = [
      [`${nf(snap.curbKm, 1)} km`, 'de calles con agua sobre el cordón'],
      [`${nf(snap.impassableKm, 1)} km`, 'intransitables (más de 30 cm)'],
      [nf(snap.buildingsWet), 'edificios con agua'],
      [`${snap.facilitiesAffected}`, `instalaciones afectadas (${snap.criticalAffected} críticas)`],
      [`${snap.barriosAffected}`, 'barrios con más del 5 % bajo agua'],
    ];
    rows.forEach(([v, l], i) => {
      const y = y0 + (132 + i * 64) * u + rise;
      ctx.fillStyle = '#8fd3e8';
      ctx.font = `600 ${Math.round(42 * u)}px "Atkinson Hyperlegible Mono", ui-monospace, monospace`;
      ctx.fillText(v, x, y);
      const vw = ctx.measureText(v).width;
      ctx.fillStyle = 'rgba(214, 228, 236, 0.9)';
      ctx.font = `400 ${Math.round(28 * u)}px "Atkinson Hyperlegible Next", system-ui, sans-serif`;
      ctx.fillText(l, x + vw + 18 * u, y);
    });
  } else {
    const x = 96 * u, y = H - bar - 72 * u + rise;
    ctx.textAlign = 'left';
    kickerText(ctx, ch.kicker ?? '', x, y - 70 * u, u);
    ctx.fillStyle = '#f2f6f8';
    ctx.font = `700 ${Math.round(54 * u)}px "Bricolage Grotesque", system-ui, sans-serif`;
    ctx.fillText(ch.title, x, y - 14 * u);
    ctx.fillStyle = 'rgba(214, 228, 236, 0.88)';
    ctx.font = `400 ${Math.round(28 * u)}px "Atkinson Hyperlegible Next", system-ui, sans-serif`;
    ctx.fillText(sub, x, y + 30 * u);
  }
  ctx.restore();
}

function kickerText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, u: number) {
  if (!text) return;
  ctx.fillStyle = '#8fd3e8';
  ctx.font = `600 ${Math.round(22 * u)}px "Atkinson Hyperlegible Next", system-ui, sans-serif`;
  ctx.fillText(text.toUpperCase().split('').join(String.fromCharCode(8202)), x, y);
}
