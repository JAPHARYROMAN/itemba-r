import { Module } from '@nestjs/common';
import { EmployeeDeductionsController } from './employee-deductions.controller';
import { EmployeeDeductionsService } from './employee-deductions.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logs/audit-logs.module';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [EmployeeDeductionsController],
  providers: [EmployeeDeductionsService],
  exports: [EmployeeDeductionsService],
})
export class EmployeeDeductionsModule {}
