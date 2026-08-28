import { MODULE_METADATA } from '@nestjs/common/constants';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { MsaidiziTaskScopeGuard } from './common/guards/msaidizi-task-scope.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { RolesGuard } from './common/guards/roles.guard';

// A metadata-only import test, but importing the module still runs
// `ConfigModule.forRoot({ validate })`, so the environment has to be one that
// validation accepts before a single assertion can run.
//
// Two different hazards, and only the second was handled before:
//
//   - a developer .env that ENABLES Msaidizi, which would turn importing the
//     module into a demand for real operator-owned legal evidence. Operational
//     boot and every provider call verify that evidence in their own tests;
//     this suite never starts the application or a model client.
//   - a machine with NO .env at all, which is every CI runner. There the JWT
//     secrets are simply absent, validation throws at import, and the suite
//     fails on an error that has nothing to do with guard order. It passed
//     locally only because backend/.env exists and is gitignored.
//
// So the minimum a development config requires is supplied here, deterministically
// rather than inherited, and restored afterwards so no other suite sees it.
const IMPORT_ENVIRONMENT: Readonly<Record<string, string>> = {
  DATABASE_URL: 'postgres://localhost/itemba-guard-order-test',
  JWT_ACCESS_SECRET: 'guard-order-access-secret-at-least-32-characters',
  JWT_REFRESH_SECRET: 'guard-order-refresh-secret-at-least-32-characters',
  MSAIDIZI_ENABLED: 'false',
};

const priorEnvironment = new Map<string, string | undefined>();
for (const [key, value] of Object.entries(IMPORT_ENVIRONMENT)) {
  priorEnvironment.set(key, process.env[key]);
  process.env[key] = value;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AppModule } = require('./app.module') as typeof import('./app.module');
for (const [key, prior] of priorEnvironment) {
  if (prior === undefined) delete process.env[key];
  else process.env[key] = prior;
}

describe('AppModule global guard order', () => {
  it('keeps permission evaluation after authentication, task scope, and roles', () => {
    const providers = (Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AppModule) ?? []) as Array<{
      provide?: unknown;
      useClass?: unknown;
    }>;
    const guardOrder = providers
      .filter((provider) => provider?.provide === APP_GUARD)
      .map((provider) => provider.useClass);

    expect(guardOrder).toEqual([
      ThrottlerGuard,
      JwtAuthGuard,
      MsaidiziTaskScopeGuard,
      RolesGuard,
      PermissionsGuard,
    ]);
  });
});
