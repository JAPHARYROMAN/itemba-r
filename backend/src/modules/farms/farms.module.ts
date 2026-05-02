import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { FarmsService } from './farms.service';
import { FarmsController } from './farms.controller';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  providers: [FarmsService],
  controllers: [FarmsController],
  exports: [FarmsService],
})
export class FarmsModule {}
