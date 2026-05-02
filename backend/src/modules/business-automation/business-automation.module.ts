import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CompanyScopeService } from '../../common/services';
import { BusinessAutomationController } from './business-automation.controller';
import { BusinessAutomationService } from './business-automation.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [BusinessAutomationController],
  providers: [BusinessAutomationService, CompanyScopeService],
  exports: [BusinessAutomationService],
})
export class BusinessAutomationModule {}
