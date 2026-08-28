import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditChannel,
  AuditSeverity,
  MsaidiziArtifactKind,
  MsaidiziPrincipalStatus,
  MsaidiziTaskMode,
  MsaidiziTaskStatus,
  MsaidiziTrustLevel,
  MsaidiziUpdateCandidateStatus,
  MsaidiziUpdateEvaluationAttestationKind,
  MsaidiziUpdateEvaluationVerdict,
  MsaidiziUpdateEvaluationRunStatus,
  Prisma,
} from '@prisma/client';
import { rm } from 'node:fs/promises';
import { sanitizePersistedValue } from '../../common/utils/persistent-secret-redaction';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { MsaidiziArtifactsService } from '../msaidizi-artifacts/msaidizi-artifacts.service';
import {
  SignedEvaluatorAttestationDto,
  SubmitMsaidiziUpdateEvaluationDto,
} from './dto/msaidizi-update.dto';
import {
  attestationBundleDigest,
  canonicalAttestationJson,
  CanonicalAttestation,
  EvaluationBindingClaims,
  EvaluationRunnerAttestationClaims,
  EvaluatorAttestationError,
  ModelReviewAttestationClaims,
  extractGeneratedEvaluationBinding,
  isGeneratedEvaluationBinding,
  isGeneratedEvaluationTerminalAccounting,
  parseArtifactAttestation,
  parseEvaluationRunnerAttestation,
  parseModelReviewAttestation,
  sameEvaluationBinding,
} from './msaidizi-evaluator-attestation.protocol';
import { MsaidiziEvaluatorKeyRegistry } from './msaidizi-evaluator-key-registry.service';
import {
  assertEvaluationRunBinding,
  EVALUATION_RUN_INCLUDE,
  EvaluationRun,
  MsaidiziUpdateEvaluationOrchestrator,
} from './msaidizi-update-evaluation-orchestrator.service';
import {
  assertGeneratedUpdateProtectedBoundary,
  assertUpdateCandidateProposalStep,
  isGeneratedUpdateCandidateProposal,
  mandateAuthorizesUpdateCandidateProposal,
  UpdateCandidateProposalPolicyError,
} from './update-candidate-proposal.port';

type ParsedRunner = CanonicalAttestation<EvaluationRunnerAttestationClaims>;
type ParsedReview = CanonicalAttestation<ModelReviewAttestationClaims>;
type EvaluationDecision = 'APPROVED' | 'REJECTED';
type TrustedArtifactRow = Prisma.MsaidiziArtifactGetPayload<{
  include: { trustedEvidence: true };
}>;

/**
 * Verifier-only trust boundary for autonomous update evidence.
 *
 * This service has no deployment method. It can create a new encrypted trusted
 * artifact from signed content evidence and can project an append-only signed
 * evidence bundle into APPROVED/REJECTED. It never accepts caller booleans.
 */
