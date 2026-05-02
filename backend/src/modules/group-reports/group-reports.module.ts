import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { GroupReportsService } from './group-reports.service';
import { GroupReportsController } from './group-reports.controller';
import { CompanyScopeService } from '../../common/services/company-scope.service';

@Module({
  imports: [PrismaModule],
  providers: [GroupReportsService, CompanyScopeService],
  controllers: [GroupReportsController],
  exports: [GroupReportsService],
})
export class GroupReportsModule {}
