import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { LaunchBlockersController } from './launch-blockers.controller';
import { LaunchBlockersService } from './launch-blockers.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [LaunchBlockersController],
  providers: [LaunchBlockersService],
  exports: [LaunchBlockersService],
})
export class LaunchBlockersModule {}
