import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { SupportTicketCommentsController } from './support-ticket-comments.controller';
import { SupportTicketCommentsService } from './support-ticket-comments.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [SupportTicketCommentsController],
  providers: [SupportTicketCommentsService],
  exports: [SupportTicketCommentsService],
})
export class SupportTicketCommentsModule {}
