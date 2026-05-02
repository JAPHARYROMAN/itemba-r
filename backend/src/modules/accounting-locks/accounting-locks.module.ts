import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CompanyScopeService } from '../../common/services';
import { AccountingLocksController } from './accounting-locks.controller';
import { AccountingLocksService } from './accounting-locks.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [AccountingLocksController],
  providers: [AccountingLocksService, CompanyScopeService],
  exports: [AccountingLocksService],
})
export class AccountingLocksModule {}
