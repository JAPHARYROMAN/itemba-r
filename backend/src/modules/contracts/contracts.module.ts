import { Module } from '@nestjs/common';
import { ContractsService } from './contracts.service';
import { ContractsController } from './contracts.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CompanyScopeService } from '../../common/services';

import { PartyExistsService } from '../../common/services/party-exists.service';
@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [ContractsController],
  providers: [ContractsService, CompanyScopeService, PartyExistsService],
  exports: [ContractsService],
})
export class ContractsModule {}
