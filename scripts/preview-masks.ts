// Vista previa de las máscaras: río (azul), agua permanente (celeste), defensa (magenta), brecha (amarillo) sobre el relieve.
import { readFileSync, writeFileSync } from 'node:fs';
import { encodePng } from './png';
const meta = JSON.parse(readFileSync('public/data/terrain.json', 'utf8'));
const z = new Float32Array(readFileSync('public/data/terrain.bin').buffer.slice(0));
const m = new Uint8Array(readFileSync('public/data/masks.bin'));
const { width: w, height: h } = meta;
const out = new Uint8Array(w * h * 4);
for (let i = 0; i < w * h; i++) {
  const g = 40 + Math.max(0, Math.min(1, (z[i] - 49) / 13)) * 160;
  let c = [g, g, g];
  if (m[i] & 1) c = [20, 60, 220]; else if (m[i] & 4) c = [80, 200, 255]; if (m[i] & 2) c = [255, 0, 220]; if (m[i] & 8) c = [255, 220, 0];
  out.set([c[0], c[1], c[2], 255], i * 4);
}
writeFileSync(process.argv[2] ?? 'masks.png', encodePng(w, h, out));
