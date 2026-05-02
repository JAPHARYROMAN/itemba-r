import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { RentalUnitsService } from './rental-units.service';
import { RentalUnitsController } from './rental-units.controller';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  providers: [RentalUnitsService],
  controllers: [RentalUnitsController],
  exports: [RentalUnitsService],
})
export class RentalUnitsModule {}
