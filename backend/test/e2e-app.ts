import { INestApplication, LogLevel, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { PersistenceSafeLoggerService, PersistenceSecretGuard } from '../src/common/services';
import { PrismaExceptionFilter } from '../src/common/filters/prisma-exception.filter';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';
import { ModelClient } from '../src/modules/msaidizi/model-client';
import { CrudCoverageService } from '../src/modules/msaidizi/crud-coverage.service';

const allowAllThrottlerGuard: Pick<ThrottlerGuard, 'canActivate'> = {
  canActivate: async () => true,
};

let throttleGuardPatched = false;

type CreateE2eAppOptions = {
  useProductionPipeline?: boolean;
  modelClient?: ModelClient;
  /** Integration admission fixture only; never evidence of a signed release. */
  crudCoverage?: Pick<CrudCoverageService, 'report'>;
  logLevels?: LogLevel[];
};

function disableThrottleGuardForE2e() {
  if (throttleGuardPatched) return;
  ThrottlerGuard.prototype.canActivate = allowAllThrottlerGuard.canActivate;
  throttleGuardPatched = true;
}

export async function createE2eApp(options: CreateE2eAppOptions = {}): Promise<INestApplication> {
  disableThrottleGuardForE2e();

  const builder = Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideGuard(ThrottlerGuard)
    .useValue(allowAllThrottlerGuard);
  if (options.modelClient) builder.overrideProvider(ModelClient).useValue(options.modelClient);
  if (options.crudCoverage)
    builder.overrideProvider(CrudCoverageService).useValue(options.crudCoverage);
  const moduleFixture: TestingModule = await builder.compile();

  const app = moduleFixture.createNestApplication({ logger: options.logLevels });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe(
      options.useProductionPipeline
        ? {
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
            transformOptions: { enableImplicitConversion: true },
          }
        : { whitelist: true, transform: true },
    ),
  );
  if (options.useProductionPipeline) {
    const persistenceSecrets = app.get(PersistenceSecretGuard);
    const logger = app.get(PersistenceSafeLoggerService);
    if (options.logLevels) logger.setLogLevels(options.logLevels);
    app.useLogger(logger);
    app.useGlobalFilters(
      new HttpExceptionFilter(persistenceSecrets),
      new PrismaExceptionFilter(persistenceSecrets),
    );
    app.useGlobalInterceptors(new TransformInterceptor());
  }
  await app.init();
  return app;
}
