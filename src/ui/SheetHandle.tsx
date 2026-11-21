// Drag handle for the mobile bottom sheets (panels become sheets under 1200px).
// Swipe down: expanded → compact → closed. Swipe up: expand. Tap: toggle compact/expanded.
import { useRef, type PointerEvent } from 'react';

/** Distance (px) that commits a swipe, and the speed (px/ms) that commits a short flick. */
const COMMIT_PX = 64;
const FLICK_PX_MS = 0.5;
const TAP_PX = 8;

export function SheetHandle({ full, onToggle, onExpand, onCompact, onClose }: {
  full: boolean;
  onToggle: () => void;
  onExpand: () => void;
  onCompact: () => void;
  onClose: () => void;
}) {
  const drag = useRef<{ id: number; y0: number; t0: number; dy: number; sheet: HTMLElement } | null>(null);
  /** A pointer gesture already handled the interaction: swallow the click that follows it. */
  const skipClick = useRef(false);

  const reset = (sheet: HTMLElement) => {
    sheet.style.transition = '';
    sheet.style.transform = '';
  };

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const sheet = e.currentTarget.closest<HTMLElement>('.panel, .dock');
    if (!sheet) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    sheet.style.transition = 'none';
    drag.current = { id: e.pointerId, y0: e.clientY, t0: performance.now(), dy: 0, sheet };
  };

  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    d.dy = e.clientY - d.y0;
    // Follow the finger downwards; resist upwards (the sheet grows by changing height, not by moving).
    d.sheet.style.transform = `translateY(${d.dy > 0 ? d.dy : d.dy * 0.25}px)`;
  };

  const finish = (e: PointerEvent<HTMLButtonElement>, cancelled: boolean) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    const { dy, sheet } = d;
    const speed = dy / Math.max(1, performance.now() - d.t0);
    if (cancelled || Math.abs(dy) < TAP_PX) { reset(sheet); return; }
    skipClick.current = true;
    window.setTimeout(() => { skipClick.current = false; }, 400);
    const down = dy > COMMIT_PX || (dy > TAP_PX * 2 && speed > FLICK_PX_MS);
    const up = dy < -COMMIT_PX / 2 || (dy < -TAP_PX * 2 && speed < -FLICK_PX_MS);
    if (down && !full) {
      // Slide the compact sheet out of view, then close it.
      sheet.style.transition = 'transform 0.18s ease-in';
      sheet.style.transform = 'translateY(110%)';
      // Hide first, then clear the offset on the next frame, so the sheet never flashes back into view.
      window.setTimeout(() => { onClose(); requestAnimationFrame(() => reset(sheet)); }, 180);
      return;
    }
    // Settle back while the height animates to its new size (keeps the stylesheet's max-height transition).
    sheet.style.transition = 'transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), max-height 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
    sheet.style.transform = '';
    window.setTimeout(() => { sheet.style.transition = ''; }, 320);
    if (down) onCompact();
    else if (up && !full) onExpand();
  };

  return (
    <button
      className="sheet-handle"
      onClick={() => { if (skipClick.current) { skipClick.current = false; return; } onToggle(); }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => finish(e, false)}
      onPointerCancel={(e) => finish(e, true)}
      aria-expanded={full}
      aria-label={full ? 'Achicar el panel (deslizá hacia abajo para cerrarlo)' : 'Agrandar el panel (deslizá hacia abajo para cerrarlo)'}
    >
      <i aria-hidden="true" />
    </button>
  );
}
