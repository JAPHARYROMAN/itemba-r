import Link from 'next/link';
import Image from 'next/image';
import type { ReactNode } from 'react';
import { InstallQrCode } from '@/components/westsides/mobile-pos-install/InstallQrCode';
import {
  WESTSIDES_MOBILE_POS_INSTALL_PATH,
  WESTSIDES_MOBILE_POS_NAME,
} from '@/components/westsides/mobile-pos-install/routes';

interface AuthShellProps {
  eyebrow: string;
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}

const ACCESS_POINTS = ['Governance', 'Operations', 'Finance', 'Documents'];
const WEBSITE_URL = process.env.NEXT_PUBLIC_WEBSITE_URL ?? 'https://itembagrouptz.com';

export function AuthShell({ eyebrow, title, subtitle, children, footer }: AuthShellProps) {
  const showMobilePosInstall =
    eyebrow.toLowerCase().includes('secure workspace') || title.toLowerCase().includes('sign in');

  return (
    <main className="auth-light min-h-screen bg-[#eef1ed] text-[#071321]">
      <div className="grid min-h-screen lg:grid-cols-[minmax(460px,0.95fr)_minmax(460px,1.05fr)]">
        <section
          className="relative flex min-h-[42vh] flex-col justify-between overflow-hidden px-6 py-8 text-white sm:px-10 lg:min-h-screen lg:px-14"
          style={{
            background:
              'radial-gradient(135% 125% at 0% 0%, #047857 0%, #065f46 24%, #0c2a1f 56%, #0a1018 100%)',
          }}
        >
          {/* Ambient brand glows */}
          <div
            aria-hidden
            className="pointer-events-none absolute -left-24 -top-24 h-80 w-80 rounded-full blur-3xl"
            style={{
              background: 'radial-gradient(circle, rgba(245,158,11,0.20) 0%, transparent 70%)',
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-32 right-[-10%] h-96 w-96 rounded-full blur-3xl"
            style={{
              background: 'radial-gradient(circle, rgba(16,185,129,0.22) 0%, transparent 70%)',
            }}
          />

          <div className="relative">
            <Link href="/login" className="inline-flex items-center gap-3">
              <span className="flex h-[72px] w-[72px] items-center justify-center rounded-2xl border border-white/15 bg-white p-2 shadow-[0_12px_30px_rgba(0,0,0,0.35)]">
                <Image
                  src="/brand/itemba-group-logo.png"
                  alt="Itemba Group"
                  width={64}
                  height={64}
                  className="h-full w-full object-contain"
                />
              </span>
              <span>
                <span className="block text-xl font-semibold text-white">ITEMBA GROUP</span>
                <span className="block text-xs font-semibold uppercase tracking-wide text-emerald-300">
                  Enterprise Platform
                </span>
              </span>
            </Link>

            <div className="mt-14 max-w-xl">
              <div className="inline-flex rounded-full border border-amber-300/40 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-amber-300">
                {eyebrow}
              </div>
              <h1 className="mt-5 text-4xl font-semibold leading-tight text-white sm:text-5xl">
                {title}
              </h1>
              <p className="mt-5 max-w-lg text-base leading-7 text-slate-300">{subtitle}</p>
            </div>
          </div>

          <div className="relative mt-10 space-y-5">
            {showMobilePosInstall && (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 shadow-[0_14px_40px_rgba(0,0,0,0.25)] backdrop-blur-sm">
                <div className="flex items-start gap-4">
                  <span className="flex-shrink-0 rounded-xl bg-white p-2 shadow-[0_8px_24px_rgba(0,0,0,0.25)]">
                    <InstallQrCode size={92} className="h-[92px] w-[92px]" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold uppercase tracking-wide text-amber-300">
                      Counter install
                    </div>
                    <div className="mt-1 text-base font-semibold text-white">
                      {WESTSIDES_MOBILE_POS_NAME}
                    </div>
                    <p className="mt-1 text-sm leading-6 text-slate-300">
                      Scan this code or open the gateway to install the mobile POS, then sign in and
                      launch the counter sale screen.
                    </p>
                    <Link
                      href={WESTSIDES_MOBILE_POS_INSTALL_PATH}
                      className="mt-2 inline-flex rounded-full border border-white/20 px-3 py-1 text-xs font-semibold text-amber-200 transition hover:border-amber-300/60 hover:bg-white/5"
                    >
                      Open install gateway
                    </Link>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
              {ACCESS_POINTS.map((item) => (
                <div
                  key={item}
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 backdrop-blur-sm"
                >
                  <div className="h-1.5 w-8 rounded-full bg-gradient-to-r from-amber-400 to-emerald-400" />
                  <div className="mt-3 text-sm font-semibold text-slate-100">{item}</div>
                </div>
              ))}
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200 backdrop-blur-sm">
              <span className="font-semibold text-white">Permanent address:</span>{' '}
              <a
                href={WEBSITE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-amber-200 underline-offset-4 transition-colors hover:text-white hover:underline"
              >
                itembagrouptz.com
              </a>
            </div>
          </div>
        </section>

        <section className="flex items-center justify-center px-6 py-10 sm:px-10">
          <div className="w-full max-w-md animate-fade-up">
            <div className="rounded-2xl border border-[#d8ded5] bg-[#fffefa] p-6 shadow-[0_24px_70px_rgba(7,19,33,0.11)] sm:p-8">
              {children}
            </div>
            <div className="mt-5 text-center text-sm text-[#526277]">{footer}</div>
          </div>
        </section>
      </div>
    </main>
  );
}
