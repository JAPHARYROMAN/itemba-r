import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_WORKSPACE,
  parseWorkspace,
  readWorkspace,
  updateWorkspace,
  workspaceKey,
} from './workspace-preferences';
beforeEach(() => localStorage.clear());
describe('Account workspace preferences', () => {
  it('migrates existing preferences to presentation defaults and rejects untrusted appearance values', () => {
    const old = parseWorkspace('{"version":1,"pinnedApps":["documents"]}');
    expect(old.pinnedApps).toEqual(['documents']);
    expect(old.density).toBe('comfortable');
    expect(old.backdrop).toBe('landscape');
    expect(old.transparency).toBe('full');
    const untrusted = parseWorkspace(
      '{"version":1,"density":"tiny","backdrop":"url(https://example.test)","transparency":false}',
    );
    expect(untrusted.backdrop).toBe('landscape');
    expect(untrusted.density).toBe('comfortable');
    expect(untrusted.transparency).toBe('full');
  });
  it('keeps current-session preferences when storage rejects writes', () => {
    const reject = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Quota exceeded');
    });
    try {
      updateWorkspace('private-reader', (value) => ({ ...value, maximized: true }));
      expect(readWorkspace('private-reader').maximized).toBe(true);
    } finally {
      reject.mockRestore();
    }
  });
  it('isolates preferences between accounts and restores them from saved storage', () => {
    updateWorkspace('alice', (value) => ({
      ...value,
      lastErpPath: '/finance/expenses',
      maximized: true,
      layouts: { '/finance/expenses': 'ledger' },
      pinnedApps: ['fuel-grid'],
    }));
    expect(readWorkspace('bob')).toEqual(DEFAULT_WORKSPACE);
    const saved = parseWorkspace(localStorage.getItem(workspaceKey('alice')));
    expect(saved.lastErpPath).toBe('/finance/expenses');
    expect(saved.maximized).toBe(true);
    expect(saved.layouts['/finance/expenses']).toBe('ledger');
    expect(saved.pinnedApps).toEqual(['fuel-grid']);
  });
  it('rejects corrupt, old-version, external or script navigation destinations', () => {
    expect(parseWorkspace('{bad')).toEqual(DEFAULT_WORKSPACE);
    expect(parseWorkspace('{"version":99}')).toEqual(DEFAULT_WORKSPACE);
    for (const lastErpPath of [
      'https://example.test',
      '//example.test',
      'javascript:alert(1)',
      '/api?token=secret',
    ]) {
      expect(parseWorkspace(JSON.stringify({ version: 1, lastErpPath })).lastErpPath).toBe(
        '/dashboard',
      );
    }
    expect(
      parseWorkspace(
        '{"version":1,"pinnedApps":["fuel-grid","fuel-grid",12],"layouts":{"__proto__":"ledger","/finance":"bad"}}',
      ).pinnedApps,
    ).toEqual(['fuel-grid']);
  });
});
