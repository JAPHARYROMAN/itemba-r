import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ActiveSessionsController } from './active-sessions.controller';
import { ActiveSessionsService } from './active-sessions.service';
import { CompanyScopeService } from '../../common/services';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [ActiveSessionsController],
  providers: [ActiveSessionsService, CompanyScopeService],
  exports: [ActiveSessionsService],
})
export class ActiveSessionsModule {}
