import type { NestExpressApplication } from '@nestjs/platform-express';
import type { HttpsOptions } from '@nestjs/common/interfaces/external/https-options.interface';
import { createPrivateKey, X509Certificate } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https';
import type { RequestListener } from 'node:http';
import { isIP } from 'node:net';
import { isAbsolute } from 'node:path';
import { createSecureContext } from 'node:tls';

const DIRECT_CHANNEL_PREFIXES = [
  '/msaidizi/devices/channel',
  '/msaidizi/update-supervisor/channel',
  '/msaidizi/recovery-supervisor/channel',
  '/msaidizi/audit-signer/channel',
] as const;

const DIRECT_CHANNEL_EXACT_PATHS = new Set([
  '/msaidizi/devices/pairing/complete',
  '/msaidizi/devices/supervisor-enrollment/complete',
]);

export interface DedicatedDeviceMtlsListener {
  server: HttpsServer;
  port: number;
  bindAddress: string;
}

/**
 * Starts the only listener permitted to expose direct-certificate device and
 * trusted-supervisor routes. The ordinary API listener never receives the TLS
 * socket identity and therefore cannot authenticate these controllers.
 */
export async function startDedicatedDeviceMtlsListener(
  app: NestExpressApplication,
  environment: NodeJS.ProcessEnv,
  apiPrefix: string,
  ordinaryPort: number,
  evaluatorPort?: number,
): Promise<DedicatedDeviceMtlsListener | null> {
  const httpsOptions = directDeviceMtlsHttpsOptions(environment);
  if (!httpsOptions) return null;

  const port = Number(environment.MSAIDIZI_DIRECT_MTLS_PORT ?? 3443);
  const bindAddress = (environment.MSAIDIZI_DIRECT_MTLS_BIND_ADDRESS ?? '0.0.0.0').trim();
  if (
    !Number.isSafeInteger(port) ||
    port < 1 ||
    port > 65_535 ||
    port === ordinaryPort ||
    (evaluatorPort !== undefined && port === evaluatorPort)
  ) {
    throw new Error('The direct device mTLS listener port is invalid or not distinct.');
  }
  if (!bindAddress || isIP(bindAddress) === 0) {
    throw new Error('The direct device mTLS bind address must be a literal IP address.');
  }

  const normalizedApiPrefix = `/${apiPrefix.replace(/^\/+|\/+$/g, '')}`;
  const express = app.getHttpAdapter().getInstance() as RequestListener;
  const server = createHttpsServer(httpsOptions, (request, response) => {
    if (!isDedicatedDeviceMtlsPath(request.url, normalizedApiPrefix)) {
      response.statusCode = 404;
      response.setHeader('Content-Type', 'text/plain; charset=utf-8');
      response.end('Not found');
      return;
    }
    express(request, response);
  });
  server.headersTimeout = 15_000;
  server.requestTimeout = 300_000;
  server.maxHeadersCount = 100;
  await new Promise<void>((resolve, reject) => {
    const failed = (error: Error) => {
      server.close();
      reject(error);
    };
    server.once('error', failed);
    server.listen(port, bindAddress, () => {
      server.off('error', failed);
      resolve();
    });
  });
  return { server, port, bindAddress };
}

/** Raw-path allowlist. Encoded separators and alternate slash forms fail closed. */
export function isDedicatedDeviceMtlsPath(
  rawUrl: string | undefined,
  normalizedApiPrefix: string,
): boolean {
  const pathname = (rawUrl ?? '').split('?', 1)[0];
  if (
    !pathname.startsWith('/') ||
    pathname.includes('%') ||
    pathname.includes('\\') ||
    pathname.includes('//') ||
    pathname.split('/').some((segment) => segment === '.' || segment === '..') ||
    /[\u0000-\u001f\u007f]/.test(pathname)
  ) {
    return false;
  }
  const prefix = normalizedApiPrefix.endsWith('/')
    ? normalizedApiPrefix.slice(0, -1)
    : normalizedApiPrefix;
  if (!pathname.startsWith(`${prefix}/`)) return false;
  const route = pathname.slice(prefix.length);
  if (DIRECT_CHANNEL_EXACT_PATHS.has(route)) return true;
  return DIRECT_CHANNEL_PREFIXES.some((channelPrefix) => route.startsWith(`${channelPrefix}/`));
}

export function directDeviceMtlsHttpsOptions(environment: NodeJS.ProcessEnv): HttpsOptions | null {
  if (!truthy(environment.MSAIDIZI_DIRECT_MTLS_ENABLED)) return null;
  const key = readExternalTlsFile(environment, 'MSAIDIZI_DIRECT_MTLS_SERVER_KEY_PATH');
  const cert = readExternalTlsFile(environment, 'MSAIDIZI_DIRECT_MTLS_SERVER_CERT_PATH');
  const ca = readExternalTlsFile(environment, 'MSAIDIZI_DIRECT_MTLS_CLIENT_CA_PATH');
  try {
    const serverCertificate = new X509Certificate(cert);
    const clientCa = new X509Certificate(ca);
    const now = Date.now();
    if (
      serverCertificate.ca ||
      !clientCa.ca ||
      Date.parse(serverCertificate.validFrom) > now ||
      Date.parse(serverCertificate.validTo) <= now ||
      Date.parse(clientCa.validFrom) > now ||
      Date.parse(clientCa.validTo) <= now
    ) {
      throw new Error('certificate policy invalid');
    }
    createSecureContext({ key, cert, ca });
    if (truthy(environment.MSAIDIZI_DEVICE_CHANNEL_ENABLED)) {
      const actionKeyPath = environment.MSAIDIZI_ACTION_SIGNING_KEY_PATH?.trim();
      const serverKeyPath = environment.MSAIDIZI_DIRECT_MTLS_SERVER_KEY_PATH!.trim();
      if (
        !actionKeyPath ||
        !isAbsolute(actionKeyPath) ||
        realpathSync(actionKeyPath) === realpathSync(serverKeyPath)
      ) {
        throw new Error('action key isolation invalid');
      }
      const actionKey = createPrivateKey(readFileSync(actionKeyPath, 'utf8'));
      if (
        actionKey.asymmetricKeyType !== 'ec' ||
        actionKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1'
      ) {
        throw new Error('action key must be P-256');
      }
    }
  } catch {
    throw new Error('Direct mTLS or device action-signing key material is invalid.');
  }
  return {
    key,
    cert,
    ca,
    requestCert: true,
    // First trust deliberately accepts a self-signed device leaf. Pairing
    // proves possession with TLS Finished plus the single-use challenge; every
    // subsequent operation binds the exact persisted certificate and SPKI.
    rejectUnauthorized: false,
  };
}

function readExternalTlsFile(
  environment: NodeJS.ProcessEnv,
  key:
    | 'MSAIDIZI_DIRECT_MTLS_SERVER_KEY_PATH'
    | 'MSAIDIZI_DIRECT_MTLS_SERVER_CERT_PATH'
    | 'MSAIDIZI_DIRECT_MTLS_CLIENT_CA_PATH',
): Buffer {
  const path = environment[key]?.trim();
  if (!path || !isAbsolute(path)) {
    throw new Error(`${key} must name an absolute external file when direct mTLS is enabled.`);
  }
  try {
    if (!statSync(path).isFile()) throw new Error('not a file');
    return readFileSync(path);
  } catch {
    throw new Error(`${key} is not a readable file.`);
  }
}

function truthy(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes((value ?? '').trim().toLowerCase());
}
