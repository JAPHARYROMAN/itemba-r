import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CompanyScopeService } from '../../common/services';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [CrmController],
  providers: [CrmService, CompanyScopeService],
  exports: [CrmService],
})
export class CrmModule {}
