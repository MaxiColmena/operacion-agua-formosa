import { readFileSync, writeFileSync } from 'node:fs';
import { encodePng } from './png';
const meta = JSON.parse(readFileSync('public/data/terrain.json', 'utf8'));
const z = new Float32Array(readFileSync('public/data/terrain.bin').buffer.slice(0));
const { width: w, height: h } = meta;
const out = new Uint8Array(w * h * 4);
const hist: Record<number, number> = {};
for (let i = 0; i < w * h; i++) {
  const v = z[i]; hist[Math.floor(v)] = (hist[Math.floor(v)] ?? 0) + 1;
  const t = Math.max(0, Math.min(1, (v - 49) / 13));
  // bandas cada 1 m para leer cotas
  const band = Math.floor(v) % 2 ? 0.85 : 1;
  out[i * 4] = 255 * t * band; out[i * 4 + 1] = 255 * (1 - Math.abs(t - 0.5) * 2) * band; out[i * 4 + 2] = 255 * (1 - t) * band; out[i * 4 + 3] = 255;
}
writeFileSync(process.argv[2], encodePng(w, h, out));
console.log(hist);
