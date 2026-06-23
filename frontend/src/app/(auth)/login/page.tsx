'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AuthShell } from '@/components/auth/AuthShell';

const inputClassName =
  'mt-1 w-full rounded-xl border border-[#cbd5df] bg-white px-4 py-3 text-sm text-[#071321] shadow-sm outline-none transition placeholder:text-[#8290a3] focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#d9e3ed]';

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
          <Link
            href="/signup"
            className="font-semibold text-[#071321] underline-offset-4 hover:text-[#5a4720] hover:underline"
          >
            Request access
          </Link>
        </>
      }
    >
      <div className="mb-7">
        <div className="inline-flex rounded-full border border-[#d6c59d] bg-[#fff8e5] px-3 py-1 text-xs font-semibold uppercase text-[#5a4720]">
          Welcome back
        </div>
        <h2 className="mt-4 text-2xl font-semibold text-[#071321]">Account sign in</h2>
        <p className="mt-2 text-sm leading-6 text-[#526277]">
          Use the email and password assigned to your Itemba Group user profile.
        </p>
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-semibold text-[#26364a]">
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
            className={inputClassName}
          />
        </div>

        <div>
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="password" className="block text-sm font-semibold text-[#26364a]">
              Password
            </label>
            <button
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              className="rounded-full px-2 py-1 text-xs font-semibold text-[#607085] transition hover:bg-[#eef1ed] hover:text-[#071321]"
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
            className={inputClassName}
          />
        </div>

        {error && (
          <div className="animate-shake flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
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
            className="animate-scale-pop flex w-full items-center justify-center gap-2 rounded-xl bg-[#2f6b54] px-4 py-3 text-sm font-semibold text-white"
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
            className="w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-[0_14px_28px_rgba(5,150,105,0.30)] transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        )}
      </form>
    </AuthShell>
  );
}
