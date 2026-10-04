import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { MobileJoin } from './mobile-join';
import {
  prepareRegistration,
  readPendingRegistration,
  clearPendingRegistration,
} from './mobile-api';
const h = vi.hoisted(() => ({
  installed: false,
  replace: vi.fn(),
  api: vi.fn(),
  save: vi.fn(),
  officePost: vi.fn(),
  saveAdmin: vi.fn(),
  pendingSaveFails: false,
  provisional: null as null | { enrollmentId: string; deviceSecret: string },
  pending: null as null | { inviteToken: string; claimToken: string; enrollmentId: string },
  device: null as null | {
    enrollmentId: string;
    deviceSecret: string;
    ownerId: string;
    credentialVersion: number;
    inviteToken?: string;
    claimToken?: string;
  },
}));
vi.mock('next/navigation', () => {
  const router = { replace: h.replace };
  return { useRouter: () => router };
});
vi.mock('@/lib/api-client', async (original) => ({
  ...(await original<typeof import('@/lib/api-client')>()),
  backendPost: (...args: unknown[]) => h.officePost(...args),
}));
vi.mock('./mobile-api', async (original) => ({
  ...(await original<typeof import('./mobile-api')>()),
  mobileApi: (...args: unknown[]) => h.api(...args),
  isInstalled: () => h.installed,
  readDevice: () => h.device,
  saveDevice: h.save,
  createDeviceSecret: () => 'a'.repeat(64),
  readPendingEnrollment: () => h.pending,
  readAdminInstallation: () => null,
  saveAdminInstallation: h.saveAdmin,
  readSetupBinding: (id: string) =>
    h.provisional?.enrollmentId === id ? h.provisional.deviceSecret : null,
  saveSetupBinding: (enrollmentId: string, deviceSecret: string) => {
    h.provisional = { enrollmentId, deviceSecret };
  },
  clearSetupBinding: (id: string) => {
    if (h.provisional?.enrollmentId === id) h.provisional = null;
  },
  savePendingEnrollment: (value: typeof h.pending) => {
    if (h.pendingSaveFails) throw new Error('Pending receipt storage unavailable');
    h.pending = value;
  },
  clearPendingEnrollment: (id: string) => {
    if (h.pending?.enrollmentId === id) h.pending = null;
  },
}));
const scope = {
  company: { id: 'company', name: 'Company' },
  division: { id: 'division', name: 'Division' },
  branch: { id: 'branch', name: 'Branch A' },
};
beforeEach(() => {
  localStorage.clear();
  h.installed = false;
  h.device = null;
  h.pending = null;
  h.pendingSaveFails = false;
  h.provisional = null;
  h.replace.mockReset();
  h.save.mockReset();
  h.saveAdmin.mockReset();
  h.officePost.mockReset();
  h.officePost.mockResolvedValue({ adminLinked: true });
  h.api.mockReset();
  h.api.mockResolvedValue(scope);
});
afterEach(() => vi.restoreAllMocks());
describe('installed mobile onboarding', () => {
  it('requires installation before collecting an identity or creating a device binding', async () => {
    render(<MobileJoin token="invite" />);
    await screen.findByRole('button', { name: 'Show installation steps' });
    expect(screen.queryByLabelText('Full name')).not.toBeInTheDocument();
    expect(h.save).not.toHaveBeenCalled();
    expect(h.api.mock.calls.every((call) => !call[1]?.method)).toBe(true);
  });
  it('requests the selected stockist role from the installed app and continues on the claim URL', async () => {
    h.installed = true;
    h.api.mockImplementation(async (path: string, options?: { method?: string }) =>
      options?.method === 'POST'
        ? {
            enrollmentId: readPendingRegistration()!.requestId,
            claimToken: readPendingRegistration()!.claimToken,
            status: 'PENDING',
          }
        : scope,
    );
    const user = userEvent.setup();
    render(<MobileJoin token="invite" />);
    await screen.findByLabelText('Full name');
    await user.type(screen.getByLabelText('Full name'), 'Operator A');
    await user.selectOptions(screen.getByLabelText('Requested role'), 'STOCKIST');
    await user.click(screen.getByRole('button', { name: 'Request access' }));
    await waitFor(() =>
      expect(h.replace).toHaveBeenCalledWith(`/mobile-pos/join/${h.pending!.claimToken}`),
    );
    expect(h.api).toHaveBeenCalledWith(
      '/mobile-pos-auth/invite/invite',
      expect.objectContaining({
        body: expect.objectContaining({
          name: 'Operator A',
          role: 'STOCKIST',
          requestId: h.pending!.enrollmentId,
          claimToken: h.pending!.claimToken,
        }),
        public: true,
      }),
    );
    expect(h.save).not.toHaveBeenCalled();
  });
  it.each([
    { kind: 'one-character', name: ' A ' },
    { kind: 'overlong', name: 'A'.repeat(121) },
  ])(
    'keeps an invalid $kind name editable without persisting or sending a request',
    async ({ name }) => {
      h.installed = true;
      const user = userEvent.setup();
      render(<MobileJoin token="invite" />);
      await user.type(await screen.findByLabelText('Full name'), name);
      await user.click(screen.getByRole('button', { name: 'Request access' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('between 2 and 120');
      expect(readPendingRegistration()).toBeNull();
      expect(h.api.mock.calls.every((call) => call[1]?.method !== 'POST')).toBe(true);
      expect(screen.getByLabelText('Full name')).not.toHaveAttribute('readonly');
      expect(screen.getByLabelText('Requested role')).toBeEnabled();
    },
  );
  it.each(['CASHIER', 'STOCKIST', 'ADMIN'])(
    'waits for %s approval before exposing setup or account linking',
    async (role) => {
      h.installed = true;
      h.api.mockImplementation(async (path: string) => {
        if (path.includes('/invite/')) throw new ApiError('No invite', 404, null);
        return {
          ...scope,
          enrollmentId: 'enrollment',
          name: 'Operator A',
          role,
          status: 'PENDING',
          pinReady: false,
        };
      });
      render(<MobileJoin token="claim" />);
      await screen.findByText('Your request is with the admin.');
      expect(screen.queryByLabelText('Six-digit PIN')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Link authorized admin account' }),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Open admin POS' })).not.toBeInTheDocument();
      expect(h.save).not.toHaveBeenCalled();
    },
  );
  it('opens the bound workspace when the installed icon still starts at its original invite', async () => {
    h.installed = true;
    h.device = {
      enrollmentId: 'enrollment',
      deviceSecret: 'a'.repeat(64),
      ownerId: 'operator',
      credentialVersion: 1,
      inviteToken: 'invite',
      claimToken: 'claim',
    };
    render(<MobileJoin token="invite" />);
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith('/mobile-pos'));
    expect(h.api).not.toHaveBeenCalled();
  });
  it('reuses the provisional device secret after a lost setup response', async () => {
    h.installed = true;
    h.provisional = { enrollmentId: 'enrollment', deviceSecret: 'c'.repeat(64) };
    h.api.mockImplementation(async (path: string) => {
      if (path.includes('/invite/')) throw new ApiError('No invite', 404, null);
      if (path.endsWith('/setup'))
        return {
          ...scope,
          user: { id: 'operator' },
          operator: { credentialVersion: 1 },
          enrollmentId: 'enrollment',
        };
      return {
        ...scope,
        enrollmentId: 'enrollment',
        name: 'Operator A',
        role: 'CASHIER',
        status: 'APPROVED',
        pinReady: true,
      };
    });
    const user = userEvent.setup();
    render(<MobileJoin token="claim" />);
    await screen.findByLabelText('Six-digit PIN');
    await user.type(screen.getByLabelText('Six-digit PIN'), '123456');
    await user.type(screen.getByLabelText('Confirm PIN'), '123456');
    await user.click(screen.getByRole('button', { name: 'Recover sign-in and open POS' }));
    await waitFor(() => expect(h.save).toHaveBeenCalled());
    expect(h.api).toHaveBeenCalledWith(
      '/mobile-pos-auth/setup',
      expect.objectContaining({
        body: { claimToken: 'claim', deviceSecret: 'c'.repeat(64), pin: '123456' },
      }),
    );
    expect(h.provisional).toBeNull();
  });
  it('resumes its saved pending claim when the installed home icon opens the original invite', async () => {
    h.installed = true;
    h.pending = { inviteToken: 'invite', claimToken: 'claim', enrollmentId: 'enrollment' };
    h.api.mockImplementation(async (path: string) => {
      if (path.includes('/invite/')) throw new ApiError('No invite', 404, null);
      return {
        ...scope,
        enrollmentId: 'enrollment',
        name: 'Operator A',
        role: 'CASHIER',
        status: 'PENDING',
        pinReady: false,
      };
    });
    render(<MobileJoin token="invite" />);
    await screen.findByText('Your request is with the admin.');
    expect(h.replace).toHaveBeenCalledWith('/mobile-pos/join/claim');
    expect(h.api).toHaveBeenCalledWith('/mobile-pos-auth/enrollment/claim', expect.anything());
    expect(screen.queryByLabelText('Full name')).not.toBeInTheDocument();
    expect(h.api.mock.calls.every((call) => !call[1]?.method)).toBe(true);
  });
  it('links approved admin access through an existing OS identity without PIN setup', async () => {
    h.installed = true;
    h.api.mockImplementation(async (path: string) => {
      if (path.includes('/invite/')) throw new ApiError('No invite', 404, null);
      return {
        ...scope,
        enrollmentId: 'enrollment',
        name: 'Admin A',
        role: 'ADMIN',
        status: 'APPROVED',
        adminLinked: false,
        pinReady: false,
      };
    });
    render(<MobileJoin token="claim" />);
    await screen.findByRole('button', { name: 'Link authorized admin account' });
    expect(screen.queryByLabelText('Six-digit PIN')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in with your OS account' })).toHaveAttribute(
      'href',
      '/login?from=%2Fmobile-pos%2Fjoin%2Fclaim',
    );
    expect(screen.queryByRole('link', { name: 'Open admin POS' })).not.toBeInTheDocument();
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Link authorized admin account' }));
    await waitFor(() =>
      expect(h.officePost).toHaveBeenCalledWith(
        '/mobile-pos-onboarding/enrollments/enrollment/admin-link',
        { claimToken: 'claim' },
      ),
    );
    expect(h.saveAdmin).toHaveBeenCalled();
    expect(h.replace).toHaveBeenCalledWith('/mobile-pos?admin=1&companyId=company&branchId=branch');
  });
  it('opens approved linked admin access without another link or PIN flow', async () => {
    h.installed = true;
    h.api.mockImplementation(async (path: string) => {
      if (path.includes('/invite/')) throw new ApiError('No invite', 404, null);
      return {
        ...scope,
        enrollmentId: 'enrollment',
        name: 'Admin A',
        role: 'ADMIN',
        status: 'APPROVED',
        adminLinked: true,
        pinReady: false,
      };
    });
    render(<MobileJoin token="claim" />);
    expect(await screen.findByRole('link', { name: 'Open admin POS' })).toHaveAttribute(
      'href',
      '/mobile-pos?admin=1&companyId=company&branchId=branch',
    );
    expect(
      screen.queryByRole('button', { name: 'Link authorized admin account' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Six-digit PIN')).not.toBeInTheDocument();
  });
  it('retains and hydrates an unacknowledged registration across reload, then retries the same persisted identity', async () => {
    h.installed = true;
    let posts = 0;
    const bodies: unknown[] = [];
    h.api.mockImplementation(
      async (
        _path: string,
        options?: { method?: string; body?: { requestId: string; claimToken: string } },
      ) => {
        if (options?.method !== 'POST') return scope;
        expect(readPendingRegistration()).toEqual(expect.objectContaining(options.body!));
        bodies.push(options.body);
        if (++posts === 1) throw new TypeError('Response lost');
        return { enrollmentId: options.body!.requestId, claimToken: options.body!.claimToken };
      },
    );
    const user = userEvent.setup();
    const first = render(<MobileJoin token="invite" />);
    await user.type(await screen.findByLabelText('Full name'), 'Operator A');
    await user.selectOptions(screen.getByLabelText('Requested role'), 'STOCKIST');
    await user.click(screen.getByRole('button', { name: 'Request access' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Response lost');
    expect(screen.getByLabelText('Full name')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Requested role')).toBeDisabled();
    await user.type(screen.getByLabelText('Full name'), 'Changed name');
    expect(screen.getByLabelText('Full name')).toHaveValue('Operator A');
    expect(h.pending).toBeNull();
    expect(h.replace).not.toHaveBeenCalled();
    first.unmount();
    render(<MobileJoin token="invite" />);
    expect(await screen.findByLabelText('Full name')).toHaveValue('Operator A');
    expect(screen.getByLabelText('Requested role')).toHaveValue('STOCKIST');
    expect(h.replace).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Request access' }));
    await waitFor(() => expect(h.pending).not.toBeNull());
    expect(bodies[1]).toEqual(bodies[0]);
    expect(readPendingRegistration()).toBeNull();
  });
  it('does not send a request when its identity cannot be saved first', async () => {
    h.installed = true;
    const user = userEvent.setup();
    render(<MobileJoin token="invite" />);
    await user.type(await screen.findByLabelText('Full name'), 'Operator A');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Storage unavailable');
    });
    await user.click(screen.getByRole('button', { name: 'Request access' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Storage unavailable');
    expect(h.api.mock.calls.every((call) => call[1]?.method !== 'POST')).toBe(true);
    expect(h.pending).toBeNull();
    expect(h.replace).not.toHaveBeenCalled();
  });
  it('keeps the matching retry identity when an acknowledged receipt cannot be saved', async () => {
    h.installed = true;
    h.pendingSaveFails = true;
    h.api.mockImplementation(
      async (
        _path: string,
        options?: { method?: string; body?: { requestId: string; claimToken: string } },
      ) =>
        options?.method === 'POST'
          ? { enrollmentId: options.body!.requestId, claimToken: options.body!.claimToken }
          : scope,
    );
    const user = userEvent.setup();
    render(<MobileJoin token="invite" />);
    await user.type(await screen.findByLabelText('Full name'), 'Operator A');
    await user.click(screen.getByRole('button', { name: 'Request access' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Pending receipt storage unavailable',
    );
    expect(readPendingRegistration()?.name).toBe('Operator A');
    expect(h.pending).toBeNull();
    expect(h.replace).not.toHaveBeenCalled();
  });
  it('hydrates an unacknowledged retry form when its invite is unavailable without opening the claim', async () => {
    h.installed = true;
    const attempt = prepareRegistration('invite', 'Admin A', 'ADMIN');
    h.api.mockRejectedValue(new ApiError('Invite expired', 410, null));
    render(<MobileJoin token="invite" />);
    expect(await screen.findByLabelText('Full name')).toHaveValue('Admin A');
    expect(screen.getByLabelText('Requested role')).toHaveValue('ADMIN');
    expect(h.api).toHaveBeenCalledTimes(1);
    expect(h.replace).not.toHaveBeenCalled();
    expect(readPendingRegistration()).toEqual(attempt);
    expect(h.pending).toBeNull();
  });
  it('retains a registration when the receipt identity does not match', async () => {
    h.installed = true;
    h.api.mockImplementation(async (_path: string, options?: { method?: string }) =>
      options?.method === 'POST' ? { enrollmentId: 'wrong', claimToken: 'wrong' } : scope,
    );
    const user = userEvent.setup();
    render(<MobileJoin token="invite" />);
    await user.type(await screen.findByLabelText('Full name'), 'Operator A');
    await user.click(screen.getByRole('button', { name: 'Request access' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('did not match');
    expect(readPendingRegistration()).not.toBeNull();
    expect(h.pending).toBeNull();
    expect(h.replace).not.toHaveBeenCalled();
  });
  it('does not let a late receipt overwrite a newer registration attempt', async () => {
    h.installed = true;
    h.api.mockImplementation(
      async (
        _path: string,
        options?: { method?: string; body?: { requestId: string; claimToken: string } },
      ) => {
        if (options?.method !== 'POST') return scope;
        clearPendingRegistration(readPendingRegistration()!.requestId);
        prepareRegistration('invite', 'Operator B', 'ADMIN');
        return { enrollmentId: options.body!.requestId, claimToken: options.body!.claimToken };
      },
    );
    const user = userEvent.setup();
    render(<MobileJoin token="invite" />);
    await user.type(await screen.findByLabelText('Full name'), 'Operator A');
    await user.click(screen.getByRole('button', { name: 'Request access' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('changed in another tab');
    expect(readPendingRegistration()?.name).toBe('Operator B');
    expect(h.pending).toBeNull();
    expect(h.replace).not.toHaveBeenCalled();
  });
  it.each(['navigate', 'unmount'])(
    'keeps an in-flight registration retryable after %s without redirecting to its old claim',
    async (transition) => {
      h.installed = true;
      let acknowledge!: (value: { enrollmentId: string; claimToken: string }) => void;
      const receipt = new Promise<{ enrollmentId: string; claimToken: string }>((resolve) => {
        acknowledge = resolve;
      });
      h.api.mockImplementation(async (_path: string, options?: { method?: string }) =>
        options?.method === 'POST' ? receipt : scope,
      );
      const user = userEvent.setup();
      const view = render(<MobileJoin token="invite" />);
      await user.type(await screen.findByLabelText('Full name'), 'Operator A');
      await user.click(screen.getByRole('button', { name: 'Request access' }));
      const original = readPendingRegistration()!;
      expect(original).not.toBeNull();
      if (transition === 'navigate') view.rerender(<MobileJoin token="other-invite" />);
      else view.unmount();
      await act(async () => {
        acknowledge({ enrollmentId: original.requestId, claimToken: original.claimToken });
        await receipt;
      });
      expect(readPendingRegistration()).toEqual(original);
      expect(h.pending).toBeNull();
      expect(h.replace).not.toHaveBeenCalled();
    },
  );
  it('requires matching PIN confirmation and retains the originally bound secret for reset', async () => {
    h.installed = true;
    h.device = {
      enrollmentId: 'enrollment',
      deviceSecret: 'b'.repeat(64),
      ownerId: 'operator',
      credentialVersion: 1,
    };
    h.api.mockImplementation(async (path: string) => {
      if (path.includes('/invite/')) throw new ApiError('No invite', 404, null);
      if (path.endsWith('/setup'))
        return {
          ...scope,
          user: { id: 'operator' },
          operator: { credentialVersion: 2 },
          enrollmentId: 'enrollment',
        };
      return {
        ...scope,
        enrollmentId: 'enrollment',
        name: 'Operator A',
        role: 'CASHIER',
        status: 'APPROVED',
        pinReady: false,
        resetRequired: true,
      };
    });
    const user = userEvent.setup();
    render(<MobileJoin token="reset" />);
    await screen.findByLabelText('Six-digit PIN');
    await user.type(screen.getByLabelText('Six-digit PIN'), '123456');
    await user.type(screen.getByLabelText('Confirm PIN'), '123455');
    await user.click(screen.getByRole('button', { name: 'Set PIN and open POS' }));
    expect(screen.getByRole('alert')).toHaveTextContent('confirm');
    await user.clear(screen.getByLabelText('Confirm PIN'));
    await user.type(screen.getByLabelText('Confirm PIN'), '123456');
    await user.click(screen.getByRole('button', { name: 'Set PIN and open POS' }));
    await waitFor(() => expect(h.save).toHaveBeenCalled());
    expect(h.api).toHaveBeenCalledWith(
      '/mobile-pos-auth/setup',
      expect.objectContaining({
        body: { claimToken: 'reset', deviceSecret: 'b'.repeat(64), pin: '123456' },
      }),
    );
  });
  it('surfaces an expired installation link without identity fields', async () => {
    h.api.mockRejectedValue(new ApiError('This installation link has expired.', 410, null));
    render(<MobileJoin token="expired" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('expired');
    expect(screen.queryByLabelText('Full name')).not.toBeInTheDocument();
  });
  it('recovers a completed reset after its response is lost using the same device and new PIN', async () => {
    h.installed = true;
    h.device = {
      enrollmentId: 'enrollment',
      deviceSecret: 'b'.repeat(64),
      ownerId: 'operator',
      credentialVersion: 1,
    };
    let resetCompleted = false;
    h.api.mockImplementation(async (path: string) => {
      if (path.includes('/invite/')) throw new ApiError('No invite', 404, null);
      if (path.endsWith('/setup')) {
        if (resetCompleted) throw new ApiError('Registration is unavailable', 404, null);
        resetCompleted = true;
        throw new TypeError('Response lost');
      }
      if (path.endsWith('/login'))
        return {
          ...scope,
          user: { id: 'operator' },
          operator: { credentialVersion: 2 },
          enrollmentId: 'enrollment',
        };
      return {
        ...scope,
        enrollmentId: 'enrollment',
        name: 'Operator A',
        role: 'CASHIER',
        status: 'APPROVED',
        pinReady: false,
        resetRequired: true,
      };
    });
    const user = userEvent.setup();
    render(<MobileJoin token="reset" />);
    await screen.findByLabelText('Six-digit PIN');
    await user.type(screen.getByLabelText('Six-digit PIN'), '654321');
    await user.type(screen.getByLabelText('Confirm PIN'), '654321');
    await user.click(screen.getByRole('button', { name: 'Set PIN and open POS' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Response lost');
    expect(h.save).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Set PIN and open POS' }));
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith('/mobile-pos'));
    expect(h.api).toHaveBeenCalledWith(
      '/mobile-pos-auth/login',
      expect.objectContaining({
        body: { enrollmentId: 'enrollment', deviceSecret: 'b'.repeat(64), pin: '654321' },
        public: true,
      }),
    );
    expect(h.save).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 'operator', credentialVersion: 2 }),
    );
    expect(h.provisional).toBeNull();
  });
  it('offers new-PIN sign-in when reloading a consumed reset link on its original phone', async () => {
    h.installed = true;
    h.device = {
      enrollmentId: 'enrollment',
      deviceSecret: 'b'.repeat(64),
      ownerId: 'operator',
      credentialVersion: 1,
    };
    h.provisional = { enrollmentId: 'enrollment', deviceSecret: 'b'.repeat(64) };
    h.api.mockRejectedValue(new ApiError('Registration is unavailable', 404, null));
    render(<MobileJoin token="used-reset" />);
    expect(
      await screen.findByRole('link', { name: 'Open POS to recover sign-in' }),
    ).toHaveAttribute('href', '/mobile-pos');
    expect(h.save).not.toHaveBeenCalled();
    expect(h.api.mock.calls.every((call) => !call[1]?.method)).toBe(true);
  });
  it('does not reset from another approved phone', async () => {
    h.installed = true;
    h.device = {
      enrollmentId: 'another-enrollment',
      deviceSecret: 'b'.repeat(64),
      ownerId: 'operator',
      credentialVersion: 1,
    };
    h.api.mockImplementation(async (path: string) => {
      if (path.includes('/invite/')) throw new ApiError('No invite', 404, null);
      return {
        ...scope,
        enrollmentId: 'enrollment',
        name: 'Operator A',
        role: 'CASHIER',
        status: 'APPROVED',
        pinReady: false,
        resetRequired: true,
      };
    });
    const user = userEvent.setup();
    render(<MobileJoin token="reset" />);
    await screen.findByLabelText('Six-digit PIN');
    await user.type(screen.getByLabelText('Six-digit PIN'), '654321');
    await user.type(screen.getByLabelText('Confirm PIN'), '654321');
    await user.click(screen.getByRole('button', { name: 'Set PIN and open POS' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('originally approved device');
    expect(h.save).not.toHaveBeenCalled();
    expect(h.api.mock.calls.every((call) => !call[1]?.method)).toBe(true);
  });
  it('keeps a changed device binding when a late PIN setup response arrives', async () => {
    h.installed = true;
    h.device = {
      enrollmentId: 'enrollment',
      deviceSecret: 'b'.repeat(64),
      ownerId: 'operator',
      credentialVersion: 1,
    };
    h.api.mockImplementation(async (path: string) => {
      if (path.includes('/invite/')) throw new ApiError('No invite', 404, null);
      if (path.endsWith('/setup')) {
        h.device = { ...h.device!, ownerId: 'another-operator' };
        return {
          ...scope,
          user: { id: 'operator' },
          operator: { credentialVersion: 2 },
          enrollmentId: 'enrollment',
        };
      }
      return {
        ...scope,
        enrollmentId: 'enrollment',
        name: 'Operator A',
        role: 'CASHIER',
        status: 'APPROVED',
        pinReady: false,
        resetRequired: true,
      };
    });
    const user = userEvent.setup();
    render(<MobileJoin token="reset" />);
    await screen.findByLabelText('Six-digit PIN');
    await user.type(screen.getByLabelText('Six-digit PIN'), '654321');
    await user.type(screen.getByLabelText('Confirm PIN'), '654321');
    await user.click(screen.getByRole('button', { name: 'Set PIN and open POS' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('approved device changed');
    expect(h.save).not.toHaveBeenCalled();
    expect(h.replace).not.toHaveBeenCalled();
    expect(h.device.ownerId).toBe('another-operator');
  });
});
