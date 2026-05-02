import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ProcurementPlansController } from './procurement-plans.controller';
import { ProcurementPlansService } from './procurement-plans.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [ProcurementPlansController],
  providers: [ProcurementPlansService],
  exports: [ProcurementPlansService],
})
export class ProcurementPlansModule {}