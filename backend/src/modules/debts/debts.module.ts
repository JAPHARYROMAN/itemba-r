import { Module } from '@nestjs/common';
import { DebtsService } from './debts.service';
import { DebtsController } from './debts.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CompanyScopeService } from '../../common/services';

import { PartyExistsService } from '../../common/services/party-exists.service';
@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [DebtsController],
  providers: [DebtsService, CompanyScopeService, PartyExistsService],
  exports: [DebtsService],
})
export class DebtsModule {}
