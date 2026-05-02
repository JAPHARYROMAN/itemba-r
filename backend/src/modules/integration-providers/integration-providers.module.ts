import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { IntegrationProvidersController } from './integration-providers.controller';
import { IntegrationProvidersService } from './integration-providers.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [IntegrationProvidersController],
  providers: [IntegrationProvidersService],
  exports: [IntegrationProvidersService],
})
export class IntegrationProvidersModule {}
