# Carpeta técnica · Operación Agua (Equipo 2)

> **AI Lab Misión: Código Formosa** · Desafío 3: *Predicción de afectaciones*
> Instituto Politécnico Formosa · Santiago Ayala · Máximo Colman · Ramiro Pereyra · Lucas Zigaran
> Versión del 20/11/2026 · Rama `dev-lucas`

---

## 1. Qué es

Un **simulador 3D de Formosa Capital** para explorar escenarios hipotéticos de **lluvia intensa** y **crecida del río Paraguay**. Muestra en un mapa qué calles, barrios e instalaciones podrían verse afectados, **en qué orden**, y **dónde conviene actuar primero** según la gente que vive en cada zona (Censo 2022).

No es un pronóstico ni reemplaza a los organismos oficiales (INA, SMN, Defensa Civil): es una herramienta para **ordenar la evaluación** con datos y supuestos a la vista.

## 2. Usuarios finales

| Usuario | Para qué lo usa |
|---|---|
| **Operador o técnico de Defensa Civil o del municipio** (usuario principal) | Antes de un temporal o una crecida: elegir un escenario y ver qué calles, barrios, escuelas y centros de salud revisar primero |
| **Autoridades** (comité de emergencia) | Con el río en nivel de evacuación (≥ 8,30 m), el panel «Evaluación para autoridades» ordena los barrios por prioridad y estima cuántas familias habría que evaluar para una posible evacuación |
| **Público general** (exposición, difusión) | Entender de forma visual cómo se inunda la ciudad: agua animada, calles que se cortan y zonas de prioridad, sin conocimientos técnicos |

Las decisiones operativas y de emergencia **siempre son humanas**.

## 3. Funcionalidades

- **Escenarios:** Nivel 1 (lluvia fuerte), Nivel 2 (temporal severo con el río en alerta), Nivel 3 (extremo con el río en evacuación), «7 días» (pronóstico concentrado), crecidas de 1983 y 2015-16, o valores a mano (lluvia en mm/h o mm por minuto, duración, altura del río, desagüe, rotura de la defensa).
- **Simulación en vivo:** el agua cae, escurre por el terreno y se junta en los bajos, a 5, 15 o 30 minutos simulados por segundo.
- **Prioridad por población:** mapa de calor y lista de barrios por *personas × urgencia × vulnerabilidad* (Censo 2022), con ficha de cada barrio.
- **Calles que podrían cortarse:** carteles animados en el mapa, lista con un «vaso de agua» por calle y kilómetros totales.
- **Tipo de calle:** pavimentada, de tierra o sin dato (OpenStreetMap), con revelado animado en el mapa.
- **Orden de afectación** de instalaciones (hospitales, salud, escuelas del padrón oficial, seguridad, servicios) por llegada del agua o por la **altura del río que las alcanza**.
- **Evaluación para autoridades** (solo con el río ≥ 8,30 m): familias a evaluar por barrio, en orden de prioridad.
- **Transparencia:** etiquetas siempre visibles OBSERVADO / PREVISIÓN INA / ESCENARIO DEL USUARIO; panel «Supuestos y límites» con fuentes, supuestos, validación y checklist de la guía.

Convención visual: todo peligro por agua va en escala **celeste → azul profundo** (más oscuro, más peligroso). No se usa rojo, que el público asocia a calor.

## 4. Arquitectura

```
          PROCESAMIENTO (una vez, offline)                         APLICACIÓN (navegador)
 ┌──────────────────────────────────────────────┐     ┌───────────────────────────────────────────────┐
 │ FABDEM ─────────► build-terrain ──┐          │     │  React (App.tsx): paneles, listas, avisos      │
 │ OpenStreetMap ──► fetch-osm ──────┤          │     │      │                         ▲               │
 │                   update-calles   │          │     │      ▼                         │ cuadros       │
 │ Microsoft ──────► build-buildings ├─► public/data ──►  Three.js (MapScene.ts):   Web Worker            │
 │ Traza defensa ──► build-masks ────┤   (.bin/.json)│     │  terreno, agua, calles,   (worker.ts +       │
 │ Red pluvial ────► build-drainage ─┤          │     │      edificios, carteles    engine.ts):         │
 │ Mapa Educativo ─► fetch-escuelas ─┤          │     │                             motor 2D de agua   │
 │ Censo 2022 ─────► build-censo ────┤          │     │  analysis.ts / priority.ts: cruza el agua con   │
 │ (motor) ────────► build-zones / build-thresholds  │     │  calles, barrios, instalaciones y censo        │
 └──────────────────────────────────────────────┘     └───────────────────────────────────────────────┘
```

- **Todo corre en el navegador**: no hay servidor ni base de datos. Los datos procesados (~7 MB) están en `public/data/`.
- La simulación corre en un **Web Worker** para que la interfaz no se trabe.
- Grilla del terreno: 576 × 468 celdas de ~28 × 31 m. Simulación en vivo: celdas de ~60 m.

