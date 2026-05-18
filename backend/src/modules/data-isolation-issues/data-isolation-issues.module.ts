import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { DataIsolationIssuesController } from './data-isolation-issues.controller';
import { DataIsolationIssuesService } from './data-isolation-issues.service';
import { CompanyScopeService } from '../../common/services';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [DataIsolationIssuesController],
  providers: [DataIsolationIssuesService, CompanyScopeService],
  exports: [DataIsolationIssuesService],
})
export class DataIsolationIssuesModule {}
