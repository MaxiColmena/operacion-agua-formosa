# Operación Agua · Equipo 2 — Mapa 3D de afectaciones en Formosa Capital

> **AI Lab Misión: Código Formosa** · Desafío 3: *Predicción de afectaciones*
> Instituto Politécnico Formosa · Santiago Ayala · Máximo Colman · Ramiro Pereyra · Lucas Zigaran

**Estado:** **prototipo funcional** del simulador 3D (rama `dev-lucas`). Más abajo sigue la investigación que le dio origen.

📁 **[Carpeta técnica](docs/carpeta-tecnica.md):** usuarios finales, stack tecnológico, modelos, herramientas de IA, datos, instalación, pruebas y limitaciones.

---

## 0. El simulador (prototipo)

Mapa 3D interactivo de Formosa Capital. El operador **hace llover** una cantidad de agua por minuto o por hora, durante el tiempo que elija y con el río Paraguay a la altura que elija. Ve cómo el agua escurre y se acumula, y **qué zonas, barrios e infraestructura se afectan primero, segundo y tercero**.

### Cómo correrlo

Requisitos: Node.js 20 o superior.

```bash
npm install
npm run dev        # abre http://localhost:5173
npm test           # checks del modelo, de los datos y de la prioridad (Vitest)
npm run build      # chequeo de tipos (TypeScript) + compilación
```

Los datos procesados ya están en `public/data/`. Para regenerarlos desde cero:

```bash
npm run data       # MDE → OSM → máscaras → zonas 1º/2º/3º (unos 5 minutos)
```

`npm run data:dem` usa **FABDEM** (terreno sin edificios ni bosques) si está en `data-raw/`, y si no, Copernicus GLO-30. FABDEM se baja con un script que pide solo el tile de Formosa (~14 MB) dentro del zip de 2,1 GB de la Universidad de Bristol. Tarda unos 7 minutos porque el servidor es lento:

```bash
python scripts/fetch-fabdem.py
```

Respaldo con Copernicus (modelo de superficie, el script le aplica un filtro para bajar techos y árboles):

```bash
curl -o data-raw/cop_S27.tif https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_S27_00_W059_00_DEM/Copernicus_DSM_COG_10_S27_00_W059_00_DEM.tif
```

Los edificios vienen de Microsoft Global ML Building Footprints. El script `build-buildings` espera los archivos `data-raw/msb_*.csv.gz` del quadkey 210301321 (Argentina y Paraguay), que figuran en el índice `https://minedbuildings.z5.web.core.windows.net/global-buildings/dataset-links.csv`.

Escuelas y censo (ya procesados en `public/data/`):

```bash
npm run data:escuelas   # Mapa Educativo Nacional (WFS) → public/data/escuelas-men.json
npm run data:censo      # Censo 2022 por radio → public/data/poblacion.json
                        # antes: bajar data-raw/radios.parquet y data-raw/census-data.parquet (ver el script)
```

**Licencias de datos:** FABDEM CC BY-NC-SA 4.0 (Hawker et al. 2022, Univ. de Bristol / Fathom; uso no comercial), OpenStreetMap ODbL, Microsoft Building Footprints ODbL, Mapa Educativo Nacional CC BY 4.0, Censo 2022 (INDEC, vía source.coop, CC BY 4.0).

### Qué se puede hacer

- **Escenario:** lluvia en mm/h o en **mm por minuto** (1 mm = 1 litro por m²), duración, altura del río en Puerto Formosa (con marcas de hoy, alerta, evacuación y 1983), capacidad de desagüe y "falla de la defensa".
- **Escenarios de referencia:** Nivel 1 (lluvia fuerte), Nivel 2 (temporal severo con el río en alerta), Nivel 3 (extremo con el río en evacuación), **7 días** (el máximo del pronóstico de lluvia del 17/11/2026, 150 mm, concentrado en una tormenta de 3 h; rotulado ESTIMADO), y las crecidas de 1983 y 2015-16. Son **escenarios**, no categorías: para clasificar la altura del río se usa la escala del INA.
- **Red pluvial relevada:** el equipo relevó dónde hay bocas de tormenta, sumideros y conductos (casco céntrico, 9 de Julio, Madariaga, grandes avenidas y puntos en barrios). `scripts/build-drainage.ts` los ubica sobre OpenStreetMap: hoy cubren ~6,6 km² y se ubicaron 23 de 27 entradas. Ahí el desagüe es el 100 % del valor elegido; en el resto de la ciudad (solo cunetas e infiltración), el 50 %. Se ve con la capa «Bocas de tormenta». Es una **referencia sin verificar en campo**: no tenemos diámetros ni estado de limpieza. La lista está en `src/data/drainage-network.ts`.
- **Escala del INA:** el dato observado muestra su categoría oficial (por ejemplo, 4,96 m = aguas medias el 17/11/2026). El INA no publica los límites de sus cinco categorías en metros, así que la herramienta **no clasifica alturas hipotéticas**: muestra lecturas reales ya clasificadas por el INA como referencia.
- **Hacer llover:** la simulación corre en vivo, a 5, 15 o 30 minutos simulados por segundo.
- **Orden de afectación:** lista de calles, barrios e infraestructura (hospitales, salud, escuelas, bomberos y policía, servicios, municipio y asistencia social) ordenada por el momento en que el agua los alcanza. Cada uno indica su **nivel de referencia** (1º, 2º o 3º).
- **Capas:** agua en vivo, coloreada por profundidad o por **orden de llegada**; zonas precalculadas 1º/2º/3º; edificios, calles, riachos y barrios.
- **Transparencia:** etiquetas OBSERVADO (4,96 m, aguas medias, 17/11/2026) / PREVISIÓN INA (~4,55 m ± 0,3 al 25/11, estimado) / ESCENARIO DEL USUARIO, siempre visibles, y un panel con supuestos, datos, límites, validación y el checklist de la guía.
- **Supuesto de cada escenario:** cuánto sube el río y **en cuántos días** (al ritmo de la crecida de octubre de 2026, ~14 cm/día), cuánta lluvia en cuánto tiempo, horizonte y «confianza baja».
- **Escuelas del padrón oficial** (Mapa Educativo Nacional, 288 establecimientos en 281 edificios) en lugar de las de OpenStreetMap.
- **Margen paraguaya:** las instalaciones, barrios y calles de Alberdi (Paraguay) no cuentan en los resultados.
- **Tipo de calle** (capa del mapa): pavimentada, de tierra o sin dato, según la etiqueta «surface» de OpenStreetMap, con un revelado animado desde el centro. En Formosa: ~385 km pavimentados, ~679 km de tierra y ~152 km sin dato (13 %). Las calles sin dato ya no se cuentan como asfaltadas. En la lista de calles cortadas, las de tierra llevan la marca «tierra». Se actualiza con `npm run data:calles`.

### Prioridad por población (Censo 2022)

Las zonas 1º, 2º y 3º dicen **qué se afecta primero**. Pero un barrio alejado donde viven pocas familias no pesa lo mismo que un barrio denso y vulnerable que también está en peligro. La pestaña **Prioridad** y la capa **Prioridad (población)** ordenan los barrios con **datos sociodemográficos reales** del Censo 2022 (INDEC, por radio censal):

