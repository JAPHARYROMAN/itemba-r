import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CompanyScopeService } from '../../common/services';
import { ProcurementController } from './procurement.controller';
import { ProcurementService } from './procurement.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [ProcurementController],
  providers: [ProcurementService, CompanyScopeService],
  exports: [ProcurementService],
})
export class ProcurementModule {}
