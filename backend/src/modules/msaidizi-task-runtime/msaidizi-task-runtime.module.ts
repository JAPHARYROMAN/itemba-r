import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EphemeralSecretsModule } from '../../common/ephemeral-secrets.module';
import { EncryptionService } from '../../common/services';
import { PrismaModule } from '../../prisma/prisma.module';
import { JobWorkerModule } from '../job-worker/job-worker.module';
import { MsaidiziModule } from '../msaidizi/msaidizi.module';
import { MsaidiziTasksModule } from '../msaidizi-tasks/msaidizi-tasks.module';
import { MsaidiziDevicesModule } from '../msaidizi-devices/msaidizi-devices.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MsaidiziScheduleDispatcherService } from './msaidizi-schedule-dispatcher.service';
import { MsaidiziTaskDispatcherService } from './msaidizi-task-dispatcher.service';
import { MsaidiziTaskStepHandler } from './msaidizi-task-step.handler';
import { MsaidiziAdaptiveReasoningService } from './msaidizi-adaptive-reasoning.service';
import { MsaidiziRuntimeCritic } from './msaidizi-runtime-critic.service';
import { MsaidiziRuntimeOutcomeEvaluator } from './msaidizi-runtime-outcome.service';
import { MsaidiziUpdatesModule } from '../msaidizi-updates/msaidizi-updates.module';
import { MsaidiziArtifactsModule } from '../msaidizi-artifacts/msaidizi-artifacts.module';
import { MsaidiziObservabilityService } from './msaidizi-observability.service';
import { MsaidiziRuntimeMemoryService } from '../msaidizi-memory/msaidizi-runtime-memory.service';

@Module({
  imports: [
    ConfigModule,
    EphemeralSecretsModule,
    PrismaModule,
    JobWorkerModule,
    MsaidiziModule,
    MsaidiziTasksModule,
    MsaidiziDevicesModule,
    MsaidiziUpdatesModule,
    MsaidiziArtifactsModule,
    NotificationsModule,
  ],
  providers: [
    EncryptionService,
    MsaidiziRuntimeMemoryService,
    MsaidiziScheduleDispatcherService,
    MsaidiziTaskDispatcherService,
    MsaidiziTaskStepHandler,
    MsaidiziRuntimeCritic,
    MsaidiziRuntimeOutcomeEvaluator,
    MsaidiziAdaptiveReasoningService,
    MsaidiziObservabilityService,
  ],
  exports: [MsaidiziTaskDispatcherService],
})
export class MsaidiziTaskRuntimeModule {}
