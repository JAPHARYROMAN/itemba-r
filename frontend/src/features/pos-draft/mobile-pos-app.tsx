'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { ClipboardCheck, LogOut, Package, Plus, RefreshCw, Settings2, WifiOff } from 'lucide-react';
import { ApiError, backendGet, backendPatch, backendPost } from '@/lib/api-client';
import { AuthProvider } from '@/contexts/auth-context';
import { PrinterPanel } from '@/features/pos/ui/PrinterPanel';
import { ReceiptPrint } from '@/features/pos/ui/ReceiptPrint';
import { usePosPrinter } from '@/features/pos/hardware/use-pos-printer';
import { usePosLang } from '@/components/westsides/mobile-pos-lite/pos-i18n';
import {
  mobileApi,
  isInstalled,
  readDevice,
  saveDevice,
  readPendingEnrollment,
  readAdminInstallation,
  type DeviceIdentity,
} from './mobile-api';
import {
  cacheMobileSession,
  capturePartition,
  clearCachedSession,
  getCachedSession,
  getCaptures,
  saveCapture,
  updateCapture,
  type LocalCapture,
} from './capture-store';
import { reconcileCapture, SessionChangedError } from './mobile-outbox';
import { DraftCapture } from './draft-capture';
import { DraftInspector } from './draft-inspector';
import { PosDevices } from './pos-devices';
import { type DraftScopes } from './use-draft-scopes';
import type { MobileProfile } from './mobile-types';
import type {
  Draft,
  DraftAction,
  DraftContext,
  DraftOutcome,
  DraftPage,
  LocalAcknowledgement,
  Submission,
  PostedReceipt,
} from './types';
import { KIND_LABELS, STATUS_LABELS, money, submissionEnvelope } from './types';
import './pos-draft.css';
import '@/features/pos/ui/pos-app.css';

