import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logs/audit-logs.module';
import { MedicalExamRecordsController } from './medical-exam-records.controller';
import { MedicalExamRecordsService } from './medical-exam-records.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [MedicalExamRecordsController],
  providers: [MedicalExamRecordsService],
  exports: [MedicalExamRecordsService],
})
export class MedicalExamRecordsModule {}
