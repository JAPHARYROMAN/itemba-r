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
        <section className="flex min-h-[42vh] flex-col justify-between border-b border-[#d9dfd6] bg-[#faf8f1] px-6 py-8 sm:px-10 lg:min-h-screen lg:border-b-0 lg:border-r lg:px-14">
          <div>
            <Link href="/login" className="inline-flex items-center gap-3">
              <span className="flex h-[72px] w-[72px] items-center justify-center rounded-2xl border border-[#d8ded5] bg-white p-2 shadow-[0_12px_30px_rgba(7,19,33,0.08)]">
                <Image
                  src="/brand/itemba-group-logo.png"
                  alt="Itemba Group"
                  width={64}
                  height={64}
                  className="h-full w-full object-contain"
                />
              </span>
              <span>
                <span className="block text-xl font-semibold text-[#071321]">ITEMBA GROUP</span>
                <span className="block text-xs font-semibold uppercase text-[#607085]">
                  Enterprise Platform
                </span>
              </span>
            </Link>

            <div className="mt-14 max-w-xl">
              <div className="inline-flex rounded-full border border-[#d6c59d] bg-[#fffdf7] px-3 py-1 text-xs font-semibold uppercase text-[#5a4720]">
                {eyebrow}
              </div>
              <h1 className="mt-5 text-4xl font-semibold leading-tight text-[#071321] sm:text-5xl">
                {title}
              </h1>
              <p className="mt-5 max-w-lg text-base leading-7 text-[#3f4e61]">{subtitle}</p>
            </div>
          </div>

          <div className="mt-10 space-y-5">
            {showMobilePosInstall && (
              <div className="rounded-2xl border border-[#d8ded5] bg-white p-4 shadow-[0_14px_40px_rgba(7,19,33,0.07)]">
                <div className="flex items-start gap-4">
                  <InstallQrCode
                    size={92}
                    className="h-[92px] w-[92px] flex-shrink-0 ring-[#d8ded5]"
                  />
                  <div className="min-w-0">
                    <div className="text-xs font-semibold uppercase text-[#5a4720]">
                      Counter install
                    </div>
                    <div className="mt-1 text-base font-semibold text-[#071321]">
                      {WESTSIDES_MOBILE_POS_NAME}
                    </div>
                    <p className="mt-1 text-sm leading-6 text-[#526277]">
                      Scan this code or open the gateway to install the mobile POS, then sign in and
                      launch the counter sale screen.
                    </p>
                    <Link
                      href={WESTSIDES_MOBILE_POS_INSTALL_PATH}
                      className="mt-2 inline-flex rounded-full border border-[#d6c59d] px-3 py-1 text-xs font-semibold text-[#5a4720] transition hover:border-[#b99b55] hover:bg-[#fff8e5]"
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
                  className="rounded-xl border border-[#d8ded5] bg-[#fffdf8] px-3 py-3 shadow-[0_8px_24px_rgba(7,19,33,0.04)]"
                >
                  <div className="h-1.5 w-8 rounded-full bg-[#b99b55]" />
                  <div className="mt-3 text-sm font-semibold text-[#1d2d3f]">{item}</div>
                </div>
              ))}
            </div>
            <div className="rounded-xl border border-[#0f2136] bg-[#071321] px-4 py-3 text-sm text-white shadow-[0_14px_34px_rgba(7,19,33,0.16)]">
              <span className="font-semibold">Permanent address:</span>{' '}
              <a
                href={WEBSITE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#f0dfb2] underline-offset-4 transition-colors hover:text-white hover:underline"
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
