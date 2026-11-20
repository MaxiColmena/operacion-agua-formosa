// Umbral de exposición al río: para cada celda, la altura del río (escala de Puerto Formosa) desde la que
// queda conectada al agua. Es el "qué se afecta primero" de la crecida sin inventar tiempos (README, 2.2).
//
// Método (priority-flood, camino minimax): desde el cauce, el agua llega a una celda cuando supera el punto
// más alto del camino más bajo que la une con el río. La defensa cuenta con su coronamiento, salvo falla.
// Algoritmo portado de la rama dev-colman (src/escenario/inundacion.js).
import { MASK_DEFENSE, MASK_RIVER } from './engine';

class MinHeap {
  private keys: Float64Array;
  private idx: Int32Array;
  size = 0;
  constructor(capacity: number) {
    this.keys = new Float64Array(capacity);
    this.idx = new Int32Array(capacity);
  }
  push(k: number, i: number) {
    if (this.size === this.keys.length) this.grow();
    let p = this.size++;
    this.keys[p] = k; this.idx[p] = i;
    while (p > 0) {
      const q = (p - 1) >> 1;
      if (this.keys[q] <= this.keys[p]) break;
      this.swap(p, q); p = q;
    }
  }
  pop(): number {
    const top = this.idx[0];
    this.size--;
    if (this.size > 0) {
      this.keys[0] = this.keys[this.size]; this.idx[0] = this.idx[this.size];
      let p = 0;
      for (;;) {
        const l = 2 * p + 1, r = l + 1;
        let m = p;
        if (l < this.size && this.keys[l] < this.keys[m]) m = l;
        if (r < this.size && this.keys[r] < this.keys[m]) m = r;
        if (m === p) break;
        this.swap(p, m); p = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number) {
    const k = this.keys[a]; this.keys[a] = this.keys[b]; this.keys[b] = k;
    const i = this.idx[a]; this.idx[a] = this.idx[b]; this.idx[b] = i;
  }
  private grow() {
    const k = new Float64Array(this.keys.length * 2); k.set(this.keys); this.keys = k;
    const i = new Int32Array(this.idx.length * 2); i.set(this.idx); this.idx = i;
  }
}

/**
 * Cota mínima (m s. n. m.) que tiene que alcanzar el río para llegar a cada celda.
 * `barrier` (opcional): cota que toma la celda si es defensa (coronamiento).
 */
export function overflowElevation(width: number, height: number, z: ArrayLike<number>, mask: Uint8Array, barrier: number | null): Float64Array {
  const n = width * height;
  const out = new Float64Array(n).fill(Infinity);
  const done = new Uint8Array(n);
  const heap = new MinHeap(Math.max(16, n));
  const elev = (i: number) => (barrier != null && mask[i] & MASK_DEFENSE ? Math.max(z[i], barrier) : z[i]);
  for (let i = 0; i < n; i++) if (mask[i] & MASK_RIVER) { out[i] = elev(i); heap.push(out[i], i); }
  while (heap.size) {
    const i = heap.pop();
    if (done[i]) continue;
    done[i] = 1;
    const x = i % width, y = (i - x) / width;
    const nb = [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, y > 0 ? i - width : -1, y < height - 1 ? i + width : -1];
    for (const j of nb) {
      if (j < 0 || done[j]) continue;
      const c = Math.max(out[i], elev(j));
      if (c < out[j]) { out[j] = c; heap.push(c, j); }
    }
  }
  return out;
}

/** Pasa la cota de desborde a altura en la escala del puerto (m). */
export function overflowStage(overflow: Float64Array, gaugeZero: number): Float32Array {
  const s = new Float32Array(overflow.length);
  for (let i = 0; i < overflow.length; i++) s[i] = overflow[i] - gaugeZero;
  return s;
}
