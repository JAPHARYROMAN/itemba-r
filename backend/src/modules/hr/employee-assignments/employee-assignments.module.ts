import { Module } from '@nestjs/common';
import { EmployeeAssignmentsController } from './employee-assignments.controller';
import { EmployeeAssignmentsService } from './employee-assignments.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logs/audit-logs.module';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [EmployeeAssignmentsController],
  providers: [EmployeeAssignmentsService],
  exports: [EmployeeAssignmentsService],
})
export class EmployeeAssignmentsModule {}
