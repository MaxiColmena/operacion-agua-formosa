import { crearModelo, ubicarInfraestructura, TAMANO_CELDA_M } from './escenario/terreno.js';
import { calcularAgua, interpolarSerie } from './escenario/inundacion.js';
import { CASOS, CERO_ESCALA, DRENAJE, UMBRALES_INA, TIPOS_INFRA } from './escenario/datos-ficticios.js';
import { crearCapas, textoDeAyuda } from './mapa/capas.js';
import { crearMotorGoogle, crearMotorSoloDeck } from './mapa/motores.js';
import { cargarCiudad } from './mapa/ciudad.js';
import { dibujarMinimapa, dibujarHidrograma } from './ui/graficos.js';
import { OBSERVADO, PREVISION_INA, FUENTES, INCERTIDUMBRE, CATEGORIAS_INA } from './escenario/datos-observados.js';

const $ = (id) => document.getElementById(id);
const formato = (n, d = 2) => n.toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });

let modelo = null; // se arma cuando llega la ciudad real (río y lagunas de OSM)
let ciudad = null;
let infraBase = [];

const estado = {
  caso: CASOS[0],
  t: 0,
  reproduciendo: false,
  velocidad: 1,
  manual: false, // true: el agua la fija el usuario, no el caso
  nivelManual: 4.8,
  lluviaManual: 0,
  conFalla: false,
  exageracion: 12,
  mostrarCalles: true,
  mostrarPlazas: true,
  mostrarNombres: true,
  agua: null,
  infra: [],
  infraPorTipo: { escuela: [], salud: [] },
  claveAgua: '',
  claveInfra: '',
  nivel: 0,
  lluvia: 0,
};

let motor = null;

// ---------- Cálculo (solo si cambió algo que lo afecta) ----------

function recalcular() {
  const { nivel, lluvia } = estado.manual
    ? { nivel: estado.nivelManual, lluvia: estado.lluviaManual }
    : interpolarSerie(estado.caso.serie, estado.t);
  // Redondeo a 1 cm y 1 mm: evita recalcular el agua por cambios invisibles.
  estado.nivel = Math.round(nivel * 100) / 100;
  estado.lluvia = Math.round(lluvia);

  const clave = `${estado.nivel}|${estado.lluvia}|${estado.conFalla}`;
  if (clave === estado.claveAgua && estado.agua) return false;
  estado.claveAgua = clave;

  const pre = modelo.precalculo[estado.conFalla ? 'falla' : 'normal'];
  estado.agua = calcularAgua({
    cotaTerreno: modelo.cotaTerreno,
    esRio: modelo.esRio,
    desborde: pre.desborde,
    profundidadBajos: pre.profundidadBajos,
    nivelRio: estado.nivel,
    lluviaMm: estado.lluvia,
    ceroEscala: CERO_ESCALA,
    drenaje: DRENAJE,
  });

  let firma = '';
  estado.infra = infraBase.map((item) => {
    const umbral = estado.conFalla ? item.umbral.falla : item.umbral.normal;
    const p = estado.agua.profundidad[item.celda];
    let est = 'normal';
    if (p > 0) est = 'afectado';
    else if (umbral - estado.nivel < 0.6) est = 'riesgo';
    firma += est[0];
    return { ...item, umbralActual: umbral, profundidad: p, origenAgua: estado.agua.origen[item.celda], estado: est };
  });
  estado.infraPorTipo = {
    escuela: estado.infra.filter((i) => i.tipo === 'escuela'),
    salud: estado.infra.filter((i) => i.tipo === 'salud'),
  };
  estado.cambioInfra = firma + estado.conFalla !== estado.claveInfra;
  estado.claveInfra = firma + estado.conFalla;
  return true;
}

// ---------- Dibujo ----------

function alPasar(info) {
  const ayuda = $('ayuda');
  const texto = info && info.picked ? textoDeAyuda(info, modelo, estado) : null;
  if (!texto) {
    ayuda.classList.add('oculto');
    return;
  }
  ayuda.textContent = texto;
  ayuda.style.left = `${info.x + 14}px`;
  ayuda.style.top = `${info.y + 14}px`;
  ayuda.classList.remove('oculto');
}

