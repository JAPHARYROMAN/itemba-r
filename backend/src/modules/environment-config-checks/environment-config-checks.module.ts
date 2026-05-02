import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { EnvironmentConfigChecksController } from './environment-config-checks.controller';
import { EnvironmentConfigChecksService } from './environment-config-checks.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [EnvironmentConfigChecksController],
  providers: [EnvironmentConfigChecksService],
  exports: [EnvironmentConfigChecksService],
})
export class EnvironmentConfigChecksModule {}