> **puntaje = personas × urgencia × vulnerabilidad**
> - **Personas:** las que viven en las celdas afectadas.
> - **Urgencia:** zona 1º ×3, 2º ×2, 3º ×1 (modo «plan»). En «escenario en curso»: el agua que llegó en el primer tercio del tiempo ×3, en el segundo ×2 y en el último ×1.
> - **Vulnerabilidad:** promedio de tres proporciones del radio censal comparadas con la ciudad: **hogares con NBI**, **niños ≤ 14 y mayores ≥ 65**, **personas sin obra social ni plan de salud**. 1 = promedio; entre 0,5 y 2.

Cada barrio tiene una **ficha** con su perfil: población, hogares, NBI, niños y mayores, sin cobertura de salud, hacinamiento, sin cloaca o agua de red y viviendas precarias. Datos del área: **253.833 personas**, 83.559 hogares, **8.200 hogares con NBI**, 56.661 niños de hasta 14 años y 23.763 personas de 65 o más (la ciudad con Villa del Carmen tiene 260.325 según el mismo censo).

**Dónde vive la gente (reparto por edificios).** El censo da totales por radio censal. En lugar de repartirlos parejo por toda la superficie del radio (que ponía gente en el campo, en el río y en lagunas), cada radio se reparte según la **superficie de edificios** que tiene adentro (Microsoft Building Footprints, tope de 400 m² por edificio). La población ubicada sobre río o lagunas bajó de 1,6 % a 0,4 %. Solo 2 radios sin edificios (1.226 personas) siguen con reparto parejo.

**Barrios.** OpenStreetMap tiene cada barrio como un punto, no con sus límites: cada lugar se asigna al barrio más cercano (hasta 1,2 km). Como OSM no tiene el microcentro, se agregó **«Centro»** en la Plaza San Martín; antes todo el centro se contaba dentro de San Martín. Son límites aproximados.

### Evaluación para autoridades (río en nivel de evacuación)

Cuando el escenario pone el río en **8,30 m o más** (nivel de evacuación del INA en Puerto Formosa), aparece arriba un aviso azul que late: **«Río en nivel de evacuación · Ver evaluación para autoridades»**. Al tocarlo se abre un panel aparte, pensado para Defensa Civil, con:

- el total de **familias** (hogares del Censo 2022), personas, niños, mayores y hogares con NBI en zonas con agua;
- los **barrios ordenados por prioridad** (personas con agua × urgencia por llegada × vulnerabilidad), con «X familias con agua de Y que viven ahí» y desde qué altura del río se afecta cada uno.

Está redactado como **«familias a evaluar para una posible evacuación»**: es una herramienta para evaluar, no una orden. La decisión de evacuar es de Defensa Civil, y las rutas y centros de evacuados son del Equipo 3. Las familias no se muestran en el mapa ni en los paneles comunes: solo en este apartado.

**Validación:** el panel «Supuestos y límites» cruza 6 barrios que la prensa reportó con agua (4 por lluvia, 2 por la crecida de 2015) con lo que marca el modelo. Son pocos casos: sirve para detectar contradicciones, no es una validación estadística. Fuentes en [docs/casos-y-alerta-refsa.md](docs/casos-y-alerta-refsa.md) y en `src/validation.ts`. No reemplaza al Equipo 4 (registro de incidentes): solo usa notas ya publicadas para comprobar el modelo.

### Cómo está hecho

| Parte | Archivo | Qué hace |
|---|---|---|
| Motor hidráulico | `src/sim/engine.ts` | Modelo 2D de **inercia local** (Bates et al. 2010, base de LISFLOOD-FP): lluvia, escurrimiento, fricción de Manning, desagüe declarado, río como borde de nivel fijo y estado inicial de "bañadera conectada" |
| Simulación en vivo | `src/sim/worker.ts` | Corre el motor en un Web Worker, con celdas de ~60 m |
| Escenarios y supuestos | `src/sim/scenarios.ts` | Niveles 1/2/3, crecida de 1983 y todos los supuestos numéricos |
| Escena 3D | `src/scene/MapScene.ts` | Three.js: terreno con curvas de nivel, agua, edificios, columnas de luz y lluvia |
| Análisis | `src/analysis.ts` | Cruza el agua con barrios e infraestructura: estado, primer contacto y nivel 1º/2º/3º |
| Prioridad | `src/priority.ts` | Censo en la grilla, índice de vulnerabilidad, puntaje por celda y por barrio, mapa de calor |
| Validación | `src/validation.ts` | Barrios reportados con agua por la prensa, con fuente, y su cruce con el modelo |
| Checks | `tests/` | Vitest: motor (bañadera, brecha, conservación de la masa, desagüe), datos reales (zonas al día, defensa, escuelas oficiales, margen paraguaya), prioridad y validación |
| Interfaz | `src/App.tsx` | Paneles de escenario, orden de afectación, capas y supuestos |
| Datos | `scripts/` | `build-terrain` (MDE), `fetch-osm` (OpenStreetMap), `build-masks` (río, defensa, agua), `build-drainage` (red pluvial relevada), `build-zones` (zonas 1º/2º/3º a 30 m), `fetch-escuelas` (Mapa Educativo Nacional) y `build-censo` (Censo 2022) |

**Supuesto clave a confirmar:** el **cero de escala de Puerto Formosa**. Se usa **47,30 m IGN**, deducido del dato oficial del Gobierno de Formosa (08/12/2015): la cota IGN 59 m equivale a 11,70 m de escala en el puerto. Falta confirmarlo con el INA y verificar la diferencia de dátum con el terreno (FABDEM está en EGM2008). Si cambia, se edita en `src/sim/scenarios.ts` y se corren `npm run data:zones` y `npm run data:thresholds`.

**Defensa:** el dato oficial habla de ~15 km de terraplén (otras notas de prensa dicen ~20 km). La traza del modelo mide ~38,6 km: une los 5 tramos reales de OpenStreetMap (los únicos mapeados) con conectores estimados que **bordean la zona edificada** sin cortar manzanas (`scripts/route-defensa.ts`: camino de menor costo que evita edificios y cuerpos de agua; al norte sigue el riacho Formosa). Antes los conectores eran rectas que cruzaban barrios. Es más larga que la real porque sigue el borde irregular de la ciudad: para la versión final hay que pedir la traza oficial a la Provincia. Se usa como barrera, con el coronamiento oficial (11,70 m de escala).

### Qué NO hace (para no pisar a otros equipos)

El evento tiene siete desafíos. Esta herramienta responde solo al **Desafío 3: qué podría afectarse en un escenario**. A propósito no hace:

