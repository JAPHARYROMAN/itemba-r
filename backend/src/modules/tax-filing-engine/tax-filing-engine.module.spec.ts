import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { EntityCodeGeneratorService } from '../entity-code-generator/entity-code-generator.service';
import { TaxFilingEngineModule } from './tax-filing-engine.module';
import { TaxFilingEngineService } from './tax-filing-engine.service';

@Global()
@Module({
  providers: [{ provide: EntityCodeGeneratorService, useValue: { next: jest.fn() } }],
  exports: [EntityCodeGeneratorService],
})
class TestEntityCodeModule {}

describe('TaxFilingEngineModule', () => {
  it('resolves the engine with its audit dependency through module imports', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TestEntityCodeModule, TaxFilingEngineModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(AuditLogsService)
      .useValue({ log: jest.fn() })
      .compile();

    expect(moduleRef.get(TaxFilingEngineService)).toBeInstanceOf(TaxFilingEngineService);
    expect(moduleRef.get(AuditLogsService)).toEqual({ log: expect.any(Function) });

    await moduleRef.close();
  });
});