function textoTiempo(t) {
  if (estado.caso.unidad === 'dias') {
    const dia = Math.floor(t / 24);
    const hora = Math.floor(t % 24);
    return `Día ${dia} de ${Math.round(estado.caso.duracionH / 24)} · ${String(hora).padStart(2, '0')}:00`;
  }
  const h = Math.floor(t);
  const min = Math.round((t - h) * 60);
  return `Hora ${h}:${String(min).padStart(2, '0')} de ${estado.caso.duracionH} h`;
}

// Relación con los umbrales oficiales del INA (no son categorías propias).
function relacionConUmbrales(n) {
  if (n >= UMBRALES_INA.evacuacion) return { clase: 'evacuacion', texto: `supera la evacuación INA (${formato(UMBRALES_INA.evacuacion)} m)` };
  if (n >= UMBRALES_INA.alerta) return { clase: 'alerta', texto: `supera la alerta INA (${formato(UMBRALES_INA.alerta)} m)` };
  return { clase: '', texto: `debajo de la alerta INA (${formato(UMBRALES_INA.alerta)} m)` };
}

// Supuestos del caso en una frase: cuánto sube el río y en cuántos días u horas.
function supuestosDelCaso(caso) {
  const serie = caso.serie;
  const [t0, n0] = serie[0];
  let pico = serie[0];
  for (const p of serie) if (p[1] > pico[1]) pico = p;
  const lluviaTotal = Math.max(...serie.map((p) => p[2]));
  const enDias = caso.unidad === 'dias';
  const plazo = (h) => (enDias ? `${Math.round(h / 24)} días` : `${formato(h, 0)} h`);
  const rio =
    pico[1] - n0 > 0.05
      ? `río de ${formato(n0)} a ${formato(pico[1])} m en ${plazo(pico[0] - t0)}`
      : `río estable en ${formato(n0)} m`;
  return `${rio} · lluvia local ${formato(lluviaTotal, 0)} mm en ${plazo(caso.duracionH)}`;
}

function dibujarLectura() {
  const n = estado.nivel;
  const rel = relacionConUmbrales(n);
  const origen = estado.manual ? 'puesto a mano' : `caso: ${supuestosDelCaso(estado.caso)}`;
  $('lectura').innerHTML = `
    <div class="bloque obs">
      <span class="etq etq-obs">OBSERVADO</span> ${OBSERVADO.fecha} · INA
      <div><b>${formato(OBSERVADO.nivelM)} m</b> ${OBSERVADO.tendencia} · <b>${OBSERVADO.categoriaINA}</b> (categoría INA)</div>
    </div>
    <div class="bloque prev">
      <span class="etq etq-est">PREVISIÓN INA</span> al ${PREVISION_INA.hasta.slice(0, 5)}
      <div>~${formato(PREVISION_INA.nivelFinalM)} m ± ${formato(PREVISION_INA.margenM, 1)} · leve descenso</div>
    </div>
    <div class="bloque esc">
      <span class="etq etq-esc">ESCENARIO DEL USUARIO</span> ficticio
      <div class="grande ${rel.clase}">${formato(n)} m</div>
      <div class="${rel.clase}">${rel.texto}</div>
      <div>Lluvia acumulada <b>${formato(estado.lluvia, 0)} mm</b> · ${textoTiempo(estado.t)}</div>
      <div class="supuesto">Supuesto: ${origen}</div>
    </div>`;
}

