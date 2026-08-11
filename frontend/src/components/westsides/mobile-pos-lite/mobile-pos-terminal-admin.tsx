'use client';

import { useEffect, useMemo, useState } from 'react';
import { Copy, Link2, Plus, QrCode, RotateCw, Smartphone, WifiOff } from 'lucide-react';
import {
  Btn,
  FormInput,
  FormSelect,
  Modal,
  PageHeader,
  PermissionDeniedState,
  showToast,
} from '@/components/ui';
import { InstallQrCode } from '@/components/westsides/mobile-pos-install/InstallQrCode';
import { backendList, backendPatch, backendPost } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';

type ScopeOption = { id: string; name: string; code?: string | null; divisionId?: string | null };
type Employee = {
  id: string;
  fullName?: string | null;
  employeeCode?: string | null;
  firstName?: string | null;
  lastName?: string | null;
};
type Customer = { id: string; name: string; customerCode?: string | null };
type CashAccount = {
  id: string;
  accountName: string;
  accountType: string;
  currency?: string | null;
};
type PaymentCode = 'CASH' | 'MOBILE_MONEY' | 'BANK_TRANSFER';
type Terminal = {
  id: string;
  code: string;
  name: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
  creditEnabled: boolean;
  offlineCashEnabled: boolean;
  /** Kaunta rollout pilot flag: 1 = classic shell, 2 = Kaunta shell. */
  uiVersion?: number;
  activatedAt?: string | null;
  lastSeenAt?: string | null;
  company: ScopeOption;
  division: ScopeOption;
  branch: ScopeOption;
  assignedUser: { id: string; name: string };
  salesperson: { fullName: string; employeeCode?: string | null };
  generalCustomer: Customer;
  paymentMethods: Array<{ paymentMethod: PaymentCode; label: string; cashAccount: CashAccount }>;
};
type Activation = {
  terminalCode: string;
  activationCode: string;
  expiresAt: string;
  activationPath: string;
};

const PAYMENT_LABELS: Record<PaymentCode, string> = {
  CASH: 'Cash',
  MOBILE_MONEY: 'Mobile Money',
  BANK_TRANSFER: 'Bank',
};

function label(item?: { name?: string | null; code?: string | null }) {
  if (!item) return '';
  return item.code ? `${item.code} - ${item.name}` : (item.name ?? '');
}

function employeeLabel(employee: Employee) {
  const name =
    employee.fullName || [employee.firstName, employee.lastName].filter(Boolean).join(' ');
  return employee.employeeCode
    ? `${name || employee.id} - ${employee.employeeCode}`
    : name || employee.id;
}

