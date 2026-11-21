// Records the in-app cinematic presentation (~95 s) to an MP4 file, unattended.
//
//   npx tsx scripts/record-presentation.ts                 → presentation/video-tutorial.mp4
//   npx tsx scripts/record-presentation.ts --headed        → visible-GPU fallback (window placed off-screen)
//   npx tsx scripts/record-presentation.ts --out <file>    → custom output path
//   npx tsx scripts/record-presentation.ts --bitrate 10    → starting video bitrate in Mbps (default 4)
//   npx tsx scripts/record-presentation.ts --max-mb 95     → size limit; if exceeded it re-records at a lower bitrate (default 95, under GitHub's 100 MB)
//
// How it works: starts its own Vite dev server on a free port, opens the app in Microsoft Edge or
// Google Chrome through the DevTools protocol (Node's built-in WebSocket, no extra dependencies),
// clicks «Presentación» → «Reproducir y grabar video» and waits. The app records its own WebGL canvas
// with MediaRecorder; in dev mode it posts the file to /__save-recording (vite.config.ts), and this
// script moves that copy to the output path. It does not modify any app file.
import { spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, unlinkSync } from 'node:fs';
import { createServer as netServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { createServer } from 'vite';

const ROOT = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const OUT = resolve(ROOT, opt('--out') ?? 'presentation/video-tutorial.mp4');
const HEADED = flag('--headed');
const START_MBPS = Number(opt('--bitrate') ?? 4);
const MAX_MB = Number(opt('--max-mb') ?? 95);
const W = 1920, H = 1080;
const TIMEOUT_S = 420;

const BROWSERS = [
  process.env.BROWSER_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/microsoft-edge',
].filter((p): p is string => !!p);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (m: string) => console.log(`[record] ${m}`);

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = netServer();
    s.once('error', rej);
    s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => res(p)); });
  });
}

/** Minimal DevTools-protocol client over Node's global WebSocket. */
class Cdp {
  private id = 0;
  private pending = new Map<number, { res: (v: any) => void; rej: (e: Error) => void }>();
  private constructor(private ws: WebSocket) {
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data));
      const p = msg.id != null && this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.rej(new Error(`${msg.error.message} (${msg.error.code})`)); else p.res(msg.result);
    });
  }
  static connect(url: string): Promise<Cdp> {
    return new Promise((res, rej) => {
      const ws = new WebSocket(url);
      ws.addEventListener('open', () => res(new Cdp(ws)), { once: true });
      ws.addEventListener('error', () => rej(new Error(`cannot connect to ${url}`)), { once: true });
    });
  }
  send<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.pending.set(id, { res, rej }));
  }
  /** Evaluates an expression in the page (awaiting promises) and returns its JSON value. */
  async eval<T = any>(expression: string): Promise<T> {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value as T;
  }
  close() { this.ws.close(); }
}

async function waitFor<T>(what: string, fn: () => Promise<T | null | undefined | false>, timeoutS: number, everyMs = 500): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* not ready yet */ }
    if (Date.now() - t0 > timeoutS * 1000) throw new Error(`timed out waiting for ${what}`);
    await sleep(everyMs);
  }
}

