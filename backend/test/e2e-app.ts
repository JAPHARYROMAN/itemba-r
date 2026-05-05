import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { PrismaExceptionFilter } from '../src/common/filters/prisma-exception.filter';

const allowAllThrottlerGuard: Pick<ThrottlerGuard, 'canActivate'> = {
  canActivate: async () => true,
};

let throttleGuardPatched = false;

type CreateE2eAppOptions = {
  useProductionPipeline?: boolean;
};

function disableThrottleGuardForE2e() {
  if (throttleGuardPatched) return;
  ThrottlerGuard.prototype.canActivate = allowAllThrottlerGuard.canActivate;
  throttleGuardPatched = true;
}

export async function createE2eApp(options: CreateE2eAppOptions = {}): Promise<INestApplication> {
  disableThrottleGuardForE2e();

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideGuard(ThrottlerGuard)
    .useValue(allowAllThrottlerGuard)
    .compile();

  const app = moduleFixture.createNestApplication();
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
    app.useGlobalFilters(new HttpExceptionFilter(), new PrismaExceptionFilter());
  }
  await app.init();
  return app;
}
