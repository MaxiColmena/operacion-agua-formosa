// «Supuestos y límites»: data sources, declared assumptions and what the model cannot guarantee.
import { useEffect } from 'react';
import type { AppData } from '../data/load';
import { DEFAULT_EXAG } from '../scene/MapScene';
import { ASSUMPTIONS, RIVER_REF, LEVELS, STREET, INA_SCALE, INA_CATEGORY_REF, RAIN_FORECAST_7D } from '../sim/scenarios';
import { fmtStage } from './threshold';
import { Icon } from './icons';

export function InfoModal({ data, onClose }: { data: AppData | null; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal info" role="dialog" aria-modal="true" aria-label="Supuestos, datos y límites" onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn x" onClick={onClose} aria-label="Cerrar"><Icon name="close" /></button>
        <h2>Supuestos, datos y límites</h2>
        <p className="lead">Herramienta para <b>explorar escenarios hipotéticos</b>. Muestra <b>zonas a evaluar, no veredictos</b>. Las decisiones operativas y de emergencia son responsabilidad de las autoridades.</p>

        <h3>Cómo funciona</h3>
        <ul>
          <li><b>Modelo hidráulico 2D de inercia local</b> (Bates et al. 2010, base de LISFLOOD-FP): la lluvia cae en cada celda, escurre según la pendiente y se acumula en los bajos.</li>
          <li>Simulación en vivo con celdas de ~60 m. Mapa de zonas 1º/2º/3º precalculado con celdas de ~30 m.</li>
          <li>El río Paraguay es un borde de nivel fijo. Las zonas conectadas al río por debajo de su nivel arrancan con agua ("bañadera conectada").</li>
          <li>El <b>relieve está exagerado</b> en altura (×{DEFAULT_EXAG} por defecto) para que se vean los bajos: Formosa es casi plana. Con el control «Relieve» del panel inferior se puede poner en 1× (escala real).</li>
          <li>Una celda está <b>afectada</b> cuando tiene 15 cm de agua o más. Un barrio está afectado cuando lo está al menos el 5 % de su superficie.</li>
        </ul>

        <h3>Escenarios de referencia (zonas 1º, 2º y 3º)</h3>
        <ul>{LEVELS.map((l, i) => <li key={l.id}><b>{i + 1}º · {l.label}:</b> {l.why}</li>)}</ul>
        {data?.zonesMeta && <p className="hint">Superficie afectada: {data.zonesMeta.stats.map((s, i) => `${i + 1}º ${s.km2} km²`).join(' · ')} (acumulada por escenario).</p>}

        <h3>Supuestos declarados</h3>
        <table>
          <tbody>
            <tr><td>Cero de la escala de Puerto Formosa</td><td className="mono">{ASSUMPTIONS.gaugeZero} m</td><td>Dato oficial (Gobierno de Formosa, 08/12/2015): la cota IGN 59 m equivale a 11,70 m en la escala del puerto, de donde sale el cero 47,30 m IGN. <b>A confirmar con el INA.</b> El terreno (FABDEM) usa otro dátum (EGM2008); la diferencia no está verificada.</td></tr>
            <tr><td>Coronamiento de la defensa</td><td className="mono">{ASSUMPTIONS.defenseCrest} m</td><td>Dato oficial 2015: 11,70 m de escala. Traza reconstruida (~38,6 km; el dato oficial es ~15 km): los 5 tramos reales de OpenStreetMap unidos con conectores estimados que bordean la zona edificada sin cortar manzanas (al norte sigue el riacho Formosa). Es una aproximación: falta la traza oficial. La rotura simulada es una brecha de ~200 m frente al puerto.</td></tr>
            <tr><td>Desagüe + infiltración</td><td className="mono">editable</td><td>{data?.drainageMeta
              ? <>Varía por zona según la red pluvial relevada ({data.drainageMeta.totalKm2} km²): con bocas de tormenta o sumideros, el 100 % del valor elegido; en el resto (solo cunetas e infiltración), el {Math.round(ASSUMPTIONS.drainNoNetwork * 100)} %. Alrededor de cada calle se toman {data.drainageMeta.radii.street} m y alrededor de cada esquina {data.drainageMeta.radii.corner} m.</>
              : 'No hay datos de la red pluvial: toda la ciudad drena igual.'} Con el río en alerta queda un {Math.round(ASSUMPTIONS.drainFactorHighRiver * 100)} % (solo bombeo).</td></tr>
            <tr><td>Agua en las calles</td><td className="mono">{Math.round(STREET.share * 100)} %</td><td>En zona urbana (≥ {STREET.minBuildings} edificios por celda de ~60 m) se supone que la calzada ocupa ese porcentaje de la manzana y junta toda su agua, porque lotes y veredas están más altos. Cordón: {STREET.curb * 100} cm. Intransitable: {STREET.impassable * 100} cm.</td></tr>
            <tr><td>Rugosidad (Manning)</td><td className="mono">{ASSUMPTIONS.manning}</td><td>Valor típico de llanura urbana y periurbana.</td></tr>
            {data?.thresholds && (
              <tr><td>Umbral de exposición al río</td><td className="mono">estimado</td><td>Para cada celda de ~30 m, la altura mínima del río en Puerto Formosa a la que el agua del río llega por superficie («bañadera conectada»: priority-flood desde el río sobre el terreno), calculada con la <b>defensa sana</b> y <b>con la brecha</b> de ~200 m. Una instalación toma el valor más bajo de su entorno (±30 m); un barrio, la altura a la que se expone el 5 % de su superficie. Se evalúa hasta 20 m de escala. <b>No incluye lluvia, desagües, filtraciones ni tiempos de llegada</b>: indica desde qué altura del río conviene mirar cada lugar, no cuándo ni si va a pasar.</td></tr>
            )}
            <tr><td>Umbral de afectación</td><td className="mono">{ASSUMPTIONS.wetThreshold * 100} cm</td><td>Agua que dificulta el tránsito y entra a veredas.</td></tr>
          </tbody>
        </table>

        <h3>Datos utilizados</h3>
        <table>
          <tbody>
            <tr><td><span className="tag tag-obs">OBSERVADO</span></td><td>Río Paraguay en Puerto Formosa: {fmtStage(RIVER_REF.observed.stage)} el {RIVER_REF.observed.date} ({RIVER_REF.observed.trend}, {RIVER_REF.observed.inaCategory}). {RIVER_REF.observed.source}.</td></tr>
            <tr><td><span className="tag tag-obs">REFERENCIA INA</span></td><td>Alerta {fmtStage(RIVER_REF.alert)} · Evacuación {fmtStage(RIVER_REF.evacuation)} (Puerto Formosa). Récord de 1983: {fmtStage(RIVER_REF.record1983)}. Escala de cinco categorías por frecuencia 1991–2020 ({INA_SCALE.join(', ')}): el INA informa la categoría de cada lectura pero no publica los límites en metros, por eso la herramienta no clasifica alturas hipotéticas. Lecturas clasificadas: {INA_CATEGORY_REF.map((r) => `${fmtStage(r.stage)} = ${r.cat} (${r.date}, ${r.source})`).join('; ')}.</td></tr>
            <tr><td><span className="tag tag-ina">PREVISIÓN INA</span></td><td>No se integra en vivo. Consultar <a href="https://alerta.ina.gob.ar/a5/secciones" target="_blank" rel="noreferrer">alerta.ina.gob.ar</a> y cargar el valor como escenario.</td></tr>
            <tr><td><span className="tag tag-ina">ESTIMADO</span></td><td>Pronóstico de lluvia a 7 días, departamento Formosa: {RAIN_FORECAST_7D.meanMm} mm de promedio, hasta {RAIN_FORECAST_7D.maxMm} mm ({RAIN_FORECAST_7D.source}). Es un pronóstico, no una medición. El escenario «7 días» supone que el máximo cae en una sola tormenta de 3 h.</td></tr>
            <tr><td><span className="tag">TERRENO</span></td><td>{data?.meta.source}. Terreno desnudo estimado con aprendizaje automático a partir de un modelo satelital de superficie: puede quedar algún resto de edificios o árboles. Precisión vertical de 1 a 2 m en zonas planas.</td></tr>
            <tr><td><span className="tag">BASE</span></td><td>{data?.osm?.source ?? 'OpenStreetMap (no cargado)'}: infraestructura, calles, riachos, barrios y edificios.</td></tr>
          </tbody>
        </table>

        {data?.drainageMeta && (<>
          <h3>Red pluvial relevada</h3>
          <p className="hint">{data.drainageMeta.source}. Ubicada sobre las calles y barrios de OpenStreetMap. Es una referencia para repartir el desagüe, no un catastro de la red: no sabemos el diámetro de los caños ni si están obstruidos.</p>
          <ul className="drain-list">
            {data.drainageMeta.entries.map((e) => (
              <li key={e.id} className={e.ok ? '' : 'missing'}>{e.ok ? '✓' : '✗'} {e.label}{e.ok ? ` · ${e.km2} km²` : ''}{e.note ? ` (${e.note})` : ''}</li>
            ))}
          </ul>
        </>)}

        <h3>Lo que NO podemos asegurar</h3>
        <ul>
          <li>Qué manzana o casa se inunda: el error vertical del MDE es mayor que muchas diferencias de nivel de la ciudad.</li>
          <li>Tiempos reales de llegada del agua: la red pluvial está relevada solo en parte, sin diámetros ni estado de limpieza, y no conocemos el estado de las bombas. Los tiempos sirven para <b>ordenar</b>, no para planificar al minuto.</li>
          <li>Que el río suba igual en toda la costa: la escala mide un solo punto.</li>
          <li>Que la lista de infraestructura esté completa: OpenStreetMap puede tener faltantes o errores.</li>
          <li>Horizonte temporal: los escenarios son hipotéticos e instantáneos, no un pronóstico. El pronóstico oficial es del INA y del SMN.</li>
        </ul>
      </div>
    </div>
  );
}
