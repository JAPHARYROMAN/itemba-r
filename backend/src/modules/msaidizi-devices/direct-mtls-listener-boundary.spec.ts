import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { assertDirectDeviceMtlsListener } from './direct-mtls-peer';

describe('direct device listener binding', () => {
  const enabled = {
    MSAIDIZI_DIRECT_MTLS_ENABLED: 'true',
    MSAIDIZI_DIRECT_MTLS_PORT: '3443',
  } as NodeJS.ProcessEnv;

  it('accepts only the configured dedicated listener port when enabled', () => {
    expect(() => assertDirectDeviceMtlsListener(request(3443), enabled)).not.toThrow();
    expect(() => assertDirectDeviceMtlsListener(request(3001), enabled)).toThrow(
      UnauthorizedException,
    );
    expect(() => assertDirectDeviceMtlsListener(request(3444), enabled)).toThrow(
      'only on the dedicated mTLS listener',
    );
  });

  it('leaves disabled-mode rejection to the existing feature/service gates', () => {
    expect(() =>
      assertDirectDeviceMtlsListener(request(3001), {
        MSAIDIZI_DIRECT_MTLS_ENABLED: 'false',
      } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });
});

function request(localPort: number): Request {
  return { socket: { localPort } } as unknown as Request;
}
