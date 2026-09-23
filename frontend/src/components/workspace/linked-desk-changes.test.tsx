import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { notifyDeskSaved, useLinkedDeskChanges } from './linked-desk-changes';

describe('Linked desk updates', () => {
  it('refreshes the other app after a successful save without sharing business data', () => {
    const invoice = vi.fn(),
      cash = vi.fn();
    renderHook(() => useLinkedDeskChanges('invoice-desk', false, invoice));
    renderHook(() => useLinkedDeskChanges('cash-desk', false, cash));
    act(() => notifyDeskSaved('cash-desk'));
    expect(invoice).toHaveBeenCalledTimes(1);
    expect(invoice).toHaveBeenCalledWith();
    expect(cash).not.toHaveBeenCalled();
  });
  it('defers updates while editing and refreshes once after the form closes', () => {
    const refresh = vi.fn(),
      latest = vi.fn();
    const { rerender } = renderHook(
      ({ editing, callback }) => useLinkedDeskChanges('cash-desk', editing, callback),
      { initialProps: { editing: true, callback: refresh } },
    );
    act(() => {
      notifyDeskSaved('invoice-desk');
      notifyDeskSaved('sales-desk');
    });
    expect(refresh).not.toHaveBeenCalled();
    rerender({ editing: false, callback: latest });
    expect(latest).toHaveBeenCalledTimes(1);
    rerender({ editing: true, callback: latest });
    rerender({ editing: false, callback: latest });
    expect(latest).toHaveBeenCalledTimes(1);
  });
  it('does not retain listeners after the account or workspace unmounts', () => {
    const refresh = vi.fn();
    const { unmount } = renderHook(() => useLinkedDeskChanges('invoice-desk', false, refresh));
    unmount();
    act(() => notifyDeskSaved('cash-desk'));
    expect(refresh).not.toHaveBeenCalled();
  });
});
