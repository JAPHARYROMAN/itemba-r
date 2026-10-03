import { afterEach, describe, expect, it } from 'vitest';
import { claimTerminalControl, terminalOperation } from './terminal-control';
import { deviceLocks } from './testing/device-database';
afterEach(() => {
  Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
});
describe('activated-device terminal coordination', () => {
  it('allows only one selling window until its owner releases control', async () => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: deviceLocks() });
    let a = false,
      b = false;
    const release = claimTerminalControl('T1', (value) => {
      a = value;
    });
    await Promise.resolve();
    const other = claimTerminalControl('T1', (value) => {
      b = value;
    });
    await Promise.resolve();
    expect(a).toBe(true);
    expect(b).toBe(false);
    release();
    other();
    await Promise.resolve();
    await Promise.resolve();
    const retry = claimTerminalControl('T1', (value) => {
      b = value;
    });
    await Promise.resolve();
    expect(b).toBe(true);
    retry();
  });
  it('serializes sale and outbox operations but lets different terminals run separately', async () => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: deviceLocks() });
    const events: string[] = [];
    let release: () => void = () => undefined;
    const first = terminalOperation('T1', async () => {
      events.push('sale');
      await new Promise<void>((r) => {
        release = r;
      });
      events.push('sale done');
    });
    const sync = terminalOperation('T1', async () => {
      events.push('sync');
    });
    await terminalOperation('T2', async () => {
      events.push('other till');
    });
    expect(events).toEqual(['sale', 'other till']);
    release();
    await Promise.all([first, sync]);
    expect(events).toEqual(['sale', 'other till', 'sale done', 'sync']);
  });
  it('fails closed for new selling control when the browser has no lock API', () => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
    let owned = true;
    const release = claimTerminalControl('T1', (value) => {
      owned = value;
    });
    expect(owned).toBe(false);
    release();
  });
});
