# Operación Agua · Equipo 2 — Mapa 3D de afectaciones en Formosa Capital

> **AI Lab Misión: Código Formosa** · Desafío 3: *Predicción de afectaciones*
> Instituto Politécnico Formosa · Santiago Ayala · Máximo Colman · Ramiro Pereyra · Lucas Zigaran

**Estado:** fase de **investigación y decisiones técnicas**. Todavía no hay código.
Este README junta lo investigado hasta ahora. Se actualiza a medida que el equipo define la idea.

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
- qué **infraestructura crítica** queda expuesta: escuelas, hospitales y centros de salud, centros de evacuados, estaciones de bombeo, rutas y accesos,
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

### 2.3 Mostrar zonas a evaluar, no veredictos

La guía lo dice explícitamente. El mapa tiene que hablar de **prioridad de evaluación** (alta, media o baja) y no de "esta manzana se inunda".

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
- **Defensa:** la ciudad tiene una **línea de defensa contra inundaciones de ~20 km**. Quienes viven **fuera** de ella son los primeros afectados en las crecidas.
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
| 17/11/2026 | 4,81 m (bajando) | Agrofy |

  El Ing. Juan Borús (INA) anticipó que la crecida del Paraná impactaría en Formosa por efecto remanso. El 29/10/2026 la provincia **activó su plan de contingencia**, con traslado de ganado en Banco Payaguá, General Mansilla y Colonia Cano.

**Lectura:** el río subió unos 2,7 m en octubre y hoy está en **aguas medias, bajando**, lejos de la alerta (7,80 m). El escenario de riesgo para la demo es **hipotético**, no lo que pasa hoy. Eso encaja con la consigna.

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

**Dato faltante:** el **cero de la escala de Puerto Formosa en cota IGN**. Sin él no se puede pasar "nivel del río en m" a "cota del agua en m s. n. m." sobre el MDE. El repositorio del INA tiene tablas con el cero de escala por estación (por ejemplo, Puerto Pilcomayo = 52,29 m IGN). **Hay que buscar el de Formosa.**

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

### 7.4 Agua observada desde satélite (para validar y entrenar)

| Fuente | Qué aporta |
|---|---|
| Carta Internacional de Desastres, activación del 28/12/2015 (CONAE) | Mapas de inundación de Formosa ciudad, enero de 2016 |
| Sentinel-1 SAR (Google Earth Engine) | Radar que ve agua **con nubes**. Permite armar un inventario de manchas de agua desde 2015 |
| JRC Global Surface Water | Frecuencia histórica de agua superficial (1984 en adelante) |

---

## 8. Cómo simular los escenarios: opciones de modelo

| Opción | Cómo funciona | Pros | Contras | ¿Para nosotros? |
|---|---|---|---|---|
| **"Bañadera" conectada** (bathtub) | Se inunda toda celda por debajo de la cota del agua **y conectada** al río | Simple, rápida, explicable | Ignora tiempo, caudal y obras | **Sí, para lo fluvial**, con la defensa como barrera |
| **HAND** (altura sobre el drenaje más cercano) | Mide cuánto está cada celda por encima del cauce más cercano | Muy usada para mapas rápidos | Pierde precisión en **llanuras**, terrenos de poco relieve y con MDE grueso | Como **variable de entrada** del modelo de IA |
| **Llenado de depresiones** (fill-and-spill) | La lluvia llena los "pozos" del terreno y desborda al siguiente | Muestra dónde se acumula la lluvia | No modela desagües ni bombas | **Sí, para lo pluvial** (aproximado) |
| Modelo hidráulico 2D (HEC-RAS 2D, LISFLOOD-FP) | Resuelve el flujo del agua en el tiempo | Lo más realista | Pide datos de desagües y calibración que no tenemos | **No** (fuera de alcance) |
| **Susceptibilidad con ML** | Se entrena un clasificador con manchas reales (Sentinel-1) y variables del terreno | Usa la historia real de Formosa | Necesita buenos eventos etiquetados | **Sí, como capa de IA** |

