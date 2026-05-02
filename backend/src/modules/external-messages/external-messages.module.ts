import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ExternalMessagesController } from './external-messages.controller';
import { ExternalMessagesService } from './external-messages.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [ExternalMessagesController],
  providers: [ExternalMessagesService],
  exports: [ExternalMessagesService],
})
export class ExternalMessagesModule {}
