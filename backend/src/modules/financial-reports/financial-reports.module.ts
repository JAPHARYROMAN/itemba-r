import { Module } from '@nestjs/common';
import { FinancialReportsService } from './financial-reports.service';
import { FinancialReportsController } from './financial-reports.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { CompanyScopeService } from '../../common/services';

@Module({
  imports: [PrismaModule],
  controllers: [FinancialReportsController],
  providers: [FinancialReportsService, CompanyScopeService],
  exports: [FinancialReportsService],
})
export class FinancialReportsModule {}
