import type { FacilityCat } from '../data/load';
import type { FacilityLive } from '../analysis';
import type { IconName } from './icons';

export const CAT_LABEL: Record<FacilityCat, string> = {
  hospital: 'Hospital', salud: 'Salud', escuela: 'Escuela', seguridad: 'Bomberos / Policía',
  servicios: 'Agua / Energía', publico: 'Municipio / Asistencia social', transporte: 'Transporte',
};
export const CAT_SHORT: Record<FacilityCat, string> = {
  hospital: 'Hospitales', salud: 'Salud', escuela: 'Escuelas', seguridad: 'Seguridad',
  servicios: 'Servicios', publico: 'Municipio', transporte: 'Transporte',
};
export const CAT_ICON: Record<FacilityCat, IconName> = {
  hospital: 'hospital', salud: 'hospital', escuela: 'school', seguridad: 'shield', servicios: 'spark', publico: 'building', transporte: 'pin',
};
export const TIER_LABEL = ['—', '1º', '2º', '3º'];

export function fmtHours(h: number) {
  const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
  return hh ? `${hh} h${mm ? ` ${mm} min` : ''}` : `${mm} min`;
}
export function fmtClock(s: number) {
  const m = Math.max(0, Math.floor(s / 60));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}
export function statusText(l: FacilityLive | null | undefined) {
  if (!l) return '—';
  return l.status === 'afectado' ? 'Con agua (≥ 15 cm)' : l.status === 'atencion' ? 'Agua en las inmediaciones' : 'Sin agua';
}
export const nf = (v: number, d = 0) => v.toLocaleString('es-AR', { maximumFractionDigits: d, minimumFractionDigits: d });
