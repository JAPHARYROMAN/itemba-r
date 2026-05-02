import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { BusinessLicensesService } from './business-licenses.service';
import { BusinessLicensesController } from './business-licenses.controller';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  providers: [BusinessLicensesService],
  controllers: [BusinessLicensesController],
  exports: [BusinessLicensesService],
})
export class BusinessLicensesModule {}
