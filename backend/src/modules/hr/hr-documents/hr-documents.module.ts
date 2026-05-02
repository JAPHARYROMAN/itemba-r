import { Module } from '@nestjs/common';
import { HrDocumentsController } from './hr-documents.controller';
import { HrDocumentsService } from './hr-documents.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logs/audit-logs.module';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [HrDocumentsController],
  providers: [HrDocumentsService],
  exports: [HrDocumentsService],
})
export class HrDocumentsModule {}
