import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { IntegrationConnectionsController } from './integration-connections.controller';
import { IntegrationConnectionsService } from './integration-connections.service';
import { CompanyScopeService, EncryptionService } from '../../common/services';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [IntegrationConnectionsController],
  providers: [IntegrationConnectionsService, EncryptionService, CompanyScopeService],
  exports: [IntegrationConnectionsService],
})
export class IntegrationConnectionsModule {}
