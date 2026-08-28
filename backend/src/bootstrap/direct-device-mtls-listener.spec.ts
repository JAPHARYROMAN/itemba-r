import { isDedicatedDeviceMtlsPath } from './direct-device-mtls-listener';

describe('dedicated direct-device mTLS route boundary', () => {
  const apiPrefix = '/api/v1';

  it.each([
    '/api/v1/msaidizi/devices/pairing/complete',
    '/api/v1/msaidizi/devices/supervisor-enrollment/complete?retry=1',
    '/api/v1/msaidizi/devices/channel/poll',
    '/api/v1/msaidizi/devices/channel/result',
    '/api/v1/msaidizi/update-supervisor/channel/poll',
    '/api/v1/msaidizi/update-supervisor/channel/deployments/deployment-1/artifact',
    '/api/v1/msaidizi/recovery-supervisor/channel/result',
    '/api/v1/msaidizi/audit-signer/channel/checkpoint',
  ])('allows only an enumerated direct-certificate route: %s', (url) => {
    expect(isDedicatedDeviceMtlsPath(url, apiPrefix)).toBe(true);
  });

  it.each([
    undefined,
    '',
    '/api/v1/msaidizi/devices',
    '/api/v1/msaidizi/devices/kill-all',
    '/api/v1/msaidizi/recovery-commands',
    '/api/v1/msaidizi/update-verifier/runs/poll',
    '/api/v1/auth/login',
    '/api/v1/msaidizi/devices/channel',
    '/api/v1/msaidizi/devices/channelish/poll',
    '/api/v1/msaidizi/devices/channel//poll',
    '/api/v1/msaidizi/devices/channel/../kill-all',
    '/api/v1/msaidizi/devices/channel/%2e%2e/kill-all',
    '/api/v1/msaidizi/devices/channel%2fpoll',
    '/api/v1/msaidizi/devices/channel\\poll',
    '//api/v1/msaidizi/devices/channel/poll',
    '/other/msaidizi/devices/channel/poll',
  ])('rejects non-channel and ambiguous raw paths: %s', (url) => {
    expect(isDedicatedDeviceMtlsPath(url, apiPrefix)).toBe(false);
  });
});
