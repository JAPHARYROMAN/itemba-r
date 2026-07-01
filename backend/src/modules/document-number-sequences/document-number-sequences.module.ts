import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CompanyScopeService } from '../../common/services';
import { DocumentNumberSequencesController } from './document-number-sequences.controller';
import { DocumentNumberSequencesService } from './document-number-sequences.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [DocumentNumberSequencesController],
  providers: [DocumentNumberSequencesService, CompanyScopeService],
  exports: [DocumentNumberSequencesService],
})
export class DocumentNumberSequencesModule {}