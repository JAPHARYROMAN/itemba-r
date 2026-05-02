import { Module } from '@nestjs/common';
import { FuelShiftCollectionsService } from './fuel-shift-collections.service';
import { FuelShiftCollectionsController } from './fuel-shift-collections.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CompanyScopeService } from '../../common/services';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [FuelShiftCollectionsController],
  providers: [FuelShiftCollectionsService, CompanyScopeService],
  exports: [FuelShiftCollectionsService],
})
export class FuelShiftCollectionsModule {}
