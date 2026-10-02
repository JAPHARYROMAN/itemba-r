import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PartyExistsService } from '../../common/services';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CommunicationLogsController } from './communication-logs.controller';
import { CommunicationLogsService } from './communication-logs.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [CommunicationLogsController],
  providers: [CommunicationLogsService, PartyExistsService],
  exports: [CommunicationLogsService],
})
export class CommunicationLogsModule {}
