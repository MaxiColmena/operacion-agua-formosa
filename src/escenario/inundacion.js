// Algoritmos de agua sobre una grilla regular.
// Todo es independiente del mapa: recibe arreglos y devuelve arreglos.

class MonticuloMin {
  constructor(capacidad) {
    this.claves = new Float64Array(capacidad);
    this.indices = new Int32Array(capacidad);
    this.tam = 0;
  }

  agregar(clave, indice) {
    let i = this.tam++;
    this.claves[i] = clave;
    this.indices[i] = indice;
    while (i > 0) {
      const padre = (i - 1) >> 1;
      if (this.claves[padre] <= this.claves[i]) break;
      this.intercambiar(i, padre);
      i = padre;
    }
  }

  sacar() {
    const indice = this.indices[0];
    this.tam--;
    if (this.tam > 0) {
      this.claves[0] = this.claves[this.tam];
      this.indices[0] = this.indices[this.tam];
      let i = 0;
      for (;;) {
        const izq = 2 * i + 1;
        const der = izq + 1;
        let menor = i;
        if (izq < this.tam && this.claves[izq] < this.claves[menor]) menor = izq;
        if (der < this.tam && this.claves[der] < this.claves[menor]) menor = der;
        if (menor === i) break;
        this.intercambiar(i, menor);
        i = menor;
      }
    }
    return indice;
  }

  intercambiar(a, b) {
    const c = this.claves[a];
    this.claves[a] = this.claves[b];
    this.claves[b] = c;
    const d = this.indices[a];
    this.indices[a] = this.indices[b];
    this.indices[b] = d;
  }

  vacio() {
    return this.tam === 0;
  }
}

function vecinos(i, columnas, filas, salida) {
  const x = i % columnas;
  const y = (i - x) / columnas;
  let n = 0;
  if (x > 0) salida[n++] = i - 1;
  if (x < columnas - 1) salida[n++] = i + 1;
  if (y > 0) salida[n++] = i - columnas;
  if (y < filas - 1) salida[n++] = i + columnas;
  return n;
}

// Para cada celda, la cota mínima que tiene que alcanzar el agua del río para llegar hasta ella
// (camino "minimax" desde las celdas de río). Las celdas de barrera usan su cota de coronamiento.
// Si el agua del río supera ese valor, la celda queda conectada y se inunda.
export function calcularCotaDeDesborde({ cota, esRio, columnas, filas }) {
  const total = columnas * filas;
  const desborde = new Float64Array(total).fill(Infinity);
  const visitada = new Uint8Array(total);
  const monticulo = new MonticuloMin(total * 4);
  const vec = new Int32Array(4);

  for (let i = 0; i < total; i++) {
    if (esRio[i]) {
      desborde[i] = cota[i];
      monticulo.agregar(cota[i], i);
    }
  }

  while (!monticulo.vacio()) {
    const actual = monticulo.sacar();
    if (visitada[actual]) continue;
    visitada[actual] = 1;
    const n = vecinos(actual, columnas, filas, vec);
    for (let k = 0; k < n; k++) {
      const v = vec[k];
      if (visitada[v]) continue;
      const candidato = Math.max(desborde[actual], cota[v]);
      if (candidato < desborde[v]) {
        desborde[v] = candidato;
        monticulo.agregar(candidato, v);
      }
    }
  }
  return desborde;
}

// Profundidad de cada depresión (cuánta agua de lluvia puede acumular antes de desbordar).
// Se "rellena" el terreno desde los bordes de la grilla y desde el río.
export function calcularProfundidadDeBajos({ cota, esRio, columnas, filas }) {
  const total = columnas * filas;
  const relleno = new Float64Array(total).fill(Infinity);
  const visitada = new Uint8Array(total);
  const monticulo = new MonticuloMin(total * 4);
  const vec = new Int32Array(4);

  for (let i = 0; i < total; i++) {
    const x = i % columnas;
    const y = (i - x) / columnas;
    const borde = x === 0 || y === 0 || x === columnas - 1 || y === filas - 1;
    if (borde || esRio[i]) {
      relleno[i] = cota[i];
      monticulo.agregar(cota[i], i);
    }
  }

  while (!monticulo.vacio()) {
    const actual = monticulo.sacar();
    if (visitada[actual]) continue;
    visitada[actual] = 1;
    const n = vecinos(actual, columnas, filas, vec);
    for (let k = 0; k < n; k++) {
      const v = vec[k];
      if (visitada[v]) continue;
      const candidato = Math.max(relleno[actual], cota[v]);
      if (candidato < relleno[v]) {
        relleno[v] = candidato;
        monticulo.agregar(candidato, v);
      }
    }
  }

  const profundidad = new Float64Array(total);
  for (let i = 0; i < total; i++) profundidad[i] = Math.max(0, relleno[i] - cota[i]);
  return profundidad;
}

// Capacidad del drenaje (mm) según el nivel del río.
export function capacidadDeDrenaje(nivelRio, drenaje) {
  return nivelRio >= drenaje.umbralRioAltoM ? drenaje.capacidadRioAltoMm : drenaje.capacidadNormalMm;
}

// Calcula la lámina de agua de cada celda para un nivel de río y una lluvia acumulada.
// Devuelve { profundidad, origen } donde origen: 0 seco, 1 río, 2 lluvia, 3 cauce.
export function calcularAgua({
  cotaTerreno,
  esRio,
  desborde,
  profundidadBajos,
  nivelRio,
  lluviaMm,
  ceroEscala,
  drenaje,
  minimo = 0.05,
  bajoMinimo = 0.35,
}) {
  const total = cotaTerreno.length;
  const profundidad = new Float32Array(total);
  const origen = new Uint8Array(total);
  const cotaAgua = ceroEscala + nivelRio;

  const exceso = Math.max(0, lluviaMm - capacidadDeDrenaje(nivelRio, drenaje));
  const fraccionLlena = Math.min(1, exceso / drenaje.mmParaLlenarBajos);

  for (let i = 0; i < total; i++) {
    if (esRio[i]) {
      profundidad[i] = Math.max(0, cotaAgua - cotaTerreno[i]);
      origen[i] = 3;
      continue;
    }
    let p = 0;
    let o = 0;
    if (desborde[i] < cotaAgua) {
      p = cotaAgua - cotaTerreno[i];
      o = 1;
    }
    const pLluvia = profundidadBajos[i] >= bajoMinimo ? profundidadBajos[i] * fraccionLlena : 0;
    if (pLluvia > p) {
      p = pLluvia;
      o = 2;
    }
    if (p >= minimo) {
      profundidad[i] = p;
      origen[i] = o;
    }
  }
  return { profundidad, origen, cotaAgua };
}

// Interpola la serie de un caso: devuelve { nivel, lluvia } para la hora t.
export function interpolarSerie(serie, t) {
  if (t <= serie[0][0]) return { nivel: serie[0][1], lluvia: serie[0][2] };
  for (let i = 0; i < serie.length - 1; i++) {
    const [t0, n0, l0] = serie[i];
    const [t1, n1, l1] = serie[i + 1];
    if (t <= t1) {
      const f = (t - t0) / (t1 - t0);
      return { nivel: n0 + f * (n1 - n0), lluvia: l0 + f * (l1 - l0) };
    }
  }
  const ultimo = serie[serie.length - 1];
  return { nivel: ultimo[1], lluvia: ultimo[2] };
}
