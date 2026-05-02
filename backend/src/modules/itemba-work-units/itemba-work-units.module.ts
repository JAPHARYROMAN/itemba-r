import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ItembaWorkUnitsService } from './itemba-work-units.service';
import { ItembaWorkUnitsController } from './itemba-work-units.controller';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  providers: [ItembaWorkUnitsService],
  controllers: [ItembaWorkUnitsController],
  exports: [ItembaWorkUnitsService],
})
export class ItembaWorkUnitsModule {}
