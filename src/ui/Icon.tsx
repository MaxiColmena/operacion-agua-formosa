/** Authored stroke icon set (24px grid, 1.75 stroke) so every control speaks the same visual language. */
const PATHS = {
  play: <path d="M8 5.5v13l10-6.5z" fill="currentColor" stroke="none" />,
  pause: <><rect x="7" y="5.5" width="3.5" height="13" rx="1" fill="currentColor" stroke="none" /><rect x="13.5" y="5.5" width="3.5" height="13" rx="1" fill="currentColor" stroke="none" /></>,
  reset: <><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" /><path d="M4.5 4.5v4h4" /></>,
  help: <><circle cx="12" cy="12" r="8.5" /><path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.1-2.4 3.7" /><circle cx="12" cy="16.9" r=".6" fill="currentColor" /></>,
  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.5" /><circle cx="12" cy="7.9" r=".6" fill="currentColor" /></>,
  sliders: <><path d="M5 7h9M18 7h1M5 17h3M12 17h7" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></>,
  layers: <><path d="m12 4 8.5 4.5L12 13 3.5 8.5z" /><path d="m3.5 12.5 8.5 4.5 8.5-4.5" /><path d="m3.5 16 8.5 4.5 8.5-4.5" opacity=".55" /></>,
  scenario: <><path d="M4 18c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2" /><path d="M8 11.5 10.5 6l2 3.5L14 8l2.5 4" /></>,
  results: <><path d="M5 19V9M10 19V5M15 19v-7M20 19v-4" /></>,
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  chevronLeft: <path d="M14.5 6 8.5 12l6 6" />,
  chevronRight: <path d="m9.5 6 6 6-6 6" />,
  chevronDown: <path d="m6 9.5 6 6 6-6" />,
  check: <path d="m5.5 12.5 4 4 9-9" />,
  camera: <><path d="M3.5 12.5 20 5l-5 15-3-6.5z" /><path d="m12 13.5 3-3" /></>,
  external: <><path d="M14 5h5v5" /><path d="m19 5-8 8" /><path d="M17 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4" /></>,
  // Guided tour, cinematic presentation and analytics dashboard.
  tour: <><circle cx="12" cy="12" r="8.5" /><path d="M10.2 8.6v6.8l5.3-3.4z" fill="currentColor" stroke="none" /></>,
  film: <><rect x="4" y="5" width="16" height="14" rx="1.5" /><path d="M8 5v14M16 5v14M4 9.5h4M4 14.5h4M16 9.5h4M16 14.5h4" /></>,
  chart: <><path d="M4.5 19.5h15" /><path d="M7 16v-5M11 16V7M15 16v-3M19 16V9" /></>,
  record: <circle cx="12" cy="12" r="5.5" fill="currentColor" stroke="none" />,
  prev: <><path d="M17 6v12L8.5 12z" fill="currentColor" stroke="none" /><path d="M6.5 6v12" /></>,
  skip: <><path d="M7 6v12l8.5-6z" fill="currentColor" stroke="none" /><path d="M17.5 6v12" /></>,
  download: <><path d="M12 4.5v10.5" /><path d="m7.5 10.5 4.5 4.5 4.5-4.5" /><path d="M5 19.5h14" /></>,
  alert: <><path d="M12 4.5 3 19.5h18z" /><path d="M12 10.5v4" /><circle cx="12" cy="17" r=".6" fill="currentColor" /></>,
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, className = '' }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={`icon-svg ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  );
}
