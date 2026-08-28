import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EncryptionService } from '../../common/services';
import { EphemeralSecretsModule } from '../../common/ephemeral-secrets.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { MsaidiziTasksModule } from '../msaidizi-tasks/msaidizi-tasks.module';
import { MsaidiziMandatesController } from './msaidizi-mandates.controller';
import { MsaidiziMandatesService } from './msaidizi-mandates.service';
import { MsaidiziMemoryController } from './msaidizi-memory.controller';
import { MsaidiziMemoryService } from './msaidizi-memory.service';
import { MsaidiziPrincipalService } from './msaidizi-principal.service';
import { MsaidiziSchedulesController } from './msaidizi-schedules.controller';
import { MsaidiziSchedulesService } from './msaidizi-schedules.service';
import { MsaidiziSafetyController } from './msaidizi-safety.controller';
import { MsaidiziSafetyService } from './msaidizi-safety.service';

/**
 * Human-managed autonomy authority, routine, and memory boundaries.
 *
 * The module deliberately owns no executor. It can be deployed and reviewed
 * while task and host execution remain disabled by deployment policy.
 */
@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    AuditLogsModule,
    MsaidiziTasksModule,
    EphemeralSecretsModule,
  ],
  controllers: [
    MsaidiziMandatesController,
    MsaidiziSchedulesController,
    MsaidiziMemoryController,
    MsaidiziSafetyController,
  ],
  providers: [
    EncryptionService,
    MsaidiziPrincipalService,
    MsaidiziMandatesService,
    MsaidiziSchedulesService,
    MsaidiziMemoryService,
    MsaidiziSafetyService,
  ],
  exports: [MsaidiziMandatesService, MsaidiziSchedulesService, MsaidiziMemoryService],
})
export class MsaidiziControlPlaneModule {}
