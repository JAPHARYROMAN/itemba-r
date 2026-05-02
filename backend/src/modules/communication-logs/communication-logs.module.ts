import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CommunicationLogsController } from './communication-logs.controller';
import { CommunicationLogsService } from './communication-logs.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [CommunicationLogsController],
  providers: [CommunicationLogsService],
  exports: [CommunicationLogsService],
})
export class CommunicationLogsModule {}