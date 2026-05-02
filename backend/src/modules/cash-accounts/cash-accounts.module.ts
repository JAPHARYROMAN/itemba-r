import { Module } from '@nestjs/common';
import { CashAccountsService } from './cash-accounts.service';
import { CashAccountsController } from './cash-accounts.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CompanyScopeService } from '../../common/services';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [CashAccountsController],
  providers: [CashAccountsService, CompanyScopeService],
  exports: [CashAccountsService],
})
export class CashAccountsModule {}
