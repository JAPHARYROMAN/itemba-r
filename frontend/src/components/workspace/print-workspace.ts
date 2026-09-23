let clearPrevious: (() => void) | undefined;

/** Select a single app for browser printing when more than one is mounted. */
export function printWorkspace(source: Element | null) {
  clearPrevious?.();
  const pane = source?.closest<HTMLElement>('[data-os-pane]');
  const clear = () => {
    pane?.removeAttribute('data-os-print-target');
    window.removeEventListener('afterprint', clear);
    clearPrevious = undefined;
  };
  if (pane) {
    pane.setAttribute('data-os-print-target', '');
    clearPrevious = clear;
    window.addEventListener('afterprint', clear, { once: true });
  }
  try {
    window.print();
  } catch (error) {
    clear();
    throw error;
  }
}
