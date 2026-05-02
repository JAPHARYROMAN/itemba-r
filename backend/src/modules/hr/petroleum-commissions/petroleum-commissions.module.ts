import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logs/audit-logs.module';
import { PetroleumCommissionsController } from './petroleum-commissions.controller';
import { PetroleumCommissionsService } from './petroleum-commissions.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [PetroleumCommissionsController],
  providers: [PetroleumCommissionsService],
  exports: [PetroleumCommissionsService],
})
export class PetroleumCommissionsModule {}
