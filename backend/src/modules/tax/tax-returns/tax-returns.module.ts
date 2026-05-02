import { Module } from '@nestjs/common';
import { TaxReturnsController } from './tax-returns.controller';
import { TaxReturnsService } from './tax-returns.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logs/audit-logs.module';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [TaxReturnsController],
  providers: [TaxReturnsService],
  exports: [TaxReturnsService],
})
export class TaxReturnsModule {}
