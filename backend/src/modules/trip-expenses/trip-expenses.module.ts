import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { TripExpensesService } from './trip-expenses.service';
import { TripExpensesController } from './trip-expenses.controller';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  providers: [TripExpensesService],
  controllers: [TripExpensesController],
  exports: [TripExpensesService],
})
export class TripExpensesModule {}
