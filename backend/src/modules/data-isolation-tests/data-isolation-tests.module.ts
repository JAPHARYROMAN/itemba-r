import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { DataIsolationTestsController } from './data-isolation-tests.controller';
import { DataIsolationTestsService } from './data-isolation-tests.service';
import { CompanyScopeService } from '../../common/services';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [DataIsolationTestsController],
  providers: [DataIsolationTestsService, CompanyScopeService],
  exports: [DataIsolationTestsService],
})
export class DataIsolationTestsModule {}