export function MobilePosTerminalAdmin() {
  const { hasPermission } = useAuth();
  const [terminals, setTerminals] = useState<Terminal[]>([]);
  const [companies, setCompanies] = useState<ScopeOption[]>([]);
  const [divisions, setDivisions] = useState<ScopeOption[]>([]);
  const [branches, setBranches] = useState<ScopeOption[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [accounts, setAccounts] = useState<Record<PaymentCode, CashAccount[]>>({
    CASH: [],
    MOBILE_MONEY: [],
    BANK_TRANSFER: [],
  });
  const [name, setName] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [divisionId, setDivisionId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [salespersonId, setSalespersonId] = useState('');
  const [generalCustomerId, setGeneralCustomerId] = useState('');
  const [paymentAccounts, setPaymentAccounts] = useState<Record<PaymentCode, string>>({
    CASH: '',
    MOBILE_MONEY: '',
    BANK_TRANSFER: '',
  });
  const [enabledPayments, setEnabledPayments] = useState<Record<PaymentCode, boolean>>({
    CASH: true,
    MOBILE_MONEY: false,
    BANK_TRANSFER: false,
  });
  const [creditEnabled, setCreditEnabled] = useState(false);
  const [offlineCashEnabled, setOfflineCashEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activation, setActivation] = useState<Activation | null>(null);

  const canManage = hasPermission('mobile_pos_lite.manage');
  const branchOptions = useMemo(
    () => branches.filter((branch) => !divisionId || branch.divisionId === divisionId),
    [branches, divisionId],
  );

  async function refreshTerminals() {
    try {
      setTerminals(await backendList<Terminal>('/mobile-pos-lite/terminals'));
    } catch (error) {
      showToast(
        'error',
        'Could not load terminals',
        error instanceof Error ? error.message : undefined,
      );
    }
  }

  useEffect(() => {
    if (!canManage) return;
    void refreshTerminals();
    backendList<ScopeOption>('/companies', { query: { limit: 200 } })
      .then(setCompanies)
      .catch(() => setCompanies([]));
  }, [canManage]);

  useEffect(() => {
    setDivisionId('');
    setBranchId('');
    setEmployees([]);
    setCustomers([]);
    setAccounts({ CASH: [], MOBILE_MONEY: [], BANK_TRANSFER: [] });
    if (!companyId) {
      setDivisions([]);
      setBranches([]);
      return;
    }
    Promise.all([
      backendList<ScopeOption>('/divisions', { query: { companyId, limit: 200 } }),
      backendList<ScopeOption>('/branches', { query: { companyId, activeOnly: true, limit: 500 } }),
    ])
      .then(([nextDivisions, nextBranches]) => {
        setDivisions(nextDivisions);
        setBranches(nextBranches);
      })
      .catch(() => {
        setDivisions([]);
        setBranches([]);
      });
  }, [companyId]);

  useEffect(() => {
    setBranchId('');
    setEmployees([]);
    setCustomers([]);
    setAccounts({ CASH: [], MOBILE_MONEY: [], BANK_TRANSFER: [] });
  }, [divisionId]);

  useEffect(() => {
    setSalespersonId('');
    setGeneralCustomerId('');
    setPaymentAccounts({ CASH: '', MOBILE_MONEY: '', BANK_TRANSFER: '' });
    if (!companyId || !divisionId || !branchId) return;
    const receiptAccounts = (paymentMethod: PaymentCode) =>
      backendList<CashAccount>('/sales-orders/receipt-accounts', {
        query: { companyId, divisionId, branchId, paymentMethod, limit: 500 },
      });
    Promise.allSettled([
      backendList<Employee>('/hr/employees', { query: { companyId, branchId, limit: 500 } }),
      backendList<Customer>('/customers', {
        query: { companyId, branchId, status: 'ACTIVE', limit: 500 },
      }),
      receiptAccounts('CASH'),
      receiptAccounts('MOBILE_MONEY'),
      receiptAccounts('BANK_TRANSFER'),
    ]).then(([employeeResult, customerResult, cashResult, mobileResult, bankResult]) => {
      setEmployees(employeeResult.status === 'fulfilled' ? employeeResult.value : []);
      setCustomers(customerResult.status === 'fulfilled' ? customerResult.value : []);
      setAccounts({
        CASH: cashResult.status === 'fulfilled' ? cashResult.value : [],
        MOBILE_MONEY: mobileResult.status === 'fulfilled' ? mobileResult.value : [],
        BANK_TRANSFER: bankResult.status === 'fulfilled' ? bankResult.value : [],
      });
    });
  }, [branchId, companyId, divisionId]);

  function resetForm() {
    setName('');
    setCompanyId('');
    setDivisionId('');
    setBranchId('');
    setSalespersonId('');
    setGeneralCustomerId('');
    setPaymentAccounts({ CASH: '', MOBILE_MONEY: '', BANK_TRANSFER: '' });
    setEnabledPayments({ CASH: true, MOBILE_MONEY: false, BANK_TRANSFER: false });
    setCreditEnabled(false);
    setOfflineCashEnabled(false);
  }

  async function createTerminal(event: React.FormEvent) {
    event.preventDefault();
    const paymentMethods = (Object.keys(enabledPayments) as PaymentCode[])
      .filter((code) => enabledPayments[code])
      .map((paymentMethod) => ({ paymentMethod, cashAccountId: paymentAccounts[paymentMethod] }))
      .filter((payment) => payment.cashAccountId);
    if (
      !name ||
      !companyId ||
      !divisionId ||
      !branchId ||
      !salespersonId ||
      !generalCustomerId ||
      paymentMethods.length !== Object.values(enabledPayments).filter(Boolean).length
    ) {
      showToast('error', 'Complete the terminal setup');
      return;
    }
    setSaving(true);
    try {
      const result = await backendPost<{ terminal: Terminal; activation: Activation }>(
        '/mobile-pos-lite/terminals',
        {
          name,
          companyId,
          divisionId,
          branchId,
          salespersonId,
          generalCustomerId,
          creditEnabled,
          offlineCashEnabled,
          paymentMethods,
        },
      );
      setActivation(result.activation);
      resetForm();
      await refreshTerminals();
      showToast('success', 'Mobile POS terminal created');
    } catch (error) {
      showToast(
        'error',
        'Could not create terminal',
        error instanceof Error ? error.message : undefined,
      );
    } finally {
      setSaving(false);
    }
  }

  async function issueActivation(id: string) {
    try {
      const next = await backendPost<Activation>(`/mobile-pos-lite/terminals/${id}/activation`);
      setActivation(next);
      await refreshTerminals();
    } catch (error) {
      showToast(
        'error',
        'Could not issue setup code',
        error instanceof Error ? error.message : undefined,
      );
    }
  }

  async function changeStatus(id: string, status: Terminal['status']) {
    try {
      await backendPatch(`/mobile-pos-lite/terminals/${id}/status`, { status });
      await refreshTerminals();
      showToast('success', `Terminal ${status.toLowerCase()}`);
    } catch (error) {
      showToast(
        'error',
        'Could not update terminal',
        error instanceof Error ? error.message : undefined,
      );
    }
  }

  async function setPilotUi(id: string, enable: boolean) {
    try {
      await backendPatch(`/mobile-pos-lite/terminals/${id}`, { uiVersion: enable ? 2 : 1 });
      await refreshTerminals();
      showToast(
        'success',
        enable ? 'Kaunta pilot enabled' : 'Kaunta pilot disabled',
        'The phone picks it up on its next session refresh.',
      );
    } catch (error) {
      showToast(
        'error',
        'Could not update the pilot flag',
        error instanceof Error ? error.message : undefined,
      );
    }
  }

  async function copyActivation() {
    if (!activation) return;
    try {
      await navigator.clipboard.writeText(
        new URL(activation.activationPath, window.location.origin).toString(),
      );
      showToast('success', 'Setup link copied');
    } catch {
      showToast('error', 'Could not copy setup link');
    }
  }

  if (!canManage)
    return (
      <PermissionDeniedState description="Mobile POS terminal setup is limited to Group Admins." />
    );

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Mobile POS Lite"
        subtitle="Set up one locked sales terminal for each sales rep and branch."
      />

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.75fr)]">
        <form
          onSubmit={createTerminal}
          className="border p-5"
          style={{
            background: 'var(--aurora-card)',
            borderColor: 'var(--aurora-border)',
            borderRadius: '8px',
          }}
        >
          <div className="flex items-center gap-3">
            <span
              className="flex h-10 w-10 items-center justify-center rounded-lg"
              style={{ background: 'var(--aurora-primary-subtle)', color: 'var(--aurora-primary)' }}
            >
              <Smartphone size={22} />
            </span>
            <div>
              <h2 className="text-base font-bold" style={{ color: 'var(--aurora-text)' }}>
                New terminal
              </h2>
              <p className="text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>
                The branch and sales rep are locked on the device.
              </p>
            </div>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <FormInput
              label="Terminal name"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Front counter phone"
              className="md:col-span-2"
            />
            <FormSelect
              label="Company"
              required
              value={companyId}
              onChange={(event) => setCompanyId(event.target.value)}
              placeholder="Select company"
            >
              <>
                {companies.map((item) => (
                  <option key={item.id} value={item.id}>
                    {label(item)}
                  </option>
                ))}
              </>
            </FormSelect>
            <FormSelect
              label="Division"
              required
              value={divisionId}
              disabled={!companyId}
              onChange={(event) => setDivisionId(event.target.value)}
              placeholder="Select division"
            >
              <>
                {divisions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {label(item)}
                  </option>
                ))}
              </>
            </FormSelect>
            <FormSelect
              label="Branch"
              required
              value={branchId}
              disabled={!divisionId}
              onChange={(event) => setBranchId(event.target.value)}
              placeholder="Select branch"
            >
              <>
                {branchOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {label(item)}
                  </option>
                ))}
              </>
            </FormSelect>
            <FormSelect
              label="Sales rep"
              required
              value={salespersonId}
              disabled={!branchId}
              onChange={(event) => setSalespersonId(event.target.value)}
              placeholder="Select sales rep"
            >
              <>
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employeeLabel(employee)}
                  </option>
                ))}
              </>
            </FormSelect>
            <FormSelect
              label="General Customer"
              required
              value={generalCustomerId}
              disabled={!branchId}
              onChange={(event) => setGeneralCustomerId(event.target.value)}
              placeholder="Select general customer"
              className="md:col-span-2"
            >
              <>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.customerCode
                      ? `${customer.name} - ${customer.customerCode}`
                      : customer.name}
                  </option>
                ))}
              </>
            </FormSelect>
          </div>

          <fieldset className="mt-6 border-t pt-5" style={{ borderColor: 'var(--aurora-border)' }}>
            <legend className="text-sm font-bold" style={{ color: 'var(--aurora-text)' }}>
              Payments
            </legend>
            <div className="mt-3 space-y-3">
              {(Object.keys(PAYMENT_LABELS) as PaymentCode[]).map((code) => (
                <div
                  key={code}
                  className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[auto_minmax(0,1fr)]"
                  style={{
                    borderColor: 'var(--aurora-border)',
                    background: 'var(--aurora-bg-subtle)',
                  }}
                >
                  <label
                    className="flex min-h-10 items-center gap-2 text-sm font-semibold"
                    style={{ color: 'var(--aurora-text)' }}
                  >
                    <input
                      type="checkbox"
                      checked={enabledPayments[code]}
                      disabled={code === 'CASH'}
                      onChange={(event) =>
                        setEnabledPayments((current) => ({
                          ...current,
                          [code]: event.target.checked,
                        }))
                      }
                    />
                    {PAYMENT_LABELS[code]}
                  </label>
                  <select
                    disabled={!enabledPayments[code] || !branchId}
                    value={paymentAccounts[code]}
                    onChange={(event) =>
                      setPaymentAccounts((current) => ({ ...current, [code]: event.target.value }))
                    }
                    className="aurora-input min-h-10 rounded-lg px-3 text-sm"
                  >
                    <option value="">Select receipt account</option>
                    {accounts[code].map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.accountName}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </fieldset>

          <div className="mt-5 flex flex-wrap gap-5">
            <label
              className="flex items-center gap-2 text-sm font-semibold"
              style={{ color: 'var(--aurora-text)' }}
            >
              <input
                type="checkbox"
                checked={creditEnabled}
                onChange={(event) => setCreditEnabled(event.target.checked)}
              />
              Allow credit sales
            </label>
            <label
              className="flex items-center gap-2 text-sm font-semibold"
              style={{ color: 'var(--aurora-text)' }}
            >
              <input
                type="checkbox"
                checked={offlineCashEnabled}
                onChange={(event) => setOfflineCashEnabled(event.target.checked)}
              />
              Allow cash retry while offline
            </label>
          </div>
          <div className="mt-6">
            <Btn type="submit" size="lg" loading={saving} icon={<Plus size={18} />}>
              Create terminal and setup code
            </Btn>
          </div>
        </form>

        <section
          className="border p-5"
          style={{
            background: 'var(--aurora-card)',
            borderColor: 'var(--aurora-border)',
            borderRadius: '8px',
          }}
        >
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold" style={{ color: 'var(--aurora-text)' }}>
                Active terminals
              </h2>
              <p className="text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>
                {terminals.length} configured
              </p>
            </div>
            <button
              type="button"
              onClick={() => void refreshTerminals()}
              className="flex h-9 w-9 items-center justify-center rounded-lg"
              style={{ color: 'var(--aurora-primary-text)' }}
              title="Refresh terminals"
              aria-label="Refresh terminals"
            >
              <RotateCw size={18} />
            </button>
          </div>
          <div className="mt-4 space-y-3">
            {terminals.length === 0 && (
              <p
                className="rounded-lg border px-4 py-8 text-center text-sm"
                style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text-muted)' }}
              >
                No terminals configured.
              </p>
            )}
            {terminals.map((terminal) => (
              <div
                key={terminal.id}
                className="border p-4"
                style={{ borderColor: 'var(--aurora-border)', borderRadius: '8px' }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-bold" style={{ color: 'var(--aurora-text)' }}>
                      {terminal.name}
                    </p>
                    <p className="mt-1 text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>
                      {terminal.branch.name} · {terminal.assignedUser.name}
                    </p>
                    <p
                      className="mt-1 font-mono text-xs"
                      style={{ color: 'var(--aurora-text-muted)' }}
                    >
                      {terminal.code}
                    </p>
                  </div>
                  <span
                    className="rounded-md px-2 py-1 text-xs font-bold"
                    style={{
                      background:
                        terminal.status === 'ACTIVE'
                          ? 'var(--aurora-success-subtle)'
                          : 'var(--aurora-warning-subtle)',
                      color:
                        terminal.status === 'ACTIVE'
                          ? 'var(--aurora-success-text)'
                          : 'var(--aurora-warning-text)',
                    }}
                  >
                    {terminal.status}
                  </span>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {terminal.status === 'ACTIVE' && (
                    <Btn
                      type="button"
                      size="sm"
                      variant="secondary"
                      icon={<QrCode size={15} />}
                      onClick={() => void issueActivation(terminal.id)}
                    >
                      Setup code
                    </Btn>
                  )}
                  {terminal.status === 'ACTIVE' && (
                    <Btn
                      type="button"
                      size="sm"
                      variant="warning"
                      icon={<WifiOff size={15} />}
                      onClick={() => void changeStatus(terminal.id, 'SUSPENDED')}
                    >
                      Suspend
                    </Btn>
                  )}
                  {terminal.status === 'SUSPENDED' && (
                    <Btn
                      type="button"
                      size="sm"
                      variant="success"
                      onClick={() => void changeStatus(terminal.id, 'ACTIVE')}
                    >
                      Activate
                    </Btn>
                  )}
                  {terminal.status !== 'REVOKED' && (
                    <Btn
                      type="button"
                      size="sm"
                      variant={(terminal.uiVersion ?? 1) >= 2 ? 'warning' : 'secondary'}
                      onClick={() => void setPilotUi(terminal.id, (terminal.uiVersion ?? 1) < 2)}
                      title="Kaunta reform pilot: run the new POS shell on this terminal only"
                    >
                      {(terminal.uiVersion ?? 1) >= 2 ? 'Kaunta pilot: ON' : 'Kaunta pilot: OFF'}
                    </Btn>
                  )}
                  {terminal.status !== 'REVOKED' && (
                    <Btn
                      type="button"
                      size="sm"
                      variant="danger"
                      onClick={() => void changeStatus(terminal.id, 'REVOKED')}
                    >
                      Revoke
                    </Btn>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      </section>

      <Modal
        open={Boolean(activation)}
        onClose={() => setActivation(null)}
        title="Connect the sales rep phone"
        subtitle={
          activation ? `Expires ${new Date(activation.expiresAt).toLocaleString()}` : undefined
        }
        size="sm"
        footer={
          <Btn type="button" onClick={() => setActivation(null)}>
            Done
          </Btn>
        }
      >
        {activation && (
          <div className="space-y-5">
            <div className="flex justify-center">
              <InstallQrCode
                path={activation.activationPath}
                label="Mobile POS Lite setup code"
                size={184}
              />
            </div>
            <p className="text-center text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>
              Scan this code on the assigned sales rep phone, then sign in and connect the device.
            </p>
            <div
              className="rounded-lg border p-3"
              style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}
            >
              <p
                className="text-xs font-semibold"
                style={{ color: 'var(--aurora-text-secondary)' }}
              >
                Terminal code
              </p>
              <p
                className="mt-1 font-mono text-sm font-bold"
                style={{ color: 'var(--aurora-text)' }}
              >
                {activation.terminalCode}
              </p>
            </div>
            <Btn
              type="button"
              variant="secondary"
              className="w-full"
              icon={<Copy size={16} />}
              onClick={() => void copyActivation()}
            >
              Copy setup link
            </Btn>
            <a
              href={activation.activationPath}
              className="flex min-h-11 items-center justify-center gap-2 text-sm font-semibold"
              style={{ color: 'var(--aurora-primary-text)' }}
            >
              <Link2 size={16} />
              Open setup page
            </a>
          </div>
        )}
      </Modal>
    </div>
  );
}
