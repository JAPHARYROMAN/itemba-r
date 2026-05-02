import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CropsService } from './crops.service';
import { CropsController } from './crops.controller';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  providers: [CropsService],
  controllers: [CropsController],
  exports: [CropsService],
})
export class CropsModule {}
