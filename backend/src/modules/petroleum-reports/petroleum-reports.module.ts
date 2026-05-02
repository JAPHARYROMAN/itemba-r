import { Module } from '@nestjs/common';
import { PetroleumReportsService } from './petroleum-reports.service';
import { PetroleumReportsController } from './petroleum-reports.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { CompanyScopeService } from '../../common/services';

@Module({
  imports: [PrismaModule],
  controllers: [PetroleumReportsController],
  providers: [PetroleumReportsService, CompanyScopeService],
})
export class PetroleumReportsModule {}
