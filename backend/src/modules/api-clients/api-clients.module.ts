import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CompanyScopeService } from '../../common/services';
import { ApiClientsController } from './api-clients.controller';
import { ApiClientsService } from './api-clients.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [ApiClientsController],
  providers: [ApiClientsService, CompanyScopeService],
  exports: [ApiClientsService],
})
export class ApiClientsModule {}
