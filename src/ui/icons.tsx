// Inline SVG icon set (24×24 grid, stroke-based). One visual language instead of mixed unicode glyphs.
import type { SVGProps } from 'react';

const PATHS = {
  logo: 'M12 3c3.5 4.2 6 7.6 6 10.6A6 6 0 0 1 6 13.6C6 10.6 8.5 7.2 12 3Z M9 14.5a3 3 0 0 0 3 3',
  play: 'M8 5.5v13l10.5-6.5L8 5.5Z',
  pause: 'M8 5h3v14H8z M13 5h3v14h-3z',
  reset: 'M4 12a8 8 0 1 0 2.4-5.7 M4 4v4.5h4.5',
  tour: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M10 8.5v7l5.5-3.5L10 8.5Z',
  film: 'M4 5h16v14H4z M8 5v14 M16 5v14 M4 9h4 M4 15h4 M16 9h4 M16 15h4',
  chart: 'M4 20V10 M10 20V4 M16 20v-7 M21 20H3',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M12 11v5.5 M12 7.6v.4',
  layers: 'M12 3 3 8l9 5 9-5-9-5Z M3 13l9 5 9-5',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z',
  sliders: 'M4 7h10 M18 7h2 M4 17h4 M12 17h8 M16 5v4 M10 15v4',
  close: 'M6 6l12 12 M18 6 6 18',
  chevronL: 'M15 5l-7 7 7 7',
  chevronR: 'M9 5l7 7-7 7',
  chevronD: 'M5 9l7 7 7-7',
  rain: 'M7 15a4 4 0 0 1-.6-7.96A5.5 5.5 0 0 1 17 8a3.5 3.5 0 0 1 .5 7 M8 18l-1 2.5 M12 17l-1 3 M16 18l-1 2.5',
  river: 'M3 8c2.5-2 4.5-2 7 0s4.5 2 7 0 3-1.6 4-1 M3 13c2.5-2 4.5-2 7 0s4.5 2 7 0 3-1.6 4-1 M3 18c2.5-2 4.5-2 7 0s4.5 2 7 0 3-1.6 4-1',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M12 7.5V12l3 2',
  road: 'M8 3 5 21 M16 3l3 18 M12 4v3 M12 10.5v3 M12 17v3',
  building: 'M5 21V5l7-2v18 M12 8l7 2v11 M3 21h18 M8 8v.5 M8 12v.5 M8 16v.5 M15.5 13v.5 M15.5 16.5v.5',
  area: 'M4 4h16v16H4z M4 9h16 M9 4v16',
  hospital: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M12 8v8 M8 12h8',
  alert: 'M12 4 2.8 19.5h18.4L12 4Z M12 10v4.5 M12 17.2v.3',
  shield: 'M12 3 5 6v5.5c0 4.4 3 8 7 9.5 4-1.5 7-5.1 7-9.5V6l-7-3Z',
  school: 'M3 9.5 12 5l9 4.5-9 4.5-9-4.5Z M7 11.5v4.5c3 2 7 2 10 0v-4.5 M21 9.5v5',
  pin: 'M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z M12 7.8a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4Z',
  drone: 'M5 5h3 M16 5h3 M6.5 5v2.5 M17.5 5v2.5 M8 10h8l1.5 4h-11L8 10Z M9.5 14l-1 3 M14.5 14l1 3',
  record: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z',
  skip: 'M6 5.5v13l9-6.5-9-6.5Z M18 5v14',
  prev: 'M18 5.5v13l-9-6.5 9-6.5Z M6 5v14',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  download: 'M12 4v11 M7.5 10.5 12 15l4.5-4.5 M5 20h14',
  external: 'M14 4h6v6 M20 4l-9 9 M18 14v6H4V6h6',
  spark: 'M12 3v4 M12 17v4 M3 12h4 M17 12h4 M6 6l2.5 2.5 M15.5 15.5 18 18 M6 18l2.5-2.5 M15.5 8.5 18 6',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  const filled = name === 'play' || name === 'pause' || name === 'record' || name === 'skip' || name === 'prev';
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false"
      fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={filled ? 0 : 1.75}
      strokeLinecap="round" strokeLinejoin="round" {...rest}>
      <path d={PATHS[name]} />
    </svg>
  );
}