/** One full recording run at the given bitrate; returns the output path and its size in bytes. */
async function record(BITRATE_MBPS: number): Promise<{ out: string; size: number }> {
  const exe = BROWSERS.find((p) => existsSync(p));
  if (!exe) throw new Error('Chrome or Edge not found. Set BROWSER_PATH to a Chromium-based browser executable.');

  // 1. Own dev server (the recording endpoint only exists in dev).
  const server = await createServer({ root: ROOT, logLevel: 'warn', server: { port: await freePort(), strictPort: true, open: false } });
  await server.listen();
  const appUrl = server.resolvedUrls?.local[0] ?? `http://localhost:${server.config.server.port}/`;
  log(`dev server at ${appUrl}`);

  // 2. Browser with remote debugging, real GPU, no background throttling.
  const debugPort = await freePort();
  const profile = mkdtempSync(join(tmpdir(), 'oa-record-'));
  const browserArgs = [
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, `--window-size=${W},${H}`, '--force-device-scale-factor=1',
    '--no-first-run', '--no-default-browser-check', '--mute-audio', '--hide-scrollbars', '--disable-extensions',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--disable-features=CalculateNativeWinOcclusion',
    HEADED ? '--window-position=-2600,0' : '--headless=new',
    'about:blank',
  ];
  let browser: ChildProcess | null = spawn(exe, browserArgs, { stdio: 'ignore' });
  let cdp: Cdp | null = null;
  const cleanup = async () => {
    try { await cdp?.send('Browser.close'); } catch { /* already closed */ }
    cdp?.close();
    if (browser && browser.exitCode == null) browser.kill();
    browser = null;
    await server.close();
    await sleep(500);
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* profile still locked: harmless temp dir */ }
  };

  try {
    const target = await waitFor('browser DevTools endpoint', async () => {
      const list = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
      return list.find((t) => t.type === 'page');
    }, 30);
    cdp = await Cdp.connect(target.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    // The app records at a high bitrate for local use; cap it here without touching app code.
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
      const MR = window.MediaRecorder;
      if (!MR) return;
      window.MediaRecorder = class extends MR {
        constructor(stream, opts = {}) { super(stream, { ...opts, videoBitsPerSecond: ${Math.round(BITRATE_MBPS * 1e6)} }); }
      };
    })();` });
    await cdp.send('Page.navigate', { url: appUrl });

    // 3. Wait until terrain, buildings and OSM data are loaded (the welcome buttons enable themselves).
    await waitFor('the app to load its data', () => cdp!.eval<boolean>(`(() => {
      const b = [...document.querySelectorAll('.guide-actions button')].find((x) => x.textContent.includes('Presentación'));
      return !!b && !b.disabled && document.fonts.status === 'loaded';
    })()`), 180);
    const gpu = await cdp.eval<{ renderer: string; fps: number }>(`(async () => {
      const gl = document.querySelector('.viewport canvas')?.getContext('webgl2');
      const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
      let n = 0; const t0 = performance.now();
      await new Promise((r) => { const f = () => { n++; performance.now() - t0 < 2000 ? requestAnimationFrame(f) : r(); }; requestAnimationFrame(f); });
      return { renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown', fps: Math.round(n / 2) };
    })()`);
    log(`GPU: ${gpu.renderer} · ${gpu.fps} fps before recording`);
    if (/swiftshader|software/i.test(gpu.renderer) || gpu.fps < 20) {
      log('WARNING: software rendering or low frame rate — the video may stutter. Try --headed.');
    }

    // 4. Presentation → record.
    await cdp.eval(`[...document.querySelectorAll('.guide-actions button')].find((x) => x.textContent.includes('Presentación')).click()`);
    await waitFor('the presentation menu', () => cdp!.eval<boolean>(`[...document.querySelectorAll('button')].some((x) => x.textContent.includes('Reproducir y grabar video'))`), 15);
    await cdp.eval(`[...document.querySelectorAll('button')].find((x) => x.textContent.includes('Reproducir y grabar video')).click()`);
    log(`recording at ${BITRATE_MBPS} Mbps… (about 95 s)`);
    const started = Date.now();
    const recErr = await cdp.eval<string | null>(`new Promise((r) => setTimeout(() => r(document.querySelector('.cinema-menu .hint.warn')?.textContent ?? null), 1500))`);
    if (recErr) throw new Error(`the page could not record: ${recErr}`);

    // 5. Wait for the dev server copy («Copia guardada en presentacion/<file>»).
    const saved = await waitFor('the recorded video', async () => {
      const s = await cdp!.eval<string | null>(`document.querySelector('.video-ready small')?.textContent ?? null`);
      const sec = Math.round((Date.now() - started) / 1000);
      if (sec % 15 === 0) log(`  ${sec} s`);
      const m = s?.match(/presentacion\/[\w.-]+\.(mp4|webm)/);
      return m ? m[0] : null;
    }, TIMEOUT_S, 1000);

    // 6. Move it to the output path.
    const src = join(ROOT, saved);
    const ext = extname(src);
    const out = extname(OUT) === ext ? OUT : OUT.replace(/\.[^.]+$/, ext);
    if (ext !== extname(OUT)) log(`WARNING: this browser recorded ${ext}, not ${extname(OUT)}; saving as ${out}`);
    mkdirSync(dirname(out), { recursive: true });
    copyFileSync(src, out);
    unlinkSync(src);
    const size = statSync(out).size;
    log(`saved ${out} (${(size / 1e6).toFixed(1)} MB, ${Math.round((Date.now() - started) / 1000)} s of capture)`);
    return { out, size };
  } finally {
    await cleanup();
  }
}

/** Hardware encoders overshoot the requested bitrate, so the size limit is enforced by re-recording. */
async function main() {
  let mbps = START_MBPS;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { size } = await record(mbps);
    if (size <= MAX_MB * 1e6) return;
    if (attempt === 3) { log(`WARNING: still ${(size / 1e6).toFixed(1)} MB after 3 attempts (limit ${MAX_MB} MB).`); return; }
    mbps = +(mbps * ((MAX_MB * 1e6) / size) * 0.9).toFixed(2);
    log(`over ${MAX_MB} MB: recording again at ${mbps} Mbps`);
  }
}

main().then(() => process.exit(0), (e) => { console.error(`[record] ${e instanceof Error ? e.message : e}`); process.exit(1); });