function dibujarResumen() {
  const { profundidad, origen } = estado.agua;
  let rio = 0;
  let lluvia = 0;
  for (let i = 0; i < profundidad.length; i++) {
    if (origen[i] === 1) rio++;
    else if (origen[i] === 2) lluvia++;
  }
  // Población y viviendas (Censo 2022) en celdas con agua del escenario.
  let personas = 0;
  let viviendas = 0;
  const censo = ciudad.poblacion;
  if (censo) {
    for (let i = 0; i < profundidad.length; i++) {
      if (origen[i] === 1 || origen[i] === 2) {
        personas += censo.poblacion[i];
        viviendas += censo.viviendas[i];
      }
    }
  }
  const redondear = (n) => (n < 100 ? Math.round(n / 10) * 10 : Math.round(n / 100) * 100);
  const filaCenso = censo
    ? `<div class="dato"><span>Personas en zonas a evaluar</span><b>~${redondear(personas).toLocaleString('es-AR')}</b></div>
       <div class="dato"><span>Viviendas</span><b>~${redondear(viviendas).toLocaleString('es-AR')}</b></div>
       <p class="nota">Censo 2022 (INDEC) por radio, repartido en celdas. Orden de magnitud, no un conteo.</p>`
    : '';
  const km2 = (celdas) => formato((celdas * TAMANO_CELDA_M * TAMANO_CELDA_M) / 1e6, 1);
  const cuenta = (tipo, est) => estado.infra.filter((i) => i.tipo === tipo && i.estado === est).length;
  $('resumen').innerHTML = `
    <h2>Zonas a evaluar · escenario</h2>
    <div class="dato"><span>Zona expuesta al río</span><b>~${km2(rio)} km²</b></div>
    <div class="dato"><span>Zona anegable por lluvia</span><b>~${km2(lluvia)} km²</b></div>
    ${filaCenso}
    <div class="dato"><span>Escuelas a evaluar</span><b>${cuenta('escuela', 'afectado')} / ${estado.infraPorTipo.escuela.length}</b></div>
    <div class="dato"><span>Salud a evaluar</span><b>${cuenta('salud', 'afectado')} / ${estado.infraPorTipo.salud.length}</b></div>
    <div class="dato"><span>A vigilar (a &lt; 0,60 m)</span><b>${estado.infra.filter((i) => i.estado === 'riesgo').length}</b></div>
    <div class="confianza"><span class="etq etq-fic">CONFIANZA BAJA</span> Horizonte: escenario hipotético de ${
      estado.caso.unidad === 'dias' ? `${Math.round(estado.caso.duracionH / 24)} días` : `${estado.caso.duracionH} h`
    }, no es un pronóstico.</div>
    <ul class="incertidumbre">${INCERTIDUMBRE.map((t) => `<li>${t}</li>`).join('')}</ul>`;
}

const MAX_LISTA = 60;
function dibujarLista() {
  const orden = [...estado.infra].sort((a, b) => a.umbralActual - b.umbralActual);
  const html = orden.slice(0, MAX_LISTA).map((item) => {
    const color = TIPOS_INFRA[item.tipo].color.join(',');
    let detalle = item.umbralActual > 30 ? 'el río no la alcanza' : `expuesta desde ${formato(item.umbralActual)} m`;
    if (item.estado === 'afectado' && item.origenAgua === 2) detalle = 'zona anegable por lluvia';
    const textoEstado = { normal: 'sin exposición', riesgo: 'vigilar', afectado: 'evaluar' }[item.estado];
    return `<li>
        <span class="id" style="color:rgb(${color})">${item.id}</span>
        <span>${item.nombre}<br><span class="detalle">${detalle} · ${item.dentroDefensa ? 'dentro' : 'fuera'} de la defensa</span></span>
        <span class="estado ${item.estado}">${textoEstado}</span>
      </li>`;
  });
  if (orden.length > MAX_LISTA) html.push(`<li class="mas">… y ${orden.length - MAX_LISTA} más, menos expuestos</li>`);
  $('lista-infra').innerHTML = html.join('');
}

function dibujarControles() {
  $('tiempo').value = estado.t;
  $('tiempo-texto').textContent = textoTiempo(estado.t);
  if (!estado.manual) {
    $('nivel').value = estado.nivel;
    $('lluvia').value = estado.lluvia;
  }
  $('nivel-texto').textContent = `${formato(estado.nivel)} m`;
  $('lluvia-texto').textContent = `${formato(estado.lluvia, 0)} mm`;
  $('exag-texto').textContent = `x${estado.exageracion}`;
  $('modo-agua').innerHTML = estado.manual
    ? '<span class="alerta">Agua puesta a mano.</span> Mover el día o ▶ vuelve al caso.'
    : 'El agua sigue el caso en el día elegido.';
  $('btn-volver').classList.toggle('oculto', !estado.manual);
}