type AdminUser = { id: string; fullName?: string; permissions: string[] };
type MobileView = 'capture' | 'requests' | 'prepare' | 'stock' | 'devices';
export function MobilePosApp() {
  const router = useRouter();
  const [device, setDevice] = useState<DeviceIdentity | null>(null),
    [profile, setProfile] = useState<MobileProfile | null>(null),
    [admin, setAdmin] = useState<AdminUser | null>(null);
  const [context, setContext] = useState<DraftContext | null>(null),
    [result, setResult] = useState<DraftPage | null>(null),
    [local, setLocal] = useState<LocalCapture[]>([]);
  const [requestPage, setRequestPage] = useState(1),
    [overview, setOverview] = useState<DraftPage['summary'] | null>(null);
  const [scope, setScope] = useState({ companyId: '', branchId: '' });
  const [companies, setCompanies] = useState<Array<{ id: string; name: string }>>([]),
    [branches, setBranches] = useState<DraftScopes['branches']>([]);
  const [view, setView] = useState<MobileView>('capture'),
    [selected, setSelected] = useState<Draft | null>(null),
    [correcting, setCorrecting] = useState<Draft | undefined>();
  const [loading, setLoading] = useState(true),
    [offline, setOffline] = useState(false),
    [installed, setInstalled] = useState(false),
    [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [revision, setRevision] = useState(0),
    [captureRevision, setCaptureRevision] = useState(0);
  const [printerOpen, setPrinterOpen] = useState(false);
  const [adminMode, setAdminMode] = useState(false);
  const { t } = usePosLang();
  const printer = usePosPrinter(t);
  const [printJob, setPrintJob] = useState<
    import('@/features/pos/hardware/receipt').ReceiptModel | null
  >(null);
  const partition = useRef<string | null>(null);
  const generation = useRef(0);
  const synchronizing = useRef(false);
  const requestsSequence = useRef(0);
  const persona = useRef<string | null>(null);
  useLayoutEffect(() => {
    persona.current = profile?.user.id ?? admin?.id ?? null;
  }, [profile?.user.id, admin?.id]);
  const role = profile?.role ?? 'ADMIN';
  const phoneTransport = {
    outcome: (requestId: string) => mobileApi<DraftOutcome>(`/pos-drafts/outcome/${requestId}`),
    submit: (body: Submission) =>
      mobileApi<Draft>('/pos-drafts', { method: 'POST', body: submissionEnvelope(body) }),
  };
  useEffect(() => {
    setInstalled(isInstalled());
    setDevice(readDevice());
    const pending = isInstalled() ? readPendingEnrollment() : null;
    if (pending && !readDevice()) {
      router.replace(`/mobile-pos/join/${encodeURIComponent(pending.claimToken)}`);
      return;
    }
    if ('serviceWorker' in navigator)
      void navigator.serviceWorker.register('/mobile-pos-sw.js').catch(() => undefined);
    const query = new URLSearchParams(window.location.search);
    const adminInstall = isInstalled() && !readDevice() ? readAdminInstallation() : null;
    setAdminMode(query.get('admin') === '1' || !!adminInstall);
    setScope({
      companyId: query.get('companyId') ?? adminInstall?.companyId ?? '',
      branchId: query.get('branchId') ?? adminInstall?.branchId ?? '',
    });
  }, [router]);
  useEffect(() => {
    const epoch = ++generation.current;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void (async () => {
      const bound = readDevice();
      setDevice(bound);
      const ownPartition = bound && !adminMode ? await capturePartition(bound) : null;
      if (epoch !== generation.current) return;
      partition.current = ownPartition;
      try {
        if (bound && !adminMode) {
          const user = await mobileApi<MobileProfile>('/mobile-pos-auth/me', {
            signal: controller.signal,
            deviceSecret: bound.deviceSecret,
          });
          if (epoch !== generation.current) return;
          if (user.enrollmentId !== bound.enrollmentId || user.user.id !== bound.ownerId)
            throw new ApiError(
              'This device belongs to another operator. Contact your administrator.',
              403,
              null,
            );
          const next = { ...bound, credentialVersion: user.operator.credentialVersion };
          saveDevice(next);
          setDevice(next);
          const nextPartition = await capturePartition(next);
          if (epoch !== generation.current) return;
          partition.current = nextPartition;
          const branch = await mobileApi<DraftContext>('/pos-drafts/context', {
            signal: controller.signal,
          });
          if (epoch !== generation.current) return;
          setProfile(user);
          setAdmin(null);
          setContext(branch);
          setOffline(false);
          await cacheMobileSession(partition.current, user, branch);
          const captures = await getCaptures(partition.current);
          if (epoch === generation.current) setLocal(captures);
          return;
        }
        throw new ApiError('Enter your device PIN to continue.', 401, null);
      } catch (e) {
        if (controller.signal.aborted || epoch !== generation.current) return;
        const connection = !(e instanceof ApiError) || e.status >= 500;
        if (connection && ownPartition) {
          const saved = await getCachedSession(ownPartition);
          if (saved?.authenticated && epoch === generation.current) {
            setProfile(saved.profile);
            setContext(saved.context);
            setAdmin(null);
            setOffline(true);
            const captures = await getCaptures(ownPartition);
            if (epoch === generation.current) setLocal(captures);
            return;
          }
        }
        if (!connection && ownPartition) await clearCachedSession(ownPartition);
        if (epoch !== generation.current) return;
        setProfile(null);
        setAdmin(null);
        setContext(null);
        setLocal([]);
        setResult(null);
        setOverview(null);
        setSelected(null);
        setOffline(false);
        if (!adminMode) return;
        try {
          const response = await fetch('/api/auth/me', {
            signal: controller.signal,
            cache: 'no-store',
          });
          if (!response.ok) return;
          const json = await response.json();
          const user = (json.data ?? json.user ?? json) as AdminUser;
          if (epoch !== generation.current) return;
          if (
            user.permissions?.some((p) =>
              [
                'pos_drafts.approve',
                'pos_drafts.direct_post',
                'mobile_pos_onboarding.manage',
              ].includes(p),
            )
          ) {
            setAdmin(user);
            const scopes = await backendGet<DraftScopes>('/pos-drafts/scopes', {
              signal: controller.signal,
            });
            if (!controller.signal.aborted) {
              setCompanies(scopes.companies);
              setBranches(scopes.branches);
            }
          }
        } catch {
          setError('Could not open the OS admin session. Sign in with your authorized account.');
        }
      }
    })()
      .catch((e) => {
        if (!controller.signal.aborted && epoch === generation.current)
          setError(e instanceof Error ? e.message : 'Could not open this device.');
      })
      .finally(() => {
        if (!controller.signal.aborted && epoch === generation.current) setLoading(false);
      });
    const invalidate = () => {
      generation.current++;
    };
    return () => {
      controller.abort();
      invalidate();
    };
  }, [revision, adminMode]);
  useEffect(() => {
    if (!admin) return;
    const controller = new AbortController();
    setContext(null);
    if (scope.companyId && scope.branchId)
      void backendGet<DraftContext>('/pos-drafts/context', {
        query: scope,
        signal: controller.signal,
      })
        .then((value) => {
          if (!controller.signal.aborted) setContext(value);
        })
        .catch((e) => {
          if (!controller.signal.aborted)
            setError(e instanceof Error ? e.message : 'Could not load branch records.');
        });
    return () => controller.abort();
  }, [admin, scope]);
  const refreshRequests = useCallback(async () => {
    if ((!profile && !admin) || offline) return;
    const epoch = generation.current;
    const owner = persona.current;
    const sequence = ++requestsSequence.current;
    try {
      const query = {
        ...(profile ? {} : scope),
        page: requestPage,
        limit: 25,
        ...(view === 'prepare' ? { status: 'AWAITING_STOCKIST' } : {}),
      };
      const fetchPage = (params: typeof query | { page: number; limit: number }) =>
        profile
          ? mobileApi<DraftPage>('/pos-drafts', { query: params })
          : backendGet<DraftPage>('/pos-drafts', { query: { ...scope, ...params } });
      const [value, summary] = await Promise.all([
        fetchPage(query),
        view === 'prepare' ? fetchPage({ page: 1, limit: 1 }) : Promise.resolve(null),
      ]);
      if (
        epoch === generation.current &&
        owner === persona.current &&
        sequence === requestsSequence.current
      ) {
        setResult(value);
        setOverview((summary ?? value).summary);
      }
    } catch (e) {
      if (
        epoch === generation.current &&
        owner === persona.current &&
        sequence === requestsSequence.current
      )
        setError(e instanceof Error ? e.message : 'Could not load requests.');
    }
  }, [profile, admin, offline, scope, requestPage, view]);
  useEffect(() => {
    void refreshRequests();
  }, [refreshRequests]);
  async function sync(manual = false, only?: LocalCapture) {
    if (synchronizing.current || !profile || !partition.current || offline) return;
    synchronizing.current = true;
    setBusy(true);
    setError('');
    const owner = partition.current;
    const epoch = generation.current;
    try {
      const rows = only
        ? [only]
        : (await getCaptures(owner)).filter(
            (row) => row.state === 'LOCAL' || (manual && row.state === 'ATTENTION'),
          );
      for (const row of rows) {
        if (partition.current !== owner || epoch !== generation.current) return;
        await reconcileCapture(
          row,
          phoneTransport,
          updateCapture,
          () => partition.current === owner && epoch === generation.current,
        );
      }
      if (partition.current === owner && epoch === generation.current) {
        const captures = await getCaptures(owner);
        if (partition.current !== owner || epoch !== generation.current) return;
        setLocal(captures);
        await refreshRequests();
        if (manual) setNotice('Device requests checked. Posted status comes from the server.');
      }
    } catch (e) {
      if (partition.current !== owner || epoch !== generation.current) return;
      setError(e instanceof Error ? e.message : 'Could not check pending requests.');
      const captures = await getCaptures(owner);
      if (partition.current === owner && epoch === generation.current) setLocal(captures);
    } finally {
      synchronizing.current = false;
      if (epoch === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    const online = () => setRevision((v) => v + 1);
    const lost = () => setOffline(true);
    const changedDevice = (event: StorageEvent) => {
      if (event.key !== 'itemba.pos.device.v2') return;
      generation.current++;
      partition.current = null;
      persona.current = null;
      setProfile(null);
      setAdmin(null);
      setContext(null);
      setLocal([]);
      setResult(null);
      setOverview(null);
      setRequestPage(1);
      setSelected(null);
      setCorrecting(undefined);
      setPrintJob(null);
      setRevision((value) => value + 1);
    };
    window.addEventListener('online', online);
    window.addEventListener('offline', lost);
    window.addEventListener('storage', changedDevice);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', lost);
      window.removeEventListener('storage', changedDevice);
    };
  }, []);
  async function login(event: React.FormEvent) {
    event.preventDefault();
    if (!device || !isInstalled()) {
      setError('Open the installed POS app on the approved device.');
      return;
    }
    if (!/^\d{6}$/.test(pin)) {
      setError('Enter your six-digit PIN.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const user = await mobileApi<MobileProfile>('/mobile-pos-auth/login', {
        method: 'POST',
        body: { enrollmentId: device.enrollmentId, deviceSecret: device.deviceSecret, pin },
        public: true,
      });
      if (user.user.id !== device.ownerId)
        throw new Error('This sign-in does not match the approved device.');
      saveDevice({ ...device, credentialVersion: user.operator.credentialVersion });
      setPin('');
      setRevision((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    setBusy(true);
    setError('');
    try {
      if (profile) {
        const previousPartition = partition.current;
        generation.current++;
        persona.current = null;
        partition.current = null;
        setProfile(null);
        setContext(null);
        setLocal([]);
        setResult(null);
        setOverview(null);
        setRequestPage(1);
        setSelected(null);
        setCorrecting(undefined);
        setPrintJob(null);
        setNotice('');
        if (previousPartition) await clearCachedSession(previousPartition);
        await mobileApi('/mobile-pos-auth/logout', { method: 'POST', body: {} });
        setProfile(null);
        setContext(null);
        setLocal([]);
        setSelected(null);
        setNotice('Signed out. Saved captures remain on this approved device.');
      } else router.push('/desktop');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connect before signing out.');
    } finally {
      setBusy(false);
    }
  }
  async function send(body: Submission, initial?: Draft): Promise<Draft | LocalAcknowledgement> {
    const epoch = generation.current;
    const operator = persona.current;
    const guard = () => {
      if (epoch !== generation.current || operator !== persona.current || !operator)
        throw new SessionChangedError();
    };
    guard();
    if (initial) {
      if (offline) throw new Error('Reconnect to correct a submitted request.');
      const updated = profile
        ? await mobileApi<Draft>(`/pos-drafts/${initial.id}/correct`, {
            method: 'PATCH',
            body: { ...submissionEnvelope(body), revision: initial.revision },
          })
        : await backendPatch<Draft>(`/pos-drafts/${initial.id}/correct`, {
            ...submissionEnvelope(body),
            revision: initial.revision,
          });
      guard();
      return updated;
    }
    if (admin) {
      const draft = await backendPost<Draft>('/pos-drafts', submissionEnvelope(body));
      guard();
      return draft;
    }
    if (!partition.current || !profile) throw new Error('Sign in on this device before capturing.');
    const owner = partition.current;
    const existing = (await getCaptures(owner)).find(
      (capture) => capture.requestId === body.requestId,
    );
    guard();
    if (
      existing &&
      JSON.stringify(submissionEnvelope(existing.submission)) !==
        JSON.stringify(submissionEnvelope(body))
    ) {
      if (offline)
        throw new Error(
          'The earlier attempt needs an online status check before its details can change.',
        );
      const outcome = await phoneTransport.outcome(body.requestId);
      guard();
      if (outcome.state !== 'not_found') {
        if (outcome.draft) {
          await updateCapture({ ...existing, state: 'SUBMITTED', draft: outcome.draft });
          throw new Error(
            'The earlier request is already submitted. Open it in Requests to review or correct it.',
          );
        }
        throw new Error('Check the earlier request status before editing.');
      }
    }
    const capture = await saveCapture(owner, body);
    guard();
    if (offline) {
      const captures = await getCaptures(owner);
      guard();
      setLocal(captures);
      return { ...body, local: true, state: 'LOCAL' };
    }
    try {
      const draft = await reconcileCapture(
        capture,
        phoneTransport,
        updateCapture,
        () => epoch === generation.current && partition.current === owner,
      );
      const captures = await getCaptures(owner);
      guard();
      setLocal(captures);
      return draft;
    } catch (e) {
      if (epoch === generation.current && partition.current === owner) {
        const captures = await getCaptures(owner);
        guard();
        setLocal(captures);
      }
      throw e;
    }
  }
  async function open(draft: Draft) {
    const epoch = generation.current;
    const owner = persona.current;
    setError('');
    setView('requests');
    if (offline) {
      setSelected(draft);
      return;
    }
    try {
      const detail = profile
        ? await mobileApi<Draft>(`/pos-drafts/${draft.id}`)
        : await backendGet<Draft>(`/pos-drafts/${draft.id}`);
      if (epoch === generation.current && owner === persona.current) setSelected(detail);
    } catch (e) {
      if (epoch === generation.current && owner === persona.current)
        setError(e instanceof Error ? e.message : 'Could not open this request.');
    }
  }
  async function decide(
    id: string,
    action: Exclude<DraftAction, 'correct'>,
    body: {
      revision: number;
      reason?: string;
      duplicateReason?: string;
      reviewedCandidateIds?: string[];
      fundsReturned?: boolean;
      reference?: string;
    },
  ) {
    if (offline) throw new Error('Reconnect to review or prepare a request.');
    const epoch = generation.current;
    const owner = persona.current;
    const updated = profile
      ? await mobileApi<Draft>(`/pos-drafts/${id}/${action}`, { method: 'POST', body })
      : await backendPost<Draft>(`/pos-drafts/${id}/${action}`, body);
    if (epoch !== generation.current || owner !== persona.current) throw new SessionChangedError();
    return updated;
  }
  async function postedReceipt(draft: Draft) {
    if (offline) throw new Error('Reconnect to load the final posted receipt.');
    const epoch = generation.current;
    const receipt = profile
      ? await mobileApi<PostedReceipt>(`/pos-drafts/${draft.id}/receipt`)
      : await backendGet<PostedReceipt>(`/pos-drafts/${draft.id}/receipt`);
    if (epoch !== generation.current) throw new SessionChangedError();
    setPrintJob({
      company: receipt.companyName,
      branch: receipt.branchName,
      terminal: profile?.terminalCode ?? '',
      rep: profile?.operator.name ?? admin?.fullName ?? '',
      issuedAt: new Date(draft.postedAt ?? draft.createdAt),
      orderNumber: receipt.receiptNumber,
      held: false,
      lines: receipt.lines.map((line) => ({
        name: line.name,
        quantity: Number(line.quantity),
        unitPrice: Number(line.unitPrice),
        total: Number(line.lineTotal),
      })),
      total: Number(receipt.totalAmount),
      paymentLabel: receipt.paymentMethod.toLowerCase().replaceAll('_', ' '),
      payments: receipt.payments.map((payment) => ({ ...payment, amount: Number(payment.amount) })),
      outstanding: Number(receipt.outstandingAmount),
      received: Number(receipt.paidAmount),
      change: null,
      customer: receipt.customerName,
    });
  }
  const serverRequests = result?.data ?? [];
  const displayed = serverRequests;
  const unsent = local.filter((row) => row.state !== 'SUBMITTED');
  const pendingMoney =
    Number(overview?.pendingMoney ?? 0) +
    unsent.reduce(
      (sum, row) =>
        sum +
        (row.submission.kind === 'COLLECTION'
          ? Number(row.submission.payload.amount ?? 0)
          : row.submission.kind === 'SALE' && row.submission.payload.paymentMethod !== 'CREDIT'
            ? Number(row.submission.payload.expectedTotal ?? 0)
            : 0),
      0,
    );
  return (
    <main className="pd-mobile">
      <header className="pd-mobile-top">
        <div className="pd-mobile-brand">
          <Image src="/brand/itemba-group-logo.png" alt="Itemba Group" width={32} height={32} />
          <span>
            Itemba <b>POS</b>
          </span>
        </div>
        {(profile || admin) && (
          <button
            className="pd-icon-button"
            onClick={() => void logout()}
            disabled={busy}
            aria-label={admin ? 'Open OS workspace' : 'Sign out'}
          >
            <LogOut size={19} />
          </button>
        )}
      </header>
      {loading ? (
        <div className="pd-empty" role="status">
          Opening your workspace…
        </div>
      ) : !profile && !admin ? (
        <section className="pd-pin-card">
          <span className="pd-eyebrow">YOUR APPROVED DEVICE</span>
          <h1>Welcome back.</h1>
          {device ? (
            <>
              <p>Enter your device PIN to open the POS.</p>
              <form onSubmit={login}>
                <label className="pd-field">
                  Six-digit PIN
                  <input
                    type="password"
                    inputMode="numeric"
                    autoComplete="current-password"
                    value={pin}
                    maxLength={6}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                  />
                </label>
                <button
                  className="pd-button pd-primary"
                  type="submit"
                  disabled={busy || !installed}
                >
                  {busy ? 'Signing in…' : 'Open POS'}
                </button>
              </form>
              {!installed && (
                <p className="pd-notice">Open Itemba POS from its home-screen icon to sign in.</p>
              )}
              <p className="pd-muted">
                Forgot your PIN? Ask the administrator to issue a reset link for this device.
              </p>
            </>
          ) : (
            <>
              <p>
                Get your branch installation link from the administrator. Install the app, request
                access and set your device PIN.
              </p>
            </>
          )}
          {!adminMode && (
            <button
              className="pd-button"
              type="button"
              onClick={() => {
                generation.current++;
                partition.current = null;
                persona.current = null;
                setLocal([]);
                setSelected(null);
                setResult(null);
                setOverview(null);
                setAdminMode(true);
              }}
            >
              Use an authorized OS admin account
            </button>
          )}
          {adminMode && (
            <>
              <a className="pd-button" href="/login?from=%2Fmobile-pos%3Fadmin%3D1">
                Admin OS sign-in
              </a>
              <button
                className="pd-button"
                type="button"
                onClick={() => {
                  generation.current++;
                  setAdminMode(false);
                }}
              >
                Use device PIN
              </button>
            </>
          )}
        </section>
      ) : (
        <>
          <div className="pd-mobile-greeting">
            <div>
              <span className="pd-eyebrow">{role.toLowerCase()} WORKSPACE</span>
              <h1>{profile?.operator.name ?? admin?.fullName ?? 'Your workspace'}</h1>
              <p>
                {profile
                  ? `${profile.company.name} · ${profile.branch.name}`
                  : 'Choose your authorized branch below.'}
              </p>
            </div>
            <button
              className="pd-icon-button"
              onClick={() => setPrinterOpen(true)}
              aria-label="Printer and device settings"
            >
              <Settings2 size={20} />
            </button>
          </div>
          {offline && (
            <p className="pd-notice" role="status">
              <WifiOff size={17} />
              Offline · capture on this device only. Approval, dispatch and posting require a
              connection.
            </p>
          )}
          {admin && (
            <div className="pd-form-grid">
              <label className="pd-field">
                Company
                <select
                  value={scope.companyId}
                  onChange={(e) => {
                    setScope({ companyId: e.target.value, branchId: '' });
                    setRequestPage(1);
                  }}
                >
                  <option value="">Choose a company</option>
                  {companies.map((company) => (
                    <option value={company.id} key={company.id}>
                      {company.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="pd-field">
                Branch
                <select
                  value={scope.branchId}
                  onChange={(e) => {
                    setScope({ ...scope, branchId: e.target.value });
                    setRequestPage(1);
                  }}
                >
                  <option value="">Choose a branch</option>
                  {branches
                    .filter((branch) => branch.companyId === scope.companyId)
                    .map((branch) => (
                      <option value={branch.id} key={branch.id}>
                        {branch.name}
                      </option>
                    ))}
                </select>
              </label>
            </div>
          )}
          <div className="pd-mobile-money">
            <span>Pending money</span>
            <strong>{money(pendingMoney)}</strong>
            <small>
              {unsent.length} on device · money remains pending until completed or returned
            </small>
          </div>
          <nav className="pd-mobile-tabs" aria-label="Mobile POS views">
            <button
              aria-current={view === 'capture' ? 'page' : undefined}
              onClick={() => {
                setView('capture');
                setSelected(null);
              }}
            >
              <Plus size={17} />
              {role === 'STOCKIST' ? 'Capture & dispatch' : 'Capture'}
            </button>
            <button
              aria-current={view === 'requests' ? 'page' : undefined}
              onClick={() => {
                setView('requests');
                setRequestPage(1);
                setSelected(null);
              }}
            >
              <ClipboardCheck size={17} />
              Requests
            </button>
            {context?.capabilities.canPrepare && (
              <button
                aria-current={view === 'prepare' ? 'page' : undefined}
                onClick={() => {
                  setView('prepare');
                  setRequestPage(1);
                  setSelected(null);
                }}
              >
                <Package size={17} />
                Prepare
              </button>
            )}
            {role !== 'CASHIER' && (
              <button
                aria-current={view === 'stock' ? 'page' : undefined}
                onClick={() => {
                  setView('stock');
                  setSelected(null);
                }}
              >
                <Package size={17} />
                Stock
              </button>
            )}
            {admin?.permissions.includes('mobile_pos_onboarding.manage') && (
              <button
                aria-current={view === 'devices' ? 'page' : undefined}
                onClick={() => setView('devices')}
              >
                Team
              </button>
            )}
          </nav>
          {view === 'capture' && context && (
            <DraftCapture
              key={`${captureRevision}:${correcting?.id ?? 'new'}`}
              context={context}
              role={role}
              initial={correcting}
              send={send}
              onSaved={(value) => {
                setCorrecting(undefined);
                setCaptureRevision((v) => v + 1);
                setView('requests');
                if ('local' in value)
                  setNotice(
                    'Saved on this device. This provisional acknowledgement is pending submission and approval.',
                  );
                else {
                  setNotice(
                    value.continuedExisting
                      ? 'Matched an existing cashier request. Continue its preparation here.'
                      : value.status === 'POSTED'
                        ? 'Request posted. Open its document for the final record.'
                        : 'Request submitted. Money and stock remain pending.',
                  );
                  void refreshRequests();
                  void open(value);
                }
              }}
            />
          )}
          {view === 'capture' && !context && (
            <p className="pd-notice">
              {admin
                ? 'Choose a company and branch to capture a request.'
                : 'Branch records are unavailable. Reconnect and refresh before capturing.'}
            </p>
          )}
          {['requests', 'prepare'].includes(view) && (
            <section className="pd-mobile-requests">
              <div className="pd-section-heading">
                <h2>{view === 'prepare' ? 'Awaiting preparation' : 'Your requests'}</h2>
                <button
                  className="pd-icon-button"
                  aria-label="Refresh request status"
                  disabled={offline || busy}
                  onClick={() => {
                    void refreshRequests();
                    void sync(true);
                  }}
                >
                  <RefreshCw size={18} />
                </button>
              </div>
              {selected ? (
                <DraftInspector
                  key={`${selected.id}:${selected.revision}`}
                  draft={selected}
                  context={context}
                  decide={decide}
                  onClose={() => setSelected(null)}
                  onChanged={(draft) => {
                    setSelected(draft);
                    void refreshRequests();
                  }}
                  onCorrect={(draft) => {
                    setCorrecting(draft);
                    setView('capture');
                  }}
                  onReceipt={postedReceipt}
                />
              ) : (
                <>
                  {view === 'requests' &&
                    unsent.map((capture) => (
                      <article className="pd-local-request" key={capture.key}>
                        <strong>{KIND_LABELS[capture.submission.kind]}</strong>
                        <span className="pd-status">
                          {capture.state === 'LOCAL'
                            ? 'On device · pending submission'
                            : 'Needs status check'}
                        </span>
                        <small>{new Date(capture.submission.capturedAt).toLocaleString()}</small>
                        <small>Request · {capture.requestId}</small>
                        <p className="pd-muted">
                          Provisional acknowledgement. No money or stock has posted.
                        </p>
                        {capture.error && <p className="pd-error">{capture.error}</p>}
                        <button
                          className="pd-button"
                          disabled={offline || busy}
                          onClick={() => void sync(true, capture)}
                        >
                          Check and submit safely
                        </button>
                      </article>
                    ))}
                  {displayed.map((draft) => (
                    <button
                      className="pd-mobile-request"
                      key={draft.id}
                      onClick={() => void open(draft)}
                    >
                      <span>
                        <strong>{KIND_LABELS[draft.kind]}</strong>
                        <small>
                          {draft.businessDate} · {draft.originRole.toLowerCase()}
                        </small>
                        <span className="pd-status" data-status={draft.status}>
                          {STATUS_LABELS[draft.status] ?? draft.status}
                          {draft.status === 'REJECTED' && Number(draft.pendingMoney) > 0
                            ? ' · funds to return'
                            : ''}
                        </span>
                      </span>
                      <strong>
                        {draft.amount != null ? money(draft.amount, draft.currency) : ''}
                      </strong>
                    </button>
                  ))}
                  {!!result?.total && (
                    <nav className="pd-pagination" aria-label="Request pages">
                      <button
                        className="pd-button"
                        disabled={requestPage <= 1 || offline || busy}
                        onClick={() => setRequestPage((page) => page - 1)}
                      >
                        Previous
                      </button>
                      <span>
                        Page {requestPage} of {Math.max(1, Math.ceil(result.total / result.limit))}
                      </span>
                      <button
                        className="pd-button"
                        disabled={requestPage * result.limit >= result.total || offline || busy}
                        onClick={() => setRequestPage((page) => page + 1)}
                      >
                        Next
                      </button>
                    </nav>
                  )}
                  {!displayed.length && !unsent.length && (
                    <p className="pd-muted">
                      {view === 'prepare'
                        ? 'No approved cashier sales need preparation.'
                        : 'Submitted requests will appear here.'}
                    </p>
                  )}
                </>
              )}
            </section>
          )}
          {view === 'stock' && context && (
            <section>
              <h2>Branch stock</h2>
              <p className="pd-muted">
                {offline
                  ? 'Saved quantities. These may have changed.'
                  : 'Current branch quantities. Pending requests are shown separately.'}
              </p>
              {context.products
                .filter((product) => product.trackInventory)
                .map((product) => (
                  <div className="pd-stock-row" key={product.id}>
                    <span>{product.name}</span>
                    <strong>
                      {product.quantityOnHand} {product.unitSymbol}
                    </strong>
                  </div>
                ))}
            </section>
          )}
          {view === 'devices' && admin && (
            <AuthProvider>
              <PosDevices />
            </AuthProvider>
          )}
        </>
      )}
      {notice && (
        <p className="pd-notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="pd-error" role="alert">
          {error}
          <button className="pd-button" onClick={() => setRevision((v) => v + 1)} disabled={busy}>
            Refresh session
          </button>
        </p>
      )}
      {printerOpen && (
        <PrinterPanel
          printer={printer}
          t={t}
          onClose={() => setPrinterOpen(false)}
          onTestPrint={() => {
            const receipt: import('@/features/pos/hardware/receipt').ReceiptModel = {
              company: 'Itemba POS · printer test',
              branch: profile?.branch.name ?? 'Printer test',
              terminal: profile?.terminalCode ?? '',
              rep: profile?.operator.name ?? '',
              issuedAt: new Date(),
              orderNumber: 'TEST',
              lines: [],
              total: 0,
              paymentLabel: 'Printer test',
              received: null,
              change: null,
              held: true,
              customer: null,
            };
            setPrintJob(receipt);
          }}
        />
      )}
      {printJob && (
        <>
          <ReceiptPrint model={printJob} paper={printer.settings.paper} t={t} />
          <button
            className="pd-button"
            onClick={() => {
              void printer.print(printJob).finally(() => setPrintJob(null));
            }}
          >
            {printJob.held ? 'Print test' : 'Print final receipt'}
          </button>
        </>
      )}
    </main>
  );
}
