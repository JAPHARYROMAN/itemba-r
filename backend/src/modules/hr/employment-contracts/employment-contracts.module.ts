import { Module } from '@nestjs/common';
import { EmploymentContractsController } from './employment-contracts.controller';
import { EmploymentContractsService } from './employment-contracts.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logs/audit-logs.module';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [EmploymentContractsController],
  providers: [EmploymentContractsService],
  exports: [EmploymentContractsService],
})
export class EmploymentContractsModule {}
