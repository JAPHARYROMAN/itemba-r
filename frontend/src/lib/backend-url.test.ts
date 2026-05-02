import { afterEach, describe, expect, it, vi } from 'vitest';
import { getBackendInternalUrl } from './backend-url';

describe('getBackendInternalUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('prefers BACKEND_INTERNAL_URL and trims trailing slash', () => {
    vi.stubEnv('BACKEND_INTERNAL_URL', 'http://backend:3001/api/v1/');
    vi.stubEnv('BACKEND_URL', 'http://legacy:3001/api/v1');

    expect(getBackendInternalUrl()).toBe('http://backend:3001/api/v1');
  });

  it('falls back to BACKEND_URL before the local default', () => {
    vi.stubEnv('BACKEND_URL', 'http://legacy:3001/api/v1/');

    expect(getBackendInternalUrl()).toBe('http://legacy:3001/api/v1');
  });

  it('uses the local backend URL when no server URL is configured', () => {
    vi.stubEnv('BACKEND_INTERNAL_URL', '');
    vi.stubEnv('BACKEND_URL', '');

    expect(getBackendInternalUrl()).toBe('http://localhost:3001/api/v1');
  });
});
