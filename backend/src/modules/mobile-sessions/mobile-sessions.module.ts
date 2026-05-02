import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { MobileSessionsController } from './mobile-sessions.controller';
import { MobileSessionsService } from './mobile-sessions.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [MobileSessionsController],
  providers: [MobileSessionsService],
  exports: [MobileSessionsService],
})
export class MobileSessionsModule {}
