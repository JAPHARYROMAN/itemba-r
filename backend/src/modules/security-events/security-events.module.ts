import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { SecurityEventsController } from './security-events.controller';
import { SecurityEventsService } from './security-events.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [SecurityEventsController],
  providers: [SecurityEventsService],
  exports: [SecurityEventsService],
})
export class SecurityEventsModule {}
