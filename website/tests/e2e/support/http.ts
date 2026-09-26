/**
 * Raw HTTP against the server under test, the way scripts/snapshot-routes.mjs
 * recorded the baseline: Node's http client, no redirect following, no
 * Accept-Encoding, and an optional Host override (Playwright's request
 * fixture cannot set Host, which the host-redirect contract needs).
 */
import http from 'node:http';
import https from 'node:https';

export const BASE_URL = (process.env.BASE_URL || 'http://localhost:3191').replace(/\/+$/, '');

export type RawResponse = {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
};

export function rawRequest(
  pathname: string,
  { method = 'GET', host, timeoutMs = 30_000 }: { method?: string; host?: string; timeoutMs?: number } = {},
): Promise<RawResponse> {
  const url = new URL(pathname, `${BASE_URL}/`);
  const lib = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method,
        headers: { 'user-agent': 'itemba-e2e/1.0', ...(host ? { host } : {}) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on('error', reject);
      },
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout ${method} ${pathname}`)));
    req.on('error', reject);
    req.end();
  });
}

export function headerValue(headers: http.IncomingHttpHeaders, name: string): string | null {
  const v = headers[name.toLowerCase()];
  if (v === undefined) return null;
  return Array.isArray(v) ? v.join(', ') : String(v);
}

/** Width/height from a PNG's IHDR chunk, or null when the bytes are not a PNG. */
export function pngSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** Inline `style="…opacity:0…"` attributes in server HTML (framer-motion's initial state). */
export function inlineOpacityZero(html: string): string[] {
  const styles = html.match(/style="[^"]*"/g) || [];
  return styles.filter((s) => /opacity:\s*0(?![.\d])/.test(s));
}
