import { Module } from '@nestjs/common';
import { CreditNotesService } from './credit-notes.service';
import { CreditNotesController } from './credit-notes.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CompanyScopeService } from '../../common/services';

/**
 * PostingEngineService + AccountResolverService are provided by the @Global
 * AccountingEngineModule; EntityCodeGeneratorService by the @Global
 * EntityCodeGeneratorModule — so they need not be imported here (same as the
 * receivables module).
 */
@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [CreditNotesController],
  providers: [CreditNotesService, CompanyScopeService],
  exports: [CreditNotesService],
})
export class CreditNotesModule {}
