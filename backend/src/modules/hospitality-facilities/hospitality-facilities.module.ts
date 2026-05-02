import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { HospitalityFacilitiesService } from './hospitality-facilities.service';
import { HospitalityFacilitiesController } from './hospitality-facilities.controller';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  providers: [HospitalityFacilitiesService],
  controllers: [HospitalityFacilitiesController],
  exports: [HospitalityFacilitiesService],
})
export class HospitalityFacilitiesModule {}
