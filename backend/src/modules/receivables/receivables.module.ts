import { Module } from '@nestjs/common';
import { ReceivablesService } from './receivables.service';
import { ReceivablesController } from './receivables.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CompanyScopeService } from '../../common/services';
import { OrganizationScopeService } from '../../common/services/organization-scope.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [ReceivablesController],
  providers: [ReceivablesService, CompanyScopeService, OrganizationScopeService],
  exports: [ReceivablesService],
})
export class ReceivablesModule {}
