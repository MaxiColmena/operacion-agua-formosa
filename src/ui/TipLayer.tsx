import { useEffect, useState } from 'react';

/**
 * Ayuda flotante para cualquier elemento con `data-tip="…"`.
 * Aparece al pasar el mouse o al enfocar con el teclado (más rápido y legible que `title`).
 */
export function TipLayer() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; below: boolean } | null>(null);

  useEffect(() => {
    let timer = 0;
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
      const el = (e.target as Element | null)?.closest?.('[data-tip]');
      if (el && el !== current) show(el, 250);
      else if (!el && current) hide();
    };
    const onFocus = (e: Event) => {
      const el = (e.target as Element | null)?.closest?.('[data-tip]');
      if (el && (el as HTMLElement).matches(':focus-visible')) show(el, 0);
    };
    document.addEventListener('mouseover', onOver);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', hide);
    document.addEventListener('mousedown', hide);
    window.addEventListener('wheel', hide, { passive: true });
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('mouseover', onOver);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('mousedown', hide);
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
