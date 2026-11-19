// Utilidades geográficas simples (aproximación plana, suficiente para una ciudad).

export const METROS_POR_GRADO_LAT = 111320;

export function metrosPorGradoLon(lat) {
  return METROS_POR_GRADO_LAT * Math.cos((lat * Math.PI) / 180);
}

// Convierte [lon, lat] a metros locales respecto de un origen.
export function aMetros([lon, lat], [lon0, lat0]) {
  return [(lon - lon0) * metrosPorGradoLon(lat0), (lat - lat0) * METROS_POR_GRADO_LAT];
}

// Distancia mínima (en metros) de un punto a una polilínea [[lon, lat], ...].
export function distanciaAPolilinea(punto, linea) {
  const origen = punto;
  let minima = Infinity;
  for (let i = 0; i < linea.length - 1; i++) {
    const [ax, ay] = aMetros(linea[i], origen);
    const [bx, by] = aMetros(linea[i + 1], origen);
    const dx = bx - ax;
    const dy = by - ay;
    const largo2 = dx * dx + dy * dy;
    let t = largo2 === 0 ? 0 : -(ax * dx + ay * dy) / largo2;
    t = Math.max(0, Math.min(1, t));
    const px = ax + t * dx;
    const py = ay + t * dy;
    const d = Math.hypot(px, py);
    if (d < minima) minima = d;
  }
  return minima;
}

// Punto dentro de polígono (ray casting). Polígono: [[lon, lat], ...] sin repetir el primero.
export function puntoEnPoligono([x, y], poligono) {
  let dentro = false;
  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
    const [xi, yi] = poligono[i];
    const [xj, yj] = poligono[j];
    const cruza = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (cruza) dentro = !dentro;
  }
  return dentro;
}

// Desplaza una polilínea hacia el oeste una cantidad de metros (para dibujar la defensa ficticia).
export function desplazarOeste(linea, metros) {
  return linea.map(([lon, lat]) => [lon - metros / metrosPorGradoLon(lat), lat]);
}
