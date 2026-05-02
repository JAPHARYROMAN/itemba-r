import { Module } from '@nestjs/common';
import { TaxCodesController } from './tax-codes.controller';
import { TaxCodesService } from './tax-codes.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logs/audit-logs.module';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [TaxCodesController],
  providers: [TaxCodesService],
  exports: [TaxCodesService],
})
export class TaxCodesModule {}
