import { Module } from '@nestjs/common';
import { CompanyScopeService } from '../../../common/services';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logs/audit-logs.module';
import { LeaveBalancesController } from './leave-balances.controller';
import { LeaveBalancesService } from './leave-balances.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [LeaveBalancesController],
  providers: [LeaveBalancesService, CompanyScopeService],
  exports: [LeaveBalancesService],
})
export class LeaveBalancesModule {}
