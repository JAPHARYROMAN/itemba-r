CREATE TYPE "MsaidiziTrustedArtifactPurpose" AS ENUM ('SOURCE', 'ROLLBACK', 'REPORT');
CREATE TYPE "MsaidiziUpdateEvaluationAttestationKind" AS ENUM ('RUNNER', 'MODEL_REVIEW');
CREATE TYPE "MsaidiziUpdateEvaluationVerdict" AS ENUM ('PASS', 'FAIL', 'APPROVE', 'REJECT');

ALTER TABLE "msaidizi_artifacts"
  ADD COLUMN "trustedPurpose" "MsaidiziTrustedArtifactPurpose";

ALTER TABLE "msaidizi_update_candidates"
  ADD COLUMN "evaluationReportArtifactId" TEXT,
  ADD COLUMN "evaluationReportArtifactSha256" TEXT,
  ADD COLUMN "evaluationBundleDigest" TEXT,
  ADD COLUMN "evaluationDecidedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "msaidizi_update_candidates_evaluationBundleDigest_key"
  ON "msaidizi_update_candidates"("evaluationBundleDigest");

ALTER TABLE "msaidizi_update_candidates"
  ADD CONSTRAINT "msaidizi_update_candidates_evaluationReportArtifactId_fkey"
  FOREIGN KEY ("evaluationReportArtifactId") REFERENCES "msaidizi_artifacts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "msaidizi_trusted_artifact_evidence" (
  "id" TEXT NOT NULL,
  "artifactId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "planVersionId" TEXT NOT NULL,
  "stepId" TEXT NOT NULL,
  "candidateId" TEXT,
  "purpose" "MsaidiziTrustedArtifactPurpose" NOT NULL,
  "signerKeyId" TEXT NOT NULL,
  "claimsDigest" TEXT NOT NULL,
  "nonce" TEXT NOT NULL,
  "canonicalClaims" JSONB NOT NULL,
  "signature" TEXT NOT NULL,
  "evaluationRunId" TEXT NOT NULL,
  "cleanSnapshotId" TEXT NOT NULL,
  "toolchainVersions" JSONB NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "msaidizi_trusted_artifact_evidence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "msaidizi_trusted_artifact_evidence_artifactId_key"
  ON "msaidizi_trusted_artifact_evidence"("artifactId");
CREATE UNIQUE INDEX "msaidizi_trusted_artifact_evidence_claimsDigest_key"
  ON "msaidizi_trusted_artifact_evidence"("claimsDigest");
CREATE UNIQUE INDEX "msaidizi_trusted_artifact_evidence_nonce_key"
  ON "msaidizi_trusted_artifact_evidence"("nonce");
CREATE INDEX "msaidizi_trusted_artifact_evidence_taskId_stepId_purpose_idx"
  ON "msaidizi_trusted_artifact_evidence"("taskId", "stepId", "purpose");
CREATE INDEX "msaidizi_trusted_artifact_evidence_candidateId_purpose_idx"
  ON "msaidizi_trusted_artifact_evidence"("candidateId", "purpose");
CREATE INDEX "msaidizi_trusted_artifact_evidence_signerKeyId_receivedAt_idx"
  ON "msaidizi_trusted_artifact_evidence"("signerKeyId", "receivedAt");

ALTER TABLE "msaidizi_trusted_artifact_evidence"
  ADD CONSTRAINT "msaidizi_trusted_artifact_evidence_artifactId_fkey"
  FOREIGN KEY ("artifactId") REFERENCES "msaidizi_artifacts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "msaidizi_update_evaluation_attestations" (
  "id" TEXT NOT NULL,
  "candidateId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "planVersionId" TEXT NOT NULL,
  "stepId" TEXT NOT NULL,
  "kind" "MsaidiziUpdateEvaluationAttestationKind" NOT NULL,
  "signerKeyId" TEXT NOT NULL,
  "claimsDigest" TEXT NOT NULL,
  "nonce" TEXT NOT NULL,
  "canonicalClaims" JSONB NOT NULL,
  "signature" TEXT NOT NULL,
  "verdict" "MsaidiziUpdateEvaluationVerdict" NOT NULL,
  "evaluationRunId" TEXT NOT NULL,
  "cleanSnapshotId" TEXT NOT NULL,
  "sourceArtifactId" TEXT NOT NULL,
  "sourceArtifactSha256" TEXT NOT NULL,
  "rollbackArtifactId" TEXT NOT NULL,
  "rollbackArtifactSha256" TEXT NOT NULL,
  "reportArtifactId" TEXT NOT NULL,
  "reportArtifactSha256" TEXT NOT NULL,
  "runnerClaimsDigest" TEXT,
  "reviewerId" TEXT,
  "modelId" TEXT,
  "issuedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "msaidizi_update_evaluation_attestations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "msaidizi_update_evaluation_attestations_claimsDigest_key"
  ON "msaidizi_update_evaluation_attestations"("claimsDigest");
CREATE UNIQUE INDEX "msaidizi_update_evaluation_attestations_nonce_key"
  ON "msaidizi_update_evaluation_attestations"("nonce");
CREATE UNIQUE INDEX "msaidizi_update_evaluation_attestations_candidateId_kind_signerKeyId_key"
  ON "msaidizi_update_evaluation_attestations"("candidateId", "kind", "signerKeyId");
CREATE INDEX "msaidizi_update_evaluation_attestations_candidateId_kind_receivedAt_idx"
  ON "msaidizi_update_evaluation_attestations"("candidateId", "kind", "receivedAt");
CREATE INDEX "msaidizi_update_evaluation_attestations_signerKeyId_receivedAt_idx"
  ON "msaidizi_update_evaluation_attestations"("signerKeyId", "receivedAt");

ALTER TABLE "msaidizi_update_evaluation_attestations"
  ADD CONSTRAINT "msaidizi_update_evaluation_attestations_candidateId_fkey"
  FOREIGN KEY ("candidateId") REFERENCES "msaidizi_update_candidates"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
