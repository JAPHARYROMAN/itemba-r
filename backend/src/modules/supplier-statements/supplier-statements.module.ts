import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CompanyScopeService } from '../../common/services';
import { SupplierStatementsController } from './supplier-statements.controller';
import { SupplierStatementsService } from './supplier-statements.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [SupplierStatementsController],
  providers: [SupplierStatementsService, CompanyScopeService],
  exports: [SupplierStatementsService],
})
export class SupplierStatementsModule {}
