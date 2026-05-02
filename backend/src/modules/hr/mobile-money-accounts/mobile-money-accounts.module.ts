import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logs/audit-logs.module';
import { MobileMoneyAccountsController } from './mobile-money-accounts.controller';
import { MobileMoneyAccountsService } from './mobile-money-accounts.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [MobileMoneyAccountsController],
  providers: [MobileMoneyAccountsService],
  exports: [MobileMoneyAccountsService],
})
export class MobileMoneyAccountsModule {}
