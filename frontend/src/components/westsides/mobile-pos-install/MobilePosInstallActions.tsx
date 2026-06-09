'use client';

import { useEffect, useState } from 'react';
import {
  WESTSIDES_MOBILE_POS_INSTALL_PATH,
  WESTSIDES_MOBILE_POS_NAME,
  WESTSIDES_MOBILE_POS_ROUTE,
  getMobilePosInstallUrl,
} from './routes';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

export function MobilePosInstallActions() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installUrl, setInstallUrl] = useState(() => getMobilePosInstallUrl());
  const [message, setMessage] = useState('');
  const [installed, setInstalled] = useState(false);
  const [isIos, setIsIos] = useState(false);

  useEffect(() => {
    setInstallUrl(new URL(WESTSIDES_MOBILE_POS_INSTALL_PATH, window.location.origin).toString());
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/mobile-pos-sw.js').catch(() => {
        // Install prompts still fall back to browser "Add to Home screen" guidance.
      });
    }
    setInstalled(
      window.matchMedia('(display-mode: standalone)').matches ||
        Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone),
    );
    setIsIos(/iphone|ipad|ipod/i.test(window.navigator.userAgent));

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
      setMessage('This browser can install the app on this device.');
    };

    const handleInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
      setMessage(`${WESTSIDES_MOBILE_POS_NAME} was installed on this device.`);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  async function handleInstallClick() {
    if (installPrompt) {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      setInstallPrompt(null);
      setMessage(
        choice.outcome === 'accepted'
          ? 'Install started. Open the POS when the app icon is ready.'
          : 'Install was dismissed. You can still open POS in the browser.',
      );
      return;
    }

    if (installed) {
      setMessage('The app is already running as an installed app on this device.');
      return;
    }

    setMessage(
      isIos
        ? 'On iPhone or iPad, use Share, then Add to Home Screen.'
        : 'Use the browser menu, then Install app or Add to Home screen.',
    );
  }

  async function handleCopyClick() {
    try {
      await navigator.clipboard.writeText(installUrl);
      setMessage('Install link copied.');
    } catch {
      setMessage('Copy failed. Select and copy the install link below.');
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={handleInstallClick}
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
        >
          {installed
            ? 'Check Install Status'
            : installPrompt
              ? 'Install App'
              : 'Installation Steps'}
        </button>
        <a
          href={WESTSIDES_MOBILE_POS_ROUTE}
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition hover:border-brand-500 hover:text-brand-700 dark:bg-slate-900"
        >
          Open Mobile POS
        </a>
        <button
          type="button"
          onClick={handleCopyClick}
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-brand-500 hover:text-brand-700 dark:bg-slate-900"
        >
          Copy Install Link
        </button>
      </div>

      {message && (
        <div
          className="rounded-lg border px-3 py-2 text-sm"
          style={{
            background: 'var(--aurora-primary-subtle)',
            borderColor: 'var(--aurora-primary)',
            color: 'var(--aurora-primary-text)',
          }}
        >
          {message}
        </div>
      )}

      <div className="break-all rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-[11px] text-slate-600 dark:bg-slate-900">
        {installUrl}
      </div>
    </div>
  );
}
