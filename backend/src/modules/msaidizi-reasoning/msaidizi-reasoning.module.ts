import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EncryptionService } from '../../common/services';
import { PrismaModule } from '../../prisma/prisma.module';
import { MsaidiziArtifactsModule } from '../msaidizi-artifacts/msaidizi-artifacts.module';
import { AutonomyConfig } from '../msaidizi-tasks/autonomy.config';
import { MsaidiziModule } from '../msaidizi/msaidizi.module';
import { DeterministicMsaidiziCritic, MsaidiziCritic } from './msaidizi-critic.service';
import {
  MsaidiziMemoryRetriever,
  ScopedMsaidiziMemoryRetriever,
} from './msaidizi-memory-retriever.service';
import {
  DeterministicMsaidiziOutcomeEvaluator,
  MsaidiziOutcomeEvaluator,
} from './msaidizi-outcome-evaluator.service';
import { AnthropicMsaidiziPlanner, MsaidiziPlanner } from './msaidizi-planner.service';
import { MsaidiziProposalUsageService } from './msaidizi-proposal-usage.service';
import {
  DeterministicMsaidiziPolicyEvaluator,
  MsaidiziPolicyEvaluator,
} from './msaidizi-policy-evaluator.service';
import { MsaidiziReasoningContextService } from './msaidizi-reasoning-context.service';
import { MsaidiziReasoningController } from './msaidizi-reasoning.controller';
import { MsaidiziReasoningService } from './msaidizi-reasoning.service';

/** Proposal-only intelligence layer; it imports no executor or device broker. */
@Module({
  imports: [ConfigModule, PrismaModule, MsaidiziModule, MsaidiziArtifactsModule],
  controllers: [MsaidiziReasoningController],
  providers: [
    EncryptionService,
    AutonomyConfig,
    MsaidiziReasoningContextService,
    MsaidiziReasoningService,
    MsaidiziProposalUsageService,
    { provide: MsaidiziMemoryRetriever, useClass: ScopedMsaidiziMemoryRetriever },
    { provide: MsaidiziPlanner, useClass: AnthropicMsaidiziPlanner },
    { provide: MsaidiziPolicyEvaluator, useClass: DeterministicMsaidiziPolicyEvaluator },
    { provide: MsaidiziCritic, useClass: DeterministicMsaidiziCritic },
    { provide: MsaidiziOutcomeEvaluator, useClass: DeterministicMsaidiziOutcomeEvaluator },
  ],
  exports: [MsaidiziReasoningService, MsaidiziProposalUsageService],
})
export class MsaidiziReasoningModule {}
