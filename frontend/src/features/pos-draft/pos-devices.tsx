'use client';
import { useEffect, useState } from 'react';
import { Copy, Link2, Plus, RefreshCw, Smartphone } from 'lucide-react';
import { backendGet, backendPost } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';
import { useDraftScopes } from './use-draft-scopes';
import { InstallQrCode } from '@/components/westsides/mobile-pos-install/InstallQrCode';
import type { PosRole } from './types';
import { LegacyQuarantine } from './legacy-quarantine';
type BranchSetup = {
  id: string;
  companyId: string;
  divisionId: string;
  branchId: string;
  generalCustomerId: string;
  approvalRequired: boolean;
  enabled: boolean;
  company?: { id: string; name: string };
  division?: { id: string; name: string };
  branch?: { id: string; name: string };
  generalCustomer?: { id: string; name: string };
  paymentMappings?: Array<{
    paymentMethod: string;
    cashAccountId: string;
    accountName?: string | null;
  }>;
};
type Enrollment = {
  id: string;
  name: string;
  requestedRole: PosRole;
  approvedRole: PosRole | null;
  status: string;
  branchId: string;
};
type Invite = { id: string; token: string; path: string; expiresAt: string };
export function PosDevices() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('mobile_pos_onboarding.manage');
  const [setups, setSetups] = useState<BranchSetup[]>([]),
    [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [scope, setScope] = useState({ companyId: '', divisionId: '', branchId: '' });
  const [customerId, setCustomerId] = useState('');
  const [customers, setCustomers] = useState<Array<{ id: string; name: string }>>([]);
  const [accounts, setAccounts] = useState<
    Array<{ id: string; accountName: string; accountType: string }>
  >([]);
  const [payments, setPayments] = useState<Record<string, string>>({
    CASH: '',
    MOBILE_MONEY: '',
    BANK_TRANSFER: '',
  });
  const [showSetup, setShowSetup] = useState(false);
  const [invite, setInvite] = useState<Invite | null>(null),
    [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [roles, setRoles] = useState<Record<string, 'CASHIER' | 'STOCKIST'>>({}),
    [reasons, setReasons] = useState<Record<string, string>>({});
  const org = useDraftScopes(canManage);
  useEffect(() => {
    if (!canManage) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void Promise.all([
      backendGet<BranchSetup[]>('/mobile-pos-onboarding/branch-setups', {
        signal: controller.signal,
      }),
      backendGet<Enrollment[]>('/mobile-pos-onboarding/enrollments', { signal: controller.signal }),
    ])
      .then(([branches, users]) => {
        if (!controller.signal.aborted) {
          setSetups(branches);
          setEnrollments(users);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : 'Could not load devices.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [canManage, revision]);
  useEffect(() => {
    const controller = new AbortController();
    setCustomers([]);
    setAccounts([]);
    if (scope.companyId && scope.divisionId && scope.branchId)
      void backendGet<{
        customers: Array<{ id: string; name: string }>;
        accounts: Array<{ id: string; accountName: string; accountType: string }>;
      }>('/mobile-pos-onboarding/branch-options', { query: scope, signal: controller.signal })
        .then(({ customers: people, accounts: receipts }) => {
          if (!controller.signal.aborted) {
            setCustomers(people);
            setAccounts(receipts);
          }
        })
        .catch((e) => {
          if (!controller.signal.aborted)
            setError(e instanceof Error ? e.message : 'Could not load branch defaults.');
        });
    return () => controller.abort();
  }, [scope]);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    if (!scope.companyId || !scope.divisionId || !scope.branchId || !customerId || !payments.CASH) {
      setError('Choose the branch, walk-in customer and cash receipt account.');
      return;
    }
    setBusy('setup');
    try {
      await backendPost('/mobile-pos-onboarding/branch-setups', {
        ...scope,
        generalCustomerId: customerId,
        paymentMappings: Object.entries(payments)
          .filter(([, id]) => id)
          .map(([paymentMethod, cashAccountId]) => ({ paymentMethod, cashAccountId })),
        approvalRequired: true,
        enabled: true,
      });
      setShowSetup(false);
      setNotice('Branch defaults saved. Create an installation link below.');
      setRevision((value) => value + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save branch defaults.');
    } finally {
      setBusy('');
    }
  }
  async function createInvite(id: string) {
    setBusy(id);
    setError('');
    try {
      setInvite(await backendPost<Invite>('/mobile-pos-onboarding/invites', { branchSetupId: id }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create an installation link.');
    } finally {
      setBusy('');
    }
  }
  async function act(row: Enrollment, action: 'approve' | 'reject' | 'reset-pin' | 'revoke') {
    setError('');
    if (['reject', 'revoke'].includes(action) && !reasons[row.id]?.trim()) {
      setError('Enter a reason before rejecting or revoking access.');
      return;
    }
    setBusy(row.id);
    try {
      const value = await backendPost<{ resetToken?: string }>(
        `/mobile-pos-onboarding/enrollments/${row.id}/${action}`,
        action === 'approve'
          ? { role: roles[row.id] ?? (row.requestedRole === 'STOCKIST' ? 'STOCKIST' : 'CASHIER') }
          : ['reject', 'revoke'].includes(action)
            ? { reason: reasons[row.id].trim() }
            : {},
      );
      if (value.resetToken) {
        setInvite({
          id: row.id,
          token: value.resetToken,
          path: `/mobile-pos/join/${value.resetToken}`,
          expiresAt: '',
        });
        setNotice(`PIN reset link created for ${row.name}. Open it on the approved device.`);
      } else
        setNotice(
          `${row.name}: ${action === 'approve' ? 'access approved' : action === 'reject' ? 'request rejected' : 'access revoked'}.`,
        );
      setRevision((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update access.');
    } finally {
      setBusy('');
    }
  }
  async function copy() {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(new URL(invite.path, window.location.origin).toString());
      setNotice('Installation link copied.');
    } catch {
      setNotice('Open the link below to copy it from the address bar.');
    }
  }
  if (!canManage)
    return (
      <p className="pd-error" role="alert">
        Device setup requires mobile POS management access.
      </p>
    );
  return (
    <section className="pd-devices">
      <div className="pd-section-heading">
        <div>
          <h2>Mobile team &amp; devices</h2>
          <p>Configure a branch once. Approve each person and device.</p>
        </div>
        <div className="pd-header-actions">
          <button
            className="pd-icon-button"
            aria-label="Refresh devices"
            onClick={() => setRevision((v) => v + 1)}
          >
            <RefreshCw size={18} />
          </button>
          <button className="pd-button pd-primary" onClick={() => setShowSetup((v) => !v)}>
            <Plus size={16} />
            Branch setup
          </button>
        </div>
      </div>
      {notice && (
        <p className="pd-notice" role="status">
          {notice}
        </p>
      )}
      {(error || org.error) && (
        <p className="pd-error" role="alert">
          {error || org.error}
        </p>
      )}
      {showSetup && (
        <form className="pd-device-setup" onSubmit={save}>
          <h3>Branch defaults</h3>
          <div className="pd-form-grid">
            <label className="pd-field">
              Company
              <select
                value={scope.companyId}
                onChange={(e) => {
                  setScope({ companyId: e.target.value, divisionId: '', branchId: '' });
                  setCustomerId('');
                  setPayments({ CASH: '', MOBILE_MONEY: '', BANK_TRANSFER: '' });
                }}
              >
                <option value="">Choose a company</option>
                {org.companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="pd-field">
              Division
              <select
                value={scope.divisionId}
                onChange={(e) => setScope({ ...scope, divisionId: e.target.value, branchId: '' })}
              >
                <option value="">Choose a division</option>
                {org.divisions
                  .filter((division) => division.companyId === scope.companyId)
                  .map((division) => (
                    <option value={division.id} key={division.id}>
                      {division.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="pd-field">
              Branch
              <select
                value={scope.branchId}
                onChange={(e) => setScope({ ...scope, branchId: e.target.value })}
              >
                <option value="">Choose a branch</option>
                {org.branches
                  .filter((branch) => branch.divisionId === scope.divisionId)
                  .map((branch) => (
                    <option value={branch.id} key={branch.id}>
                      {branch.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="pd-field">
              Walk-in customer
              <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">Choose the existing customer</option>
                {customers.map((customer) => (
                  <option value={customer.id} key={customer.id}>
                    {customer.name}
                  </option>
                ))}
              </select>
            </label>
            {Object.entries(payments).map(([method, value]) => {
              const allowedTypes =
                method === 'CASH'
                  ? ['CASH_ON_HAND', 'PETTY_CASH']
                  : method === 'MOBILE_MONEY'
                    ? ['MOBILE_MONEY']
                    : ['BANK'];
              return (
                <label className="pd-field" key={method}>
                  {method === 'CASH'
                    ? 'Cash account'
                    : method === 'MOBILE_MONEY'
                      ? 'Mobile money account'
                      : 'Bank account'}
                  <select
                    value={value}
                    onChange={(e) =>
                      setPayments((current) => ({ ...current, [method]: e.target.value }))
                    }
                  >
                    <option value="">
                      {method === 'CASH' ? 'Choose an account' : 'Not enabled'}
                    </option>
                    {accounts
                      .filter((account) => allowedTypes.includes(account.accountType))
                      .map((account) => (
                        <option value={account.id} key={account.id}>
                          {account.accountName}
                        </option>
                      ))}
                  </select>
                </label>
              );
            })}
          </div>
          <p className="pd-muted">
            Mobile submissions require approval before money or stock posts.
          </p>
          <div className="pd-header-actions">
            <button type="submit" className="pd-button pd-primary" disabled={!!busy}>
              {busy === 'setup' ? 'Saving…' : 'Save defaults'}
            </button>
            <button type="button" className="pd-button" onClick={() => setShowSetup(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {invite && (
        <div className="pd-install-link">
          <div className="pd-desktop-qr">
            <InstallQrCode path={invite.path} size={158} label="Mobile POS installation QR code" />
          </div>
          <div>
            <h3>Install Itemba POS</h3>
            <p>Open this link on the phone, install the app and request access for the branch.</p>
            {invite.expiresAt && (
              <small>Link expires {new Date(invite.expiresAt).toLocaleString()}</small>
            )}
            <div className="pd-header-actions">
              <button className="pd-button" onClick={() => void copy()}>
                <Copy size={15} />
                Copy link
              </button>
              <a className="pd-button" href={invite.path}>
                <Link2 size={15} />
                Open link
              </a>
            </div>
          </div>
        </div>
      )}
      {hasPermission('mobile_pos_lite.manage') && hasPermission('pos_drafts.view') && (
        <LegacyQuarantine />
      )}
      {loading ? (
        <p role="status">Loading team and branches…</p>
      ) : (
        <>
          <h3>Configured branches</h3>
          <div className="pd-device-grid">
            {setups.map((setup) => (
              <div className="pd-device-card" key={setup.id}>
                <Smartphone size={21} aria-hidden="true" />
                <strong>
                  {setup.branch?.name ??
                    org.branches.find((branch) => branch.id === setup.branchId)?.name ??
                    'Configured branch'}
                </strong>
                <small>Approval required · {setup.enabled ? 'Enabled' : 'Disabled'}</small>
                {setup.company && (
                  <small>
                    {setup.company.name} · {setup.division?.name}
                  </small>
                )}
                {setup.generalCustomer && (
                  <small>Walk-in customer · {setup.generalCustomer.name}</small>
                )}
                <button
                  className="pd-button"
                  disabled={!!busy}
                  onClick={() => {
                    setScope({
                      companyId: setup.companyId,
                      divisionId: setup.divisionId,
                      branchId: setup.branchId,
                    });
                    setCustomerId(setup.generalCustomerId);
                    setPayments({
                      CASH: '',
                      MOBILE_MONEY: '',
                      BANK_TRANSFER: '',
                      ...Object.fromEntries(
                        (setup.paymentMappings ?? []).map((mapping) => [
                          mapping.paymentMethod,
                          mapping.cashAccountId,
                        ]),
                      ),
                    });
                    setShowSetup(true);
                  }}
                >
                  Edit branch defaults
                </button>
                <button
                  className="pd-button"
                  disabled={!!busy || !setup.enabled}
                  onClick={() => void createInvite(setup.id)}
                >
                  Create installation link
                </button>
              </div>
            ))}
            {!setups.length && (
              <p className="pd-muted">Set up a branch to create your first installation link.</p>
            )}
          </div>
          <h3>Team access</h3>
          <div className="pd-enrollments">
            {enrollments.map((row) => (
              <article className="pd-enrollment" key={row.id}>
                <h4>{row.name}</h4>
                <p>
                  {(row.approvedRole ?? row.requestedRole).toLowerCase()} ·{' '}
                  <span className="pd-status">{row.status.toLowerCase().replaceAll('_', ' ')}</span>
                </p>
                {row.status === 'PENDING' && row.requestedRole !== 'ADMIN' && (
                  <>
                    <label className="pd-field">
                      Approved role
                      <select
                        value={
                          roles[row.id] ??
                          (row.requestedRole === 'STOCKIST' ? 'STOCKIST' : 'CASHIER')
                        }
                        onChange={(e) =>
                          setRoles((current) => ({
                            ...current,
                            [row.id]: e.target.value as 'CASHIER' | 'STOCKIST',
                          }))
                        }
                      >
                        <option value="CASHIER">Cashier</option>
                        <option value="STOCKIST">Stockist</option>
                      </select>
                    </label>
                    <button
                      className="pd-button pd-primary"
                      disabled={!!busy}
                      onClick={() => void act(row, 'approve')}
                    >
                      Approve access
                    </button>
                  </>
                )}
                {row.requestedRole === 'ADMIN' && row.status === 'PENDING' && (
                  <p className="pd-notice">
                    Admin access is linked on the phone with an existing authorized OS account.
                  </p>
                )}
                {!['REJECTED', 'REVOKED'].includes(row.status) && (
                  <>
                    <label className="pd-field">
                      Reason
                      <input
                        value={reasons[row.id] ?? ''}
                        onChange={(e) =>
                          setReasons((current) => ({ ...current, [row.id]: e.target.value }))
                        }
                        placeholder="Required to reject or revoke"
                      />
                    </label>
                    <div className="pd-header-actions">
                      {row.status === 'PENDING' ? (
                        <button
                          className="pd-button pd-danger"
                          disabled={!!busy}
                          onClick={() => void act(row, 'reject')}
                        >
                          Reject request
                        </button>
                      ) : (
                        <>
                          {(row.approvedRole ?? row.requestedRole) !== 'ADMIN' && (
                            <button
                              className="pd-button"
                              disabled={!!busy}
                              onClick={() => void act(row, 'reset-pin')}
                            >
                              Reset PIN
                            </button>
                          )}
                          <button
                            className="pd-button pd-danger"
                            disabled={!!busy}
                            onClick={() => void act(row, 'revoke')}
                          >
                            Revoke access
                          </button>
                        </>
                      )}
                    </div>
                  </>
                )}
              </article>
            ))}
            {!enrollments.length && (
              <p className="pd-muted">
                Access requests appear here after a person installs the app and submits their name
                and role.
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
