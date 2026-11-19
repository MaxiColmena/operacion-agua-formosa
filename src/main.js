import { crearModelo, TAMANO_CELDA_M } from './escenario/terreno.js';
import { calcularAgua, interpolarSerie } from './escenario/inundacion.js';
import { CASOS, CERO_ESCALA, DRENAJE, UMBRALES_INA, TIPOS_INFRA } from './escenario/datos-ficticios.js';
import { crearCapas, textoDeAyuda } from './mapa/capas.js';
import { crearMotorGoogle, crearMotorSoloDeck } from './mapa/motores.js';
import { dibujarMinimapa, dibujarHidrograma } from './ui/graficos.js';

const $ = (id) => document.getElementById(id);
const formato = (n, d = 2) => n.toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });

const modelo = crearModelo();

const estado = {
  caso: CASOS[0],
  t: 0,
  reproduciendo: false,
  velocidad: 1,
  manual: false,
  nivelManual: 4.8,
  lluviaManual: 0,
  conFalla: false,
  exageracion: 18,
  mostrarTerreno: true,
  mostrarManzanas: true,
  agua: null,
  infra: [],
  tiempoClave: '',
  nivel: 0,
  lluvia: 0,
};

let motor = null;

// ---------- Cálculo ----------

function recalcular() {
  const { nivel, lluvia } = estado.manual
    ? { nivel: estado.nivelManual, lluvia: estado.lluviaManual }
    : interpolarSerie(estado.caso.serie, estado.t);
  estado.nivel = nivel;
  estado.lluvia = lluvia;

  const pre = modelo.precalculo[estado.conFalla ? 'falla' : 'normal'];
  estado.agua = calcularAgua({
    cotaTerreno: modelo.cotaTerreno,
    esRio: modelo.esRio,
    desborde: pre.desborde,
    profundidadBajos: pre.profundidadBajos,
    nivelRio: nivel,
    lluviaMm: lluvia,
    ceroEscala: CERO_ESCALA,
    drenaje: DRENAJE,
  });

  estado.infra = modelo.infraestructura.map((item) => {
    const umbral = estado.conFalla ? item.umbral.falla : item.umbral.normal;
    const p = estado.agua.profundidad[item.celda];
    let est = 'normal';
    if (p > 0) est = 'afectado';
    else if (umbral - nivel < 0.6) est = 'riesgo';
    return { ...item, umbralActual: umbral, profundidad: p, origenAgua: estado.agua.origen[item.celda], estado: est };
  });

  estado.tiempoClave = `${nivel.toFixed(2)}|${lluvia.toFixed(0)}|${estado.conFalla}`;
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
    return `Día ${dia} · ${String(hora).padStart(2, '0')}:00`;
  }
  const h = Math.floor(t);
  const min = Math.round((t - h) * 60);
  return `Hora ${h}:${String(min).padStart(2, '0')}`;
}

function dibujarLectura() {
  const n = estado.nivel;
  let clase = '';
  let etiqueta = 'normal';
  if (n >= UMBRALES_INA.evacuacion) {
    clase = 'evacuacion';
    etiqueta = 'sobre EVACUACIÓN';
  } else if (n >= UMBRALES_INA.alerta) {
    clase = 'alerta';
    etiqueta = 'sobre ALERTA';
  }
  $('lectura').innerHTML = `
    <div>RÍO · PUERTO FORMOSA <span class="${clase}">(${etiqueta})</span></div>
    <div class="grande ${clase}">${formato(n)} m</div>
    <div>LLUVIA ACUMULADA <b>${formato(estado.lluvia, 0)} mm</b></div>
    <div>${estado.manual ? 'Control manual' : textoTiempo(estado.t)}</div>`;
}

function dibujarResumen() {
  const { profundidad, origen } = estado.agua;
  let rio = 0;
  let lluvia = 0;
  for (let i = 0; i < profundidad.length; i++) {
    if (origen[i] === 1) rio++;
    else if (origen[i] === 2) lluvia++;
  }
  const km2 = (celdas) => formato((celdas * TAMANO_CELDA_M * TAMANO_CELDA_M) / 1e6, 2);
  const afectados = estado.infra.filter((i) => i.estado === 'afectado').length;
  const riesgo = estado.infra.filter((i) => i.estado === 'riesgo').length;
  $('resumen').innerHTML = `
    <h2>Resumen del momento</h2>
    <div class="dato"><span>Área con agua de río</span><b>${km2(rio)} km²</b></div>
    <div class="dato"><span>Área anegada por lluvia</span><b>${km2(lluvia)} km²</b></div>
    <div class="dato"><span>Infraestructura afectada</span><b>${afectados} / ${estado.infra.length}</b></div>
    <div class="dato"><span>En riesgo (a &lt; 0,60 m)</span><b>${riesgo}</b></div>
    <p class="nota">Valores sobre terreno ficticio. Solo sirven para probar la herramienta.</p>`;
}

function dibujarLista() {
  const orden = [...estado.infra].sort((a, b) => a.umbralActual - b.umbralActual);
  $('lista-infra').innerHTML = orden
    .map((item) => {
      const color = TIPOS_INFRA[item.tipo].color.join(',');
      let detalle = item.umbralActual > 30 ? 'no lo alcanza el río' : `río a ${formato(item.umbralActual)} m`;
      if (item.estado === 'afectado' && item.origenAgua === 2) detalle = 'anegado por lluvia';
      const textoEstado = { normal: 'ok', riesgo: 'riesgo', afectado: 'afectado' }[item.estado];
      return `<li>
        <span class="id" style="color:rgb(${color})">${item.id}</span>
        <span>${item.nombre}<br><span class="detalle">${detalle} · ${item.dentroDefensa ? 'dentro' : 'fuera'} de la defensa</span></span>
        <span class="estado ${item.estado}">${textoEstado}</span>
      </li>`;
    })
    .join('');
}

