'use client';

import { useState } from 'react';

export default function LoginPage() {
  const [email, setEmail] = useState('admin@itemba.local');
  const [password, setPassword] = useState('ChangeMe!123');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.message ?? 'Login failed');
        return;
      }
      // Redirect to dashboard — auth context will bootstrap from /api/auth/me
      window.location.href = '/dashboard';
    } catch {
      setError('Network error — please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 p-6 relative">
      {/* Permanent address — links to the public group website */}
      <a
        href="https://itembagrouptz.com"
        target="_blank"
        rel="noopener noreferrer"
        className="absolute bottom-4 left-6 text-xs text-slate-400 hover:text-slate-600 transition-colors"
      >
        Permanent address: itembagrouptz.com
      </a>

      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="w-11 h-11 rounded-lg bg-blue-600 text-white font-bold flex items-center justify-center text-lg select-none">
            IR
          </div>
          <div>
            <div className="text-xl font-bold text-slate-900">ITEMBA-R</div>
            <div className="text-xs text-slate-500">Group Digital Governance</div>
          </div>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
          <h1 className="text-xl font-semibold text-slate-900 mb-1">Sign in</h1>
          <p className="text-sm text-slate-500 mb-6">Use your organisational credentials.</p>

          <form onSubmit={handleSubmit} noValidate>
            <div className="mb-4">
              <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="mb-4">
              <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-1">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {error && (
              <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{ opacity: loading ? 0.6 : 1 }}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 rounded-md transition-colors"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
