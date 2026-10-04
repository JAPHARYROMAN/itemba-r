/** The PIN session proxy never provides a general-purpose ERP tunnel. */
export function mobilePosProxyAllowed(path: string[], method: string): boolean {
  if (
    !path.length ||
    path.some((part) => !part || part === '.' || part === '..' || /[\\/\u0000]/.test(part))
  )
    return false;
  const joined = path.join('/');
  if (/^mobile-pos-auth\/(setup|login|reset-pin|refresh|logout)$/.test(joined))
    return method === 'POST';
  if (joined === 'mobile-pos-auth/me' || joined === 'mobile-pos-auth/csrf') return method === 'GET';
  if (/^mobile-pos-auth\/invite\/[^/]+$/.test(joined)) return method === 'GET' || method === 'POST';
  if (/^mobile-pos-auth\/enrollment\/[^/]+$/.test(joined)) return method === 'GET';
  if (path[0] === 'pos-drafts') return ['GET', 'POST', 'PATCH'].includes(method);
  if (path[0] === 'mobile-pos-onboarding') return ['GET', 'POST', 'PATCH'].includes(method);
  return (
    method === 'GET' &&
    /^mobile-pos-lite\/(session|products|catalog|stock|customers|sales(?:\/[^/]+(?:\/receipt)?)?|daily-summary)$/.test(
      joined,
    )
  );
}

export function publicMobilePosOperation(path: string[]): boolean {
  const joined = path.join('/');
  return (
    /^mobile-pos-auth\/(setup|login|reset-pin)$/.test(joined) ||
    /^mobile-pos-auth\/(invite|enrollment)\/[^/]+$/.test(joined)
  );
}

export function mobilePosSetupStartUrl(value: string | null): string {
  return value && /^[A-Za-z0-9_-]{20,128}$/.test(value)
    ? `/mobile-pos/join/${value}`
    : '/mobile-pos';
}
