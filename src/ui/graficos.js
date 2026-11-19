// Gráficos 2D del panel izquierdo: minimapa del agua e hidrograma del caso.

import { COLUMNAS, FILAS, UMBRALES_INA } from '../escenario/datos-ficticios.js';
import { colorEstadoInfra } from '../mapa/capas.js';

const lienzoBase = document.createElement('canvas');
lienzoBase.width = COLUMNAS;
lienzoBase.height = FILAS;

export function dibujarMinimapa(canvas, modelo, agua, infra) {
  const ctx = lienzoBase.getContext('2d');
  const imagen = ctx.createImageData(COLUMNAS, FILAS);
  const { profundidad, origen } = agua;
  const rango = modelo.cotaMax - modelo.cotaMin;

  for (let i = 0; i < profundidad.length; i++) {
    const x = i % COLUMNAS;
    const y = FILAS - 1 - (i - x) / COLUMNAS;
    const p = (y * COLUMNAS + x) * 4;
    let r, g, b;
    if (profundidad[i] > 0) {
      const t = Math.min(1, profundidad[i] / 3);
      if (origen[i] === 2) [r, g, b] = [60, 210 - 70 * t, 255];
      else if (origen[i] === 3) [r, g, b] = [20, 80, 160];
      else [r, g, b] = [30, 150 - 80 * t, 255 - 30 * t];
    } else {
      const t = Math.max(0, Math.min(1, (modelo.cotaTerreno[i] - modelo.cotaMin) / rango));
      [r, g, b] = [10 + 25 * t, 22 + 55 * t, 38 + 70 * t];
    }
    if (modelo.esDefensa[i]) [r, g, b] = [255, 184, 74];
    imagen.data[p] = r;
    imagen.data[p + 1] = g;
    imagen.data[p + 2] = b;
    imagen.data[p + 3] = 255;
  }
  ctx.putImageData(imagen, 0, 0);

  const c = canvas.getContext('2d');
  c.imageSmoothingEnabled = false;
  c.clearRect(0, 0, canvas.width, canvas.height);
  c.drawImage(lienzoBase, 0, 0, canvas.width, canvas.height);

  const ex = canvas.width / COLUMNAS;
  const ey = canvas.height / FILAS;
  for (const item of infra) {
    const x = (item.celda % COLUMNAS) + 0.5;
    const y = FILAS - Math.floor(item.celda / COLUMNAS) - 0.5;
    const [r, g, b] = colorEstadoInfra(item);
    c.fillStyle = `rgb(${r},${g},${b})`;
    c.beginPath();
    c.arc(x * ex, y * ey, 3.2, 0, Math.PI * 2);
    c.fill();
  }

  c.fillStyle = '#9be9ff';
  c.font = 'bold 11px Consolas, monospace';
  c.fillText('N ↑', 8, 16);
}

export function dibujarHidrograma(canvas, caso, tActual, manual) {
  const c = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const m = { izq: 30, der: 30, arr: 10, aba: 20 };
  c.clearRect(0, 0, W, H);

  const nivelMin = 2;
  const nivelMax = 11.5;
  const lluviaMax = 250;
  const xDe = (t) => m.izq + (t / caso.duracionH) * (W - m.izq - m.der);
  const yNivel = (n) => H - m.aba - ((n - nivelMin) / (nivelMax - nivelMin)) * (H - m.arr - m.aba);
  const yLluvia = (l) => H - m.aba - (l / lluviaMax) * (H - m.arr - m.aba);

  c.strokeStyle = 'rgba(80,200,255,0.12)';
  c.lineWidth = 1;
  c.font = '9px Consolas, monospace';
  c.fillStyle = '#7c9bb8';
  for (let n = 2; n <= 11; n += 3) {
    c.beginPath();
    c.moveTo(m.izq, yNivel(n));
    c.lineTo(W - m.der, yNivel(n));
    c.stroke();
    c.fillText(`${n}m`, 4, yNivel(n) + 3);
  }
  for (let l = 0; l <= 250; l += 125) c.fillText(`${l}`, W - m.der + 4, yLluvia(l) + 3);

  const pasos = 40;
  const ancho = (W - m.izq - m.der) / pasos;
  c.fillStyle = 'rgba(60,210,255,0.35)';
  for (let k = 0; k < pasos; k++) {
    const t = ((k + 0.5) / pasos) * caso.duracionH;
    const l = interpolar(caso.serie, t, 2);
    c.fillRect(m.izq + k * ancho + 1, yLluvia(l), ancho - 2, H - m.aba - yLluvia(l));
  }

  for (const [nombre, valor, color] of [
    ['alerta', UMBRALES_INA.alerta, '#ffc83c'],
    ['evac.', UMBRALES_INA.evacuacion, '#ff4a5a'],
  ]) {
    c.strokeStyle = color;
    c.setLineDash([4, 3]);
    c.beginPath();
    c.moveTo(m.izq, yNivel(valor));
    c.lineTo(W - m.der, yNivel(valor));
    c.stroke();
    c.setLineDash([]);
    c.fillStyle = color;
    c.fillText(nombre, nombre === 'alerta' ? m.izq + 4 : W - m.der - 34, yNivel(valor) + (nombre === 'alerta' ? 10 : -3));
  }

  c.strokeStyle = '#4fd8ff';
  c.lineWidth = 2;
  c.shadowColor = '#4fd8ff';
  c.shadowBlur = 6;
  c.beginPath();
  for (let k = 0; k <= 120; k++) {
    const t = (k / 120) * caso.duracionH;
    const n = interpolar(caso.serie, t, 1);
    if (k === 0) c.moveTo(xDe(t), yNivel(n));
    else c.lineTo(xDe(t), yNivel(n));
  }
  c.stroke();
  c.shadowBlur = 0;

  c.strokeStyle = manual ? 'rgba(255,255,255,0.3)' : '#ff4a5a';
  c.lineWidth = 1.5;
  c.beginPath();
  c.moveTo(xDe(tActual), m.arr);
  c.lineTo(xDe(tActual), H - m.aba);
  c.stroke();

  c.fillStyle = '#7c9bb8';
  const fin = caso.unidad === 'dias' ? `día ${Math.round(caso.duracionH / 24)}` : `${caso.duracionH} h`;
  c.fillText('0', m.izq, H - 6);
  c.fillText(fin, W - m.der - c.measureText(fin).width, H - 6);
}

function interpolar(serie, t, columna) {
  if (t <= serie[0][0]) return serie[0][columna];
  for (let i = 0; i < serie.length - 1; i++) {
    if (t <= serie[i + 1][0]) {
      const f = (t - serie[i][0]) / (serie[i + 1][0] - serie[i][0]);
      return serie[i][columna] + f * (serie[i + 1][columna] - serie[i][columna]);
    }
  }
  return serie[serie.length - 1][columna];
}
