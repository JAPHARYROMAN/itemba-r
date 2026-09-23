import { describe, expect, it } from 'vitest';
import { isPosOnlyUser } from './dashboard-layout';

// A POS-only user lives entirely in the till; the ERP shell must never appear
// for them. Every permission a rep can be granted for the till must keep them
// POS-only, or a new grant silently moves them out of their app.
describe('isPosOnlyUser', () => {
  it('keeps a rep who can change prices on the till', () => {
    expect(
      isPosOnlyUser({ permissions: ['mobile_pos_lite.use', 'mobile_pos_lite.edit_price'] }),
    ).toBe(true);
  });

  it('keeps a phone-only manager with every till permission on the till', () => {
    expect(
      isPosOnlyUser({
        permissions: [
          'mobile_pos_lite.use',
          'mobile_pos_lite.purchase',
          'mobile_pos_lite.stock_count',
          'mobile_pos_lite.edit_price',
          'mobile_pos_lite.edit_price_unlimited',
        ],
      }),
    ).toBe(true);
  });

  it('never treats an office user as POS-only', () => {
    expect(isPosOnlyUser({ permissions: ['mobile_pos_lite.use', 'sales_orders.view'] })).toBe(
      false,
    );
    expect(isPosOnlyUser({ permissions: ['mobile_pos_lite.edit_price'] })).toBe(false);
    expect(isPosOnlyUser(null)).toBe(false);
  });
});
