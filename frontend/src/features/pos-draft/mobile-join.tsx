'use client';
import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Download, ShieldCheck, Smartphone } from 'lucide-react';
import { backendPost, ApiError } from '@/lib/api-client';
import {
  createDeviceSecret,
  isInstalled,
  mobileApi,
  readDevice,
  saveDevice,
  readPendingEnrollment,
  savePendingEnrollment,
  clearPendingEnrollment,
  readAdminInstallation,
  saveAdminInstallation,
  readSetupBinding,
  saveSetupBinding,
  clearSetupBinding,
} from './mobile-api';
import type { EnrollmentProfile, InviteProfile, MobileProfile } from './mobile-types';
import type { PosRole } from './types';
import './pos-draft.css';

type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};
export function MobileJoin({ token }: { token: string }) {
  const router = useRouter();
  const [invite, setInvite] = useState<InviteProfile | null>(null),
    [enrollment, setEnrollment] = useState<EnrollmentProfile | null>(null);
  const [installed, setInstalled] = useState(false),
    [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [name, setName] = useState(''),
    [role, setRole] = useState<PosRole>('CASHIER');
  const [pin, setPin] = useState(''),
    [confirmPin, setConfirmPin] = useState('');
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const [claimToken, setClaimToken] = useState(token);
  const [resetRecovery, setResetRecovery] = useState(false);
  useEffect(() => {
    setInstalled(isInstalled());
    if ('serviceWorker' in navigator)
      void navigator.serviceWorker
        .register(`/mobile-pos-sw.js?setup=${encodeURIComponent(token)}`, { scope: '/' })
        .catch(() => setNotice('Use the browser menu to add this app to your home screen.'));
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPrompt);
    };
    const onInstalled = () => {
      setPrompt(null);
      setNotice('Installation is ready. Open Itemba POS from its home-screen icon to continue.');
    };
    const onFocus = () => setInstalled(isInstalled());
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      window.removeEventListener('focus', onFocus);
    };
  }, [token]);
  useEffect(() => {
    const controller = new AbortController();
    const bound = isInstalled() ? readDevice() : null;
    const adminInstall = isInstalled() ? readAdminInstallation() : null;
    if (
      !bound &&
      adminInstall &&
      (adminInstall.claimToken === token || adminInstall.inviteToken === token)
    ) {
      router.replace(
        `/mobile-pos?admin=1&companyId=${encodeURIComponent(adminInstall.companyId)}&branchId=${encodeURIComponent(adminInstall.branchId)}`,
      );
      return () => controller.abort();
    }
    if (bound && (bound.claimToken === token || bound.inviteToken === token)) {
      router.replace('/mobile-pos');
      return () => controller.abort();
    }
    const pending = isInstalled() ? readPendingEnrollment() : null;
    const resumed = pending?.inviteToken === token ? pending.claimToken : token;
    setClaimToken(resumed);
    if (resumed !== token) router.replace(`/mobile-pos/join/${encodeURIComponent(resumed)}`);
    setLoading(true);
    setError('');
    setResetRecovery(false);
    void mobileApi<InviteProfile>(`/mobile-pos-auth/invite/${encodeURIComponent(resumed)}`, {
      signal: controller.signal,
    })
      .then((value) => {
        if (!controller.signal.aborted) {
          setInvite(value);
          setEnrollment(null);
        }
      })
      .catch(async (e) => {
        if (controller.signal.aborted) return;
        if (!(e instanceof ApiError) || ![400, 404, 410].includes(e.status)) throw e;
        const value = await mobileApi<EnrollmentProfile>(
          `/mobile-pos-auth/enrollment/${encodeURIComponent(resumed)}`,
          { signal: controller.signal },
        );
        if (!controller.signal.aborted) {
          setEnrollment(value);
          setInvite(null);
          if (['REJECTED', 'REVOKED'].includes(value.status)) {
            clearPendingEnrollment(value.enrollmentId);
            clearSetupBinding(value.enrollmentId);
          }
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          // Completing a reset consumes its link. A lost response can leave
          // this phone with the old local credential version, but its bound
          // device and the newly chosen PIN still authorize ordinary sign-in.
          if (
            bound &&
            readSetupBinding(bound.enrollmentId) === bound.deviceSecret &&
            e instanceof ApiError &&
            [404, 410].includes(e.status)
          )
            setResetRecovery(true);
          setError(
            e instanceof Error
              ? e.message
              : 'This installation link is unavailable. Ask your administrator for a new link.',
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [token, revision, router]);
  useEffect(() => {
    if (enrollment?.status !== 'PENDING') return;
    const timer = setInterval(() => setRevision((v) => v + 1), 10000);
    return () => clearInterval(timer);
  }, [enrollment?.status]);
  async function install() {
    if (prompt) {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      setPrompt(null);
      setNotice(
        choice.outcome === 'accepted'
          ? 'Open Itemba POS from its new app icon to continue.'
          : 'You can install later from your browser menu.',
      );
    } else
      setNotice(
        /iphone|ipad|ipod/i.test(navigator.userAgent)
          ? 'Tap Share, then Add to Home Screen. Open the new Itemba POS icon.'
          : 'Open the browser menu, choose Install app or Add to home screen, then open the new Itemba POS icon.',
      );
  }
  async function request(event: React.FormEvent) {
    event.preventDefault();
    if (!isInstalled()) {
      setError('Open the installed app to request access.');
      return;
    }
    if (!name.trim()) {
      setError('Enter your full name.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const value = await mobileApi<{ enrollmentId: string; claimToken: string }>(
        `/mobile-pos-auth/invite/${encodeURIComponent(token)}`,
        { method: 'POST', body: { name: name.trim(), role }, public: true },
      );
      savePendingEnrollment({
        inviteToken: token,
        claimToken: value.claimToken,
        enrollmentId: value.enrollmentId,
      });
      router.replace(`/mobile-pos/join/${encodeURIComponent(value.claimToken)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not request access.');
    } finally {
      setBusy(false);
    }
  }
  async function setup(event: React.FormEvent) {
    event.preventDefault();
    if (!isInstalled() || !enrollment) {
      setError('Open the installed app to set up this device.');
      return;
    }
    if (!/^\d{6}$/.test(pin) || pin !== confirmPin) {
      setError('Choose a six-digit PIN and enter it again to confirm.');
      return;
    }
    const previous = readDevice();
    const assertSameDevice = () => {
      const current = readDevice();
      if (
        previous
          ? current?.enrollmentId !== previous.enrollmentId ||
            current.ownerId !== previous.ownerId ||
            current.deviceSecret !== previous.deviceSecret ||
            current.credentialVersion !== previous.credentialVersion
          : !!current
      )
        throw new Error('The approved device changed. Open POS again before continuing.');
    };
    if (
      enrollment.resetRequired &&
      (!previous || previous.enrollmentId !== enrollment.enrollmentId)
    ) {
      setError('Open this reset link on the originally approved device.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const secret = enrollment.resetRequired
        ? previous!.deviceSecret
        : (readSetupBinding(enrollment.enrollmentId) ?? createDeviceSecret());
      saveSetupBinding(enrollment.enrollmentId, secret);
      let value: MobileProfile;
      try {
        value = await mobileApi<MobileProfile>('/mobile-pos-auth/setup', {
          method: 'POST',
          body: { claimToken, deviceSecret: secret, pin },
          public: true,
          deviceSecret: secret,
        });
      } catch (error) {
        if (
          !enrollment.resetRequired ||
          !previous ||
          !(error instanceof ApiError) ||
          ![404, 410].includes(error.status)
        )
          throw error;
        assertSameDevice();
        // Retry only the credential check. A consumed or expired reset link
        // never authorizes another PIN change.
        value = await mobileApi<MobileProfile>('/mobile-pos-auth/login', {
          method: 'POST',
          body: { enrollmentId: previous.enrollmentId, deviceSecret: secret, pin },
          public: true,
          deviceSecret: secret,
        });
      }
      assertSameDevice();
      if (
        value.enrollmentId !== enrollment.enrollmentId ||
        (enrollment.resetRequired && value.user.id !== previous!.ownerId)
      )
        throw new Error('This sign-in does not match the approved device.');
      saveDevice({
        deviceSecret: secret,
        enrollmentId: value.enrollmentId,
        ownerId: value.user.id,
        credentialVersion: value.operator.credentialVersion,
        claimToken,
        inviteToken: readPendingEnrollment()?.inviteToken ?? previous?.inviteToken,
      });
      clearPendingEnrollment(value.enrollmentId);
      clearSetupBinding(value.enrollmentId);
      setPin('');
      setConfirmPin('');
      router.replace('/mobile-pos');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not set up the PIN.');
    } finally {
      setBusy(false);
    }
  }
  async function linkAdmin() {
    if (!enrollment || !isInstalled()) return;
    setBusy(true);
    setError('');
    try {
      await backendPost(
        `/mobile-pos-onboarding/enrollments/${enrollment.enrollmentId}/admin-link`,
        { claimToken },
      );
      saveAdminInstallation({
        inviteToken: readPendingEnrollment()?.inviteToken ?? token,
        claimToken,
        enrollmentId: enrollment.enrollmentId,
        companyId: enrollment.company.id,
        branchId: enrollment.branch.id,
      });
      clearPendingEnrollment(enrollment.enrollmentId);
      router.replace(
        `/mobile-pos?admin=1&companyId=${encodeURIComponent(enrollment.company.id)}&branchId=${encodeURIComponent(enrollment.branch.id)}`,
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Sign in with an authorized OS account, then return here.',
      );
    } finally {
      setBusy(false);
    }
  }
  const scope = enrollment ?? invite;
  const recovering = !!enrollment?.pinReady && !!readSetupBinding(enrollment.enrollmentId);
  return (
    <main className="pd-mobile pd-join">
      <header className="pd-mobile-brand">
        <Image src="/brand/itemba-group-logo.png" width={38} height={38} alt="Itemba Group" />
        <span>
          Itemba <b>POS</b>
        </span>
      </header>
      <section className="pd-join-card">
        <div className="pd-join-icon">
          {enrollment?.status === 'PENDING' ? (
            <ShieldCheck size={30} />
          ) : installed ? (
            <CheckCircle2 size={30} />
          ) : (
            <Smartphone size={30} />
          )}
        </div>
        <span className="pd-eyebrow">{scope?.branch.name ?? 'Mobile workspace'}</span>
        <h1>
          {!installed
            ? 'Your branch, on your phone.'
            : enrollment?.status === 'PENDING'
              ? 'Your request is with the admin.'
              : enrollment?.status === 'APPROVED' &&
                  (!enrollment.pinReady || recovering) &&
                  enrollment.role !== 'ADMIN'
                ? 'Secure your device.'
                : enrollment
                  ? 'Your mobile access'
                  : 'Let’s get you set up.'}
        </h1>
        {scope && (
          <p className="pd-muted">
            {scope.company.name} · {scope.division.name} · {scope.branch.name}
          </p>
        )}
        {loading && <p role="status">Checking your installation link…</p>}
        {!loading && !installed && scope && (
          <>
            <p>
              Install Itemba POS first. Open its app icon to enter your name and request your role.
            </p>
            <ol className="pd-install-steps">
              <li>Install on this phone</li>
              <li>Request cashier, stockist or admin access</li>
              <li>Wait for approval, then secure the device</li>
            </ol>
            <button className="pd-button pd-primary" onClick={() => void install()}>
              <Download size={18} />
              {prompt ? 'Install Itemba POS' : 'Show installation steps'}
            </button>
          </>
        )}
        {!loading && installed && invite && (
          <form onSubmit={request}>
            <label className="pd-field">
              Full name
              <input
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </label>
            <label className="pd-field">
              Requested role
              <select value={role} onChange={(e) => setRole(e.target.value as PosRole)}>
                <option value="CASHIER">Cashier · sales and collections</option>
                <option value="STOCKIST">Stockist · stock and dispatch</option>
                <option value="ADMIN">Admin · existing OS account</option>
              </select>
            </label>
            <p className="pd-muted">Your administrator confirms your role and branch access.</p>
            <button className="pd-button pd-primary" disabled={busy} type="submit">
              {busy ? 'Sending…' : 'Request access'}
            </button>
          </form>
        )}
        {installed && enrollment?.status === 'PENDING' && (
          <>
            <p>
              {enrollment.name}, your requested {enrollment.role.toLowerCase()} access is pending.
              You can close the app and return when approved.
            </p>
            {enrollment.role === 'ADMIN' && (
              <>
                <a
                  className="pd-button"
                  href={`/login?from=${encodeURIComponent(`/mobile-pos/join/${token}`)}`}
                >
                  Sign in with your OS account
                </a>
                <button
                  className="pd-button pd-primary"
                  disabled={busy}
                  onClick={() => void linkAdmin()}
                >
                  Link authorized admin account
                </button>
              </>
            )}
            <button className="pd-button" onClick={() => setRevision((v) => v + 1)} disabled={busy}>
              Check approval
            </button>
          </>
        )}
        {installed &&
          enrollment?.status === 'APPROVED' &&
          (!enrollment.pinReady || recovering) &&
          enrollment.role !== 'ADMIN' && (
            <form onSubmit={setup}>
              <p>
                Welcome, {enrollment.name}. Your {enrollment.role.toLowerCase()} access is approved.{' '}
                {recovering
                  ? 'Your setup was saved. Enter the same PIN to recover sign-in on this phone.'
                  : enrollment.resetRequired
                    ? 'Choose a new PIN for this device.'
                    : 'Choose the PIN you will use on this phone.'}
              </p>
              <label className="pd-field">
                Six-digit PIN
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  maxLength={6}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                />
              </label>
              <label className="pd-field">
                Confirm PIN
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  maxLength={6}
                  value={confirmPin}
                  onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                />
              </label>
              <button className="pd-button pd-primary" disabled={busy} type="submit">
                {busy
                  ? 'Securing device…'
                  : recovering
                    ? 'Recover sign-in and open POS'
                    : 'Set PIN and open POS'}
              </button>
            </form>
          )}
        {installed && enrollment?.status === 'APPROVED' && enrollment.pinReady && !recovering && (
          <a className="pd-button pd-primary" href="/mobile-pos">
            Open Itemba POS
          </a>
        )}
        {installed && enrollment?.status === 'APPROVED' && enrollment.role === 'ADMIN' && (
          <a
            className="pd-button pd-primary"
            href={`/mobile-pos?admin=1&companyId=${encodeURIComponent(enrollment.company.id)}&branchId=${encodeURIComponent(enrollment.branch.id)}`}
          >
            Open admin POS
          </a>
        )}
        {enrollment && ['REJECTED', 'REVOKED'].includes(enrollment.status) && (
          <p className="pd-error">
            This access is {enrollment.status.toLowerCase()}. Contact your administrator.
          </p>
        )}
        {notice && (
          <p className="pd-notice" role="status">
            {notice}
          </p>
        )}
        {error && (
          <p className="pd-error" role="alert">
            {error}
          </p>
        )}
        {installed && resetRecovery && (
          <>
            <p className="pd-muted">
              If your new PIN was saved before the connection was lost, sign in with it to recover
              this device. Otherwise ask your administrator for a new reset link.
            </p>
            <a className="pd-button pd-primary" href="/mobile-pos">
              Open POS to recover sign-in
            </a>
          </>
        )}
      </section>
      <footer className="pd-mobile-footer">ITEMBA GROUP · A device for your work.</footer>
    </main>
  );
}
