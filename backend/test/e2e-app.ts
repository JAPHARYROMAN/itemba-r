import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AppModule } from '../src/app.module';

const allowAllThrottlerGuard: Pick<ThrottlerGuard, 'canActivate'> = {
  canActivate: async () => true,
};

let throttleGuardPatched = false;

function disableThrottleGuardForE2e() {
  if (throttleGuardPatched) return;
  ThrottlerGuard.prototype.canActivate = allowAllThrottlerGuard.canActivate;
  throttleGuardPatched = true;
}

export async function createE2eApp(): Promise<INestApplication> {
  disableThrottleGuardForE2e();

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideGuard(ThrottlerGuard)
    .useValue(allowAllThrottlerGuard)
    .compile();

  const app = moduleFixture.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return app;
}
