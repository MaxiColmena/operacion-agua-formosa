import { useEffect, useState } from 'react';

/**
 * Ayuda flotante para cualquier elemento con `data-tip="…"`.
 * Aparece al pasar el mouse o al enfocar con el teclado (más rápido y legible que `title`).
 */
export function TipLayer() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; below: boolean } | null>(null);

  useEffect(() => {
    let timer = 0;
    /** Time of the last touch: browsers emulate mouse events after a tap, which must not hide a long-press tip. */
    let lastTouch = -1e9;
    const onMouseDown = () => { if (performance.now() - lastTouch > 800) hide(); };
    let current: Element | null = null;
    const show = (el: Element, delay: number) => {
      const text = el.getAttribute('data-tip');
      if (!text) return;
      current = el;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const r = el.getBoundingClientRect();
        const below = r.top < 120;
        const x = Math.min(window.innerWidth - 150, Math.max(150, r.left + r.width / 2));
        setTip({ text, x, y: below ? r.bottom + 8 : r.top - 8, below });
      }, delay);
    };
    const hide = () => { window.clearTimeout(timer); current = null; setTip(null); };
    const onOver = (e: Event) => {
      if (performance.now() - lastTouch < 800) return;
      const el = (e.target as Element | null)?.closest?.('[data-tip]');
      if (el && el !== current) show(el, 250);
      else if (!el && current) hide();
    };
    const onFocus = (e: Event) => {
      const el = (e.target as Element | null)?.closest?.('[data-tip]');
      if (el && (el as HTMLElement).matches(':focus-visible')) show(el, 0);
    };
    // Touch: hover does not exist, so a long press (~0.45 s) shows the explanation and the tap that ends it
    // does not trigger the control. The tip stays readable for a moment after lifting the finger.
    let pressTimer = 0, hideTimer = 0, suppressClick = false;
    const onTouchStart = (e: TouchEvent) => {
      lastTouch = performance.now();
      const el = (e.target as Element | null)?.closest?.('[data-tip]');
      window.clearTimeout(pressTimer);
      if (!el) return;
      pressTimer = window.setTimeout(() => {
        suppressClick = true;
        window.clearTimeout(hideTimer);
        show(el, 0);
      }, 450);
    };
    const onTouchEnd = () => {
      lastTouch = performance.now();
      window.clearTimeout(pressTimer);
      if (suppressClick) { window.clearTimeout(hideTimer); hideTimer = window.setTimeout(hide, 3500); }
    };
    const onTouchMove = () => window.clearTimeout(pressTimer);
    const onClickCapture = (e: MouseEvent) => {
      if (!suppressClick) return;
      suppressClick = false;
      e.preventDefault();
      e.stopPropagation();
    };
    const onContextMenu = (e: Event) => { if ((e.target as Element | null)?.closest?.('[data-tip]')) e.preventDefault(); };
    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchend', onTouchEnd);
    document.addEventListener('touchcancel', onTouchEnd);
    document.addEventListener('touchmove', onTouchMove, { passive: true });
    document.addEventListener('click', onClickCapture, true);
    document.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('mouseover', onOver);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', hide);
    document.addEventListener('mousedown', onMouseDown);
    window.addEventListener('wheel', hide, { passive: true });
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(pressTimer);
      window.clearTimeout(hideTimer);
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchend', onTouchEnd);
      document.removeEventListener('touchcancel', onTouchEnd);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('click', onClickCapture, true);
      document.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('mouseover', onOver);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('wheel', hide);
    };
  }, []);

  if (!tip) return null;
  return (
    <div className={`ui-tip ${tip.below ? 'below' : ''}`} role="tooltip" style={{ left: tip.x, top: tip.y }}>
      {tip.text}
    </div>
  );
}
