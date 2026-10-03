import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CompanyScopeService } from '../../common/services';
import { SupplierStatementsController } from './supplier-statements.controller';
import { SupplierStatementsService } from './supplier-statements.service';
import { GeneratedDocumentsModule } from '../generated-documents/generated-documents.module';

@Module({
  imports: [PrismaModule, AuditLogsModule, GeneratedDocumentsModule],
  controllers: [SupplierStatementsController],
  providers: [SupplierStatementsService, CompanyScopeService],
  exports: [SupplierStatementsService],
})
export class SupplierStatementsModule {}
