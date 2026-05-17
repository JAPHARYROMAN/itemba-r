import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { DepreciationController } from './depreciation.controller';
import { DepreciationService } from './depreciation.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [DepreciationController],
  providers: [DepreciationService],
  exports: [DepreciationService],
})
export class DepreciationModule {}