let pendiente = false;
let forzarCapas = true;
function actualizar() {
  if (pendiente) return;
  pendiente = true;
  requestAnimationFrame(() => {
    pendiente = false;
    if (!ciudad || !modelo) return;
    const cambioAgua = recalcular();
    if (cambioAgua || forzarCapas) {
      motor?.setLayers(crearCapas(modelo, ciudad, estado, alPasar));
      forzarCapas = false;
    }
    if (cambioAgua) {
      dibujarMinimapa($('minimapa'), modelo, estado.agua, estado.infra);
      dibujarResumen();
      if (estado.cambioInfra) dibujarLista();
    }
    dibujarHidrograma($('hidrograma'), estado.caso, estado.t, estado.manual);
    dibujarLectura();
    dibujarControles();
  });
}

function redibujarCapas() {
  forzarCapas = true;
  actualizar();
}

// ---------- Reproducción (como el reloj de las sombras, pero con agua) ----------

let ultimoCuadro = 0;
function bucle(ahora) {
  if (estado.reproduciendo) {
    const dt = Math.min(0.5, (ahora - ultimoCuadro) / 1000);
    const segundosTotales = 20;
    estado.t += (estado.caso.duracionH / segundosTotales) * dt * estado.velocidad;
    if (estado.t >= estado.caso.duracionH) {
      estado.t = estado.caso.duracionH;
      detener();
    }
    actualizar();
  }
  ultimoCuadro = ahora;
  requestAnimationFrame(bucle);
}

function detener() {
  estado.reproduciendo = false;
  $('btn-play').textContent = '▶';
}

// Mover el día: siempre vuelve a los valores del caso.
function irA(t) {
  estado.t = Math.max(0, Math.min(estado.caso.duracionH, t));
  estado.manual = false;
  actualizar();
}

function paso() {
  return estado.caso.unidad === 'dias' ? 24 : 1;
}

// ---------- Controles ----------

function prepararControles() {
  const selectorCaso = $('caso');
  selectorCaso.innerHTML = CASOS.map((c) => `<option value="${c.id}">${c.nombre}</option>`).join('');
  const elegirCaso = (id) => {
    detener();
    estado.caso = CASOS.find((c) => c.id === id);
    $('tiempo').max = estado.caso.duracionH;
    $('tiempo').step = estado.caso.unidad === 'dias' ? 1 : 0.1;
    $('caso-descripcion').textContent = estado.caso.descripcion;
    $('btn-atras').title = $('btn-adelante').title = estado.caso.unidad === 'dias' ? '1 día' : '1 hora';
    $('caso-supuestos').textContent = `Supuesto del caso: ${supuestosDelCaso(estado.caso)}.`;
    estado.claveAgua = ''; // fuerza a redibujar el resumen (cambia el horizonte)
    irA(0);
  };
  selectorCaso.addEventListener('change', (e) => elegirCaso(e.target.value));
  elegirCaso(CASOS[0].id);

  $('tiempo').addEventListener('input', (e) => {
    detener();
    irA(Number(e.target.value));
  });
  $('btn-atras').addEventListener('click', () => {
    detener();
    irA((Math.ceil(estado.t / paso()) - 1) * paso());
  });
  $('btn-adelante').addEventListener('click', () => {
    detener();
    irA((Math.floor(estado.t / paso()) + 1) * paso());
  });

  $('btn-play').addEventListener('click', () => {
    if (estado.reproduciendo) {
      detener();
      return;
    }
    if (estado.t >= estado.caso.duracionH) estado.t = 0;
    estado.manual = false;
    estado.reproduciendo = true;
    $('btn-play').textContent = '❚❚';
  });

  $('velocidad').addEventListener('change', (e) => (estado.velocidad = Number(e.target.value)));

  // Mover el agua a mano: se queda en el día actual y toma el control.
  const tomarControl = () => {
    if (!estado.manual) {
      detener();
      estado.manual = true;
      estado.nivelManual = estado.nivel;
      estado.lluviaManual = estado.lluvia;
    }
  };
  $('nivel').addEventListener('input', (e) => {
    tomarControl();
    estado.nivelManual = Number(e.target.value);
    actualizar();
  });
  $('lluvia').addEventListener('input', (e) => {
    tomarControl();
    estado.lluviaManual = Number(e.target.value);
    actualizar();
  });
  $('btn-volver').addEventListener('click', () => irA(estado.t));

  $('falla').addEventListener('change', (e) => {
    estado.conFalla = e.target.checked;
    actualizar();
  });
  $('exageracion').addEventListener('input', (e) => {
    estado.exageracion = Number(e.target.value);
    redibujarCapas();
  });
  for (const [id, prop] of [['calles', 'mostrarCalles'], ['plazas', 'mostrarPlazas'], ['nombres', 'mostrarNombres']]) {
    $(id).addEventListener('change', (e) => {
      estado[prop] = e.target.checked;
      redibujarCapas();
    });
  }

  // Teclado: ← → mueven el día, espacio reproduce.
  window.addEventListener('keydown', (e) => {
    if (e.target.matches('input[type=range], select, input[type=checkbox]') && e.key !== ' ') return;
    if (e.key === 'ArrowLeft') $('btn-atras').click();
    else if (e.key === 'ArrowRight') $('btn-adelante').click();
    else if (e.key === ' ' && e.target === document.body) {
      e.preventDefault();
      $('btn-play').click();
    }
  });

  document.querySelectorAll('[data-girar]').forEach((b) =>
    b.addEventListener('click', () => motor?.girar(Number(b.dataset.girar))),
  );
  $('btn-restablecer').addEventListener('click', () => motor?.restablecer());
}

