import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { IntegrationMappingsController } from './integration-mappings.controller';
import { IntegrationMappingsService } from './integration-mappings.service';
import { CompanyScopeService } from '../../common/services';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [IntegrationMappingsController],
  providers: [IntegrationMappingsService, CompanyScopeService],
  exports: [IntegrationMappingsService],
})
export class IntegrationMappingsModule {}
