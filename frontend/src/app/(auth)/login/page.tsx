'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AuthShell } from '@/components/auth/AuthShell';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // Set when auth succeeds: a short "Karibu" beat before the redirect lands.
  const [welcomeName, setWelcomeName] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError('Email address is required.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError('Enter a valid email address.');
      return;
    }
    if (!password) {
      setError('Password is required.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmedEmail, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.message ?? 'Login failed');
        return;
      }
      const from = new URLSearchParams(window.location.search).get('from');
      const target =
        from?.startsWith('/') && !from.startsWith('//') ? from : '/dashboard';
      const firstName =
        typeof data?.user?.fullName === 'string' ? data.user.fullName.split(' ')[0] : '';
      setWelcomeName(firstName || 'karibu');
      // Brief welcome beat, then redirect. Skipped for reduced-motion users.
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      window.setTimeout(() => {
        window.location.href = target;
      }, reduce ? 0 : 750);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      eyebrow="Secure workspace"
      title="Sign in to the Itemba operating system."
      subtitle="Access company records, approvals, documents, dashboards, and branch workflows from one controlled workspace."
      footer={
        <>
          Need an account?{' '}
          <Link href="/signup" className="font-semibold text-emerald-700 hover:text-emerald-800">
            Request access
          </Link>
        </>
      }
    >
      <div className="mb-7">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
          Welcome back
        </div>
        <h2 className="mt-3 text-2xl font-semibold text-slate-950">Account sign in</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Use the email and password assigned to your Itemba Group user profile.
        </p>
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-slate-800">
            Email address
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="name@itembagrouptz.com"
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-950 shadow-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          />
        </div>

        <div>
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="password" className="block text-sm font-medium text-slate-800">
              Password
            </label>
            <button
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              className="text-xs font-semibold text-slate-500 hover:text-slate-800"
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
          <input
            id="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-950 shadow-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          />
        </div>

        {error && (
          <div className="animate-shake flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <svg
              className="h-4 w-4 flex-shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="9" />
              <path strokeLinecap="round" d="M12 8v4m0 4h.01" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        {welcomeName ? (
          <div
            className="animate-scale-pop flex w-full items-center justify-center gap-2 rounded-md bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white"
            role="status"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={3}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            {welcomeName === 'karibu' ? 'Karibu!' : `Karibu, ${welcomeName}!`}
          </div>
        ) : (
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        )}
      </form>
    </AuthShell>
  );
}
