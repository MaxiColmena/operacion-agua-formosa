import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

/**
 * Dev-only: keeps a copy of the presentation video recorded in the browser under ./presentacion.
 * The production build never includes this endpoint; there the video is only offered as a download.
 */
function saveRecording(): Plugin {
  return {
    name: 'save-recording',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__save-recording', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        const url = new URL(req.url ?? '', 'http://localhost');
        const raw = basename(url.searchParams.get('name') ?? 'presentacion.webm');
        const name = /^[\w.-]+\.(webm|mp4)$/.test(raw) ? raw : 'presentacion.webm';
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          const dir = join(server.config.root, 'presentacion');
          mkdirSync(dir, { recursive: true });
          writeFileSync(join(dir, name), Buffer.concat(chunks));
          res.setHeader('Content-Type', 'text/plain');
          res.end(`presentacion/${name}`);
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), saveRecording()],
  server: { port: 5173 },
  worker: { format: 'es' },
});
