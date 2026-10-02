import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CompanyScopeService } from '../../common/services/company-scope.service';
import { PartyBalanceController } from './party-balance.controller';
import { PartyBalanceService } from './party-balance.service';

/** Depends only on Prisma and company scope, so any module can import it without a cycle. */
@Module({
  imports: [PrismaModule],
  controllers: [PartyBalanceController],
  providers: [PartyBalanceService, CompanyScopeService],
  exports: [PartyBalanceService],
})
export class PartyBalanceModule {}
