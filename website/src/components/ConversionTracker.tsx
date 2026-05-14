'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { trackConversion, trackEvent } from '@/lib/analytics';

function classifyLink(link: HTMLAnchorElement) {
  const href = link.getAttribute('href') || '';

  if (href.startsWith('tel:')) return 'phone_click';
  if (href.startsWith('mailto:')) return 'email_click';
  if (href.includes('wa.me/')) return 'whatsapp_click';
  return '';
}

export default function ConversionTracker() {
  const pathname = usePathname();
  const previousPathname = useRef(pathname);

  useEffect(() => {
    if (previousPathname.current === pathname) return;
    previousPathname.current = pathname;

    trackEvent('page_view', {
      page_path: pathname,
      page_location: window.location.href,
      page_title: document.title,
    });
  }, [pathname]);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const link = target.closest('a');
      if (!(link instanceof HTMLAnchorElement)) return;

      const action = classifyLink(link);
      if (!action) return;

      trackConversion(action, {
        link_url: link.href,
        link_text: link.textContent?.trim().slice(0, 120) || link.getAttribute('aria-label') || '',
        page_path: window.location.pathname,
      });
    }

    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  return null;
}
