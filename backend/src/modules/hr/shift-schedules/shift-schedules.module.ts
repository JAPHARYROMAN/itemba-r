import { Module } from '@nestjs/common';
import { ShiftSchedulesController } from './shift-schedules.controller';
import { ShiftSchedulesService } from './shift-schedules.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logs/audit-logs.module';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [ShiftSchedulesController],
  providers: [ShiftSchedulesService],
  exports: [ShiftSchedulesService],
})
export class ShiftSchedulesModule {}
