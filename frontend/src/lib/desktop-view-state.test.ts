import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { format } from 'prettier';
import { describe, expect, it } from 'vitest';
import { parseDesktopViewState } from './desktop-view-state';
describe('desktop view contract', () => {
  it('keeps the server and browser allowlists identical', async () => {
    const front = readFileSync(resolve('src/lib/desktop-view-state.ts'), 'utf8');
    const back = readFileSync(
      resolve('../backend/src/modules/workspace/workspace-view-state.ts'),
      'utf8',
    );
    expect(await format(front, { parser: 'typescript' })).toBe(
      await format(back, { parser: 'typescript' }),
    );
  });
  it('drops unknown fields, other apps, nested form data and unsupported schema versions', () => {
    const state = {
      version: 1,
      values: {
        'invoice-desk.search': 'Fuel',
        'invoice-desk.scope': { companyId: 'a', cardNumber: 'secret' },
        'cash-desk.search': 'cash',
        'invoice-desk.new.amount': 5,
        'invoice-desk.page': -1,
      },
    };
    expect(parseDesktopViewState('invoice-desk', state).values).toEqual({
      'invoice-desk.search': 'Fuel',
    });
    expect(parseDesktopViewState('invoice-desk', { ...state, version: 2 }).values).toEqual({});
  });
});