## 5. Stack tecnológico

| Capa | Herramienta | Versión | Para qué |
|---|---|---|---|
| Lenguaje | TypeScript | 7.0.2 | Todo el código de la app y los scripts |
| Interfaz | React | 19.3.1 | Paneles, listas, avisos |
| Mapa 3D | Three.js | 0.187.0 | Terreno, agua, edificios, efectos (bloom), rótulos |
| Compilación | Vite + @vitejs/plugin-react | 8.3.8 · 6.3.0 | Servidor de desarrollo y build |
| Tests | Vitest | 5.1.1 | 24 tests del modelo, los datos y la prioridad |
| Scripts de datos | tsx · Node.js | 4.23.15 · ≥ 20.19 | Correr los scripts de procesamiento |
| Lectura de datos | geotiff · hyparquet | 3.0.5 · 1.33.1 | Terreno (GeoTIFF) y censo (Parquet) |
| Descarga FABDEM | Python 3 (biblioteca estándar) | — | Bajar solo el tile de Formosa del zip de 2,1 GB |
| Control de versiones | Git + GitHub | — | Ramas por integrante (`dev-lucas`, `dev-colman`) |

## 6. Modelos y métodos (sin cajas negras)

| Método | Dónde | Qué hace |
|---|---|---|
| **Inercia local** (Bates, Horritt y Fewtrell, 2010; base de LISFLOOD-FP) | `src/sim/engine.ts` | Modelo hidráulico 2D: lluvia, escurrimiento con fricción de Manning, desagüe declarado, río como borde de nivel fijo y defensa como barrera |
| **Bañadera conectada / priority-flood** | `scripts/build-thresholds.ts` | Para cada lugar, desde qué altura del río le llega agua por superficie (con defensa sana y con brecha) |
| **Zonas 1º / 2º / 3º** | `scripts/build-zones.ts` | Corre el motor con los tres escenarios de referencia y marca qué se afecta en cada uno |
| **Reparto dasimétrico del censo** | `scripts/build-censo.mjs` | Ubica la población de cada radio censal según la superficie de edificios que tiene adentro |
| **Prioridad** | `src/priority.ts` | Personas × urgencia (zona o llegada del agua) × índice de vulnerabilidad (NBI, niños y mayores, sin cobertura de salud) |
| **Validación** | `src/validation.ts` | Cruza barrios reportados con agua por la prensa con lo que marca el modelo |

Supuestos numéricos (todos en pantalla): cero de la escala de Puerto Formosa 47,30 m IGN y coronamiento de la defensa 59 m IGN (Gobierno de Formosa, 2015); rugosidad de Manning 0,045; afectado desde 15 cm; calle intransitable desde 30 cm; desagüe editable (40 % con el río en alerta); subida del río ~14 cm/día (crecida de octubre de 2026).

## 7. Dónde hay inteligencia artificial

**En el cálculo del agua, no.** El modelo es físico y la prioridad es una fórmula explícita: se pueden auditar paso a paso. La guía pide no usar IA «porque sí».

**En los datos que usamos, sí:**
- **FABDEM** (Universidad de Bristol / Fathom): terreno sin edificios ni árboles, obtenido con aprendizaje automático (*random forest*) sobre el modelo satelital Copernicus.
- **Microsoft Global ML Building Footprints**: huellas de los 81.695 edificios, detectadas con aprendizaje profundo sobre imágenes satelitales.

**Como herramienta del equipo:**
- **Claude** (Anthropic, modelo Claude Opus 5.5, usado a través de Claude Code): asistente para investigar fuentes, leer reportes del INA y de la provincia, integrar las ramas del equipo, programar, escribir tests y documentación. Todo lo que produjo fue revisado por el equipo y cada dato del prototipo tiene su fuente.
- *[Completar: otras herramientas de IA que haya usado cada integrante.]*

**Lo que la IA no hace:** no predice el nivel del río (eso es del INA) y no decide evacuaciones ni cortes (eso es de las autoridades).

## 8. Datos y fuentes