### Propuesta: modelo híbrido en 3 capas

1. **Capa fluvial:** el operador elige el **nivel del río** (por ejemplo 7,80 / 8,30 / 9,00 / 10,73 m). Se convierte a cota con el cero de escala y se inunda "por bañadera conectada", respetando el anillo de defensa como barrera (con un interruptor opcional de **falla de defensa**).
   - De ahí sale el **umbral de exposición** de cada edificio crítico: **el nivel del río al que queda conectado al agua**. Eso permite ordenar "qué se afecta primero".
2. **Capa pluvial:** el operador elige la **lluvia** (mm en X horas). Se marcan las depresiones del terreno que se llenan con ese volumen, suponiendo una capacidad de desagüe y bombeo **declarada en pantalla**. Si el río está alto, se aplica la regla de las estaciones de bombeo del INA.
3. **Capa IA (susceptibilidad):** un mapa de **probabilidad relativa** de anegamiento aprendido de eventos reales. Se usa para **priorizar**, no para afirmar.

**Salida:** cada sector o edificio recibe una **prioridad de evaluación** (alta, media o baja), con la explicación de por qué y con los supuestos visibles.

---

## 9. Infraestructura crítica y exposición

| Categoría | Por qué importa | Fuente |
|---|---|---|
| Escuelas | **Doble rol:** pueden quedar afectadas **y** se usan como **centros de evacuados** | Mapa Educativo Nacional |
| Hospitales y centros de salud | Atención durante la emergencia | REFES / OSM |
| Centros de evacuados | Si se inundan, el plan falla | A relevar con Defensa Civil y municipio |
| Estaciones de bombeo | Si quedan fuera de servicio, se inunda el recinto | INA (tabla) / municipio / OSM |
| Rutas, accesos y puentes | Aislamiento de barrios, acceso de ambulancias | IGN / OSM |
| Energía y agua potable | Cortes de energía citados en temporales | OSM |
| Viviendas y población | Cuántas personas hay en cada zona | Censo 2022 por radio |

**Indicadores por escenario:**
- Cantidad de escuelas, centros de salud y bombas expuestos, ordenados por **umbral de exposición**.
- Población estimada en zonas a evaluar (radio censal × fracción del radio expuesta). **Es una estimación** y se rotula así.
- Accesos cortados: si una escuela no se inunda pero queda aislada, también hay que marcarla.

---

## 10. Stack técnico propuesto (mapa 3D "holográfico")

### Procesamiento de datos (offline, Python)

- `rasterio`, `geopandas`, `shapely`: manejo de ráster y vectores.
- `whitebox` o `pysheds`: hidrocondicionamiento, depresiones, HAND y acumulación de flujo.
- **Google Earth Engine:** Sentinel-1, CHIRPS, JRC y Open Buildings.
- `scikit-learn` / `xgboost`: modelo de susceptibilidad.
- Salidas listas para web: **COG** o **PNG de terreno** para el MDE, **PMTiles** o **GeoJSON** para vectores, y **capas precalculadas por nivel de río** (por ejemplo, cada 10 cm de 6 a 11 m) para que la demo sea instantánea.

### Visualización web 3D

| Opción | Fortalezas | Debilidades |
|---|---|---|
| **MapLibre GL JS + deck.gl** *(recomendada)* | Liviano. Muy bueno con vectores y edificios extruidos. deck.gl tiene capas analíticas y efectos de luz. Open source | Terreno 3D más simple que Cesium |
| CesiumJS | Globo 3D completo, terreno, 3D Tiles. Estándar para "gemelos digitales" | Más pesado. Rinde peor con muchos vectores livianos |
| Three.js puro | Control total del estilo "holograma" (bloom, shaders) | Hay que programar georreferenciación y cámara a mano |
| Hightopo HT for Web (la del video) | Look espectacular de fábrica | **Comercial** y cerrada. No la recomendamos |