@Injectable()
export class MsaidiziUpdateEvaluationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly keys: MsaidiziEvaluatorKeyRegistry,
    private readonly artifacts: MsaidiziArtifactsService,
    private readonly audit: AuditLogsService,
    private readonly orchestrator: MsaidiziUpdateEvaluationOrchestrator,
  ) {}

  async ingestTrustedArtifact(
    file: Express.Multer.File | undefined,
    envelope: SignedEvaluatorAttestationDto,
  ) {
    try {
      const attestation = parseArtifactAttestation(envelope);
      const databaseNow = await this.databaseNow();
      this.keys.verify(attestation, 'ARTIFACT_VERIFIER', databaseNow);
      return await this.artifacts.ingestTrustedUpdateArtifact(file, attestation);
    } catch (error) {
      if (file?.path) {
        // The artifact service also removes its input in a finally block. This
        // closes earlier parse/signature failures and is safe after that cleanup.
        await rm(file.path, { force: true }).catch(() => undefined);
      }
      throw publicTrustError(error);
    }
  }

  async submit(candidateId: string, dto: SubmitMsaidiziUpdateEvaluationDto) {
    try {
      await this.orchestrator.enforceExecutionGate();
      const runner = parseEvaluationRunnerAttestation(dto.runner);
      const reviews = dto.reviews.map(parseModelReviewAttestation);
      if (reviews.length !== 2) throw trustError('EVALUATION_REQUIRES_TWO_REVIEWS');

      const verificationClock = await this.databaseNow();
      this.keys.verify(runner, 'EVALUATION_RUNNER', verificationClock);
      for (const review of reviews) {
        this.keys.verify(review, 'MODEL_REVIEWER', verificationClock);
      }
      this.assertIndependentAndBound(candidateId, runner, reviews);

      const bundleDigest = attestationBundleDigest(
        runner.claimsDigest,
        reviews.map((review) => review.claimsDigest),
      );
      const decision = evaluationDecision(runner, reviews);

      return await this.prisma.$transaction(async (tx) => {
        const locks = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM "msaidizi_update_candidates" WHERE "id" = ${candidateId} FOR UPDATE
        `;
        if (locks.length !== 1) throw new NotFoundException('Update candidate not found');

        let candidate = await this.evaluationContext(tx, candidateId);
        if (!candidate) throw new NotFoundException('Update candidate not found');
        let evaluationRun = await tx.msaidiziUpdateEvaluationRun.findUnique({
          where: { candidateId },
          include: EVALUATION_RUN_INCLUDE,
        });
        if (evaluationRun) assertEvaluationRunBinding(evaluationRun);
        this.assertSignedGenerationBinding(evaluationRun, runner, reviews);
        const replay = await this.exactReplay(
          tx,
          candidate,
          bundleDigest,
          decision,
          runner,
          reviews,
          evaluationRun,
        );
        if (replay) return replay;

        // Safety disable owns the principal row before it mutates tasks. Keep
        // the same global order while the candidate row remains the outer
        // evaluation serializer: candidate -> principal -> task -> mandate ->
        // step -> evaluation run.
        const principalLocks = await tx.$queryRaw<
          Array<{ id: string; status: MsaidiziPrincipalStatus }>
        >`
          SELECT "id", "status"
          FROM "msaidizi_principals"
          WHERE "id" = ${candidate.principalId}
          FOR SHARE
        `;
        if (
          principalLocks.length !== 1 ||
          principalLocks[0].status !== MsaidiziPrincipalStatus.ACTIVE
        ) {
          throw trustError('EVALUATION_PRINCIPAL_INACTIVE');
        }

        const taskLocks = await tx.$queryRaw<
          Array<{ id: string; principalId: string; mandateId: string | null }>
        >`
          SELECT "id", "principalId", "mandateId"
          FROM "msaidizi_tasks"
          WHERE "id" = ${runner.claims.taskId}
            AND "principalId" = ${candidate.principalId}
          FOR SHARE
        `;
        if (taskLocks.length !== 1 || !taskLocks[0].mandateId) {
          throw trustError('EVALUATION_MANDATE_INACTIVE');
        }
        const mandateLocks = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM "msaidizi_mandates"
          WHERE "id" = ${taskLocks[0].mandateId}
            AND "principalId" = ${candidate.principalId}
          FOR SHARE
        `;
        if (mandateLocks.length !== 1) throw trustError('EVALUATION_MANDATE_INACTIVE');
        const stepLocks = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM "msaidizi_task_steps"
          WHERE "id" = ${runner.claims.stepId}
            AND "taskId" = ${runner.claims.taskId}
            AND "planVersionId" = ${runner.claims.planVersionId}
          FOR SHARE
        `;
        if (stepLocks.length !== 1) throw trustError('EVALUATION_REVIEWED_STEP_MISMATCH');

        if (evaluationRun) {
          const runLocks = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT "id"
            FROM "msaidizi_update_evaluation_runs"
            WHERE "id" = ${evaluationRun.id}
            FOR UPDATE
          `;
          if (runLocks.length !== 1) throw trustError('EVALUATION_GENERATED_RUN_INVALID');
          evaluationRun = await tx.msaidiziUpdateEvaluationRun.findUnique({
            where: { candidateId },
            include: EVALUATION_RUN_INCLUDE,
          });
          if (!evaluationRun) throw trustError('EVALUATION_GENERATED_RUN_INVALID');
          assertEvaluationRunBinding(evaluationRun);
          this.assertSignedGenerationBinding(evaluationRun, runner, reviews);
        }
        candidate = await this.evaluationContext(tx, candidateId);
        if (!candidate) throw new NotFoundException('Update candidate not found');
        if (
          candidate.principalId !== principalLocks[0].id ||
          candidate.proposedByTask?.principalId !== principalLocks[0].id
        ) {
          throw trustError('EVALUATION_PRINCIPAL_INACTIVE');
        }
        let databaseNow = await this.transactionDatabaseNow(tx);
        this.keys.verify(runner, 'EVALUATION_RUNNER', databaseNow);
        for (const review of reviews) this.keys.verify(review, 'MODEL_REVIEWER', databaseNow);
        this.assertCandidateBinding(candidate, runner.claims, evaluationRun, databaseNow);
        if (evaluationRun) {
          this.assertGeneratedReviewIndependence(evaluationRun, runner, reviews);
          this.assertGeneratedTerminalAccounting(evaluationRun, runner, reviews, databaseNow);
        }
        const artifactRows = await tx.msaidiziArtifact.findMany({
          where: {
            id: {
              in: [
                runner.claims.sourceArtifactId,
                runner.claims.rollbackArtifactId,
                runner.claims.reportArtifactId,
              ],
            },
          },
          include: { trustedEvidence: true },
        });
        if (artifactRows.length !== 3) throw trustError('EVALUATION_ARTIFACT_MISSING');
        const artifacts = new Map(artifactRows.map((artifact) => [artifact.id, artifact]));
        this.assertTrustedArtifact(
          artifacts.get(runner.claims.sourceArtifactId),
          'SOURCE',
          runner.claims,
          candidate.proposedByStep!.dataClass,
          databaseNow,
        );
        this.assertTrustedArtifact(
          artifacts.get(runner.claims.rollbackArtifactId),
          'ROLLBACK',
          runner.claims,
          candidate.proposedByStep!.dataClass,
          databaseNow,
        );
        this.assertTrustedArtifact(
          artifacts.get(runner.claims.reportArtifactId),
          'REPORT',
          runner.claims,
          candidate.proposedByStep!.dataClass,
          databaseNow,
        );

        const assertEvidenceAt = (clock: Date): void => {
          this.keys.verify(runner, 'EVALUATION_RUNNER', clock);
          for (const review of reviews) this.keys.verify(review, 'MODEL_REVIEWER', clock);
          this.assertCandidateBinding(candidate!, runner.claims, evaluationRun, clock);
          if (evaluationRun) {
            this.assertGeneratedReviewIndependence(evaluationRun, runner, reviews);
            this.assertGeneratedTerminalAccounting(evaluationRun, runner, reviews, clock);
          }
          this.assertTrustedArtifact(
            artifacts.get(runner.claims.sourceArtifactId),
            'SOURCE',
            runner.claims,
            candidate!.proposedByStep!.dataClass,
            clock,
          );
          this.assertTrustedArtifact(
            artifacts.get(runner.claims.rollbackArtifactId),
            'ROLLBACK',
            runner.claims,
            candidate!.proposedByStep!.dataClass,
            clock,
          );
          this.assertTrustedArtifact(
            artifacts.get(runner.claims.reportArtifactId),
            'REPORT',
            runner.claims,
            candidate!.proposedByStep!.dataClass,
            clock,
          );
        };

        await this.persistAttestation(tx, candidateId, runner, 'RUNNER');
        for (const review of reviews) {
          await this.persistAttestation(tx, candidateId, review, 'MODEL_REVIEW');
        }

        const summary = persistedJson({
          protocol: 'MSAIDIZI-EVALUATION-BUNDLE-V1',
          bundleDigest,
          decision,
          runnerClaimsDigest: runner.claimsDigest,
          runnerSignerKeyId: runner.claims.signerKeyId,
          checks: runner.claims.checks,
          failureCodes: runner.claims.failureCodes,
          evaluationRunId: runner.claims.evaluationRunId,
          cleanSnapshotId: runner.claims.cleanSnapshotId,
          reportArtifactId: runner.claims.reportArtifactId,
          reportArtifactSha256: runner.claims.reportArtifactSha256,
          reviewerEvidence: reviews
            .map((review) => ({ claimsDigest: review.claimsDigest }))
            .sort((left, right) => left.claimsDigest.localeCompare(right.claimsDigest)),
        });
        const reviewerDecisions = persistedJson(
          reviews
            .map((review) => ({
              claimsDigest: review.claimsDigest,
              signerKeyId: review.claims.signerKeyId,
              reviewerId: review.claims.reviewerId,
              modelId: review.claims.modelId,
              verdict: review.claims.verdict,
              rationale: review.claims.rationale,
            }))
            .sort((left, right) => left.signerKeyId.localeCompare(right.signerKeyId)),
        );
        this.orchestrator.assertExecutionGateOpen();
        if (evaluationRun) {
          databaseNow = await this.transactionDatabaseNow(tx);
          assertEvidenceAt(databaseNow);
          const runWon = await tx.msaidiziUpdateEvaluationRun.updateMany({
            where: {
              id: evaluationRun.id,
              status: MsaidiziUpdateEvaluationRunStatus.RUNNING,
              leaseId: evaluationRun.leaseId,
              leaseGeneration: evaluationRun.leaseGeneration,
              usedCpuTimeSeconds: evaluationRun.usedCpuTimeSeconds,
              usedBytesRead: evaluationRun.usedBytesRead,
              usedBytesWritten: evaluationRun.usedBytesWritten,
              usedExternalEgressBytes: evaluationRun.usedExternalEgressBytes,
              usedModelTurns: evaluationRun.usedModelTurns,
              usedModelInputTokens: evaluationRun.usedModelInputTokens,
              usedModelOutputTokens: evaluationRun.usedModelOutputTokens,
              usedModelCostMicrousd: evaluationRun.usedModelCostMicrousd,
              candidate: {
                status: MsaidiziUpdateCandidateStatus.EVALUATING,
                principalId: candidate.principalId,
                principal: { status: MsaidiziPrincipalStatus.ACTIVE },
              },
              task: {
                id: runner.claims.taskId,
                principalId: candidate.principalId,
                status: { in: [MsaidiziTaskStatus.RUNNING, MsaidiziTaskStatus.COMPLETED] },
                principal: { status: MsaidiziPrincipalStatus.ACTIVE },
              },
            },
            data: {
              status:
                decision === MsaidiziUpdateCandidateStatus.APPROVED
                  ? MsaidiziUpdateEvaluationRunStatus.SUCCEEDED
                  : MsaidiziUpdateEvaluationRunStatus.REJECTED,
              completedAt: databaseNow,
              leaseId: null,
              leaseExpiresAt: null,
              failureCode:
                decision === MsaidiziUpdateCandidateStatus.APPROVED
                  ? null
                  : 'SIGNED_EVALUATION_REJECTED',
            },
          });
          if (runWon.count !== 1) {
            throw new ConflictException('Generated evaluation run state changed');
          }
        }

        // The final outcome transition is deliberately last. A fresh
        // PostgreSQL clock closes expiry while waiting on any preceding lock or
        // append-only write; the principal relation in the CAS is an explicit
        // backstop in addition to the held shared safety lock.
        databaseNow = await this.transactionDatabaseNow(tx);
        assertEvidenceAt(databaseNow);
        this.orchestrator.assertExecutionGateOpen();
        const updated = await tx.msaidiziUpdateCandidate.updateMany({
          where: {
            id: candidateId,
            status: {
              in: [MsaidiziUpdateCandidateStatus.DRAFT, MsaidiziUpdateCandidateStatus.EVALUATING],
            },
            evaluationBundleDigest: null,
            principal: { status: MsaidiziPrincipalStatus.ACTIVE },
            proposedByTask: {
              id: runner.claims.taskId,
              principalId: candidate.principalId,
              status: { in: [MsaidiziTaskStatus.RUNNING, MsaidiziTaskStatus.COMPLETED] },
              principal: { status: MsaidiziPrincipalStatus.ACTIVE },
            },
            ...(evaluationRun
              ? {
                  evaluationRun: {
                    status:
                      decision === MsaidiziUpdateCandidateStatus.APPROVED
                        ? MsaidiziUpdateEvaluationRunStatus.SUCCEEDED
                        : MsaidiziUpdateEvaluationRunStatus.REJECTED,
                    leaseGeneration: evaluationRun.leaseGeneration,
                    usedCpuTimeSeconds: evaluationRun.usedCpuTimeSeconds,
                    usedBytesRead: evaluationRun.usedBytesRead,
                    usedBytesWritten: evaluationRun.usedBytesWritten,
                    usedExternalEgressBytes: evaluationRun.usedExternalEgressBytes,
                    usedModelTurns: evaluationRun.usedModelTurns,
                    usedModelInputTokens: evaluationRun.usedModelInputTokens,
                    usedModelOutputTokens: evaluationRun.usedModelOutputTokens,
                    usedModelCostMicrousd: evaluationRun.usedModelCostMicrousd,
                  },
                }
              : {}),
          },
          data: {
            status: decision,
            evaluationSummary: summary,
            reviewerDecisions,
            evaluationReportArtifactId: runner.claims.reportArtifactId,
            evaluationReportArtifactSha256: runner.claims.reportArtifactSha256,
            ...(evaluationRun
              ? {
                  sourceArtifactId: runner.claims.sourceArtifactId,
                  sourceArtifactSha256: runner.claims.sourceArtifactSha256,
                  rollbackArtifactId: runner.claims.rollbackArtifactId,
                  rollbackArtifactSha256: runner.claims.rollbackArtifactSha256,
                }
              : {}),
            evaluationBundleDigest: bundleDigest,
            evaluationDecidedAt: databaseNow,
          },
        });
        if (updated.count !== 1) throw new ConflictException('Candidate evaluation state changed');

        const evidence = persistedJson({
          candidateId,
          status: decision,
          bundleDigest,
          runnerClaimsDigest: runner.claimsDigest,
          reviewerEvidence: reviews
            .map((review) => ({ claimsDigest: review.claimsDigest }))
            .sort((left, right) => left.claimsDigest.localeCompare(right.claimsDigest)),
          reportArtifactId: runner.claims.reportArtifactId,
          reportArtifactSha256: runner.claims.reportArtifactSha256,
        });
        await tx.msaidiziTaskEvent.create({
          data: {
            taskId: runner.claims.taskId,
            type: 'update_candidate.evaluation_decided',
            actorType: 'VERIFIER',
            actorId: runner.claims.signerKeyId,
            payload: evidence,
          },
        });
        await this.audit.logStrictInTransaction(tx, {
          action: 'MSAIDIZI_UPDATE_EVALUATION_DECIDED',
          entityType: 'MsaidiziUpdateCandidate',
          entityId: candidateId,
          userId: candidate.proposedByTask!.initiatedByUserId,
          companyId: candidate.proposedByTask!.companyId,
          newValue: evidence as Prisma.InputJsonObject,
          severity: AuditSeverity.CRITICAL,
          channel: AuditChannel.AGENT,
          agentSessionId: taskSessionId(runner.claims.taskId),
          principalType: 'VERIFIER',
          principalId: runner.claims.signerKeyId,
          mandateId: candidate.proposedByTask!.mandateId,
          initiatedByUserId: candidate.proposedByTask!.initiatedByUserId,
          taskId: runner.claims.taskId,
          stepId: runner.claims.stepId,
        });
        return {
          candidateId,
          status: decision,
          bundleDigest,
          replay: false,
          deploymentCreated: false,
        };
      });
    } catch (error) {
      throw publicTrustError(error);
    }
  }

  private assertIndependentAndBound(
    candidateId: string,
    runner: ParsedRunner,
    reviews: ParsedReview[],
  ): void {
    if (runner.claims.candidateId !== candidateId.toLowerCase()) {
      throw trustError('EVALUATION_CANDIDATE_BINDING_MISMATCH');
    }
    const signerIds = [
      runner.claims.signerKeyId,
      ...reviews.map((review) => review.claims.signerKeyId),
    ].map(identityKey);
    if (new Set(signerIds).size !== 3) throw trustError('EVALUATION_SIGNERS_NOT_INDEPENDENT');
    if (new Set(reviews.map((review) => identityKey(review.claims.reviewerId))).size !== 2) {
      throw trustError('EVALUATION_REVIEWERS_NOT_INDEPENDENT');
    }
    if (new Set(reviews.map((review) => identityKey(review.claims.modelId))).size !== 2) {
      throw trustError('EVALUATION_MODELS_NOT_INDEPENDENT');
    }
    for (const review of reviews) {
      if (
        review.claims.runnerClaimsDigest !== runner.claimsDigest ||
        !sameEvaluationBinding(runner.claims, review.claims)
      ) {
        throw trustError('EVALUATION_BINDING_MISMATCH');
      }
    }
  }

  private async evaluationContext(tx: Prisma.TransactionClient, candidateId: string) {
    return tx.msaidiziUpdateCandidate.findUnique({
      where: { id: candidateId },
      include: {
        proposedByTask: {
          include: { principal: true, mandate: true },
        },
        proposedByPlanVersion: true,
        proposedByStep: true,
      },
    });
  }

  private assertCandidateBinding(
    candidate: NonNullable<
      Awaited<ReturnType<MsaidiziUpdateEvaluationService['evaluationContext']>>
    >,
    claims: EvaluationBindingClaims,
    evaluationRun: EvaluationRun | null,
    databaseNow: Date,
  ): void {
    const args = candidate.proposedByStep
      ? assertUpdateCandidateProposalStep(candidate.proposedByStep)
      : null;
    const generated = args && isGeneratedUpdateCandidateProposal(args);
    if (
      candidate.evaluationBundleDigest ||
      !candidate.proposedByTask ||
      !candidate.proposedByPlanVersion ||
      !candidate.proposedByStep ||
      !args ||
      candidate.proposedByTaskId !== claims.taskId ||
      candidate.proposedByPlanVersionId !== claims.planVersionId ||
      candidate.proposedByStepId !== claims.stepId ||
      candidate.proposedByStep.planVersionId !== claims.planVersionId ||
      candidate.proposedByPlanVersion.taskId !== claims.taskId ||
      candidate.proposedByStep.taskId !== claims.taskId ||
      candidate.rollbackVersion !== claims.rollbackVersion ||
      candidate.proposedByTask.mode !== MsaidiziTaskMode.AUTOPILOT ||
      ![MsaidiziTaskStatus.RUNNING, MsaidiziTaskStatus.COMPLETED].some(
        (status) => status === candidate.proposedByTask!.status,
      ) ||
      candidate.proposedByTask.principal.status !== MsaidiziPrincipalStatus.ACTIVE ||
      candidate.proposedByTask.activePlanVersion !== candidate.proposedByPlanVersion.version ||
      !candidate.proposedByTask.initiatedByUserId ||
      candidate.proposedByPlanVersion.createdByUserId !== candidate.proposedByTask.initiatedByUserId
    ) {
      throw trustError('EVALUATION_CANDIDATE_BINDING_INVALID');
    }
    if (candidate.scope !== args.scope || args.rollbackVersion !== claims.rollbackVersion) {
      throw trustError('EVALUATION_REVIEWED_STEP_MISMATCH');
    }
    if (generated) {
      assertGeneratedUpdateProtectedBoundary(args);
      if (
        !evaluationRun ||
        candidate.status !== MsaidiziUpdateCandidateStatus.EVALUATING ||
        candidate.sourceArtifactId !== null ||
        candidate.sourceArtifactSha256 !== null ||
        candidate.rollbackArtifactId !== null ||
        candidate.rollbackArtifactSha256 !== null ||
        candidate.generatedSourceArtifactId !== evaluationRun.generationArtifactId ||
        candidate.generationManifestSha256 !== evaluationRun.generationManifestSha256 ||
        evaluationRun.candidateId !== candidate.id ||
        evaluationRun.evaluationRunId !== claims.evaluationRunId ||
        evaluationRun.status !== MsaidiziUpdateEvaluationRunStatus.RUNNING ||
        !evaluationRun.leaseId ||
        !evaluationRun.leaseExpiresAt ||
        evaluationRun.leaseExpiresAt <= databaseNow ||
        evaluationRun.deadlineAt <= databaseNow ||
        !evaluationRun.startedAt ||
        !evaluationRun.lastHeartbeatAt ||
        evaluationRun.usedModelTurns < 2
      ) {
        throw trustError('EVALUATION_GENERATED_RUN_INVALID');
      }
    } else if (
      evaluationRun ||
      (candidate.status !== MsaidiziUpdateCandidateStatus.DRAFT &&
        candidate.status !== MsaidiziUpdateCandidateStatus.EVALUATING) ||
      candidate.sourceArtifactId !== claims.sourceArtifactId ||
      candidate.sourceArtifactSha256 !== claims.sourceArtifactSha256 ||
      candidate.rollbackArtifactId !== claims.rollbackArtifactId ||
      candidate.rollbackArtifactSha256 !== claims.rollbackArtifactSha256 ||
      args.sourceArtifactId !== claims.sourceArtifactId ||
      args.sourceArtifactSha256 !== claims.sourceArtifactSha256 ||
      args.rollbackArtifactId !== claims.rollbackArtifactId ||
      args.rollbackArtifactSha256 !== claims.rollbackArtifactSha256
    ) {
      throw trustError('EVALUATION_REVIEWED_STEP_MISMATCH');
    }
    const mandate = candidate.proposedByTask.mandate;
    const now = databaseNow.getTime();
    if (
      !mandate ||
      mandate.id !== candidate.proposedByTask.mandateId ||
      mandate.principalId !== candidate.principalId ||
      mandate.status !== 'ACTIVE' ||
      (mandate.startsAt && mandate.startsAt.getTime() > now) ||
      (mandate.expiresAt && mandate.expiresAt.getTime() <= now) ||
      !mandateAuthorizesUpdateCandidateProposal(mandate.capabilities, candidate.proposedByStep)
    ) {
      throw trustError('EVALUATION_MANDATE_INACTIVE');
    }
  }

  private assertGeneratedReviewIndependence(
    run: EvaluationRun,
    runner: ParsedRunner,
    reviews: ParsedReview[],
  ): void {
    const forbidden = new Set([run.generatorPrincipalId, run.generatorModelId].map(identityKey));
    if (forbidden.has(identityKey(runner.claims.signerKeyId))) {
      throw trustError('EVALUATION_GENERATOR_SELF_APPROVAL');
    }
    for (const review of reviews) {
      if (
        forbidden.has(identityKey(review.claims.signerKeyId)) ||
        forbidden.has(identityKey(review.claims.reviewerId)) ||
        forbidden.has(identityKey(review.claims.modelId))
      ) {
        throw trustError('EVALUATION_GENERATOR_SELF_APPROVAL');
      }
    }
  }

  private assertGeneratedTerminalAccounting(
    run: EvaluationRun,
    runner: ParsedRunner,
    reviews: ParsedReview[],
    databaseNow: Date,
  ): void {
    if (!isGeneratedEvaluationTerminalAccounting(runner.claims)) {
      throw trustError('EVALUATION_TERMINAL_ACCOUNTING_REQUIRED');
    }
    for (const review of reviews) {
      if (!isGeneratedEvaluationTerminalAccounting(review.claims)) {
        throw trustError('EVALUATION_TERMINAL_ACCOUNTING_REQUIRED');
      }
      if (
        review.claims.evaluationLeaseGeneration !== runner.claims.evaluationLeaseGeneration ||
        canonicalAttestationJson(review.claims.finalUsage) !==
          canonicalAttestationJson(runner.claims.finalUsage)
      ) {
        throw trustError('EVALUATION_TERMINAL_ACCOUNTING_MISMATCH');
      }
    }
    const usage = runner.claims.finalUsage;
    let bytesRead: bigint;
    let bytesWritten: bigint;
    let externalEgressBytes: bigint;
    let modelInputTokens: bigint;
    let modelOutputTokens: bigint;
    let modelCostMicrousd: bigint;
    try {
      bytesRead = BigInt(usage.bytesRead);
      bytesWritten = BigInt(usage.bytesWritten);
      externalEgressBytes = BigInt(usage.externalEgressBytes);
      modelInputTokens = BigInt(usage.modelInputTokens);
      modelOutputTokens = BigInt(usage.modelOutputTokens);
      modelCostMicrousd = BigInt(usage.modelCostMicrousd);
    } catch {
      throw trustError('EVALUATION_TERMINAL_ACCOUNTING_MISMATCH');
    }
    if (
      runner.claims.evaluationLeaseGeneration !== run.leaseGeneration ||
      usage.cpuTimeSeconds !== run.usedCpuTimeSeconds ||
      bytesRead !== run.usedBytesRead ||
      bytesWritten !== run.usedBytesWritten ||
      externalEgressBytes !== run.usedExternalEgressBytes ||
      usage.modelTurns !== run.usedModelTurns ||
      modelInputTokens !== run.usedModelInputTokens ||
      modelOutputTokens !== run.usedModelOutputTokens ||
      modelCostMicrousd !== run.usedModelCostMicrousd
    ) {
      throw trustError('EVALUATION_TERMINAL_ACCOUNTING_MISMATCH');
    }
    if (
      run.status !== MsaidiziUpdateEvaluationRunStatus.RUNNING ||
      !run.leaseId ||
      !run.leaseExpiresAt ||
      run.leaseExpiresAt <= databaseNow ||
      run.deadlineAt <= databaseNow ||
      !run.startedAt ||
      databaseNow.getTime() - run.startedAt.getTime() > run.maxWallTimeSeconds * 1_000 ||
      usage.cpuTimeSeconds > run.maxCpuTimeSeconds ||
      bytesRead > run.maxBytesRead ||
      bytesWritten > run.maxBytesWritten ||
      externalEgressBytes > run.maxExternalEgressBytes ||
      usage.modelTurns < 2 ||
      usage.modelTurns > run.maxModelTurns ||
      modelInputTokens > run.maxModelInputTokens ||
      modelOutputTokens > run.maxModelOutputTokens ||
      modelCostMicrousd > run.maxModelCostMicrousd
    ) {
      throw trustError('EVALUATION_TERMINAL_BUDGET_INVALID');
    }
  }

  private assertSignedGenerationBinding(
    run: EvaluationRun | null,
    runner: ParsedRunner,
    reviews: ParsedReview[],
  ): void {
    if (!run) {
      if (
        runner.claims.schemaVersion !== 1 ||
        reviews.some((review) => review.claims.schemaVersion !== 1)
      ) {
        throw trustError('EVALUATION_GENERATED_BINDING_UNEXPECTED');
      }
      return;
    }
    const args = assertUpdateCandidateProposalStep(run.step);
    if (
      !isGeneratedUpdateCandidateProposal(args) ||
      runner.claims.schemaVersion !== 2 ||
      !isGeneratedEvaluationBinding(runner.claims) ||
      reviews.some(
        (review) =>
          review.claims.schemaVersion !== 2 || !isGeneratedEvaluationBinding(review.claims),
      )
    ) {
      throw trustError('EVALUATION_GENERATED_BINDING_REQUIRED');
    }
    const expected = {
      requestDigest: run.requestDigest,
      generationArtifactId: run.generationArtifactId,
      generationArtifactSha256: run.generationArtifactSha256,
      generationManifestSha256: run.generationManifestSha256,
      protectedPolicyVersion: run.policyVersion,
      protectedPolicySha256: run.policyDigest,
      baseRevisionSha256: args.baseRevisionSha256,
    };
    if (
      canonicalAttestationJson(extractGeneratedEvaluationBinding(runner.claims)) !==
        canonicalAttestationJson(expected) ||
      reviews.some(
        (review) =>
          canonicalAttestationJson(
            extractGeneratedEvaluationBinding(
              review.claims as ModelReviewAttestationClaims &
                Parameters<typeof extractGeneratedEvaluationBinding>[0],
            ),
          ) !== canonicalAttestationJson(expected),
      )
    ) {
      throw trustError('EVALUATION_GENERATED_BINDING_MISMATCH');
    }
  }

  private assertTrustedArtifact(
    artifact: TrustedArtifactRow | undefined,
    purpose: 'SOURCE' | 'ROLLBACK' | 'REPORT',
    binding: EvaluationBindingClaims,
    dataClass: string,
    databaseNow: Date,
  ): void {
    if (
      !artifact ||
      !artifact.trustedEvidence ||
      artifact.kind !== MsaidiziArtifactKind.FILE ||
      artifact.trustLevel !== MsaidiziTrustLevel.TRUSTED ||
      artifact.trustedPurpose !== purpose ||
      !artifact.encrypted ||
      artifact.byteSize <= 0n ||
      artifact.taskId !== binding.taskId ||
      artifact.stepId !== binding.stepId ||
      artifact.dataClass !== dataClass
    ) {
      throw trustError('EVALUATION_ARTIFACT_UNTRUSTED');
    }
    const expectedId = artifactIdForPurpose(binding, purpose);
    const expectedDigest = artifactDigestForPurpose(binding, purpose);
    if (artifact.id !== expectedId || artifact.sha256 !== expectedDigest) {
      throw trustError('EVALUATION_ARTIFACT_BINDING_MISMATCH');
    }

    const evidence = artifact.trustedEvidence;
    const storedEnvelope = {
      claimsJson: canonicalAttestationJson(evidence.canonicalClaims),
      signature: evidence.signature,
    };
    const signed = parseArtifactAttestation(storedEnvelope);
    this.keys.verify(signed, 'ARTIFACT_VERIFIER', databaseNow);
    if (
      signed.claimsDigest !== evidence.claimsDigest ||
      signed.claims.artifactId !== artifact.id ||
      signed.claims.artifactPurpose !== purpose ||
      signed.claims.taskId !== binding.taskId ||
      signed.claims.planVersionId !== binding.planVersionId ||
      signed.claims.stepId !== binding.stepId ||
      signed.claims.sha256 !== artifact.sha256 ||
      signed.claims.byteSize !== artifact.byteSize.toString() ||
      signed.claims.dataClass !== dataClass ||
      signed.claims.evaluationRunId !== binding.evaluationRunId ||
      signed.claims.cleanSnapshotId !== binding.cleanSnapshotId ||
      canonicalAttestationJson(signed.claims.toolchainVersions) !==
        canonicalAttestationJson(binding.toolchainVersions) ||
      evidence.purpose !== purpose ||
      evidence.taskId !== binding.taskId ||
      evidence.planVersionId !== binding.planVersionId ||
      evidence.stepId !== binding.stepId ||
      evidence.candidateId !== (purpose === 'REPORT' ? binding.candidateId : null) ||
      signed.claims.candidateId !== (purpose === 'REPORT' ? binding.candidateId : null)
    ) {
      throw trustError('EVALUATION_ARTIFACT_EVIDENCE_MISMATCH');
    }
    if (
      isGeneratedEvaluationBinding(binding)
        ? signed.claims.schemaVersion !== 2 ||
          !isGeneratedEvaluationBinding(signed.claims) ||
          canonicalAttestationJson(extractGeneratedEvaluationBinding(signed.claims)) !==
            canonicalAttestationJson(extractGeneratedEvaluationBinding(binding))
        : signed.claims.schemaVersion !== 1
    ) {
      throw trustError('EVALUATION_ARTIFACT_GENERATED_BINDING_MISMATCH');
    }
  }

  private async databaseNow(): Promise<Date> {
    const rows = await this.prisma.$queryRaw<Array<{ now: Date }>>`
      SELECT clock_timestamp() AS "now"
    `;
    const now = rows[0]?.now;
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new ConflictException('Database clock is unavailable');
    }
    return now;
  }

  private async transactionDatabaseNow(tx: Prisma.TransactionClient): Promise<Date> {
    const rows = await tx.$queryRaw<Array<{ now: Date }>>`
      SELECT clock_timestamp() AS "now"
    `;
    const now = rows[0]?.now;
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new ConflictException('Database clock is unavailable');
    }
    return now;
  }

  private async persistAttestation(
    tx: Prisma.TransactionClient,
    candidateId: string,
    attestation: ParsedRunner | ParsedReview,
    kind: 'RUNNER' | 'MODEL_REVIEW',
  ): Promise<void> {
    const claims = attestation.claims;
    const review = kind === 'MODEL_REVIEW' ? (claims as ModelReviewAttestationClaims) : null;
    await tx.msaidiziUpdateEvaluationAttestation.create({
      data: {
        candidateId,
        taskId: claims.taskId,
        planVersionId: claims.planVersionId,
        stepId: claims.stepId,
        kind: kind as MsaidiziUpdateEvaluationAttestationKind,
        signerKeyId: claims.signerKeyId,
        claimsDigest: attestation.claimsDigest,
        nonce: claims.nonce,
        canonicalClaims: JSON.parse(attestation.claimsJson) as Prisma.InputJsonObject,
        signature: attestation.signature,
        verdict: claims.verdict as MsaidiziUpdateEvaluationVerdict,
        evaluationRunId: claims.evaluationRunId,
        cleanSnapshotId: claims.cleanSnapshotId,
        sourceArtifactId: claims.sourceArtifactId,
        sourceArtifactSha256: claims.sourceArtifactSha256,
        rollbackArtifactId: claims.rollbackArtifactId,
        rollbackArtifactSha256: claims.rollbackArtifactSha256,
        reportArtifactId: claims.reportArtifactId,
        reportArtifactSha256: claims.reportArtifactSha256,
        runnerClaimsDigest: review?.runnerClaimsDigest ?? null,
        reviewerId: review?.reviewerId ?? null,
        modelId: review?.modelId ?? null,
        issuedAt: new Date(claims.issuedAt),
        expiresAt: new Date(claims.expiresAt),
      },
    });
  }

  private async exactReplay(
    tx: Prisma.TransactionClient,
    candidate: NonNullable<
      Awaited<ReturnType<MsaidiziUpdateEvaluationService['evaluationContext']>>
    >,
    bundleDigest: string,
    decision: EvaluationDecision,
    runner: ParsedRunner,
    reviews: ParsedReview[],
    evaluationRun: EvaluationRun | null,
  ) {
    if (!candidate.evaluationBundleDigest) return null;
    if (
      candidate.evaluationBundleDigest !== bundleDigest ||
      !evaluationReplayStatusPair(candidate.status, decision) ||
      candidate.evaluationReportArtifactId !== runner.claims.reportArtifactId ||
      candidate.evaluationReportArtifactSha256 !== runner.claims.reportArtifactSha256
    ) {
      throw new ConflictException('Evaluation evidence replay does not match');
    }
    if (
      evaluationRun &&
      ((decision === MsaidiziUpdateCandidateStatus.APPROVED &&
        evaluationRun.status !== MsaidiziUpdateEvaluationRunStatus.SUCCEEDED) ||
        (decision === MsaidiziUpdateCandidateStatus.REJECTED &&
          evaluationRun.status !== MsaidiziUpdateEvaluationRunStatus.REJECTED) ||
        evaluationRun.evaluationRunId !== runner.claims.evaluationRunId ||
        !evaluationRun.completedAt)
    ) {
      throw new ConflictException('Generated evaluation replay state does not match');
    }
    const expected = new Set([
      runner.claimsDigest,
      ...reviews.map((review) => review.claimsDigest),
    ]);
    const stored = await tx.msaidiziUpdateEvaluationAttestation.findMany({
      where: { candidateId: candidate.id },
      select: { claimsDigest: true },
    });
    if (
      stored.length !== 3 ||
      stored.some((item) => !expected.delete(item.claimsDigest)) ||
      expected.size
    ) {
      throw new ConflictException('Stored evaluation evidence is incomplete');
    }
    return {
      candidateId: candidate.id,
      status: decision,
      bundleDigest,
      replay: true,
      deploymentCreated: false,
    };
  }
}

