import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { InstallQrCode } from '@/components/westsides/mobile-pos-install/InstallQrCode';
import { MobilePosInstallActions } from '@/components/westsides/mobile-pos-install/MobilePosInstallActions';
import {
  WESTSIDES_MOBILE_POS_MANIFEST_PATH,
  WESTSIDES_MOBILE_POS_NAME,
  WESTSIDES_MOBILE_POS_ROUTE,
} from '@/components/westsides/mobile-pos-install/routes';

export const metadata: Metadata = {
  title: `${WESTSIDES_MOBILE_POS_NAME} Install`,
  description: 'Install and open the Westsides Mobile POS route.',
  manifest: WESTSIDES_MOBILE_POS_MANIFEST_PATH,
};

const STEPS = [
  {
    title: 'Sign in on the device',
    body: 'Use the Itemba account assigned to the cashier or supervisor using this POS device.',
  },
  {
    title: 'Install from the browser',
    body: 'Use the install prompt when available, or choose Add to Home screen from the browser menu.',
  },
  {
    title: 'Open counter sales',
    body: 'Launch Mobile POS to continue into the Westsides sale-entry workflow.',
  },
];

export default function WestsidesMobilePosInstallPage() {
  return (
    <div className="min-h-full p-4 sm:p-6">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <nav className="mb-2 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
              <Link href="/westsides" className="hover:underline">
                Westsides
              </Link>
              <span className="px-1">/</span>
              <span>Mobile POS install</span>
            </nav>
            <h1
              className="text-[24px] font-semibold leading-tight"
              style={{ color: 'var(--aurora-text)' }}
            >
              {WESTSIDES_MOBILE_POS_NAME}
            </h1>
            <p className="mt-1 max-w-2xl text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>
              Install the Itemba web app on a phone or tablet, then open the Westsides POS route for
              counter sales.
            </p>
          </div>
          <Link
            href={WESTSIDES_MOBILE_POS_ROUTE}
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
          >
            Open Mobile POS
          </Link>
        </div>

        <section
          className="grid gap-4 rounded-xl border p-4 sm:p-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]"
          style={{
            background: 'var(--aurora-card)',
            borderColor: 'var(--aurora-border)',
            boxShadow: 'var(--aurora-shadow-sm)',
          }}
        >
          <div className="min-w-0">
            <div className="flex items-start gap-3">
              <span className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
                <Image
                  src="/brand/itemba-group-logo.png"
                  alt="Itemba Group"
                  width={56}
                  height={56}
                  className="h-full w-full object-contain"
                />
              </span>
              <div className="min-w-0">
                <div
                  className="text-xs font-semibold uppercase tracking-[0.18em]"
                  style={{ color: 'var(--aurora-primary-text)' }}
                >
                  Install gateway
                </div>
                <h2 className="mt-1 text-xl font-semibold" style={{ color: 'var(--aurora-text)' }}>
                  Set up a dedicated POS shortcut on this device.
                </h2>
                <p
                  className="mt-2 max-w-2xl text-sm leading-6"
                  style={{ color: 'var(--aurora-text-secondary)' }}
                >
                  The shortcut keeps cashiers close to the sale-entry workflow while preserving the
                  normal Itemba login, company, branch, and receipt-account controls.
                </p>
              </div>
            </div>

            <div className="mt-5">
              <MobilePosInstallActions />
            </div>
          </div>

          <aside
            className="rounded-xl border p-4"
            style={{
              background: 'var(--aurora-bg-subtle)',
              borderColor: 'var(--aurora-border)',
            }}
          >
            <div className="flex items-start gap-4 sm:items-center lg:flex-col lg:items-start">
              <InstallQrCode size={132} className="h-32 w-32 flex-shrink-0" />
              <div className="min-w-0">
                <div className="text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
                  Share this install gateway
                </div>
                <p
                  className="mt-1 text-xs leading-5"
                  style={{ color: 'var(--aurora-text-secondary)' }}
                >
                  Scan from another phone or tablet to land here, sign in, install, and open Mobile
                  POS.
                </p>
              </div>
            </div>
          </aside>
        </section>

        <section className="grid gap-3 md:grid-cols-3">
          {STEPS.map((step, index) => (
            <div
              key={step.title}
              className="rounded-xl border p-4"
              style={{
                background: 'var(--aurora-card)',
                borderColor: 'var(--aurora-border)',
                boxShadow: 'var(--aurora-shadow-sm)',
              }}
            >
              <div
                className="flex h-8 w-8 items-center justify-center rounded-lg text-sm font-semibold"
                style={{
                  background: 'var(--aurora-primary-subtle)',
                  color: 'var(--aurora-primary-text)',
                }}
              >
                {index + 1}
              </div>
              <h3 className="mt-3 text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
                {step.title}
              </h3>
              <p
                className="mt-1 text-sm leading-6"
                style={{ color: 'var(--aurora-text-secondary)' }}
              >
                {step.body}
              </p>
            </div>
          ))}
        </section>

        <section
          className="rounded-xl border p-4"
          style={{
            background: 'var(--aurora-card)',
            borderColor: 'var(--aurora-border)',
          }}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
                POS route
              </h2>
              <p className="mt-1 text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>
                This gateway opens the dedicated Westsides Mobile POS screen.
              </p>
            </div>
            <code
              className="break-all rounded-lg border px-3 py-2 text-xs"
              style={{
                background: 'var(--aurora-bg-subtle)',
                borderColor: 'var(--aurora-border)',
                color: 'var(--aurora-text-secondary)',
              }}
            >
              {WESTSIDES_MOBILE_POS_ROUTE}
            </code>
          </div>
        </section>
      </div>
    </div>
  );
}