**Recomendación:** **MapLibre GL JS + deck.gl**, con una **capa personalizada de Three.js** para efectos (agua animada, bloom y haces de luz sobre escuelas y hospitales). Para una ciudad, un mapa liviano de vectores alcanza y sobra. Cesium tiene sentido si después se quiere escalar a toda la provincia o cargar modelos 3D Tiles.

**Receta de la estética "holográfica":**
- Mapa base oscuro y edificios extruidos con bordes cian (alturas de Open Buildings 2.5D).
- Agua como plano semitransparente que **sube animado** al mover el control del nivel del río.
- Infraestructura crítica como **columnas de luz** coloreadas por prioridad.
- Terreno en malla de alambre con color por profundidad o susceptibilidad (como las imágenes de referencia).
- Panel lateral con **tres etiquetas siempre visibles:** `OBSERVADO (INA, fecha)` · `PREVISIÓN INA` · `ESCENARIO DEL USUARIO`.

**Extra opcional para el jurado:** una **pirámide de Pepper's ghost** (acrílico y pantalla o tablet) que muestre una vista girando de la maqueta 3D. Es barato y vistoso, pero **no** es un holograma real y no hay que venderlo como tal.

---

## 11. Dónde entra la IA (y dónde no)

**Sí:**
- **Susceptibilidad aprendida:** clasificador (Random Forest o XGBoost) entrenado con manchas de agua reales de Sentinel-1 (por ejemplo, 2015-16 y 2026) y variables como altura, HAND, pendiente, distancia al río o riacho, uso del suelo, impermeabilización y si la zona está dentro o fuera de la defensa. La literatura reciente usa justamente Sentinel-1 en Earth Engine y modelos de árboles para mapear susceptibilidad en ciudades con pocos datos.
- **Explicabilidad:** SHAP para mostrar **por qué** una zona tiene prioridad alta.
- **Asistente en lenguaje natural (opcional):** "¿Qué escuelas quedan expuestas con el río a 8,5 m?" → consulta a los datos precalculados. **Nunca** inventa números: solo lee lo que calculó el modelo.

**No:**
- La IA **no predice** el nivel del río. Eso es del INA.
- La IA **no decide** evacuaciones. Esa decisión es humana, según la consigna.

---

## 12. Borrador: las 7 preguntas de la consigna

| # | Pregunta | Borrador de respuesta |
|---|---|---|
| 01 | ¿Quién la usaría? | Operador o técnico de Defensa Civil o del municipio que prepara la respuesta ante una crecida o temporal |
| 02 | ¿Qué necesidad atiende? | Saber **qué infraestructura crítica revisar primero** según qué tan alto llegue el río o cuánto llueva |
| 03 | ¿Función principal? | Mover el **nivel del río y la lluvia** y ver en 3D las zonas y los edificios críticos a evaluar, ordenados por prioridad |
| 04 | ¿Qué datos y de dónde? | INA, SMN, MDE-Ar o FABDEM, Mapa Educativo, REFES, OSM, Censo 2022, Sentinel-1 y mapas CONAE 2016 (sección 7) |
| 05 | ¿Qué se muestra al jurado? | "Subo el río de 5,5 m (hoy) a 8,30 m (evacuación) → aparecen las escuelas y centros de salud que quedan expuestos, en orden, con sus supuestos visibles" |
| 06 | ¿Qué no podemos asegurar? | Qué manzana se inunda ni en cuánto tiempo. No conocemos los desagües ni el estado de las bombas. Error del MDE ~2 m (sección 13) |
| 07 | ¿Por qué IA o tecnología? | Junta en segundos datos que hoy están dispersos. La IA aprende de inundaciones reales de Formosa y explica por qué prioriza. El 3D hace entendible el riesgo para quien no es técnico |

---

