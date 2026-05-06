import Link from 'next/link';
import type { ReactNode } from 'react';

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
  return (
    <main className="auth-light min-h-screen bg-[#f7f8f6] text-slate-950">
      <div className="grid min-h-screen lg:grid-cols-[minmax(420px,0.92fr)_minmax(460px,1.08fr)]">
        <section className="flex min-h-[42vh] flex-col justify-between border-b border-slate-200 bg-white px-6 py-7 sm:px-10 lg:min-h-screen lg:border-b-0 lg:border-r">
          <div>
            <Link href="/login" className="inline-flex items-center gap-3">
              <span className="flex h-16 w-16 items-center justify-center rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
                <img
                  src="/brand/itemba-group-logo.png"
                  alt="Itemba Group"
                  className="h-full w-full object-contain"
                />
              </span>
              <span>
                <span className="block text-lg font-semibold tracking-wide">ITEMBA GROUP</span>
                <span className="block text-xs font-medium uppercase tracking-[0.18em] text-emerald-700">
                  Enterprise Platform
                </span>
              </span>
            </Link>

            <div className="mt-14 max-w-xl">
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">{eyebrow}</div>
              <h1 className="mt-4 text-4xl font-semibold leading-tight text-slate-950 sm:text-5xl">
                {title}
              </h1>
              <p className="mt-5 max-w-lg text-base leading-7 text-slate-600">{subtitle}</p>
            </div>
          </div>

          <div className="mt-10 space-y-5">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
              {ACCESS_POINTS.map((item) => (
                <div key={item} className="rounded-lg border border-slate-200 bg-[#fbfcfb] px-3 py-3">
                  <div className="h-1.5 w-8 rounded-full bg-emerald-600" />
                  <div className="mt-3 text-sm font-semibold text-slate-800">{item}</div>
                </div>
              ))}
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-950 px-4 py-3 text-sm text-white">
              <span className="font-semibold">Permanent address:</span>{' '}
              <a
                href={WEBSITE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-slate-200 underline-offset-4 transition-colors hover:text-white hover:underline"
              >
                itembagrouptz.com
              </a>
            </div>
          </div>
        </section>

        <section className="flex items-center justify-center px-6 py-10 sm:px-10">
          <div className="w-full max-w-md">
            <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm sm:p-8">{children}</div>
            <div className="mt-5 text-center text-sm text-slate-600">{footer}</div>
          </div>
        </section>
      </div>
    </main>
  );
}
