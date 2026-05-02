import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ScalabilityController } from './scalability.controller';
import { ScalabilityService } from './scalability.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [ScalabilityController],
  providers: [ScalabilityService],
  exports: [ScalabilityService],
})
export class ScalabilityModule {}
