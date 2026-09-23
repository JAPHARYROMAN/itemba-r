import { afterEach, describe, expect, it, vi } from 'vitest';
import { printWorkspace } from './print-workspace';

afterEach(() => {
  window.dispatchEvent(new Event('afterprint'));
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
describe('Printing one workspace', () => {
  it('selects only the requested pane and removes the selection after printing', () => {
    document.body.innerHTML =
      '<section data-os-pane="primary"><button>Main</button></section><section data-os-pane="companion"><button>Report</button></section>';
    const target = document.querySelector('[data-os-pane="companion"]')!;
    const print = vi.spyOn(window, 'print').mockImplementation(() => {
      expect(document.querySelectorAll('[data-os-print-target]')).toHaveLength(1);
      expect(target).toHaveAttribute('data-os-print-target');
    });
    printWorkspace(target.querySelector('button'));
    expect(print).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('afterprint'));
    expect(target).not.toHaveAttribute('data-os-print-target');
  });
  it('clears its selection if the browser rejects printing', () => {
    document.body.innerHTML = '<section data-os-pane="primary"><button>Print</button></section>';
    vi.spyOn(window, 'print').mockImplementation(() => {
      throw new Error('Unavailable');
    });
    expect(() => printWorkspace(document.querySelector('button'))).toThrow('Unavailable');
    expect(document.querySelector('[data-os-print-target]')).toBeNull();
  });
});
