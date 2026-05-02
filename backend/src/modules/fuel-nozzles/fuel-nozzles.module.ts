import { Module } from '@nestjs/common';
import { FuelNozzlesService } from './fuel-nozzles.service';
import { FuelNozzlesController } from './fuel-nozzles.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [FuelNozzlesController],
  providers: [FuelNozzlesService],
  exports: [FuelNozzlesService],
})
export class FuelNozzlesModule {}