| Dato | Fuente | Tipo | Fecha | Licencia |
|---|---|---|---|---|
| Río en Puerto Formosa: 4,96 m, aguas medias | Parte «Situación hídrica y agroambiental», Subsecretaría de Producción Sustentable de Formosa (Prefectura / INA) | Observado | 17/11/2026 | Pública |
| Previsión del río: ~4,55 m ± 0,3 al 25/11 | INA, reporte diario | Estimado | 19/11/2026 | Pública |
| Alerta 7,80 m · Evacuación 8,30 m · escala de 5 categorías | INA | Referencia | 2026 | Pública |
| Lluvia prevista a 7 días (129 mm, hasta 150 mm) | Open-Meteo, vía parte provincial | Estimado | 17/11/2026 | Pública |
| Terreno (30 m) | FABDEM v1-2 | Referencia | 2022 | CC BY-NC-SA 4.0 |
| Edificios | Microsoft Global ML Building Footprints | Referencia | 2026-02 | ODbL |
| Calles, barrios, salud, seguridad, servicios, ríos, tramos de defensa | OpenStreetMap (Overpass) | Base | 19-20/11/2026 | ODbL |
| Escuelas (288 establecimientos, 281 edificios) | Mapa Educativo Nacional | Referencia | descarga 19/11/2026 | CC BY 4.0 |
| Población, hogares, NBI, edades, cobertura (310 radios) | INDEC, Censo 2022 (vía source.coop; radios de Rodriguez y de Grande, CONICET) | Referencia | 2022 | CC BY 4.0 |
| Cota de la defensa (59 m IGN = 11,70 m de escala) | Gobierno de Formosa | Referencia | 08/12/2015 | Pública |
| Red pluvial (27 entradas) | Relevamiento del equipo (información municipal y de prensa) | Estimado | 2026 | — |
| Barrios con agua (validación) | Exprés Diario, La Mañana, Diario Jornada | Referencia | 2015-2024 | — |

## 9. Instalación

**Requisitos:** Node.js 20.19 o superior (recomendado 22), npm, Git y un navegador con WebGL 2 (Chrome, Edge o Firefox actualizados). Para la exposición conviene una PC con placa de video; en celulares comunes el 3D anda lento.

```bash
git clone https://github.com/MaxiColmena/operacion-agua-formosa.git
cd operacion-agua-formosa
git checkout dev-lucas
npm install
npm run dev        # abre http://localhost:5173
```

Otros comandos:

```bash
npm test           # 24 tests (Vitest)
npm run build      # chequeo de tipos + versión para publicar en dist/
npm run preview    # sirve la versión de dist/
```

Los datos ya procesados vienen en `public/data/`. Para regenerarlos (necesita internet; los archivos crudos van a `data-raw/`, que no se sube):

```bash
python scripts/fetch-fabdem.py   # terreno FABDEM (~14 MB, ~7 min)
npm run data                     # terreno, OSM, edificios, máscaras, red pluvial, zonas y umbrales
npm run data:calles              # tipo de calzada de las calles
npm run data:escuelas            # padrón del Mapa Educativo Nacional
npm run data:censo               # Censo 2022 (antes bajar los .parquet, ver el script)
```

## 10. Estructura del repositorio

```
src/
  App.tsx              interfaz: paneles, listas, aviso y panel para autoridades
  analysis.ts          cruce del agua con calles, barrios e instalaciones
  priority.ts          prioridad por población (Censo 2022)
  validation.ts        barrios reportados con agua (prensa)
  data/                carga de datos, tipo de calzada, red pluvial relevada
  scene/               mapa 3D (Three.js) y cámara libre
  sim/                 motor de agua, worker, escenarios y supuestos, defensa
  ui/                  guía de uso, ayudas emergentes, umbrales
scripts/               procesamiento de datos (terreno, OSM, edificios, censo, escuelas, zonas)
public/data/           datos ya procesados que usa la app
tests/                 tests (Vitest)
docs/                  esta carpeta técnica y la investigación de casos reales
```

## 11. Pruebas y validación

- **24 tests automáticos** (`npm test`): conservación de la masa del agua, bañadera conectada, rotura de la defensa, desagüe con río alto, datos reales al día, escuelas oficiales, exclusión de la margen paraguaya, reparto del censo por edificios, prioridad y validación.
- **Validación con casos reales:** de 6 barrios que la prensa reportó con agua, los 6 quedan dentro de las zonas 1º/2º/3º y 5 en la mitad superior de la lista de prioridad. Colluccio queda abajo: se muestra como desacuerdo.
- **Revisión de datos:** el total del área (253.833 personas) coincide con el Censo 2022 de la ciudad (260.325 con Villa del Carmen).

## 12. Limitaciones

- **Terreno:** 1 a 2 m de error vertical; no permite afirmar qué manzana se inunda.
- **Cero de escala y traza de la defensa:** deducidos y aproximados; falta el dato oficial del INA y la traza de la Provincia.
- **Desagües:** red pluvial relevada en parte, sin diámetros ni estado; bombas no modeladas una por una.
- **Río:** se mide en un solo punto (el puerto) y se supone fijo durante el escenario.
- **Población:** censo repartido según edificios dentro de cada radio; barrios aproximados (OpenStreetMap tiene puntos, no límites).
- **Tipo de calle:** ~13 % sin dato en OpenStreetMap.
- **Tiempos:** sirven para ordenar, no para planificar al minuto. Los escenarios son hipotéticos, no pronósticos.

## 13. Qué no hace (para no pisar a otros equipos)

Rutas de evacuación y centros de evacuados (Equipo 3), imágenes satelitales (Equipo 1), registro de lluvias por estación (Equipo 5), registro de incidentes (Equipo 4), atajaderos (Equipo 6) y pronóstico del río (INA).
