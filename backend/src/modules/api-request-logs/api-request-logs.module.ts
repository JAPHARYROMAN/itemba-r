import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CompanyScopeService } from '../../common/services';
import { ApiRequestLogsController } from './api-request-logs.controller';
import { ApiRequestLogsService } from './api-request-logs.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [ApiRequestLogsController],
  providers: [ApiRequestLogsService, CompanyScopeService],
  exports: [ApiRequestLogsService],
})
export class ApiRequestLogsModule {}
