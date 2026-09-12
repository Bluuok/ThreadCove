import { useEffect } from 'react';

/** Modal settings and mobile drawers share focus containment and Escape behavior. */
export function useOverlayFocus(selector: string | undefined, close: () => void): void {
  useEffect(() => {
    if (!selector) return;
    const panel = document.querySelector<HTMLElement>(selector);
    if (!panel) return;
    const previous = document.activeElement as HTMLElement | null;
    const controls = () => [...panel.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),a[href],summary,[tabindex="0"]')].filter(element => element.getClientRects().length);
    const outside = [...document.querySelectorAll<HTMLElement>('.main-panel,.sidebar,.details-panel')].filter(element => element !== panel && !element.contains(panel));
    for (const element of outside) element.inert = true;
    const originalRole = panel.getAttribute('role');
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true');
    controls()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key !== 'Tab') return;
      const items = controls(), first = items[0], last = items.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      for (const element of outside) element.inert = false;
      if (originalRole) panel.setAttribute('role', originalRole); else panel.removeAttribute('role');
      panel.removeAttribute('aria-modal');
      if (previous?.isConnected && previous.getClientRects().length) previous.focus();
    };
  }, [selector, close]);
}
