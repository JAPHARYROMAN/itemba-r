import { MODULE_METADATA } from '@nestjs/common/constants';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { MsaidiziTaskScopeGuard } from './common/guards/msaidizi-task-scope.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { RolesGuard } from './common/guards/roles.guard';

// This is a metadata-only import test. Do not let a developer .env that enables
// Msaidizi turn importing the module into a demand for real operator-owned legal
// evidence. Operational boot and every provider call verify that evidence in
// their own tests; this suite never starts the application or a model client.
const priorMsaidiziEnabled = process.env.MSAIDIZI_ENABLED;
process.env.MSAIDIZI_ENABLED = 'false';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AppModule } = require('./app.module') as typeof import('./app.module');
if (priorMsaidiziEnabled === undefined) delete process.env.MSAIDIZI_ENABLED;
else process.env.MSAIDIZI_ENABLED = priorMsaidiziEnabled;

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
