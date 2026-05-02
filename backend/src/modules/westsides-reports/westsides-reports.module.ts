import { Module } from '@nestjs/common';
import { WestsidesReportsService } from './westsides-reports.service';
import { WestsidesReportsController } from './westsides-reports.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { CompanyScopeService } from '../../common/services/company-scope.service';

@Module({
  imports: [PrismaModule],
  controllers: [WestsidesReportsController],
  providers: [WestsidesReportsService, CompanyScopeService],
  exports: [WestsidesReportsService],
})
export class WestsidesReportsModule {}
