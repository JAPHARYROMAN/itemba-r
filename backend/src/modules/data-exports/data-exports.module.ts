import { Module } from '@nestjs/common';
import { DataExportsController } from './data-exports.controller';
import { DataExportsService } from './data-exports.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { CompanyScopeService } from '../../common/services';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [DataExportsController],
  providers: [DataExportsService, CompanyScopeService],
  exports: [DataExportsService],
})
export class DataExportsModule {}
