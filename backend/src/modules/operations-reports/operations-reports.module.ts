import { Module } from '@nestjs/common';
import { OperationsReportsService } from './operations-reports.service';
import { OperationsReportsController } from './operations-reports.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { CompanyScopeService } from '../../common/services';

@Module({
  imports: [PrismaModule],
  controllers: [OperationsReportsController],
  providers: [OperationsReportsService, CompanyScopeService],
  exports: [OperationsReportsService],
})
export class OperationsReportsModule {}
