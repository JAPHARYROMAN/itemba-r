import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { IntegrationEventsController } from './integration-events.controller';
import { IntegrationEventsService } from './integration-events.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [IntegrationEventsController],
  providers: [IntegrationEventsService],
  exports: [IntegrationEventsService],
})
export class IntegrationEventsModule {}
