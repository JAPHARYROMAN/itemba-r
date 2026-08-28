import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { MsaidiziArtifactsModule } from '../msaidizi-artifacts/msaidizi-artifacts.module';
import { MsaidiziDevicesModule } from '../msaidizi-devices/msaidizi-devices.module';
import {
  MsaidiziUpdateSupervisorChannelController,
  MsaidiziUpdateVerifierController,
  MsaidiziUpdatesController,
} from './msaidizi-updates.controller';
import { MsaidiziUpdateEvaluationService } from './msaidizi-update-evaluation.service';
import { MsaidiziUpdateEvaluationOrchestrator } from './msaidizi-update-evaluation-orchestrator.service';
import { MsaidiziEvaluatorMtlsGuard } from './msaidizi-evaluator-mtls.guard';
import { MsaidiziUpdateManifestSigner } from './msaidizi-update-manifest-signer.service';
import { MsaidiziUpdatesService } from './msaidizi-updates.service';
import { MsaidiziUpdateCandidateProposalService } from './msaidizi-update-candidate-proposal.service';
import { MsaidiziUpdateRolloutCoordinator } from './msaidizi-update-rollout-coordinator.service';
import { UpdateCandidateProposalPort } from './update-candidate-proposal.port';
import { AutonomyConfig } from '../msaidizi-tasks/autonomy.config';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    AuditLogsModule,
    MsaidiziArtifactsModule,
    MsaidiziDevicesModule,
  ],
  controllers: [
    MsaidiziUpdatesController,
    MsaidiziUpdateVerifierController,
    MsaidiziUpdateSupervisorChannelController,
  ],
  providers: [
    MsaidiziEvaluatorMtlsGuard,
    MsaidiziUpdateEvaluationService,
    MsaidiziUpdateEvaluationOrchestrator,
    MsaidiziUpdateManifestSigner,
    MsaidiziUpdatesService,
    MsaidiziUpdateRolloutCoordinator,
    AutonomyConfig,
    MsaidiziUpdateCandidateProposalService,
    {
      provide: UpdateCandidateProposalPort,
      useExisting: MsaidiziUpdateCandidateProposalService,
    },
  ],
  exports: [MsaidiziUpdatesService, UpdateCandidateProposalPort],
})
export class MsaidiziUpdatesModule {}
