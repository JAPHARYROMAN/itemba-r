import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StationSetup } from './station-setup';
import type { Workspace } from './types';

const api = vi.hoisted(() => ({ post: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('@/lib/api-client', () => ({
  backendPost: api.post,
  backendPatch: api.patch,
  backendDelete: api.delete,
}));
const timestamp = '2026-10-02T12:00:00.000Z';
const tank = {
  id: 't1',
  tankCode: 'AGO-1',
  tankName: 'Diesel tank',
  productId: 'diesel',
  productName: 'Diesel',
  capacityLitres: 52000,
  status: 'ACTIVE',
  deletedAt: null,
  updatedAt: timestamp,
};
const workspace: Workspace = {
  catalog: { tanks: [tank], nozzles: [] },
  report: null,
  previous: null,
  daily: [],
  tanks: [tank],
  products: [{ id: 'diesel', name: 'Diesel' }],
  pumps: [
    {
      id: 'p1',
      pumpCode: 'P1',
      pumpName: 'Pump 1',
      status: 'ACTIVE',
      updatedAt: timestamp,
      nozzles: [
        { id: 'n1', nozzleCode: 'N1', tankId: 't1', productId: 'diesel', status: 'ACTIVE' },
        { id: 'n2', nozzleCode: 'N2', tankId: 't1', productId: 'diesel', status: 'ACTIVE' },
      ],
    },
  ],
};
function setup(data = workspace, refresh = vi.fn().mockResolvedValue(undefined)) {
  const lock = vi.fn();
  const result = render(
    <StationSetup
      branchId="station"
      workspace={data}
      refresh={refresh}
      apiBase="/petrodollar"
      onLock={lock}
    />,
  );
  return { ...result, refresh, lock };
}
beforeEach(() => {
  vi.clearAllMocks();
  api.post.mockResolvedValue({});
  api.patch.mockResolvedValue({});
  api.delete.mockResolvedValue({});
});

describe('Station setup equipment actions', () => {
  it('shows equipment but disables mutations for read-only company access', () => {
    setup({ ...workspace, canConfigure: false });
    expect(screen.getByRole('button', { name: 'Delete tank Diesel tank' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Edit tank Diesel tank' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Edit pump Pump 1' })).toBeDisabled();
    expect(screen.getByLabelText('Tank name')).toBeDisabled();
  });
  it('confirms deletion, supports cancelling and retains equipment until the server accepts the action', async () => {
    const { refresh } = setup();
    const trigger = screen.getByRole('button', { name: 'Delete tank Diesel tank' });
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog')).toHaveTextContent(/previous reports will be kept/);
    expect(api.delete).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(trigger);
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete tank' }),
    );
    await waitFor(() =>
      expect(api.delete).toHaveBeenCalledWith('/petrodollar/tanks/t1', {
        body: { expectedUpdatedAt: timestamp },
      }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(await screen.findByRole('status')).toHaveTextContent(/history is kept/);
  });

  it('keeps a blocked deletion visible with the server’s reason and leaves the tank in the register', async () => {
    setup();
    api.delete.mockRejectedValueOnce(new Error('Disconnect active nozzles before deleting.'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete tank Diesel tank' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete tank' }),
    );
    await waitFor(() =>
      expect(screen.getByRole('dialog')).toHaveTextContent(/Disconnect active nozzles/),
    );
    expect(
      within(screen.getByRole('region', { name: 'Station tanks' })).getByText('Diesel tank'),
    ).toBeInTheDocument();
  });

  it('edits a tank using its revision and keeps entered values after a stale-edit response', async () => {
    const { lock } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Edit tank Diesel tank' }));
    expect(screen.getByLabelText('Tank code')).toHaveFocus();
    fireEvent.change(screen.getByLabelText('Tank name'), { target: { value: 'Main diesel tank' } });
    api.patch.mockRejectedValueOnce(new Error('This equipment changed in another window.'));
    fireEvent.click(screen.getByRole('button', { name: 'Save tank changes' }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/petrodollar/tanks/t1', {
        code: 'AGO-1',
        name: 'Main diesel tank',
        capacityLitres: 52000,
        productId: 'diesel',
        expectedUpdatedAt: timestamp,
      }),
    );
    expect(screen.getByLabelText('Tank name')).toHaveValue('Main diesel tank');
    expect(lock).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel tank editing' }));
    await waitFor(() => expect(lock).toHaveBeenLastCalledWith(false));
    expect(screen.getByRole('button', { name: 'Edit tank Diesel tank' })).toHaveFocus();
  });

  it('keeps navigation locked while editing even if all editable text and capacity are cleared', async () => {
    const { lock } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Edit tank Diesel tank' }));
    fireEvent.change(screen.getByLabelText('Tank code'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Tank name'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Tank capacity'), { target: { value: '' } });
    expect(lock).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole('button', { name: 'Delete tank Diesel tank' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel tank editing' }));
    await waitFor(() => expect(lock).toHaveBeenLastCalledWith(false));
  });

  it('saves pump edits with retained nozzle identities and removes only the omitted nozzle', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Edit pump Pump 1' }));
    fireEvent.change(screen.getByLabelText('Pump name'), { target: { value: 'Main pump' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove nozzle N2 from pump form' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save pump changes' }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/petrodollar/pumps/p1', {
        code: 'P1',
        name: 'Main pump',
        expectedUpdatedAt: timestamp,
        nozzles: [{ id: 'n1', code: 'N1', tankId: 't1' }],
      }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Pump and nozzle connections updated.',
    );
  });

  it('shows deleted tanks on request and restores their original identity', async () => {
    setup({ ...workspace, tanks: [{ ...tank, status: 'INACTIVE', deletedAt: timestamp }] });
    expect(
      screen.queryByRole('button', { name: 'Restore tank Diesel tank' }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show deleted tanks' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore tank Diesel tank' }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/petrodollar/tanks/t1/restore', {
        expectedUpdatedAt: timestamp,
      }),
    );
  });

  it('does not repeat an acknowledged deletion when refreshing fails', async () => {
    const refresh = vi
      .fn()
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValue(undefined);
    setup(workspace, refresh);
    fireEvent.click(screen.getByRole('button', { name: 'Delete tank Diesel tank' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete tank' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(/change was saved/);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Delete tank Diesel tank' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Reload setup' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Delete tank Diesel tank' })).toBeEnabled(),
    );
    expect(api.delete).toHaveBeenCalledOnce();
  });
});
