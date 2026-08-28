import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { PersistenceSafeLoggerService, PersistenceSecretGuard } from './common/services';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import type { HttpsOptions } from '@nestjs/common/interfaces/external/https-options.interface';
import { createSecureContext } from 'node:tls';
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { isIP } from 'node:net';
import { createHash, createPrivateKey, createPublicKey, X509Certificate } from 'node:crypto';
import { createServer as createHttpsServer } from 'node:https';
import type { Server as HttpsServer } from 'node:https';
import type { RequestListener } from 'node:http';
import { startDedicatedDeviceMtlsListener } from './bootstrap/direct-device-mtls-listener';

async function bootstrap() {
  const isProd = process.env.NODE_ENV === 'production';

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Hold bootstrap logs in memory until the registry-aware logger is bound.
    // This closes the otherwise-small interval in which provider construction
    // precedes `app.useLogger()`.
    bufferLogs: true,
    logger: isProd ? ['error', 'warn', 'log'] : ['error', 'warn', 'log', 'debug'],
  });

  // Table-PDF exports post the full row matrix (worst case ~3MB); the express
  // default 100kb JSON limit would reject them.
  app.useBodyParser('json', { limit: '4mb' });

  const config = app.get(ConfigService);
  const port = config.get<number>('PORT', 3001);
  const apiPrefix = config.get<string>('API_PREFIX', 'api/v1');
  const corsOrigin = config.getOrThrow<string>('CORS_ORIGIN');

  if (isProd) {
    app.set('trust proxy', 1);
  }

  app.use(
    helmet({
      hsts: isProd ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
    }),
  );
  const corsOrigins = corsOrigin
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (
    corsOrigins.length === 0 ||
    corsOrigins.some((origin) => origin === '*' || origin.includes('*'))
  ) {
    throw new Error('CORS_ORIGIN cannot be empty or wildcard when credentialed CORS is enabled');
  }
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

  app.setGlobalPrefix(apiPrefix);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Order matters: Nest checks global filters in reverse registration order.
  const persistenceSecrets = app.get(PersistenceSecretGuard);
  app.useLogger(app.get(PersistenceSafeLoggerService));
  app.useGlobalFilters(
    new HttpExceptionFilter(persistenceSecrets),
    new PrismaExceptionFilter(persistenceSecrets),
  );
  app.useGlobalInterceptors(new LoggingInterceptor(persistenceSecrets), new TransformInterceptor());

  if (!isProd) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('ITEMBA-R API')
      .setDescription('Group Digital Governance & Enterprise Management System')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup(`${apiPrefix}/docs`, app, document);
  }

  await app.listen(port);
  let deviceListener: Awaited<ReturnType<typeof startDedicatedDeviceMtlsListener>> = null;
  let evaluatorServer: HttpsServer | null;
  try {
    const evaluatorPort = truthy(process.env.MSAIDIZI_EVALUATOR_MTLS_ENABLED)
      ? Number(process.env.MSAIDIZI_EVALUATOR_MTLS_PORT ?? 3444)
      : undefined;
    deviceListener = await startDedicatedDeviceMtlsListener(
      app,
      process.env,
      apiPrefix,
      port,
      evaluatorPort,
    );
    evaluatorServer = await startEvaluatorMtlsListener(app, process.env, apiPrefix, port);
  } catch (error) {
    deviceListener?.server.close();
    await app.close();
    throw error;
  }
  if (deviceListener || evaluatorServer) {
    app.getHttpServer().once('close', () => {
      deviceListener?.server.close();
      evaluatorServer?.close();
    });
  }

  const logger = new Logger('Bootstrap');
  logger.log(`🚀 ITEMBA-R API running at http://localhost:${port}/${apiPrefix}`);
  if (deviceListener) {
    logger.log(
      `🔐 Msaidizi direct device mTLS listener at https://${deviceListener.bindAddress}:${deviceListener.port}/${apiPrefix}`,
    );
  }
  if (!isProd) logger.log(`📘 Swagger at http://localhost:${port}/${apiPrefix}/docs`);
}