| No hace | Lo trabaja | Cómo se conecta |
|---|---|---|
| Recorridos de evacuación, centros de recepción, capacidades o responsables | Equipo 3 · Evacuaciones | Nuestras zonas y calles intransitables pueden ser la **entrada** de su simulador |
| Comparar imágenes satelitales por fecha o detectar cambios de agua | Equipo 1 · Imágenes satelitales | Una mancha satelital real solo serviría, a lo sumo, para validar el modelo |
| Consultar o comparar registros de lluvia por estación | Equipo 5 · Reporte pluvial | La lluvia es solo una **entrada** del escenario |
| Registrar avisos o incidentes reales de vecinos | Equipo 4 · Reporte de incidentes | Las calles anegadas son **simuladas**, no reportadas |
| Inventario de atajaderos | Equipo 6 · Atajaderos | — |
| Pronosticar el nivel del río | INA | Solo enlazamos a la previsión oficial |

---

## Índice

1. [La idea en una línea](#1-la-idea-en-una-línea)
2. [Lo incómodo primero: qué cambia la investigación](#2-lo-incómodo-primero-qué-cambia-la-investigación)
3. [Qué pide el desafío (guía CITF v1.1)](#3-qué-pide-el-desafío-guía-citf-v11)
4. [Cómo se inunda Formosa Capital](#4-cómo-se-inunda-formosa-capital)
5. [Contexto actual: El Niño 2026-2027](#5-contexto-actual-el-niño-2026-2027)
6. [Historial de crecidas (para validar)](#6-historial-de-crecidas-para-validar)
7. [Fuentes de datos](#7-fuentes-de-datos)
8. [Cómo simular los escenarios: opciones de modelo](#8-cómo-simular-los-escenarios-opciones-de-modelo)
9. [Infraestructura crítica y exposición](#9-infraestructura-crítica-y-exposición)
10. [Stack técnico propuesto (mapa 3D "holográfico")](#10-stack-técnico-propuesto-mapa-3d-holográfico)
11. [Dónde entra la IA (y dónde no)](#11-dónde-entra-la-ia-y-dónde-no)
12. [Borrador: las 7 preguntas de la consigna](#12-borrador-las-7-preguntas-de-la-consigna)
13. [Límites e incertidumbre](#13-límites-e-incertidumbre)
14. [Decisiones pendientes del equipo](#14-decisiones-pendientes-del-equipo)
15. [Próximos pasos](#15-próximos-pasos)
16. [Fuentes consultadas](#16-fuentes-consultadas)

---

## 1. La idea en una línea

Un **mapa 3D de Formosa Capital con estética "holográfica"** (oscuro, líneas de luz, edificios extruidos) donde el operador elige un **escenario hipotético** y ve:

- qué zonas quedarían expuestas al agua,
- en qué **orden** se van afectando a medida que el escenario empeora,
- qué **infraestructura crítica** queda expuesta: escuelas, hospitales y centros de salud, bomberos y policía, estaciones de bombeo y servicios, calles y accesos,
- **qué datos y supuestos** se usaron, y cuánta **incertidumbre** tiene el resultado.

**Referencias visuales que trajo el equipo:**
- Video de un "gemelo digital" 3D de un estadio (TikTok @hightopo, plataforma comercial HT for Web): fondo azul oscuro, edificios con bordes luminosos, haces de luz verticales como marcadores de puntos de interés y paneles con datos.
- Imágenes de "heatmap" en malla de alambre (wireframe) con escala de color de azul a rojo: sirven de idea para mostrar la profundidad o la prioridad sobre el terreno.

---

## 2. Lo incómodo primero: qué cambia la investigación

Antes de diseñar, hay cuatro cosas que obligan a ajustar la idea original ("simular según la cantidad de lluvia de El Niño qué se inunda más rápido").

### 2.1 En Formosa Capital, El Niño no inunda solo "por la lluvia que cae en la ciudad"

Hay **dos mecanismos distintos** y conviene modelarlos por separado:

| Mecanismo | Qué lo dispara | Dónde golpea | Escala de tiempo |
|---|---|---|---|
| **Fluvial** (crecida del río Paraguay) | Lluvias en la cuenca alta (Brasil y Paraguay) y el **"efecto remanso"** del Paraná, que frena la salida del Paraguay | Barrios **fuera del anillo de defensa**: La Floresta, Laguna Siam, Fachini, zona de islas, Laguna Oca | Días a semanas (el río sube centímetros por día) |
| **Pluvial** (lluvia intensa local) | Tormentas fuertes sobre la ciudad (por ejemplo, 70 mm en 1 hora) | Calles y barrios **dentro del recinto**, sobre todo con desagües insuficientes y calles de tierra | Minutos a horas |

Además se **combinan**: con el río alto, el agua de lluvia dentro del recinto no puede salir por gravedad y hay que **bombearla**. El INA publica cómo cambia el estado de las **estaciones de bombeo del recinto de Formosa** según el nivel del río.

**Decisión propuesta:** el escenario no es una sola perilla de "lluvia de El Niño". Son **dos entradas**:
1. **Nivel del río en Puerto Formosa** (m, escala de Prefectura/INA).
2. **Lluvia local** (mm acumulados en X horas).

El Niño se usa como **marco** para elegir escenarios realistas, por ejemplo: "río en nivel de alerta (7,80 m) + tormenta de 100 mm".

### 2.2 "Qué se inunda más rápido" no se puede afirmar como tiempo

Con un modelo del terreno de 30 m y ~2 m de error vertical no se puede decir que un sector "se inunda en 3 horas". Lo que sí se puede mostrar con honestidad es el **orden de exposición**: para cada escuela u hospital, **a partir de qué nivel del río queda conectado al agua**. Por ejemplo: "esta escuela empieza a estar expuesta con el río a ~8,5 m". Eso responde "qué se afecta primero" sin inventar tiempos.

**Cómo quedó en el prototipo:** la simulación de lluvia sí calcula minutos de llegada del agua, pero se usan **solo para ordenar** (qué se moja antes que qué), nunca como un pronóstico de "en 40 minutos". La app lo dice en el panel de límites. Además, la lista se puede ordenar por **umbral de altura del río**, que no depende de tiempos.

### 2.3 Mostrar zonas a evaluar, no veredictos

La guía lo dice explícitamente. El mapa tiene que hablar de **zonas a evaluar** y de **orden** (1º, 2º, 3º) y no de "esta manzana se inunda". Para clasificar la altura del río se usa solo la escala del INA, sin categorías propias.

### 2.4 "Holográfico" es una estética, no un requisito técnico

El look del video se logra con un mapa web 3D bien estilizado. Un holograma físico (pirámide de Pepper's ghost) es un **extra opcional** para impresionar al jurado, no el núcleo.

---

## 3. Qué pide el desafío (guía CITF v1.1)

**Problema:** ante lluvias intensas o una posible crecida, identificar qué sectores, caminos, instalaciones o infraestructuras podrían verse afectados.

**La herramienta podría:**
- Seleccionar un escenario hipotético de lluvias o crecida.
- Identificar sectores o infraestructuras expuestos.
- Visualizar los elementos territoriales que requieren atención.
- Mostrar qué datos y supuestos se usaron.
- Indicar el horizonte temporal y la incertidumbre.

**Ejemplo de la guía:** un operador elige "lluvias intensas" y consulta qué sectores requieren evaluación prioritaria. La herramienta muestra un mapa o listado con los datos usados y las limitaciones.

**Cuidados obligatorios (guía, sección 03):**
- Usar la **escala del INA** (cinco categorías según frecuencia 1991–2020) y no inventar categorías propias.
- Cada escenario debe **declarar sus supuestos** (cuánto sube el río, en cuántos días) y mostrarlos junto al resultado.
- Distinguir en pantalla el **dato observado**, la **previsión del INA** y el **escenario del usuario**.
- MDE-Ar: ~2 m de precisión vertical, así que no se puede afirmar que 30 cm más de río inunden una cuadra.

**Pautas generales:** fuentes identificadas, datos con unidades, fechas y procedencia, estimaciones diferenciadas de observaciones, límites explícitos y decisiones operativas bajo responsabilidad humana.

**Niveles de referencia del río Paraguay (INA):**

| Estación | Alerta | Evacuación |
|---|---|---|
| Puerto Formosa | 7,80 m | 8,30 m |
| Puerto Pilcomayo | 5,35 m | 6,00 m |

Según el monitor de alturas que toma la lectura de Prefectura/INA, el umbral de **aguas bajas** en Puerto Formosa es de 1,60 m.

---

## 4. Cómo se inunda Formosa Capital

- **Ubicación:** margen derecha del río Paraguay, ~26°11′S 58°10′O, altura media ~57 m s. n. m. Cursos de agua urbanos y periurbanos: riacho Formosa, riacho El Pucú, riacho Chajá o Sian, y la laguna Oca (antiguo cauce del Paraguay, Reserva de Biosfera desde 2001).
- **Defensa:** la ciudad tiene una **línea de defensa contra inundaciones** (~15 km según el dato oficial; la prensa también cita ~20 km; la traza del modelo mide ~38,6 km, ver sección 0). Quienes viven **fuera** de ella son los primeros afectados en las crecidas.
- **Barrios fuera del anillo** citados en la crecida de diciembre de 2015: **La Floresta, Laguna Siam y Fachini**. También se citan barrios ribereños de la "zona de islas" y la laguna Oca.
- **Problema pluvial:** hay crónicas de **70 mm en una hora** (entre las 7 y las 8 de la mañana) que colapsaron el centro y los barrios, con calles de tierra en el norte de la ciudad que dificultan el acceso de maquinaria. En marzo de 2021 se acumularon **180 mm**, con agua dentro de viviendas en varios barrios.
- **Estaciones de bombeo del recinto:** el informe semanal del INA sobre la cuenca del Paraguay incluye una tabla con la **condición de las estaciones de bombeo del recinto de defensa de la ciudad de Formosa en función del nivel del río**. Es un dato clave para el escenario combinado. La tabla viene como imagen en el PDF y hay que transcribirla a mano.
- **Marco legal provincial:** existe una ley de Formosa sobre **línea de ribera y mapas de zona de riesgo hídrico**. Hay que buscar si la provincia publicó esos mapas: serían la mejor validación.

---

## 5. Contexto actual: El Niño 2026-2027

> Datos al 18/11/2026. **Se revisan antes de la presentación.**

- **Pronóstico ENSO (NOAA CPC, 12/11/2026):** alrededor de **60 %** de probabilidad de que el episodio supere en intensidad a todos los registrados desde 1950 en oct–dic 2026 y nov 2026–ene 2027, y **más de 79 %** de que se mantenga entre fuerte y muy fuerte hasta ene–mar 2027. La NOAA **no declaró oficialmente un "Súper Niño"**. Próximo informe: **10/12/2026**.
- **Cambio de índice:** desde el 01/02/2026 la NOAA reemplazó el ONI por el **RONI** (Relative Oceanic Niño Index). Hay que usar ese nombre al citar.
- **Señal regional:** el ECMWF ubica la señal húmeda más persistente de la primavera en el **NEA (Corrientes, Misiones, Chaco y Formosa)**.
- **El río Paraguay en Puerto Formosa** (lecturas de Prefectura publicadas en medios):

| Fecha | Altura | Fuente |
|---|---|---|
| 11/10/2026 | 2,88 m | Diario La Mañana |
| 15/10/2026 | 3,87 m | AGENFOR / Prensa Libre |
| 24/10/2026 | 5,20 m | El Monterizo |
| 30/10/2026 | 5,59 m | Agrofy (lectura INA/PNA) |
| 01/11/2026 | 5,48 m | El Monterizo |
| 04/11/2026 | 5,54 m | Guau Formosa |
| **17/11/2026** | **4,96 m (estable, aguas medias)** | **Parte «Situación hídrica y agroambiental», Subsecretaría de Producción Sustentable de Formosa (Prefectura / INA). Es el dato que usa la app.** |

  Ojo: Agrofy publicó 4,81 m para el mismo día, y la tabla del parte trae dos series para Formosa (una cierra en 4,89 m y otra en 4,96 m). Se usa la del encabezado del parte (4,96 m).

  El Ing. Juan Borús (INA) anticipó que la crecida del Paraná impactaría en Formosa por efecto remanso. El 29/10/2026 la provincia **activó su plan de contingencia**, con traslado de ganado en Banco Payaguá, General Mansilla y Colonia Cano.

- **Boletín El Niño N°8 (Dirección Nacional de Política Hídrica, 22/10/2026):** el SMN da **100 % de probabilidad** de que siga la fase El Niño en oct–nov–dic 2026, con lluvias por encima de lo normal en el **extremo este de Pilcomayo-Bermejo** (donde está Formosa). El INA ubicaba a Formosa en el *"rango central de aguas medias"*, en ascenso.
- **Parte provincial del 17/11/2026:** el Paraná está alto (Corrientes, Barranqueras y Paso de la Patria en alerta, Goya sobre la evacuación), lo que frena la salida del Paraguay (efecto remanso). Pronóstico de lluvia a 7 días para el departamento Formosa: **129 mm de promedio y hasta 150 mm** (Open-Meteo, ESTIMADO). El 67 % de la superficie provincial tiene suelos húmedos o muy húmedos (Sentinel-1, 16/09–31/10). El día pluviométrico oficial cierra a las 7 h.

**Lectura:** el río subió unos 2,7 m en octubre y hoy está en **aguas medias, estable**, a 2,84 m de la alerta (7,80 m). El escenario de riesgo para la demo es **hipotético**, no lo que pasa hoy. Eso encaja con la consigna.

---

## 6. Historial de crecidas (para validar)

| Año | Qué pasó | Uso en el proyecto |
|---|---|---|
| 1905, 1966, 1979, 1982 | Inundaciones que afectaron la planta urbana | Contexto |
| **1983** | Peor inundación registrada: **10,73 m** en el puerto de Formosa (El Niño 1982-83) | Escenario extremo de referencia |
| 1998 | Más de **150.000 personas** afectadas en la provincia (El Niño 1997-98) | Contexto |
| (fecha a confirmar) | **8,02 m** en Puerto Formosa y ~5.000 evacuados, sobre todo barrios ribereños y zona de islas | Escenario "evacuación" |
| **Dic 2015 – 2016** | Río por encima de 8 m (a 8 cm de la evacuación el 16/12/2015). Barrios afectados: La Floresta, Laguna Siam y Fachini. En abril de 2016 seguían ~5.000 personas en centros de evacuados | **Evento principal de validación** |
| Ene 2016 | Activación de la **Carta Internacional de Desastres**: CONAE produjo mapas de inundación de **Formosa ciudad** (ALOS, WorldView-2, Terra ASTER) | **Mapa de verdad de campo** para validar |
| 2026 | Crecida de octubre a 5,5 m y activación del plan de contingencia | Contexto actual |

> Ojo: una nota de 2016 menciona 7,80 m como "evacuación", que es el umbral de **alerta**. Usar siempre los umbrales del INA.

---

## 7. Fuentes de datos

Tipos según la guía: **OBS** = observado, **EST** = estimado, **REF** = referencia, **BASE** = base cartográfica.

### 7.1 Hidrometeorología

| Fuente | Qué aporta | Tipo | Uso |
|---|---|---|---|
| [INA – Alerta Hidrológico](https://www.ina.gob.ar/alerta/) / [mapa](https://alerta.ina.gob.ar/pub/mapa) | Reporte diario: niveles en Puerto Formosa y Pilcomayo, alerta y evacuación, lluvia semanal | OBS | Nivel actual del río (dato observado en pantalla) |
| [INA – Series y previsiones](https://alerta.ina.gob.ar/a5/secciones) | Series históricas y pronóstico numérico por estación | OBS / EST | Serie para frecuencias y previsión rotulada como "previsión INA" |
| INA – Informe semanal cuenca Paraguay (`ina.gob.ar/archivos/alerta/informe_paraguay_AAAA-MM-DD.pdf`) | Niveles esperados día a día y **tabla de estaciones de bombeo del recinto Formosa según nivel** | EST | Lógica del escenario combinado (río + lluvia) |
| [SMN – Alertas](https://www.smn.gob.ar/alertas) | Alertas y pronóstico | EST | Contexto meteorológico |
| SMN estación Formosa Aero (OMM 87162) | Lluvia diaria histórica | OBS | Elegir lluvias de escenario realistas |
| CHIRPS / GPM-IMERG (vía Google Earth Engine) | Lluvia satelital diaria o por hora | EST | Completar huecos y ver lluvias históricas sobre la cuenca |
| NOAA CPC – ENSO (RONI) | Estado y pronóstico de El Niño | EST | Marco del escenario |

| Parte «Situación hídrica y agroambiental» (Subsecretaría de Producción Sustentable de Formosa, 17/11/2026) | Alturas de Prefectura/INA, pronóstico de lluvia a 7 días por departamento, humedad del suelo | OBS / EST | Dato observado de la app y escenario «7 días» |
| Boletín El Niño N°8 (Dirección Nacional de Política Hídrica, 22/10/2026) | Fase ENOS (SMN), perspectiva trimestral y situación del río Paraguay (INA) | EST / OBS | Marco del escenario y categoría INA |

**Dato a confirmar:** el **cero de la escala de Puerto Formosa en cota IGN**. Hoy se usa 47,30 m, deducido del dato oficial provincial de 2015 (sección 0). El repositorio del INA tiene tablas con el cero de escala por estación (por ejemplo, Puerto Pilcomayo = 52,29 m IGN): falta encontrar el de Formosa para confirmarlo.

### 7.2 Terreno (MDE)

| Fuente | Resolución | Precisión vertical | Comentario |
|---|---|---|---|
| [IGN MDE-Ar v2.1](https://www.ign.gob.ar/) | 30 m | ~2 m | Oficial, recomendado por la guía. Combina SRTM y ALOS |
| IGN "MDE 5 m" | 5 m | Mejor | **Solo en algunos sectores del país.** Verificar si cubre Formosa: si cubre, cambia todo |
| Copernicus GLO-30 | 30 m | — | Modelo de superficie: incluye edificios y árboles |
| **FABDEM** | 30 m | Menor error en zonas urbanas y bosques | Copernicus con **bosques y edificios removidos** con ML. Para inundación es mejor que un modelo de superficie |

**Decisión propuesta:** probar **MDE-Ar v2.1** (oficial) contra **FABDEM** (sin edificios) sobre los mapas de CONAE 2016 y quedarse con el que mejor reproduzca la mancha de agua. Si el IGN tiene 5 m para Formosa, usar ese.

### 7.3 Exposición e infraestructura

| Fuente | Qué aporta | Tipo |
|---|---|---|
| [Mapa Educativo Nacional – geoservicios](http://mapa.educacion.gob.ar/geoservicios) | Escuelas georreferenciadas (padrón sep. 2023, CC BY 4.0) | REF |
| REFES / SISA – Ministerio de Salud ([datos.gob.ar](https://www.datos.gob.ar/dataset/salud-listado-establecimientos-salud-asentados-registro-federal-refes)) | Establecimientos de salud con y sin internación (código REFES) | REF |
| OpenStreetMap (Overpass) | Hospitales, bomberos, policía, subestaciones, planta de agua, puentes, calles | REF |
| [IGN – Capas SIG](https://www.ign.gob.ar/NuestrasActividades/InformacionGeoespacial/CapasSIG) | Límites, red vial, hidrografía, infraestructura y WMS de fondo | BASE |
| [INDEC Censo 2022](https://www.indec.gob.ar/indec/web/Institucional-Indec-BasesDeDatos) + [radios censales en Parquet (source.coop)](https://source.coop/nlebovits/censo-argentino/2022) | Población, hogares y viviendas por radio censal | REF |
| Google Open Buildings 2.5D Temporal | Presencia y **altura de edificios** a ~4 m efectivos, 2016–2023, cubre Latinoamérica | EST |
| Overture Maps / OSM buildings | Huellas de edificios | REF |

### 7.4 Validación (no se muestra en la app)

Comparar y detectar cambios en imágenes satelitales es el desafío del **Equipo 1**. Nosotros no mostramos imágenes ni detectamos cambios. Como mucho, un mapa de inundación ya hecho sirve para **validar** el modelo por fuera de la app:

| Fuente | Qué aporta |
|---|---|
| Carta Internacional de Desastres, activación del 28/12/2015 (CONAE) | Mapas de inundación de Formosa ciudad, enero de 2016, ya elaborados |

---

## 8. Cómo simular los escenarios: opciones de modelo

| Opción | Cómo funciona | Pros | Contras | ¿Para nosotros? |
|---|---|---|---|---|
| **"Bañadera" conectada** (bathtub) | Se inunda toda celda por debajo de la cota del agua **y conectada** al río | Simple, rápida, explicable | Ignora tiempo, caudal y obras | **Sí, para lo fluvial**, con la defensa como barrera |
| **HAND** (altura sobre el drenaje más cercano) | Mide cuánto está cada celda por encima del cauce más cercano | Muy usada para mapas rápidos | Pierde precisión en **llanuras**, terrenos de poco relieve y con MDE grueso | No |
| **Llenado de depresiones** (fill-and-spill) | La lluvia llena los "pozos" del terreno y desborda al siguiente | Muestra dónde se acumula la lluvia | No modela desagües ni bombas | **Sí, para lo pluvial** (aproximado) |
| Modelo hidráulico 2D (HEC-RAS 2D, LISFLOOD-FP) | Resuelve el flujo del agua en el tiempo | Lo más realista | Pide datos de desagües y calibración que no tenemos | **Sí, simplificado**: el prototipo usa inercia local (base de LISFLOOD-FP) con desagüe declarado |
| Susceptibilidad con ML entrenada con imágenes satelitales | Clasificador con manchas reales (Sentinel-1) | Usa la historia real | Pisa el desafío de imágenes satelitales (Equipo 1) | **No** |

### Propuesta original (lo que se implementó está en la sección 0)

1. **Capa fluvial:** el operador elige el **nivel del río** (por ejemplo 7,80 / 8,30 / 9,00 / 10,73 m). Se convierte a cota con el cero de escala y se inunda "por bañadera conectada", respetando el anillo de defensa como barrera (con un interruptor opcional de **falla de defensa**).
   - De ahí sale el **umbral de exposición** de cada edificio crítico: **el nivel del río al que queda conectado al agua**. Eso permite ordenar "qué se afecta primero".
2. **Capa pluvial:** el operador elige la **lluvia** (mm en X horas). Se marcan las depresiones del terreno que se llenan con ese volumen, suponiendo una capacidad de desagüe y bombeo **declarada en pantalla**. Si el río está alto, se aplica la regla de las estaciones de bombeo del INA.
3. ~~Capa IA de susceptibilidad con imágenes satelitales~~: descartada para no pisar al Equipo 1.

**Salida:** cada sector, calle o edificio recibe un **orden de afectación** (1º, 2º o 3º, y el minuto o la altura del río a la que se afecta), con los supuestos visibles.

---

## 9. Infraestructura crítica y exposición

| Categoría | Por qué importa | Fuente |
|---|---|---|
| Escuelas | Concentran chicos y personal; hoy salen de OSM (pendiente: Mapa Educativo Nacional) | OSM / Mapa Educativo Nacional |
| Hospitales y centros de salud | Atención durante la emergencia | OSM / REFES |
| Municipio y asistencia social | Edificios públicos y hogares | OSM |
| Estaciones de bombeo | Si quedan fuera de servicio, se inunda el recinto | INA (tabla) / municipio / OSM |
| Calles | Cuántos km quedan con agua sobre el cordón o intransitables | OSM |
| Energía y agua potable | Cortes de energía citados en temporales | OSM |
| Viviendas y población | Cuántas personas hay en cada zona | Censo 2022 por radio |

**Indicadores por escenario:**
- Cantidad de escuelas, centros de salud y bombas expuestos, ordenados por **umbral de exposición**.
- Población estimada en zonas a evaluar (radio censal × fracción del radio expuesta). **Es una estimación** y se rotula así. Pendiente.
- Calles con agua sobre el cordón e intransitables (km). Qué hacer con esa información (recorridos, traslados) es del desafío de evacuaciones (Equipo 3).

---

## 10. Stack técnico propuesto (mapa 3D "holográfico")

### Procesamiento de datos (offline, Python)

- `rasterio`, `geopandas`, `shapely`: manejo de ráster y vectores.
- `whitebox` o `pysheds`: hidrocondicionamiento, depresiones, HAND y acumulación de flujo.
- Salidas listas para web: **COG** o **PNG de terreno** para el MDE, **PMTiles** o **GeoJSON** para vectores, y **capas precalculadas por nivel de río** (por ejemplo, cada 10 cm de 6 a 11 m) para que la demo sea instantánea.

### Visualización web 3D

| Opción | Fortalezas | Debilidades |
|---|---|---|
| **MapLibre GL JS + deck.gl** *(recomendada)* | Liviano. Muy bueno con vectores y edificios extruidos. deck.gl tiene capas analíticas y efectos de luz. Open source | Terreno 3D más simple que Cesium |
| CesiumJS | Globo 3D completo, terreno, 3D Tiles. Estándar para "gemelos digitales" | Más pesado. Rinde peor con muchos vectores livianos |
| Three.js puro | Control total del estilo "holograma" (bloom, shaders) | Hay que programar georreferenciación y cámara a mano |
| Hightopo HT for Web (la del video) | Look espectacular de fábrica | **Comercial** y cerrada. No la recomendamos |

**Decisión tomada:** el prototipo usa **Three.js puro** (TypeScript + Vite + React), con el terreno, el agua y la cámara programados a mano. La tabla queda como registro de las opciones evaluadas.

**Receta de la estética "holográfica":**
- Mapa base oscuro y edificios extruidos con bordes cian (alturas de Open Buildings 2.5D).
- Agua como plano semitransparente que **sube animado** al mover el control del nivel del río.
- Infraestructura crítica como **columnas de luz** coloreadas por prioridad.
- Terreno en malla de alambre con color por profundidad o susceptibilidad (como las imágenes de referencia).
- Panel lateral con **tres etiquetas siempre visibles:** `OBSERVADO (INA, fecha)` · `PREVISIÓN INA` · `ESCENARIO DEL USUARIO`.

**Extra opcional para el jurado:** una **pirámide de Pepper's ghost** (acrílico y pantalla o tablet) que muestre una vista girando de la maqueta 3D. Es barato y vistoso, pero **no** es un holograma real y no hay que venderlo como tal.

---

## 11. Dónde entra la IA (y dónde no)

**Qué tecnología usa hoy el prototipo:**
- **Simulación física**, no IA: un modelo hidráulico 2D (inercia local, base de LISFLOOD-FP) que hace llover sobre el terreno y mueve el agua celda por celda. Es explicable y cada supuesto está a la vista.
- **IA en los datos:** el terreno es **FABDEM**, un modelo satelital al que un algoritmo de aprendizaje automático le quitó edificios y árboles. Los edificios son de **Microsoft Building Footprints**, detectados con aprendizaje profundo sobre imágenes.

**Posible agregado (opcional):**
- **Asistente en lenguaje natural:** "¿Qué escuelas quedan expuestas con el río a 8,5 m?" → consulta los resultados ya calculados. **Nunca** inventa números: solo lee lo que calculó el modelo.

**Descartado:**
- Entrenar un modelo con imágenes satelitales (Sentinel-1): es el terreno del Equipo 1.
- Clasificar o agrupar avisos de vecinos: es el terreno del Equipo 4.

**No:**
- La IA **no predice** el nivel del río. Eso es del INA.
- La IA **no decide** evacuaciones. Esa decisión es humana, según la consigna.

---

## 12. Las 7 preguntas de la consigna (según el prototipo actual)

| # | Pregunta | Respuesta |
|---|---|---|
| 01 | ¿Quién la usaría? | Operador o técnico de Defensa Civil o del municipio que prepara la respuesta ante un temporal o una crecida |
| 02 | ¿Qué necesidad atiende? | Saber **dónde actuar primero**: qué calles, barrios e instalaciones revisar antes según cuánto llueva y qué tan alto esté el río, **y cuánta gente vulnerable vive ahí**, para poner los recursos donde más personas están en peligro |
| 03 | ¿Función principal? | Elegir un escenario (lluvia + río), **hacer llover** sobre un mapa 3D de Formosa Capital y ver el **orden de prioridad de los barrios** (personas × urgencia × vulnerabilidad, Censo 2022) y el **orden** en que se afectan calles e infraestructura, con los supuestos a la vista |
| 04 | ¿Qué datos y de dónde? | Río: Prefectura/INA (parte provincial del 17/11/2026) y niveles de alerta y evacuación del INA. Lluvia: escenarios declarados y pronóstico a 7 días (Open-Meteo, estimado). Terreno: FABDEM. Población, hogares, NBI, edades y cobertura de salud: **Censo 2022 (INDEC)** por radio censal. Escuelas: **Mapa Educativo Nacional**. Calles, barrios y demás instalaciones: OpenStreetMap. Edificios: Microsoft Building Footprints. Defensa: dato oficial provincial de 2015 |
| 05 | ¿Qué se muestra al jurado? | "Abro **Prioridad**: el mapa de calor y la lista dicen dónde actuar primero según la gente que vive ahí. Muestro que un barrio de nivel 1º con pocas familias queda debajo de uno denso y vulnerable. Elijo el Nivel 2 (105 mm con el río en alerta), toco Hacer llover y cambio a «escenario en curso»: la lista se reordena con el agua de la simulación y aparecen personas, niños, mayores y hogares con NBI con agua. Después subo el río a 1983 y activo la rotura de la defensa. Cierro con la validación y los límites" |
| 06 | ¿Qué no podemos asegurar? | Qué manzana se inunda ni a qué hora: el terreno tiene 1–2 m de error y no conocemos los desagües ni el estado de las bombas. La escala del río mide un solo punto. El listado de OSM puede tener faltantes (sección 13) |
| 07 | ¿Por qué IA o tecnología? | La simulación física junta en segundos terreno, río, lluvia y edificios que hoy están dispersos, y la hace entendible en 3D para quien no es técnico. La IA está en los datos (terreno sin edificios con FABDEM, huellas de edificios detectadas con aprendizaje profundo). Cada número se explica y no se inventan categorías |

---

## 13. Límites e incertidumbre

- **MDE:** ~2 m de error vertical en MDE-Ar v2.1. En una llanura, eso puede ser más que la diferencia entre "seco" y "bajo agua".
- **Escala puntual:** la altura del río se mide en un punto (el puerto), y el agua no sube igual en toda la costa.
- **Defensa y bombas:** se asume que la defensa funciona salvo que el operador active "falla". El estado real de las bombas no es público en tiempo real.
- **Desagües pluviales:** la red está relevada solo en parte (ubicación, sin diámetros ni estado de limpieza) y el reparto 100 % / 50 % es un supuesto, así que la capa pluvial es **indicativa**. Cuatro puntos no se pudieron ubicar en OSM (Moreno y 9 de Julio, González Lelong y Gendarmería, Los Constituyentes y Beata Nazaria, Av. Chaco y Moreno).
- **Tiempo:** los minutos de llegada del agua sirven para **ordenar**, no para planificar al minuto.
- **Datos de exposición:** la infraestructura sale de OpenStreetMap (consulta del 19/11/2026). Pueden faltar o sobrar establecimientos.
- **Escala del INA:** el INA no publica los límites de sus categorías en metros, así que solo se muestran categorías de lecturas reales.
- **Horizonte temporal:** el río es un valor fijo durante la simulación (horas) y la lluvia dura lo que declara el escenario. El escenario «7 días» toma un pronóstico estimado y supone que se concentra en 3 h. No es un pronóstico: el pronóstico oficial es del INA y del SMN.

---

## 14. Decisiones pendientes del equipo

- [x] Foco: **ambos** (lluvia y río combinados).
- [x] MDE: **FABDEM** (con Copernicus de respaldo).
- [x] Motor 3D: **Three.js**.
- [ ] ¿Área de estudio: solo el ejido urbano o también el periurbano (islas, laguna Oca)?
- [ ] ¿Incluimos la pirámide de Pepper's ghost para la demo?
- [ ] ¿Contactamos a Defensa Civil o al municipio para validar los barrios críticos?
- [ ] ¿Sumamos el asistente en lenguaje natural sobre los resultados (sección 11)?

---

## 15. Próximos pasos

1. Confirmar con el INA el **cero de escala IGN de Puerto Formosa** (hoy 47,30 m, deducido del dato provincial de 2015).
2. Conseguir los límites en metros de las **categorías del INA** para Puerto Formosa (o la serie 1991–2020 para calcularlos) y así clasificar también las alturas hipotéticas.
3. ~~Reemplazar las escuelas de OSM por el Mapa Educativo Nacional y sumar población del Censo 2022~~: hecho. Falta sumar los polígonos del **RENABAP** (barrios populares) a la vulnerabilidad (el servidor estaba en mantenimiento el 19/11/2026).
4. Validar por fuera de la app contra los mapas de **CONAE de enero de 2016**.
5. Transcribir la **tabla de estaciones de bombeo** del informe INA.
6. Antes de la presentación, actualizar el dato observado con el último parte del INA o de la provincia.

---

## 16. Fuentes consultadas

**Del desafío**
- CITF – *Operación Agua, Equipo 2, Desafío 3: Predicción de afectaciones*, guía v1.1, noviembre de 2026 (PDF entregado al equipo).

**Partes oficiales recibidos (PDF)**
- Ministerio de la Producción y Ambiente de Formosa, Subsecretaría de Producción Sustentable – *Situación hídrica y agroambiental*, 17/11/2026.
- Dirección Nacional de Política Hídrica y Coordinación Federal – *Boletín El Niño N°8*, 22/10/2026 (SMN, INA, CTN, COREBE).

**Hidrología y crecidas en Formosa**
- INA – Alerta Hidrológico: https://www.ina.gob.ar/alerta/ · Reporte diario: https://alerta.ina.gob.ar/a5/diario/reporte_diario
- INA – Informe situación cuenca del río Paraguay (ejemplo, con mención de las bombas del recinto Formosa): https://www.ina.gob.ar/archivos/alerta/informe_paraguay_2024-04-22.pdf
- INA – Repositorio con tabla de estaciones y cero de escala IGN: https://repositorio.ina.gob.ar/bitstreams/5ec68d42-1f57-486b-9493-4bd7b8c0b645/download
- Agrofy – Altura del río en Puerto Formosa: https://news.agrofy.com.ar/altura-de-los-rios/puerto-formosa
- Angonoa y Muracciole – *Actores estatales, políticas públicas y espacio urbano. Caso: Inundación 1983, ciudad de Formosa* (UNC): https://revistas.psi.unc.edu.ar/index.php/sintesis/article/download/12225/12554/32312
- Infocampo – 5.000 evacuados, 8,02 m; referencia de 10,73 m en 1983: https://www.infocampo.com.ar/?p=308533
- Diario Jornada – Crecida de diciembre de 2015, barrios fuera del anillo: https://diariojornada.com.ar/147550/magazine/continua_la_crecida_del_rio_paraguay_y_amenaza_a_formosa
- Infobae – Evacuados en Formosa, abril de 2016: https://www.infobae.com/2016/04/09/1803173-litoral-15-mil-personas-afectadas-las-lluvias-seis-provincias
- Diario de Cuyo – Línea de defensa de 20 km: https://www.diariodecuyo.com.ar/noticias/formosa-en-emergencia-crece-el-rio-y-temen-por-nuevas-lluvias-676943.html
- CELS – Inundaciones de 1998: https://www.cels.org.ar/web/wp-content/uploads/2016/10/IA1998-14-Inundaciones.-Excesos-de-la-naturaleza.pdf
- Infocampo – Temporal de 70 mm en una hora: https://www.infocampo.com.ar/?p=367523
- Meteored – 180 mm en marzo de 2021: https://www.meteored.com.ar/noticias/actualidad/tras-las-lluvias-las-inundaciones-en-distintos-puntos-de-argentina.html
- Ley provincial de línea de ribera y zonas de riesgo hídrico (FAOLEX): https://faolex.fao.org/docs/pdf/arg49044.pdf
- Plan de Ordenamiento Territorial POT FOR 2040 (FAU-UNNE y Municipalidad): https://www.formosatuciudad.gob.ar/archivos/TU_CIUDAD/POT/2026/POT%20FOR%202040.pdf

**Contexto 2026**
- Diario La Mañana – El río superó los 5 m (Borús, INA): https://www.xn--lamaanaonline-lkb.com.ar/noticia/108064/el-ro-paraguay-super-los-5-metros-enel-puerto-local-y-contina-en-creciente/
- AGENFOR – 3,87 m el 15/10/2026: https://agenfor.com.ar/2026/10/en-la-ultima-semana-el-rio-paraguay-crecio-un-metro-pero-todavia-esta-lejos-de-los-niveles-de-alerta/
- El Monterizo – 5,20 m (24/10) y 5,48 m (01/11): https://www.elmonterizo.com/el-agua-ya-les-llega-al-campo-el-rio-paraguay-no-para-de-subir-y-los-productores-mueven-el-ganado · https://elmonterizo.com/el-rio-paraguay-volvio-a-subir-en-formosa-el-numero-que-mira-prefectura-y-por-que-no-es-tranquilizador
- Guau Formosa – 5,54 m (04/11): https://www.guauformosa.com.ar/noticias/2026/11/04/42423-el-rio-paraguay-se-mantiene-estable-pero-podria-crecer-nuevamente-en-los-proximos-10-dias
- Bichos de Campo – Plan de contingencia (29/10/2026): https://bichosdecampo.com/ahora-le-toca-a-formosa-la-crecida-del-rio-paraguay-activa-el-plan-de-evacuacion-y-extiende-hacia-el-norte-una-emergencia-que-ya-movilizo-casi-150-000-animales/
- El Comercio – NOAA, noviembre de 2026: https://www.elcomercio.com/actualidad/mundo/noaa-preve-fenomeno-de-el-nino-muy-fuerte-2027-descarta-declaracion-de-super-nino/
- El Observador CR – Probabilidades NOAA (12/11/2026): https://observador.cr/noaa-eleva-al-60-la-probabilidad-de-que-el-nino-alcance-una-intensidad-sin-precedentes-desde-1950/
- Futura Sciences – Cambio de ONI a RONI: https://futura-sciences.com/en/el-nino-could-return-in-2026-and-scientists-warn-it-may-push-global-temperatures-even-higher_27846
- Perfil – ECMWF y señal húmeda en el NEA: https://www.perfil.com/noticias/clima/el-nino-el-centro-europeo-de-previsiones-meteorologicas-preciso-a50-que-se-espera-para-argentina-en-septiembre-octubre-y-noviembre.phtml

**Datos geoespaciales**
- IGN MDE-Ar v2.1 (30 m, ~2 m de precisión vertical): https://eo4society.esa.int/wp-content/uploads/2021/11/CONAE_DEM_JCandia.pdf
- Comparación SRTM vs MDE-Ar en llanura urbana (Chaco): https://revistas.unne.edu.ar/index.php/geo/article/download/4015/4131
- FABDEM (Fathom / Univ. de Bristol): https://www.fathom.global/academic-papers/a-30-m-global-map-of-elevation-with-forests-and-buildings-removed/
- Evaluación de MDE globales en zonas inundables: https://naturalhazards.com.au/resources/publications/journal-article/vertical-accuracy-assessment-freely-available-global-dems
- Carta Internacional de Desastres, activación de 2015 (mapas CONAE de Formosa): https://www.disasterscharter.org/pt/web/guest/activations/-/article/flood-in-argenti-3
- Google Open Buildings 2.5D Temporal: https://sites.research.google/gr/open-buildings/temporal
- REFES (datos.gob.ar): https://www.datos.gob.ar/dataset/salud-listado-establecimientos-salud-asentados-registro-federal-refes
- Censo 2022 + radios en Parquet: https://source.coop/nlebovits/censo-argentino/2022

**Datos sociodemográficos y escuelas**
- INDEC – Censo 2022 por radio censal, todas las variables (REDATAM), vía source.coop (CC BY 4.0): https://source.coop/nlebovits/censo-argentino/2022
- Rodriguez y de Grande (CONICET) – Radios censales corregidos y estandarizados: https://ri.conicet.gov.ar/handle/11336/149711
- Mapa Educativo Nacional – WFS de establecimientos (CC BY 4.0): https://mapa.educacion.gob.ar/geoservicios
- INA – Reporte diario del 19/11/2026 (previsión a corto plazo de Puerto Formosa): https://alerta.ina.gob.ar/ina/06-INFORMES/diario/pdf/reporte_diario_2026-11-19.pdf
- UNMdP – "Cuando los mapas aprenden a pensar" (GeoAI): https://humanidades.mdp.edu.ar/inteligencia-artificial-geoespacial-geoai/

**Modelos y visualización**
- NOAA – Ficha del método HAND: https://www.weather.gov/media/owp/operations/HAND_factsheet.pdf
- Aristizabal et al. 2024 (HESS) – HAND y calidad del MDE: https://hess.copernicus.org/articles/28/1287/2024/hess-28-1287-2024.pdf
- Susceptibilidad con Sentinel-1 + ML: https://www.mdpi.com/2072-4292/17/20/3471
- CesiumJS vs MapLibre GL JS (FOSS4G 2025 / arXiv): https://arxiv.org/abs/2602.23660
- deck.gl vs MapLibre: https://atlas.co/comparisons/deck-gl-vs-maplibre/
- Pepper's ghost sobre maqueta (caso Calais): https://holusion-com--pr279-calais-ktc04a16.web.app/en/posts/2026-04-05-calais

---

*Los datos de 2026 son de medios que citan a Prefectura, INA y NOAA. Antes de la presentación hay que reemplazarlos por la fuente primaria (INA) con fecha.*
