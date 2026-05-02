import { Module } from '@nestjs/common';
import { AlertEventsController } from './alert-events.controller';
import { AlertEventsService } from './alert-events.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [AlertEventsController],
  providers: [AlertEventsService],
  exports: [AlertEventsService],
})
export class AlertEventsModule {}
