import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CompanyScopeService } from '../../common/services';
import { CustomerStatementsController } from './customer-statements.controller';
import { CustomerStatementsService } from './customer-statements.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [CustomerStatementsController],
  providers: [CustomerStatementsService, CompanyScopeService],
  exports: [CustomerStatementsService],
})
export class CustomerStatementsModule {}
