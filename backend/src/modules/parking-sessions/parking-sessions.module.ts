import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CompanyScopeService } from '../../common/services';
import { ParkingSessionsService } from './parking-sessions.service';
import { ParkingSessionsController } from './parking-sessions.controller';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  providers: [ParkingSessionsService, CompanyScopeService],
  controllers: [ParkingSessionsController],
  exports: [ParkingSessionsService],
})
export class ParkingSessionsModule {}
