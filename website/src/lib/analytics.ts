type AnalyticsWindow = Window & {
  gtag?: (command: 'event', eventName: string, params?: Record<string, unknown>) => void;
  dataLayer?: Array<Record<string, unknown>>;
};

export function trackEvent(eventName: string, params: Record<string, unknown> = {}) {
  if (typeof window === 'undefined') return;

  const analyticsWindow = window as AnalyticsWindow;

  analyticsWindow.gtag?.('event', eventName, params);
  analyticsWindow.dataLayer?.push({
    event: eventName,
    ...params,
  });
}

export function trackConversion(action: string, params: Record<string, unknown> = {}) {
  trackEvent('website_conversion', {
    conversion_action: action,
    ...params,
  });
}
