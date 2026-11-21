// Generates the PWA icons (PNG + SVG) procedurally: three waves = the three water levels.
// Usage: npx tsx scripts/build-icons.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { encodePng } from './png';

const OUT = 'public/icons';
const BG = [11, 17, 24];
// Level colors from the UI scale (3rd → 1st level, light → deep).
const WAVES: { y: number; color: number[] }[] = [
  { y: 0.36, color: [155, 220, 255] },
  { y: 0.52, color: [79, 163, 255] },
  { y: 0.68, color: [74, 107, 255] },
];
const AMP = 0.045;
const FREQ = 2.2; // full periods across the drawable width
const STROKE = 0.052;

/** Renders the mark. `inset` shrinks the drawing (maskable icons need a safe zone). */
function render(size: number, { inset = 0.2, rounded = true } = {}) {
  const px = new Uint8Array(size * size * 4);
  const ss = 4; // supersampling per axis
  const radius = rounded ? 0.22 : 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = (x + (sx + 0.5) / ss) / size;
          const v = (y + (sy + 0.5) / ss) / size;
          // Rounded-square background.
          const dx = Math.max(Math.abs(u - 0.5) - (0.5 - radius), 0);
          const dy = Math.max(Math.abs(v - 0.5) - (0.5 - radius), 0);
          if (Math.hypot(dx, dy) > radius) continue;
          let c = BG;
          const lo = inset, hi = 1 - inset;
          if (u >= lo && u <= hi) {
            const t = (u - lo) / (hi - lo);
            for (const w of WAVES) {
              const cy = lo + (hi - lo) * w.y + AMP * (1 - 2 * inset) * Math.sin(t * Math.PI * 2 * FREQ);
              if (Math.abs(v - cy) < (STROKE * (1 - 2 * inset)) / 2) c = w.color;
            }
          }
          r += c[0]; g += c[1]; b += c[2]; a += 255;
        }
      }
      const n = ss * ss, i = (y * size + x) * 4;
      // Un-premultiply so antialiased edges keep the right color.
      px[i] = a ? (r * 255) / a : 0;
      px[i + 1] = a ? (g * 255) / a : 0;
      px[i + 2] = a ? (b * 255) / a : 0;
      px[i + 3] = a / n;
    }
  }
  return encodePng(size, size, px);
}

function svg() {
  const inset = 0.2, lo = 512 * inset, w = 512 * (1 - 2 * inset);
  const paths = WAVES.map(({ y, color }) => {
    const pts: string[] = [];
    for (let k = 0; k <= 64; k++) {
      const t = k / 64;
      const px = lo + w * t;
      const py = lo + w * y + AMP * w * Math.sin(t * Math.PI * 2 * FREQ);
      pts.push(`${k ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`);
    }
    return `<path d="${pts.join('')}" fill="none" stroke="rgb(${color.join(',')})" stroke-width="${(STROKE * w).toFixed(1)}" stroke-linecap="butt"/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="113" fill="rgb(${BG.join(',')})"/>${paths.join('')}</svg>\n`;
}

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/icon-192.png`, render(192));
writeFileSync(`${OUT}/icon-512.png`, render(512));
writeFileSync(`${OUT}/maskable-512.png`, render(512, { inset: 0.28, rounded: false }));
writeFileSync(`${OUT}/apple-touch-icon.png`, render(180, { rounded: false }));
writeFileSync(`${OUT}/icon.svg`, svg());
console.log('icons written to', OUT);
