import { existsSync } from 'node:fs';
// Área de estudio: Formosa Capital y su frente sobre el río Paraguay.
export const BBOX = { west: -58.27, south: -26.25, east: -58.11, north: -26.12 };

/** Terreno: FABDEM (sin edificios ni bosques) si está descargado; si no, Copernicus GLO-30 (superficie). */
export const FABDEM_FILE = 'data-raw/S27W059_FABDEM_V1-2.tif';
export const COPERNICUS_FILE = 'data-raw/cop_S27.tif';
export const DEM_IS_FABDEM = existsSync(FABDEM_FILE);
export const DEM_FILE = DEM_IS_FABDEM ? FABDEM_FILE : COPERNICUS_FILE;
export const OUT_DIR = 'public/data';