## 13. Límites e incertidumbre

- **MDE:** ~2 m de error vertical en MDE-Ar v2.1. En una llanura, eso puede ser más que la diferencia entre "seco" y "bajo agua".
- **Escala puntual:** la altura del río se mide en un punto (el puerto), y el agua no sube igual en toda la costa.
- **Defensa y bombas:** se asume que la defensa funciona salvo que el operador active "falla". El estado real de las bombas no es público en tiempo real.
- **Desagües pluviales:** no hay datos públicos de la red, así que la capa pluvial es **indicativa**.
- **Tiempo:** el modelo no da tiempos de llegada del agua, solo **orden de exposición** por nivel.
- **Datos de exposición:** padrón escolar de 2023 y REFES con fecha. Pueden faltar o sobrar establecimientos.
- **IA:** pocos eventos etiquetados, riesgo de sobreajuste. Se valida con un evento que el modelo no vio.
- **Horizonte temporal:** los escenarios son **hipotéticos e instantáneos**, no un pronóstico. El pronóstico oficial es del INA y del SMN.

---

## 14. Decisiones pendientes del equipo

- [ ] ¿El foco es **fluvial** (río), **pluvial** (lluvia) o **ambos**? Recomendado: arrancar por el fluvial, que tiene mejores datos.
- [ ] ¿Área de estudio: solo el ejido urbano o también el periurbano (islas, laguna Oca)?
- [ ] MDE final: MDE-Ar v2.1, FABDEM o MDE 5 m del IGN (si existe para Formosa).
- [ ] Motor 3D: MapLibre + deck.gl (recomendado) o Cesium.
- [ ] ¿Incluimos la pirámide de Pepper's ghost para la demo?
- [ ] ¿Contactamos a Defensa Civil o al municipio para validar los barrios críticos y la ubicación de los centros de evacuados?

---

## 15. Próximos pasos

1. Conseguir el **cero de escala IGN de Puerto Formosa** (repositorio del INA).
2. Bajar la **serie histórica del río** en Puerto Formosa (INA a5) y calcular los niveles por frecuencia (escala INA 1991–2020).
3. Descargar el MDE (MDE-Ar y FABDEM) y recortarlo a Formosa Capital.
4. Conseguir los mapas de **CONAE de enero de 2016** y la mancha de Sentinel-1 de esa crecida para validar.
5. Armar la capa de **infraestructura crítica** (escuelas, salud, bombas) y cruzarla con el Censo 2022.
6. Prototipo mínimo: mapa 3D + control de nivel del río + lista de infraestructura expuesta.
7. Transcribir la **tabla de estaciones de bombeo** del informe INA.

---

## 16. Fuentes consultadas

**Del desafío**
- CITF – *Operación Agua, Equipo 2, Desafío 3: Predicción de afectaciones*, guía v1.1, noviembre de 2026 (PDF entregado al equipo).

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

**Modelos y visualización**
- NOAA – Ficha del método HAND: https://www.weather.gov/media/owp/operations/HAND_factsheet.pdf
- Aristizabal et al. 2024 (HESS) – HAND y calidad del MDE: https://hess.copernicus.org/articles/28/1287/2024/hess-28-1287-2024.pdf
- Susceptibilidad con Sentinel-1 + ML: https://www.mdpi.com/2072-4292/17/20/3471
- CesiumJS vs MapLibre GL JS (FOSS4G 2025 / arXiv): https://arxiv.org/abs/2602.23660
- deck.gl vs MapLibre: https://atlas.co/comparisons/deck-gl-vs-maplibre/
- Pepper's ghost sobre maqueta (caso Calais): https://holusion-com--pr279-calais-ktc04a16.web.app/en/posts/2026-04-05-calais

---

*Los datos de 2026 son de medios que citan a Prefectura, INA y NOAA. Antes de la presentación hay que reemplazarlos por la fuente primaria (INA) con fecha.*