function dibujarFuentes() {
  const enlace = (f) => (f.url ? `<a href="${f.url}" target="_blank" rel="noopener">${f.nombre}</a>` : f.nombre);
  $('lista-fuentes').innerHTML = FUENTES.map(
    (f) => `<li><span class="etq etq-${f.tipo.toLowerCase().slice(0, 3)}">${f.tipo}</span>
      <div><b>${enlace(f)}</b> · ${f.fecha}<br><span class="detalle">${f.que}</span></div></li>`,
  ).join('');
  $('categorias-ina').innerHTML = CATEGORIAS_INA.map(([c, d]) => `<li><b>${c}</b>: ${d}</li>`).join('');
}

function mostrarAviso(texto) {
  const aviso = $('aviso');
  aviso.innerHTML = `${texto}<br><small>(clic para cerrar)</small>`;
  aviso.classList.remove('oculto');
  aviso.onclick = () => aviso.classList.add('oculto');
}

async function iniciarMapa() {
  const clave = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const mapId = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID || 'DEMO_MAP_ID';
  const contenedor = $('mapa');

  if (clave) {
    try {
      motor = await crearMotorGoogle(contenedor, { clave, mapId });
      $('chip-motor').textContent = motor.esVectorial ? 'Mapa: Google Maps 3D' : 'Mapa: Google Maps (sin inclinación)';
      if (!motor.esVectorial) {
        mostrarAviso('Google cargó un mapa <b>raster</b>: no se puede inclinar ni rotar. Usá un <b>Map ID vectorial</b> (ver README).');
      }
      return;
    } catch (error) {
      contenedor.innerHTML = '';
      mostrarAviso(`No se pudo usar Google Maps: ${error.message}<br>Sigo con el mapa de <b>OpenStreetMap</b>.`);
    }
  }

  motor = crearMotorSoloDeck(contenedor);
  $('chip-motor').textContent = clave ? 'Mapa: OpenStreetMap (falló Google)' : 'Mapa: OpenStreetMap (sin clave de Google)';
}

prepararControles();
dibujarFuentes();
await iniciarMapa();
try {
  ciudad = await cargarCiudad();
  modelo = crearModelo(ciudad.geo);
  infraBase = ubicarInfraestructura(modelo, ciudad.infra);
  $('fecha-osm').textContent = ciudad.fecha;
} catch (error) {
  mostrarAviso(`No se pudo cargar la ciudad: ${error.message}`);
}
actualizar();
requestAnimationFrame(bucle);
