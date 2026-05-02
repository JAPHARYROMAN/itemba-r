import { Module } from '@nestjs/common';
import { EmployeeAllowancesController } from './employee-allowances.controller';
import { EmployeeAllowancesService } from './employee-allowances.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logs/audit-logs.module';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [EmployeeAllowancesController],
  providers: [EmployeeAllowancesService],
  exports: [EmployeeAllowancesService],
})
export class EmployeeAllowancesModule {}
