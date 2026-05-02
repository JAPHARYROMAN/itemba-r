import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CompanyScopeService } from '../../common/services';
import { ThreeWayMatchingController } from './three-way-matching.controller';
import { ThreeWayMatchingService } from './three-way-matching.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [ThreeWayMatchingController],
  providers: [ThreeWayMatchingService, CompanyScopeService],
  exports: [ThreeWayMatchingService],
})
export class ThreeWayMatchingModule {}