async function startEvaluatorMtlsListener(
  app: NestExpressApplication,
  environment: NodeJS.ProcessEnv,
  apiPrefix: string,
  ordinaryPort: number,
) {
  const httpsOptions = evaluatorMtlsHttpsOptions(environment);
  if (!httpsOptions) return null;
  const port = Number(environment.MSAIDIZI_EVALUATOR_MTLS_PORT ?? 3444);
  const bindAddress = (environment.MSAIDIZI_EVALUATOR_MTLS_BIND_ADDRESS ?? '127.0.0.1').trim();
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535 || port === ordinaryPort) {
    throw new Error('The evaluator mTLS listener port is invalid or not distinct.');
  }
  if (!bindAddress || isIP(bindAddress) === 0) {
    throw new Error('The evaluator mTLS bind address must be a literal IP address.');
  }
  const verifierPrefix = `/${apiPrefix.replace(/^\/+|\/+$/g, '')}/msaidizi/update-verifier`;
  const express = app.getHttpAdapter().getInstance() as RequestListener;
  const server = createHttpsServer(httpsOptions, (request, response) => {
    const pathname = (request.url ?? '').split('?', 1)[0];
    if (pathname !== verifierPrefix && !pathname.startsWith(`${verifierPrefix}/`)) {
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
  return server;
}

function evaluatorMtlsHttpsOptions(environment: NodeJS.ProcessEnv): HttpsOptions | null {
  if (!truthy(environment.MSAIDIZI_UPDATE_EVALUATOR_ENABLED)) return null;
  if (!truthy(environment.MSAIDIZI_EVALUATOR_MTLS_ENABLED)) {
    throw new Error('The signed evaluator requires its dedicated mTLS listener.');
  }
  const key = readExternalTlsFile(environment, 'MSAIDIZI_EVALUATOR_MTLS_SERVER_KEY_PATH');
  const cert = readExternalTlsFile(environment, 'MSAIDIZI_EVALUATOR_MTLS_SERVER_CERT_PATH');
  const ca = readExternalTlsFile(environment, 'MSAIDIZI_EVALUATOR_MTLS_CLIENT_CA_PATH');
  try {
    const serverCertificate = new X509Certificate(cert);
    const clientCa = new X509Certificate(ca);
    const now = Date.now();
    if (
      serverCertificate.ca ||
      !clientCa.ca ||
      serverCertificate.publicKey.asymmetricKeyType !== 'ec' ||
      serverCertificate.publicKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1' ||
      clientCa.publicKey.asymmetricKeyType !== 'ec' ||
      clientCa.publicKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1' ||
      Date.parse(serverCertificate.validFrom) > now ||
      Date.parse(serverCertificate.validTo) <= now ||
      Date.parse(clientCa.validFrom) > now ||
      Date.parse(clientCa.validTo) <= now
    ) {
      throw new Error('evaluator certificate policy invalid');
    }
    createSecureContext({ key, cert, ca });
    const clientSpkiPin = requiredSha256(
      environment.MSAIDIZI_EVALUATOR_CLIENT_SPKI_SHA256,
      'MSAIDIZI_EVALUATOR_CLIENT_SPKI_SHA256',
    );
    const clientCertificatePin = requiredSha256(
      environment.MSAIDIZI_EVALUATOR_CLIENT_CERT_SHA256,
      'MSAIDIZI_EVALUATOR_CLIENT_CERT_SHA256',
    );
    const serverSpki = publicSpkiSha256(serverCertificate.publicKey);
    const clientCaSpki = publicSpkiSha256(clientCa.publicKey);
    const serverCertificateDigest = certificateSha256(serverCertificate);
    const clientCaCertificateDigest = certificateSha256(clientCa);
    const evaluatorSpkis = new Set([serverSpki, clientCaSpki, clientSpkiPin]);
    if (
      evaluatorSpkis.size !== 3 ||
      serverCertificateDigest === clientCaCertificateDigest ||
      clientCertificatePin === serverCertificateDigest ||
      clientCertificatePin === clientCaCertificateDigest
    ) {
      throw new Error('evaluator server, client CA, and client identities are reused');
    }
    for (const name of [
      'MSAIDIZI_DIRECT_MTLS_SERVER_CERT_PATH',
      'MSAIDIZI_DIRECT_MTLS_CLIENT_CA_PATH',
    ] as const) {
      const candidatePath = environment[name]?.trim();
      if (!candidatePath) continue;
      if (!isAbsolute(candidatePath)) throw new Error(`${name} is not absolute`);
      const foreignCertificate = new X509Certificate(readFileSync(candidatePath));
      if (
        evaluatorSpkis.has(publicSpkiSha256(foreignCertificate.publicKey)) ||
        serverCertificateDigest === certificateSha256(foreignCertificate) ||
        clientCaCertificateDigest === certificateSha256(foreignCertificate) ||
        clientCertificatePin === certificateSha256(foreignCertificate)
      ) {
        throw new Error(`${name} reuses an evaluator certificate or key`);
      }
    }
    for (const name of [
      'MSAIDIZI_ACTION_SIGNING_KEY_PATH',
      'MSAIDIZI_UPDATE_SIGNING_KEY_PATH',
      'MSAIDIZI_RECOVERY_SIGNING_KEY_PATH',
      'MSAIDIZI_DIRECT_MTLS_SERVER_KEY_PATH',
    ] as const) {
      const candidatePath = environment[name]?.trim();
      if (!candidatePath) continue;
      if (!isAbsolute(candidatePath)) throw new Error(`${name} is not absolute`);
      const signingKey = createPrivateKey(readFileSync(candidatePath));
      if (evaluatorSpkis.has(publicSpkiSha256(createPublicKey(signingKey)))) {
        throw new Error(`${name} reuses an evaluator transport identity`);
      }
    }
  } catch {
    throw new Error('Dedicated evaluator mTLS key material or identity isolation is invalid.');
  }
  return { key, cert, ca, requestCert: true, rejectUnauthorized: true };
}

function requiredSha256(value: string | undefined, name: string): string {
  const normalized = (value ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) throw new Error(`${name} is invalid`);
  return normalized;
}

function publicSpkiSha256(key: ReturnType<typeof createPublicKey>): string {
  return createHash('sha256')
    .update(key.export({ type: 'spki', format: 'der' }))
    .digest('hex');
}

function certificateSha256(certificate: X509Certificate): string {
  return createHash('sha256').update(certificate.raw).digest('hex');
}

bootstrap();

function readExternalTlsFile(
  environment: NodeJS.ProcessEnv,
  key:
    | 'MSAIDIZI_EVALUATOR_MTLS_SERVER_KEY_PATH'
    | 'MSAIDIZI_EVALUATOR_MTLS_SERVER_CERT_PATH'
    | 'MSAIDIZI_EVALUATOR_MTLS_CLIENT_CA_PATH',
): Buffer {
  const path = environment[key]?.trim();
  if (!path || !isAbsolute(path)) {
    throw new Error(`${key} must name an absolute external file when evaluator mTLS is enabled.`);
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
