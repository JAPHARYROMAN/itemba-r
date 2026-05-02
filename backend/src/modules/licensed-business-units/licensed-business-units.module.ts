import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { LicensedBusinessUnitsService } from './licensed-business-units.service';
import { LicensedBusinessUnitsController } from './licensed-business-units.controller';
import { CompanyScopeService } from '../../common/services';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  providers: [LicensedBusinessUnitsService, CompanyScopeService],
  controllers: [LicensedBusinessUnitsController],
  exports: [LicensedBusinessUnitsService],
})
export class LicensedBusinessUnitsModule {}
