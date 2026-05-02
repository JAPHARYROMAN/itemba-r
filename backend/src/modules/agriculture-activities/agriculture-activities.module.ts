import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { AgricultureActivitiesService } from './agriculture-activities.service';
import { AgricultureActivitiesController } from './agriculture-activities.controller';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  providers: [AgricultureActivitiesService],
  controllers: [AgricultureActivitiesController],
  exports: [AgricultureActivitiesService],
})
export class AgricultureActivitiesModule {}
