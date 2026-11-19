// Dos motores de mapa con la misma interfaz: { setLayers(capas), girar(grados), restablecer() }.
// 1) Google Maps (vectorial, con inclinación y rotación) + deck.gl intercalado.
// 2) Solo deck.gl, sin mapa de fondo (para trabajar sin clave de Google).

import { Deck, MapView } from '@deck.gl/core';
import { GoogleMapsOverlay } from '@deck.gl/google-maps';
import { CENTRO } from '../escenario/datos-ficticios.js';

const VISTA_INICIAL = {
  longitude: CENTRO[0],
  latitude: CENTRO[1],
  zoom: 12.4,
  pitch: 58,
  bearing: -28,
  maxPitch: 85,
};

export function crearMotorSoloDeck(contenedor) {
  let vista = { ...VISTA_INICIAL };
  const deck = new Deck({
    parent: contenedor,
    views: new MapView({ repeat: false }),
    initialViewState: vista,
    controller: { dragRotate: true, touchRotate: true, doubleClickZoom: true, keyboard: true },
    onViewStateChange: ({ viewState }) => {
      vista = viewState;
      return viewState;
    },
    layers: [],
  });

  return {
    nombre: 'deck',
    setLayers: (capas) => deck.setProps({ layers: capas }),
    girar: (grados) => {
      vista = { ...vista, bearing: vista.bearing + grados, transitionDuration: 400 };
      deck.setProps({ initialViewState: vista });
    },
    restablecer: () => {
      vista = { ...VISTA_INICIAL, transitionDuration: 600 };
      deck.setProps({ initialViewState: vista });
    },
  };
}

function cargarScriptGoogle(clave) {
  return new Promise((resolve, reject) => {
    if (window.google?.maps?.importLibrary) {
      resolve();
      return;
    }
    const temporizador = setTimeout(() => reject(new Error('Google Maps no respondió a tiempo.')), 12000);
    window.gm_authFailure = () => reject(new Error('Google rechazó la clave (gm_authFailure). Revisá la clave y las restricciones.'));
    window.__alCargarGoogle = () => {
      clearTimeout(temporizador);
      resolve();
    };
    const script = document.createElement('script');
    const params = new URLSearchParams({ key: clave, v: 'weekly', loading: 'async', callback: '__alCargarGoogle', language: 'es', region: 'AR' });
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    script.async = true;
    script.onerror = () => {
      clearTimeout(temporizador);
      reject(new Error('No se pudo descargar la API de Google Maps.'));
    };
    document.head.appendChild(script);
  });
}

export async function crearMotorGoogle(contenedor, { clave, mapId }) {
  await cargarScriptGoogle(clave);
  const { Map, RenderingType } = await google.maps.importLibrary('maps');
  const { ColorScheme } = await google.maps.importLibrary('core');

  const opciones = {
    center: { lng: CENTRO[0], lat: CENTRO[1] },
    zoom: 13.4,
    tilt: 60,
    heading: -28,
    mapId,
    renderingType: RenderingType.VECTOR,
    colorScheme: ColorScheme?.DARK,
    tiltInteractionEnabled: true,
    headingInteractionEnabled: true,
    disableDefaultUI: true,
    zoomControl: true,
    gestureHandling: 'greedy',
    clickableIcons: false,
    mapTypeId: 'roadmap',
  };
  const mapa = new Map(contenedor, opciones);
  const overlay = new GoogleMapsOverlay({ interleaved: true, layers: [] });
  overlay.setMap(mapa);

  await new Promise((resolve) => google.maps.event.addListenerOnce(mapa, 'idle', resolve));
  const esVectorial = mapa.getRenderingType?.() === RenderingType.VECTOR;

  return {
    nombre: 'google',
    esVectorial,
    setLayers: (capas) => overlay.setProps({ layers: capas }),
    girar: (grados) => mapa.setHeading((mapa.getHeading() || 0) + grados),
    restablecer: () => {
      mapa.moveCamera({ center: opciones.center, zoom: opciones.zoom, tilt: opciones.tilt, heading: opciones.heading });
    },
  };
}
