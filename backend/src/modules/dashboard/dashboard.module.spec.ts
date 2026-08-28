import { Test } from '@nestjs/testing';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { SensitiveAccessInterceptor } from '../../common/interceptors/sensitive-access.interceptor';
import { PrismaService } from '../../prisma/prisma.service';
import { DashboardController } from './dashboard.controller';
import { DashboardModule } from './dashboard.module';

describe('DashboardModule sensitive boundary wiring', () => {
  it('compiles the controller and its sensitive interceptor dependencies', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [DashboardModule] })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();

    expect(moduleRef.get(DashboardController)).toBeInstanceOf(DashboardController);
    expect(moduleRef.get(AuditLogsService)).toBeInstanceOf(AuditLogsService);
    expect(moduleRef.get(SensitiveAccessInterceptor, { strict: false })).toBeInstanceOf(
      SensitiveAccessInterceptor,
    );

    await moduleRef.close();
  });
});
