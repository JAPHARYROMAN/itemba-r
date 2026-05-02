import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { LaunchAssessmentsController } from './launch-assessments.controller';
import { LaunchAssessmentsService } from './launch-assessments.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [LaunchAssessmentsController],
  providers: [LaunchAssessmentsService],
  exports: [LaunchAssessmentsService],
})
export class LaunchAssessmentsModule {}