let pendiente = false;
function actualizar() {
  if (pendiente) return;
  pendiente = true;
  requestAnimationFrame(() => {
    pendiente = false;
    recalcular();
    motor?.setLayers(crearCapas(modelo, estado, alPasar));
    dibujarMinimapa($('minimapa'), modelo, estado.agua, estado.infra);
    dibujarHidrograma($('hidrograma'), estado.caso, estado.t, estado.manual);
    dibujarLectura();
    dibujarResumen();
    dibujarLista();
    $('tiempo-texto').textContent = textoTiempo(estado.t);
    if (!estado.manual) {
      $('nivel').value = estado.nivel;
      $('lluvia').value = estado.lluvia;
    }
    $('nivel-texto').textContent = `${formato(estado.nivel)} m`;
    $('lluvia-texto').textContent = `${formato(estado.lluvia, 0)} mm`;
    $('exag-texto').textContent = `x${estado.exageracion}`;
  });
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
    $('tiempo').value = estado.t;
    actualizar();
  }
  ultimoCuadro = ahora;
  requestAnimationFrame(bucle);
}

function detener() {
  estado.reproduciendo = false;
  $('btn-play').textContent = '▶';
}

// ---------- Controles ----------

function prepararControles() {
  const selectorCaso = $('caso');
  selectorCaso.innerHTML = CASOS.map((c) => `<option value="${c.id}">${c.nombre}</option>`).join('');
  const elegirCaso = (id) => {
    estado.caso = CASOS.find((c) => c.id === id);
    estado.t = 0;
    $('tiempo').max = estado.caso.duracionH;
    $('tiempo').step = estado.caso.unidad === 'dias' ? 1 : 0.1;
    $('tiempo').value = 0;
    $('caso-descripcion').textContent = estado.caso.descripcion;
    actualizar();
  };
  selectorCaso.addEventListener('change', (e) => elegirCaso(e.target.value));
  elegirCaso(CASOS[0].id);

  $('tiempo').addEventListener('input', (e) => {
    estado.t = Number(e.target.value);
    actualizar();
  });

  $('btn-play').addEventListener('click', () => {
    if (estado.reproduciendo) {
      detener();
      return;
    }
    if (estado.t >= estado.caso.duracionH) estado.t = 0;
    if (estado.manual) {
      estado.manual = false;
      $('manual').checked = false;
      $('nivel').disabled = true;
      $('lluvia').disabled = true;
    }
    estado.reproduciendo = true;
    $('btn-play').textContent = '❚❚';
  });

  $('velocidad').addEventListener('change', (e) => (estado.velocidad = Number(e.target.value)));

  $('manual').addEventListener('change', (e) => {
    estado.manual = e.target.checked;
    $('nivel').disabled = !estado.manual;
    $('lluvia').disabled = !estado.manual;
    if (estado.manual) {
      detener();
      estado.nivelManual = estado.nivel;
      estado.lluviaManual = estado.lluvia;
      $('nivel').value = estado.nivel;
      $('lluvia').value = estado.lluvia;
    }
    actualizar();
  });
  $('nivel').addEventListener('input', (e) => {
    estado.nivelManual = Number(e.target.value);
    actualizar();
  });
  $('lluvia').addEventListener('input', (e) => {
    estado.lluviaManual = Number(e.target.value);
    actualizar();
  });

  $('falla').addEventListener('change', (e) => {
    estado.conFalla = e.target.checked;
    actualizar();
  });
  $('exageracion').addEventListener('input', (e) => {
    estado.exageracion = Number(e.target.value);
    actualizar();
  });
  $('terreno').addEventListener('change', (e) => {
    estado.mostrarTerreno = e.target.checked;
    actualizar();
  });
  $('manzanas').addEventListener('change', (e) => {
    estado.mostrarManzanas = e.target.checked;
    actualizar();
  });

  document.querySelectorAll('[data-girar]').forEach((b) =>
    b.addEventListener('click', () => motor?.girar(Number(b.dataset.girar))),
  );
  $('btn-restablecer').addEventListener('click', () => motor?.restablecer());
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
      estado.mostrarTerreno = false;
      $('terreno').checked = false;
      $('chip-motor').textContent = motor.esVectorial ? 'Mapa: Google Maps 3D' : 'Mapa: Google Maps (sin inclinación)';
      if (!motor.esVectorial) {
        mostrarAviso('Google cargó un mapa <b>raster</b>: no se puede inclinar ni rotar. Usá un <b>Map ID vectorial</b> (ver README).');
      }
      return;
    } catch (error) {
      contenedor.innerHTML = '';
      mostrarAviso(`No se pudo usar Google Maps: ${error.message}<br>Sigo en <b>modo sin Google</b> (mismo agua, sin mapa de fondo).`);
    }
  }

  motor = crearMotorSoloDeck(contenedor);
  estado.mostrarTerreno = true;
  $('terreno').checked = true;
  $('chip-motor').textContent = clave ? 'Mapa: modo sin Google (falló la carga)' : 'Mapa: modo sin Google (falta la clave)';
}

prepararControles();
await iniciarMapa();
actualizar();
requestAnimationFrame(bucle);
