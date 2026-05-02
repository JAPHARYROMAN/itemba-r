import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { TaxFilingEngineService } from './tax-filing-engine.service';
import { TaxFilingEngineController } from './tax-filing-engine.controller';

@Module({
  imports: [PrismaModule],
  providers: [TaxFilingEngineService],
  controllers: [TaxFilingEngineController],
  exports: [TaxFilingEngineService],
})
export class TaxFilingEngineModule {}
