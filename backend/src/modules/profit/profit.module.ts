import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CompanyScopeService } from '../../common/services';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ProfitController } from './profit.controller';
import { ProfitService } from './profit.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [ProfitController],
  providers: [ProfitService, CompanyScopeService],
  exports: [ProfitService],
})
export class ProfitModule {}
