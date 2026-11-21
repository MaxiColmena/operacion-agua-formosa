// Contract between the App container and the scripted flows (guided tour, cinematic presentation).
import type { Layers, MapScene, WaterMode } from '../scene/MapScene';

export type ResultsTab = 'prioridad' | 'calles' | 'barrios' | 'infra';

export interface DemoSnapshot {
  simSeconds: number;
  finished: boolean;
  curbKm: number;
  impassableKm: number;
  buildingsWet: number;
  areaKm2: number;
  facilitiesAffected: number;
  criticalAffected: number;
  barriosAffected: number;
  /** People living in cells with water (Censo 2022), 0 when the census layer is missing. */
  people: number;
  worstFacility: string | null;
}

export interface DemoApi {
  scene(): MapScene | null;
  applyPreset(id: string): void;
  play(): void;
  pause(): void;
  reset(): void;
  setSpeed(v: number): void;
  setTab(t: ResultsTab): void;
  setLayers(patch: Partial<Layers>): void;
  setWaterMode(m: WaterMode): void;
  setAnalytics(open: boolean): void;
  setViewMenu(open: boolean): void;
  setPanels(v: { left?: boolean; right?: boolean }): void;
  /** Selects and frames the facility with the most water; returns false if none is wet. */
  selectWorstFacility(): boolean;
  clearSelection(): void;
  /** Flies the orbit camera to a lon/lat with an offset (km) from the target. */
  frame(lon: number, lat: number, offset: [number, number, number]): void;
  snapshot(): DemoSnapshot;
}
