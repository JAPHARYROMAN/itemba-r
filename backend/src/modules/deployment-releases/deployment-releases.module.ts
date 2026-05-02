import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { DeploymentReleasesController } from './deployment-releases.controller';
import { DeploymentReleasesService } from './deployment-releases.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [DeploymentReleasesController],
  providers: [DeploymentReleasesService],
  exports: [DeploymentReleasesService],
})
export class DeploymentReleasesModule {}
