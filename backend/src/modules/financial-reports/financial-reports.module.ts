import { Module } from '@nestjs/common';
import { FinancialReportsService } from './financial-reports.service';
import { FinancialReportsController } from './financial-reports.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { CompanyScopeService } from '../../common/services';

import { PartyBalanceModule } from '../party-balance/party-balance.module';
import { AccountResolverService } from '../../common/services/account-resolver.service';
@Module({
  imports: [PrismaModule, PartyBalanceModule],
  controllers: [FinancialReportsController],
  providers: [FinancialReportsService, CompanyScopeService, AccountResolverService],
  exports: [FinancialReportsService],
})
export class FinancialReportsModule {}