function evaluationReplayStatusPair(
  candidate: MsaidiziUpdateCandidateStatus,
  decision: EvaluationDecision,
): boolean {
  return decision === MsaidiziUpdateCandidateStatus.REJECTED
    ? candidate === MsaidiziUpdateCandidateStatus.REJECTED
    : [
        MsaidiziUpdateCandidateStatus.APPROVED,
        MsaidiziUpdateCandidateStatus.CANARY,
        MsaidiziUpdateCandidateStatus.ACTIVE,
        MsaidiziUpdateCandidateStatus.ROLLED_BACK,
      ].some((status) => status === candidate);
}

function evaluationDecision(runner: ParsedRunner, reviews: ParsedReview[]): EvaluationDecision {
  return runner.claims.verdict === 'PASS' &&
    reviews.every((review) => review.claims.verdict === 'APPROVE')
    ? MsaidiziUpdateCandidateStatus.APPROVED
    : MsaidiziUpdateCandidateStatus.REJECTED;
}

function artifactIdForPurpose(binding: EvaluationBindingClaims, purpose: string): string {
  if (purpose === 'SOURCE') return binding.sourceArtifactId;
  if (purpose === 'ROLLBACK') return binding.rollbackArtifactId;
  return binding.reportArtifactId;
}

function artifactDigestForPurpose(binding: EvaluationBindingClaims, purpose: string): string {
  if (purpose === 'SOURCE') return binding.sourceArtifactSha256;
  if (purpose === 'ROLLBACK') return binding.rollbackArtifactSha256;
  return binding.reportArtifactSha256;
}

function persistedJson(value: unknown): Prisma.InputJsonValue {
  const sanitized = sanitizePersistedValue(value);
  if (sanitized.redactionsApplied) throw trustError('EVALUATION_EVIDENCE_DLP_REJECTED');
  return JSON.parse(JSON.stringify(sanitized.value)) as Prisma.InputJsonValue;
}

function taskSessionId(taskId: string): string {
  return `task_${taskId.replace(/-/g, '')}`;
}

function identityKey(value: string): string {
  return value.normalize('NFC').trim().toLocaleLowerCase('en-US');
}

function trustError(code: string): EvaluatorAttestationError {
  return new EvaluatorAttestationError(code);
}

function publicTrustError(error: unknown): unknown {
  if (error instanceof EvaluatorAttestationError) return new BadRequestException(error.code);
  if (error instanceof UpdateCandidateProposalPolicyError) {
    return new BadRequestException(error.code);
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return new ConflictException('Evaluator evidence replay or nonce conflict');
  }
  return error;
}
