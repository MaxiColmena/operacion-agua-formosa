/// <reference lib="webworker" />
// Corre la simulación fuera del hilo de la interfaz y publica cuadros (profundidad, llegada) unas 15 veces por segundo.
import { FloodSim, downsample, drainFactorMap, splitMasks, type Assumptions, type Grid, type Scenario } from './engine';

export type WorkerIn =
  | { type: 'init'; grid: Grid; mask: Uint8Array; factor: number; scenario: Scenario; assumptions: Assumptions; drainage: Uint8Array | null }
  | { type: 'scenario'; scenario: Scenario }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'reset' }
  | { type: 'speed'; value: number }
  | { type: 'stopAt'; seconds: number };

export interface SimStats {
  time: number;
  areaKm2: number;
  rainMm: number;
  drainedMm: number;
  maxDepth: number;
  dt: number;
  running: boolean;
  finished: boolean;
}

export type WorkerOut =
  | { type: 'ready'; width: number; height: number; cellX: number; cellY: number; zEff: Float32Array; mask: Uint8Array }
  | { type: 'frame'; d: Float32Array; tWet: Float32Array; byRiver: Uint8Array; stats: SimStats; zEff?: Float32Array };

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let sim: FloodSim | null = null;
let running = false;
let speed = 600; // segundos simulados por segundo real
let stopAt = Infinity;
let mask: Uint8Array;
let terrainDirty = false;
/** Hay algo nuevo que publicar: evita copiar y reenviar la grilla entera mientras está en pausa y nada cambió. */
let frameDirty = false;

const FRAME_MS = 66;

function post(extra = false) {
  if (!sim) return;
  const s = sim;
  const area = s.grid.width * s.grid.height * s.grid.cellX * s.grid.cellY;
  let maxDepth = 0;
  for (let i = 0; i < s.n; i++) if (!s.masks.river[i] && s.d[i] > maxDepth) maxDepth = s.d[i];
  const stats: SimStats = {
    time: s.time,
    areaKm2: s.floodedAreaKm2(),
    rainMm: (s.rainVolume / area) * 1000 * (s.n / Math.max(1, s.n - countRiver)),
    drainedMm: (s.drainVolume / area) * 1000 * (s.n / Math.max(1, s.n - countRiver)),
    maxDepth,
    dt: s.lastDt,
    running,
    finished: s.time >= stopAt - 1e-6,
  };
  const msg: WorkerOut = { type: 'frame', d: s.d.slice(), tWet: s.tWet.slice(), byRiver: s.byRiver.slice(), stats };
  const transfer: Transferable[] = [msg.d.buffer, msg.tWet.buffer, msg.byRiver.buffer];
  if (extra || terrainDirty) {
    msg.zEff = s.terrain.slice();
    transfer.push(msg.zEff.buffer);
    terrainDirty = false;
  }
  ctx.postMessage(msg, transfer);
}

let countRiver = 0;

function loop() {
  if (!sim) return;
  if (running) {
    const t0 = performance.now();
    const target = Math.min(sim.time + (speed * FRAME_MS) / 1000, stopAt);
    // Presupuesto de tiempo por cuadro: si la máquina no llega, la simulación va más lenta pero fluida.
    while (sim.time < target - 1e-6 && performance.now() - t0 < FRAME_MS * 0.85) {
      sim.advance(Math.min(target - sim.time, 60), 50);
      frameDirty = true;
    }
    if (sim.time >= stopAt - 1e-6) {
      running = false;
      frameDirty = true;
    }
  }
  if (frameDirty) {
    frameDirty = false;
    post();
  }
  setTimeout(loop, running ? 0 : FRAME_MS * 3);
}

ctx.onmessage = (e: MessageEvent<WorkerIn>) => {
  const m = e.data;
  switch (m.type) {
    case 'init': {
      const ds = downsample(m.grid, m.mask, m.factor);
      mask = ds.mask;
      sim = new FloodSim(ds.grid, splitMasks(mask), m.scenario, m.assumptions);
      if (m.drainage) sim.drainMap = drainFactorMap(m.drainage, m.grid.width, m.grid.height, m.factor, m.assumptions.drainNoNetwork);
      countRiver = sim.masks.river.reduce((a, v) => a + v, 0);
      const out: WorkerOut = {
        type: 'ready', width: ds.grid.width, height: ds.grid.height, cellX: ds.grid.cellX, cellY: ds.grid.cellY,
        zEff: sim.terrain.slice(), mask: mask.slice(),
      };
      ctx.postMessage(out);
      frameDirty = true;
      loop();
      break;
    }
    case 'scenario': {
      if (!sim) return;
      const prev = sim.scenario;
      sim.setScenario(m.scenario);
      if (prev.defenseFails !== m.scenario.defenseFails) terrainDirty = true;
      // setScenario aplica el río/defensa de inmediato (reinicia el estado): hay que publicar aunque esté en pausa.
      frameDirty = true;
      break;
    }
    case 'play':
      if (sim && sim.time >= stopAt - 1e-6) sim.reset();
      running = true;
      frameDirty = true;
      break;
    case 'pause':
      running = false;
      frameDirty = true;
      break;
    case 'reset':
      running = false;
      sim?.reset();
      terrainDirty = true;
      frameDirty = true;
      break;
    case 'speed':
      speed = m.value;
      frameDirty = true;
      break;
    case 'stopAt':
      stopAt = m.seconds;
      frameDirty = true;
      break;
  }
};
