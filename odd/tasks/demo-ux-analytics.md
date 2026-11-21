# Demo, UX and analytics — Operación Agua

Objective: guided automatic tour, cinematic presentation video, 3D performance, decision analytics and a calmer, more legible UI.
Branch: dev-santi · Delivery: ask-on-risk · Test runner: none in repo (checks = `tsc --noEmit`, `vite build`, browser verification).

## Specs

- S1 — Tutorial: "arregles el tutorial, el comportamiento esperado es que este salga al momento de iniciar con el botón "Empezar". Una vez haya sido apretado este botón, la web debe empezar un recorrido (automático) en donde se vaya ejecutando todo el flujo de las funcionalidades."
- S2 — Presentation: "Un video-presentación que muestre el flujo completo de la aplicación web. Como guía, te pongo de ejemplo: el render de las casas (recorrido como si fuese una maqueta arquitectónica), el recorrido debe ser claro, fluido y optimizado."
- S3 — Performance: "Optimización del mapa y los modelos en 3D para que no sobre exija a los dispositivos, IMPORTANTE: optimización no significa recorte de recursos innecesario y que rompa lo "visual" dentro de la Aplicación Web. Debes aplicar la optimización sin comprometer absolutamente nada de lo que hoy ya tenemos en la web."
- S4 — Analytics: "Análisis y métricas: con los datos que tenemos y lo que visualizamos, que podemos resaltar para poder en base a ello, tomar decisiones."
- S5 — UI/UX: "Mejora de la UI y UX: actualmente, en la aplicación, la interfaz está muy saturada (mucho ruido visual), también, la letra es demasiado chica y la tipografía no es muy adecuada. Para mejorar la tipografía usaremos impeccable (skill instalada). Otras cuestiones para tener en cuenta: los selectores, la navegación, los botones, etc. Para cada problema de UI y UX mencionados, quiero que plantees una solución bien estructurada, profesional e impecable visualmente."
  - Assumption: the `impeccable` skill is not installed in this environment; its typography principles are applied by hand (non-default font pairing, modular scale, larger base size, tabular numerals).
  - Assumption: UI copy stays in Spanish because the existing product is Spanish.

## Tasks

| ID | Specs | Route | Status | Commit |
| --- | --- | --- | --- | --- |
| T1 | S3 | delegated (parallel writer: MapScene.ts, worker.ts disjoint from UI) | done (tsc, build, bit-identical buildings, paused-river check) | see Log |
| T2 | S5 | inline | done (tsc, build, browser 1440×900 and 1180×760) | see Log |
| T3 | S1 | inline | done (browser: Empezar → automatic tour, spotlight, steps 1–15) | see Log |
| T4 | S2 | inline | done (browser: playback, titles, UI hidden); final video not recorded — browser pane hidden (≈1.5 fps) | see Log |
| T5 | S4 | inline | done (browser: recommendations, curves, exposure chart, table view) | see Log |
| T6 | S1–S5 | inline (browser verification) + independent verifier on T1 (Risk item 4) | done | see Log |

## Log

- L1 (2026-11-20, user, verbatim): "Quiero que analises el repositorio del que disponemos en esta carpeta. Haz un analisis y utiliza /graphify para disminuir tu esfuerzo al momento de comprender el flujo del proyecto. Ademas, necesito que una ves termines eso, lleves a cabo estas agregaciones/correcciones: 1. … 5. …" (items quoted in S1–S5).
- L2: Baseline `tsc --noEmit` passes. No test runner in the repo; checks are typecheck, production build and browser verification.
- L3: Route evidence for T1: performance work lives in `src/scene/MapScene.ts` and `src/sim/worker.ts`, disjoint from the UI files (`src/App.tsx`, `src/styles.css`, `src/ui/*`), several minutes of work each → Writer trigger (a) parallelism.
- L4: Graphify graph built (470 nodes, 19 communities). `App()` was a god node (40 edges, cohesion 0.05) → split into container + presentational components under `src/ui/`.
- L5: Browser findings fixed during verification: tour timer reused the previous step's progress (advanced instantly) → elapsed ref reset per step; the hidden analytics drawer let the page scroll horizontally → `overflow: clip`; dock wrapped at 1440 px → shorter labels; panel scroll area pushed the simulation bar out at 760 px height → `min-height: 0`.
- L6: The `impeccable` skill is not installed; typography chosen by hand: Bricolage Grotesque (display), Atkinson Hyperlegible Next (text), Atkinson Hyperlegible Mono (figures); base 15 px, minimum 12 px.
- L7: Chart palette validated with the dataviz validator on the dark surface: #2f9fd0 / #c8743a (CVD ΔE 20.8, contrast ≥ 3:1).
- L8: The built-in browser pane was hidden during verification (rAF ≈ 1.5 fps), so real frame-rate gains and the final video recording could not be measured/produced here.
