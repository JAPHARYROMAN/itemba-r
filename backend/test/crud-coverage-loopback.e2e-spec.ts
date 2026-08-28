import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AccessLevel,
  AccountType,
  AccountingLockType,
  AuditAttributionStatus,
  AuditChannel,
  AuditSeverity,
  AuditScopeKind,
  BranchType,
  CashAccountType,
  ContractStatus,
  CustomerType,
  DivisionType,
  InventoryMovementType,
  MsaidiziEffect,
  MsaidiziExecutionTarget,
  MsaidiziTaskMode,
  MsaidiziTaskStatus,
  MsaidiziTaskStepStatus,
  Prisma,
  ProductStatus,
  ProductType,
  RoleScope,
} from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomUUID } from 'node:crypto';
import { renameSync, writeFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import request from 'supertest';
import { Capability } from '../src/common/capabilities/capability-manifest';
import { MSAIDIZI_SERVICE_PRINCIPAL_TYPE } from '../src/common/context/request-context';
import { capabilityRequiresSensitiveAccessAudit } from '../src/common/policies/sensitive-access-policy';
import { exactActionEnvelopeDigest } from '../src/common/utils/action-envelope';
import { ALL_PERMISSIONS } from '../../database/seeds/permission-matrix';
import { PrismaService } from '../src/prisma/prisma.service';
import { CapabilityInvoker, InvocationResult } from '../src/modules/msaidizi/capability-invoker';
import { buildCrudCoverageReport } from '../src/modules/msaidizi/crud-coverage.service';
import {
  capabilityResponseValueAtPath,
  canonicalActionIsoSuffixMatches,
  canonicalPersistedValueMatches,
  localCalendarDaysActionTimeMatches,
  prismaNumericDefaultMatches,
  responseSecretDigestMatches,
  responseSecretHmacDigestMatches,
  responseSecretPrefixMatches,
  schemaGeneratedIdentifierMatches,
  utcDayBoundaryMatches,
} from '../src/modules/msaidizi/crud-mutation-generated-field-verifiers';
import { DEFAULT_PATTERNS, fallbackPattern } from '../src/modules/entity-code-generator/defaults';
import {
  CRUD_EVIDENCE_CONTRACT,
  CRUD_EVIDENCE_HARNESS_VERSION,
  CRUD_EVIDENCE_MAX_CASE_ASSERTIONS,
  CRUD_EVIDENCE_METADATA_READ_QUERY_KEYS,
  CrudExactRecordBinding,
  CrudEvidenceAssertion,
  CrudEvidenceCase,
  CrudEvidenceControlKind,
  CrudEvidencePayload,
  CrudMetadataReadFixtureRegistration,
  CrudMetadataReadDedicatedSeedScenario,
  CrudMetadataReadQueryBinding,
  canonicalJson,
  capabilityContractDigest,
  crudEvidenceFixturesForManifest,
  evaluateMetadataReadCompanyMarkers,
  exactRecordReadEvidenceFixtures,
  fixtureContractDigest,
  manifestContractDigest,
  metadataReadEvidencePacks,
  prismaSchemaMigrationDigest,
  sha256Hex,
} from '../src/modules/msaidizi/crud-execution-evidence';
import {
  CrudDomainHeaderBinding,
  CrudDomainHeaderFixtureRegistration,
  domainHeaderEvidencePacks,
} from '../src/modules/msaidizi/crud-domain-header-evidence';
import {
  CrudDerivedReportBinding,
  CrudDerivedReportReadFixtureRegistration,
  derivedReportReadEvidencePacks,
} from '../src/modules/msaidizi/crud-derived-report-read-evidence';
import {
  CrudGlobalAdminReadBinding,
  CrudGlobalAdminReadFixtureRegistration,
  globalAdminReadEvidencePack,
} from '../src/modules/msaidizi/crud-global-admin-read-evidence';
import {
  CrudRemainingReadBinding,
  CrudRemainingReadFixtureRegistration,
  remainingReadEvidencePack,
} from '../src/modules/msaidizi/crud-remaining-read-evidence';
import {
  CrudWestsidesReportReadFixtureRegistration,
  CrudWestsidesReportRowOracle,
  westsidesReportReadEvidencePack,
} from '../src/modules/msaidizi/crud-westsides-report-read-evidence';
import {
  CrudPathReadBinding,
  CrudPathReadFixtureRegistration,
  CrudPathReadScopeAssertion,
  pathRecordReadEvidencePacks,
} from '../src/modules/msaidizi/crud-path-read-evidence';
import { mutationEvidencePacksForManifest } from '../src/modules/msaidizi/crud-mutation-evidence-registry';
import { CRUD_FINANCIAL_ACTION_POSITIVE_REQUIRED_BINDINGS } from '../src/modules/msaidizi/crud-financial-action-positive-evidence';
import {
  CrudMutationAnyFixtureRegistration,
  CrudMutationClosedScope,
  CrudMutationCompoundEffect,
  CrudMutationCompoundNamedEffect,
  CrudMutationEffectValue,
  CrudMutationGeneratedField,
  CrudMutationResolvedDeltaClaim,
  CrudMutationResolvedModelDelta,
  CrudMutationValue,
  crudMutationAllowedModels,
  crudMutationBusinessDeltaModels,
  crudMutationRecoveryPlan,
  reconcileCrudMutationModelDeltas,
  resolveCrudMutationScopedRowCreateIdentityDelta,
} from '../src/modules/msaidizi/crud-mutation-evidence';
import { ManifestProvider } from '../src/modules/msaidizi/manifest.provider';
import { MsaidiziConfig } from '../src/modules/msaidizi/msaidizi.config';
import { MsaidiziTaskTokenService } from '../src/modules/auth/msaidizi-task-token.service';
import { MsaidiziTaskStepHandler } from '../src/modules/msaidizi-task-runtime/msaidizi-task-step.handler';
import {
  includingSoftDeletedWhere,
  physicallyDeleteDisposableRecord,
} from './crud-evidence-disposable-recovery';
import { createE2eApp } from './e2e-app';
import { deleteAuditLogsForTest } from './audit-log-maintenance';
import { CrudFixtureAuditScopeContract } from '../src/modules/msaidizi/crud-evidence-governance';
import {
  CRUD_EVIDENCE_NON_POSTING_LOCK_MODULE,
  CrudEvidenceMetadataSeedFields,
  assertCrudEvidenceAccountingLockSeed,
  crudEvidenceMetadataSeedValueMatches,
  materializeCrudEvidenceMetadataSeedFields,
} from '../src/modules/msaidizi/crud-evidence-fixture-isolation';
import {
  CrudWestsidesReportReadSeed,
  seedCrudWestsidesReportReadControls,
} from './crud-westsides-report-read-controls';

// This proof executes the complete registered CRUD matrix and reconciles every
// table and sequence through the incremental sentinel below. The parent runner
// still owns the outer process limit, cleanup, and artifact publication.
jest.setTimeout(1_200_000);

const ENABLED = process.env.CRUD_COVERAGE_DISPOSABLE_DB === '1';
const describeEvidence = ENABLED ? describe : describe.skip;
const TEST_PASSWORD = 'CrudEvidencePass123!';

interface MetadataReadDedicatedSeedRecords {
  seedScenario: CrudMetadataReadDedicatedSeedScenario;
  present: Record<string, unknown>;
  absent: Record<string, unknown>;
  dispose: () => Promise<void>;
}

describeEvidence('signed Msaidizi CRUD loopback execution evidence', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let manifest: ManifestProvider;
  let invoker: CapabilityInvoker;
  let creatorToken = '';
  let posterToken = '';
  let restrictedToken = '';
  let groupReaderToken = '';
  let groupCompanyAReaderToken = '';
  let fixedAssetCompanyDeniedToken = '';
  let applicationBuildDigest = '';
  let initialPrismaSchemaMigrationDigest = '';

  const runId = `crud_evidence_${randomUUID()}`;
  const suffix = runId.replace(/[^a-z0-9]/gi, '').slice(-12);
  const agentSessionId = `crudEvidence_${suffix}`;
  const cases: CrudEvidenceCase[] = [];

  let companyAId = '';
  let companyBId = '';
  let divisionAId = '';
  let divisionBId = '';
  let branchAId = '';
  let branchBId = '';
  let fiscalYearId = '';
  let accountingPeriodId = '';
  let debitAccountId = '';
  let creditAccountId = '';
  let seededCustomerAId = '';
  let seededCustomerBId = '';
  let creatorUserId = '';
  let posterUserId = '';
  let restrictedUserId = '';
  let posterRefreshTokenId = '';
  let groupReaderUserId = '';
  let groupCompanyAReaderUserId = '';
  let fixedAssetCompanyDeniedUserId = '';
  let unitAId = '';
  let unitBId = '';
  const exactRecordIds: Partial<Record<CrudExactRecordBinding, string>> = {};
  const pathReadValues = new Map<CrudPathReadBinding, string | number | boolean>();
  const seededModels = new Map<string, Record<string, unknown>>();
  const derivedReportValues = new Map<CrudDerivedReportBinding, string | number | boolean>();
  const globalAdminReadValues = new Map<CrudGlobalAdminReadBinding, string>();
  const remainingReadValues = new Map<CrudRemainingReadBinding, string | number | boolean>();
  let westsidesReportReadSeed: CrudWestsidesReportReadSeed | undefined;
  const mutationBindings = new Map<string, unknown>();
  const seedingModels = new Set<string>();

  beforeAll(async () => {
    assertDisposableHarnessConfiguration();
    applicationBuildDigest = requiredSha256Env('CRUD_COVERAGE_APPLICATION_BUILD_DIGEST');
    initialPrismaSchemaMigrationDigest = currentPrismaSchemaMigrationDigest();
    app = await createE2eApp({ useProductionPipeline: true });
    await app.listen(0, '127.0.0.1');
    prisma = app.get(PrismaService);
    manifest = app.get(ManifestProvider);

    const baseUrl = `${await app.getUrl()}/api/v1`;
    invoker = new CapabilityInvoker({
      loopbackBaseUrl: baseUrl,
      invokeTimeoutMs: 30_000,
    } as unknown as MsaidiziConfig);

    await assertAuditScopeSnapshotsAreAppendOnly();
    await seedHarness();
    await seedModelRecord('ReportDefinition');
    await assertDatabaseMutationSentinelSemantics();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('executes every registered fixture and writes a signed manifest-bound artifact', async () => {
    try {
      await positiveRead(
        'customer-list-positive',
        creatorToken,
        {
          query: { companyId: companyAId, page: 1, limit: 20 },
        },
        async (result) => {
          const rows = unwrapList(result.body);
          return [
            check('HTTP request succeeded', result.ok, statusDetail(result)),
            check(
              'seeded in-scope customer returned',
              rows.some((row) => row.id === seededCustomerAId),
            ),
            check(
              'out-of-company customer not returned',
              !rows.some((row) => row.id === seededCustomerBId),
            ),
          ];
        },
      );

      const denied = await invoke('CustomersController.create', restrictedToken, {
        body: {
          companyId: companyAId,
          branchId: branchAId,
          customerType: CustomerType.INDIVIDUAL,
          customerCode: `DEN${suffix}`,
          name: `Denied Customer ${suffix}`,
        },
        path: {},
        query: {},
      });
      await security('customer-create-permission-denial', 'permission_denial', denied, async () => [
        check('request was rejected', !denied.ok, statusDetail(denied)),
        check('permission guard returned exact HTTP 403', denied.status === 403),
        check(
          'denied request created no row',
          (await prisma.customer.count({
            where: { companyId: companyAId, customerCode: `DEN${suffix}` },
          })) === 0,
        ),
      ]);

      const sensitiveAuditIdsBefore = new Set(
        (await prisma.auditLog.findMany({ select: { id: true } })).map((row) => row.id),
      );
      const sensitiveDenied = await invoke('ContractsController.findAll', restrictedToken, {
        query: { companyId: companyAId, page: 1, limit: 20 },
      });
      const sensitiveDenialAuditDelta = (
        await prisma.auditLog.findMany({
          select: {
            id: true,
            action: true,
            entityType: true,
            entityId: true,
            userId: true,
            companyId: true,
            scopeKind: true,
            attributionStatus: true,
            companyScopes: {
              select: { companyId: true },
              orderBy: { companyId: 'asc' },
            },
            channel: true,
            agentSessionId: true,
          },
          orderBy: { createdAt: 'asc' },
        })
      ).filter((row) => !sensitiveAuditIdsBefore.has(row.id));
      let sensitiveDenialCleanupCount = 0;
      let sensitiveDenialCleanupError: string | undefined;
      try {
        if (sensitiveDenialAuditDelta.length > 0) {
          sensitiveDenialCleanupCount = await deleteAuditLogsForTest(prisma, {
            id: { in: sensitiveDenialAuditDelta.map((row) => row.id) },
          });
        }
      } catch (error) {
        sensitiveDenialCleanupError = safeError(error);
      }
      const sensitiveDenialAudit = sensitiveDenialAuditDelta[0];
      const sensitiveDenialRowsRemaining = await prisma.auditLog.count({
        where: { id: { in: sensitiveDenialAuditDelta.map((row) => row.id) } },
      });
      await security(
        'contracts-list-sensitive-permission-denial',
        'permission_denial',
        sensitiveDenied,
        async () => [
          check('authenticated sensitive request was rejected', !sensitiveDenied.ok),
          check(
            'sensitive permission guard returned exact HTTP 403',
            sensitiveDenied.status === 403,
          ),
          check(
            'denial emitted exactly one audit row',
            sensitiveDenialAuditDelta.length === 1,
            `audit ids: ${sensitiveDenialAuditDelta.map((row) => row.id).join(', ') || '<none>'}`,
          ),
          check(
            'denial audit is the exact sensitive GROUP/EXPLICIT event',
            sensitiveDenialAudit?.action === 'VIEW_SENSITIVE_DENIED' &&
              sensitiveDenialAudit.entityType === 'Contracts' &&
              sensitiveDenialAudit.entityId === null &&
              sensitiveDenialAudit.companyId === null &&
              sensitiveDenialAudit.scopeKind === AuditScopeKind.GROUP &&
              sensitiveDenialAudit.attributionStatus === AuditAttributionStatus.EXPLICIT &&
              sensitiveDenialAudit.companyScopes.length === 0,
          ),
          check(
            'denial audit carries the authenticated AGENT request context',
            Boolean(sensitiveDenialAudit?.userId) &&
              sensitiveDenialAudit?.channel === AuditChannel.AGENT &&
              sensitiveDenialAudit.agentSessionId === agentSessionId,
          ),
          check(
            'named-trigger maintenance removed the exact denial audit row',
            !sensitiveDenialCleanupError &&
              sensitiveDenialCleanupCount === 1 &&
              sensitiveDenialRowsRemaining === 0,
            sensitiveDenialCleanupError ??
              `deleted=${sensitiveDenialCleanupCount} remaining=${sensitiveDenialRowsRemaining}`,
          ),
        ],
      );

      await fixedAssetCompanyDisposalDenialControl();

      const isolatedRead = await invokeReadWithDatabaseClosure(
        'CustomersController.findOne',
        creatorToken,
        {
          path: { id: seededCustomerBId },
          query: {},
        },
      );
      const isolated = isolatedRead.result;
      await security('customer-company-isolation', 'company_isolation', isolated, async () => [
        check('cross-company read was rejected', !isolated.ok, statusDetail(isolated)),
        check('scope rejected without disclosing the row', [403, 404].includes(isolated.status)),
        isolatedRead.noDatabaseMutation,
      ]);

      const mutationObservations = await executeMutationEvidence(
        new Set(['CustomersController.create']),
      );
      const customerCreate = mutationObservations.get('CustomersController.create');
      const createResult = customerCreate?.result ?? {
        ok: false,
        status: 0,
        body: null,
        error: 'Declarative customer-create observation was not captured.',
      };
      const customerAudit = customerCreate?.auditDelta.find(
        (row) =>
          row.entityId === customerCreate.entityId &&
          row.entityType === 'Customer' &&
          row.action === 'CUSTOMER_CREATE',
      );
      await security(
        'customer-agent-audit-attribution',
        'audit_attribution',
        createResult,
        async () => [
          check('source create returned 2xx', createResult.ok, statusDetail(createResult)),
          check('audit row exists', Boolean(customerAudit)),
          check('audit channel is AGENT', customerAudit?.channel === AuditChannel.AGENT),
          check(
            'audit carries exact loopback session',
            customerAudit?.agentSessionId === agentSessionId,
          ),
          check('audit carries initiating user', customerAudit?.userId === creatorUserId),
          check('audit carries company', customerAudit?.companyId === companyAId),
          check('audit scope is explicitly company-bound', customerAudit?.scopeKind === 'COMPANY'),
          check(
            'audit scope attribution is explicit',
            customerAudit?.attributionStatus === 'EXPLICIT',
          ),
          check(
            'audit carries the immutable company snapshot',
            customerAudit?.companyScopes.map((scope) => scope.companyId).join(',') === companyAId,
          ),
        ],
      );

      await collaborativeServicePrincipalTaskScopeControl();
      await autopilotServicePrincipalMandateScopeControl();

      for (const pack of metadataReadEvidencePacks(manifest.capabilities())) {
        for (const fixture of pack.fixtures) {
          const dedicatedSeed = fixture.observable.causalRecordControl
            ? await seedMetadataReadDedicatedControl(fixture)
            : undefined;
          try {
            const actorField = fixture.observable.negativeControl?.actorField;
            const seeded =
              dedicatedSeed?.present ??
              (await shapeMetadataReadSeedFields(
                fixture.observable.seedModel,
                await seedModelRecord(fixture.observable.seedModel),
                actorField
                  ? { ...fixture.observable.seedFields, [actorField]: creatorUserId }
                  : fixture.observable.seedFields,
              ));
            assertMetadataReadSeedFields(fixture, seeded);
            const capability = capabilityFor(fixture.capabilityId);
            const args = metadataReadRequest(capability, fixture);
            const principalToken =
              fixture.executionPrincipal === 'group' ? groupReaderToken : creatorToken;
            const token = readExecutionToken(fixture.governance.audit, principalToken);
            const read = await invokeReadWithDatabaseClosure(
              fixture.capabilityId,
              token,
              args,
              'governance' in fixture ? fixture.governance.auditScope : undefined,
            );
            const result = read.result;
            const assertions = await safelyEvaluate(async () => {
              return [
                check('HTTP metadata-derived read returned 2xx', result.ok, statusDetail(result)),
                ...metadataReadObservableAssertions(fixture, result.body, dedicatedSeed),
                ...metadataReadScopeAssertions(fixture, capability, args.query, result.body),
              ];
            }, result);
            assertions.push(read.noDatabaseMutation);
            addCase(fixture.fixtureId, 'positive', result, assertions);
          } finally {
            await dedicatedSeed?.dispose();
          }
        }
      }

      // Later deterministic seed packs and mutation prerequisites can add
      // company-owned customers/products after the company-summary oracle was
      // first captured. Recompute only those mutable aggregate bindings at the
      // point of observation; the report is still reconciled to independent
      // live source rows rather than a fixture response.
      await refreshDerivedCompanySummaryMutableBindings();

      for (const pack of derivedReportReadEvidencePacks(manifest.capabilities())) {
        for (const fixture of pack.fixtures) {
          const query = boundDerivedReportArguments(fixture.queryBindings);
          const principalToken =
            fixture.executionPrincipal === 'group' ? groupReaderToken : creatorToken;
          const read = await invokeReadWithDatabaseClosure(
            fixture.capabilityId,
            readExecutionToken(fixture.governance.audit, principalToken),
            { path: {}, query },
            fixture.governance.auditScope,
          );
          const scopeProbeQuery =
            fixture.oracle.scopeProbe.kind === 'foreign_company_denied'
              ? { ...query, companyId: companyBId }
              : query;
          const scopeProbe = await invokeReadWithDatabaseClosure(
            fixture.capabilityId,
            creatorToken,
            { path: {}, query: scopeProbeQuery },
            fixture.governance.audit === 'required'
              ? {
                  scopeKind: 'GROUP',
                  attributionStatus: 'EXPLICIT',
                  companyScopeBindings: [],
                }
              : undefined,
            fixture.governance.audit === 'required' ? 'VIEW_SENSITIVE_DENIED' : 'VIEW_SENSITIVE',
          );
          const assertions = await safelyEvaluate(
            async () => derivedReportReadAssertions(fixture, read.result, scopeProbe.result),
            read.result,
          );
          assertions.push(read.noDatabaseMutation, scopeProbe.noDatabaseMutation);
          addCase(fixture.fixtureId, 'positive', read.result, assertions);
        }
      }

      for (const fixture of globalAdminReadEvidencePack(manifest.capabilities()).fixtures) {
        const query = boundGlobalAdminReadArguments(fixture.queryBindings);
        const read = await invokeReadWithDatabaseClosure(
          fixture.capabilityId,
          fixture.executionPrincipal === 'group' ? groupReaderToken : creatorToken,
          { path: {}, query },
        );
        const permissionProbe = await invokeReadWithDatabaseClosure(
          fixture.capabilityId,
          restrictedToken,
          { path: {}, query },
        );
        const scopeProbeQuery =
          fixture.oracle.scopeProbe?.kind === 'foreign_company_denied'
            ? { ...query, companyId: companyBId }
            : query;
        const scopeProbe = fixture.oracle.scopeProbe
          ? await invokeReadWithDatabaseClosure(fixture.capabilityId, creatorToken, {
              path: {},
              query: scopeProbeQuery,
            })
          : undefined;
        const assertions = await safelyEvaluate(
          async () =>
            globalAdminReadAssertions(
              fixture,
              read.result,
              permissionProbe.result,
              scopeProbe?.result,
            ),
          read.result,
        );
        assertions.push(read.noDatabaseMutation, permissionProbe.noDatabaseMutation);
        if (scopeProbe) assertions.push(scopeProbe.noDatabaseMutation);
        addCase(fixture.fixtureId, 'positive', read.result, assertions);
      }

      // Metadata-derived read controls deliberately reshape their shared foundation
      // records. Refresh aggregate expectations after those controls have run so the
      // remaining-read oracle reconciles the exact state observed by the endpoint.
      await refreshRemainingDynamicBindings();
      for (const fixture of remainingReadEvidencePack(manifest.capabilities()).fixtures) {
        const query = boundRemainingReadArguments(fixture.queryBindings);
        const read = await invokeReadWithDatabaseClosure(
          fixture.capabilityId,
          remainingReadExecutionToken(fixture),
          { path: {}, query },
          fixture.governance.audit === 'required' ? fixture.governance.auditScope : undefined,
        );
        const permissionProbe = await invokeReadWithDatabaseClosure(
          fixture.capabilityId,
          restrictedToken,
          { path: {}, query },
          fixture.governance.audit === 'required'
            ? {
                scopeKind: 'GROUP',
                attributionStatus: 'EXPLICIT',
                companyScopeBindings: [],
              }
            : undefined,
          fixture.governance.audit === 'required' ? 'VIEW_SENSITIVE_DENIED' : 'VIEW_SENSITIVE',
        );
        const scopeProbe = await executeRemainingReadScopeProbe(fixture, query);
        const assertions = await safelyEvaluate(
          async () =>
            remainingReadAssertions(
              fixture,
              read.result,
              permissionProbe.result,
              scopeProbe?.result,
            ),
          read.result,
        );
        assertions.push(read.noDatabaseMutation, permissionProbe.noDatabaseMutation);
        if (scopeProbe) assertions.push(scopeProbe.noDatabaseMutation);
        addCase(fixture.fixtureId, 'positive', read.result, assertions);
      }

      for (const fixture of westsidesReportReadEvidencePack(manifest.capabilities()).fixtures) {
        const companyARead = await invokeReadWithDatabaseClosure(
          fixture.capabilityId,
          fixture.execution.companyA === 'company' ? creatorToken : groupReaderToken,
          westsidesReportArguments(fixture, 'A'),
        );
        const companyBRead = await invokeReadWithDatabaseClosure(
          fixture.capabilityId,
          fixture.execution.companyB === 'group' ? groupReaderToken : creatorToken,
          westsidesReportArguments(fixture, 'B'),
        );
        const companyBDenied = await invokeReadWithDatabaseClosure(
          fixture.capabilityId,
          creatorToken,
          westsidesReportArguments(fixture, 'B'),
        );
        const assertions = await safelyEvaluate(
          async () =>
            westsidesReportReadAssertions(
              fixture,
              companyARead.result,
              companyBRead.result,
              companyBDenied.result,
            ),
          companyARead.result,
        );
        assertions.push(
          companyARead.noDatabaseMutation,
          companyBRead.noDatabaseMutation,
          companyBDenied.noDatabaseMutation,
        );
        addCase(fixture.fixtureId, 'positive', companyARead.result, assertions);
      }

      for (const fixture of exactRecordReadEvidenceFixtures(manifest.capabilities())) {
        const recordId = exactRecordIds[fixture.recordBinding];
        if (!recordId) {
          skipped(
            fixture.fixtureId,
            `exact record binding ${fixture.recordBinding} was not seeded`,
          );
          continue;
        }

        const read = await invokeReadWithDatabaseClosure(
          fixture.capabilityId,
          readExecutionToken(fixture.governance.audit, creatorToken),
          {
            path: { id: recordId },
            query: {},
          },
          fixture.governance.auditScope,
        );
        const result = read.result;
        const assertions = await safelyEvaluate(async () => {
          const record = unwrapRecord(result.body);
          return [
            check('HTTP exact-record read returned 2xx', result.ok, statusDetail(result)),
            check('response contains the exact seeded record', record.id === recordId),
            check(
              'response remained in the seeded company scope',
              nestedStringField(record, fixture.responseCompanyPath) === companyAId,
            ),
          ];
        }, result);
        assertions.push(read.noDatabaseMutation);
        addCase(fixture.fixtureId, 'positive', result, assertions);
      }

      for (const pack of pathRecordReadEvidencePacks(manifest.capabilities())) {
        for (const fixture of pack.fixtures) {
          const read = await invokeReadWithDatabaseClosure(
            fixture.capabilityId,
            readExecutionToken(
              fixture.governance.audit,
              fixture.executionPrincipal === 'group' ? groupReaderToken : creatorToken,
            ),
            {
              path: boundArguments(fixture.pathBindings),
              query: boundArguments(fixture.queryBindings),
            },
            fixture.governance.auditScope,
          );
          const result = read.result;
          const assertions = await safelyEvaluate(
            async () => pathReadAssertions(fixture, result),
            result,
          );
          assertions.push(read.noDatabaseMutation);
          addCase(fixture.fixtureId, 'positive', result, assertions);
        }
      }

      for (const pack of domainHeaderEvidencePacks(manifest.capabilities())) {
        for (const fixture of pack.fixtures) {
          const read = await invokeReadWithDatabaseClosure(
            fixture.capabilityId,
            readExecutionToken(
              fixture.governance.audit,
              fixture.executionPrincipal === 'group' ? groupReaderToken : creatorToken,
            ),
            { path: {}, query: boundDomainHeaderArguments(fixture.queryBindings) },
            fixture.governance.auditScope,
          );
          const scopeProbe =
            fixture.scopeOracle?.kind === 'denied_request'
              ? await invokeReadWithDatabaseClosure(fixture.capabilityId, creatorToken, {
                  path: {},
                  query: {
                    ...boundDomainHeaderArguments(fixture.queryBindings),
                    ...boundDomainHeaderArguments(fixture.scopeOracle.queryBindings),
                  },
                })
              : undefined;
          const result = read.result;
          const assertions = await safelyEvaluate(
            async () => domainHeaderReadAssertions(fixture, result, scopeProbe?.result),
            result,
          );
          assertions.push(read.noDatabaseMutation);
          if (scopeProbe) assertions.push(scopeProbe.noDatabaseMutation);
          addCase(fixture.fixtureId, 'positive', result, assertions);
        }
      }
    } finally {
      writeUnsignedEvidencePayload();
    }

    const registered = evidenceFixtures()
      .map((fixture) => fixture.fixtureId)
      .sort();
    const executed = cases.map((item) => item.fixtureId).sort();
    expect(executed).toEqual(registered);
    expect(cases.filter((item) => item.outcome !== 'passed').map(caseFailure)).toEqual([]);

    // Release closure is stricter than "every registered fixture ran". A new
    // permission-governed route must not silently disappear merely because no
    // fixture pack knows about it yet, and every deliberately ineligible route
    // must retain the exact machine-readable reason used by the coverage API.
    const closure = buildCrudCoverageReport(
      manifest.capabilities(),
      undefined,
      '2000-01-01T00:00:00.000Z',
    );
    const discoveryEligible = closure.capabilities
      .filter((capability) => capability.discoveryEligibility.status === 'eligible')
      .map((capability) => capability.capabilityId)
      .sort();
    const positiveFixtureCapabilities = [
      ...new Set(
        evidenceFixtures()
          .filter((fixture) => fixture.controlKind === 'positive')
          .map((fixture) => fixture.capabilityId),
      ),
    ].sort();
    expect(positiveFixtureCapabilities).toEqual(discoveryEligible);
    expect(
      closure.capabilities
        .filter((capability) => capability.discoveryEligibility.status === 'ineligible')
        .filter((capability) => !capability.discoveryEligibility.reason)
        .map((capability) => capability.capabilityId),
    ).toEqual([]);
  });

  async function assertAuditScopeSnapshotsAreAppendOnly(): Promise<void> {
    const probe = await prisma.auditLog.create({
      data: {
        action: 'CRUD_EVIDENCE_SCOPE_APPEND_GUARD_PROBE',
        entityType: 'AuditLog',
        scopeKind: AuditScopeKind.GLOBAL,
        attributionStatus: AuditAttributionStatus.EXPLICIT,
        channel: AuditChannel.SYSTEM,
      },
      select: { id: true },
    });
    let rejected = false;
    try {
      await prisma.auditLogCompanyScope.create({
        data: { auditLogId: probe.id, companyId: `late-scope-${suffix}` },
      });
    } catch {
      rejected = true;
    } finally {
      await deleteAuditLogsForTest(prisma, { id: probe.id });
    }
    if (!rejected) {
      throw new Error(
        'The audit_log_company_scopes append-only trigger accepted a scope after its parent transaction committed.',
      );
    }
  }

  async function seedHarness() {
    const permissionCodes = [
      ...new Set(
        manifest
          .capabilities()
          .flatMap((capability) => [...capability.permissions, ...capability.anyPermissions]),
      ),
    ].sort();
    const canonicalPermissionByCode = new Map(
      ALL_PERMISSIONS.map((permission) => [permission.code, permission] as const),
    );
    if (canonicalPermissionByCode.size !== ALL_PERMISSIONS.length) {
      throw new Error('Canonical permission matrix contains duplicate permission codes.');
    }
    const manifestPermissionDefinitions = permissionCodes.map((code) => {
      const definition = canonicalPermissionByCode.get(code);
      if (!definition) {
        throw new Error(`Manifest permission ${code} is absent from the canonical matrix.`);
      }
      return definition;
    });
    await prisma.$transaction(
      manifestPermissionDefinitions.map((definition) =>
        prisma.permission.upsert({
          where: { code: definition.code },
          create: {
            code: definition.code,
            description: definition.description,
            module: definition.module,
            action: definition.action,
            isGroupControl: definition.isGroupControl,
          },
          update: {
            description: definition.description,
            module: definition.module,
            action: definition.action,
            isGroupControl: definition.isGroupControl,
          },
        }),
      ),
    );
    const permissions = await prisma.permission.findMany({
      where: { code: { in: permissionCodes } },
      orderBy: { code: 'asc' },
    });
    if (permissions.length !== permissionCodes.length) {
      throw new Error(
        `Permission seed mismatch: expected ${permissionCodes.length}, found ${permissions.length}.`,
      );
    }
    const permissionFidelityFailures = permissions.filter((permission) => {
      const expected = canonicalPermissionByCode.get(permission.code);
      return (
        !expected ||
        permission.description !== expected.description ||
        permission.module !== expected.module ||
        permission.action !== expected.action ||
        permission.isGroupControl !== expected.isGroupControl
      );
    });
    if (permissionFidelityFailures.length > 0) {
      throw new Error(
        `Persisted permission fidelity mismatch: ${permissionFidelityFailures.map((permission) => permission.code).join(', ')}.`,
      );
    }
    const permissionByCode = new Map(
      permissions.map((permission) => [permission.code, permission]),
    );
    const companyRolePermissions = permissions.filter((permission) => !permission.isGroupControl);
    const fixedAssetsUpdatePermission = permissionByCode.get('fixed-assets.update');
    if (!fixedAssetsUpdatePermission?.isGroupControl) {
      throw new Error(
        'CRUD Fixed Assets denial control requires fixed-assets.update to be marked group-control.',
      );
    }

    const existingGroupSuperAdmin = await prisma.role.findUnique({
      where: { name: 'GROUP_SUPER_ADMIN' },
      include: { rolePermissions: { select: { permissionId: true } } },
    });
    if (
      existingGroupSuperAdmin?.scope !== undefined &&
      existingGroupSuperAdmin.scope !== RoleScope.GROUP
    ) {
      throw new Error('The reusable GROUP_SUPER_ADMIN evidence role is not GROUP-scoped.');
    }
    if (existingGroupSuperAdmin) {
      const existingPermissionIds = new Set(
        existingGroupSuperAdmin.rolePermissions.map((grant) => grant.permissionId),
      );
      const missingPermissionCodes = permissions
        .filter((permission) => !existingPermissionIds.has(permission.id))
        .map((permission) => permission.code);
      if (missingPermissionCodes.length > 0) {
        throw new Error(
          `The reusable GROUP_SUPER_ADMIN evidence role is missing permissions: ${missingPermissionCodes.join(', ')}.`,
        );
      }
    }

    const [fullRole, groupRole, viewRole, fixedAssetCompanyDeniedRole] = await Promise.all([
      prisma.role.create({
        data: {
          name: `crud_evidence_full_${suffix}`,
          displayName: 'CRUD Evidence Full Operator',
          scope: RoleScope.COMPANY,
          rolePermissions: {
            create: companyRolePermissions.map((permission) => ({ permissionId: permission.id })),
          },
        },
      }),
      existingGroupSuperAdmin ??
        prisma.role.create({
          data: {
            name: 'GROUP_SUPER_ADMIN',
            displayName: 'CRUD Evidence Group Super Admin',
            scope: RoleScope.GROUP,
            rolePermissions: {
              create: permissions.map((permission) => ({ permissionId: permission.id })),
            },
          },
        }),
      prisma.role.create({
        data: {
          name: `crud_evidence_view_${suffix}`,
          displayName: 'CRUD Evidence Restricted Reader',
          scope: RoleScope.COMPANY,
          rolePermissions: {
            create: [{ permissionId: permissionByCode.get('customers.view')!.id }],
          },
        },
      }),
      // Deliberately bypass RolesService in this disposable adversarial seed.
      // Production role mutations must reject this illegal attachment; the
      // direct row proves FixedAssetsService still fails closed if one exists.
      prisma.role.create({
        data: {
          name: `crud_evidence_fixed_asset_denied_${suffix}`,
          displayName: 'CRUD Evidence Invalid Company Asset Operator',
          scope: RoleScope.COMPANY,
          rolePermissions: {
            create: [{ permissionId: fixedAssetsUpdatePermission.id }],
          },
        },
      }),
    ]);
    const [positiveCompanyGroupControlGrants, hostileGroupControlGrants, hostileTotalGrants] =
      await Promise.all([
        prisma.rolePermission.count({
          where: { roleId: fullRole.id, permission: { isGroupControl: true } },
        }),
        prisma.rolePermission.count({
          where: {
            roleId: fixedAssetCompanyDeniedRole.id,
            permission: { isGroupControl: true },
          },
        }),
        prisma.rolePermission.count({ where: { roleId: fixedAssetCompanyDeniedRole.id } }),
      ]);
    if (positiveCompanyGroupControlGrants !== 0) {
      throw new Error(
        'A positive-fixture COMPANY role carries an impossible production group-control grant.',
      );
    }
    if (hostileGroupControlGrants !== 1 || hostileTotalGrants !== 1) {
      throw new Error(
        'Fixed Assets hostile principal must have exactly one isolated group-control grant.',
      );
    }

    const group = await prisma.group.create({
      data: { code: `CEG${suffix}`, name: `CRUD Evidence Group ${suffix}` },
    });
    const [companyA, companyB] = await Promise.all([
      prisma.company.create({
        data: { groupId: group.id, code: `CEA${suffix}`, name: `CRUD Evidence A ${suffix}` },
      }),
      prisma.company.create({
        data: { groupId: group.id, code: `CEB${suffix}`, name: `CRUD Evidence B ${suffix}` },
      }),
    ]);
    companyAId = companyA.id;
    companyBId = companyB.id;
    exactRecordIds.companyA = companyA.id;

    const [divisionA, divisionB] = await Promise.all([
      prisma.division.create({
        data: {
          companyId: companyA.id,
          code: `CEDA${suffix}`,
          name: `CRUD Evidence Division A ${suffix}`,
          type: DivisionType.OTHER,
        },
      }),
      prisma.division.create({
        data: {
          companyId: companyB.id,
          code: `CEDB${suffix}`,
          name: `CRUD Evidence Division B ${suffix}`,
          type: DivisionType.OTHER,
        },
      }),
    ]);
    divisionAId = divisionA.id;
    divisionBId = divisionB.id;
    exactRecordIds.divisionA = divisionA.id;
    mutationBindings.set('divisionA', divisionA);
    const [branchA, branchB] = await Promise.all([
      prisma.branch.create({
        data: {
          divisionId: divisionA.id,
          code: `CEBA${suffix}`,
          name: `CRUD Evidence Branch A ${suffix}`,
          type: BranchType.BRANCH,
        },
      }),
      prisma.branch.create({
        data: {
          divisionId: divisionB.id,
          code: `CEBB${suffix}`,
          name: `CRUD Evidence Branch B ${suffix}`,
          type: BranchType.BRANCH,
        },
      }),
    ]);
    branchAId = branchA.id;
    branchBId = branchB.id;
    exactRecordIds.branchA = branchA.id;
    mutationBindings.set('branchA', branchA);

    const passwordHash = await argon2.hash(TEST_PASSWORD);
    const [creator, poster, restricted, groupReader, groupCompanyAReader, fixedAssetCompanyDenied] =
      await Promise.all([
        createUser(`creator-${suffix}@itemba.invalid`, fullRole.id, companyA.id, passwordHash),
        createUser(`poster-${suffix}@itemba.invalid`, fullRole.id, companyA.id, passwordHash),
        createUser(`restricted-${suffix}@itemba.invalid`, viewRole.id, companyA.id, passwordHash),
        createUser(
          `group-reader-${suffix}@itemba.invalid`,
          groupRole.id,
          companyA.id,
          passwordHash,
        ),
        createUser(
          `group-company-a-reader-${suffix}@itemba.invalid`,
          groupRole.id,
          companyA.id,
          passwordHash,
        ),
        createUser(
          `fixed-asset-company-denied-${suffix}@itemba.invalid`,
          fixedAssetCompanyDeniedRole.id,
          companyA.id,
          passwordHash,
        ),
      ]);
    creatorUserId = creator.id;
    posterUserId = poster.id;
    restrictedUserId = restricted.id;
    groupReaderUserId = groupReader.id;
    groupCompanyAReaderUserId = groupCompanyAReader.id;
    fixedAssetCompanyDeniedUserId = fixedAssetCompanyDenied.id;
    exactRecordIds.userA = creator.id;
    const creatorCompanyAccess = await prisma.userCompanyAccess.findUnique({
      where: {
        userId_companyId: {
          userId: creator.id,
          companyId: companyA.id,
        },
      },
    });
    if (!creatorCompanyAccess) {
      throw new Error('CRUD evidence creator is missing its exact company-A access grant.');
    }
    const creatorRole = await prisma.userRole.findUnique({
      where: {
        userId_roleId: {
          userId: creator.id,
          roleId: fullRole.id,
        },
      },
    });
    if (!creatorRole) {
      throw new Error('CRUD evidence creator is missing its exact full-operator role grant.');
    }
    // Compound company/user fixtures make this table part of the mutation
    // sentinel. Reuse the authorization row created with the actor instead of
    // asking the generic DMMF seeder to violate join-table uniqueness.
    rememberSeededModel('UserCompanyAccess', creatorCompanyAccess);
    rememberSeededModel('UserRole', creatorRole);

    // A GROUP role may reach an unlisted company, but production policy still
    // limits that implicit reach to READ. Cross-company mutation fixtures must
    // therefore carry an explicit write grant on both sides; the harness must
    // prove that policy rather than bypassing it.
    await prisma.userCompanyAccess.create({
      data: {
        userId: groupReader.id,
        companyId: companyB.id,
        accessLevel: AccessLevel.MANAGE,
      },
    });
    const [crossCompanyAccess, companyAOnlyAccess] = await Promise.all([
      prisma.userCompanyAccess.findMany({
        where: { userId: groupReader.id },
        select: { companyId: true, accessLevel: true },
        orderBy: { companyId: 'asc' },
      }),
      prisma.userCompanyAccess.findMany({
        where: { userId: groupCompanyAReader.id },
        select: { companyId: true, accessLevel: true },
        orderBy: { companyId: 'asc' },
      }),
    ]);
    if (
      !crossCompanyAccess.some(
        (entry) => entry.companyId === companyA.id && entry.accessLevel === AccessLevel.MANAGE,
      ) ||
      !crossCompanyAccess.some(
        (entry) => entry.companyId === companyB.id && entry.accessLevel === AccessLevel.MANAGE,
      ) ||
      companyAOnlyAccess.length !== 1 ||
      companyAOnlyAccess[0]?.companyId !== companyA.id ||
      companyAOnlyAccess[0]?.accessLevel !== AccessLevel.MANAGE
    ) {
      throw new Error(
        'CRUD evidence requires distinct A+B mutation and company-A-only GROUP read principals.',
      );
    }

    const fiscalYear = await prisma.fiscalYear.create({
      data: {
        companyId: companyA.id,
        name: `CRUD Evidence FY ${suffix}`,
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        endDate: new Date('2026-12-31T23:59:59.999Z'),
      },
    });
    fiscalYearId = fiscalYear.id;
    exactRecordIds.fiscalYearA = fiscalYear.id;
    const period = await prisma.accountingPeriod.create({
      data: {
        companyId: companyA.id,
        fiscalYearId: fiscalYear.id,
        name: `CRUD Evidence Period ${suffix}`,
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        endDate: new Date('2026-12-31T23:59:59.999Z'),
      },
    });
    accountingPeriodId = period.id;
    exactRecordIds.accountingPeriodA = period.id;

    const [debitAccount, creditAccount] = await Promise.all([
      prisma.chartOfAccount.create({
        data: {
          companyId: companyA.id,
          accountCode: `100${suffix}`,
          accountName: `CRUD Evidence Cash ${suffix}`,
          accountType: AccountType.ASSET,
        },
      }),
      prisma.chartOfAccount.create({
        data: {
          companyId: companyA.id,
          accountCode: `400${suffix}`,
          accountName: `CRUD Evidence Income ${suffix}`,
          accountType: AccountType.INCOME,
        },
      }),
    ]);
    debitAccountId = debitAccount.id;
    creditAccountId = creditAccount.id;
    if (
      debitAccount.id === creditAccount.id ||
      debitAccount.companyId !== companyA.id ||
      creditAccount.companyId !== companyA.id ||
      debitAccount.isActive !== true ||
      creditAccount.isActive !== true ||
      debitAccount.deletedAt !== null ||
      creditAccount.deletedAt !== null
    ) {
      throw new Error(
        'CRUD journal evidence requires two distinct, active, live company-A ledger accounts.',
      );
    }
    mutationBindings.set('debitChartOfAccountA', debitAccount);
    mutationBindings.set('creditChartOfAccountA', creditAccount);
    mutationBindings.set('journalEntrySequenceCodeA', `JournalEntry_${companyA.id}`);
    mutationBindings.set('deliveryNoteSequenceCodeA', `DeliveryNote_${companyA.id}`);
    mutationBindings.set('inventoryMovementSequenceCodeA', `InventoryMovement_${companyA.id}`);
    mutationBindings.set('payableSequenceCodeA', `Payable_${companyA.id}`);
    mutationBindings.set('purchaseOrderSequenceCodeA', `PurchaseOrder_${companyA.id}`);
    mutationBindings.set('quotationSequenceCodeA', `Quotation_${companyA.id}`);
    mutationBindings.set('receivableSequenceCodeA', `Receivable_${companyA.id}`);
    mutationBindings.set('salesOrderSequenceCodeA', `SalesOrder_${companyA.id}`);
    mutationBindings.set('supplierOrderDraftSequenceCodeA', `SupplierOrderDraft_${companyA.id}`);
    // Migrations intentionally do not install jurisdiction reference rows. The
    // disposable evidence schema therefore owns a minimal, explicit Tanzania
    // payroll reference set instead of depending on an ambient application
    // seed. These rows are established before mutation baselines are captured.
    await seedPayrollReferenceData(creator.id);
    const [payrollTaxTypes, payrollRules, payrollPayeRate] = await Promise.all([
      prisma.taxType.findMany({
        where: { taxTypeCode: { in: ['NSSF', 'PAYE_MAINLAND', 'WCF'] } },
      }),
      prisma.statutoryDeductionRule.findMany({
        where: { ruleCode: { in: ['NSSF_PRIVATE', 'WCF_PRIVATE'] } },
      }),
      prisma.taxRate.findFirst({
        where: {
          taxType: { taxTypeCode: 'PAYE_MAINLAND' },
          calculationMethod: 'TIERED',
          status: 'ACTIVE',
        },
        orderBy: { effectiveFrom: 'desc' },
      }),
    ]);
    for (const code of ['NSSF', 'PAYE_MAINLAND', 'WCF'] as const) {
      const taxType = payrollTaxTypes.find((row) => row.taxTypeCode === code);
      if (!taxType) throw new Error(`CRUD payroll evidence requires tax type ${code}.`);
      mutationBindings.set(`payrollTaxType${code}`, taxType);
    }
    for (const code of ['NSSF_PRIVATE', 'WCF_PRIVATE'] as const) {
      const rule = payrollRules.find((row) => row.ruleCode === code);
      if (!rule) throw new Error(`CRUD payroll evidence requires statutory rule ${code}.`);
      mutationBindings.set(`payrollRule${code}`, rule);
    }
    if (!payrollPayeRate) {
      throw new Error('CRUD payroll evidence requires an active Mainland PAYE tiered rate.');
    }
    mutationBindings.set('payrollPayeRate', payrollPayeRate);
    exactRecordIds.chartOfAccountA = debitAccount.id;

    const [customerA, customerB, creditProfileCustomer] = await Promise.all([
      prisma.customer.create({
        data: {
          companyId: companyA.id,
          divisionId: divisionA.id,
          branchId: branchA.id,
          customerCode: `SEEDA${suffix}`,
          customerType: CustomerType.INDIVIDUAL,
          name: `Seed Customer A ${suffix}`,
        },
      }),
      prisma.customer.create({
        data: {
          companyId: companyB.id,
          divisionId: divisionB.id,
          branchId: branchB.id,
          customerCode: `SEEDB${suffix}`,
          customerType: CustomerType.INDIVIDUAL,
          name: `Seed Customer B ${suffix}`,
        },
      }),
      prisma.customer.create({
        data: {
          companyId: companyA.id,
          divisionId: divisionA.id,
          branchId: branchA.id,
          customerCode: `SEEDCP${suffix}`,
          customerType: CustomerType.INDIVIDUAL,
          name: `Credit Profile Create Customer ${suffix}`,
        },
      }),
    ]);
    seededCustomerAId = customerA.id;
    seededCustomerBId = customerB.id;
    pathReadValues.set('createdCustomerA', customerA.id);
    mutationBindings.set('customerCreditProfileCreateCustomer', creditProfileCustomer);

    const [seedAuditLog, seededJournalEntry] = await Promise.all([
      prisma.auditLog.create({
        data: {
          action: 'CUSTOMER_SEED',
          entityType: 'Customer',
          entityId: customerA.id,
          userId: creator.id,
          companyId: companyA.id,
          severity: AuditSeverity.HIGH,
          scopeKind: AuditScopeKind.COMPANY,
          attributionStatus: AuditAttributionStatus.EXPLICIT,
          companyScopes: { create: { companyId: companyA.id } },
          channel: AuditChannel.WEB,
          agentSessionId,
          newValue: { source: 'crud-evidence-foundation' },
        },
      }),
      prisma.journalEntry.create({
        data: {
          journalNumber: `CE-JE-SEED-${suffix}`,
          companyId: companyA.id,
          accountingPeriodId: period.id,
          transactionDate: new Date('2026-08-25T00:00:00.000Z'),
          description: `CRUD evidence postable journal ${suffix}`,
          status: 'DRAFT',
          totalDebit: 125,
          totalCredit: 125,
          createdById: creator.id,
          lines: {
            create: [
              {
                accountId: debitAccount.id,
                debit: 125,
                credit: 0,
                companyId: companyA.id,
              },
              {
                accountId: creditAccount.id,
                debit: 0,
                credit: 125,
                companyId: companyA.id,
              },
            ],
          },
        },
      }),
    ]);
    exactRecordIds.auditLogA = seedAuditLog.id;
    exactRecordIds.journalEntryA = seededJournalEntry.id;
    const seededJournalLines = await prisma.journalEntryLine.findMany({
      where: { journalEntryId: seededJournalEntry.id },
    });
    const seededDebitLine = seededJournalLines.find(
      (line) =>
        line.accountId === debitAccount.id &&
        Number(line.debit) === 125 &&
        Number(line.credit) === 0,
    );
    const seededCreditLine = seededJournalLines.find(
      (line) =>
        line.accountId === creditAccount.id &&
        Number(line.debit) === 0 &&
        Number(line.credit) === 125,
    );
    if (
      seededJournalLines.length !== 2 ||
      !seededDebitLine ||
      !seededCreditLine ||
      seededDebitLine.id === seededCreditLine.id ||
      seededDebitLine.companyId !== companyA.id ||
      seededCreditLine.companyId !== companyA.id ||
      seededDebitLine.divisionId !== null ||
      seededCreditLine.divisionId !== null ||
      seededDebitLine.branchId !== null ||
      seededCreditLine.branchId !== null
    ) {
      throw new Error(
        'CRUD journal evidence requires one exact debit line and one exact credit line on its isolated source journal.',
      );
    }
    rememberSeededModel('AuditLog', seedAuditLog);
    rememberSeededModel('JournalEntry', seededJournalEntry);
    // Reuse the exact source debit line as the generic model seed. Without
    // this cache entry, mutation effect discovery would create a third
    // JournalEntryLine on the reversal source before evidence execution.
    rememberSeededModel('JournalEntryLine', seededDebitLine);

    const [
      accountingLock,
      cashAccount,
      productCategory,
      deleteProductCategory,
      unit,
      department,
      workShift,
      leaveType,
      allowanceType,
      deductionType,
      payrollPeriod,
      customerSegment,
    ] = await Promise.all([
      prisma.accountingLock.create({
        data: {
          lockCode: `CEL${suffix}`,
          companyId: companyA.id,
          lockType: AccountingLockType.MODULE_LOCK,
          moduleName: CRUD_EVIDENCE_NON_POSTING_LOCK_MODULE,
          reason: 'CRUD evidence exact-record seed',
          createdById: creator.id,
          status: 'RELEASED',
        },
      }),
      prisma.cashAccount.create({
        data: {
          companyId: companyA.id,
          divisionId: divisionA.id,
          branchId: branchA.id,
          accountName: `CRUD Evidence Cash Account ${suffix}`,
        },
      }),
      prisma.productCategory.create({
        data: {
          companyId: companyA.id,
          name: `CRUD Evidence Category ${suffix}`,
        },
      }),
      prisma.productCategory.create({
        data: {
          companyId: companyA.id,
          name: `CRUD Evidence Delete Category ${suffix}`,
        },
      }),
      prisma.unitOfMeasure.create({
        data: {
          companyId: companyA.id,
          name: `CRUD Evidence Unit ${suffix}`,
          symbol: `CE${suffix.slice(-4)}`,
        },
      }),
      prisma.department.create({
        data: {
          departmentCode: `CEDP${suffix}`,
          companyId: companyA.id,
          divisionId: divisionA.id,
          branchId: branchA.id,
          name: `CRUD Evidence Department ${suffix}`,
        },
      }),
      prisma.workShift.create({
        data: {
          shiftCode: `CEWS${suffix}`,
          companyId: companyA.id,
          divisionId: divisionA.id,
          branchId: branchA.id,
          name: `CRUD Evidence Work Shift ${suffix}`,
          startTime: '08:00',
          endTime: '17:00',
        },
      }),
      prisma.leaveType.create({
        data: {
          companyId: companyA.id,
          name: `CRUD Evidence Leave ${suffix}`,
          code: `CELV${suffix}`,
        },
      }),
      prisma.allowanceType.create({
        data: {
          companyId: companyA.id,
          name: `CRUD Evidence Allowance ${suffix}`,
          code: `CEAL${suffix}`,
        },
      }),
      prisma.deductionType.create({
        data: {
          companyId: companyA.id,
          name: `CRUD Evidence Deduction ${suffix}`,
          code: `CEDD${suffix}`,
        },
      }),
      prisma.payrollPeriod.create({
        data: {
          payrollPeriodCode: `CEPP${suffix}`,
          companyId: companyA.id,
          name: `CRUD Evidence Payroll ${suffix}`,
          startDate: new Date('2026-08-01T00:00:00.000Z'),
          endDate: new Date('2026-08-31T23:59:59.999Z'),
          createdById: creator.id,
        },
      }),
      prisma.customerSegment.create({
        data: {
          segmentCode: `CECS${suffix}`,
          companyId: companyA.id,
          name: `CRUD Evidence Segment ${suffix}`,
        },
      }),
    ]);
    unitAId = unit.id;
    mutationBindings.set('productCategoryDelete', deleteProductCategory);
    const unitB = await prisma.unitOfMeasure.create({
      data: {
        companyId: companyA.id,
        name: `CRUD Evidence Unit B ${suffix}`,
        symbol: `CEB${suffix.slice(-4)}`,
      },
    });
    unitBId = unitB.id;

    const [product, position] = await Promise.all([
      prisma.product.create({
        data: {
          productCode: `CEPR${suffix}`,
          companyId: companyA.id,
          divisionId: divisionA.id,
          categoryId: productCategory.id,
          name: `CRUD Evidence Product ${suffix}`,
          baseUnitId: unit.id,
          defaultPurchasePrice: 10,
          defaultSellingPrice: 15,
        },
      }),
      prisma.position.create({
        data: {
          positionCode: `CEPO${suffix}`,
          companyId: companyA.id,
          departmentId: department.id,
          title: `CRUD Evidence Position ${suffix}`,
        },
      }),
    ]);

    const [inventoryBalance, inventoryMovement] = await Promise.all([
      prisma.inventoryBalance.create({
        data: {
          companyId: companyA.id,
          divisionId: divisionA.id,
          branchId: branchA.id,
          productId: product.id,
          quantityOnHand: 7.5,
          averageCost: 10,
          totalValue: 75,
        },
      }),
      prisma.inventoryMovement.create({
        data: {
          movementNumber: `CEIM${suffix}`,
          companyId: companyA.id,
          divisionId: divisionA.id,
          branchId: branchA.id,
          productId: product.id,
          movementType: InventoryMovementType.OPENING_STOCK,
          quantity: 7.5,
          unitId: unit.id,
          unitCost: 10,
          totalCost: 75,
          movementDate: new Date('2026-08-25T00:00:00.000Z'),
          createdById: creator.id,
        },
      }),
    ]);

    Object.assign(exactRecordIds, {
      accountingLockA: accountingLock.id,
      cashAccountA: cashAccount.id,
      productCategoryA: productCategory.id,
      unitA: unit.id,
      departmentA: department.id,
      workShiftA: workShift.id,
      leaveTypeA: leaveType.id,
      allowanceTypeA: allowanceType.id,
      deductionTypeA: deductionType.id,
      payrollPeriodA: payrollPeriod.id,
      customerSegmentA: customerSegment.id,
      productA: product.id,
      positionA: position.id,
      inventoryBalanceA: inventoryBalance.id,
      inventoryMovementA: inventoryMovement.id,
    } satisfies Partial<Record<CrudExactRecordBinding, string>>);

    [
      ['Group', group],
      ['Company', companyA],
      ['Division', divisionA],
      ['Branch', branchA],
      ['User', creator],
      ['Role', fullRole],
      ['Permission', permissions[0]],
      ['FiscalYear', fiscalYear],
      ['AccountingPeriod', period],
      // Reuse the deliberately RELEASED, non-posting exact-record seed. If this
      // model is absent from the cache, the generic mutation seeder creates a
      // second AccountingLock with schema defaults: ACTIVE and scoped to the
      // shared accounting period. That contaminates every journal fixture.
      ['AccountingLock', accountingLock],
      ['ChartOfAccount', debitAccount],
      ['CashAccount', cashAccount],
      ['Customer', customerA],
      ['ProductCategory', productCategory],
      ['UnitOfMeasure', unit],
      ['Department', department],
      ['WorkShift', workShift],
      ['LeaveType', leaveType],
      ['AllowanceType', allowanceType],
      ['DeductionType', deductionType],
      ['PayrollPeriod', payrollPeriod],
      ['CustomerSegment', customerSegment],
      ['Product', product],
      ['Position', position],
      ['InventoryBalance', inventoryBalance],
      ['InventoryMovement', inventoryMovement],
    ].forEach(([model, record]) => rememberSeededModel(model as string, record));
    assertCrudEvidenceAccountingLockSeed(seededModels.get('AccountingLock'), accountingLock.id);

    pathReadValues.set('companyA', companyA.id);
    pathReadValues.set('companyB', companyB.id);
    pathReadValues.set('userA', creator.id);
    pathReadValues.set('roleA', fullRole.id);
    pathReadValues.set('permissionA', permissions[0].id);
    pathReadValues.set('customerA', customerA.id);
    pathReadValues.set('cashAccountA', cashAccount.id);
    pathReadValues.set('chartOfAccountA', debitAccount.id);
    pathReadValues.set('productA', product.id);
    pathReadValues.set('entityTypeCustomer', 'Customer');
    derivedReportValues.set('companyA', companyA.id);
    derivedReportValues.set('companyB', companyB.id);

    // A second company and actor are deliberately available only for foreign
    // keys whose domain requires two distinct sides. Path fixtures themselves
    // are always invoked in company A as the creator.
    rememberSeededModel('CompanyB', companyB);
    rememberSeededModel('UserB', poster);
    await seedMetadataActorNegativeControls();
    const userDashboardCreateDefinition = await prisma.dashboardDefinition.create({
      data: {
        dashboardCode: `CRUD-UPSERT-CREATE-${suffix}`,
        name: `CRUD isolated upsert-create dashboard ${suffix}`,
        layout: { source: 'crud-user-dashboard-upsert-create' },
        createdById: creator.id,
      },
    });
    mutationBindings.set('userDashboardCreateDefinition', userDashboardCreateDefinition.id);

    const pathSeedModels = new Set(
      pathRecordReadEvidencePacks(manifest.capabilities())
        .flatMap((pack) => pack.fixtures)
        .flatMap((fixture) => (fixture.seedModel ? [fixture.seedModel] : [])),
    );
    for (const modelName of [...pathSeedModels].sort()) {
      const record = await seedModelRecord(modelName);
      const recordId = stringField(record, 'id');
      if (!recordId) throw new Error(`CRUD path-read seed ${modelName} did not return an id.`);
      pathReadValues.set(`model:${modelName}`, recordId);
    }

    const domainHeaderSeedModels = new Set(
      domainHeaderEvidencePacks(manifest.capabilities())
        .flatMap((pack) => pack.fixtures)
        .flatMap((fixture) => fixture.seedModels)
        .filter((modelName) => modelName !== 'MobilePosTerminal'),
    );
    for (const modelName of [...domainHeaderSeedModels].sort()) {
      await seedModelRecord(modelName);
    }

    // The membership delete target deliberately uses a private segment/customer
    // pair so the earlier addMember positive still proves a real create rather
    // than hitting its idempotent upsert branch.
    await seedMutationGapMembershipControl();
    for (const modelName of mutationSeedModelNames()) {
      await seedModelRecord(modelName);
    }
    await seedAutonomyReleaseControls();
    await seedMutationGapDeleteControls();
    await seedReceivableRemoveControl();

    const notificationSeed = await seedModelRecord('Notification');
    const actorANotification = await prisma.notification.update({
      where: { id: stringField(notificationSeed, 'id') },
      data: {
        companyId: companyA.id,
        recipientUserId: creator.id,
        status: 'UNREAD',
        readAt: null,
        dismissedAt: null,
      },
    });
    rememberSeededModel('Notification', actorANotification);
    const actorASecondNotification = await prisma.notification.create({
      data: {
        notificationNumber: `NTF-ACTOR-A-SECOND-${suffix}`,
        companyId: companyA.id,
        recipientUserId: creator.id,
        title: `CRUD evidence actor-A second notification ${suffix}`,
        message: 'This second actor-owned row makes the bulk transition observable.',
        status: 'UNREAD',
      },
    });
    mutationBindings.set('notificationActorASecond', actorASecondNotification);

    const employeeSeed = await seedModelRecord('Employee');
    const evidenceEmployee = await prisma.employee.update({
      where: { id: stringField(employeeSeed, 'id') },
      data: {
        companyId: companyA.id,
        divisionId: divisionA.id,
        branchId: branchA.id,
        userId: creator.id,
        employmentStatus: 'ACTIVE',
        firstName: 'CRUD',
        lastName: `Evidence ${suffix}`,
        fullName: `CRUD Evidence Employee ${suffix}`,
      },
    });
    rememberSeededModel('Employee', evidenceEmployee);
    const salesCommissionCreateEmployee = await prisma.employee.create({
      data: {
        employeeCode: `CECOMM${suffix}`,
        companyId: companyA.id,
        divisionId: divisionA.id,
        branchId: branchA.id,
        firstName: 'CRUD',
        lastName: `Commission ${suffix}`,
        fullName: `CRUD Commission Employee ${suffix}`,
        employmentStatus: 'ACTIVE',
      },
    });
    mutationBindings.set('salesCommissionCreateEmployee', salesCommissionCreateEmployee);

    const supplierSeed = await seedModelRecord('Supplier');
    const evidenceSupplier = await prisma.supplier.update({
      where: { id: stringField(supplierSeed, 'id') },
      data: {
        companyId: companyA.id,
        divisionId: divisionA.id,
        branchId: branchA.id,
        name: `CRUD Evidence Supplier ${suffix}`,
        status: 'ACTIVE',
      },
    });
    rememberSeededModel('Supplier', evidenceSupplier);
    const supplierPerformanceCreateSupplier = await prisma.supplier.create({
      data: {
        supplierCode: `CEPERF${suffix}`,
        companyId: companyA.id,
        divisionId: divisionA.id,
        branchId: branchA.id,
        name: `CRUD Performance Supplier ${suffix}`,
        status: 'ACTIVE',
        createdById: creator.id,
        updatedById: creator.id,
      },
    });
    mutationBindings.set('supplierPerformanceCreateSupplier', supplierPerformanceCreateSupplier);
    await seedActionTrancheControls({
      productId: product.id,
      supplierId: evidenceSupplier.id,
      unitId: unit.id,
    });
    await seedFinancialActionPositiveControls(evidenceSupplier);

    for (const modelName of ['BusinessLicense', 'Contract', 'Document'] as const) {
      const seed = await seedModelRecord(modelName);
      const delegateName = `${modelName.charAt(0).toLowerCase()}${modelName.slice(1)}`;
      type ExpiryDelegate = {
        update(args: {
          where: { id: string };
          data: { expiryDate?: Date; endDate?: Date; status?: ContractStatus };
        }): Promise<Record<string, unknown>>;
      };
      const delegate = (prisma as unknown as Record<string, ExpiryDelegate>)[delegateName];
      const updated = await delegate.update({
        where: { id: stringField(seed, 'id') },
        data:
          modelName === 'Contract'
            ? {
                endDate: new Date('2099-01-01T00:00:00.000Z'),
                status: ContractStatus.ACTIVE,
              }
            : { expiryDate: new Date('2099-01-01T00:00:00.000Z') },
      });
      rememberSeededModel(modelName, updated);
    }

    await seedDomainReadScopeControls();
    westsidesReportReadSeed = await seedCrudWestsidesReportReadControls(prisma, {
      companyAId,
      companyBId,
      divisionAId,
      divisionBId,
      creatorUserId,
      suffix,
    });
    await seedDerivedReportReadControls();
    await seedGlobalAdminReadControls();
    await seedRemainingReadControls();
    await seedActionClosureControls();
    await seedAdminOperationsPositiveControls();
    await isolateFinancialAccountResolverRoles();
    await seedFinalProductCategoryDeleteControl();
    await bindAutonomyPayrollExclusions();

    [
      creatorToken,
      posterToken,
      restrictedToken,
      groupReaderToken,
      groupCompanyAReaderToken,
      fixedAssetCompanyDeniedToken,
    ] = await Promise.all([
      login(creator.email),
      login(poster.email),
      login(restricted.email),
      login(groupReader.email),
      login(groupCompanyAReader.email),
      login(fixedAssetCompanyDenied.email),
    ]);
    const posterRefreshTokens = await prisma.refreshToken.findMany({
      where: { userId: poster.id, revokedAt: null },
      select: { id: true },
    });
    if (posterRefreshTokens.length !== 1) {
      throw new Error(
        `CRUD evidence expected one live poster refresh token, received ${posterRefreshTokens.length}.`,
      );
    }
    posterRefreshTokenId = posterRefreshTokens[0].id;
    await captureRemainingSecurityReadValues();
  }

  async function seedPayrollReferenceData(createdById: string): Promise<void> {
    const [nssf, paye, wcf] = await prisma.$transaction([
      prisma.taxType.create({
        data: {
          taxTypeCode: 'NSSF',
          name: 'National Social Security Fund',
          taxCategory: 'PAYROLL_TAX',
          appliesToPayroll: true,
        },
      }),
      prisma.taxType.create({
        data: {
          taxTypeCode: 'PAYE_MAINLAND',
          name: 'Pay As You Earn — Mainland Tanzania',
          taxCategory: 'INCOME_TAX',
          isWithholding: true,
          appliesToPayroll: true,
        },
      }),
      prisma.taxType.create({
        data: {
          taxTypeCode: 'WCF',
          name: 'Workers Compensation Fund',
          taxCategory: 'PAYROLL_TAX',
          appliesToPayroll: true,
        },
      }),
    ]);
    const [payeRate] = await prisma.$transaction([
      prisma.taxRate.create({
        data: {
          taxTypeId: paye.id,
          rateName: 'PAYE Mainland 2025/26 (monthly)',
          rate: 0,
          calculationMethod: 'TIERED',
          effectiveFrom: new Date('2025-07-01T00:00:00.000Z'),
          createdById,
        },
      }),
      prisma.statutoryDeductionRule.create({
        data: {
          ruleCode: 'NSSF_PRIVATE',
          taxTypeId: nssf.id,
          name: 'NSSF private sector 10% employee + 10% employer',
          employeeContributionRate: 0.1,
          employerContributionRate: 0.1,
          effectiveFrom: new Date('2025-07-01T00:00:00.000Z'),
        },
      }),
      prisma.statutoryDeductionRule.create({
        data: {
          ruleCode: 'WCF_PRIVATE',
          taxTypeId: wcf.id,
          name: 'WCF private sector 0.5% employer',
          employeeContributionRate: 0,
          employerContributionRate: 0.005,
          effectiveFrom: new Date('2025-07-01T00:00:00.000Z'),
        },
      }),
    ]);
    await prisma.taxRateBracket.createMany({
      data: [
        {
          taxRateId: payeRate.id,
          tierOrder: 1,
          fromAmount: 0,
          toAmount: 270_000,
          marginalRate: 0,
          fixedAmount: 0,
        },
        {
          taxRateId: payeRate.id,
          tierOrder: 2,
          fromAmount: 270_000,
          toAmount: 520_000,
          marginalRate: 0.08,
          fixedAmount: 0,
        },
        {
          taxRateId: payeRate.id,
          tierOrder: 3,
          fromAmount: 520_000,
          toAmount: 760_000,
          marginalRate: 0.2,
          fixedAmount: 20_000,
        },
        {
          taxRateId: payeRate.id,
          tierOrder: 4,
          fromAmount: 760_000,
          toAmount: 1_000_000,
          marginalRate: 0.25,
          fixedAmount: 68_000,
        },
        {
          taxRateId: payeRate.id,
          tierOrder: 5,
          fromAmount: 1_000_000,
          toAmount: null,
          marginalRate: 0.3,
          fixedAmount: 128_000,
        },
      ],
    });
  }

  function createUser(email: string, roleId: string, companyId: string, passwordHash: string) {
    return prisma.user.create({
      data: {
        email,
        passwordHash,
        fullName: `CRUD Evidence ${email.split('@')[0]}`,
        status: 'ACTIVE',
        companyId,
        userRoles: { create: { roleId } },
        companyAccess: { create: { companyId, accessLevel: AccessLevel.MANAGE } },
      },
    });
  }

  async function fixedAssetCompanyDisposalDenialControl(): Promise<void> {
    const seededAsset = seededModels.get('FixedAsset');
    if (!seededAsset) {
      throw new Error('Fixed Assets denial control requires the generic FixedAsset seed.');
    }
    const assetId = stringField(seededAsset, 'id');
    if (!assetId) {
      throw new Error('Fixed Assets denial control seed has no id.');
    }

    const [before, principal] = await Promise.all([
      prisma.fixedAsset.findUnique({ where: { id: assetId } }),
      prisma.user.findUnique({
        where: { id: fixedAssetCompanyDeniedUserId },
        select: {
          userRoles: {
            select: {
              role: {
                select: {
                  scope: true,
                  rolePermissions: {
                    select: {
                      permission: { select: { code: true, isGroupControl: true } },
                    },
                  },
                },
              },
            },
          },
        },
      }),
    ]);
    if (!before) throw new Error(`Fixed Assets denial seed ${assetId} is absent.`);

    const auditIdsBefore = new Set(
      (await prisma.auditLog.findMany({ select: { id: true } })).map((row) => row.id),
    );
    const result = await invoke('FixedAssetsController.dispose', fixedAssetCompanyDeniedToken, {
      path: { id: assetId },
      body: {
        disposalDate: '2031-07-01T00:00:00.000Z',
        disposalStatus: 'DISPOSED',
        disposalValue: '25.50',
      },
    });
    const [after, auditDelta] = await Promise.all([
      prisma.fixedAsset.findUnique({ where: { id: assetId } }),
      prisma.auditLog
        .findMany({
          select: {
            id: true,
            action: true,
            entityType: true,
            entityId: true,
            userId: true,
            companyId: true,
            scopeKind: true,
            attributionStatus: true,
            companyScopes: {
              select: { companyId: true },
              orderBy: { companyId: 'asc' },
            },
            channel: true,
            agentSessionId: true,
            metadata: true,
          },
          orderBy: { createdAt: 'asc' },
        })
        .then((rows) => rows.filter((row) => !auditIdsBefore.has(row.id))),
    ]);
    const denialAudit = auditDelta[0];
    const denialMetadata = isRecord(denialAudit?.metadata) ? denialAudit.metadata : undefined;
    const carriesDeliberateGrant =
      principal?.userRoles.some(
        ({ role }) =>
          role.scope === RoleScope.COMPANY &&
          role.rolePermissions.some(
            ({ permission }) =>
              permission.code === 'fixed-assets.update' && permission.isGroupControl,
          ),
      ) ?? false;

    let auditCleanupCount = 0;
    let auditCleanupError: string | undefined;
    try {
      if (auditDelta.length > 0) {
        auditCleanupCount = await deleteAuditLogsForTest(prisma, {
          id: { in: auditDelta.map((row) => row.id) },
        });
      }
    } catch (error) {
      auditCleanupError = safeError(error);
    }
    const auditRowsRemaining = await prisma.auditLog.count({
      where: { id: { in: auditDelta.map((row) => row.id) } },
    });

    await security(
      'fixed-assets-dispose-group-scope-denial',
      'permission_denial',
      result,
      async () => [
        check(
          'adversarial principal is COMPANY-scoped and deliberately carries group-control fixed-assets.update',
          carriesDeliberateGrant,
        ),
        check('company principal disposal was rejected', !result.ok, statusDetail(result)),
        check('Fixed Assets group boundary returned exact HTTP 403', result.status === 403),
        check(
          'asset row is byte-for-byte unchanged across the denied disposal',
          canonicalJson(normalizeDatabaseValue(after)) ===
            canonicalJson(normalizeDatabaseValue(before)),
        ),
        check(
          'denial emitted exactly one attributable sensitive audit row',
          auditDelta.length === 1 &&
            denialAudit?.action === 'VIEW_SENSITIVE_DENIED' &&
            denialAudit.entityType === 'FixedAssets' &&
            denialAudit.entityId === null &&
            denialAudit.userId === fixedAssetCompanyDeniedUserId &&
            denialAudit.channel === AuditChannel.AGENT &&
            denialAudit.agentSessionId === agentSessionId,
          `audit ids: ${auditDelta.map((row) => row.id).join(', ') || '<none>'}`,
        ),
        check(
          'denial audit has exact GROUP/EXPLICIT scope and no company snapshots',
          denialAudit?.companyId === null &&
            denialAudit?.scopeKind === AuditScopeKind.GROUP &&
            denialAudit.attributionStatus === AuditAttributionStatus.EXPLICIT &&
            denialAudit.companyScopes.length === 0,
        ),
        check(
          'denial audit records the handler-stage Fixed Assets permission decision',
          denialMetadata?.outcome === 'denied' &&
            denialMetadata.stage === 'handler' &&
            denialMetadata.statusCode === 403 &&
            denialMetadata.method === 'PATCH' &&
            denialMetadata.reason === 'Group-scoped role required to dispose fixed assets' &&
            JSON.stringify(denialMetadata.requiredPermissions) ===
              JSON.stringify(['fixed-assets.update']),
        ),
        check(
          'named-trigger maintenance removed the exact Fixed Assets denial audit row',
          !auditCleanupError && auditCleanupCount === 1 && auditRowsRemaining === 0,
          auditCleanupError ?? `deleted=${auditCleanupCount} remaining=${auditRowsRemaining}`,
        ),
      ],
    );
  }

  async function collaborativeServicePrincipalTaskScopeControl(): Promise<void> {
    const fixtureId = 'customer-create-service-principal-task-scope';
    const capabilityId = 'CustomersController.create';
    const customerCodes = [1, 2, 3, 4].map((index) => `CESP${index}${suffix}`);
    const taskCompanyId = companyBId;
    const taskBranchId = branchBId;
    const taskInitiatorId = groupReaderUserId;
    const config = app.get(ConfigService);
    const globalPrincipalKey = config.get<string>(
      'MSAIDIZI_AUTONOMY_PRINCIPAL_KEY',
      'global-msaidizi',
    );
    const tokens = app.get(MsaidiziTaskTokenService);
    const runtime = app.get(MsaidiziTaskStepHandler) as unknown as {
      reserveAttempt(task: unknown, step: unknown): Promise<{ id: string; number: number } | null>;
      markAttemptRunning(taskId: string, attemptId: string): Promise<void>;
      succeed(
        taskId: string,
        stepId: string,
        attemptId: string,
        status: number,
        bytes: number,
        resultSha256: string,
        entityIdentifiers: Record<string, string>,
      ): Promise<void>;
      settleRejected(
        taskId: string,
        stepId: string,
        attemptId: string,
        reason: string,
      ): Promise<void>;
    };
    const previousConfig = {
      autonomy: config.get<string>('MSAIDIZI_AUTONOMY_ENABLED', 'false'),
      grants: config.get<string>('MSAIDIZI_AUTONOMY_GRANTS', ''),
      killSwitch: config.get<string>('MSAIDIZI_GLOBAL_KILL_SWITCH', 'false'),
      tokenTtl: config.get<string>('MSAIDIZI_TASK_TOKEN_TTL_SECONDS', '120'),
    };
    const databaseBefore = await databaseMutationSentinel();
    const taskEventSequenceBefore = await taskEventSequenceState();
    const auditIdsBefore = new Set(
      (await prisma.auditLog.findMany({ select: { id: true } })).map((row) => row.id),
    );
    const customerIdsBefore = new Set(
      (
        await prisma.customer.findMany({
          where: includingSoftDeletedWhere('Customer', {
            companyId: taskCompanyId,
            customerCode: { in: customerCodes },
          }),
          select: { id: true },
        })
      ).map((customer) => customer.id),
    );
    const assertions: CrudEvidenceAssertion[] = [];
    const issuedTokens: string[] = [];
    const createdCustomerIds: string[] = [];
    let principalId = '';
    let mandateId = '';
    let taskId = '';
    let successfulResult: InvocationResult = {
      ok: false,
      status: 0,
      body: null,
      error: 'Service-principal evidence action did not execute.',
    };
    let executionError: string | undefined;
    let cleanupError: string | undefined;
    let auditCleanupExpected = 0;
    let auditCleanupCount = 0;
    let cleanupClosed = false;
    let cleanupMutationDetail: string | undefined;

    try {
      // The disposable harness keeps cloud reasoning and every worker/device
      // path disabled. It raises only the deployment-owned task-credential
      // switches in the already-started local app so the production token,
      // strategy, guard, and controller pipeline execute without provisioning
      // a provider contract or dispatching an autonomous worker.
      config.set('MSAIDIZI_AUTONOMY_ENABLED', 'true');
      config.set('MSAIDIZI_AUTONOMY_GRANTS', 'customers.create,customers.view');
      config.set('MSAIDIZI_GLOBAL_KILL_SWITCH', 'false');
      config.set('MSAIDIZI_TASK_TOKEN_TTL_SECONDS', '120');

      if (await prisma.msaidiziPrincipal.findUnique({ where: { key: globalPrincipalKey } })) {
        throw new Error('Collaborative service lane requires an isolated global principal row.');
      }
      const principal = await prisma.msaidiziPrincipal.upsert({
        where: { key: globalPrincipalKey },
        update: {
          grants: {
            scope: RoleScope.GROUP,
            authoritySource: 'deployment-policy',
            permissions: ['customers.create'],
          },
        },
        create: {
          key: globalPrincipalKey,
          displayName: 'Msaidizi',
          status: 'ACTIVE',
          grants: {
            scope: RoleScope.GROUP,
            authoritySource: 'deployment-policy',
            permissions: ['customers.create'],
          },
          createdByUserId: taskInitiatorId,
        },
      });
      principalId = principal.id;
      const mandate = await prisma.msaidiziMandate.create({
        data: {
          principalId,
          companyId: taskCompanyId,
          createdByUserId: taskInitiatorId,
          name: `CRUD Evidence Mandate ${suffix}`,
          description: 'Isolated exact-action service-principal evidence mandate.',
          status: 'ACTIVE',
          capabilities: [
            {
              capability: capabilityId,
              version: '1',
              effects: [MsaidiziEffect.WRITE],
              dataClasses: ['INTERNAL'],
            },
          ],
          deviceIds: [],
          budgets: {
            maxWallTimeSeconds: 300,
            maxModelTurns: 1,
            maxAttemptedToolCalls: 4,
            maxMutations: 4,
            maxLocalBytes: 1_048_576,
            maxExternalEgressBytes: 0,
            maxModelCostUsd: 0,
          },
          startsAt: new Date(Date.now() - 60_000),
          expiresAt: new Date(Date.now() + 10 * 60_000),
          activatedAt: new Date(),
        },
      });
      mandateId = mandate.id;
      // This fixture inserts an already-running task. Keep its persisted birth
      // and first-start instant identical: the database intentionally rejects
      // caller-supplied starts that predate the row they belong to.
      const taskStartedAt = new Date();
      const task = await prisma.msaidiziTask.create({
        data: {
          principalId,
          initiatedByUserId: taskInitiatorId,
          companyId: taskCompanyId,
          mandateId,
          mode: MsaidiziTaskMode.COLLABORATIVE,
          title: `CRUD service credential proof ${suffix}`,
          objective: 'Prove one-shot exact-action service credentials and recover all writes.',
          status: MsaidiziTaskStatus.RUNNING,
          activePlanVersion: 1,
          createdAt: taskStartedAt,
          startedAt: taskStartedAt,
          lastCheckpointAt: taskStartedAt,
          maxWallTimeSeconds: 300,
          maxModelTurns: 1,
          maxAttemptedToolCalls: 4,
          maxMutations: 4,
          maxLocalBytes: 1_048_576n,
          maxExternalEgressBytes: 0n,
          maxModelCostUsd: 0,
        },
      });
      taskId = task.id;
      const initialWallTimeMs = task.wallTimeCheckpointAt
        ? BigInt(task.wallTimeCheckpointAt.getTime() - taskStartedAt.getTime())
        : -1n;
      assertions.push(
        check(
          'database initialized the coherent already-running fixture on its hard wall clock',
          task.createdAt.getTime() === taskStartedAt.getTime() &&
            task.startedAt?.getTime() === taskStartedAt.getTime() &&
            task.lastCheckpointAt?.getTime() === taskStartedAt.getTime() &&
            task.wallTimeCheckpointAt !== null &&
            initialWallTimeMs >= 0n &&
            initialWallTimeMs < 60_000n &&
            task.consumedWallTimeMs === initialWallTimeMs,
          `consumed=${task.consumedWallTimeMs.toString()} derived=${initialWallTimeMs.toString()}`,
        ),
      );
      const plan = await prisma.msaidiziPlanVersion.create({
        data: {
          taskId,
          version: 1,
          createdByUserId: taskInitiatorId,
          summary:
            'Four isolated attempts independently cover success, capability mismatch, argument tampering, and live grant revocation.',
          objective: task.objective,
          inputs: { companyId: taskCompanyId, branchId: taskBranchId },
          stopConditions: ['any_unexpected_mutation'],
          budgetSnapshot: {
            maxAttemptedToolCalls: 4,
            maxMutations: 4,
            maxLocalBytes: 1_048_576,
          },
          planDigest: sha256Hex(`crud-service-plan:${taskId}:1`),
        },
      });
      const requestEnvelopes = customerCodes.map((customerCode, index) => ({
        path: {},
        query: {},
        body: {
          companyId: taskCompanyId,
          branchId: taskBranchId,
          customerType: CustomerType.INDIVIDUAL,
          customerCode,
          name: `CRUD Service Customer ${index + 1} ${suffix}`,
        },
      }));
      const steps: Array<{ id: string }> = [];
      for (const [index, actionEnvelope] of requestEnvelopes.entries()) {
        steps.push(
          await prisma.msaidiziTaskStep.create({
            data: {
              taskId,
              planVersionId: plan.id,
              stepKey: `service-create-${index + 1}`,
              sequence: index + 1,
              name: `Service create control ${index + 1}`,
              target: MsaidiziExecutionTarget.ERP,
              capability: capabilityId,
              capabilityVersion: '1',
              arguments: actionEnvelope,
              dependencies: [],
              expectedEffect: MsaidiziEffect.WRITE,
              dataClass: 'INTERNAL',
              preconditions: { companyId: taskCompanyId, branchId: taskBranchId },
              recovery: { kind: 'delete-created-customer', customerCode: customerCodes[index] },
              budgets: { maxResponseBytes: 262_144 },
              stopConditions: ['unexpected_customer_count'],
              idempotent: false,
              mutation: true,
              status: MsaidiziTaskStepStatus.LEASED,
            },
          }),
        );
      }

      const reserveAndIssue = async (stepId: string) => {
        const [currentTask, currentStep] = await Promise.all([
          prisma.msaidiziTask.findUnique({ where: { id: taskId } }),
          prisma.msaidiziTaskStep.findUnique({ where: { id: stepId } }),
        ]);
        if (!currentTask || !currentStep) throw new Error('Service evidence task state vanished.');
        const reservation = await runtime.reserveAttempt(currentTask, currentStep);
        if (!reservation) throw new Error(`Could not reserve service attempt for ${stepId}.`);
        const issued = await tokens.issue({ taskId, stepId });
        const persistedAttempt = await prisma.msaidiziToolAttempt.findUnique({
          where: { id: reservation.id },
          select: { resolvedInputProvenance: true, inputProvenanceSha256: true },
        });
        if (!persistedAttempt) {
          throw new Error(`Reserved service attempt vanished before invocation for ${stepId}.`);
        }
        issuedTokens.push(issued.accessToken);
        await runtime.markAttemptRunning(taskId, reservation.id);
        return { reservation, issued, persistedAttempt };
      };
      const settleSucceeded = async (
        stepId: string,
        attemptId: string,
        result: InvocationResult,
        customerId: string,
      ) => {
        // Prisma projections may legitimately contain BigInt/Decimal/Date
        // values. The evidence canonicalizer intentionally accepts only JSON
        // values, so normalize the response before deriving its fallback
        // byte-count and digest.
        const encoded = canonicalJson(normalizeDatabaseValue(result.body));
        await runtime.succeed(
          taskId,
          stepId,
          attemptId,
          result.status,
          result.responseBytes ?? Buffer.byteLength(encoded, 'utf8'),
          result.responseSha256 ?? sha256Hex(encoded),
          { customerId },
        );
      };

      const initiatorScope = await prisma.user.findUnique({
        where: { id: taskInitiatorId },
        select: {
          companyId: true,
          companyAccess: { select: { companyId: true, accessLevel: true } },
        },
      });
      const first = await reserveAndIssue(steps[0].id);
      assertions.push(
        check(
          'Collaborative task is bound to a non-primary company with explicit live human access',
          initiatorScope?.companyId === companyAId &&
            taskCompanyId === companyBId &&
            initiatorScope.companyAccess.some(
              (access) =>
                access.companyId === taskCompanyId && access.accessLevel === AccessLevel.MANAGE,
            ),
        ),
        check(
          'issued credential digest matches the exact first {path,query,body} envelope',
          first.issued.argsDigest === exactActionEnvelopeDigest(requestEnvelopes[0]),
        ),
        check(
          'issued credential provenance digest matches the exact persisted input graph',
          typeof first.issued.inputProvenanceSha256 === 'string' &&
            /^[a-f0-9]{64}$/.test(first.issued.inputProvenanceSha256) &&
            first.issued.inputProvenanceSha256 === first.persistedAttempt.inputProvenanceSha256 &&
            first.persistedAttempt.resolvedInputProvenance != null &&
            sha256Hex(canonicalJson(first.persistedAttempt.resolvedInputProvenance)) ===
              first.issued.inputProvenanceSha256,
        ),
      );
      successfulResult = await invoke(
        capabilityId,
        first.issued.accessToken,
        requestEnvelopes[0],
        first.issued.inputProvenanceSha256,
      );
      const firstCustomerId = successfulResult.ok
        ? stringField(unwrapRecord(successfulResult.body), 'id')
        : '';
      if (firstCustomerId) createdCustomerIds.push(firstCustomerId);
      const replay = await invoke(
        capabilityId,
        first.issued.accessToken,
        requestEnvelopes[0],
        first.issued.inputProvenanceSha256,
      );
      const firstCount = await prisma.customer.count({
        where: { companyId: taskCompanyId, customerCode: customerCodes[0] },
      });
      assertions.push(
        check(
          'task-issued service credential reached the real create controller',
          successfulResult.ok,
          statusDetail(successfulResult),
        ),
        check('successful service create returned exact HTTP 201', successfulResult.status === 201),
        check(
          'the same task credential replay is rejected by JWT one-shot consumption',
          replay.status === 401,
          statusDetail(replay),
        ),
        check(
          'replay did not duplicate the isolated customer',
          firstCount === 1,
          `count=${firstCount}`,
        ),
      );
      if (successfulResult.ok && firstCustomerId) {
        await settleSucceeded(steps[0].id, first.reservation.id, successfulResult, firstCustomerId);
      }

      const second = await reserveAndIssue(steps[1].id);
      const wrongCapability = await invoke(
        'CustomersController.findAll',
        second.issued.accessToken,
        {
          path: {},
          query: { companyId: taskCompanyId, page: 1, limit: 1 },
        },
        second.issued.inputProvenanceSha256,
      );
      const afterWrongCapability = await prisma.msaidiziToolAttempt.findUnique({
        where: { id: second.reservation.id },
        select: { credentialConsumedAt: true },
      });

      const third = await reserveAndIssue(steps[2].id);
      const tamperedEnvelope = {
        ...requestEnvelopes[2],
        body: { ...requestEnvelopes[2].body, name: `Tampered ${suffix}` },
      };
      const changedArguments = await invoke(
        capabilityId,
        third.issued.accessToken,
        tamperedEnvelope,
        third.issued.inputProvenanceSha256,
      );
      const afterChangedArguments = await prisma.msaidiziToolAttempt.findUnique({
        where: { id: third.reservation.id },
        select: { credentialConsumedAt: true },
      });
      const [wrongCapabilityCustomerCount, tamperedCustomerCount] = await Promise.all([
        prisma.customer.count({
          where: { companyId: taskCompanyId, customerCode: customerCodes[1] },
        }),
        prisma.customer.count({
          where: { companyId: taskCompanyId, customerCode: customerCodes[2] },
        }),
      ]);
      assertions.push(
        check(
          'credential is rejected on a different controller capability',
          wrongCapability.status === 403,
          statusDetail(wrongCapability),
        ),
        check(
          'capability mismatch consumes its independently reserved one-shot credential',
          Boolean(afterWrongCapability?.credentialConsumedAt),
        ),
        check(
          'capability mismatch did not execute its planned customer mutation',
          wrongCapabilityCustomerCount === 0,
          `count=${wrongCapabilityCustomerCount}`,
        ),
        check(
          'credential is rejected when one body byte changes',
          changedArguments.status === 403,
          statusDetail(changedArguments),
        ),
        check(
          'argument mismatch consumes its independently reserved one-shot credential',
          Boolean(afterChangedArguments?.credentialConsumedAt),
        ),
        check(
          'argument mismatch did not execute its planned customer mutation',
          tamperedCustomerCount === 0,
          `count=${tamperedCustomerCount}`,
        ),
      );

      const fourth = await reserveAndIssue(steps[3].id);
      const initiatingUserCreateGrant = await prisma.user.count({
        where: {
          id: taskInitiatorId,
          userRoles: {
            some: {
              role: {
                rolePermissions: {
                  some: { permission: { code: 'customers.create' } },
                },
              },
            },
          },
        },
      });
      await prisma.msaidiziPrincipal.update({
        where: { id: principalId },
        data: {
          grants: {
            scope: RoleScope.GROUP,
            authoritySource: 'deployment-policy',
            permissions: ['customers.view'],
          },
        },
      });
      const liveGrantDenied = await invoke(
        capabilityId,
        fourth.issued.accessToken,
        requestEnvelopes[3],
        fourth.issued.inputProvenanceSha256,
      );
      const [fourthAttemptAfterDenial, deniedCustomerCount, livePrincipal] = await Promise.all([
        prisma.msaidiziToolAttempt.findUnique({
          where: { id: fourth.reservation.id },
          select: { credentialConsumedAt: true },
        }),
        prisma.customer.count({
          where: { companyId: taskCompanyId, customerCode: customerCodes[3] },
        }),
        prisma.msaidiziPrincipal.findUnique({
          where: { id: principalId },
          select: { grants: true },
        }),
      ]);
      assertions.push(
        check(
          'initiating human still holds customers.create during the live grant probe',
          initiatingUserCreateGrant === 1,
        ),
        check(
          'deployment grant still contains customers.create during the live grant probe',
          config
            .get<string>('MSAIDIZI_AUTONOMY_GRANTS', '')
            .split(',')
            .includes('customers.create'),
        ),
        check(
          'persisted principal grant was narrowed after token issuance',
          canonicalJson(livePrincipal?.grants) ===
            canonicalJson({
              scope: RoleScope.GROUP,
              authoritySource: 'deployment-policy',
              permissions: ['customers.view'],
            }),
        ),
        check(
          'JWT strategy applies the live principal/deployment/human intersection',
          liveGrantDenied.status === 403,
          statusDetail(liveGrantDenied),
        ),
        check(
          'permission denial occurs after exact-action one-shot consumption',
          Boolean(fourthAttemptAfterDenial?.credentialConsumedAt),
        ),
        check(
          'live principal revocation prevented the fourth customer mutation',
          deniedCustomerCount === 0,
          `count=${deniedCustomerCount}`,
        ),
      );
      await prisma.msaidiziPrincipal.update({
        where: { id: principalId },
        data: {
          grants: {
            scope: RoleScope.GROUP,
            authoritySource: 'deployment-policy',
            permissions: ['customers.create'],
          },
        },
      });
      await runtime.settleRejected(
        taskId,
        steps[1].id,
        second.reservation.id,
        'EXACT_CAPABILITY_MISMATCH',
      );
      await runtime.settleRejected(
        taskId,
        steps[2].id,
        third.reservation.id,
        'EXACT_ACTION_ARGUMENT_MISMATCH',
      );
      await runtime.settleRejected(
        taskId,
        steps[3].id,
        fourth.reservation.id,
        'LIVE_PRINCIPAL_PERMISSION_DENIED',
      );

      const [
        persistedTask,
        persistedPlan,
        persistedSteps,
        attempts,
        events,
        persistedMandate,
        persistedPrincipal,
        persistedNotifications,
        persistedCustomers,
        principalCount,
        allAudits,
      ] = await Promise.all([
        prisma.msaidiziTask.findUnique({ where: { id: taskId } }),
        prisma.msaidiziPlanVersion.findUnique({ where: { id: plan.id } }),
        prisma.msaidiziTaskStep.findMany({ where: { taskId }, orderBy: { sequence: 'asc' } }),
        prisma.msaidiziToolAttempt.findMany({ where: { taskId } }),
        prisma.msaidiziTaskEvent.findMany({ where: { taskId }, orderBy: { cursor: 'asc' } }),
        prisma.msaidiziMandate.findUnique({ where: { id: mandateId } }),
        prisma.msaidiziPrincipal.findUnique({ where: { id: principalId } }),
        prisma.notification.findMany({
          where: { linkedEntityType: 'MsaidiziTask', linkedEntityId: taskId },
        }),
        prisma.customer.findMany({
          where: { companyId: taskCompanyId, customerCode: { in: customerCodes } },
        }),
        prisma.msaidiziPrincipal.count(),
        prisma.auditLog.findMany({
          select: {
            id: true,
            action: true,
            entityType: true,
            entityId: true,
            userId: true,
            companyId: true,
            scopeKind: true,
            attributionStatus: true,
            severity: true,
            channel: true,
            agentSessionId: true,
            principalType: true,
            principalId: true,
            mandateId: true,
            initiatedByUserId: true,
            taskId: true,
            stepId: true,
            oldValue: true,
            newValue: true,
            metadata: true,
            companyScopes: { select: { companyId: true }, orderBy: { companyId: 'asc' } },
          },
          orderBy: { createdAt: 'asc' },
        }),
      ]);
      const auditDelta = allAudits.filter((row) => !auditIdsBefore.has(row.id));
      auditCleanupExpected = auditDelta.length;
      const attemptsByStepId = new Map(attempts.map((attempt) => [attempt.stepId, attempt]));
      const orderedAttempts = steps.flatMap((step) => {
        const attempt = attemptsByStepId.get(step.id);
        return attempt ? [attempt] : [];
      });
      const taskAudits = auditDelta.filter((row) => row.taskId === taskId);
      const credentialDenials = taskAudits.filter(
        (row) => row.action === 'MSAIDIZI_TASK_CREDENTIAL_DENIED',
      );
      const scopeDenials = taskAudits.filter((row) => row.action === 'MSAIDIZI_TASK_SCOPE_DENIED');
      const permissionDenials = taskAudits.filter(
        (row) => row.action === 'MSAIDIZI_TASK_PERMISSION_DENIED',
      );
      const businessAudits = taskAudits.filter(
        (row) =>
          row.action === 'CUSTOMER_CREATE' && createdCustomerIds.includes(row.entityId ?? ''),
      );
      const expectedTaskSession = `task_${taskId.replace(/-/g, '')}`;
      const expectedAuditActionSteps = [
        ...steps.map((step) => `MSAIDIZI_ERP_MUTATION_REQUESTED:${step.id}`),
        `MSAIDIZI_ERP_ACTION_SUCCEEDED:${steps[0].id}`,
        ...steps.slice(1).map((step) => `MSAIDIZI_ERP_ACTION_REJECTED:${step.id}`),
        `CUSTOMER_CREATE:${steps[0].id}`,
        `MSAIDIZI_TASK_CREDENTIAL_DENIED:${steps[0].id}`,
        `MSAIDIZI_TASK_SCOPE_DENIED:${steps[1].id}`,
        `MSAIDIZI_TASK_SCOPE_DENIED:${steps[2].id}`,
        `MSAIDIZI_TASK_PERMISSION_DENIED:${steps[3].id}`,
      ].sort();
      const actualAuditActionSteps = taskAudits
        .map((row) => `${row.action}:${row.stepId ?? '<none>'}`)
        .sort();
      const allTaskAuditsAttributed =
        taskAudits.length === expectedAuditActionSteps.length &&
        taskAudits.every(
          (row) =>
            row.userId === taskInitiatorId &&
            row.attributionStatus === AuditAttributionStatus.EXPLICIT &&
            row.channel === AuditChannel.AGENT &&
            row.agentSessionId === expectedTaskSession &&
            row.principalType === MSAIDIZI_SERVICE_PRINCIPAL_TYPE &&
            row.principalId === principalId &&
            row.mandateId === mandateId &&
            row.initiatedByUserId === taskInitiatorId &&
            row.taskId === taskId &&
            steps.some((step) => step.id === row.stepId),
        );
      const persistedProjection = canonicalJson(
        normalizeDatabaseValue({
          persistedTask,
          persistedPlan,
          persistedSteps,
          attempts,
          events,
          persistedMandate,
          persistedPrincipal,
          persistedNotifications,
          persistedCustomers,
          principalCount,
          auditDelta,
        }),
      );
      assertions.push(
        check(
          'runtime attempt reservation charged exact task/step counters',
          persistedTask?.attemptedToolCalls === 4 &&
            persistedTask.executedToolCalls === 4 &&
            persistedTask.mutations === 4 &&
            persistedSteps.every((step) => step.attemptCount === 1),
        ),
        check(
          'Collaborative lane uses the configured global deployment-policy principal shape',
          principalCount === 1 &&
            persistedPrincipal?.key === globalPrincipalKey &&
            canonicalJson(persistedPrincipal.grants) ===
              canonicalJson({
                scope: RoleScope.GROUP,
                authoritySource: 'deployment-policy',
                permissions: ['customers.create'],
              }),
        ),
        check(
          'task and mandate retain the same initiating authority anchor',
          persistedTask?.initiatedByUserId === taskInitiatorId &&
            persistedMandate?.createdByUserId === taskInitiatorId,
        ),
        check(
          'all four adversarial probes are independent reachable DAG steps',
          persistedSteps.every(
            (step) => Array.isArray(step.dependencies) && step.dependencies.length === 0,
          ),
        ),
        check(
          'runtime settlement persisted one success and three governed rejections',
          orderedAttempts.map((attempt) => attempt.status).join(',') ===
            'SUCCEEDED,REJECTED,REJECTED,REJECTED' &&
            persistedSteps.map((step) => step.status).join(',') ===
              'SUCCEEDED,NEEDS_ATTENTION,NEEDS_ATTENTION,NEEDS_ATTENTION',
        ),
        check(
          'each attempt stores the exact digest and a consumed one-way JTI digest',
          orderedAttempts.length === 4 &&
            orderedAttempts.every(
              (attempt, index) =>
                attempt.argsDigest === exactActionEnvelopeDigest(requestEnvelopes[index]) &&
                /^[a-f0-9]{64}$/.test(attempt.credentialJtiDigest ?? '') &&
                Boolean(attempt.credentialConsumedAt),
            ),
        ),
        check(
          'attempt/event ledger contains every reservation and terminal checkpoint',
          events.filter((event) => event.type === 'tool.attempted').length === 4 &&
            events.filter((event) => event.type === 'step.succeeded').length === 1 &&
            events.filter((event) => event.type === 'tool.rejected').length === 3,
        ),
        check(
          'successful controller mutation emitted its exact business audit',
          businessAudits.length === 1,
        ),
        check(
          'replay rejection was strictly audited against the consumed successful step',
          credentialDenials.length === 1 &&
            credentialDenials[0].stepId === steps[0].id &&
            credentialDenials[0].severity === AuditSeverity.HIGH &&
            credentialDenials[0].companyId === taskCompanyId &&
            credentialDenials[0].scopeKind === AuditScopeKind.COMPANY,
        ),
        check(
          'capability and argument mismatches each emitted a strict task-scope denial',
          scopeDenials.length === 2 &&
            scopeDenials.every(
              (row) =>
                [steps[1].id, steps[2].id].includes(row.stepId ?? '') &&
                row.companyId === taskCompanyId &&
                row.scopeKind === AuditScopeKind.COMPANY &&
                row.severity === AuditSeverity.HIGH,
            ),
        ),
        check(
          'live principal-grant narrowing emitted an immediate strict permission denial',
          permissionDenials.length === 1 &&
            permissionDenials[0].stepId === steps[3].id &&
            permissionDenials[0].companyId === taskCompanyId &&
            permissionDenials[0].scopeKind === AuditScopeKind.COMPANY &&
            permissionDenials[0].severity === AuditSeverity.HIGH,
        ),
        check(
          'Collaborative audit ledger has the exact action/step multiset with no extras or duplicates',
          auditDelta.length === taskAudits.length &&
            canonicalJson(actualAuditActionSteps) === canonicalJson(expectedAuditActionSteps),
          `actual=${actualAuditActionSteps.join(',')}`,
        ),
        check(
          'all task and business audits carry complete SERVICE/task/step/mandate attribution',
          allTaskAuditsAttributed,
          `taskAudits=${taskAudits.length}`,
        ),
        check(
          'every Collaborative task audit is explicitly bound to the task company snapshot',
          taskAudits.every(
            (row) =>
              row.companyId === taskCompanyId &&
              row.scopeKind === AuditScopeKind.COMPANY &&
              row.companyScopes.map((scope) => scope.companyId).join(',') === taskCompanyId,
          ),
        ),
        check(
          'no raw task bearer is persisted in any isolated task, event, notification, business, or audit row',
          issuedTokens.every((token) => !persistedProjection.includes(token)),
        ),
      );
    } catch (error) {
      executionError = safeError(error);
    } finally {
      try {
        if (principalId) {
          await prisma.msaidiziPrincipal
            .update({
              where: { id: principalId },
              data: {
                grants: {
                  scope: RoleScope.GROUP,
                  authoritySource: 'deployment-policy',
                  permissions: ['customers.create'],
                },
              },
            })
            .catch(() => undefined);
        }
        // Customer is soft-deletable. PrismaService rewrites deleteMany into a
        // tombstone update, which makes an ordinary count return zero while a
        // physical row still violates the whole-schema recovery sentinel.
        // Resolve only fixture-scoped rows that were absent at entry and remove
        // each exact primary key through the disposable-schema guard.
        const fixtureCustomers = await prisma.customer.findMany({
          where: includingSoftDeletedWhere('Customer', {
            companyId: taskCompanyId,
            customerCode: { in: customerCodes },
          }),
          select: { id: true },
        });
        for (const customer of fixtureCustomers) {
          if (!customerIdsBefore.has(customer.id)) {
            await physicallyDeleteMutationRecord('Customer', { id: customer.id });
          }
        }
        if (taskId) {
          await prisma.notification.deleteMany({
            where: { linkedEntityType: 'MsaidiziTask', linkedEntityId: taskId },
          });
        }
        const auditIds = (await prisma.auditLog.findMany({ select: { id: true } }))
          .filter((row) => !auditIdsBefore.has(row.id))
          .map((row) => row.id);
        auditCleanupExpected = Math.max(auditCleanupExpected, auditIds.length);
        if (auditIds.length > 0) {
          auditCleanupCount = await deleteAuditLogsForTest(prisma, { id: { in: auditIds } });
        }
        if (taskId) {
          await deleteDisposableTaskGraphsAndRestoreSequence([taskId], taskEventSequenceBefore);
        }
        if (mandateId) await prisma.msaidiziMandate.deleteMany({ where: { id: mandateId } });
        if (principalId) await prisma.msaidiziPrincipal.deleteMany({ where: { id: principalId } });
        const [
          newCustomersRemaining,
          taskRemaining,
          mandateRemaining,
          principalRemaining,
          auditsRemaining,
          taskEventsRemaining,
        ] = await Promise.all([
          prisma.customer
            .findMany({
              where: includingSoftDeletedWhere('Customer', {
                companyId: taskCompanyId,
                customerCode: { in: customerCodes },
              }),
              select: { id: true },
            })
            .then(
              (customers) =>
                customers.filter((customer) => !customerIdsBefore.has(customer.id)).length,
            ),
          taskId ? prisma.msaidiziTask.count({ where: { id: taskId } }) : Promise.resolve(0),
          mandateId
            ? prisma.msaidiziMandate.count({ where: { id: mandateId } })
            : Promise.resolve(0),
          principalId
            ? prisma.msaidiziPrincipal.count({ where: { id: principalId } })
            : Promise.resolve(0),
          prisma.auditLog.count({ where: { id: { notIn: [...auditIdsBefore] } } }),
          taskId ? prisma.msaidiziTaskEvent.count({ where: { taskId } }) : Promise.resolve(0),
        ]);
        const databaseAfter = await databaseMutationSentinel();
        const databaseRestored = canonicalJson(databaseAfter) === canonicalJson(databaseBefore);
        cleanupMutationDetail = databaseRestored
          ? undefined
          : databaseMutationDetail(databaseBefore, databaseAfter);
        cleanupClosed =
          newCustomersRemaining === 0 &&
          taskRemaining === 0 &&
          mandateRemaining === 0 &&
          principalRemaining === 0 &&
          auditsRemaining === 0 &&
          taskEventsRemaining === 0 &&
          auditCleanupCount === auditCleanupExpected &&
          databaseRestored;
      } catch (error) {
        cleanupError = safeError(error);
      } finally {
        config.set('MSAIDIZI_AUTONOMY_ENABLED', previousConfig.autonomy);
        config.set('MSAIDIZI_AUTONOMY_GRANTS', previousConfig.grants);
        config.set('MSAIDIZI_GLOBAL_KILL_SWITCH', previousConfig.killSwitch);
        config.set('MSAIDIZI_TASK_TOKEN_TTL_SECONDS', previousConfig.tokenTtl);
      }
    }

    await security(fixtureId, 'service_principal_task_scope', successfulResult, async () => [
      check(
        'service-principal lane completed without a harness exception',
        !executionError,
        executionError,
      ),
      ...assertions,
      check(
        'recovery restored the whole-schema sentinel including every isolated row and sequence',
        !cleanupError && cleanupClosed,
        cleanupError ??
          cleanupMutationDetail ??
          `auditDeleted=${auditCleanupCount}/${auditCleanupExpected}`,
      ),
    ]);
  }

  async function autopilotServicePrincipalMandateScopeControl(): Promise<void> {
    const fixtureId = 'user-dashboard-list-autopilot-mandate-scope';
    const capabilityId = 'UserDashboardPreferencesController.list';
    const actionEnvelope = { path: {}, query: {} };
    const config = app.get(ConfigService);
    const globalPrincipalKey = config.get<string>(
      'MSAIDIZI_AUTONOMY_PRINCIPAL_KEY',
      'global-msaidizi',
    );
    const tokens = app.get(MsaidiziTaskTokenService);
    const runtime = app.get(MsaidiziTaskStepHandler) as unknown as {
      reserveAttempt(task: unknown, step: unknown): Promise<{ id: string; number: number } | null>;
      markAttemptRunning(taskId: string, attemptId: string): Promise<void>;
      succeed(
        taskId: string,
        stepId: string,
        attemptId: string,
        status: number,
        bytes: number,
        resultSha256: string,
        entityIdentifiers: Record<string, string>,
      ): Promise<void>;
      settleRejected(
        taskId: string,
        stepId: string,
        attemptId: string,
        reason: string,
      ): Promise<void>;
    };
    const previousConfig = {
      autonomy: config.get<string>('MSAIDIZI_AUTONOMY_ENABLED', 'false'),
      grants: config.get<string>('MSAIDIZI_AUTONOMY_GRANTS', ''),
      killSwitch: config.get<string>('MSAIDIZI_GLOBAL_KILL_SWITCH', 'false'),
      tokenTtl: config.get<string>('MSAIDIZI_TASK_TOKEN_TTL_SECONDS', '120'),
    };
    const databaseBefore = await databaseMutationSentinel();
    const taskEventSequenceBefore = await taskEventSequenceState();
    const auditIdsBefore = new Set(
      (await prisma.auditLog.findMany({ select: { id: true } })).map((row) => row.id),
    );
    const assertions: CrudEvidenceAssertion[] = [];
    const issuedTokens: string[] = [];
    let principalId = '';
    let mandateId = '';
    let taskId = '';
    let successfulResult: InvocationResult = {
      ok: false,
      status: 0,
      body: null,
      error: 'Autopilot service-principal evidence action did not execute.',
    };
    let executionError: string | undefined;
    let cleanupError: string | undefined;
    let auditCleanupExpected = 0;
    let auditCleanupCount = 0;
    let cleanupClosed = false;

    try {
      config.set('MSAIDIZI_AUTONOMY_ENABLED', 'true');
      config.set('MSAIDIZI_AUTONOMY_GRANTS', 'dashboard_preferences.manage');
      config.set('MSAIDIZI_GLOBAL_KILL_SWITCH', 'false');
      config.set('MSAIDIZI_TASK_TOKEN_TTL_SECONDS', '120');

      if (await prisma.msaidiziPrincipal.findUnique({ where: { key: globalPrincipalKey } })) {
        throw new Error('Autopilot service lane requires an isolated global principal row.');
      }
      const principal = await prisma.msaidiziPrincipal.upsert({
        where: { key: globalPrincipalKey },
        update: {
          grants: {
            scope: RoleScope.GROUP,
            authoritySource: 'deployment-policy',
            permissions: ['dashboard_preferences.manage'],
          },
        },
        create: {
          key: globalPrincipalKey,
          displayName: 'Msaidizi',
          status: 'ACTIVE',
          grants: {
            scope: RoleScope.GROUP,
            authoritySource: 'deployment-policy',
            permissions: ['dashboard_preferences.manage'],
          },
          createdByUserId: creatorUserId,
        },
      });
      principalId = principal.id;
      const exactMandateCapabilities = [
        {
          capability: capabilityId,
          version: '1',
          effects: [MsaidiziEffect.READ],
          dataClasses: ['INTERNAL'],
        },
      ];
      const mandate = await prisma.msaidiziMandate.create({
        data: {
          principalId,
          createdByUserId: creatorUserId,
          name: `CRUD Autopilot Mandate ${suffix}`,
          description: 'Isolated GROUP-scoped Autopilot and local-JWT-guard evidence mandate.',
          status: 'ACTIVE',
          capabilities: exactMandateCapabilities,
          deviceIds: [],
          budgets: {
            maxWallTimeSeconds: 300,
            maxModelTurns: 1,
            maxAttemptedToolCalls: 2,
            maxMutations: 0,
            maxLocalBytes: 1_048_576,
            maxExternalEgressBytes: 0,
            maxModelCostUsd: 0,
          },
          startsAt: new Date(Date.now() - 60_000),
          expiresAt: new Date(Date.now() + 10 * 60_000),
          activatedAt: new Date(),
        },
      });
      mandateId = mandate.id;
      // This fixture inserts an already-running task. Keep its persisted birth
      // and first-start instant identical: the database intentionally rejects
      // caller-supplied starts that predate the row they belong to.
      const taskStartedAt = new Date();
      const task = await prisma.msaidiziTask.create({
        data: {
          principalId,
          initiatedByUserId: creatorUserId,
          mandateId,
          mode: MsaidiziTaskMode.AUTOPILOT,
          title: `CRUD Autopilot service proof ${suffix}`,
          objective:
            'Prove GROUP Autopilot mandate narrowing and idempotent global/local JWT authentication.',
          status: MsaidiziTaskStatus.RUNNING,
          activePlanVersion: 1,
          createdAt: taskStartedAt,
          startedAt: taskStartedAt,
          lastCheckpointAt: taskStartedAt,
          maxWallTimeSeconds: 300,
          maxModelTurns: 1,
          maxAttemptedToolCalls: 2,
          maxMutations: 0,
          maxLocalBytes: 1_048_576n,
          maxExternalEgressBytes: 0n,
          maxModelCostUsd: 0,
        },
      });
      taskId = task.id;
      const initialWallTimeMs = task.wallTimeCheckpointAt
        ? BigInt(task.wallTimeCheckpointAt.getTime() - taskStartedAt.getTime())
        : -1n;
      assertions.push(
        check(
          'database initialized the coherent already-running fixture on its hard wall clock',
          task.createdAt.getTime() === taskStartedAt.getTime() &&
            task.startedAt?.getTime() === taskStartedAt.getTime() &&
            task.lastCheckpointAt?.getTime() === taskStartedAt.getTime() &&
            task.wallTimeCheckpointAt !== null &&
            initialWallTimeMs >= 0n &&
            initialWallTimeMs < 60_000n &&
            task.consumedWallTimeMs === initialWallTimeMs,
          `consumed=${task.consumedWallTimeMs.toString()} derived=${initialWallTimeMs.toString()}`,
        ),
      );
      const plan = await prisma.msaidiziPlanVersion.create({
        data: {
          taskId,
          version: 1,
          createdByUserId: creatorUserId,
          summary:
            'Two isolated reads cover the locally guarded success path and live mandate narrowing.',
          objective: task.objective,
          inputs: { actorId: creatorUserId },
          stopConditions: ['any_unplanned_side_effect'],
          budgetSnapshot: {
            maxAttemptedToolCalls: 2,
            maxMutations: 0,
            maxLocalBytes: 1_048_576,
          },
          planDigest: sha256Hex(`crud-autopilot-plan:${taskId}:1`),
        },
      });
      const steps: Array<{ id: string }> = [];
      for (const index of [0, 1]) {
        steps.push(
          await prisma.msaidiziTaskStep.create({
            data: {
              taskId,
              planVersionId: plan.id,
              stepKey: `autopilot-dashboard-${index + 1}`,
              sequence: index + 1,
              name: `Autopilot dashboard read ${index + 1}`,
              target: MsaidiziExecutionTarget.ERP,
              capability: capabilityId,
              capabilityVersion: '1',
              arguments: actionEnvelope,
              dependencies: [],
              expectedEffect: MsaidiziEffect.READ,
              dataClass: 'INTERNAL',
              preconditions: { principalScope: RoleScope.GROUP, mandateStatus: 'ACTIVE' },
              recovery: { kind: 'none', reason: 'read_only' },
              budgets: { maxResponseBytes: 262_144 },
              stopConditions: ['unexpected_mutation'],
              idempotent: true,
              mutation: false,
              status: MsaidiziTaskStepStatus.LEASED,
            },
          }),
        );
      }

      const reserveAndIssue = async (stepId: string) => {
        const [currentTask, currentStep] = await Promise.all([
          prisma.msaidiziTask.findUnique({ where: { id: taskId } }),
          prisma.msaidiziTaskStep.findUnique({ where: { id: stepId } }),
        ]);
        if (!currentTask || !currentStep)
          throw new Error('Autopilot evidence task state vanished.');
        const reservation = await runtime.reserveAttempt(currentTask, currentStep);
        if (!reservation) throw new Error(`Could not reserve Autopilot attempt for ${stepId}.`);
        const issued = await tokens.issue({ taskId, stepId });
        const persistedAttempt = await prisma.msaidiziToolAttempt.findUnique({
          where: { id: reservation.id },
          select: { resolvedInputProvenance: true, inputProvenanceSha256: true },
        });
        if (!persistedAttempt) {
          throw new Error(`Reserved Autopilot attempt vanished before invocation for ${stepId}.`);
        }
        issuedTokens.push(issued.accessToken);
        await runtime.markAttemptRunning(taskId, reservation.id);
        return { reservation, issued, persistedAttempt };
      };
      const settleSucceeded = async (
        stepId: string,
        attemptId: string,
        result: InvocationResult,
      ) => {
        const encoded = canonicalJson(normalizeDatabaseValue(result.body));
        await runtime.succeed(
          taskId,
          stepId,
          attemptId,
          result.status,
          result.responseBytes ?? Buffer.byteLength(encoded, 'utf8'),
          result.responseSha256 ?? sha256Hex(encoded),
          {},
        );
      };

      const first = await reserveAndIssue(steps[0].id);
      successfulResult = await invoke(
        capabilityId,
        first.issued.accessToken,
        actionEnvelope,
        first.issued.inputProvenanceSha256,
      );
      const firstAttemptAfterSuccess = await prisma.msaidiziToolAttempt.findUnique({
        where: { id: first.reservation.id },
        select: { credentialConsumedAt: true },
      });
      const replay = await invoke(
        capabilityId,
        first.issued.accessToken,
        actionEnvelope,
        first.issued.inputProvenanceSha256,
      );
      assertions.push(
        check(
          'Autopilot credential digest matches the exact {path,query} read envelope',
          first.issued.argsDigest === exactActionEnvelopeDigest(actionEnvelope),
        ),
        check(
          'Autopilot credential provenance digest matches the exact persisted input graph',
          typeof first.issued.inputProvenanceSha256 === 'string' &&
            /^[a-f0-9]{64}$/.test(first.issued.inputProvenanceSha256) &&
            first.issued.inputProvenanceSha256 === first.persistedAttempt.inputProvenanceSha256 &&
            first.persistedAttempt.resolvedInputProvenance != null &&
            sha256Hex(canonicalJson(first.persistedAttempt.resolvedInputProvenance)) ===
              first.issued.inputProvenanceSha256,
        ),
        check(
          'GROUP Autopilot crosses global and controller-local JWT guards without double consumption',
          successfulResult.ok && successfulResult.status === 200,
          statusDetail(successfulResult),
        ),
        check(
          'successful locally guarded read consumed the reserved credential exactly once',
          Boolean(firstAttemptAfterSuccess?.credentialConsumedAt),
        ),
        check(
          'replay of the locally guarded read is rejected at the JWT boundary',
          replay.status === 401,
          statusDetail(replay),
        ),
      );
      if (successfulResult.ok) {
        await settleSucceeded(steps[0].id, first.reservation.id, successfulResult);
      }

      const second = await reserveAndIssue(steps[1].id);
      await prisma.msaidiziMandate.update({
        where: { id: mandateId },
        data: {
          capabilities: [
            {
              ...exactMandateCapabilities[0],
              capability: 'UserDashboardPreferencesController.get',
            },
          ],
        },
      });
      const mandateNarrowed = await invoke(
        capabilityId,
        second.issued.accessToken,
        actionEnvelope,
        second.issued.inputProvenanceSha256,
      );
      const [secondAttemptAfterDenial, liveMandate] = await Promise.all([
        prisma.msaidiziToolAttempt.findUnique({
          where: { id: second.reservation.id },
          select: { credentialConsumedAt: true },
        }),
        prisma.msaidiziMandate.findUnique({
          where: { id: mandateId },
          select: { capabilities: true, status: true },
        }),
      ]);
      assertions.push(
        check(
          'persisted active mandate was narrowed after token issuance',
          liveMandate?.status === 'ACTIVE' &&
            canonicalJson(liveMandate.capabilities) !== canonicalJson(exactMandateCapabilities),
        ),
        check(
          'JWT strategy rejects an exact token after live mandate tuple narrowing',
          mandateNarrowed.status === 401,
          statusDetail(mandateNarrowed),
        ),
        check(
          'mandate-narrowing denial consumed its independently reserved credential',
          Boolean(secondAttemptAfterDenial?.credentialConsumedAt),
        ),
      );
      await prisma.msaidiziMandate.update({
        where: { id: mandateId },
        data: { capabilities: exactMandateCapabilities },
      });
      await runtime.settleRejected(
        taskId,
        steps[1].id,
        second.reservation.id,
        'LIVE_MANDATE_CAPABILITY_DENIED',
      );

      const [
        persistedTask,
        persistedPlan,
        persistedSteps,
        attempts,
        events,
        persistedMandate,
        persistedPrincipal,
        persistedNotifications,
        principalCount,
        allAudits,
      ] = await Promise.all([
        prisma.msaidiziTask.findUnique({ where: { id: taskId } }),
        prisma.msaidiziPlanVersion.findUnique({ where: { id: plan.id } }),
        prisma.msaidiziTaskStep.findMany({ where: { taskId }, orderBy: { sequence: 'asc' } }),
        prisma.msaidiziToolAttempt.findMany({ where: { taskId } }),
        prisma.msaidiziTaskEvent.findMany({ where: { taskId }, orderBy: { cursor: 'asc' } }),
        prisma.msaidiziMandate.findUnique({ where: { id: mandateId } }),
        prisma.msaidiziPrincipal.findUnique({ where: { id: principalId } }),
        prisma.notification.findMany({
          where: { linkedEntityType: 'MsaidiziTask', linkedEntityId: taskId },
        }),
        prisma.msaidiziPrincipal.count(),
        prisma.auditLog.findMany({
          select: {
            id: true,
            action: true,
            userId: true,
            companyId: true,
            scopeKind: true,
            attributionStatus: true,
            severity: true,
            channel: true,
            agentSessionId: true,
            principalType: true,
            principalId: true,
            mandateId: true,
            initiatedByUserId: true,
            taskId: true,
            stepId: true,
            oldValue: true,
            newValue: true,
            metadata: true,
            companyScopes: { select: { companyId: true }, orderBy: { companyId: 'asc' } },
          },
          orderBy: { createdAt: 'asc' },
        }),
      ]);
      const auditDelta = allAudits.filter((row) => !auditIdsBefore.has(row.id));
      auditCleanupExpected = auditDelta.length;
      const taskAudits = auditDelta.filter((row) => row.taskId === taskId);
      const credentialDenials = taskAudits.filter(
        (row) => row.action === 'MSAIDIZI_TASK_CREDENTIAL_DENIED',
      );
      const attemptsByStepId = new Map(attempts.map((attempt) => [attempt.stepId, attempt]));
      const orderedAttempts = steps.flatMap((step) => {
        const attempt = attemptsByStepId.get(step.id);
        return attempt ? [attempt] : [];
      });
      const expectedTaskSession = `task_${taskId.replace(/-/g, '')}`;
      const expectedAuditActionSteps = [
        ...steps.map((step) => `MSAIDIZI_ERP_READ_REQUESTED:${step.id}`),
        `MSAIDIZI_ERP_ACTION_SUCCEEDED:${steps[0].id}`,
        `MSAIDIZI_ERP_ACTION_REJECTED:${steps[1].id}`,
        `MSAIDIZI_TASK_CREDENTIAL_DENIED:${steps[0].id}`,
        `MSAIDIZI_TASK_CREDENTIAL_DENIED:${steps[1].id}`,
      ].sort();
      const actualAuditActionSteps = taskAudits
        .map((row) => `${row.action}:${row.stepId ?? '<none>'}`)
        .sort();
      const persistedProjection = canonicalJson(
        normalizeDatabaseValue({
          persistedTask,
          persistedPlan,
          persistedSteps,
          attempts,
          events,
          persistedMandate,
          persistedPrincipal,
          persistedNotifications,
          principalCount,
          auditDelta,
        }),
      );
      assertions.push(
        check(
          'Autopilot principal and deployment grants intersect on the exact live permission',
          principalCount === 1 &&
            persistedPrincipal?.key === globalPrincipalKey &&
            canonicalJson(persistedPrincipal.grants) ===
              canonicalJson({
                scope: RoleScope.GROUP,
                authoritySource: 'deployment-policy',
                permissions: ['dashboard_preferences.manage'],
              }) &&
            config
              .get<string>('MSAIDIZI_AUTONOMY_GRANTS', '')
              .split(',')
              .includes('dashboard_preferences.manage'),
        ),
        check(
          'both Autopilot probes are independent reachable DAG steps',
          persistedSteps.every(
            (step) => Array.isArray(step.dependencies) && step.dependencies.length === 0,
          ),
        ),
        check(
          'Autopilot runtime charged two reads and zero mutations',
          persistedTask?.attemptedToolCalls === 2 &&
            persistedTask.executedToolCalls === 2 &&
            persistedTask.mutations === 0 &&
            persistedSteps.every((step) => step.attemptCount === 1),
        ),
        check(
          'Autopilot attempts settle by step sequence rather than duplicate attemptNumber ordering',
          orderedAttempts.map((attempt) => attempt.status).join(',') === 'SUCCEEDED,REJECTED' &&
            persistedSteps.map((step) => step.status).join(',') === 'SUCCEEDED,NEEDS_ATTENTION',
        ),
        check(
          'both Autopilot attempt tokens store a consumed one-way JTI digest and exact args digest',
          orderedAttempts.length === 2 &&
            orderedAttempts.every(
              (attempt) =>
                attempt.argsDigest === exactActionEnvelopeDigest(actionEnvelope) &&
                /^[a-f0-9]{64}$/.test(attempt.credentialJtiDigest ?? '') &&
                Boolean(attempt.credentialConsumedAt),
            ),
        ),
        check(
          'Autopilot event ledger contains both reservations and terminal checkpoints',
          events.filter((event) => event.type === 'tool.attempted').length === 2 &&
            events.filter((event) => event.type === 'step.succeeded').length === 1 &&
            events.filter((event) => event.type === 'tool.rejected').length === 1,
        ),
        check(
          'one replay and one mandate denial were strictly audited at the credential boundary',
          credentialDenials.length === 2 &&
            credentialDenials.some(
              (row) =>
                row.stepId === steps[0].id &&
                isRecord(row.metadata) &&
                row.metadata.stage === 'one_shot',
            ) &&
            credentialDenials.some(
              (row) =>
                row.stepId === steps[1].id &&
                isRecord(row.metadata) &&
                row.metadata.stage === 'live_policy',
            ),
        ),
        check(
          'Autopilot audit ledger has the exact action/step multiset with no extras or duplicates',
          auditDelta.length === taskAudits.length &&
            canonicalJson(actualAuditActionSteps) === canonicalJson(expectedAuditActionSteps),
          `actual=${actualAuditActionSteps.join(',')}`,
        ),
        check(
          'every Autopilot audit has complete GROUP SERVICE/task/step/mandate attribution',
          taskAudits.length === expectedAuditActionSteps.length &&
            taskAudits.every(
              (row) =>
                row.userId === creatorUserId &&
                row.companyId === null &&
                row.scopeKind === AuditScopeKind.GROUP &&
                row.attributionStatus === AuditAttributionStatus.EXPLICIT &&
                row.companyScopes.length === 0 &&
                row.channel === AuditChannel.AGENT &&
                row.agentSessionId === expectedTaskSession &&
                row.principalType === MSAIDIZI_SERVICE_PRINCIPAL_TYPE &&
                row.principalId === principalId &&
                row.mandateId === mandateId &&
                row.initiatedByUserId === creatorUserId &&
                row.taskId === taskId &&
                steps.some((step) => step.id === row.stepId),
            ),
          `taskAudits=${taskAudits.length}`,
        ),
        check(
          'no raw Autopilot bearer is persisted in any isolated task, event, notification, or audit row',
          issuedTokens.every((token) => !persistedProjection.includes(token)),
        ),
      );
    } catch (error) {
      executionError = safeError(error);
    } finally {
      try {
        if (mandateId) {
          await prisma.msaidiziMandate
            .update({
              where: { id: mandateId },
              data: {
                capabilities: [
                  {
                    capability: capabilityId,
                    version: '1',
                    effects: [MsaidiziEffect.READ],
                    dataClasses: ['INTERNAL'],
                  },
                ],
              },
            })
            .catch(() => undefined);
        }
        if (taskId) {
          await prisma.notification.deleteMany({
            where: { linkedEntityType: 'MsaidiziTask', linkedEntityId: taskId },
          });
        }
        const auditIds = (await prisma.auditLog.findMany({ select: { id: true } }))
          .filter((row) => !auditIdsBefore.has(row.id))
          .map((row) => row.id);
        auditCleanupExpected = Math.max(auditCleanupExpected, auditIds.length);
        if (auditIds.length > 0) {
          auditCleanupCount = await deleteAuditLogsForTest(prisma, { id: { in: auditIds } });
        }
        if (taskId) {
          await deleteDisposableTaskGraphsAndRestoreSequence([taskId], taskEventSequenceBefore);
        }
        if (mandateId) await prisma.msaidiziMandate.deleteMany({ where: { id: mandateId } });
        if (principalId) await prisma.msaidiziPrincipal.deleteMany({ where: { id: principalId } });
        const [
          taskRemaining,
          mandateRemaining,
          principalRemaining,
          auditsRemaining,
          eventsRemaining,
        ] = await Promise.all([
          taskId ? prisma.msaidiziTask.count({ where: { id: taskId } }) : Promise.resolve(0),
          mandateId
            ? prisma.msaidiziMandate.count({ where: { id: mandateId } })
            : Promise.resolve(0),
          principalId
            ? prisma.msaidiziPrincipal.count({ where: { id: principalId } })
            : Promise.resolve(0),
          prisma.auditLog.count({ where: { id: { notIn: [...auditIdsBefore] } } }),
          taskId ? prisma.msaidiziTaskEvent.count({ where: { taskId } }) : Promise.resolve(0),
        ]);
        const databaseAfter = await databaseMutationSentinel();
        cleanupClosed =
          taskRemaining === 0 &&
          mandateRemaining === 0 &&
          principalRemaining === 0 &&
          auditsRemaining === 0 &&
          eventsRemaining === 0 &&
          auditCleanupCount === auditCleanupExpected &&
          canonicalJson(databaseAfter) === canonicalJson(databaseBefore);
      } catch (error) {
        cleanupError = safeError(error);
      } finally {
        config.set('MSAIDIZI_AUTONOMY_ENABLED', previousConfig.autonomy);
        config.set('MSAIDIZI_AUTONOMY_GRANTS', previousConfig.grants);
        config.set('MSAIDIZI_GLOBAL_KILL_SWITCH', previousConfig.killSwitch);
        config.set('MSAIDIZI_TASK_TOKEN_TTL_SECONDS', previousConfig.tokenTtl);
      }
    }

    await security(fixtureId, 'service_principal_task_scope', successfulResult, async () => [
      check(
        'Autopilot service-principal lane completed without a harness exception',
        !executionError,
        executionError,
      ),
      ...assertions,
      check(
        'Autopilot recovery restored the whole-schema sentinel including task events and sequence',
        !cleanupError && cleanupClosed,
        cleanupError ?? `auditDeleted=${auditCleanupCount}/${auditCleanupExpected}`,
      ),
    ]);
  }

  async function taskEventSequenceState(): Promise<{
    schemaName: string;
    sequenceName: string;
    lastValue: string;
    isCalled: boolean;
  }> {
    const schemaRows = await prisma.$queryRaw<Array<{ schema_name: string }>>`
      SELECT current_schema()::text AS schema_name
    `;
    const schemaName = schemaRows[0]?.schema_name;
    if (!schemaName || !/^msaidizi_crud_evidence_[a-z0-9_]{8,80}$/.test(schemaName)) {
      throw new Error(`Unexpected task-event evidence schema ${schemaName ?? '<missing>'}.`);
    }
    const sequenceName = 'msaidizi_task_events_cursor_seq';
    const sequenceRows = await prisma.$queryRawUnsafe<
      Array<{ last_value: string; is_called: boolean }>
    >(`SELECT last_value::text AS last_value, is_called FROM "${schemaName}"."${sequenceName}"`);
    const state = sequenceRows[0];
    if (
      sequenceRows.length !== 1 ||
      !state ||
      !/^\d+$/.test(state.last_value) ||
      typeof state.is_called !== 'boolean'
    ) {
      throw new Error('Msaidizi task-event sequence state is missing or malformed.');
    }
    return { schemaName, sequenceName, lastValue: state.last_value, isCalled: state.is_called };
  }

  async function deleteDisposableTaskGraphsAndRestoreSequence(
    taskIds: string[],
    sequenceBefore: Awaited<ReturnType<typeof taskEventSequenceState>>,
  ): Promise<void> {
    const exactTaskIds = [...new Set(taskIds.filter(Boolean))];
    if (exactTaskIds.length === 0) return;
    const eventBounds = await prisma.msaidiziTaskEvent.aggregate({
      where: { taskId: { in: exactTaskIds } },
      _min: { cursor: true },
      _max: { cursor: true },
      _count: { cursor: true },
    });
    if (eventBounds._count.cursor > 0 && eventBounds._min.cursor !== null) {
      const interleavedRows = await prisma.msaidiziTaskEvent.count({
        where: {
          cursor: { gte: eventBounds._min.cursor },
          taskId: { notIn: exactTaskIds },
        },
      });
      if (interleavedRows !== 0) {
        throw new Error('Refusing to remove non-tail task-event evidence rows.');
      }
    }
    const schema = `"${sequenceBefore.schemaName}"`;
    const triggerStatesBefore = await disposableTaskCleanupTriggerStates(sequenceBefore.schemaName);
    assertDisposableTaskCleanupTriggersEnabled(triggerStatesBefore, 'before cleanup');
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `ALTER TABLE ${schema}."msaidizi_task_events" DISABLE TRIGGER "msaidizi_task_event_append_only"`,
      );
      await tx.$executeRawUnsafe(
        `ALTER TABLE ${schema}."msaidizi_task_steps" DISABLE TRIGGER "msaidizi_task_steps_immutable_definition"`,
      );
      await tx.$executeRawUnsafe(
        `ALTER TABLE ${schema}."msaidizi_plan_versions" DISABLE TRIGGER "msaidizi_plan_versions_immutable"`,
      );
      await tx.msaidiziTaskEvent.deleteMany({ where: { taskId: { in: exactTaskIds } } });
      // Delete the exact disposable graph explicitly. Production cascades are
      // intentionally unable to erase reviewed plan/step authorization
      // artifacts while their immutable triggers are enabled.
      await tx.msaidiziTaskStep.deleteMany({ where: { taskId: { in: exactTaskIds } } });
      await tx.msaidiziPlanVersion.deleteMany({ where: { taskId: { in: exactTaskIds } } });
      await tx.msaidiziTask.deleteMany({ where: { id: { in: exactTaskIds } } });
      await tx.$executeRawUnsafe(
        `ALTER TABLE ${schema}."msaidizi_plan_versions" ENABLE TRIGGER "msaidizi_plan_versions_immutable"`,
      );
      await tx.$executeRawUnsafe(
        `ALTER TABLE ${schema}."msaidizi_task_steps" ENABLE TRIGGER "msaidizi_task_steps_immutable_definition"`,
      );
      await tx.$executeRawUnsafe(
        `ALTER TABLE ${schema}."msaidizi_task_events" ENABLE TRIGGER "msaidizi_task_event_append_only"`,
      );
    });
    await prisma.$queryRawUnsafe(
      `SELECT setval('"${sequenceBefore.schemaName}"."${sequenceBefore.sequenceName}"'::regclass, ${sequenceBefore.lastValue}::bigint, ${sequenceBefore.isCalled ? 'true' : 'false'})`,
    );
    const triggerStatesAfter = await disposableTaskCleanupTriggerStates(sequenceBefore.schemaName);
    assertDisposableTaskCleanupTriggersEnabled(triggerStatesAfter, 'after cleanup');
  }

  async function disposableTaskCleanupTriggerStates(
    schemaName: string,
  ): Promise<Array<{ tableName: string; triggerName: string; enabled: string }>> {
    return prisma.$queryRaw<Array<{ tableName: string; triggerName: string; enabled: string }>>`
      SELECT
        relation.relname::text AS "tableName",
        trigger.tgname::text AS "triggerName",
        trigger.tgenabled::text AS enabled
      FROM pg_trigger trigger
      INNER JOIN pg_class relation ON relation.oid = trigger.tgrelid
      INNER JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = ${schemaName}
        AND (
          (relation.relname = 'msaidizi_task_events'
            AND trigger.tgname = 'msaidizi_task_event_append_only')
          OR (relation.relname = 'msaidizi_task_steps'
            AND trigger.tgname = 'msaidizi_task_steps_immutable_definition')
          OR (relation.relname = 'msaidizi_plan_versions'
            AND trigger.tgname = 'msaidizi_plan_versions_immutable')
        )
      ORDER BY relation.relname, trigger.tgname
    `;
  }

  function assertDisposableTaskCleanupTriggersEnabled(
    states: Array<{ tableName: string; triggerName: string; enabled: string }>,
    phase: string,
  ): void {
    const expected = [
      'msaidizi_plan_versions:msaidizi_plan_versions_immutable:O',
      'msaidizi_task_events:msaidizi_task_event_append_only:O',
      'msaidizi_task_steps:msaidizi_task_steps_immutable_definition:O',
    ].sort();
    const actual = states
      .map((state) => `${state.tableName}:${state.triggerName}:${state.enabled}`)
      .sort();
    if (canonicalJson(actual) !== canonicalJson(expected)) {
      throw new Error(
        `Disposable task cleanup triggers were not all enabled ${phase}: ${actual.join(',') || '<none>'}.`,
      );
    }
  }

  async function seedReceivableRemoveControl(): Promise<void> {
    const customer = await prisma.customer.create({
      data: {
        customerCode: `CE-REMOVE-AR-${suffix}`,
        companyId: companyAId,
        divisionId: divisionAId,
        branchId: branchAId,
        name: `CRUD Evidence Isolated Receivable Customer ${suffix}`,
        currentBalance: 1,
        createdById: creatorUserId,
      },
    });
    const receivable = await prisma.receivable.create({
      data: {
        receivableNumber: `CE-REMOVE-AR-${suffix}`,
        companyId: companyAId,
        divisionId: divisionAId,
        branchId: branchAId,
        customerId: customer.id,
        customerName: customer.name,
        amount: 1,
        outstandingAmount: 1,
        issueDate: new Date('2026-08-25T00:00:00.000Z'),
        status: 'OPEN',
      },
    });
    mutationBindings.set('receivableRemoveCustomer', customer);
    mutationBindings.set('receivableRemoveTarget', receivable);
  }

  async function seedActionTrancheControls(input: {
    productId: string;
    supplierId: string;
    unitId: string;
  }): Promise<void> {
    const customer = await prisma.customer.create({
      data: {
        customerCode: `CE-ACTION-CUSTOMER-${suffix}`,
        companyId: companyAId,
        divisionId: divisionAId,
        branchId: branchAId,
        name: `CRUD action conversion customer ${suffix}`,
        createdById: creatorUserId,
      },
    });
    const proforma = await prisma.proformaInvoice.create({
      data: {
        proformaNumber: `CE-ACTION-PROFORMA-${suffix}`,
        companyId: companyAId,
        divisionId: divisionAId,
        branchId: branchAId,
        customerId: customer.id,
        customerName: customer.name,
        proformaDate: new Date('2026-08-25T00:00:00.000Z'),
        currency: 'TZS',
        subtotal: 20,
        discountAmount: 0,
        taxAmount: 0,
        totalAmount: 20,
        status: 'ACCEPTED',
        createdById: creatorUserId,
        lines: {
          create: {
            productId: input.productId,
            description: `CRUD action converted line ${suffix}`,
            quantity: 2,
            unitId: input.unitId,
            unitPrice: 10,
            discountAmount: 0,
            taxAmount: 0,
            lineTotal: 20,
          },
        },
      },
      include: { lines: true },
    });
    if (proforma.lines.length !== 1) {
      throw new Error('CRUD action tranche requires exactly one isolated proforma line.');
    }

    const purchaseOrder = await prisma.purchaseOrder.create({
      data: {
        purchaseOrderNumber: `CE-ACTION-PO-${suffix}`,
        companyId: companyAId,
        divisionId: divisionAId,
        branchId: branchAId,
        supplierId: input.supplierId,
        supplierName: stringField(seededModels.get('Supplier') ?? {}, 'name'),
        purchaseType: 'STOCK_PURCHASE',
        orderDate: new Date('2026-08-25T00:00:00.000Z'),
        currency: 'TZS',
        subtotal: 20,
        totalAmount: 20,
        outstandingAmount: 20,
        status: 'CONFIRMED',
        createdById: creatorUserId,
        lines: {
          create: {
            productId: input.productId,
            quantity: 2,
            unitId: input.unitId,
            unitCost: 10,
            lineTotal: 20,
          },
        },
      },
      include: { lines: true },
    });
    if (purchaseOrder.lines.length !== 1) {
      throw new Error('CRUD action tranche requires exactly one isolated purchase-order line.');
    }
    const supplierInvoice = await prisma.supplierInvoice.create({
      data: {
        supplierInvoiceNumber: `CE-ACTION-SI-${suffix}`,
        companyId: companyAId,
        divisionId: divisionAId,
        branchId: branchAId,
        supplierId: input.supplierId,
        purchaseOrderId: purchaseOrder.id,
        invoiceDate: new Date('2026-08-25T00:00:00.000Z'),
        subtotal: 20,
        totalAmount: 20,
        outstandingAmount: 20,
        currency: 'TZS',
        status: 'DRAFT',
        createdById: creatorUserId,
        lines: {
          create: {
            productId: input.productId,
            description: `CRUD action matched line ${suffix}`,
            quantity: 2,
            unitId: input.unitId,
            unitPrice: 10,
            lineTotal: 20,
          },
        },
      },
      include: { lines: true },
    });
    if (supplierInvoice.lines.length !== 1) {
      throw new Error('CRUD action tranche requires exactly one isolated supplier-invoice line.');
    }
    const sequence = await prisma.documentNumberSequence.create({
      data: {
        sequenceCode: `ThreeWayMatch_${companyAId}`,
        companyId: companyAId,
        entityType: 'ThreeWayMatch',
        prefix: 'CE-TWM-',
        currentNumber: 300,
        padding: 5,
        resetFrequency: 'NEVER',
        isActive: true,
      },
    });

    mutationBindings.set('actionTrancheProformaCustomer', customer);
    mutationBindings.set('actionTrancheProforma', proforma);
    mutationBindings.set('actionTrancheProformaLine', proforma.lines[0]);
    mutationBindings.set(
      'actionTrancheConvertedOrderNote',
      `Converted from proforma ${proforma.proformaNumber}`,
    );
    mutationBindings.set('actionTranchePurchaseOrder', purchaseOrder);
    mutationBindings.set('actionTrancheSupplierInvoice', supplierInvoice);
    mutationBindings.set('actionTrancheThreeWayMatchSequence', sequence);
  }

  async function seedFinancialActionPositiveControls(supplier: {
    id: string;
    name: string;
  }): Promise<void> {
    const fixedDate = new Date('2026-08-25T12:00:00.000Z');
    const customerPaymentReverseBaselineDate = new Date('2026-07-01T12:00:00.000Z');
    const fiscalYearB = await prisma.fiscalYear.create({
      data: {
        companyId: companyBId,
        name: `CRUD Finance FY B ${suffix}`,
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        endDate: new Date('2026-12-31T23:59:59.999Z'),
      },
    });
    const [periodB, thirdAccountA, debitAccountB, creditAccountB, financeCashAccount] =
      await Promise.all([
        prisma.accountingPeriod.create({
          data: {
            companyId: companyBId,
            fiscalYearId: fiscalYearB.id,
            name: `CRUD Finance Period B ${suffix}`,
            startDate: new Date('2026-01-01T00:00:00.000Z'),
            endDate: new Date('2026-12-31T23:59:59.999Z'),
          },
        }),
        prisma.chartOfAccount.create({
          data: {
            companyId: companyAId,
            accountCode: `190${suffix}`,
            accountName: `CRUD Finance Third Account A ${suffix}`,
            accountType: AccountType.ASSET,
          },
        }),
        prisma.chartOfAccount.create({
          data: {
            companyId: companyBId,
            accountCode: `100${suffix}`,
            accountName: `CRUD Finance Debit Account B ${suffix}`,
            accountType: AccountType.ASSET,
          },
        }),
        prisma.chartOfAccount.create({
          data: {
            companyId: companyBId,
            accountCode: `200${suffix}`,
            accountName: `CRUD Finance Credit Account B ${suffix}`,
            accountType: AccountType.LIABILITY,
          },
        }),
        prisma.cashAccount.create({
          data: {
            companyId: companyAId,
            accountName: `CRUD Finance Unscoped Cash ${suffix}`,
            accountType: CashAccountType.CASH_ON_HAND,
            openingBalance: 100,
            currentBalance: 100,
          },
        }),
      ]);

    const auditAdjustment = seededModels.get('AuditAdjustment');
    const firstAuditLine = seededModels.get('AuditAdjustmentLine');
    const parkedMatch = seededModels.get('BankReconciliationMatch');
    const sourceJournal = seededModels.get('JournalEntry');
    const sourceDebitLine = seededModels.get('JournalEntryLine');
    if (!auditAdjustment || !firstAuditLine || !parkedMatch || !sourceJournal || !sourceDebitLine) {
      throw new Error(
        'CRUD finance controls require canonical audit-adjustment, parked-match and journal seeds.',
      );
    }
    const auditAdjustmentId = requiredEvidenceString(
      auditAdjustment.id,
      'financial AuditAdjustment.id',
    );
    const cashAccountId = financeCashAccount.id;
    const sourceJournalId = requiredEvidenceString(sourceJournal.id, 'financial JournalEntry.id');
    if (sourceJournalId !== exactRecordIds.journalEntryA) {
      throw new Error('CRUD finance controls must reuse the exact company-A journal seed.');
    }

    const auditSecondLine = await prisma.auditAdjustmentLine.create({
      data: {
        auditAdjustmentId,
        accountId: creditAccountId,
        description: `CRUD finance adjustment credit ${suffix}`,
        debit: 0,
        credit: 25,
      },
    });

    const bankMatchJournalLine = sourceDebitLine;

    const bankMatchReconciliation = await prisma.bankReconciliation.create({
      data: {
        reconciliationNumber: `CE-BR-MATCH-${suffix}`,
        companyId: companyAId,
        cashAccountId,
        statementStartDate: new Date('2026-08-25T00:00:00.000Z'),
        statementEndDate: new Date('2026-08-25T23:59:59.999Z'),
        statementOpeningBalance: 100,
        statementClosingBalance: 125,
        bookOpeningBalance: 100,
        bookClosingBalance: 125,
        reconciledBalance: 100,
        differenceAmount: 25,
        status: 'DRAFT',
        preparedById: creatorUserId,
        statementLines: {
          create: {
            transactionDate: fixedDate,
            description: `CRUD finance bank credit ${suffix}`,
            reference: `CE-BR-CREDIT-${suffix}`,
            debitAmount: 0,
            creditAmount: 25,
            balance: 125,
            matched: false,
          },
        },
      },
      include: { statementLines: true },
    });
    if (bankMatchReconciliation.statementLines.length !== 1) {
      throw new Error('CRUD finance bank matching requires exactly one unmatched statement line.');
    }
    const bankMatchStatementLine = bankMatchReconciliation.statementLines[0];

    const bankAdjustmentReconciliation = await prisma.bankReconciliation.create({
      data: {
        reconciliationNumber: 'CE-BR-ADJUST',
        companyId: companyAId,
        cashAccountId,
        statementStartDate: new Date('2026-08-01T00:00:00.000Z'),
        statementEndDate: new Date('2026-08-31T23:59:59.999Z'),
        statementOpeningBalance: 100,
        statementClosingBalance: 100,
        bookOpeningBalance: 100,
        bookClosingBalance: 100,
        reconciledBalance: 100,
        differenceAmount: 0,
        status: 'DRAFT',
        preparedById: creatorUserId,
      },
    });

    // CustomerPaymentsService derives Customer.currentBalance from every open
    // receivable owned by that customer. Generic model seeds are intentionally
    // reused by hundreds of controls, so they cannot prove the exact 100 -> 75
    // and 75 -> 100 balance projections. Give create and reverse independent
    // customers with exactly one receivable each, plus independent cash ledgers.
    const customerPaymentCreateControl = await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.create({
        data: {
          customerCode: `CE-FIN-CP-CREATE-${suffix}`,
          companyId: companyAId,
          customerType: CustomerType.INDIVIDUAL,
          name: 'Fixture Customer',
          currentBalance: 100,
          status: 'ACTIVE',
          createdById: creatorUserId,
        },
      });
      const receivable = await tx.receivable.create({
        data: {
          receivableNumber: `CE-FIN-CP-CREATE-RCV-${suffix}`,
          companyId: companyAId,
          customerId: customer.id,
          customerName: customer.name,
          amount: 100,
          paidAmount: 0,
          outstandingAmount: 100,
          currency: 'TZS',
          issueDate: fixedDate,
          status: 'OPEN',
        },
      });
      const cashAccount = await tx.cashAccount.create({
        data: {
          companyId: companyAId,
          accountName: 'Fixture cash',
          accountType: CashAccountType.CASH_ON_HAND,
          currency: 'TZS',
          openingBalance: 100,
          currentBalance: 100,
        },
      });
      return { customer, receivable, cashAccount };
    });

    const customerPaymentReverseControl = await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.create({
        data: {
          customerCode: `CE-FIN-CP-REVERSE-${suffix}`,
          companyId: companyAId,
          customerType: CustomerType.INDIVIDUAL,
          name: 'Fixture Customer',
          currentBalance: 75,
          status: 'ACTIVE',
          createdById: creatorUserId,
        },
      });
      const receivable = await tx.receivable.create({
        data: {
          receivableNumber: `CE-FIN-CP-REVERSE-RCV-${suffix}`,
          companyId: companyAId,
          customerId: customer.id,
          customerName: customer.name,
          amount: 100,
          paidAmount: 25,
          outstandingAmount: 75,
          currency: 'TZS',
          issueDate: fixedDate,
          status: 'PARTIALLY_PAID',
        },
      });
      const cashAccount = await tx.cashAccount.create({
        data: {
          companyId: companyAId,
          accountName: 'Fixture cash',
          accountType: CashAccountType.CASH_ON_HAND,
          currency: 'TZS',
          openingBalance: 100,
          currentBalance: 125,
        },
      });
      const journal = await tx.journalEntry.create({
        data: {
          journalNumber: `CE-FIN-CP-ORIGINAL-${suffix}`,
          companyId: companyAId,
          accountingPeriodId,
          // Keep this baseline source entry outside the bank auto-match fixture's
          // zero-day window. The reverse fixture explicitly moves it to fixedDate
          // in its snapshotted pre-state and recovery restores this baseline.
          // Otherwise this second 25.00 cash debit makes runMatching correctly
          // return AMBIGUOUS instead of proving its intended sole candidate.
          transactionDate: customerPaymentReverseBaselineDate,
          description: 'Customer payment CE-CUSTOMER-PAY',
          referenceType: 'CustomerPayment',
          status: 'POSTED',
          totalDebit: 25,
          totalCredit: 25,
          createdById: creatorUserId,
          postedById: creatorUserId,
          postedAt: customerPaymentReverseBaselineDate,
          lines: {
            create: [
              {
                accountId: debitAccountId,
                description: 'Payment received into Fixture cash',
                debit: 25,
                credit: 0,
                companyId: companyAId,
              },
              {
                accountId: creditAccountId,
                description: 'Settle receivables: Fixture Customer',
                debit: 0,
                credit: 25,
                companyId: companyAId,
              },
            ],
          },
        },
        include: { lines: true },
      });
      const debitLine = journal.lines.find(
        (line) =>
          line.accountId === debitAccountId &&
          Number(line.debit) === 25 &&
          Number(line.credit) === 0,
      );
      const creditLine = journal.lines.find(
        (line) =>
          line.accountId === creditAccountId &&
          Number(line.debit) === 0 &&
          Number(line.credit) === 25,
      );
      if (!debitLine || !creditLine || debitLine.id === creditLine.id) {
        throw new Error(
          'CRUD finance customer-payment reversal requires two distinct exact source-journal lines.',
        );
      }
      const payment = await tx.customerPayment.create({
        data: {
          paymentNumber: `CE-FIN-CP-REVERSE-${suffix}`,
          companyId: companyAId,
          customerId: customer.id,
          amount: 25,
          method: 'CASH',
          paymentDate: fixedDate,
          appliedAmount: 25,
          unappliedAmount: 0,
          currency: 'TZS',
          status: 'COMPLETED',
          cashAccountId: cashAccount.id,
          journalEntryId: journal.id,
          createdById: creatorUserId,
        },
      });
      const allocation = await tx.paymentAllocation.create({
        data: {
          customerPaymentId: payment.id,
          receivableId: receivable.id,
          companyId: companyAId,
          amount: 25,
        },
      });
      return {
        customer,
        receivable,
        cashAccount,
        journal,
        debitLine,
        creditLine,
        payment,
        allocation,
      };
    });

    const [scheduleLoan, emptyGrn, threeWayPurchaseOrder, threeWaySupplierInvoice] =
      await Promise.all([
        prisma.loan.create({
          data: {
            companyId: companyAId,
            loanReference: `CE-FIN-SCHEDULE-${suffix}`,
            lenderName: `CRUD Finance Schedule Lender ${suffix}`,
            principalAmount: 100,
            interestRate: 0,
            disbursementDate: new Date('2026-01-01T00:00:00.000Z'),
            maturityDate: new Date('2026-12-31T00:00:00.000Z'),
            repaymentFrequency: 'BULLET',
            outstandingBalance: 100,
            status: 'ACTIVE',
            createdById: creatorUserId,
          },
        }),
        prisma.goodsReceivedNote.create({
          data: {
            grnNumber: `CE-FIN-EMPTY-GRN-${suffix}`,
            companyId: companyAId,
            divisionId: divisionAId,
            branchId: branchAId,
            purchaseOrderId: null,
            supplierId: supplier.id,
            receivedDate: fixedDate,
            receivedById: creatorUserId,
            status: 'APPROVED',
            approvedById: creatorUserId,
          },
        }),
        prisma.purchaseOrder.create({
          data: {
            purchaseOrderNumber: `CE-FIN-TWM-PO-${suffix}`,
            companyId: companyAId,
            divisionId: divisionAId,
            branchId: branchAId,
            supplierId: supplier.id,
            supplierName: supplier.name,
            purchaseType: 'STOCK_PURCHASE',
            orderDate: fixedDate,
            subtotal: 0,
            discountAmount: 0,
            taxAmount: 0,
            totalAmount: 0,
            paidAmount: 0,
            outstandingAmount: 0,
            status: 'DRAFT',
            createdById: creatorUserId,
          },
        }),
        prisma.supplierInvoice.create({
          data: {
            supplierInvoiceNumber: `CE-FIN-TWM-SI-${suffix}`,
            companyId: companyAId,
            divisionId: divisionAId,
            branchId: branchAId,
            supplierId: supplier.id,
            invoiceDate: fixedDate,
            subtotal: 0,
            taxAmount: 0,
            discountAmount: 0,
            totalAmount: 0,
            paidAmount: 0,
            outstandingAmount: 0,
            status: 'DRAFT',
            createdById: creatorUserId,
          },
        }),
      ]);

    const threeWayMatchSequence = await prisma.documentNumberSequence.findFirst({
      where: { sequenceCode: `ThreeWayMatch_${companyAId}`, deletedAt: null },
    });
    if (!threeWayMatchSequence || threeWayMatchSequence.currentNumber !== 300) {
      throw new Error(
        'CRUD finance three-way matching requires the isolated action-tranche sequence at 300.',
      );
    }

    const [
      mainBankMatches,
      loanSchedules,
      emptyGrnLines,
      purchaseOrderLines,
      invoiceLines,
      matches,
    ] = await Promise.all([
      prisma.bankReconciliationMatch.count({
        where: { bankReconciliationId: bankMatchReconciliation.id },
      }),
      prisma.loanRepaymentSchedule.count({ where: { loanDebtId: scheduleLoan.id } }),
      prisma.goodsReceivedNoteLine.count({ where: { goodsReceivedNoteId: emptyGrn.id } }),
      prisma.purchaseOrderLine.count({ where: { purchaseOrderId: threeWayPurchaseOrder.id } }),
      prisma.supplierInvoiceLine.count({
        where: { supplierInvoiceId: threeWaySupplierInvoice.id },
      }),
      prisma.threeWayMatch.count({
        where: { supplierInvoiceId: threeWaySupplierInvoice.id, deletedAt: null },
      }),
    ]);
    if (
      mainBankMatches !== 0 ||
      loanSchedules !== 0 ||
      emptyGrnLines !== 0 ||
      purchaseOrderLines !== 0 ||
      invoiceLines !== 0 ||
      matches !== 0
    ) {
      throw new Error(
        'CRUD finance controls must begin with an unmatched bank line, unscheduled loan, empty GRN and zero-line unmatched procurement pair.',
      );
    }

    mutationBindings.set('financialPositiveAccountingPeriodB', periodB);
    mutationBindings.set('financialPositiveThirdChartOfAccountA', thirdAccountA);
    mutationBindings.set('financialPositiveDebitChartOfAccountB', debitAccountB);
    mutationBindings.set('financialPositiveCreditChartOfAccountB', creditAccountB);
    mutationBindings.set('financialPositiveAuditSecondLine', auditSecondLine);
    mutationBindings.set('financialPositiveBankMatchReconciliation', bankMatchReconciliation);
    mutationBindings.set('financialPositiveBankMatchStatementLine', bankMatchStatementLine);
    mutationBindings.set('financialPositiveBankMatchJournalLine', bankMatchJournalLine);
    mutationBindings.set(
      'financialPositiveBankAdjustmentReconciliation',
      bankAdjustmentReconciliation,
    );
    // This match is deliberately parked on another reconciliation at baseline.
    // The unmatch fixture's snapshotted pre-state moves it onto the target, while
    // manual/automatic matching retain a genuinely unmatched source line.
    mutationBindings.set('financialPositiveBankExistingMatch', parkedMatch);
    mutationBindings.set('financialPositiveCustomerPaymentCreate', customerPaymentCreateControl);
    mutationBindings.set('financialPositiveCustomerPaymentReverse', customerPaymentReverseControl);
    mutationBindings.set('financialPositiveScheduleLoan', {
      ...scheduleLoan,
      expectedScheduleNumber: `LRS-${scheduleLoan.id.slice(-6)}-001`,
    });
    mutationBindings.set('financialPositiveEmptyGrn', emptyGrn);
    mutationBindings.set('financialPositiveThreeWayPurchaseOrder', threeWayPurchaseOrder);
    mutationBindings.set('financialPositiveThreeWaySupplierInvoice', threeWaySupplierInvoice);
    mutationBindings.set('financialPositiveThreeWaySupplierId', supplier);
    mutationBindings.set('financialPositiveThreeWayMatchSequence', threeWayMatchSequence);

    const missingBindings = CRUD_FINANCIAL_ACTION_POSITIVE_REQUIRED_BINDINGS.filter(
      (bindingName) => !mutationBindings.has(bindingName),
    );
    if (missingBindings.length > 0) {
      throw new Error(`CRUD finance controls missed bindings: ${missingBindings.join(', ')}`);
    }
  }

  // Derived/admin report seeds use explicit ledger ids, but their persistent
  // cash_on_hand subtype would compete with the account selected by each
  // finance fixture pre-state. Keep semantic roles unassigned at baseline so
  // AccountResolver has exactly one eligible row during every action.
  async function isolateFinancialAccountResolverRoles(): Promise<void> {
    const competingCashAccounts = await prisma.chartOfAccount.findMany({
      where: {
        companyId: { in: [companyAId, companyBId] },
        accountSubType: { equals: 'cash_on_hand', mode: 'insensitive' },
      },
      select: { id: true },
    });
    if (competingCashAccounts.length > 0) {
      await prisma.chartOfAccount.updateMany({
        where: { id: { in: competingCashAccounts.map((account) => account.id) } },
        data: { accountSubType: null },
      });
    }
    const remaining = await prisma.chartOfAccount.count({
      where: {
        companyId: { in: [companyAId, companyBId] },
        accountSubType: { equals: 'cash_on_hand', mode: 'insensitive' },
      },
    });
    if (remaining !== 0) {
      throw new Error(
        'CRUD finance controls require semantic account roles to be assigned only by fixture pre-state.',
      );
    }
  }

  async function seedActionClosureControls(): Promise<void> {
    const employee = seededModels.get('Employee');
    if (!employee) throw new Error('Action-closure controls require the canonical Employee seed.');
    const normalizedEmployee = await prisma.employee.update({
      where: { id: stringField(employee, 'id') },
      data: {
        companyId: companyAId,
        divisionId: null,
      },
    });
    rememberSeededModel('Employee', normalizedEmployee);

    const stockAdjustment = await prisma.stockAdjustment.create({
      data: {
        adjustmentNumber: `CE-ACTION-CLOSURE-SA-${suffix}`,
        companyId: companyAId,
        divisionId: divisionAId,
        branchId: branchAId,
        reason: 'Isolated zero-line action-closure posting control',
        status: 'APPROVED',
        createdById: creatorUserId,
        approvedById: posterUserId,
        approvedAt: new Date('2031-01-01T00:00:00.000Z'),
      },
      include: { lines: true },
    });
    if (stockAdjustment.lines.length !== 0) {
      throw new Error('Action-closure stock adjustment must contain exactly zero lines.');
    }

    const fixedAsset = await prisma.fixedAsset.create({
      data: {
        ownershipLevel: 'COMPANY',
        companyId: companyAId,
        groupId: null,
        divisionId: divisionAId,
        branchId: branchAId,
        assetCode: `CE-ACTION-CLOSURE-ASSET-${suffix}`,
        name: `CRUD action-closure depreciation asset ${suffix}`,
        category: 'EQUIPMENT',
        acquisitionDate: new Date('2031-01-01T00:00:00.000Z'),
        acquisitionCost: new Prisma.Decimal(1000),
        currentBookValue: new Prisma.Decimal(1000),
        residualValue: new Prisma.Decimal(0),
        usefulLifeYears: 1,
        status: 'ACTIVE',
        createdById: creatorUserId,
      },
    });
    const depreciationSchedule = await prisma.depreciationSchedule.create({
      data: {
        scheduleNumber: `CE-ACTION-CLOSURE-DEP-${suffix}`,
        companyId: companyAId,
        fixedAssetId: fixedAsset.id,
        depreciationMethod: 'STRAIGHT_LINE',
        startDate: new Date('2031-02-01T00:00:00.000Z'),
        endDate: null,
        usefulLifeMonths: 10,
        salvageValue: new Prisma.Decimal(0),
        depreciationRate: null,
        totalDepreciableAmount: new Prisma.Decimal(1000),
        accumulatedDepreciation: new Prisma.Decimal(0),
        status: 'ACTIVE',
        createdById: creatorUserId,
      },
      include: { entries: true },
    });
    if (depreciationSchedule.entries.length !== 0) {
      throw new Error('Action-closure depreciation schedule must start with zero entries.');
    }

    mutationBindings.set('actionClosureStockAdjustment', stockAdjustment);
    mutationBindings.set('actionClosureDepreciationSchedule', depreciationSchedule);
  }

  /**
   * Dedicated, non-overlapping anchors for the administrative/operations
   * positive tranche.  These records are created after every generic seed so
   * the three zero-row controls cannot be populated later by another fixture.
   */
  async function seedAdminOperationsPositiveControls(): Promise<void> {
    const [companyA, actor, accountingPeriod, category] = await Promise.all([
      prisma.company.findUniqueOrThrow({ where: { id: companyAId } }),
      prisma.user.findUniqueOrThrow({ where: { id: groupReaderUserId } }),
      prisma.accountingPeriod.findUniqueOrThrow({ where: { id: accountingPeriodId } }),
      prisma.productCategory.findFirstOrThrow({
        where: { companyId: companyAId, deletedAt: null },
        orderBy: { id: 'asc' },
      }),
    ]);

    const adminCompany = await prisma.company.create({
      data: {
        groupId: companyA.groupId,
        code: `CEADMIN${suffix}`,
        name: `CRUD Admin Operations ${suffix}`,
      },
    });
    await prisma.userCompanyAccess.create({
      data: {
        userId: groupReaderUserId,
        companyId: adminCompany.id,
        accessLevel: AccessLevel.MANAGE,
        grantedById: creatorUserId,
      },
    });

    const [adminDivision, adminUser, adminRole, adminApiClient, adminProduct] = await Promise.all([
      prisma.division.create({
        data: {
          companyId: companyAId,
          code: `CEADMINDIV${suffix}`,
          name: `CRUD branch-free division ${suffix}`,
          type: DivisionType.OTHER,
        },
      }),
      prisma.user.create({
        data: {
          email: `crud-admin-target-${suffix}@itemba.invalid`,
          passwordHash: actor.passwordHash,
          fullName: `CRUD Admin Target ${suffix}`,
          companyId: companyAId,
        },
      }),
      prisma.role.create({
        data: {
          name: `CRUD_ADMIN_TARGET_ROLE_${suffix}`,
          displayName: `CRUD admin target role ${suffix}`,
          description: 'Isolated role for exact UserRole mutation evidence',
          scope: RoleScope.COMPANY,
          isSystem: false,
        },
      }),
      prisma.apiClient.create({
        data: {
          clientCode: `CE-ADMIN-CLIENT-${suffix}`,
          companyId: adminCompany.id,
          name: `CRUD admin API client ${suffix}`,
          allowedScopes: ['customers.read'],
          createdById: groupReaderUserId,
        },
      }),
      prisma.product.create({
        data: {
          productCode: `CE-ADMIN-PRODUCT-${suffix}`,
          companyId: companyAId,
          categoryId: category.id,
          name: `CRUD admin service product ${suffix}`,
          productType: ProductType.SERVICE,
          baseUnitId: unitAId,
          trackInventory: false,
          status: ProductStatus.ACTIVE,
          imageUrl: null,
        },
      }),
    ]);

    const [fixedAssetAccounts, cashAccounts] = await Promise.all([
      prisma.chartOfAccount.findMany({
        where: {
          companyId: companyAId,
          deletedAt: null,
          isActive: true,
          accountSubType: { equals: 'fixed_asset', mode: 'insensitive' },
        },
      }),
      prisma.chartOfAccount.findMany({
        where: {
          companyId: companyAId,
          deletedAt: null,
          isActive: true,
          accountSubType: { equals: 'cash_on_hand', mode: 'insensitive' },
        },
      }),
    ]);
    if (fixedAssetAccounts.length > 1 || cashAccounts.length > 1) {
      throw new Error(
        'Admin-operations capitalization evidence requires one deterministic account per semantic role.',
      );
    }
    const fixedAssetAccount =
      fixedAssetAccounts[0] ??
      (await prisma.chartOfAccount.create({
        data: {
          companyId: companyAId,
          accountCode: `15${suffix}`,
          accountName: `CRUD fixed asset control ${suffix}`,
          accountType: AccountType.ASSET,
          accountSubType: 'fixed_asset',
        },
      }));
    const cashLedgerAccount =
      cashAccounts[0] ??
      (await prisma.chartOfAccount.create({
        data: {
          companyId: companyAId,
          accountCode: `10${suffix}`,
          accountName: `CRUD cash control ${suffix}`,
          accountType: AccountType.ASSET,
          accountSubType: 'cash_on_hand',
        },
      }));
    if (fixedAssetAccount.id === cashLedgerAccount.id) {
      throw new Error(
        'Capitalization debit and credit roles must resolve to distinct ledger accounts.',
      );
    }

    const [mobileEmployee, mobileCustomer, mobileCashAccount, reportDefinition] = await Promise.all(
      [
        prisma.employee.create({
          data: {
            employeeCode: `CEADMINEMP${suffix}`,
            companyId: companyAId,
            divisionId: divisionAId,
            branchId: branchAId,
            userId: adminUser.id,
            firstName: 'CRUD',
            lastName: `Admin ${suffix}`,
            fullName: `CRUD Admin Employee ${suffix}`,
            employmentStatus: 'ACTIVE',
          },
        }),
        prisma.customer.create({
          data: {
            customerCode: `CE-ADMIN-CUSTOMER-${suffix}`,
            companyId: companyAId,
            divisionId: divisionAId,
            branchId: branchAId,
            customerType: CustomerType.INDIVIDUAL,
            name: `CRUD admin counter customer ${suffix}`,
            currentBalance: 0,
            status: 'ACTIVE',
            createdById: creatorUserId,
          },
        }),
        prisma.cashAccount.create({
          data: {
            companyId: companyAId,
            divisionId: divisionAId,
            branchId: branchAId,
            accountName: `CRUD admin till ${suffix}`,
            accountType: CashAccountType.CASH_ON_HAND,
            isActive: true,
          },
        }),
        prisma.reportDefinition.create({
          data: {
            reportCode: `CE-ADMIN-REPORT-${suffix}`,
            name: `CRUD admin receivables report ${suffix}`,
            datasetKey: 'receivables_aging',
            createdById: groupReaderUserId,
          },
        }),
      ],
    );

    const adminSchedule = await prisma.scheduledReport.create({
      data: {
        scheduleCode: 'CE-ADMIN-SCHEDULE',
        reportDefinitionId: reportDefinition.id,
        companyId: adminCompany.id,
        name: `CRUD admin schedule ${suffix}`,
        scheduleConfig: { source: 'crud-admin-operations' },
        recipients: [],
        exportFormat: 'CSV',
        isActive: false,
        lastRunAt: null,
        nextRunAt: null,
        createdById: groupReaderUserId,
      },
    });

    mutationBindings.set('adminOperationsActor', actor);
    mutationBindings.set('adminOperationsAccountingPeriod', accountingPeriod);
    mutationBindings.set('adminOperationsApiClient', adminApiClient);
    mutationBindings.set('adminOperationsBranchA', { id: branchAId });
    mutationBindings.set('adminOperationsCashLedgerAccount', cashLedgerAccount);
    mutationBindings.set('adminOperationsCompany', adminCompany);
    mutationBindings.set(
      'adminOperationsCreatedUserEmail',
      `crud-admin-created-${suffix}@itemba.invalid`,
    );
    mutationBindings.set('adminOperationsDivision', adminDivision);
    mutationBindings.set('adminOperationsDivisionA', { id: divisionAId });
    mutationBindings.set('adminOperationsFixedAssetAccount', fixedAssetAccount);
    mutationBindings.set('adminOperationsMobileCashAccount', mobileCashAccount);
    mutationBindings.set('adminOperationsMobileCustomer', mobileCustomer);
    mutationBindings.set('adminOperationsMobileEmployee', mobileEmployee);
    mutationBindings.set('adminOperationsProduct', adminProduct);
    mutationBindings.set('adminOperationsRole', adminRole);
    mutationBindings.set('adminOperationsSchedule', adminSchedule);
    mutationBindings.set('adminOperationsUser', adminUser);
  }

  async function seedMutationGapDeleteControls(): Promise<void> {
    const workflow = await seedModelRecord('ApprovalWorkflow');
    const lastStep = await prisma.approvalStep.aggregate({
      where: { workflowId: stringField(workflow, 'id') },
      _max: { stepOrder: true },
    });
    const [approvalStep, permission, role, employee, refundCreditNote] = await Promise.all([
      prisma.approvalStep.create({
        data: {
          workflowId: stringField(workflow, 'id'),
          stepOrder: (lastStep._max.stepOrder ?? 0) + 100,
          stepName: `CRUD gap isolated approval step ${suffix}`,
        },
      }),
      prisma.permission.create({
        data: {
          code: `crud_gap_permission_${suffix}`,
          description: `CRUD gap isolated permission ${suffix}`,
          module: 'crud_gap_evidence',
          action: 'delete',
          isGroupControl: false,
        },
      }),
      prisma.role.create({
        data: {
          name: `CRUD_GAP_ROLE_${suffix}`,
          displayName: `CRUD gap isolated role ${suffix}`,
          description: `CRUD gap isolated role ${suffix}`,
          scope: RoleScope.COMPANY,
          isSystem: false,
        },
      }),
      prisma.employee.create({
        data: {
          employeeCode: `CEGAP${suffix}`,
          companyId: companyAId,
          firstName: 'CRUD',
          lastName: `Gap ${suffix}`,
          fullName: `CRUD Gap Employee ${suffix}`,
          employmentStatus: 'ACTIVE',
        },
      }),
      prisma.creditNote.create({
        data: {
          creditNoteNumber: `CE-GAP-CN-${suffix}`,
          companyId: companyAId,
          divisionId: divisionAId,
          branchId: branchAId,
          customerName: `CRUD gap refund customer ${suffix}`,
          subtotal: 100,
          totalAmount: 100,
          appliedAmount: 0,
          issueDate: new Date('2031-06-01T00:00:00.000Z'),
          status: 'ISSUED',
          createdById: creatorUserId,
        },
      }),
    ]);
    mutationBindings.set('mutationGapApprovalStep', approvalStep);
    mutationBindings.set('mutationGapPermission', permission);
    mutationBindings.set('mutationGapRole', role);
    mutationBindings.set('mutationGapEmployee', employee);
    mutationBindings.set('mutationGapRefundCreditNote', refundCreditNote);
  }

  async function seedMutationGapMembershipControl(): Promise<void> {
    const [segment, customer] = await Promise.all([
      prisma.customerSegment.create({
        data: {
          segmentCode: `CEGAPSEG${suffix}`,
          companyId: companyAId,
          name: `CRUD gap isolated segment ${suffix}`,
        },
      }),
      prisma.customer.create({
        data: {
          customerCode: `CE-GAP-CUSTOMER-${suffix}`,
          companyId: companyAId,
          divisionId: divisionAId,
          branchId: branchAId,
          name: `CRUD gap isolated customer ${suffix}`,
          currentBalance: 0,
          createdById: creatorUserId,
        },
      }),
    ]);
    const membership = await prisma.customerSegmentMembership.create({
      data: {
        customerSegmentId: segment.id,
        customerId: customer.id,
        assignedById: creatorUserId,
        notes: `CRUD gap isolated membership ${suffix}`,
      },
    });
    rememberSeededModel('CustomerSegmentMembership', membership);
  }

  function rememberSeededModel(modelName: string, value: unknown) {
    if (!isRecord(value)) throw new Error(`CRUD seed ${modelName} is not a record.`);
    seededModels.set(modelName, value);
    const id = stringField(value, 'id');
    if (id) pathReadValues.set(`model:${modelName}`, id);
  }

  async function seedAutonomyReleaseControls(): Promise<void> {
    const inventoryAccount = await prisma.chartOfAccount.create({
      data: {
        companyId: companyAId,
        accountCode: `CEAUTOINV${suffix}`,
        accountName: `CRUD Autonomy Inventory ${suffix}`,
        accountType: AccountType.ASSET,
        accountSubType: 'inventory_asset',
      },
    });
    mutationBindings.set('autonomyInventoryChartOfAccountA', inventoryAccount);

    // Payroll calculation always inserts a fresh entry for every active
    // employee. Keep this action fixture off the shared DMMF seed graph: its
    // generic PayrollEntry has the same compound (run, employee) identity and
    // a soft delete cannot release Prisma's unique constraint.
    const employee = await prisma.employee.create({
      data: {
        employeeCode: `CEPRCALC${suffix}`,
        companyId: companyBId,
        firstName: 'CRUD',
        lastName: `Payroll Calculate ${suffix}`,
        fullName: `CRUD Payroll Calculate Employee ${suffix}`,
        employmentStatus: 'ACTIVE',
        baseSalary: 0,
        payrollRegion: 'MAINLAND',
        taxResidencyStatus: 'RESIDENT',
        disabilityStatus: 'NONE',
        heslbBorrower: false,
      },
    });
    const period = await prisma.payrollPeriod.create({
      data: {
        payrollPeriodCode: `CEPRCALCP${suffix}`,
        companyId: companyBId,
        name: `CRUD Payroll Calculate Period ${suffix}`,
        startDate: new Date('2026-08-01T00:00:00.000Z'),
        endDate: new Date('2026-08-31T00:00:00.000Z'),
        paymentDate: new Date('2026-08-25T12:00:00.000Z'),
        status: 'OPEN',
        createdById: creatorUserId,
      },
    });
    const run = await prisma.payrollRun.create({
      data: {
        payrollRunNumber: `CEPRCALCR${suffix}`,
        companyId: companyBId,
        payrollPeriodId: period.id,
        runDate: new Date('2026-08-25T12:00:00.000Z'),
        payrollType: 'REGULAR',
        status: 'DRAFT',
        totalGrossPay: 100,
        totalAllowances: 0,
        totalDeductions: 100,
        totalNetPay: 50,
        createdById: creatorUserId,
      },
    });

    mutationBindings.set('autonomyPayrollCalculateEmployee', employee);
    mutationBindings.set('autonomyPayrollCalculatePeriod', period);
    mutationBindings.set('autonomyPayrollCalculateRun', run);
  }

  async function bindAutonomyPayrollExclusions(): Promise<void> {
    const target = mutationBindings.get('autonomyPayrollCalculateEmployee');
    const run = mutationBindings.get('autonomyPayrollCalculateRun');
    if (!isRecord(target) || !isRecord(run)) {
      throw new Error('Autonomy payroll census requires its dedicated employee and run seeds.');
    }
    const targetId = requiredEvidenceString(target.id, 'autonomy payroll target employee id');
    const runId = requiredEvidenceString(run.id, 'autonomy payroll run id');
    const companyId = requiredEvidenceString(run.companyId, 'autonomy payroll run company id');
    if (companyId !== companyBId) {
      throw new Error('Autonomy payroll run must remain in the isolated company-B scope.');
    }

    // Mirror PayrollRunsService.calculate exactly. This census runs after every
    // read/report seed, including the Westsides company-B salesperson that was
    // previously invisible to the fixture's single hard-coded exclusion.
    const activeEmployees = await prisma.employee.findMany({
      where: { companyId, employmentStatus: 'ACTIVE', deletedAt: null },
      select: { id: true, employeeCode: true },
      orderBy: { id: 'asc' },
    });
    const targetMatches = activeEmployees.filter((employee) => employee.id === targetId);
    const excluded = activeEmployees.filter((employee) => employee.id !== targetId);
    if (targetMatches.length !== 1 || excluded.length !== 2) {
      throw new Error(
        `Autonomy payroll requires one target and exactly two declared active exclusions; ` +
          `observed ${
            activeEmployees
              .map((employee) => `${employee.id}:${employee.employeeCode ?? ''}`)
              .join(', ') || 'none'
          }.`,
      );
    }

    const existingEntries = await prisma.payrollEntry.findMany({
      where: { payrollRunId: runId },
      select: { id: true, employeeId: true, deletedAt: true },
      orderBy: { id: 'asc' },
    });
    if (existingEntries.length !== 0) {
      throw new Error(
        `Autonomy payroll run must begin with an empty entry scope; observed ${existingEntries
          .map(
            (entry) =>
              `${entry.id}:${entry.employeeId}:${entry.deletedAt?.toISOString() ?? 'live'}`,
          )
          .join(', ')}.`,
      );
    }

    mutationBindings.set('autonomyPayrollExcludedEmployeeOne', excluded[0]);
    mutationBindings.set('autonomyPayrollExcludedEmployeeTwo', excluded[1]);
  }

  function mutationSeedModelNames(): string[] {
    const models = new Set<string>();
    const collectValue = (value: CrudMutationValue) => {
      if ('binding' in value && value.binding.startsWith('model:')) {
        models.add(value.binding.slice('model:'.length));
      } else if ('array' in value) {
        value.array.forEach(collectValue);
      } else if ('object' in value) {
        Object.values(value.object).forEach(collectValue);
      }
    };
    const collectEffectValue = (value: CrudMutationEffectValue) => {
      if (!('response' in value) && !('effectRef' in value)) collectValue(value);
    };
    const collectGeneratedField = (field: CrudMutationGeneratedField) => {
      if (
        field.kind === 'exact' ||
        field.kind === 'value-with-prefix' ||
        field.kind === 'value-with-action-iso-suffix'
      ) {
        collectValue(field.value);
      } else if (field.kind === 'tax-auto-apply-number') {
        collectValue(field.sourceId);
        collectValue(field.sourceLineId);
      } else if (
        field.kind === 'local-day-start' ||
        field.kind === 'local-day-end' ||
        field.kind === 'utc-day-start' ||
        field.kind === 'utc-day-end'
      ) {
        collectValue(field.value);
      } else if (field.kind === 'entity-code') {
        if (field.companyId) collectValue(field.companyId);
      } else if (field.kind === 'scoped-sequence-id') {
        Object.values(field.scope).forEach(collectValue);
        for (const part of field.prefixParts) {
          if (part.kind === 'company-code' || part.kind === 'company-id-fragment') {
            collectValue(part.companyId);
          }
        }
      }
    };
    const collectNamedEffect = (effect: CrudMutationCompoundNamedEffect) => {
      models.add(effect.model);
      if (effect.kind === 'row-create') {
        collectEffectValue(effect.id);
        Object.values(effect.expectedFields).forEach(collectEffectValue);
      } else if (effect.kind === 'scoped-row-create') {
        Object.values(effect.scope.equals).forEach(collectValue);
        Object.values(effect.expectedFields).forEach(collectEffectValue);
        Object.values(effect.generatedFields).forEach(collectGeneratedField);
      } else if (effect.kind === 'row-update' || effect.kind === 'row-delete') {
        collectValue(effect.id);
        Object.values(effect.expectedFields).forEach(collectEffectValue);
      } else {
        Object.values(effect.scope.equals).forEach(collectValue);
        if (effect.kind === 'set-delta') {
          [...effect.expectedAdded, ...effect.expectedRemoved].forEach((identity) =>
            Object.values(identity).forEach(collectEffectValue),
          );
        }
      }
    };

    for (const fixture of mutationEvidencePacksForManifest(manifest.capabilities()).flatMap(
      (pack) => pack.fixtures,
    )) {
      fixture.setupModels?.forEach((model) => models.add(model));
      if (fixture.target) {
        models.add(fixture.target.model);
        collectValue(fixture.target.id);
      }
      for (const preState of mutationPreStates(fixture)) {
        models.add(preState.model);
        collectValue(preState.id);
        Object.values(preState.fields).forEach(collectValue);
      }
      if (fixture.audit.entityId) collectValue(fixture.audit.entityId);
      if (fixture.audit.companyId.kind === 'exact') {
        collectValue(fixture.audit.companyId.value);
      }
      for (const audit of fixture.audit.additionalAudits ?? []) {
        collectEffectValue(audit.entityId);
        if (audit.companyId.kind === 'exact') collectValue(audit.companyId.value);
      }
      if (fixture.effect.kind === 'compound') {
        fixture.effect.effects.forEach(collectNamedEffect);
        for (const exception of fixture.effect.allowedTableExceptions ?? []) {
          collectNamedEffect(exception.effect);
        }
        collectEffectValue(fixture.effect.auditEntityId);
      } else if (fixture.effect.kind === 'create') {
        Object.values(fixture.effect.expectedFields).forEach(collectValue);
        Object.values(fixture.effect.generatedFields).forEach(collectGeneratedField);
      } else if (fixture.effect.kind === 'audit-only') {
        collectValue(fixture.effect.auditEntityId);
      } else {
        models.add(fixture.effect.model);
        collectValue(fixture.effect.id);
        if (
          fixture.effect.kind === 'update' ||
          fixture.effect.kind === 'transition' ||
          fixture.effect.kind === 'generated-transition'
        ) {
          Object.values(fixture.effect.expectedFields).forEach(collectValue);
        }
        if (fixture.effect.kind === 'generated-transition') {
          Object.values(fixture.effect.generatedFields).forEach(collectGeneratedField);
        }
      }
      for (const values of [fixture.request.path, fixture.request.query, fixture.request.body]) {
        Object.values(values ?? {}).forEach(collectValue);
      }
    }
    return [...models].sort();
  }

  async function seedModelRecord(modelName: string): Promise<Record<string, unknown>> {
    const existing = seededModels.get(modelName);
    if (existing) return existing;
    if (seedingModels.has(modelName)) {
      throw new Error(`Recursive CRUD path-read seed dependency at ${modelName}.`);
    }

    const model = Prisma.dmmf.datamodel.models.find((candidate) => candidate.name === modelName);
    if (!model) throw new Error(`Prisma model ${modelName} is absent from the generated DMMF.`);
    seedingModels.add(modelName);
    try {
      const data: Record<string, unknown> = {};

      for (const relation of model.fields.filter(
        (field) =>
          field.kind === 'object' &&
          field.isRequired &&
          Array.isArray(field.relationFromFields) &&
          field.relationFromFields.length > 0,
      )) {
        const target = await requiredRelationSeed(modelName, relation.name, relation.type);
        const targetFields = relation.relationToFields?.length ? relation.relationToFields : ['id'];
        relation.relationFromFields!.forEach((fromField, index) => {
          const targetField = targetFields[index] ?? 'id';
          const value = target[targetField];
          if (value === undefined) {
            throw new Error(
              `Seed ${modelName}.${relation.name} cannot read ${relation.type}.${targetField}.`,
            );
          }
          data[fromField] = value;
        });
      }

      await applyKnownSeedScalars(
        modelName,
        model.fields.map((field) => field.name),
        data,
      );

      const relationScalars = new Set(
        model.fields
          .filter((field) => field.kind === 'object' && field.relationFromFields?.length)
          .flatMap((field) => field.relationFromFields ?? []),
      );
      for (const field of model.fields) {
        if (
          field.kind === 'object' ||
          field.isId ||
          field.isUpdatedAt ||
          field.hasDefaultValue ||
          !field.isRequired ||
          relationScalars.has(field.name) ||
          data[field.name] !== undefined
        ) {
          continue;
        }
        data[field.name] = requiredSeedScalar(modelName, field.name, field.kind, field.type);
      }

      const delegateName = `${modelName.charAt(0).toLowerCase()}${modelName.slice(1)}`;
      type CreateDelegate = {
        create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
      };
      const delegate = (prisma as unknown as Record<string, CreateDelegate>)[delegateName];
      if (!delegate?.create) throw new Error(`Prisma delegate ${delegateName}.create is absent.`);
      const record = await delegate.create({ data });
      rememberSeededModel(modelName, record);
      return record;
    } finally {
      seedingModels.delete(modelName);
    }
  }

  async function seedMetadataReadDedicatedControl(
    fixture: CrudMetadataReadFixtureRegistration,
  ): Promise<MetadataReadDedicatedSeedRecords> {
    const control = fixture.observable.causalRecordControl;
    if (!control) {
      throw new Error(`${fixture.capabilityId} has no signed fixture-private seed control.`);
    }
    if (control.seedScenario === 'receipt-account-company-pair-v1') {
      if (
        fixture.observable.seedModel !== 'CashAccount' ||
        fixture.capabilityId !== 'SalesOrdersController.findReceiptAccounts'
      ) {
        throw new Error(`${fixture.capabilityId} cannot use the receipt-account seed scenario.`);
      }
      const [createdA, createdB] = await prisma.$transaction([
        prisma.cashAccount.create({
          data: {
            companyId: companyAId,
            divisionId: divisionAId,
            branchId: branchAId,
            accountName: `CRUD Evidence Receipt Account A ${suffix}`,
            accountType: CashAccountType.CASH_ON_HAND,
            isActive: true,
          },
        }),
        prisma.cashAccount.create({
          data: {
            companyId: companyBId,
            divisionId: divisionBId,
            branchId: branchBId,
            accountName: `CRUD Evidence Receipt Account B ${suffix}`,
            accountType: CashAccountType.CASH_ON_HAND,
            isActive: true,
          },
        }),
      ]);
      const ids = [createdA.id, createdB.id];
      const dispose = async () => {
        const deleted = await prisma.cashAccount.deleteMany({ where: { id: { in: ids } } });
        if (deleted.count !== ids.length) {
          throw new Error(
            `Receipt-account control cleanup deleted ${deleted.count}/${ids.length} rows.`,
          );
        }
      };
      try {
        const persisted = await prisma.cashAccount.findMany({
          where: { id: { in: ids } },
          select: {
            id: true,
            companyId: true,
            divisionId: true,
            branchId: true,
            accountType: true,
            isActive: true,
            deletedAt: true,
          },
        });
        const present = persisted.find((record) => record.id === createdA.id);
        const absent = persisted.find((record) => record.id === createdB.id);
        if (
          !present ||
          present.companyId !== companyAId ||
          present.divisionId !== divisionAId ||
          present.branchId !== branchAId ||
          present.accountType !== CashAccountType.CASH_ON_HAND ||
          present.isActive !== true ||
          present.deletedAt !== null ||
          !absent ||
          absent.companyId !== companyBId ||
          absent.divisionId !== divisionBId ||
          absent.branchId !== branchBId ||
          absent.accountType !== CashAccountType.CASH_ON_HAND ||
          absent.isActive !== true ||
          absent.deletedAt !== null
        ) {
          throw new Error(
            `${fixture.capabilityId} persisted receipt-account A/B preconditions do not match the signed scenario.`,
          );
        }
        return {
          seedScenario: control.seedScenario,
          present: present as unknown as Record<string, unknown>,
          absent: absent as unknown as Record<string, unknown>,
          dispose,
        };
      } catch (error) {
        await dispose();
        throw error;
      }
    }

    if (
      control.seedScenario !== 'profit-cost-gap-product-company-pair-v1' ||
      fixture.observable.seedModel !== 'Product' ||
      fixture.capabilityId !== 'ProfitController.costGaps'
    ) {
      throw new Error(`${fixture.capabilityId} cannot use the profit cost-gap seed scenario.`);
    }
    const seeded = await prisma.$transaction(async (tx) => {
      const [categoryA, categoryB, unitA, unitB] = await Promise.all([
        tx.productCategory.create({
          data: {
            companyId: companyAId,
            name: `CRUD Evidence Cost Gap Category A ${suffix}`,
          },
        }),
        tx.productCategory.create({
          data: {
            companyId: companyBId,
            name: `CRUD Evidence Cost Gap Category B ${suffix}`,
          },
        }),
        tx.unitOfMeasure.create({
          data: {
            companyId: companyAId,
            name: `CRUD Evidence Cost Gap Unit A ${suffix}`,
            symbol: `CGA${suffix.slice(-4)}`,
          },
        }),
        tx.unitOfMeasure.create({
          data: {
            companyId: companyBId,
            name: `CRUD Evidence Cost Gap Unit B ${suffix}`,
            symbol: `CGB${suffix.slice(-4)}`,
          },
        }),
      ]);
      const [productA, productB] = await Promise.all([
        tx.product.create({
          data: {
            productCode: `CECGAPA${suffix}`,
            companyId: companyAId,
            divisionId: null,
            categoryId: categoryA.id,
            productFamilyId: null,
            name: `CRUD Evidence Cost Gap Product A ${suffix}`,
            productType: ProductType.STOCK_ITEM,
            baseUnitId: unitA.id,
            defaultPurchasePrice: 0,
            defaultSellingPrice: 1,
            trackInventory: true,
            status: ProductStatus.ACTIVE,
          },
        }),
        tx.product.create({
          data: {
            productCode: `CECGAPB${suffix}`,
            companyId: companyBId,
            divisionId: null,
            categoryId: categoryB.id,
            productFamilyId: null,
            name: `CRUD Evidence Cost Gap Product B ${suffix}`,
            productType: ProductType.STOCK_ITEM,
            baseUnitId: unitB.id,
            defaultPurchasePrice: 0,
            defaultSellingPrice: 1,
            trackInventory: true,
            status: ProductStatus.ACTIVE,
          },
        }),
      ]);
      return { categoryA, categoryB, unitA, unitB, productA, productB };
    });
    const productIds = [seeded.productA.id, seeded.productB.id];
    const categoryIds = [seeded.categoryA.id, seeded.categoryB.id];
    const unitIds = [seeded.unitA.id, seeded.unitB.id];
    const dispose = async () => {
      const [products, categories, units] = await prisma.$transaction(async (tx) => {
        const products = await tx.product.deleteMany({ where: { id: { in: productIds } } });
        const categories = await tx.productCategory.deleteMany({
          where: { id: { in: categoryIds } },
        });
        const units = await tx.unitOfMeasure.deleteMany({ where: { id: { in: unitIds } } });
        return [products.count, categories.count, units.count] as const;
      });
      if (products !== 2 || categories !== 2 || units !== 2) {
        throw new Error(
          `Cost-gap control cleanup deleted products=${products}/2 categories=${categories}/2 units=${units}/2.`,
        );
      }
    };
    try {
      const [products, categories, units] = await Promise.all([
        prisma.product.findMany({
          where: { id: { in: productIds } },
          select: {
            id: true,
            companyId: true,
            divisionId: true,
            categoryId: true,
            productFamilyId: true,
            baseUnitId: true,
            defaultPurchasePrice: true,
            productType: true,
            trackInventory: true,
            status: true,
            deletedAt: true,
          },
        }),
        prisma.productCategory.findMany({
          where: { id: { in: categoryIds } },
          select: { id: true, companyId: true, deletedAt: true },
        }),
        prisma.unitOfMeasure.findMany({
          where: { id: { in: unitIds } },
          select: { id: true, companyId: true, status: true, deletedAt: true },
        }),
      ]);
      const present = products.find((record) => record.id === seeded.productA.id);
      const absent = products.find((record) => record.id === seeded.productB.id);
      const categoryA = categories.find((record) => record.id === seeded.categoryA.id);
      const categoryB = categories.find((record) => record.id === seeded.categoryB.id);
      const unitA = units.find((record) => record.id === seeded.unitA.id);
      const unitB = units.find((record) => record.id === seeded.unitB.id);
      const exactProductPreconditions = (
        record: typeof present,
        companyId: string,
        categoryId: string,
        unitId: string,
      ) => {
        if (!record) return false;
        return (
          record.companyId === companyId &&
          record.divisionId === null &&
          record.categoryId === categoryId &&
          record.productFamilyId === null &&
          record.baseUnitId === unitId &&
          Number(record.defaultPurchasePrice) === 0 &&
          record.productType === ProductType.STOCK_ITEM &&
          record.trackInventory === true &&
          record.status === ProductStatus.ACTIVE &&
          record.deletedAt === null
        );
      };
      if (
        !exactProductPreconditions(present, companyAId, seeded.categoryA.id, seeded.unitA.id) ||
        !exactProductPreconditions(absent, companyBId, seeded.categoryB.id, seeded.unitB.id) ||
        !categoryA ||
        categoryA.companyId !== companyAId ||
        categoryA.deletedAt !== null ||
        !categoryB ||
        categoryB.companyId !== companyBId ||
        categoryB.deletedAt !== null ||
        !unitA ||
        unitA.companyId !== companyAId ||
        unitA.status !== 'ACTIVE' ||
        unitA.deletedAt !== null ||
        !unitB ||
        unitB.companyId !== companyBId ||
        unitB.status !== 'ACTIVE' ||
        unitB.deletedAt !== null
      ) {
        throw new Error(
          `${fixture.capabilityId} persisted product A/B cost-gap preconditions do not match the signed scenario.`,
        );
      }
      return {
        seedScenario: control.seedScenario,
        present: present as unknown as Record<string, unknown>,
        absent: absent as unknown as Record<string, unknown>,
        dispose,
      };
    } catch (error) {
      await dispose();
      throw error;
    }
  }

  async function seedMetadataActorNegativeControls(): Promise<void> {
    const controls = metadataReadEvidencePacks(manifest.capabilities())
      .flatMap((pack) => pack.fixtures)
      .filter((fixture) => fixture.governance.scope === 'actor')
      .map((fixture) => {
        const control = fixture.observable.negativeControl;
        if (!control || control.seedModel !== fixture.observable.seedModel) {
          throw new Error(`${fixture.capabilityId} lacks its signed actor-B seed control.`);
        }
        return control;
      });
    const uniqueControls = new Map(
      controls.map((control) => [`${control.seedModel}:${control.actorField}`, control]),
    );

    for (const control of uniqueControls.values()) {
      await seedModelRecord(control.seedModel);
      if (
        control.actorBinding !== 'userB' ||
        control.companyBinding !== 'companyA' ||
        !posterUserId ||
        !companyAId
      ) {
        throw new Error(`Unsupported metadata actor control for ${control.seedModel}.`);
      }
      if (control.seedModel === 'ApprovalRequest' && control.actorField === 'requestedById') {
        await prisma.approvalRequest.create({
          data: {
            approvalRequestNumber: `REQ-ACTOR-B-${suffix}`,
            companyId: companyAId,
            entityType: 'Customer',
            entityId: seededCustomerAId,
            requestedById: posterUserId,
            requestTitle: `CRUD evidence actor-B request ${suffix}`,
          },
        });
        continue;
      }
      if (control.seedModel === 'Notification' && control.actorField === 'recipientUserId') {
        await prisma.notification.create({
          data: {
            notificationNumber: `NTF-ACTOR-B-${suffix}`,
            companyId: companyAId,
            recipientUserId: posterUserId,
            title: `CRUD evidence actor-B notification ${suffix}`,
            message: 'This same-company negative control must remain invisible to actor A.',
          },
        });
        continue;
      }
      if (control.seedModel === 'SavedReportView' && control.actorField === 'userId') {
        const positive = seededModels.get('SavedReportView');
        if (!positive) {
          throw new Error('SavedReportView actor-B control requires the actor-A seed.');
        }
        await prisma.savedReportView.create({
          data: {
            reportDefinitionId: stringField(positive, 'reportDefinitionId'),
            userId: posterUserId,
            companyId: companyAId,
            name: `CRUD evidence actor-B saved view ${suffix}`,
            isShared: false,
          },
        });
        continue;
      }
      if (control.seedModel === 'Task' && control.actorField === 'assignedToId') {
        await prisma.task.create({
          data: {
            taskNumber: `TASK-ACTOR-B-${suffix}`,
            companyId: companyAId,
            title: `CRUD evidence actor-B task ${suffix}`,
            assignedToId: posterUserId,
            assignedById: creatorUserId,
          },
        });
        continue;
      }
      if (control.seedModel === 'UserDashboardPreference' && control.actorField === 'userId') {
        const positive = seededModels.get('UserDashboardPreference');
        if (!positive) {
          throw new Error('UserDashboardPreference actor-B control requires the actor-A seed.');
        }
        await prisma.userDashboardPreference.create({
          data: {
            dashboardDefinitionId: stringField(positive, 'dashboardDefinitionId'),
            userId: posterUserId,
          },
        });
        continue;
      }
      throw new Error(
        `No actor-B seed implementation for ${control.seedModel}.${control.actorField}.`,
      );
    }
  }

  async function seedDomainReadScopeControls(): Promise<void> {
    const controls = domainHeaderEvidencePacks(manifest.capabilities())
      .flatMap((pack) => pack.fixtures)
      .flatMap((fixture) => fixture.scopeOracle?.controls ?? []);
    const uniqueControls = new Map(controls.map((control) => [control.seedModel, control]));

    for (const control of [...uniqueControls.values()].sort((left, right) =>
      left.seedModel.localeCompare(right.seedModel),
    )) {
      if (!seededModels.has(control.seedModel)) {
        if (control.seedModel === 'ActorBCheckpoint') {
          const checkpointA = seededModels.get('SyncCheckpoint');
          if (!checkpointA) throw new Error('Actor-B checkpoint requires the actor-A checkpoint.');
          const checkpointB = await prisma.syncCheckpoint.create({
            data: {
              userId: posterUserId,
              deviceId: stringField(checkpointA, 'deviceId') || undefined,
              companyId: companyAId,
              entityType: stringField(checkpointA, 'entityType'),
              lastSyncAt: new Date('2099-01-02T00:00:00.000Z'),
              lastServerCursor: `actor-b-${suffix}`,
            },
          });
          rememberSeededModel(control.seedModel, checkpointB);
        } else if (
          control.seedModel === 'AuditSummaryCompanyA' ||
          control.seedModel === 'AuditSummaryCompanyB'
        ) {
          const isCompanyA = control.seedModel.endsWith('CompanyA');
          const companyId = isCompanyA ? companyAId : companyBId;
          const auditLog = await prisma.auditLog.create({
            data: {
              action: `CRUD_GLOBAL_SUMMARY_${isCompanyA ? 'A' : 'B'}_${suffix}`,
              entityType: 'CrudGlobalSummaryControl',
              entityId: companyId,
              companyId,
              severity: AuditSeverity.CRITICAL,
              scopeKind: AuditScopeKind.COMPANY,
              attributionStatus: AuditAttributionStatus.EXPLICIT,
              companyScopes: { create: { companyId } },
              channel: AuditChannel.WEB,
              createdAt: new Date(
                isCompanyA ? '2026-12-30T23:59:58.000Z' : '2026-12-30T23:59:59.000Z',
              ),
            },
          });
          rememberSeededModel(control.seedModel, auditLog);
        } else if (control.seedModel === 'EmployeeB') {
          const employeeB = await prisma.employee.create({
            data: {
              employeeCode: `CRUD-B-${suffix}`,
              companyId: companyBId,
              firstName: 'CRUD',
              lastName: `Company B ${suffix}`,
              fullName: `CRUD Evidence Company B Employee ${suffix}`,
              employmentStatus: 'ACTIVE',
            },
          });
          await prisma.mobileMoneyAccount.create({
            data: {
              employeeId: employeeB.id,
              provider: 'M_PESA',
              msisdn: '+255700000001',
              accountName: `CRUD Company B ${suffix}`,
              isPrimary: true,
            },
          });
          rememberSeededModel(control.seedModel, employeeB);
        } else if (control.seedModel === 'UpcomingLoanA' || control.seedModel === 'UpcomingLoanB') {
          const isCompanyA = control.seedModel.endsWith('LoanA');
          const loan = await prisma.loan.create({
            data: {
              companyId: isCompanyA ? companyAId : companyBId,
              borrowerLevel: 'COMPANY',
              loanReference: `CRUD-UPCOMING-${isCompanyA ? 'A' : 'B'}-${suffix}`,
              lenderName: `CRUD Evidence Lender ${isCompanyA ? 'A' : 'B'}`,
              principalAmount: new Prisma.Decimal(1_000),
              interestRate: new Prisma.Decimal('0.1'),
              disbursementDate: new Date('2026-01-01T00:00:00.000Z'),
              maturityDate: new Date('2099-01-01T00:00:00.000Z'),
              outstandingBalance: new Prisma.Decimal(1_000),
              status: 'ACTIVE',
            },
          });
          rememberSeededModel(control.seedModel, loan);
        } else {
          throw new Error(`No domain read-scope seed implementation for ${control.seedModel}.`);
        }
      }

      const record = seededModels.get(control.seedModel);
      const expectedId = domainHeaderBindingValue(control.binding);
      const expectedCompanyId = control.companyBinding === 'companyA' ? companyAId : companyBId;
      const expectedActorId = control.actorBinding
        ? control.actorBinding === 'userA'
          ? creatorUserId
          : posterUserId
        : undefined;
      if (
        !record ||
        stringField(record, 'id') !== expectedId ||
        stringField(record, 'companyId') !== expectedCompanyId ||
        (expectedActorId !== undefined && stringField(record, 'userId') !== expectedActorId)
      ) {
        throw new Error(
          `Domain scope control ${control.seedModel} does not match its signed identity/scope binding.`,
        );
      }
    }
  }

  async function seedDerivedReportReadControls(): Promise<void> {
    const scenarios = new Set(
      derivedReportReadEvidencePacks(manifest.capabilities())
        .flatMap((pack) => pack.fixtures)
        .map((fixture) => fixture.seedScenario),
    );
    if (scenarios.has('financial-company-pair-v1')) {
      await seedDerivedFinancialReportControls();
    }
    if (scenarios.has('operations-company-pair-v1')) {
      await seedDerivedOperationsReportControls();
    }
    if (scenarios.has('company-summary-pair-v1')) {
      await seedDerivedCompanySummaryControls();
    }
  }

  async function seedDerivedFinancialReportControls(): Promise<void> {
    const [cashLedgerA, incomeLedgerA, cashLedgerB, incomeLedgerB] = await Promise.all([
      prisma.chartOfAccount.create({
        data: {
          companyId: companyAId,
          accountCode: `1010-DRA-${suffix}`,
          accountName: `Derived cash ledger A ${suffix}`,
          accountType: AccountType.ASSET,
          accountSubType: 'cash_on_hand',
        },
      }),
      prisma.chartOfAccount.create({
        data: {
          companyId: companyAId,
          accountCode: `4100-DRA-${suffix}`,
          accountName: `Derived income ledger A ${suffix}`,
          accountType: AccountType.INCOME,
        },
      }),
      prisma.chartOfAccount.create({
        data: {
          companyId: companyBId,
          accountCode: `1010-DRB-${suffix}`,
          accountName: `Derived cash ledger B ${suffix}`,
          accountType: AccountType.ASSET,
          accountSubType: 'cash_on_hand',
        },
      }),
      prisma.chartOfAccount.create({
        data: {
          companyId: companyBId,
          accountCode: `4100-DRB-${suffix}`,
          accountName: `Derived income ledger B ${suffix}`,
          accountType: AccountType.INCOME,
        },
      }),
    ]);

    const createPostedJournal = (input: {
      companyId: string;
      divisionId: string;
      branchId: string;
      cashAccountId: string;
      incomeAccountId: string;
      journalNumber: string;
      amount: number;
      referenceType?: string;
    }) =>
      prisma.journalEntry.create({
        data: {
          companyId: input.companyId,
          divisionId: input.divisionId,
          branchId: input.branchId,
          journalNumber: input.journalNumber,
          transactionDate: new Date('2026-06-15T12:00:00.000Z'),
          description: `Derived report causal journal ${input.journalNumber}`,
          status: 'POSTED',
          totalDebit: input.amount,
          totalCredit: input.amount,
          createdById: groupReaderUserId,
          postedById: groupReaderUserId,
          postedAt: new Date('2026-06-15T12:00:01.000Z'),
          ...(input.referenceType ? { referenceType: input.referenceType } : {}),
          lines: {
            create: [
              {
                companyId: input.companyId,
                divisionId: input.divisionId,
                branchId: input.branchId,
                accountId: input.cashAccountId,
                debit: input.amount,
                credit: 0,
              },
              {
                companyId: input.companyId,
                divisionId: input.divisionId,
                branchId: input.branchId,
                accountId: input.incomeAccountId,
                debit: 0,
                credit: input.amount,
              },
            ],
          },
        },
      });

    const [journalA, journalB, intercompanyJournalA, intercompanyJournalB] = await Promise.all([
      createPostedJournal({
        companyId: companyAId,
        divisionId: divisionAId,
        branchId: branchAId,
        cashAccountId: cashLedgerA.id,
        incomeAccountId: incomeLedgerA.id,
        journalNumber: `DR-FIN-A-${suffix}`,
        amount: 1_111.11,
      }),
      createPostedJournal({
        companyId: companyBId,
        divisionId: divisionBId,
        branchId: branchBId,
        cashAccountId: cashLedgerB.id,
        incomeAccountId: incomeLedgerB.id,
        journalNumber: `DR-FIN-B-${suffix}`,
        amount: 2_222.22,
      }),
      createPostedJournal({
        companyId: companyAId,
        divisionId: divisionAId,
        branchId: branchAId,
        cashAccountId: cashLedgerA.id,
        incomeAccountId: incomeLedgerA.id,
        journalNumber: `DR-IC-A-${suffix}`,
        amount: 333.33,
        referenceType: 'InterCompanyTransaction',
      }),
      createPostedJournal({
        companyId: companyBId,
        divisionId: divisionBId,
        branchId: branchBId,
        cashAccountId: cashLedgerB.id,
        incomeAccountId: incomeLedgerB.id,
        journalNumber: `DR-IC-B-${suffix}`,
        amount: 333.33,
        referenceType: 'InterCompanyTransaction',
      }),
    ]);

    const [cashAccountA, cashAccountB, receivableA, receivableB, payableA, payableB] =
      await Promise.all([
        prisma.cashAccount.create({
          data: {
            companyId: companyAId,
            divisionId: divisionAId,
            branchId: branchAId,
            accountName: `Derived cash position A ${suffix}`,
            openingBalance: 70_001.01,
            currentBalance: 70_001.01,
          },
        }),
        prisma.cashAccount.create({
          data: {
            companyId: companyBId,
            divisionId: divisionBId,
            branchId: branchBId,
            accountName: `Derived cash position B ${suffix}`,
            openingBalance: 80_002.02,
            currentBalance: 80_002.02,
          },
        }),
        prisma.receivable.create({
          data: {
            receivableNumber: `DR-AR-A-${suffix}`,
            companyId: companyAId,
            divisionId: divisionAId,
            branchId: branchAId,
            customerId: seededCustomerAId,
            customerName: `Derived AR customer A ${suffix}`,
            amount: 91_003.17,
            outstandingAmount: 91_003.17,
            issueDate: new Date('2026-06-15T00:00:00.000Z'),
            dueDate: new Date('2099-01-01T00:00:00.000Z'),
            status: 'OPEN',
          },
        }),
        prisma.receivable.create({
          data: {
            receivableNumber: `DR-AR-B-${suffix}`,
            companyId: companyBId,
            divisionId: divisionBId,
            branchId: branchBId,
            customerId: seededCustomerBId,
            customerName: `Derived AR customer B ${suffix}`,
            amount: 92_004.29,
            outstandingAmount: 92_004.29,
            issueDate: new Date('2026-06-15T00:00:00.000Z'),
            dueDate: new Date('2099-01-01T00:00:00.000Z'),
            status: 'OPEN',
          },
        }),
        prisma.payable.create({
          data: {
            payableNumber: `DR-AP-A-${suffix}`,
            companyId: companyAId,
            divisionId: divisionAId,
            branchId: branchAId,
            supplierName: `Derived AP supplier A ${suffix}`,
            amount: 81_005.31,
            outstandingAmount: 81_005.31,
            issueDate: new Date('2026-06-15T00:00:00.000Z'),
            dueDate: new Date('2099-01-01T00:00:00.000Z'),
            status: 'OPEN',
          },
        }),
        prisma.payable.create({
          data: {
            payableNumber: `DR-AP-B-${suffix}`,
            companyId: companyBId,
            divisionId: divisionBId,
            branchId: branchBId,
            supplierName: `Derived AP supplier B ${suffix}`,
            amount: 82_006.43,
            outstandingAmount: 82_006.43,
            issueDate: new Date('2026-06-15T00:00:00.000Z'),
            dueDate: new Date('2099-01-01T00:00:00.000Z'),
            status: 'OPEN',
          },
        }),
      ]);

    const intercompanyAmount = 55_007.53;
    await prisma.interCompanyTransaction.create({
      data: {
        transactionNumber: `DR-ICT-${suffix}`,
        fromCompanyId: companyAId,
        toCompanyId: companyBId,
        transactionType: 'INTERNAL_SALE',
        amount: intercompanyAmount,
        transactionDate: new Date('2026-06-15T00:00:00.000Z'),
        description: `Derived intercompany control ${suffix}`,
        status: 'POSTED',
        createdById: groupReaderUserId,
        approvedById: groupReaderUserId,
        approvedAt: new Date('2026-06-15T00:00:01.000Z'),
        fromCompanyJournalEntryId: intercompanyJournalA.id,
        toCompanyJournalEntryId: intercompanyJournalB.id,
        postedAt: new Date('2026-06-15T00:00:02.000Z'),
      },
    });

    const [debitsA, debitsB, receivablesA, receivablesB, payablesA, payablesB, intercompany] =
      await Promise.all([
        prisma.journalEntryLine.aggregate({
          where: {
            companyId: companyAId,
            journalEntry: { status: { in: ['POSTED', 'REVERSED'] }, deletedAt: null },
          },
          _sum: { debit: true },
        }),
        prisma.journalEntryLine.aggregate({
          where: {
            companyId: companyBId,
            journalEntry: { status: { in: ['POSTED', 'REVERSED'] }, deletedAt: null },
          },
          _sum: { debit: true },
        }),
        prisma.receivable.aggregate({
          where: {
            companyId: companyAId,
            deletedAt: null,
            status: { in: ['OPEN', 'PARTIALLY_PAID', 'OVERDUE'] },
          },
          _sum: { outstandingAmount: true },
        }),
        prisma.receivable.aggregate({
          where: {
            companyId: companyBId,
            deletedAt: null,
            status: { in: ['OPEN', 'PARTIALLY_PAID', 'OVERDUE'] },
          },
          _sum: { outstandingAmount: true },
        }),
        prisma.payable.aggregate({
          where: {
            companyId: companyAId,
            deletedAt: null,
            status: { in: ['OPEN', 'PARTIALLY_PAID', 'OVERDUE'] },
          },
          _sum: { outstandingAmount: true },
        }),
        prisma.payable.aggregate({
          where: {
            companyId: companyBId,
            deletedAt: null,
            status: { in: ['OPEN', 'PARTIALLY_PAID', 'OVERDUE'] },
          },
          _sum: { outstandingAmount: true },
        }),
        prisma.interCompanyTransaction.aggregate({
          where: { fromCompanyId: companyAId, toCompanyId: companyBId, status: 'POSTED' },
          _sum: { amount: true },
        }),
      ]);

    derivedReportValues.set('financeJournalA', journalA.id);
    derivedReportValues.set('financeJournalB', journalB.id);
    derivedReportValues.set('financeIntercompanyJournalA', intercompanyJournalA.id);
    derivedReportValues.set('financeIntercompanyJournalB', intercompanyJournalB.id);
    derivedReportValues.set('financeCashAccountA', cashAccountA.accountName);
    derivedReportValues.set('financeCashAccountB', cashAccountB.accountName);
    derivedReportValues.set('financeGroupSummaryDebitA', Number(debitsA._sum.debit ?? 0));
    derivedReportValues.set('financeGroupSummaryDebitB', Number(debitsB._sum.debit ?? 0));
    derivedReportValues.set(
      'financeReceivableTotalA',
      Number(receivablesA._sum.outstandingAmount ?? 0),
    );
    derivedReportValues.set(
      'financeReceivableTotalB',
      Number(receivablesB._sum.outstandingAmount ?? 0),
    );
    derivedReportValues.set('financePayableTotalA', Number(payablesA._sum.outstandingAmount ?? 0));
    derivedReportValues.set('financePayableTotalB', Number(payablesB._sum.outstandingAmount ?? 0));
    derivedReportValues.set('financeIntercompanyTotal', Number(intercompany._sum.amount ?? 0));

    if (
      Number(receivableA.outstandingAmount) <= 0 ||
      Number(receivableB.outstandingAmount) <= 0 ||
      Number(payableA.outstandingAmount) <= 0 ||
      Number(payableB.outstandingAmount) <= 0
    ) {
      throw new Error('Derived financial A/B aging controls were not created as open balances.');
    }
  }

  async function seedDerivedOperationsReportControls(): Promise<void> {
    const [branchA, branchB, unitA, unitB, categoryA, categoryB] = await Promise.all([
      prisma.branch.findUniqueOrThrow({ where: { id: branchAId } }),
      prisma.branch.findUniqueOrThrow({ where: { id: branchBId } }),
      prisma.unitOfMeasure.create({
        data: {
          companyId: companyAId,
          name: `Derived operations unit A ${suffix}`,
          symbol: `DRA${suffix.slice(-3)}`,
        },
      }),
      prisma.unitOfMeasure.create({
        data: {
          companyId: companyBId,
          name: `Derived operations unit B ${suffix}`,
          symbol: `DRB${suffix.slice(-3)}`,
        },
      }),
      prisma.productCategory.create({
        data: { companyId: companyAId, name: `Derived operations category A ${suffix}` },
      }),
      prisma.productCategory.create({
        data: { companyId: companyBId, name: `Derived operations category B ${suffix}` },
      }),
    ]);

    const [productA, productB, customerA, customerB, supplierA, supplierB] = await Promise.all([
      prisma.product.create({
        data: {
          productCode: `DR-OPS-PROD-A-${suffix}`,
          sku: `DR-OPS-SKU-A-${suffix}`,
          companyId: companyAId,
          divisionId: divisionAId,
          categoryId: categoryA.id,
          name: `Derived operations product A ${suffix}`,
          baseUnitId: unitA.id,
          defaultPurchasePrice: 301.11,
          defaultSellingPrice: 731.14,
          minimumStockLevel: 8,
          reorderLevel: 10,
        },
      }),
      prisma.product.create({
        data: {
          productCode: `DR-OPS-PROD-B-${suffix}`,
          sku: `DR-OPS-SKU-B-${suffix}`,
          companyId: companyBId,
          divisionId: divisionBId,
          categoryId: categoryB.id,
          name: `Derived operations product B ${suffix}`,
          baseUnitId: unitB.id,
          defaultPurchasePrice: 402.22,
          defaultSellingPrice: 982.28,
          minimumStockLevel: 9,
          reorderLevel: 12,
        },
      }),
      prisma.customer.create({
        data: {
          customerCode: `DR-OPS-CUST-A-${suffix}`,
          companyId: companyAId,
          divisionId: divisionAId,
          branchId: branchAId,
          name: `Derived operations customer A ${suffix}`,
        },
      }),
      prisma.customer.create({
        data: {
          customerCode: `DR-OPS-CUST-B-${suffix}`,
          companyId: companyBId,
          divisionId: divisionBId,
          branchId: branchBId,
          name: `Derived operations customer B ${suffix}`,
        },
      }),
      prisma.supplier.create({
        data: {
          supplierCode: `DR-OPS-SUP-A-${suffix}`,
          companyId: companyAId,
          divisionId: divisionAId,
          branchId: branchAId,
          name: `Derived operations supplier A ${suffix}`,
        },
      }),
      prisma.supplier.create({
        data: {
          supplierCode: `DR-OPS-SUP-B-${suffix}`,
          companyId: companyBId,
          divisionId: divisionBId,
          branchId: branchBId,
          name: `Derived operations supplier B ${suffix}`,
        },
      }),
    ]);

    const [salesA, salesB, purchaseA, purchaseB] = await Promise.all([
      prisma.salesOrder.create({
        data: {
          salesOrderNumber: `DR-OPS-SO-A-${suffix}`,
          companyId: companyAId,
          divisionId: divisionAId,
          branchId: branchAId,
          customerId: customerA.id,
          customerName: customerA.name,
          salesType: 'RETAIL',
          orderDate: new Date('2026-07-10T12:00:00.000Z'),
          subtotal: 7_311.41,
          totalAmount: 7_311.41,
          paidAmount: 3_000,
          outstandingAmount: 4_311.41,
          status: 'CONFIRMED',
          paymentStatus: 'PARTIALLY_PAID',
          paymentMethod: 'CREDIT',
          createdById: creatorUserId,
          lines: {
            create: {
              productId: productA.id,
              quantity: 10,
              unitId: unitA.id,
              unitPrice: 731.141,
              lineTotal: 7_311.41,
              unitCostAtSale: 301.11,
              cogsAmount: 3_011.1,
              grossProfitAmount: 4_300.31,
              grossMarginPct: 58.8164,
            },
          },
        },
      }),
      prisma.salesOrder.create({
        data: {
          salesOrderNumber: `DR-OPS-SO-B-${suffix}`,
          companyId: companyBId,
          divisionId: divisionBId,
          branchId: branchBId,
          customerId: customerB.id,
          customerName: customerB.name,
          salesType: 'RETAIL',
          orderDate: new Date('2026-07-10T12:00:00.000Z'),
          subtotal: 9_822.82,
          totalAmount: 9_822.82,
          paidAmount: 4_000,
          outstandingAmount: 5_822.82,
          status: 'CONFIRMED',
          paymentStatus: 'PARTIALLY_PAID',
          paymentMethod: 'CREDIT',
          createdById: groupReaderUserId,
          lines: {
            create: {
              productId: productB.id,
              quantity: 10,
              unitId: unitB.id,
              unitPrice: 982.282,
              lineTotal: 9_822.82,
              unitCostAtSale: 402.22,
              cogsAmount: 4_022.2,
              grossProfitAmount: 5_800.62,
              grossMarginPct: 59.0516,
            },
          },
        },
      }),
      prisma.purchaseOrder.create({
        data: {
          purchaseOrderNumber: `DR-OPS-PO-A-${suffix}`,
          companyId: companyAId,
          divisionId: divisionAId,
          branchId: branchAId,
          supplierId: supplierA.id,
          supplierName: supplierA.name,
          purchaseType: 'STOCK_PURCHASE',
          orderDate: new Date('2026-07-08T12:00:00.000Z'),
          subtotal: 5_411.31,
          totalAmount: 5_411.31,
          paidAmount: 2_000,
          outstandingAmount: 3_411.31,
          status: 'CONFIRMED',
          paymentStatus: 'PARTIALLY_PAID',
          createdById: creatorUserId,
          lines: {
            create: {
              productId: productA.id,
              quantity: 10,
              unitId: unitA.id,
              unitCost: 541.131,
              lineTotal: 5_411.31,
            },
          },
        },
      }),
      prisma.purchaseOrder.create({
        data: {
          purchaseOrderNumber: `DR-OPS-PO-B-${suffix}`,
          companyId: companyBId,
          divisionId: divisionBId,
          branchId: branchBId,
          supplierId: supplierB.id,
          supplierName: supplierB.name,
          purchaseType: 'STOCK_PURCHASE',
          orderDate: new Date('2026-07-08T12:00:00.000Z'),
          subtotal: 8_522.62,
          totalAmount: 8_522.62,
          paidAmount: 3_000,
          outstandingAmount: 5_522.62,
          status: 'CONFIRMED',
          paymentStatus: 'PARTIALLY_PAID',
          createdById: groupReaderUserId,
          lines: {
            create: {
              productId: productB.id,
              quantity: 10,
              unitId: unitB.id,
              unitCost: 852.262,
              lineTotal: 8_522.62,
            },
          },
        },
      }),
    ]);

    const [movementA, movementB, adjustmentA, adjustmentB] = await Promise.all([
      prisma.inventoryMovement.create({
        data: {
          movementNumber: `DR-OPS-MOVE-A-${suffix}`,
          companyId: companyAId,
          divisionId: divisionAId,
          branchId: branchAId,
          productId: productA.id,
          movementType: 'OPENING_STOCK',
          quantity: 2,
          unitId: unitA.id,
          unitCost: 301.11,
          totalCost: 602.22,
          movementDate: new Date('2026-07-01T12:00:00.000Z'),
          createdById: creatorUserId,
        },
      }),
      prisma.inventoryMovement.create({
        data: {
          movementNumber: `DR-OPS-MOVE-B-${suffix}`,
          companyId: companyBId,
          divisionId: divisionBId,
          branchId: branchBId,
          productId: productB.id,
          movementType: 'OPENING_STOCK',
          quantity: 3,
          unitId: unitB.id,
          unitCost: 402.22,
          totalCost: 1_206.66,
          movementDate: new Date('2026-07-01T12:00:00.000Z'),
          createdById: groupReaderUserId,
        },
      }),
      prisma.stockAdjustment.create({
        data: {
          adjustmentNumber: `DR-OPS-ADJ-A-${suffix}`,
          companyId: companyAId,
          divisionId: divisionAId,
          branchId: branchAId,
          reason: `Derived adjustment A ${suffix}`,
          status: 'POSTED',
          createdById: creatorUserId,
          postedById: creatorUserId,
          postedAt: new Date('2026-07-02T12:00:00.000Z'),
          createdAt: new Date('2026-07-02T12:00:00.000Z'),
          lines: {
            create: {
              productId: productA.id,
              systemQuantity: 1,
              countedQuantity: 2,
              varianceQuantity: 1,
              unitId: unitA.id,
              unitCost: 301.11,
            },
          },
        },
      }),
      prisma.stockAdjustment.create({
        data: {
          adjustmentNumber: `DR-OPS-ADJ-B-${suffix}`,
          companyId: companyBId,
          divisionId: divisionBId,
          branchId: branchBId,
          reason: `Derived adjustment B ${suffix}`,
          status: 'POSTED',
          createdById: groupReaderUserId,
          postedById: groupReaderUserId,
          postedAt: new Date('2026-07-02T12:00:00.000Z'),
          createdAt: new Date('2026-07-02T12:00:00.000Z'),
          lines: {
            create: {
              productId: productB.id,
              systemQuantity: 2,
              countedQuantity: 3,
              varianceQuantity: 1,
              unitId: unitB.id,
              unitCost: 402.22,
            },
          },
        },
      }),
    ]);

    await Promise.all([
      prisma.inventoryBalance.create({
        data: {
          companyId: companyAId,
          divisionId: divisionAId,
          branchId: branchAId,
          productId: productA.id,
          quantityOnHand: 2,
          averageCost: 301.11,
          totalValue: 602.22,
          lastMovementAt: movementA.movementDate,
        },
      }),
      prisma.inventoryBalance.create({
        data: {
          companyId: companyBId,
          divisionId: divisionBId,
          branchId: branchBId,
          productId: productB.id,
          quantityOnHand: 3,
          averageCost: 402.22,
          totalValue: 1_206.66,
          lastMovementAt: movementB.movementDate,
        },
      }),
    ]);

    const [salesTotalA, purchaseTotalA] = await Promise.all([
      prisma.salesOrder.aggregate({
        where: {
          companyId: companyAId,
          deletedAt: null,
          orderDate: {
            gte: new Date('2026-01-01T00:00:00.000Z'),
            lte: new Date('2026-12-31T23:59:59.999Z'),
          },
        },
        _sum: { totalAmount: true },
      }),
      prisma.purchaseOrder.aggregate({
        where: {
          companyId: companyAId,
          deletedAt: null,
          orderDate: {
            gte: new Date('2026-01-01T00:00:00.000Z'),
            lte: new Date('2026-12-31T23:59:59.999Z'),
          },
        },
        _sum: { totalAmount: true },
      }),
    ]);

    derivedReportValues.set('operationsSalesOrderA', salesA.salesOrderNumber);
    derivedReportValues.set('operationsSalesOrderB', salesB.salesOrderNumber);
    derivedReportValues.set('operationsCustomerA', customerA.customerCode);
    derivedReportValues.set('operationsCustomerB', customerB.customerCode);
    derivedReportValues.set('operationsProductA', productA.productCode);
    derivedReportValues.set('operationsProductB', productB.productCode);
    derivedReportValues.set('operationsProductNameA', productA.name);
    derivedReportValues.set('operationsProductNameB', productB.name);
    derivedReportValues.set('operationsSupplierA', supplierA.supplierCode);
    derivedReportValues.set('operationsSupplierB', supplierB.supplierCode);
    derivedReportValues.set('operationsPurchaseOrderA', purchaseA.purchaseOrderNumber);
    derivedReportValues.set('operationsPurchaseOrderB', purchaseB.purchaseOrderNumber);
    derivedReportValues.set('operationsInventoryMovementA', movementA.movementNumber);
    derivedReportValues.set('operationsInventoryMovementB', movementB.movementNumber);
    derivedReportValues.set('operationsStockAdjustmentA', adjustmentA.adjustmentNumber);
    derivedReportValues.set('operationsStockAdjustmentB', adjustmentB.adjustmentNumber);
    derivedReportValues.set('operationsBranchA', `${branchA.code} - ${branchA.name}`.trim());
    derivedReportValues.set('operationsBranchB', `${branchB.code} - ${branchB.name}`.trim());
    derivedReportValues.set('operationsSalesTotalA', Number(salesTotalA._sum.totalAmount ?? 0));
    derivedReportValues.set(
      'operationsPurchaseTotalA',
      Number(purchaseTotalA._sum.totalAmount ?? 0),
    );
  }

  async function seedDerivedCompanySummaryControls(): Promise<void> {
    const productCodeA = derivedReportBindingValue('operationsProductA');
    const productCodeB = derivedReportBindingValue('operationsProductB');
    if (typeof productCodeA !== 'string' || typeof productCodeB !== 'string') {
      throw new Error('Company-summary controls require the operations product pair.');
    }
    const [productA, productB, taxType] = await Promise.all([
      prisma.product.findFirstOrThrow({
        where: { companyId: companyAId, productCode: productCodeA, deletedAt: null },
        select: { id: true, baseUnitId: true },
      }),
      prisma.product.findFirstOrThrow({
        where: { companyId: companyBId, productCode: productCodeB, deletedAt: null },
        select: { id: true, baseUnitId: true },
      }),
      seedModelRecord('TaxType'),
    ]);
    const taxTypeId = stringField(taxType, 'id');
    if (!taxTypeId) throw new Error('Company-summary tax control has no TaxType seed.');

    // Keep the company-A product deterministically inside the dashboard's top-10
    // projection. The corresponding company-B value remains larger than any
    // generic fixture but is excluded by company scope.
    await prisma.$transaction([
      prisma.inventoryBalance.updateMany({
        where: { companyId: companyAId, productId: productA.id },
        data: { averageCost: 493_827.16, totalValue: 987_654.32 },
      }),
      prisma.inventoryBalance.updateMany({
        where: { companyId: companyBId, productId: productB.id },
        data: { averageCost: 292_181.07, totalValue: 876_543.21 },
      }),
    ]);

    const now = new Date();
    const upcomingDueAt = new Date(now.getTime() + 45 * 24 * 60 * 60 * 1000);
    const expiringAt = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000);
    const [
      accountingLockA,
      accountingLockB,
      approvalA,
      approvalB,
      backgroundJobA,
      backgroundJobB,
      obligationA,
      obligationB,
      productBatchA,
      productBatchB,
      taxTransactionA,
      taxTransactionB,
    ] = await prisma.$transaction([
      prisma.accountingLock.create({
        data: {
          lockCode: `CRUD-SUMMARY-LOCK-A-${suffix}`,
          companyId: companyAId,
          lockType: AccountingLockType.MODULE_LOCK,
          moduleName: 'CRUD_SUMMARY_CONTROL',
          status: 'ACTIVE',
          createdById: creatorUserId,
        },
      }),
      prisma.accountingLock.create({
        data: {
          lockCode: `CRUD-SUMMARY-LOCK-B-${suffix}`,
          companyId: companyBId,
          lockType: AccountingLockType.MODULE_LOCK,
          moduleName: 'CRUD_SUMMARY_CONTROL',
          status: 'ACTIVE',
          createdById: groupReaderUserId,
        },
      }),
      prisma.approvalRequest.create({
        data: {
          approvalRequestNumber: `CRUD-SUMMARY-APPROVAL-A-${suffix}`,
          companyId: companyAId,
          entityType: 'CrudSummaryControl',
          entityId: companyAId,
          requestedById: creatorUserId,
          status: 'PENDING',
          requestTitle: `CRUD summary approval A ${suffix}`,
        },
      }),
      prisma.approvalRequest.create({
        data: {
          approvalRequestNumber: `CRUD-SUMMARY-APPROVAL-B-${suffix}`,
          companyId: companyBId,
          entityType: 'CrudSummaryControl',
          entityId: companyBId,
          requestedById: groupReaderUserId,
          status: 'PENDING',
          requestTitle: `CRUD summary approval B ${suffix}`,
        },
      }),
      prisma.backgroundJob.create({
        data: {
          jobNumber: `CRUD-SUMMARY-JOB-A-${suffix}`,
          jobType: 'CUSTOM',
          queueName: 'crud-summary-evidence',
          companyId: companyAId,
          requestedById: creatorUserId,
          status: 'QUEUED',
        },
      }),
      prisma.backgroundJob.create({
        data: {
          jobNumber: `CRUD-SUMMARY-JOB-B-${suffix}`,
          jobType: 'CUSTOM',
          queueName: 'crud-summary-evidence',
          companyId: companyBId,
          requestedById: groupReaderUserId,
          status: 'QUEUED',
        },
      }),
      prisma.complianceObligation.create({
        data: {
          obligationCode: `CRUD-SUMMARY-OBL-A-${suffix}`,
          companyId: companyAId,
          obligationType: 'OTHER',
          title: `CRUD upcoming obligation A ${suffix}`,
          dueDate: upcomingDueAt,
          status: 'UPCOMING',
        },
      }),
      prisma.complianceObligation.create({
        data: {
          obligationCode: `CRUD-SUMMARY-OBL-B-${suffix}`,
          companyId: companyBId,
          obligationType: 'OTHER',
          title: `CRUD upcoming obligation B ${suffix}`,
          dueDate: upcomingDueAt,
          status: 'UPCOMING',
        },
      }),
      prisma.productBatch.create({
        data: {
          batchNumber: `CRUD-SUMMARY-BATCH-A-${suffix}`,
          companyId: companyAId,
          productId: productA.id,
          branchId: branchAId,
          expiryDate: expiringAt,
          initialQuantity: 7,
          remainingQuantity: 7,
          unitId: productA.baseUnitId,
          unitCost: 101.01,
          status: 'ACTIVE',
        },
      }),
      prisma.productBatch.create({
        data: {
          batchNumber: `CRUD-SUMMARY-BATCH-B-${suffix}`,
          companyId: companyBId,
          productId: productB.id,
          branchId: branchBId,
          expiryDate: expiringAt,
          initialQuantity: 9,
          remainingQuantity: 9,
          unitId: productB.baseUnitId,
          unitCost: 202.02,
          status: 'ACTIVE',
        },
      }),
      prisma.taxTransaction.create({
        data: {
          taxTransactionNumber: `CRUD-SUMMARY-TAX-A-${suffix}`,
          companyId: companyAId,
          taxTypeId,
          sourceType: 'MANUAL',
          transactionDate: now,
          taxableAmount: 731_234.5,
          taxAmount: 73_123.45,
          direction: 'OUTPUT',
          status: 'POSTED',
          createdById: creatorUserId,
        },
      }),
      prisma.taxTransaction.create({
        data: {
          taxTransactionNumber: `CRUD-SUMMARY-TAX-B-${suffix}`,
          companyId: companyBId,
          taxTypeId,
          sourceType: 'MANUAL',
          transactionDate: now,
          taxableAmount: 842_345.6,
          taxAmount: 84_234.56,
          direction: 'OUTPUT',
          status: 'POSTED',
          createdById: groupReaderUserId,
        },
      }),
    ]);

    const [belowCostAttemptA, belowCostAttemptB] = await Promise.all([
      prisma.auditLog.create({
        data: {
          action: 'PROFIT_VALIDATION_BLOCKED',
          entityType: 'CrudSummaryControl',
          entityId: productA.id,
          userId: creatorUserId,
          companyId: companyAId,
          severity: AuditSeverity.HIGH,
          scopeKind: AuditScopeKind.COMPANY,
          attributionStatus: AuditAttributionStatus.EXPLICIT,
          channel: AuditChannel.WEB,
          metadata: { source: 'crud-summary-evidence', message: `blocked-A-${suffix}` },
          companyScopes: { create: { companyId: companyAId } },
        },
      }),
      prisma.auditLog.create({
        data: {
          action: 'PROFIT_VALIDATION_BLOCKED',
          entityType: 'CrudSummaryControl',
          entityId: productB.id,
          userId: groupReaderUserId,
          companyId: companyBId,
          severity: AuditSeverity.HIGH,
          scopeKind: AuditScopeKind.COMPANY,
          attributionStatus: AuditAttributionStatus.EXPLICIT,
          channel: AuditChannel.WEB,
          metadata: { source: 'crud-summary-evidence', message: `blocked-B-${suffix}` },
          companyScopes: { create: { companyId: companyBId } },
        },
      }),
    ]);

    const [
      accountingLocksA,
      approvalPendingA,
      backgroundQueuedA,
      contractsA,
      customersA,
      documentsA,
      inventoryBalancesA,
      inventoryMovementsA,
      activeProductsA,
      activeSuppliersA,
      purchaseTotalsA,
      salesTotalsA,
      suppliersA,
      obligationCountA,
      taxTotalsA,
      taxTotalsB,
    ] = await Promise.all([
      prisma.accountingLock.count({
        where: { companyId: companyAId, deletedAt: null, status: 'ACTIVE' },
      }),
      prisma.approvalRequest.count({
        where: { companyId: companyAId, deletedAt: null, status: 'PENDING' },
      }),
      prisma.backgroundJob.count({ where: { companyId: companyAId, status: 'QUEUED' } }),
      prisma.contract.count({ where: { companyId: companyAId, deletedAt: null } }),
      prisma.customer.count({ where: { companyId: companyAId, deletedAt: null } }),
      prisma.document.count({ where: { companyId: companyAId, deletedAt: null } }),
      prisma.inventoryBalance.count({ where: { companyId: companyAId } }),
      prisma.inventoryMovement.count({ where: { companyId: companyAId } }),
      prisma.product.count({
        where: { companyId: companyAId, deletedAt: null, status: 'ACTIVE' },
      }),
      prisma.supplier.count({
        where: { companyId: companyAId, deletedAt: null, status: 'ACTIVE' },
      }),
      prisma.purchaseOrder.aggregate({
        where: { companyId: companyAId, deletedAt: null },
        _sum: { totalAmount: true },
      }),
      prisma.salesOrder.aggregate({
        where: {
          companyId: companyAId,
          deletedAt: null,
          status: { notIn: ['CANCELLED', 'VOIDED'] },
        },
        _sum: { totalAmount: true },
      }),
      prisma.supplier.count({ where: { companyId: companyAId, deletedAt: null } }),
      prisma.complianceObligation.count({
        where: { companyId: companyAId, deletedAt: null, status: 'UPCOMING' },
      }),
      prisma.taxTransaction.aggregate({
        where: {
          companyId: companyAId,
          deletedAt: null,
          direction: 'OUTPUT',
          status: 'POSTED',
        },
        _sum: { taxAmount: true },
      }),
      prisma.taxTransaction.aggregate({
        where: {
          companyId: companyBId,
          deletedAt: null,
          direction: 'OUTPUT',
          status: 'POSTED',
        },
        _sum: { taxAmount: true },
      }),
    ]);

    const taxAmountA = Number(taxTotalsA._sum.taxAmount ?? 0);
    const taxAmountB = Number(taxTotalsB._sum.taxAmount ?? 0);
    const positiveControls = [
      accountingLocksA,
      approvalPendingA,
      backgroundQueuedA,
      contractsA,
      customersA,
      documentsA,
      inventoryBalancesA,
      inventoryMovementsA,
      activeProductsA,
      activeSuppliersA,
      Number(purchaseTotalsA._sum.totalAmount ?? 0),
      Number(salesTotalsA._sum.totalAmount ?? 0),
      suppliersA,
      obligationCountA,
      taxAmountA,
      taxAmountB,
    ];
    if (positiveControls.some((value) => !Number.isFinite(value) || value <= 0)) {
      throw new Error('Company-summary causal source values were not all positive.');
    }
    if (taxAmountA === taxAmountB) {
      throw new Error('Company-summary tax controls must have distinct A/B aggregates.');
    }
    if (
      accountingLockA.companyId !== companyAId ||
      accountingLockB.companyId !== companyBId ||
      approvalA.companyId !== companyAId ||
      approvalB.companyId !== companyBId ||
      backgroundJobA.companyId !== companyAId ||
      backgroundJobB.companyId !== companyBId ||
      taxTransactionA.companyId !== companyAId ||
      taxTransactionB.companyId !== companyBId
    ) {
      throw new Error('Company-summary source rows lost their signed A/B company binding.');
    }

    derivedReportValues.set('companySummaryAccountingLocksA', accountingLocksA);
    derivedReportValues.set('companySummaryApprovalPendingA', approvalPendingA);
    derivedReportValues.set('companySummaryBackgroundQueuedA', backgroundQueuedA);
    derivedReportValues.set('companySummaryContractTotalA', contractsA);
    derivedReportValues.set('companySummaryCustomerTotalA', customersA);
    derivedReportValues.set('companySummaryDocumentTotalA', documentsA);
    derivedReportValues.set('companySummaryInventoryCountA', inventoryBalancesA);
    derivedReportValues.set('companySummaryMovementCountA', inventoryMovementsA);
    derivedReportValues.set('companySummaryObligationStatusA', obligationA.status);
    derivedReportValues.set('companySummaryObligationCountA', obligationCountA);
    derivedReportValues.set('companySummaryOperationsActiveProductsA', activeProductsA);
    derivedReportValues.set('companySummaryProcurementActiveSuppliersA', activeSuppliersA);
    derivedReportValues.set(
      'companySummaryPurchaseTotalA',
      Number(purchaseTotalsA._sum.totalAmount ?? 0),
    );
    derivedReportValues.set(
      'companySummarySalesRevenueA',
      Number(salesTotalsA._sum.totalAmount ?? 0),
    );
    derivedReportValues.set('companySummarySupplierTotalA', suppliersA);
    derivedReportValues.set('companySummaryTaxAmountA', taxAmountA);
    derivedReportValues.set('companySummaryTaxAmountB', taxAmountB);
    derivedReportValues.set('companySummaryUpcomingObligationA', obligationA.id);
    derivedReportValues.set('companySummaryUpcomingObligationB', obligationB.id);
    derivedReportValues.set('companySummaryExpiringBatchA', productBatchA.id);
    derivedReportValues.set('companySummaryExpiringBatchB', productBatchB.id);
    derivedReportValues.set('companySummaryBelowCostAttemptA', belowCostAttemptA.id);
    derivedReportValues.set('companySummaryBelowCostAttemptB', belowCostAttemptB.id);
  }

  async function seedGlobalAdminReadControls(): Promise<void> {
    const creatorCredential = await prisma.user.findUniqueOrThrow({
      where: { id: creatorUserId },
      select: { passwordHash: true },
    });
    const [companyAProfileUser, companyBProfileUser] = await Promise.all([
      prisma.user.create({
        data: {
          email: `global-admin-company-a-${suffix}@itemba.invalid`,
          passwordHash: creatorCredential.passwordHash,
          fullName: `CRUD Global Admin Company A ${suffix}`,
          status: 'ACTIVE',
          companyId: companyAId,
          companyAccess: {
            create: { companyId: companyAId, accessLevel: AccessLevel.MANAGE },
          },
        },
      }),
      prisma.user.create({
        data: {
          email: `global-admin-company-b-${suffix}@itemba.invalid`,
          passwordHash: creatorCredential.passwordHash,
          fullName: `CRUD Global Admin Company B ${suffix}`,
          status: 'ACTIVE',
          companyId: companyBId,
          companyAccess: {
            create: { companyId: companyBId, accessLevel: AccessLevel.MANAGE },
          },
        },
      }),
    ]);

    const [
      backupJob,
      isolationRun,
      integrationProvider,
      jobQueueConfig,
      permission,
      role,
      taxAuthority,
      taxType,
      userSecurityProfileA,
      userSecurityProfileB,
    ] = await Promise.all([
      prisma.backupJob.create({
        data: {
          backupJobCode: `CRUD-GLOBAL-BACKUP-${suffix}`,
          name: `CRUD global backup ${suffix}`,
          backupType: 'DATABASE',
          schedule: 'MANUAL',
          storageTarget: 'LOCAL',
          retentionDays: 7,
          status: 'ACTIVE',
          createdById: creatorUserId,
        },
      }),
      prisma.dataIsolationTestRun.create({
        data: {
          testRunNumber: `CRUD-GLOBAL-ISOLATION-${suffix}`,
          runType: 'GROUP_CONTROL_SCOPE',
          status: 'RUNNING',
          startedById: groupReaderUserId,
          totalChecks: 1,
        },
      }),
      prisma.integrationProvider.create({
        data: {
          providerCode: `CRUD-GLOBAL-PROVIDER-${suffix}`,
          name: `CRUD global provider ${suffix}`,
          providerType: 'CUSTOM',
          status: 'ACTIVE',
        },
      }),
      prisma.jobQueueConfig.create({
        data: {
          queueName: `crud-global-admin-${suffix}`,
          description: `CRUD global queue ${suffix}`,
          concurrency: 1,
          retryAttempts: 1,
          retryBackoffSeconds: 1,
          isActive: true,
        },
      }),
      prisma.permission.create({
        data: {
          code: `crud.global_admin_read.${suffix}`,
          description: `CRUD global administrative read ${suffix}`,
          module: 'crud_global_admin_read',
          action: 'view',
          isGroupControl: false,
        },
      }),
      prisma.role.create({
        data: {
          name: `CRUD_GLOBAL_ADMIN_READ_${suffix}`,
          displayName: `CRUD global administrative read ${suffix}`,
          description: `Deterministic global role-list control ${suffix}`,
          scope: RoleScope.COMPANY,
          isSystem: false,
        },
      }),
      prisma.taxAuthority.create({
        data: {
          authorityCode: `CRUD-GLOBAL-AUTH-${suffix}`,
          name: `000 CRUD global authority ${suffix}`,
          country: `CRUD-${suffix}`,
          authorityType: 'OTHER',
          status: 'ACTIVE',
        },
      }),
      prisma.taxType.create({
        data: {
          taxTypeCode: `CRUD-GLOBAL-TAX-${suffix}`,
          name: `000 CRUD global tax type ${suffix}`,
          taxCategory: 'OTHER',
          status: 'ACTIVE',
        },
      }),
      prisma.userSecurityProfile.create({
        data: {
          userId: companyAProfileUser.id,
          twoFactorEnabled: false,
          twoFactorMethod: 'NONE',
          securityRiskLevel: 'LOW',
        },
      }),
      prisma.userSecurityProfile.create({
        data: {
          userId: companyBProfileUser.id,
          twoFactorEnabled: false,
          twoFactorMethod: 'NONE',
          securityRiskLevel: 'LOW',
        },
      }),
    ]);

    const [backupRun, isolationIssue, auditEntityTypeA, auditEntityTypeB] = await Promise.all([
      prisma.backupRun.create({
        data: {
          backupRunNumber: `CRUD-GLOBAL-RUN-${suffix}`,
          backupJobId: backupJob.id,
          backupType: 'DATABASE',
          status: 'REQUESTED',
          triggeredById: creatorUserId,
          metadata: { source: 'crud-global-admin-read' },
        },
      }),
      prisma.dataIsolationTestIssue.create({
        data: {
          testRunId: isolationRun.id,
          issueType: 'GROUP_CONTROL_BYPASS',
          severity: 'HIGH',
          entityType: 'CrudGlobalAdminRead',
          endpoint: '/crud-global-admin-read',
          description: `CRUD global isolation issue ${suffix}`,
          status: 'OPEN',
        },
      }),
      prisma.auditLog.create({
        data: {
          action: `CRUD_ADMIN_ENTITY_TYPE_A_${suffix}`,
          entityType: `000_CRUD_ADMIN_ENTITY_A_${suffix}`,
          entityId: companyAId,
          userId: creatorUserId,
          companyId: companyAId,
          severity: AuditSeverity.MEDIUM,
          scopeKind: AuditScopeKind.COMPANY,
          attributionStatus: AuditAttributionStatus.EXPLICIT,
          channel: AuditChannel.WEB,
          companyScopes: { create: { companyId: companyAId } },
        },
      }),
      prisma.auditLog.create({
        data: {
          action: `CRUD_ADMIN_ENTITY_TYPE_B_${suffix}`,
          entityType: `000_CRUD_ADMIN_ENTITY_B_${suffix}`,
          entityId: companyBId,
          userId: groupReaderUserId,
          companyId: companyBId,
          severity: AuditSeverity.MEDIUM,
          scopeKind: AuditScopeKind.COMPANY,
          attributionStatus: AuditAttributionStatus.EXPLICIT,
          channel: AuditChannel.WEB,
          companyScopes: { create: { companyId: companyBId } },
        },
      }),
    ]);

    const sourceRows = [
      backupJob,
      backupRun,
      isolationRun,
      isolationIssue,
      integrationProvider,
      jobQueueConfig,
      permission,
      role,
      taxAuthority,
      taxType,
      userSecurityProfileA,
      userSecurityProfileB,
      auditEntityTypeA,
      auditEntityTypeB,
    ];
    if (sourceRows.some((row) => typeof row.id !== 'string' || !row.id)) {
      throw new Error('Global administrative read controls did not create exact source rows.');
    }
    if (
      companyAProfileUser.companyId !== companyAId ||
      companyBProfileUser.companyId !== companyBId ||
      auditEntityTypeA.companyId !== companyAId ||
      auditEntityTypeB.companyId !== companyBId
    ) {
      throw new Error('Company-bound administrative controls lost their A/B ownership.');
    }

    globalAdminReadValues.set('backupJob', backupJob.id);
    globalAdminReadValues.set('backupRun', backupRun.id);
    globalAdminReadValues.set('dataIsolationIssue', isolationIssue.id);
    globalAdminReadValues.set('dataIsolationTestRun', isolationRun.id);
    globalAdminReadValues.set('integrationProvider', integrationProvider.id);
    globalAdminReadValues.set('jobQueueConfig', jobQueueConfig.id);
    globalAdminReadValues.set('permission', permission.id);
    globalAdminReadValues.set('role', role.id);
    globalAdminReadValues.set('taxAuthority', taxAuthority.id);
    globalAdminReadValues.set('taxType', taxType.id);
    globalAdminReadValues.set('userSecurityProfileA', userSecurityProfileA.id);
    globalAdminReadValues.set('userSecurityProfileB', userSecurityProfileB.id);
    globalAdminReadValues.set('auditEntityTypeA', auditEntityTypeA.entityType);
    globalAdminReadValues.set('auditEntityTypeB', auditEntityTypeB.entityType);
  }

  async function seedRemainingReadControls(): Promise<void> {
    const backupJobId = globalAdminReadValues.get('backupJob');
    const backupRunId = globalAdminReadValues.get('backupRun');
    const isolationRunId = globalAdminReadValues.get('dataIsolationTestRun');
    if (!backupJobId || !backupRunId || !isolationRunId) {
      throw new Error('Remaining read controls require the global administrative seed pack.');
    }
    remainingReadValues.set('backupJobId', backupJobId);
    remainingReadValues.set('backupRunId', backupRunId);
    remainingReadValues.set('dataIsolationRunId', isolationRunId);
    remainingReadValues.set('dataIsolationHighSeverity', 'HIGH');
    remainingReadValues.set(
      'dataIsolationHighCount',
      await prisma.dataIsolationTestIssue.count({ where: { severity: 'HIGH', status: 'OPEN' } }),
    );

    const remainingCacheAKey = `crud-remaining-permission-a-${suffix}`;
    const remainingCacheBKey = `crud-remaining-permission-b-${suffix}`;
    await prisma.cacheEntry.createMany({
      data: [
        {
          cacheKey: remainingCacheAKey,
          companyId: companyAId,
          cacheType: 'PERMISSION',
          value: { source: 'remaining-read-a' },
          expiresAt: new Date('2099-01-01T00:00:00.000Z'),
        },
        {
          cacheKey: remainingCacheBKey,
          companyId: companyBId,
          cacheType: 'PERMISSION',
          value: { source: 'remaining-read-b' },
          expiresAt: new Date('2099-01-01T00:00:00.000Z'),
        },
      ],
    });
    const [remainingCacheA, remainingCacheB] = await Promise.all([
      prisma.cacheEntry.findUnique({ where: { cacheKey: remainingCacheAKey } }),
      prisma.cacheEntry.findUnique({ where: { cacheKey: remainingCacheBKey } }),
    ]);
    if (!remainingCacheA || !remainingCacheB) {
      throw new Error('Remaining read cache controls were not persisted exactly.');
    }
    mutationBindings.set('actionClosureCacheCompanyA', remainingCacheA);
    mutationBindings.set('actionClosureCacheCompanyB', remainingCacheB);
    remainingReadValues.set('cachePermissionType', 'PERMISSION');
    remainingReadValues.set(
      'cachePermissionCount',
      await prisma.cacheEntry.count({ where: { cacheType: 'PERMISSION' } }),
    );

    const [debtA, debtB] = await Promise.all([
      prisma.debt.create({
        data: {
          companyId: companyAId,
          creditorName: `CRUD remaining debt A ${suffix}`,
          amount: new Prisma.Decimal('1234567.89'),
          amountPaid: new Prisma.Decimal('234567.11'),
          dueDate: new Date('2020-01-01T00:00:00.000Z'),
          description: 'Deterministic company-A remaining-read debt',
          status: 'PARTIALLY_PAID',
          riskLevel: 'CRITICAL',
          createdById: creatorUserId,
        },
      }),
      prisma.debt.create({
        data: {
          companyId: companyBId,
          creditorName: `CRUD remaining debt B ${suffix}`,
          amount: new Prisma.Decimal('7654321.21'),
          amountPaid: new Prisma.Decimal('0'),
          dueDate: new Date('2020-01-02T00:00:00.000Z'),
          description: 'Deterministic company-B remaining-read debt',
          status: 'OUTSTANDING',
          riskLevel: 'HIGH',
          createdById: groupReaderUserId,
        },
      }),
    ]);
    await refreshRemainingDebtAggregateBindings();
    remainingReadValues.set(
      'debtForeignOutstandingAmount',
      Number(new Prisma.Decimal(debtB.amount).minus(debtB.amountPaid)),
    );
    if (debtA.companyId !== companyAId || debtB.companyId !== companyBId) {
      throw new Error('Remaining debt controls lost their signed company ownership.');
    }

    const prefixA = `RA${suffix.slice(-6)}`.toUpperCase();
    const prefixB = `RB${suffix.slice(-6)}`.toUpperCase();
    await Promise.all([
      prisma.company.update({
        where: { id: companyAId },
        data: { employeeCodePrefix: prefixA },
      }),
      prisma.company.update({
        where: { id: companyBId },
        data: { employeeCodePrefix: prefixB },
      }),
    ]);
    const departmentId = stringField(seededModels.get('Department') ?? {}, 'id');
    if (!departmentId) throw new Error('Remaining next-code controls require department A.');
    await Promise.all([
      prisma.department.create({
        data: {
          departmentCode: `${prefixA}-DEPT-001`,
          companyId: companyAId,
          divisionId: divisionAId,
          branchId: branchAId,
          name: `CRUD remaining department 001 ${suffix}`,
        },
      }),
      prisma.department.create({
        data: {
          departmentCode: `${prefixA}-DEPT-003`,
          companyId: companyAId,
          divisionId: divisionAId,
          branchId: branchAId,
          name: `CRUD remaining department 003 ${suffix}`,
        },
      }),
      prisma.position.create({
        data: {
          positionCode: `${prefixA}-POS-001`,
          companyId: companyAId,
          departmentId,
          title: `CRUD remaining position 001 ${suffix}`,
        },
      }),
      prisma.position.create({
        data: {
          positionCode: `${prefixA}-POS-003`,
          companyId: companyAId,
          departmentId,
          title: `CRUD remaining position 003 ${suffix}`,
        },
      }),
    ]);
    remainingReadValues.set('departmentNextCode', `${prefixA}-DEPT-002`);
    remainingReadValues.set('positionNextCode', `${prefixA}-POS-002`);
    const employeeCountA = await prisma.employee.count({ where: { companyId: companyAId } });
    remainingReadValues.set(
      'employeeNextCode',
      `${prefixA}-EMP-${String(employeeCountA + 1).padStart(4, '0')}`,
    );

    // Company C is a true foreign-scope negative control and must stay outside
    // the actor's grants. The later adminOperationsCompany is different: it is
    // intentionally granted to this actor and therefore belongs in the exact
    // debt-summary query/audit scope even though it carries no seeded debt.
    const foreignGroup = await prisma.group.create({
      data: {
        code: `CEFG${suffix}`,
        name: `CRUD Evidence Foreign Group ${suffix}`,
      },
    });
    const companyC = await prisma.company.create({
      data: {
        groupId: foreignGroup.id,
        code: `CEC${suffix}`,
        name: `CRUD Evidence C ${suffix}`,
      },
    });
    const [intercompanyA, intercompanyForeign] = await Promise.all([
      prisma.interCompanyTransaction.create({
        data: {
          transactionNumber: `CE-REMAIN-A-${suffix}`,
          fromCompanyId: companyAId,
          toCompanyId: companyBId,
          transactionType: 'SERVICE_CHARGE',
          amount: new Prisma.Decimal('314159.26'),
          transactionDate: new Date('2031-01-01T00:00:00.000Z'),
          description: 'Deterministic in-scope intercompany read control',
          createdById: creatorUserId,
        },
      }),
      prisma.interCompanyTransaction.create({
        data: {
          transactionNumber: `CE-REMAIN-FOREIGN-${suffix}`,
          fromCompanyId: companyBId,
          toCompanyId: companyC.id,
          transactionType: 'SERVICE_CHARGE',
          amount: new Prisma.Decimal('271828.18'),
          transactionDate: new Date('2031-01-02T00:00:00.000Z'),
          description: 'Deterministic out-of-scope intercompany read control',
          createdById: groupReaderUserId,
        },
      }),
    ]);
    remainingReadValues.set('intercompanyId', intercompanyA.id);
    remainingReadValues.set('intercompanyForeignId', intercompanyForeign.id);

    const [dayReportA, dayReportB] = await Promise.all([
      prisma.mobilePosDayReport.create({
        data: {
          companyId: companyAId,
          divisionId: divisionAId,
          branchId: branchAId,
          branchName: `CRUD Branch A ${suffix}`,
          terminalId: randomUUID(),
          terminalCode: `CEDAY-A-${suffix}`,
          terminalName: `CRUD Day A ${suffix}`,
          repUserId: creatorUserId,
          repName: `CRUD Rep A ${suffix}`,
          businessDate: new Date('2031-02-01T00:00:00.000Z'),
          salesCount: 3,
          grossTotal: new Prisma.Decimal('111222.33'),
          itemsSoldQuantity: new Prisma.Decimal('4.5000'),
          byMethod: [{ paymentMethod: 'CASH', label: null, count: 3, amount: 111222.33 }],
          items: [],
          idempotencyKey: `crud-remaining-day-a-${suffix}`,
        },
      }),
      prisma.mobilePosDayReport.create({
        data: {
          companyId: companyBId,
          divisionId: divisionBId,
          branchId: branchBId,
          branchName: `CRUD Branch B ${suffix}`,
          terminalId: randomUUID(),
          terminalCode: `CEDAY-B-${suffix}`,
          terminalName: `CRUD Day B ${suffix}`,
          repUserId: groupReaderUserId,
          repName: `CRUD Rep B ${suffix}`,
          businessDate: new Date('2031-02-02T00:00:00.000Z'),
          salesCount: 5,
          grossTotal: new Prisma.Decimal('999888.77'),
          itemsSoldQuantity: new Prisma.Decimal('6.5000'),
          byMethod: [{ paymentMethod: 'CASH', label: null, count: 5, amount: 999888.77 }],
          items: [],
          idempotencyKey: `crud-remaining-day-b-${suffix}`,
        },
      }),
    ]);
    remainingReadValues.set('mobileDayReportA', dayReportA.id);
    remainingReadValues.set('mobileDayReportB', dayReportB.id);

    remainingReadValues.set(
      'notificationUnreadA',
      await prisma.notification.count({
        where: { recipientUserId: creatorUserId, status: 'UNREAD' },
      }),
    );
    remainingReadValues.set(
      'notificationUnreadB',
      await prisma.notification.count({
        where: { recipientUserId: posterUserId, status: 'UNREAD' },
      }),
    );

    const [categoryA, categoryB] = await Promise.all([
      prisma.recordBookExpenseCategory.create({
        data: { companyId: companyAId, name: `CRUD remaining category A ${suffix}` },
      }),
      prisma.recordBookExpenseCategory.create({
        data: { companyId: companyBId, name: `CRUD remaining category B ${suffix}` },
      }),
    ]);
    const [saleA, saleB] = await Promise.all([
      prisma.recordBookDailySale.create({
        data: {
          companyId: companyAId,
          divisionId: divisionAId,
          branchId: branchAId,
          recordDate: new Date('2031-03-01T00:00:00.000Z'),
          currency: 'GBP',
          totalSalesAmount: new Prisma.Decimal('1357911.13'),
          status: 'FINALIZED',
          finalizedById: creatorUserId,
          finalizedAt: new Date('2031-03-01T18:00:00.000Z'),
          createdById: creatorUserId,
        },
      }),
      prisma.recordBookDailySale.create({
        data: {
          companyId: companyBId,
          divisionId: divisionBId,
          branchId: branchBId,
          recordDate: new Date('2031-03-02T00:00:00.000Z'),
          currency: 'GBP',
          totalSalesAmount: new Prisma.Decimal('9753186.42'),
          status: 'FINALIZED',
          finalizedById: groupReaderUserId,
          finalizedAt: new Date('2031-03-02T18:00:00.000Z'),
          createdById: groupReaderUserId,
        },
      }),
    ]);
    await Promise.all([
      prisma.recordBookSaleReceipt.create({
        data: {
          dailySaleId: saleA.id,
          receiptType: 'CASH',
          amount: new Prisma.Decimal('1357911.13'),
        },
      }),
      prisma.recordBookSaleReceipt.create({
        data: {
          dailySaleId: saleB.id,
          receiptType: 'CASH',
          amount: new Prisma.Decimal('9753186.42'),
        },
      }),
      prisma.recordBookExpense.create({
        data: {
          companyId: companyAId,
          divisionId: divisionAId,
          branchId: branchAId,
          expenseCategoryId: categoryA.id,
          recordDate: new Date('2031-03-01T00:00:00.000Z'),
          currency: 'GBP',
          amount: new Prisma.Decimal('246802.24'),
          description: 'Deterministic company-A record-book expense',
          status: 'FINALIZED',
          finalizedById: creatorUserId,
          finalizedAt: new Date('2031-03-01T18:00:00.000Z'),
          createdById: creatorUserId,
        },
      }),
      prisma.recordBookExpense.create({
        data: {
          companyId: companyBId,
          divisionId: divisionBId,
          branchId: branchBId,
          expenseCategoryId: categoryB.id,
          recordDate: new Date('2031-03-02T00:00:00.000Z'),
          currency: 'GBP',
          amount: new Prisma.Decimal('864209.75'),
          description: 'Deterministic company-B record-book expense',
          status: 'FINALIZED',
          finalizedById: groupReaderUserId,
          finalizedAt: new Date('2031-03-02T18:00:00.000Z'),
          createdById: groupReaderUserId,
        },
      }),
    ]);
    remainingReadValues.set('recordBookSalesTotal', 1357911.13);
    remainingReadValues.set('recordBookCashTotal', 1357911.13);
    remainingReadValues.set('recordBookExpensesTotal', 246802.24);
    remainingReadValues.set('recordBookNetMovement', 1111108.89);
    remainingReadValues.set('recordBookSalesCount', 1);
    remainingReadValues.set('recordBookExpenseCount', 1);
    remainingReadValues.set('recordBookForeignSalesTotal', 9753186.42);

    const [balanceA, balanceB] = await Promise.all([
      prisma.customerPackageBalance.create({
        data: {
          companyId: companyAId,
          customerId: seededCustomerAId,
          quantityOwedByCustomer: new Prisma.Decimal('17.2500'),
          quantityOwedToCustomer: new Prisma.Decimal('0'),
          depositBalance: new Prisma.Decimal('4321.09'),
        },
      }),
      prisma.customerPackageBalance.create({
        data: {
          companyId: companyBId,
          customerId: seededCustomerBId,
          quantityOwedByCustomer: new Prisma.Decimal('29.7500'),
          quantityOwedToCustomer: new Prisma.Decimal('0'),
          depositBalance: new Prisma.Decimal('9876.54'),
        },
      }),
    ]);
    remainingReadValues.set('returnableBalanceA', balanceA.id);
    remainingReadValues.set('returnableBalanceB', balanceB.id);
    remainingReadValues.set('returnableQuantityA', 17.25);
    remainingReadValues.set('returnableDepositA', 4321.09);

    const profileAId = globalAdminReadValues.get('userSecurityProfileA');
    if (!profileAId) throw new Error('Remaining security controls require profile A.');
    await prisma.userSecurityProfile.update({
      where: { id: profileAId },
      data: { lockedUntil: new Date('2099-01-01T00:00:00.000Z'), twoFactorEnabled: true },
    });
    const securityEvent = await prisma.securityEvent.create({
      data: {
        eventNumber: `CRUD-REMAINING-SECURITY-${suffix}`,
        companyId: companyAId,
        userId: creatorUserId,
        eventType: 'SUSPICIOUS_ACTIVITY',
        severity: 'CRITICAL',
        description: `Deterministic remaining-read security event ${suffix}`,
        status: 'OPEN',
      },
    });
    remainingReadValues.set('securityEventId', securityEvent.id);
    remainingReadValues.set('securityCriticalSeverity', 'CRITICAL');
  }

  async function captureRemainingSecurityReadValues(): Promise<void> {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const [
      activeSessions,
      lockedAccounts,
      activeUsers,
      usersWithProfiles,
      twoFactorProfiles,
      roles,
      permissions,
      openEvents,
      openHighCritical,
      highCritical24h,
      refreshReuse24h,
      critical30Days,
      notificationUnreadA,
      notificationUnreadB,
    ] = await Promise.all([
      prisma.activeSession.count({ where: { status: 'ACTIVE' } }),
      prisma.userSecurityProfile.count({ where: { lockedUntil: { gt: now } } }),
      prisma.user.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
      prisma.userSecurityProfile.count(),
      prisma.userSecurityProfile.count({ where: { twoFactorEnabled: true } }),
      prisma.role.count(),
      prisma.permission.count(),
      prisma.securityEvent.count({ where: { status: 'OPEN' } }),
      prisma.securityEvent.count({
        where: { status: 'OPEN', severity: { in: ['HIGH', 'CRITICAL'] } },
      }),
      prisma.securityEvent.count({
        where: { createdAt: { gte: last24h }, severity: { in: ['HIGH', 'CRITICAL'] } },
      }),
      prisma.securityEvent.count({
        where: { createdAt: { gte: last24h }, eventType: 'SUSPICIOUS_ACTIVITY' },
      }),
      prisma.securityEvent.count({
        where: { createdAt: { gte: last30Days }, severity: 'CRITICAL' },
      }),
      prisma.notification.count({
        where: { recipientUserId: creatorUserId, status: 'UNREAD' },
      }),
      prisma.notification.count({
        where: { recipientUserId: posterUserId, status: 'UNREAD' },
      }),
    ]);
    remainingReadValues.set('securityActiveSessions', activeSessions);
    remainingReadValues.set('securityLockedAccounts', lockedAccounts);
    remainingReadValues.set('securityActiveUsers', activeUsers);
    remainingReadValues.set('securityUsersWithProfiles', usersWithProfiles);
    remainingReadValues.set('securityTwoFactorProfiles', twoFactorProfiles);
    remainingReadValues.set('securityRoles', roles);
    remainingReadValues.set('securityPermissions', permissions);
    remainingReadValues.set('securityOpenEvents', openEvents);
    remainingReadValues.set('securityOpenHighCritical', openHighCritical);
    remainingReadValues.set('securityHighCritical24h', highCritical24h);
    remainingReadValues.set('securityRefreshReuse24h', refreshReuse24h);
    remainingReadValues.set('securityCriticalCount', critical30Days);
    remainingReadValues.set('notificationUnreadA', notificationUnreadA);
    remainingReadValues.set('notificationUnreadB', notificationUnreadB);
  }

  async function refreshRemainingDebtAggregateBindings(): Promise<void> {
    const debtBase: Prisma.DebtWhereInput = { companyId: companyAId, deletedAt: null };
    const debtOutstanding: Prisma.DebtWhereInput = {
      ...debtBase,
      status: { in: ['OUTSTANDING', 'PARTIALLY_PAID'] },
    };
    const groupCompanyAccess = await prisma.userCompanyAccess.findMany({
      where: { userId: groupReaderUserId },
      select: { companyId: true },
      orderBy: { companyId: 'asc' },
    });
    const groupCompanyIds = [
      ...new Set([companyAId, ...groupCompanyAccess.map((entry) => entry.companyId)]),
    ].sort();
    const adminCompanyId = (
      mutationBindings.get('adminOperationsCompany') as { id?: unknown } | undefined
    )?.id;
    if (
      adminCompanyId !== undefined &&
      (typeof adminCompanyId !== 'string' || !groupCompanyIds.includes(adminCompanyId))
    ) {
      throw new Error(
        'Remaining debt group oracle must include the admin-operations company granted to its actor.',
      );
    }
    const [
      debtTotalCount,
      debtOutstandingCount,
      debtOverdueCount,
      debtHighRiskCount,
      debtTotal,
      debtOwed,
      groupOwed,
    ] = await Promise.all([
      prisma.debt.count({ where: debtBase }),
      prisma.debt.count({ where: debtOutstanding }),
      prisma.debt.count({ where: { ...debtOutstanding, dueDate: { lt: new Date() } } }),
      prisma.debt.count({
        where: { ...debtBase, riskLevel: { in: ['HIGH', 'CRITICAL'] } },
      }),
      prisma.debt.aggregate({ where: debtBase, _sum: { amount: true } }),
      prisma.debt.aggregate({
        where: debtOutstanding,
        _sum: { amount: true, amountPaid: true },
      }),
      prisma.debt.aggregate({
        where: {
          companyId: { in: groupCompanyIds },
          deletedAt: null,
          status: { in: ['OUTSTANDING', 'PARTIALLY_PAID'] },
        },
        _sum: { amount: true, amountPaid: true },
      }),
    ]);
    const debtOutstandingAmount = new Prisma.Decimal(debtOwed._sum?.amount ?? 0).minus(
      debtOwed._sum?.amountPaid ?? 0,
    );
    remainingReadValues.set('debtTotalCount', debtTotalCount);
    remainingReadValues.set('debtOutstandingCount', debtOutstandingCount);
    remainingReadValues.set('debtOverdueCount', debtOverdueCount);
    remainingReadValues.set('debtHighRiskCount', debtHighRiskCount);
    remainingReadValues.set('debtTotalAmount', Number(debtTotal._sum?.amount ?? 0));
    remainingReadValues.set('debtOutstandingAmount', Number(debtOutstandingAmount));
    remainingReadValues.set(
      'debtGroupOutstandingAmount',
      Number(
        new Prisma.Decimal(groupOwed._sum?.amount ?? 0).minus(groupOwed._sum?.amountPaid ?? 0),
      ),
    );
  }

  async function refreshDerivedCompanySummaryMutableBindings(): Promise<void> {
    const [customersA, activeProductsA] = await Promise.all([
      prisma.customer.count({ where: { companyId: companyAId, deletedAt: null } }),
      prisma.product.count({
        where: { companyId: companyAId, deletedAt: null, status: 'ACTIVE' },
      }),
    ]);
    derivedReportValues.set('companySummaryCustomerTotalA', customersA);
    derivedReportValues.set('companySummaryOperationsActiveProductsA', activeProductsA);
  }

  async function refreshRemainingDynamicBindings(): Promise<void> {
    await refreshRemainingDebtAggregateBindings();
    const [company, employeeCount] = await Promise.all([
      prisma.company.findUniqueOrThrow({
        where: { id: companyAId },
        select: { employeeCodePrefix: true },
      }),
      prisma.employee.count({ where: { companyId: companyAId } }),
    ]);
    if (!company.employeeCodePrefix) {
      throw new Error('Remaining next-code controls require company A employee prefix.');
    }
    remainingReadValues.set(
      'employeeNextCode',
      `${company.employeeCodePrefix}-EMP-${String(employeeCount + 1).padStart(4, '0')}`,
    );
  }

  async function seedFinalProductCategoryDeleteControl(): Promise<void> {
    const category = await prisma.productCategory.create({
      data: {
        companyId: companyAId,
        name: `CRUD Evidence Final Delete Category ${suffix}`,
      },
    });
    const [children, families, products, supplierLinks] = await Promise.all([
      prisma.productCategory.count({ where: { parentCategoryId: category.id, deletedAt: null } }),
      prisma.productFamily.count({ where: { categoryId: category.id, deletedAt: null } }),
      prisma.product.count({ where: { categoryId: category.id, deletedAt: null } }),
      prisma.supplierProductCategory.count({
        where: { productCategoryId: category.id, supplier: { deletedAt: null } },
      }),
    ]);
    if (children + families + products + supplierLinks !== 0) {
      throw new Error('Final product-category delete control was not dependency-free.');
    }
    mutationBindings.set('productCategoryDelete', category);
  }

  async function requiredRelationSeed(
    ownerModel: string,
    relationName: string,
    targetModel: string,
  ): Promise<Record<string, unknown>> {
    if (targetModel === 'Company' && relationName === 'toCompany') {
      return seededModels.get('CompanyB')!;
    }
    if (
      targetModel === 'User' &&
      (relationName === 'delegate' || relationName === 'delegateUser')
    ) {
      return seededModels.get('UserB')!;
    }
    const target = seededModels.get(targetModel) ?? (await seedModelRecord(targetModel));
    if (!target) {
      throw new Error(`Seed ${ownerModel}.${relationName} has no ${targetModel} target.`);
    }
    return target;
  }

  async function applyKnownSeedScalars(
    modelName: string,
    fieldNames: readonly string[],
    data: Record<string, unknown>,
  ) {
    const assign = (field: string, targetModel: string) => {
      const target = seededModels.get(targetModel);
      if (fieldNames.includes(field) && data[field] === undefined && target) {
        data[field] = target.id;
      }
    };

    assign('companyId', 'Company');
    assign('fromCompanyId', 'Company');
    assign('toCompanyId', 'CompanyB');
    assign('groupId', 'Group');
    assign('divisionId', 'Division');
    assign('branchId', 'Branch');
    assign('customerId', 'Customer');
    assign('productId', 'Product');
    assign('unitId', 'UnitOfMeasure');
    assign('cashAccountId', 'CashAccount');
    assign('fiscalYearId', 'FiscalYear');
    assign('accountingPeriodId', 'AccountingPeriod');

    if (modelName === 'FixedAsset') {
      const company = seededModels.get('Company');
      if (!company?.id) throw new Error('FixedAsset evidence seed requires company A.');
      data.ownershipLevel = 'COMPANY';
      data.companyId = company.id;
      data.groupId = null;
    }

    const modelForeignKeys: Record<string, string> = {
      supplierId: 'Supplier',
      purchaseOrderId: 'PurchaseOrder',
      loanDebtId: 'Loan',
    };
    for (const [field, targetModel] of Object.entries(modelForeignKeys)) {
      if (!fieldNames.includes(field) || data[field] !== undefined) continue;
      const target = await seedModelRecord(targetModel);
      data[field] = target.id;
    }

    // Cache reads intentionally filter expired rows. All other generated dates
    // are also kept in the future so a long evidence run cannot cross a boundary.
    if (modelName === 'CacheEntry') data.expiresAt = new Date('2099-12-31T23:59:59.999Z');
    if (modelName === 'Expense') data.status = 'APPROVED';
    if (modelName === 'SupplierOrderDraft') {
      // Seed a realistic, non-secret business document number. The generic
      // `${model}_${field}_${random}` seed resembles a high-entropy bearer
      // credential and the production DLP correctly redacts such opaque text.
      data.draftNumber = `SOD-CE-${suffix.slice(0, 12).toUpperCase()}`;
    }
    if (modelName === 'SyncCheckpoint') {
      const device = await seedModelRecord('DeviceRegistration');
      data.deviceId = device.id;
      data.companyId = seededModels.get('Company')?.id;
      data.entityType = 'Customer';
      data.lastSyncAt = new Date('2099-01-01T00:00:00.000Z');
    }
  }

  function requiredSeedScalar(
    modelName: string,
    fieldName: string,
    kind: string,
    fieldType: string,
  ): unknown {
    if (kind === 'enum') {
      const value = Prisma.dmmf.datamodel.enums.find((item) => item.name === fieldType)?.values[0]
        ?.name;
      if (!value) throw new Error(`Enum ${fieldType} has no value for ${modelName}.${fieldName}.`);
      return value;
    }
    if (fieldType === 'String') return `${modelName}_${fieldName}_${suffix}`;
    if (fieldType === 'Int' || fieldType === 'Float' || fieldType === 'Decimal') return 1;
    if (fieldType === 'BigInt') return BigInt(1);
    if (fieldType === 'Boolean') return false;
    if (fieldType === 'DateTime') return new Date('2099-01-01T00:00:00.000Z');
    if (fieldType === 'Json') return {};
    if (fieldType === 'Bytes') return Buffer.from(`crud-evidence-${suffix}`);
    throw new Error(`No safe seed scalar for ${modelName}.${fieldName} (${kind}/${fieldType}).`);
  }

  async function login(email: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: TEST_PASSWORD })
      .expect(200);
    return stringField(unwrapRecord(response.body), 'accessToken');
  }

  type MutationSnapshot = {
    model: string;
    id: string;
    record: Record<string, unknown>;
    /** Full action-boundary model snapshot used to prove a hard delete removed exactly one row. */
    modelRecords?: Record<string, unknown>[];
  };

  type JsonNullProvenance = Readonly<Record<string, 'DB_NULL' | 'JSON_NULL'>>;
  const mutationJsonNullProvenance = Symbol('mutationJsonNullProvenance');
  type ProvenancedMutationRecord = Record<string, unknown> & {
    [mutationJsonNullProvenance]?: JsonNullProvenance;
  };

  type MutationDelegate = {
    findFirst(args: {
      where: Record<string, unknown>;
      select?: Record<string, unknown>;
      include?: Record<string, unknown>;
    }): Promise<Record<string, unknown> | null>;
    findMany(args: {
      where: Record<string, unknown>;
      select?: Record<string, unknown>;
      include?: Record<string, unknown>;
    }): Promise<Record<string, unknown>[]>;
    create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<Record<string, unknown>>;
    delete(args: { where: { id: string } }): Promise<Record<string, unknown>>;
    deleteMany(args: { where: Record<string, unknown> }): Promise<{ count: number }>;
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };

  type CompoundScopeSnapshot = {
    contractId: string;
    model: string;
    scope: CrudMutationClosedScope;
    scopeRecords: Record<string, unknown>[];
    modelRecords: Record<string, unknown>[];
  };

  type CompoundEffectResult = {
    id?: string;
    record?: Record<string, unknown>;
  };

  type CompoundExecutionContext = {
    rowSnapshots: Map<string, MutationSnapshot>;
    scopeSnapshots: Map<string, CompoundScopeSnapshot>;
    modelSnapshots: Map<string, Record<string, unknown>[]>;
    effectResults: Map<string, CompoundEffectResult>;
  };

  type MutationGeneratedFieldContract =
    | Extract<CrudMutationAnyFixtureRegistration['effect'], { kind: 'create' }>
    | Extract<CrudMutationAnyFixtureRegistration['effect'], { kind: 'generated-transition' }>
    | Extract<CrudMutationCompoundNamedEffect, { kind: 'scoped-row-create' }>;

  type EntityCodeGeneratedSnapshot = {
    field: string;
    sequenceCode: string;
    before: MutationSnapshot | null;
  };

  type ScopedSequenceGeneratedSnapshot = {
    field: string;
    rows: Record<string, unknown>[];
  };

  type GeneratedFieldExecutionContext = {
    entityCodes: Map<string, EntityCodeGeneratedSnapshot>;
    scopedSequences: Map<string, ScopedSequenceGeneratedSnapshot>;
    domainAggregates: Map<string, IndependentDomainAggregateSnapshot>;
  };

  type IndependentDomainAggregateSnapshot = {
    source: Extract<CrudMutationGeneratedField, { kind: 'independent-domain-aggregate' }>['source'];
    value: unknown;
    sourceRowCount: number;
  };

  type MutationAuditRow = {
    id: string;
    action: string;
    entityType: string;
    entityId: string | null;
    userId: string | null;
    companyId: string | null;
    scopeKind: AuditScopeKind;
    attributionStatus: AuditAttributionStatus;
    companyScopes: readonly { companyId: string }[];
    oldValue: unknown;
    newValue: unknown;
    metadata: unknown;
    severity: AuditSeverity;
    agentSessionId: string | null;
    channel: AuditChannel;
    principalType: string | null;
    principalId: string | null;
    mandateId: string | null;
    initiatedByUserId: string | null;
    taskId: string | null;
    stepId: string | null;
    deviceId: string | null;
    createdAt: Date;
  };

  type MutationExecutionObservation = {
    result: InvocationResult;
    entityId: string;
    auditDelta: readonly MutationAuditRow[];
  };

  async function executeMutationEvidence(
    observedCapabilities: ReadonlySet<string> = new Set(),
  ): Promise<Map<string, MutationExecutionObservation>> {
    const fixtures = mutationEvidencePacksForManifest(manifest.capabilities()).flatMap(
      (pack) => pack.fixtures,
    );
    const ordered = [...fixtures].sort((left, right) => {
      const leftDelete = left.operation === 'delete' ? 1 : 0;
      const rightDelete = right.operation === 'delete' ? 1 : 0;
      return leftDelete - rightDelete || left.capabilityId.localeCompare(right.capabilityId);
    });

    const observations = new Map<string, MutationExecutionObservation>();
    for (const fixture of ordered) {
      const observation = await executeMutationFixture(
        fixture,
        observedCapabilities.has(fixture.capabilityId),
      );
      if (observation) observations.set(fixture.capabilityId, observation);
    }
    return observations;
  }

  async function executeMutationFixture(
    fixture: CrudMutationAnyFixtureRegistration,
    observeResult = false,
  ): Promise<MutationExecutionObservation | undefined> {
    // This is deliberately taken before pre-state setup. Restoration must undo
    // the controller effect, fixture preparation, audit rows, and every
    // secondary/child-table write before another fixture is allowed to run.
    const fullSchemaBefore = await databaseMutationSentinel();
    const principal = fixture.executionPrincipal ?? 'company';
    const token =
      principal === 'group'
        ? groupReaderToken
        : principal === 'poster'
          ? posterToken
          : creatorToken;
    const actorId =
      principal === 'group'
        ? groupReaderUserId
        : principal === 'poster'
          ? posterUserId
          : creatorUserId;
    const snapshots: MutationSnapshot[] = [];
    let createdId = '';
    let result: InvocationResult = {
      ok: false,
      status: 0,
      body: null,
      error: 'Mutation fixture did not reach HTTP dispatch.',
    };
    let startedAt = new Date();
    let finishedAt = startedAt;
    const assertions: CrudEvidenceAssertion[] = [];
    let preparationSucceeded = false;
    let actionSchemaBefore: Awaited<ReturnType<typeof databaseMutationSentinel>> | undefined;
    let auditDelta: MutationAuditRow[] = [];
    let effectEntityId = '';
    let compoundContext: CompoundExecutionContext | undefined;
    let generatedContext: GeneratedFieldExecutionContext | undefined;
    let singularActionTargetBefore: MutationSnapshot | undefined;
    let createTargetIdsBefore: ReadonlySet<string> | undefined;

    try {
      compoundContext = await prepareMutationFixture(fixture, actorId, snapshots);
      preparationSucceeded = true;
      generatedContext = await captureGeneratedFieldContext(fixture, actorId);
      singularActionTargetBefore = await captureSingularActionTarget(fixture, actorId);
      if (fixture.effect.kind === 'create') {
        createTargetIdsBefore = await mutationModelIds(fixture.effect.model);
      }
      const args = {
        ...(fixture.request.path
          ? { path: resolveMutationMap(fixture.request.path, fixture, actorId) }
          : {}),
        ...(fixture.request.query
          ? { query: resolveMutationMap(fixture.request.query, fixture, actorId) }
          : {}),
        ...(fixture.request.body
          ? { body: resolveMutationMap(fixture.request.body, fixture, actorId) }
          : {}),
      };
      actionSchemaBefore = await databaseMutationSentinel();
      const auditIdsBefore = new Set(
        (await prisma.auditLog.findMany({ select: { id: true } })).map((row) => row.id),
      );
      startedAt = new Date();
      result = await invokeMutationWithFixtureEnvironment(fixture, token, args);
      finishedAt = new Date();
      auditDelta = (
        await prisma.auditLog.findMany({
          select: {
            id: true,
            action: true,
            entityType: true,
            entityId: true,
            userId: true,
            companyId: true,
            scopeKind: true,
            attributionStatus: true,
            companyScopes: {
              select: { companyId: true },
              orderBy: { companyId: 'asc' },
            },
            oldValue: true,
            newValue: true,
            metadata: true,
            severity: true,
            agentSessionId: true,
            channel: true,
            principalType: true,
            principalId: true,
            mandateId: true,
            initiatedByUserId: true,
            taskId: true,
            stepId: true,
            deviceId: true,
            createdAt: true,
          },
        })
      ).filter((row) => !auditIdsBefore.has(row.id));
      const actionSchemaAfter = await databaseMutationSentinel();
      assertions.push(check('HTTP mutation returned 2xx', result.ok, statusDetail(result)));
      assertions.push(mutationTablePolicyAssertion(fixture, actionSchemaBefore, actionSchemaAfter));

      const effect = await mutationEffectAssertions(
        fixture,
        result,
        actorId,
        singularActionTargetBefore,
        compoundContext,
        generatedContext,
        startedAt,
        finishedAt,
      );
      effectEntityId = effect.entityId;
      createdId = effect.createdId;
      assertions.push(...effect.assertions);
      assertions.push(
        ...(await mutationAuditAssertions(
          fixture,
          actorId,
          effect.entityId,
          auditDelta,
          result,
          singularActionTargetBefore,
          compoundContext,
          startedAt,
          finishedAt,
        )),
      );
    } catch (error) {
      finishedAt = new Date();
      assertions.push(
        check(
          preparationSucceeded
            ? 'mutation assertion code completed'
            : 'mutation fixture prerequisites available',
          false,
          safeError(error),
        ),
      );
    }

    const recoveryErrors: string[] = [];
    if (fixture.effect.kind === 'compound' && compoundContext) {
      try {
        await recoverCompoundMutation(fixture.effect, compoundContext, fixture, actorId);
      } catch (error) {
        recoveryErrors.push(`compound recovery: ${safeError(error)}`);
      }
    } else if (fixture.effect.kind === 'create' && createTargetIdsBefore) {
      try {
        await cleanupNewMutationRecords(
          fixture.effect.model,
          createTargetIdsBefore,
          createdId || undefined,
        );
      } catch (error) {
        recoveryErrors.push(`created-row cleanup: ${safeError(error)}`);
      }
    }
    if (generatedContext) {
      try {
        await recoverGeneratedFieldContext(generatedContext);
      } catch (error) {
        recoveryErrors.push(`generated-field recovery: ${safeError(error)}`);
      }
    }
    try {
      await restoreMutationSnapshots(snapshots);
    } catch (error) {
      recoveryErrors.push(`target restoration: ${safeError(error)}`);
    }
    try {
      if (auditDelta.length > 0) {
        await deleteAuditLogsForTest(prisma, {
          id: { in: auditDelta.map((row) => row.id) },
        });
      }
    } catch (error) {
      recoveryErrors.push(`audit cleanup: ${safeError(error)}`);
    }

    let schemaRecoveryDetail: string | undefined;
    try {
      const fullSchemaAfter = await databaseMutationSentinel();
      if (JSON.stringify(fullSchemaBefore) !== JSON.stringify(fullSchemaAfter)) {
        schemaRecoveryDetail = databaseMutationDetail(fullSchemaBefore, fullSchemaAfter);
        recoveryErrors.push(`whole-schema drift: ${schemaRecoveryDetail}`);
      }
    } catch (error) {
      schemaRecoveryDetail = `whole-schema verification failed: ${safeError(error)}`;
      recoveryErrors.push(schemaRecoveryDetail);
    }
    assertions.push(
      check(
        'entire disposable schema restored after mutation fixture',
        recoveryErrors.length === 0,
        recoveryErrors.join('; ') || schemaRecoveryDetail,
      ),
    );
    addCase(fixture.fixtureId, 'positive', result, assertions);

    if (recoveryErrors.length > 0) {
      throw new Error(
        `Mutation fixture recovery failed for ${fixture.capabilityId}: ${recoveryErrors.join('; ')}`,
      );
    }
    return observeResult
      ? {
          result,
          entityId: effectEntityId,
          auditDelta: auditDelta.map((row) => ({ ...row })),
        }
      : undefined;
  }

  async function invokeMutationWithFixtureEnvironment(
    fixture: CrudMutationAnyFixtureRegistration,
    token: string,
    args: { path?: Record<string, unknown>; query?: Record<string, unknown>; body?: unknown },
  ): Promise<InvocationResult> {
    const previousTaxAutoApply = process.env.TAX_AUTO_APPLY;
    if (fixture.testEnvironment?.TAX_AUTO_APPLY) {
      process.env.TAX_AUTO_APPLY = fixture.testEnvironment.TAX_AUTO_APPLY;
    }
    try {
      return await invoke(fixture.capabilityId, token, args);
    } finally {
      if (previousTaxAutoApply === undefined) delete process.env.TAX_AUTO_APPLY;
      else process.env.TAX_AUTO_APPLY = previousTaxAutoApply;
    }
  }

  async function prepareMutationFixture(
    fixture: CrudMutationAnyFixtureRegistration,
    actorId: string,
    snapshots: MutationSnapshot[],
  ): Promise<CompoundExecutionContext | undefined> {
    for (const model of fixture.setupModels ?? []) await seedModelRecord(model);

    const snapshot = async (model: string, idValue: CrudMutationValue) => {
      const id = String(resolveMutationValue(idValue, fixture, actorId));
      if (snapshots.some((item) => item.model === model && item.id === id)) return;
      const record = await readMutationRecord(model, id);
      if (!record) throw new Error(`Mutation target ${model}/${id} is absent before execution.`);
      snapshots.push({ model, id, record });
    };

    if (fixture.target) await snapshot(fixture.target.model, fixture.target.id);
    if (
      fixture.effect.kind !== 'create' &&
      fixture.effect.kind !== 'compound' &&
      fixture.effect.kind !== 'audit-only'
    ) {
      await snapshot(fixture.effect.model, fixture.effect.id);
    }
    for (const preState of mutationPreStates(fixture)) {
      await snapshot(preState.model, preState.id);
      const id = String(resolveMutationValue(preState.id, fixture, actorId));
      await mutationDelegate(preState.model).update({
        where: { id },
        data: resolveMutationMap(preState.fields, fixture, actorId),
      });
    }
    await assertMutationFixturePreDispatchInvariants(fixture);
    if (fixture.effect.kind !== 'compound') return undefined;

    const context: CompoundExecutionContext = {
      rowSnapshots: new Map(),
      scopeSnapshots: new Map(),
      modelSnapshots: new Map(),
      effectResults: new Map(),
    };
    for (const model of crudMutationBusinessDeltaModels(fixture.effect)) {
      const records = await mutationDelegate(model).findMany({
        where: includingSoftDeletedWhere(model),
      });
      await attachJsonNullProvenance(model, records);
      context.modelSnapshots.set(model, records);
    }
    const allEffects = [
      ...fixture.effect.effects,
      ...(fixture.effect.allowedTableExceptions ?? []).map((exception) => exception.effect),
    ];
    for (const effect of allEffects) {
      if (effect.kind === 'row-update' || effect.kind === 'row-delete') {
        const id = String(resolveMutationValue(effect.id, fixture, actorId));
        const record = await readMutationRecord(effect.model, id, true);
        if (!record) {
          throw new Error(
            `Compound effect ${effect.effectId} target ${effect.model}/${id} is absent.`,
          );
        }
        context.rowSnapshots.set(effect.effectId, { model: effect.model, id, record });
      } else if (
        effect.kind === 'scoped-row-create' ||
        effect.kind === 'count-delta' ||
        effect.kind === 'set-delta'
      ) {
        context.scopeSnapshots.set(
          effect.effectId,
          await captureCompoundScope(
            effect.effectId,
            effect.model,
            effect.scope,
            fixture,
            actorId,
            context.modelSnapshots.get(effect.model) ?? [],
          ),
        );
      }
    }
    return context;
  }

  async function assertMutationFixturePreDispatchInvariants(
    fixture: CrudMutationAnyFixtureRegistration,
  ): Promise<void> {
    if (fixture.capabilityId !== 'PayrollRunsController.calculate') return;

    const target = mutationBindings.get('autonomyPayrollCalculateEmployee');
    const runBinding = mutationBindings.get('autonomyPayrollCalculateRun');
    if (!isRecord(target) || !isRecord(runBinding)) {
      throw new Error('Autonomy payroll pre-dispatch check requires its dedicated bindings.');
    }
    const targetId = requiredEvidenceString(target.id, 'autonomy payroll target employee id');
    const runId = requiredEvidenceString(runBinding.id, 'autonomy payroll run id');
    const run = await prisma.payrollRun.findUnique({
      where: { id: runId },
      select: { companyId: true },
    });
    if (!run) throw new Error(`Autonomy payroll run ${runId} disappeared before dispatch.`);

    // Mirror PayrollRunsService.calculate after fixture prestates have been
    // applied. The action must see one employee, not merely one row in the
    // evidence selector; whole-model reconciliation remains responsible for
    // rejecting any undeclared entry created outside that selector.
    const activeEmployees = await prisma.employee.findMany({
      where: { companyId: run.companyId, employmentStatus: 'ACTIVE', deletedAt: null },
      select: { id: true, employeeCode: true },
      orderBy: { id: 'asc' },
    });
    if (activeEmployees.length !== 1 || activeEmployees[0].id !== targetId) {
      throw new Error(
        `Autonomy payroll prestates must leave exactly target ${targetId} active; observed ${
          activeEmployees
            .map((employee) => `${employee.id}:${employee.employeeCode ?? ''}`)
            .join(', ') || 'none'
        }.`,
      );
    }

    const existingEntries = await prisma.payrollEntry.findMany({
      where: { payrollRunId: runId },
      select: { id: true, employeeId: true, deletedAt: true },
      orderBy: { id: 'asc' },
    });
    if (existingEntries.length !== 0) {
      throw new Error(
        `Autonomy payroll entry scope must be empty immediately before dispatch; observed ${existingEntries
          .map(
            (entry) =>
              `${entry.id}:${entry.employeeId}:${entry.deletedAt?.toISOString() ?? 'live'}`,
          )
          .join(', ')}.`,
      );
    }
  }

  function mutationPreStates(fixture: CrudMutationAnyFixtureRegistration) {
    return [...(fixture.preState ? [fixture.preState] : []), ...(fixture.preStates ?? [])];
  }

  async function captureGeneratedFieldContext(
    fixture: CrudMutationAnyFixtureRegistration,
    actorId: string,
  ): Promise<GeneratedFieldExecutionContext | undefined> {
    const contracts =
      fixture.effect.kind === 'create' || fixture.effect.kind === 'generated-transition'
        ? [
            {
              contractId: 'primary',
              model: fixture.effect.model,
              generatedFields: fixture.effect.generatedFields,
            },
          ]
        : fixture.effect.kind === 'compound'
          ? [
              ...fixture.effect.effects,
              ...(fixture.effect.allowedTableExceptions ?? []).map((exception) => exception.effect),
            ]
              .filter(
                (
                  effect,
                ): effect is Extract<
                  CrudMutationCompoundNamedEffect,
                  { kind: 'scoped-row-create' }
                > => effect.kind === 'scoped-row-create',
              )
              .map((effect) => ({
                contractId: effect.effectId,
                model: effect.model,
                generatedFields: effect.generatedFields,
              }))
          : [];
    if (contracts.length === 0) return undefined;
    const context: GeneratedFieldExecutionContext = {
      entityCodes: new Map(),
      scopedSequences: new Map(),
      domainAggregates: new Map(),
    };
    for (const contract of contracts) {
      for (const [field, validator] of Object.entries(contract.generatedFields)) {
        const contextKey = generatedFieldContextKey(contract.contractId, field);
        if (validator.kind === 'entity-code') {
          const companyId = validator.companyId
            ? String(resolveMutationValue(validator.companyId, fixture, actorId))
            : null;
          const sequenceCode = `${validator.entityType}_${companyId ?? 'GLOBAL'}`;
          const record = await mutationDelegate('DocumentNumberSequence').findFirst({
            where: { sequenceCode },
          });
          if (record) await attachJsonNullProvenance('DocumentNumberSequence', [record]);
          context.entityCodes.set(contextKey, {
            field: contextKey,
            sequenceCode,
            before: isRecord(record)
              ? {
                  model: 'DocumentNumberSequence',
                  id: String(record.id),
                  record,
                }
              : null,
          });
        } else if (validator.kind === 'scoped-sequence-id') {
          const rows = await mutationDelegate(contract.model).findMany({
            where: resolveMutationMap(validator.scope, fixture, actorId),
          });
          context.scopedSequences.set(contextKey, {
            field: contextKey,
            rows: rows.filter(isRecord),
          });
        } else if (
          validator.kind === 'independent-domain-aggregate' &&
          !context.domainAggregates.has(validator.source)
        ) {
          context.domainAggregates.set(
            validator.source,
            await captureIndependentDomainAggregate(validator.source, fixture, actorId),
          );
        }
      }
    }
    return context.entityCodes.size || context.scopedSequences.size || context.domainAggregates.size
      ? context
      : undefined;
  }

  function generatedFieldContextKey(contractId: string, field: string): string {
    return `${contractId}\u001f${field}`;
  }

  async function captureIndependentDomainAggregate(
    source: IndependentDomainAggregateSnapshot['source'],
    fixture: CrudMutationAnyFixtureRegistration,
    actorId: string,
  ): Promise<IndependentDomainAggregateSnapshot> {
    const body = resolveMutationMap(fixture.request.body ?? {}, fixture, actorId);
    const companyId = requiredEvidenceString(body.companyId, `${source}.companyId`);
    const periodStart = requiredEvidenceDate(body.periodStart, `${source}.periodStart`);
    const periodEnd = requiredEvidenceDate(body.periodEnd, `${source}.periodEnd`);

    if (source === 'customer-statement') {
      if (typeof body.periodEnd === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.periodEnd)) {
        periodEnd.setUTCHours(23, 59, 59, 999);
      }
      const customerId = optionalEvidenceString(body.customerId, `${source}.customerId`);
      const scope = {
        companyId,
        currency: optionalEvidenceString(body.currency, `${source}.currency`) ?? 'TZS',
        ...(customerId ? { customerId } : {}),
      };
      const [receivables, payments, creditNotes, refunds] = await Promise.all([
        mutationDelegate('Receivable').findMany({
          where: {
            ...scope,
            deletedAt: null,
            status: { notIn: ['WRITTEN_OFF', 'CANCELLED'] },
            issueDate: { lte: periodEnd },
          },
          select: { amount: true, issueDate: true },
        }),
        mutationDelegate('CustomerPayment').findMany({
          where: {
            ...scope,
            deletedAt: null,
            status: 'COMPLETED',
            paymentDate: { lte: periodEnd },
          },
          select: { amount: true, paymentDate: true },
        }),
        mutationDelegate('CreditNote').findMany({
          where: {
            ...scope,
            deletedAt: null,
            status: 'ISSUED',
            issueDate: { lte: periodEnd },
          },
          select: { totalAmount: true, issueDate: true },
        }),
        mutationDelegate('Refund').findMany({
          where: {
            ...scope,
            deletedAt: null,
            status: 'PAID',
            refundDate: { lte: periodEnd },
          },
          select: { amount: true, refundDate: true },
        }),
      ]);
      const zero = new Prisma.Decimal(0);
      const deltas = [
        ...receivables.map((row: Record<string, unknown>) => ({
          date: requiredEvidenceDate(row.issueDate, 'Receivable.issueDate'),
          debit: evidenceDecimal(row.amount),
          credit: zero,
        })),
        ...payments.map((row: Record<string, unknown>) => ({
          date: requiredEvidenceDate(row.paymentDate, 'CustomerPayment.paymentDate'),
          debit: zero,
          credit: evidenceDecimal(row.amount),
        })),
        ...creditNotes.map((row: Record<string, unknown>) => ({
          date: requiredEvidenceDate(row.issueDate, 'CreditNote.issueDate'),
          debit: zero,
          credit: evidenceDecimal(row.totalAmount),
        })),
        ...refunds.map((row: Record<string, unknown>) => ({
          date: requiredEvidenceDate(row.refundDate, 'Refund.refundDate'),
          debit: evidenceDecimal(row.amount),
          credit: zero,
        })),
      ];
      let openingBalance = zero;
      let totalDebits = zero;
      let totalCredits = zero;
      for (const delta of deltas) {
        if (delta.date < periodStart) {
          openingBalance = openingBalance.plus(delta.debit).minus(delta.credit);
        } else {
          totalDebits = totalDebits.plus(delta.debit);
          totalCredits = totalCredits.plus(delta.credit);
        }
      }
      return {
        source,
        sourceRowCount: deltas.length,
        value: {
          openingBalance,
          totalDebits,
          totalCredits,
          closingBalance: openingBalance.plus(totalDebits).minus(totalCredits),
        },
      };
    }

    if (source === 'supplier-statement') {
      const supplierId = optionalEvidenceString(body.supplierId, `${source}.supplierId`);
      const payables = await mutationDelegate('Payable').findMany({
        where: {
          companyId,
          currency: optionalEvidenceString(body.currency, `${source}.currency`) ?? 'TZS',
          ...(supplierId ? { supplierId } : {}),
          deletedAt: null,
          status: { notIn: ['WRITTEN_OFF', 'CANCELLED'] },
          issueDate: { lte: periodEnd },
        },
        select: { amount: true, paidAmount: true, issueDate: true },
      });
      let openingBalance = new Prisma.Decimal(0);
      let totalDebits = new Prisma.Decimal(0);
      let totalCredits = new Prisma.Decimal(0);
      for (const row of payables as Record<string, unknown>[]) {
        const amount = evidenceDecimal(row.amount);
        const paid = evidenceDecimal(row.paidAmount);
        if (requiredEvidenceDate(row.issueDate, 'Payable.issueDate') < periodStart) {
          openingBalance = openingBalance.plus(amount).minus(paid);
        } else {
          totalDebits = totalDebits.plus(amount);
          totalCredits = totalCredits.plus(paid);
        }
      }
      return {
        source,
        sourceRowCount: payables.length,
        value: {
          openingBalance,
          totalDebits,
          totalCredits,
          closingBalance: openingBalance.plus(totalDebits).minus(totalCredits),
        },
      };
    }

    if (body.statementType !== 'TRIAL_BALANCE') {
      throw new Error(
        `Independent financial aggregate only admits TRIAL_BALANCE, got ${safeComparable(body.statementType)}`,
      );
    }
    const lines = await mutationDelegate('JournalEntryLine').findMany({
      where: {
        companyId,
        journalEntry: {
          companyId,
          status: { in: ['POSTED', 'REVERSED'] },
          deletedAt: null,
          transactionDate: { gte: periodStart, lte: periodEnd },
        },
      },
      include: {
        account: {
          select: { id: true, accountCode: true, accountName: true, accountType: true },
        },
      },
    });
    const accounts = new Map<
      string,
      {
        account: Record<string, unknown>;
        debit: number;
        credit: number;
        journalEntryIds: Set<string>;
      }
    >();
    for (const line of lines as Record<string, unknown>[]) {
      const accountId = requiredEvidenceString(line.accountId, 'JournalEntryLine.accountId');
      if (!isRecord(line.account)) throw new Error('JournalEntryLine.account is unavailable');
      const aggregate = accounts.get(accountId) ?? {
        account: line.account,
        debit: 0,
        credit: 0,
        journalEntryIds: new Set<string>(),
      };
      aggregate.debit += Number(line.debit);
      aggregate.credit += Number(line.credit);
      aggregate.journalEntryIds.add(
        requiredEvidenceString(line.journalEntryId, 'JournalEntryLine.journalEntryId'),
      );
      accounts.set(accountId, aggregate);
    }
    const rows = [...accounts.values()]
      .map((aggregate) => ({
        account: aggregate.account,
        debit: aggregate.debit,
        credit: aggregate.credit,
        balance: aggregate.debit - aggregate.credit,
        journalEntryIds: [...aggregate.journalEntryIds].sort(),
      }))
      .sort((left, right) =>
        String(left.account.accountCode).localeCompare(String(right.account.accountCode)),
      );
    return {
      source,
      sourceRowCount: lines.length,
      value: {
        companyId,
        divisionId: null,
        branchId: null,
        rows,
        totalDebit: rows.reduce((sum, row) => sum + row.debit, 0),
        totalCredit: rows.reduce((sum, row) => sum + row.credit, 0),
      },
    };
  }

  function independentDomainAggregateMatches(
    field: string,
    actual: unknown,
    source: IndependentDomainAggregateSnapshot['source'],
    response: Record<string, unknown>,
    context: GeneratedFieldExecutionContext | undefined,
  ): { ok: boolean; detail?: string } {
    const snapshot = context?.domainAggregates.get(source);
    if (!snapshot || !isRecord(snapshot.value)) {
      return { ok: false, detail: `pre-action ${source} source snapshot is missing` };
    }
    if (source === 'financial-trial-balance') {
      const expected = normalizeTrialBalanceEvidence(snapshot.value);
      const persisted = normalizeTrialBalanceEvidence(actual);
      const returnedResult = normalizeTrialBalanceEvidence(readUnknownPath(response, ['result']));
      const returnedRun = normalizeTrialBalanceEvidence(
        readUnknownPath(response, ['run', 'resultSummary']),
      );
      const ok =
        expected !== null &&
        persisted !== null &&
        returnedResult !== null &&
        returnedRun !== null &&
        databaseValueEqual(persisted, expected) &&
        databaseValueEqual(returnedResult, expected) &&
        databaseValueEqual(returnedRun, expected);
      return {
        ok,
        detail: ok
          ? undefined
          : `trial balance differed from ${snapshot.sourceRowCount} captured journal lines`,
      };
    }
    const expected = snapshot.value[field];
    const returned = response[field];
    const ok =
      expected !== undefined &&
      returned !== undefined &&
      databaseValueEqual(actual, expected) &&
      databaseValueEqual(returned, expected);
    return {
      ok,
      detail: ok
        ? undefined
        : `${field} differed from ${snapshot.sourceRowCount} captured ${source} source rows`,
    };
  }

  function normalizeTrialBalanceEvidence(value: unknown): Record<string, unknown> | null {
    if (
      !isRecord(value) ||
      !hasExactKeys(value, [
        'branchId',
        'companyId',
        'divisionId',
        'rows',
        'totalCredit',
        'totalDebit',
      ]) ||
      !Array.isArray(value.rows)
    ) {
      return null;
    }
    const rows: Record<string, unknown>[] = [];
    for (const candidate of value.rows) {
      if (
        !isRecord(candidate) ||
        !hasExactKeys(candidate, ['account', 'balance', 'credit', 'debit', 'journalEntryIds']) ||
        !isRecord(candidate.account) ||
        !hasExactKeys(candidate.account, ['accountCode', 'accountName', 'accountType', 'id']) ||
        !Array.isArray(candidate.journalEntryIds) ||
        !candidate.journalEntryIds.every((id) => typeof id === 'string')
      ) {
        return null;
      }
      const debit = Number(candidate.debit);
      const credit = Number(candidate.credit);
      const balance = Number(candidate.balance);
      if (![debit, credit, balance].every(Number.isFinite)) return null;
      rows.push({
        account: candidate.account,
        debit,
        credit,
        balance,
        journalEntryIds: [...new Set(candidate.journalEntryIds)].sort(),
      });
    }
    rows.sort((left, right) =>
      String((left.account as Record<string, unknown>).accountCode).localeCompare(
        String((right.account as Record<string, unknown>).accountCode),
      ),
    );
    const totalDebit = Number(value.totalDebit);
    const totalCredit = Number(value.totalCredit);
    if (!Number.isFinite(totalDebit) || !Number.isFinite(totalCredit)) return null;
    return {
      companyId: value.companyId,
      divisionId: value.divisionId,
      branchId: value.branchId,
      rows,
      totalDebit,
      totalCredit,
    };
  }

  function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
    return Object.keys(value).sort().join('\0') === [...expected].sort().join('\0');
  }

  function requiredEvidenceString(value: unknown, label: string): string {
    if (typeof value !== 'string' || !value) throw new Error(`${label} is not a string`);
    return value;
  }

  function optionalEvidenceString(value: unknown, label: string): string | undefined {
    if (value == null) return undefined;
    return requiredEvidenceString(value, label);
  }

  function requiredEvidenceDate(value: unknown, label: string): Date {
    const date = value instanceof Date ? new Date(value) : new Date(String(value));
    if (!Number.isFinite(date.getTime())) throw new Error(`${label} is not a valid date`);
    return date;
  }

  function evidenceDecimal(value: unknown): Prisma.Decimal {
    return new Prisma.Decimal(value == null ? 0 : String(value));
  }

  async function recoverGeneratedFieldContext(
    context: GeneratedFieldExecutionContext,
  ): Promise<void> {
    const errors: string[] = [];
    for (const snapshot of context.entityCodes.values()) {
      try {
        if (snapshot.before) {
          await restoreMutationSnapshot(snapshot.before);
        } else {
          const sequence = await mutationDelegate('DocumentNumberSequence').findFirst({
            where: includingSoftDeletedWhere('DocumentNumberSequence', {
              sequenceCode: snapshot.sequenceCode,
            }),
          });
          if (sequence) {
            await physicallyDeleteMutationRecord('DocumentNumberSequence', {
              id: requiredEvidenceString(sequence.id, 'DocumentNumberSequence.id during recovery'),
            });
          }
          const remaining = await mutationDelegate('DocumentNumberSequence').findFirst({
            where: includingSoftDeletedWhere('DocumentNumberSequence', {
              sequenceCode: snapshot.sequenceCode,
            }),
          });
          if (remaining)
            throw new Error(`sequence ${snapshot.sequenceCode} remained after cleanup`);
        }
      } catch (error) {
        errors.push(`${snapshot.field}: ${safeError(error)}`);
      }
    }
    if (errors.length) throw new Error(errors.join('; '));
  }

  async function mutationEffectAssertions(
    fixture: CrudMutationAnyFixtureRegistration,
    result: InvocationResult,
    actorId: string,
    singularActionTargetBefore: MutationSnapshot | undefined,
    compoundContext: CompoundExecutionContext | undefined,
    generatedContext: GeneratedFieldExecutionContext | undefined,
    startedAt: Date,
    finishedAt: Date,
  ): Promise<{ assertions: CrudEvidenceAssertion[]; createdId: string; entityId: string }> {
    const effect = fixture.effect;
    if (effect.kind === 'audit-only') {
      return {
        assertions: [
          check(
            'audit-only command changed no business model',
            result.ok,
            result.ok ? undefined : statusDetail(result),
          ),
        ],
        createdId: '',
        entityId: String(resolveMutationValue(effect.auditEntityId, fixture, actorId)),
      };
    }
    if (effect.kind === 'compound') {
      if (!compoundContext) throw new Error('Compound effect context was not prepared.');
      return compoundMutationEffectAssertions(
        fixture,
        effect,
        result,
        actorId,
        compoundContext,
        generatedContext,
        startedAt,
        finishedAt,
      );
    }
    const assertions: CrudEvidenceAssertion[] = [];
    let createdId = '';
    let entityId = '';

    if (effect.kind === 'create') {
      const response = unwrapRecord(result.body);
      const responseId = readUnknownPath(response, effect.responseIdPath);
      createdId = typeof responseId === 'string' ? responseId : '';
      entityId = createdId;
      const persisted = createdId ? await readMutationRecord(effect.model, createdId) : null;
      assertions.push(
        check('create response contains the exact persisted id', Boolean(createdId && persisted)),
      );
      const createMismatches: string[] = [];
      for (const [field, expected] of Object.entries(effect.expectedFields)) {
        const actual = persisted?.[field];
        if (!mutationValueMatches(actual, expected, fixture, actorId, startedAt, finishedAt)) {
          createMismatches.push(`${field}=${safeComparable(actual)}`);
        }
      }
      assertions.push(
        check(
          'created row matches every declared business field',
          createMismatches.length === 0,
          createMismatches.length ? `mismatches: ${createMismatches.join(', ')}` : undefined,
        ),
      );
      assertions.push(
        ...(await generatedCreateFieldAssertions(
          effect,
          'primary',
          persisted,
          response,
          fixture,
          actorId,
          generatedContext,
          startedAt,
          finishedAt,
        )),
      );
      assertions.push(
        createMutationFieldClosureAssertion(
          effect,
          persisted,
          createdId,
          fixture,
          actorId,
          startedAt,
          finishedAt,
        ),
      );
      if (effect.companyPath) {
        assertions.push(
          check(
            'created row belongs to the executing company',
            readUnknownPath(persisted, effect.companyPath) === companyAId,
          ),
        );
      }
      return { assertions, createdId, entityId };
    }

    entityId = String(resolveMutationValue(effect.id, fixture, actorId));
    if (effect.kind === 'delete') {
      const deleted = await readMutationRecord(effect.model, entityId, true);
      const deletedAt = deleted
        ? readUnknownPath(deleted, effect.deletedAtPath ?? ['deletedAt'])
        : undefined;
      assertions.push(
        check(
          effect.mode === 'soft'
            ? 'target row is soft deleted'
            : 'target row is permanently deleted',
          effect.mode === 'soft' ? Boolean(deletedAt) : deleted === null,
        ),
      );
      if (effect.mode === 'soft') {
        const deleteMismatches: string[] = [];
        for (const [field, expected] of Object.entries(effect.expectedFields)) {
          const actual = deleted?.[field];
          if (!mutationValueMatches(actual, expected, fixture, actorId, startedAt, finishedAt)) {
            deleteMismatches.push(`${field}=${safeComparable(actual)}`);
          }
        }
        assertions.push(
          check(
            'soft-deleted row matches every declared effect field',
            deleteMismatches.length === 0,
            deleteMismatches.length ? `mismatches: ${deleteMismatches.join(', ')}` : undefined,
          ),
        );
        assertions.push(
          singularMutationDeltaAssertion(
            effect,
            singularActionTargetBefore,
            deleted,
            startedAt,
            finishedAt,
          ),
        );
      } else {
        const hardDeleteMismatches: string[] = [];
        for (const [field, expected] of Object.entries(effect.expectedFields)) {
          const actual = singularActionTargetBefore?.record[field];
          if (!mutationValueMatches(actual, expected, fixture, actorId, startedAt, finishedAt)) {
            hardDeleteMismatches.push(`${field}=${safeComparable(actual)}`);
          }
        }
        assertions.push(
          check(
            'hard-delete target matched every declared pre-action field',
            hardDeleteMismatches.length === 0,
            hardDeleteMismatches.length
              ? `mismatches: ${hardDeleteMismatches.join(', ')}`
              : undefined,
          ),
        );
        assertions.push(await singularHardDeleteDeltaAssertion(effect, singularActionTargetBefore));
      }
      return { assertions, createdId, entityId };
    }

    const persisted = await readMutationRecord(effect.model, entityId);
    assertions.push(check('mutation target still exists', Boolean(persisted)));
    const mismatches: string[] = [];
    for (const [field, expected] of Object.entries(effect.expectedFields)) {
      const actual = persisted?.[field];
      if (!mutationValueMatches(actual, expected, fixture, actorId, startedAt, finishedAt)) {
        mismatches.push(`${field}=${safeComparable(actual)}`);
      }
    }
    assertions.push(
      check(
        'persisted target matches every declared effect field',
        mismatches.length === 0,
        mismatches.length ? `mismatches: ${mismatches.join(', ')}` : undefined,
      ),
    );
    if (effect.kind === 'generated-transition') {
      assertions.push(
        ...(await generatedCreateFieldAssertions(
          effect,
          'primary',
          persisted,
          unwrapRecord(result.body),
          fixture,
          actorId,
          generatedContext,
          startedAt,
          finishedAt,
          'transitioned row',
        )),
      );
    }
    assertions.push(
      singularMutationDeltaAssertion(
        effect,
        singularActionTargetBefore,
        persisted,
        startedAt,
        finishedAt,
      ),
    );
    if (
      (effect.kind === 'transition' || effect.kind === 'generated-transition') &&
      effect.forbiddenFields?.length
    ) {
      const before = singularActionTargetBefore;
      const changed = effect.forbiddenFields.filter(
        (field) => !comparableEqual(before?.record[field], persisted?.[field]),
      );
      assertions.push(
        check(
          'forbidden fields remained unchanged',
          changed.length === 0,
          changed.length ? `changed: ${changed.join(', ')}` : undefined,
        ),
      );
    }
    return { assertions, createdId, entityId };
  }

  async function captureSingularActionTarget(
    fixture: CrudMutationAnyFixtureRegistration,
    actorId: string,
  ): Promise<MutationSnapshot | undefined> {
    const effect = fixture.effect;
    if (effect.kind === 'create' || effect.kind === 'compound' || effect.kind === 'audit-only') {
      return undefined;
    }
    const id = String(resolveMutationValue(effect.id, fixture, actorId));
    const record = await readMutationRecord(effect.model, id, true);
    if (!record) throw new Error(`Mutation action target ${effect.model}/${id} is absent.`);
    if (effect.kind !== 'delete' || effect.mode !== 'hard') {
      return { model: effect.model, id, record };
    }
    const modelRecords = await mutationDelegate(effect.model).findMany({
      where: includingSoftDeletedWhere(effect.model),
    });
    await attachJsonNullProvenance(effect.model, modelRecords);
    return { model: effect.model, id, record, modelRecords };
  }

  async function singularHardDeleteDeltaAssertion(
    effect: Extract<CrudMutationAnyFixtureRegistration['effect'], { kind: 'delete' }>,
    before: MutationSnapshot | undefined,
  ): Promise<CrudEvidenceAssertion> {
    if (!before?.modelRecords || before.model !== effect.model) {
      return check(
        'hard delete removed exactly the declared row and caused no same-model collateral delta',
        false,
        'the full pre-action model snapshot is unavailable',
      );
    }
    const after = await mutationDelegate(effect.model).findMany({
      where: includingSoftDeletedWhere(effect.model),
    });
    await attachJsonNullProvenance(effect.model, after);
    const primaryFields = prismaPrimaryIdentityFields(effect.model);
    const scalarFields = prismaScalarFieldNames(effect.model).filter(
      (field) => !primaryFields.includes(field),
    );
    const beforeByIdentity = new Map(
      before.modelRecords.map((row) => [recordIdentityKey(row, primaryFields), row]),
    );
    const afterByIdentity = new Map(
      after.map((row) => [recordIdentityKey(row, primaryFields), row]),
    );
    const expectedIdentity = recordIdentityKey(before.record, primaryFields);
    const created = [...afterByIdentity.keys()].filter(
      (identity) => !beforeByIdentity.has(identity),
    );
    const deleted = [...beforeByIdentity.keys()].filter(
      (identity) => !afterByIdentity.has(identity),
    );
    const updated = [...beforeByIdentity.keys()]
      .filter((identity) => afterByIdentity.has(identity))
      .filter((identity) => {
        const beforeRow = beforeByIdentity.get(identity)!;
        const afterRow = afterByIdentity.get(identity)!;
        return scalarFields.some((field) => !databaseRecordFieldEqual(beforeRow, afterRow, field));
      });
    const passed =
      created.length === 0 &&
      deleted.length === 1 &&
      deleted[0] === expectedIdentity &&
      updated.length === 0;
    return check(
      'hard delete removed exactly the declared row and caused no same-model collateral delta',
      passed,
      passed
        ? undefined
        : `expected deleted=${expectedIdentity}; created=${created.join(',') || '<none>'}; deleted=${deleted.join(',') || '<none>'}; updated=${updated.join(',') || '<none>'}`,
    );
  }

  function singularMutationDeltaAssertion(
    effect: Extract<
      CrudMutationAnyFixtureRegistration['effect'],
      { kind: 'update' | 'delete' | 'transition' | 'generated-transition' }
    >,
    before: MutationSnapshot | undefined,
    after: Record<string, unknown> | null,
    startedAt: Date,
    finishedAt: Date,
  ): CrudEvidenceAssertion {
    if (!before || !after || before.model !== effect.model) {
      return check(
        'every singular target identity and scalar-field delta is declared exactly once',
        false,
        'the exact pre-action or post-action target row is unavailable',
      );
    }
    const identityFields = prismaPrimaryIdentityFields(effect.model);
    const identityUnchanged =
      recordIdentityKey(before.record, identityFields) === recordIdentityKey(after, identityFields);
    const changedFields = prismaScalarFieldNames(effect.model)
      .filter((field) => !identityFields.includes(field))
      .filter((field) => !databaseValueEqual(before.record[field], after[field]));
    const requiredFields = [
      ...Object.keys(effect.expectedFields),
      ...(effect.kind === 'generated-transition' ? Object.keys(effect.generatedFields) : []),
    ].sort();
    const allowedFields = new Set(effect.allowedFields ?? []);
    const missing = requiredFields.filter((field) => !changedFields.includes(field));
    const unexpected = changedFields.filter(
      (field) => !requiredFields.includes(field) && !allowedFields.has(field),
    );
    const invalidAllowed = changedFields.filter(
      (field) =>
        allowedFields.has(field) &&
        !(field === 'updatedAt' && timestampWithinAction(after[field], startedAt, finishedAt)),
    );
    const detail = [
      ...(!identityUnchanged ? ['primary identity changed'] : []),
      ...(missing.length ? [`declared fields did not change: ${missing.join(', ')}`] : []),
      ...(unexpected.length ? [`undeclared fields changed: ${unexpected.join(', ')}`] : []),
      ...(invalidAllowed.length
        ? [`allowed fields failed their validators: ${invalidAllowed.join(', ')}`]
        : []),
    ];
    return check(
      'every singular target identity and scalar-field delta is declared exactly once',
      identityUnchanged &&
        missing.length === 0 &&
        unexpected.length === 0 &&
        invalidAllowed.length === 0,
      detail.join('; ') || undefined,
    );
  }

  async function generatedCreateFieldAssertions(
    effect: MutationGeneratedFieldContract,
    contractId: string,
    persisted: Record<string, unknown> | null,
    response: Record<string, unknown>,
    fixture: CrudMutationAnyFixtureRegistration,
    actorId: string,
    context: GeneratedFieldExecutionContext | undefined,
    startedAt: Date,
    finishedAt: Date,
    subject = 'created row',
  ): Promise<CrudEvidenceAssertion[]> {
    if (!persisted) {
      return [
        check(
          `${subject} matches every declared generated field`,
          false,
          'created row is unavailable',
        ),
      ];
    }
    const mismatches: string[] = [];
    const sequenceDetails: string[] = [];
    for (const [field, validator] of Object.entries(effect.generatedFields)) {
      const result = await generatedCreateFieldMatches(
        field,
        persisted[field],
        validator,
        effect,
        contractId,
        response,
        fixture,
        actorId,
        context,
        startedAt,
        finishedAt,
      );
      if (!result.ok)
        mismatches.push(`${field}: ${result.detail ?? safeComparable(persisted[field])}`);
      if (result.sequenceDetail) sequenceDetails.push(`${field}: ${result.sequenceDetail}`);
    }
    const sequenceFields = Object.entries(effect.generatedFields)
      .filter(([, validator]) => validator.kind === 'entity-code')
      .map(([field]) => field);
    return [
      check(
        `${subject} matches every declared generated field`,
        mismatches.length === 0,
        mismatches.length ? mismatches.join('; ') : undefined,
      ),
      ...(sequenceFields.length
        ? [
            check(
              'entity code sequence advanced exactly once and emitted its persisted format',
              sequenceDetails.length === sequenceFields.length &&
                sequenceDetails.every((detail) => detail.endsWith(': valid')),
              sequenceDetails.join('; ') || 'sequence evidence is unavailable',
            ),
          ]
        : []),
    ];
  }

  async function generatedCreateFieldMatches(
    field: string,
    actual: unknown,
    validator: CrudMutationGeneratedField,
    effect: MutationGeneratedFieldContract,
    contractId: string,
    response: Record<string, unknown>,
    fixture: CrudMutationAnyFixtureRegistration,
    actorId: string,
    context: GeneratedFieldExecutionContext | undefined,
    startedAt: Date,
    finishedAt: Date,
  ): Promise<{ ok: boolean; detail?: string; sequenceDetail?: string }> {
    if (validator.kind === 'exact') {
      return {
        ok: mutationValueMatches(actual, validator.value, fixture, actorId, startedAt, finishedAt),
      };
    }
    if (validator.kind === 'action-time') {
      const offset = validator.offsetMs ?? 0;
      const value = actual instanceof Date ? actual.getTime() : Date.parse(String(actual));
      return {
        ok:
          Number.isFinite(value) &&
          value >= startedAt.getTime() + offset - 1_000 &&
          value <= finishedAt.getTime() + offset + 1_000,
        detail: `expected action time offset ${offset}, got ${safeComparable(actual)}`,
      };
    }
    if (validator.kind === 'action-local-calendar-days') {
      const lower = new Date(startedAt);
      const upper = new Date(finishedAt);
      lower.setDate(lower.getDate() + validator.offsetDays);
      upper.setDate(upper.getDate() + validator.offsetDays);
      const value = actual instanceof Date ? actual.getTime() : Date.parse(String(actual));
      const minimum = Math.min(lower.getTime(), upper.getTime()) - 1_000;
      const maximum = Math.max(lower.getTime(), upper.getTime()) + 1_000;
      return {
        ok:
          Number.isFinite(value) &&
          value >= minimum &&
          value <= maximum &&
          localCalendarDaysActionTimeMatches(actual, validator.offsetDays, startedAt, finishedAt),
        detail:
          `expected local calendar +${validator.offsetDays} day(s) between ` +
          `${lower.toISOString()} and ${upper.toISOString()}, got ${safeComparable(actual)}`,
      };
    }
    if (validator.kind === 'local-day-start') {
      const source = resolveMutationValue(validator.value, fixture, actorId);
      const expected = new Date(String(source));
      expected.setHours(0, 0, 0, 0);
      const actualTime = actual instanceof Date ? actual.getTime() : Date.parse(String(actual));
      return {
        ok: !Number.isNaN(expected.getTime()) && actualTime === expected.getTime(),
        detail: `expected local day start ${expected.toISOString()}, got ${safeComparable(actual)}`,
      };
    }
    if (validator.kind === 'local-day-end') {
      const source = resolveMutationValue(validator.value, fixture, actorId);
      const expected = new Date(String(source));
      expected.setHours(23, 59, 59, 999);
      const actualTime = actual instanceof Date ? actual.getTime() : Date.parse(String(actual));
      return {
        ok: !Number.isNaN(expected.getTime()) && actualTime === expected.getTime(),
        detail: `expected local day end ${expected.toISOString()}, got ${safeComparable(actual)}`,
      };
    }
    if (validator.kind === 'utc-day-start' || validator.kind === 'utc-day-end') {
      const source = resolveMutationValue(validator.value, fixture, actorId);
      const boundary = validator.kind === 'utc-day-start' ? 'start' : 'end';
      const expected = new Date(String(source));
      if (boundary === 'start') expected.setUTCHours(0, 0, 0, 0);
      else expected.setUTCHours(23, 59, 59, 999);
      return {
        ok: utcDayBoundaryMatches(actual, source, boundary),
        detail: `expected UTC day ${boundary} ${
          Number.isFinite(expected.getTime()) ? expected.toISOString() : '<invalid source>'
        }, got ${safeComparable(actual)}`,
      };
    }
    if (validator.kind === 'independent-domain-aggregate') {
      return independentDomainAggregateMatches(field, actual, validator.source, response, context);
    }
    if (validator.kind === 'response-secret-digest') {
      const responseSecret = readUnknownPath(response, validator.responsePath);
      const matches =
        validator.algorithm === 'hmac-sha256-app-encryption-key'
          ? responseSecretHmacDigestMatches(
              actual,
              responseSecret,
              app.get(ConfigService).getOrThrow<string>('APP_ENCRYPTION_KEY'),
            )
          : responseSecretDigestMatches(actual, responseSecret);
      return {
        ok: matches,
        detail: 'persisted digest did not match the one-time response secret',
      };
    }
    if (validator.kind === 'response-secret-prefix') {
      return {
        ok: responseSecretPrefixMatches(
          actual,
          readUnknownPath(response, validator.responsePath),
          validator.length,
        ),
        detail: 'persisted prefix did not match the one-time response secret',
      };
    }
    if (validator.kind === 'request-secret-hash') {
      const requestValue = readUnknownPath(
        resolveMutationMap(fixture.request.body ?? {}, fixture, actorId),
        validator.requestPath,
      );
      return {
        ok:
          typeof actual === 'string' &&
          typeof requestValue === 'string' &&
          (await argon2.verify(actual, requestValue)),
        detail: 'persisted password hash did not verify against the signed request secret',
      };
    }
    if (validator.kind === 'response-exact') {
      return {
        ok: comparableEqual(actual, readUnknownPath(response, validator.responsePath)),
        detail: `persisted field did not match response path ${validator.responsePath.join('.')}`,
      };
    }
    if (validator.kind === 'timestamp-id') {
      return timestampIdMatches(actual, validator, startedAt, finishedAt);
    }
    if (validator.kind === 'value-with-prefix') {
      const expected = `${validator.prefix}${String(
        resolveMutationValue(validator.value, fixture, actorId),
      )}${validator.suffix ?? ''}`;
      return {
        ok: comparableEqual(actual, expected),
        detail: `expected ${expected}, got ${safeComparable(actual)}`,
      };
    }
    if (validator.kind === 'value-with-action-iso-suffix') {
      const prefix = `${String(resolveMutationValue(validator.value, fixture, actorId))}${validator.separator}`;
      const value = String(actual ?? '');
      return {
        ok: canonicalActionIsoSuffixMatches(
          actual,
          prefix,
          startedAt,
          finishedAt,
          validator.suffix,
        ),
        detail: `expected ${prefix}<action ISO timestamp>${validator.suffix ?? ''}, got ${safeComparable(actual)}`,
      };
    }
    if (validator.kind === 'tax-auto-apply-number') {
      const sourceId = String(resolveMutationValue(validator.sourceId, fixture, actorId));
      const sourceLineId = String(resolveMutationValue(validator.sourceLineId, fixture, actorId));
      const expected = `TX-${validator.sourcePrefix}-${sourceId.slice(0, validator.fragmentLength)}-${sourceLineId.slice(0, validator.fragmentLength)}`;
      return {
        ok: comparableEqual(actual, expected),
        detail: `expected ${expected}, got ${safeComparable(actual)}`,
      };
    }
    if (validator.kind === 'entity-code') {
      return entityCodeGeneratedFieldMatches(
        field,
        actual,
        validator,
        contractId,
        fixture,
        actorId,
        context,
        startedAt,
        finishedAt,
      );
    }
    return scopedSequenceGeneratedFieldMatches(
      field,
      actual,
      validator,
      effect,
      contractId,
      fixture,
      actorId,
      context,
      startedAt,
      finishedAt,
    );
  }

  function timestampIdMatches(
    actual: unknown,
    validator: Extract<CrudMutationGeneratedField, { kind: 'timestamp-id' }>,
    startedAt: Date,
    finishedAt: Date,
  ): { ok: boolean; detail?: string } {
    const value = String(actual ?? '');
    const prefixes = validator.actionLocalCalendarYear
      ? Array.from(new Set([startedAt.getFullYear(), finishedAt.getFullYear()])).map(
          (year) => `${validator.prefix}${year}${validator.actionLocalCalendarYear?.separator}`,
        )
      : [validator.prefix];
    const matchedPrefix = prefixes.find((prefix) => value.startsWith(prefix));
    if (!matchedPrefix) {
      return { ok: false, detail: `expected prefix ${prefixes.join(' or ')}, got ${value}` };
    }
    let timestampPart = value.slice(matchedPrefix.length);
    if (validator.randomSuffix) {
      const { alphabet, length, separator } = validator.randomSuffix;
      const boundary = timestampPart.length - length - separator.length;
      const randomPart = boundary >= 0 ? timestampPart.slice(boundary + separator.length) : '';
      const alphabetPattern = alphabet === 'hex-upper' ? '[0-9A-F]' : '[0-9A-Z]';
      if (
        boundary < 1 ||
        timestampPart.slice(boundary, boundary + separator.length) !== separator ||
        !new RegExp(`^${alphabetPattern}{${length}}$`).test(randomPart)
      ) {
        return { ok: false, detail: `invalid ${alphabet} random suffix in ${value}` };
      }
      timestampPart = timestampPart.slice(0, boundary);
    }
    const timestamp =
      validator.timestampEncoding === 'decimal'
        ? Number(timestampPart)
        : Number.parseInt(timestampPart, 36);
    const canonicalTimestamp =
      validator.timestampEncoding === 'decimal'
        ? String(timestamp)
        : timestamp.toString(36).toUpperCase();
    const calendarYearMatches = validator.actionLocalCalendarYear
      ? matchedPrefix ===
        `${validator.prefix}${new Date(timestamp).getFullYear()}${validator.actionLocalCalendarYear.separator}`
      : true;
    return {
      ok:
        Number.isSafeInteger(timestamp) &&
        canonicalTimestamp === timestampPart &&
        calendarYearMatches &&
        timestamp >= startedAt.getTime() - 1_000 &&
        timestamp <= finishedAt.getTime() + 1_000,
      detail:
        `timestamp ${timestampPart} is outside the action window, not canonical, ` +
        'or inconsistent with its local calendar-year prefix',
    };
  }

  async function entityCodeGeneratedFieldMatches(
    field: string,
    actual: unknown,
    validator: Extract<CrudMutationGeneratedField, { kind: 'entity-code' }>,
    contractId: string,
    fixture: CrudMutationAnyFixtureRegistration,
    actorId: string,
    context: GeneratedFieldExecutionContext | undefined,
    startedAt: Date,
    finishedAt: Date,
  ): Promise<{ ok: boolean; detail?: string; sequenceDetail: string }> {
    const snapshot = context?.entityCodes.get(generatedFieldContextKey(contractId, field));
    if (!snapshot) {
      return {
        ok: false,
        detail: 'pre-action sequence snapshot is missing',
        sequenceDetail: 'missing',
      };
    }
    const after = await mutationDelegate('DocumentNumberSequence').findFirst({
      where: { sequenceCode: snapshot.sequenceCode },
    });
    if (!isRecord(after)) {
      return { ok: false, detail: 'post-action sequence is missing', sequenceDetail: 'missing' };
    }
    const companyId = validator.companyId
      ? String(resolveMutationValue(validator.companyId, fixture, actorId))
      : null;
    const dates = actionBoundaryDates(startedAt, finishedAt);
    const before = snapshot.before?.record;
    const validAdvances = dates.map((date) => {
      const shouldReset = before
        ? entitySequenceShouldReset(String(before.resetFrequency), before.lastResetAt, date)
        : true;
      const expectedNumber = before ? (shouldReset ? 1 : Number(before.currentNumber) + 1) : 1;
      return { date, shouldReset, expectedNumber };
    });
    const actualNumber = Number(after.currentNumber);
    const advance = validAdvances.find((candidate) => candidate.expectedNumber === actualNumber);
    const formatted = dates.some((date) => {
      const prefix = interpolateSequenceTokens(String(after.prefix ?? ''), date);
      const suffix = interpolateSequenceTokens(String(after.suffix ?? ''), date);
      return (
        String(actual) ===
        `${prefix}${String(actualNumber).padStart(Number(after.padding ?? 5), '0')}${suffix}`
      );
    });
    const identityValid =
      after.sequenceCode === snapshot.sequenceCode &&
      after.entityType === validator.entityType &&
      databaseValueEqual(after.companyId, companyId);
    let deltaValid = Boolean(advance);
    if (before) {
      const allowedChanged = new Set(['currentNumber', 'updatedAt']);
      if (advance?.shouldReset) allowedChanged.add('lastResetAt');
      const unexpected = prismaScalarFieldNames('DocumentNumberSequence').filter(
        (name) => !databaseValueEqual(before[name], after[name]) && !allowedChanged.has(name),
      );
      deltaValid =
        deltaValid &&
        unexpected.length === 0 &&
        timestampWithinAction(after.updatedAt, startedAt, finishedAt) &&
        (!advance?.shouldReset || timestampWithinAction(after.lastResetAt, startedAt, finishedAt));
    } else {
      const pattern =
        DEFAULT_PATTERNS[validator.entityType] ?? fallbackPattern(validator.entityType);
      deltaValid =
        deltaValid &&
        after.currentNumber === 1 &&
        after.prefix === pattern.prefix &&
        databaseValueEqual(after.suffix, pattern.suffix ?? null) &&
        after.padding === pattern.padding &&
        after.resetFrequency === pattern.resetFrequency &&
        after.isActive === true &&
        after.deletedAt == null &&
        timestampWithinAction(after.createdAt, startedAt, finishedAt) &&
        timestampWithinAction(after.updatedAt, startedAt, finishedAt) &&
        (pattern.resetFrequency === 'NEVER' ||
          timestampWithinAction(after.lastResetAt, startedAt, finishedAt));
    }
    const ok = identityValid && deltaValid && formatted;
    return {
      ok,
      detail: ok
        ? undefined
        : `sequence ${snapshot.sequenceCode} identity=${identityValid} delta=${deltaValid} format=${formatted}`,
      sequenceDetail: ok ? 'valid' : 'invalid',
    };
  }

  async function scopedSequenceGeneratedFieldMatches(
    field: string,
    actual: unknown,
    validator: Extract<CrudMutationGeneratedField, { kind: 'scoped-sequence-id' }>,
    effect: MutationGeneratedFieldContract,
    contractId: string,
    fixture: CrudMutationAnyFixtureRegistration,
    actorId: string,
    context: GeneratedFieldExecutionContext | undefined,
    startedAt: Date,
    finishedAt: Date,
  ): Promise<{ ok: boolean; detail?: string }> {
    const snapshot = context?.scopedSequences.get(generatedFieldContextKey(contractId, field));
    if (!snapshot) return { ok: false, detail: 'pre-action scoped rows are missing' };
    const prefixes = await scopedSequencePrefixes(
      validator,
      fixture,
      actorId,
      startedAt,
      finishedAt,
    );
    const expected = new Set<string>();
    for (const prefix of prefixes) {
      const matchingPrefixCodes = snapshot.rows
        .map((row) => row[field])
        .filter((value): value is string => typeof value === 'string')
        .filter((value) => value.startsWith(`${prefix}${validator.separator}`));
      let next: number;
      if (validator.counter.strategy === 'count-scope') {
        next = snapshot.rows.length + 1;
      } else if (validator.counter.strategy === 'count-prefix') {
        next = matchingPrefixCodes.length + 1;
      } else {
        const used = new Set(
          snapshot.rows
            .map((row) => row[field])
            .filter((value): value is string => typeof value === 'string'),
        );
        next = 1;
        while (
          used.has(
            `${prefix}${validator.separator}${String(next).padStart(
              validator.counter.padding,
              '0',
            )}`,
          )
        ) {
          next += 1;
        }
      }
      expected.add(
        `${prefix}${validator.separator}${String(next).padStart(validator.counter.padding, '0')}`,
      );
    }
    const ok = expected.has(String(actual));
    return {
      ok,
      detail: ok
        ? undefined
        : `expected one of ${[...expected].join(', ')} from captured ${effect.model} rows, got ${safeComparable(actual)}`,
    };
  }

  async function scopedSequencePrefixes(
    validator: Extract<CrudMutationGeneratedField, { kind: 'scoped-sequence-id' }>,
    fixture: CrudMutationAnyFixtureRegistration,
    actorId: string,
    startedAt: Date,
    finishedAt: Date,
  ): Promise<readonly string[]> {
    const prefixes = new Set<string>();
    for (const date of actionBoundaryDates(startedAt, finishedAt)) {
      const values: string[] = [];
      for (const part of validator.prefixParts) {
        if (part.kind === 'literal') values.push(part.value);
        else if (part.kind === 'action-year') values.push(String(date.getFullYear()));
        else if (part.kind === 'company-id-fragment') {
          const companyId = String(resolveMutationValue(part.companyId, fixture, actorId));
          values.push(companyId.replace(/-/g, '').slice(0, part.length).toUpperCase());
        } else {
          const companyId = String(resolveMutationValue(part.companyId, fixture, actorId));
          const company = await mutationDelegate('Company').findFirst({ where: { id: companyId } });
          if (!isRecord(company))
            throw new Error(`Company ${companyId} is unavailable for code generation.`);
          const preferred = company[part.preferredField];
          const fallback = company[part.fallbackField];
          const code =
            preferred !== null && preferred !== undefined
              ? String(preferred)
              : String(fallback ?? '').slice(0, part.fallbackLength);
          values.push(code.toUpperCase());
        }
      }
      prefixes.add(values.join(validator.separator));
    }
    return [...prefixes];
  }

  function actionBoundaryDates(startedAt: Date, finishedAt: Date): readonly Date[] {
    return startedAt.getTime() === finishedAt.getTime() ? [startedAt] : [startedAt, finishedAt];
  }

  function entitySequenceShouldReset(frequency: string, previous: unknown, now: Date): boolean {
    if (frequency === 'NEVER') return false;
    const prior =
      previous instanceof Date ? previous : previous ? new Date(String(previous)) : null;
    if (!prior || !Number.isFinite(prior.getTime())) return true;
    if (frequency === 'DAILY') {
      return (
        prior.getFullYear() !== now.getFullYear() ||
        prior.getMonth() !== now.getMonth() ||
        prior.getDate() !== now.getDate()
      );
    }
    if (frequency === 'MONTHLY') {
      return prior.getFullYear() !== now.getFullYear() || prior.getMonth() !== now.getMonth();
    }
    return frequency === 'YEARLY' && prior.getFullYear() !== now.getFullYear();
  }

  function interpolateSequenceTokens(template: string, when: Date): string {
    return template.replace(/\{(YYYY|YY|MM|DD)\}/g, (_match, token: string) => {
      if (token === 'YYYY') return String(when.getFullYear());
      if (token === 'YY') return String(when.getFullYear()).slice(-2);
      if (token === 'MM') return String(when.getMonth() + 1).padStart(2, '0');
      return String(when.getDate()).padStart(2, '0');
    });
  }

  function createMutationFieldClosureAssertion(
    effect: MutationGeneratedFieldContract,
    persisted: Record<string, unknown> | null,
    responseId: string,
    fixture: CrudMutationAnyFixtureRegistration,
    actorId: string,
    startedAt: Date,
    finishedAt: Date,
  ): CrudEvidenceAssertion {
    if (!persisted) {
      return check(
        'every created scalar is declared or matches its schema-generated default',
        false,
        'created row is unavailable',
      );
    }
    const model = Prisma.dmmf.datamodel.models.find((item) => item.name === effect.model);
    if (!model) {
      return check(
        'every created scalar is declared or matches its schema-generated default',
        false,
        `Prisma model ${effect.model} is unavailable`,
      );
    }
    const declared = new Set(Object.keys(effect.expectedFields));
    if ('companyPath' in effect && effect.companyPath?.length === 1) {
      declared.add(effect.companyPath[0]);
    }
    Object.keys(effect.generatedFields).forEach((field) => declared.add(field));
    const allowed = new Set(effect.allowedFields ?? []);
    const errors: string[] = [];
    for (const field of model.fields.filter((item) => item.kind !== 'object')) {
      const actual = persisted[field.name];
      const metadata = field as unknown as {
        name: string;
        isId: boolean;
        isRequired: boolean;
        isList: boolean;
        isUpdatedAt?: boolean;
        hasDefaultValue: boolean;
        default?: unknown;
      };
      if (declared.has(field.name)) continue;
      if (
        allowed.has(field.name) &&
        createAllowedFieldMatches(
          metadata,
          actual,
          responseId,
          fixture,
          actorId,
          startedAt,
          finishedAt,
        )
      ) {
        continue;
      }
      if (metadata.isUpdatedAt && timestampWithinAction(actual, startedAt, finishedAt)) continue;
      if (
        metadata.hasDefaultValue &&
        prismaDefaultMatches(metadata, actual, responseId, startedAt, finishedAt)
      ) {
        continue;
      }
      if (!metadata.isRequired && !metadata.isList && actual == null) continue;
      errors.push(`${field.name}=${safeComparable(actual)}`);
    }
    const unknownExpected = [...declared].filter(
      (name) => !model.fields.some((field) => field.kind !== 'object' && field.name === name),
    );
    if (unknownExpected.length)
      errors.push(`non-scalar declarations: ${unknownExpected.join(', ')}`);
    return check(
      'every created scalar is declared or matches its schema-generated default',
      errors.length === 0,
      errors.length ? `unexplained fields: ${errors.join(', ')}` : undefined,
    );
  }

  function createAllowedFieldMatches(
    field: {
      name: string;
      isId: boolean;
      isRequired: boolean;
      isList: boolean;
      isUpdatedAt?: boolean;
      hasDefaultValue: boolean;
      default?: unknown;
    },
    actual: unknown,
    responseId: string,
    fixture: CrudMutationAnyFixtureRegistration,
    actorId: string,
    startedAt: Date,
    finishedAt: Date,
  ): boolean {
    if (field.name === 'id') {
      return (
        field.isId &&
        field.hasDefaultValue &&
        prismaDefaultMatches(field, actual, responseId, startedAt, finishedAt)
      );
    }
    if (field.name === 'createdAt' || field.name === 'updatedAt') {
      return mutationValueMatches(actual, { now: 'iso' }, fixture, actorId, startedAt, finishedAt);
    }
    return false;
  }

  function prismaDefaultMatches(
    field: {
      name: string;
      isId: boolean;
      isRequired: boolean;
      isList: boolean;
      isUpdatedAt?: boolean;
      hasDefaultValue: boolean;
      default?: unknown;
    },
    actual: unknown,
    responseId: string,
    startedAt: Date,
    finishedAt: Date,
  ): boolean {
    const value = field.default;
    if (value && typeof value === 'object' && 'name' in value) {
      const generated = String((value as { name: unknown }).name)
        .toLowerCase()
        .trim();
      if (generated === 'now') return timestampWithinAction(actual, startedAt, finishedAt);
      if (field.isId) {
        return (
          comparableEqual(actual, responseId) && schemaGeneratedIdentifierMatches(actual, generated)
        );
      }
      return false;
    }
    if (prismaNumericDefaultMatches(actual, value)) return true;
    return databaseValueEqual(actual, value);
  }

  function timestampWithinAction(actual: unknown, startedAt: Date, finishedAt: Date): boolean {
    const timestamp = actual instanceof Date ? actual.getTime() : Date.parse(String(actual));
    return (
      Number.isFinite(timestamp) &&
      timestamp >= startedAt.getTime() - 1_000 &&
      timestamp <= finishedAt.getTime() + 1_000
    );
  }

  async function captureCompoundScope(
    contractId: string,
    model: string,
    scope: CrudMutationClosedScope,
    fixture: CrudMutationAnyFixtureRegistration,
    actorId: string,
    modelRecords: Record<string, unknown>[],
  ): Promise<CompoundScopeSnapshot> {
    assertCompoundScopeFields(model, scope);
    const where = resolveMutationMap(scope.equals, fixture, actorId);
    const delegate = mutationDelegate(model);
    const scopeRecords = await delegate.findMany({ where });
    await attachJsonNullProvenance(model, scopeRecords);
    assertUniqueRecordIdentities(scopeRecords, scope.identityFields, `${contractId} pre-scope`);
    return { contractId, model, scope, scopeRecords, modelRecords };
  }

  async function compoundMutationEffectAssertions(
    fixture: CrudMutationAnyFixtureRegistration,
    effect: CrudMutationCompoundEffect,
    result: InvocationResult,
    actorId: string,
    context: CompoundExecutionContext,
    generatedContext: GeneratedFieldExecutionContext | undefined,
    startedAt: Date,
    finishedAt: Date,
  ): Promise<{ assertions: CrudEvidenceAssertion[]; createdId: string; entityId: string }> {
    const assertions: CrudEvidenceAssertion[] = [];
    const deltaClaims: CrudMutationResolvedDeltaClaim[] = [];
    const response = unwrapRecord(result.body);
    const allEffects = [
      ...effect.effects,
      ...(effect.allowedTableExceptions ?? []).map((exception) => exception.effect),
    ];

    for (const namedEffect of allEffects) {
      if (namedEffect.kind === 'row-create') {
        const id = String(
          resolveCompoundEffectValue(namedEffect.id, fixture, actorId, response, context),
        );
        const persisted = await readMutationRecord(namedEffect.model, id);
        assertions.push(
          check(`${namedEffect.effectId} created the exact declared row`, Boolean(id && persisted)),
        );
        assertions.push(
          compoundExpectedFieldsAssertion(
            namedEffect,
            persisted,
            fixture,
            actorId,
            response,
            context,
            startedAt,
            finishedAt,
          ),
        );
        context.effectResults.set(namedEffect.effectId, {
          id,
          ...(persisted ? { record: persisted } : {}),
        });
        if (persisted) {
          deltaClaims.push({
            claimId: namedEffect.effectId,
            model: namedEffect.model,
            kind: 'create',
            identity: primaryRecordIdentityKey(namedEffect.model, persisted),
          });
        }
        continue;
      }

      if (namedEffect.kind === 'scoped-row-create') {
        const snapshot = context.scopeSnapshots.get(namedEffect.effectId);
        if (!snapshot) {
          throw new Error(`Missing compound scope snapshot ${namedEffect.effectId}.`);
        }
        const after = await mutationDelegate(namedEffect.model).findMany({
          where: resolveMutationMap(namedEffect.scope.equals, fixture, actorId),
        });
        await attachJsonNullProvenance(namedEffect.model, after);
        assertUniqueRecordIdentities(
          after,
          namedEffect.scope.identityFields,
          `${namedEffect.effectId} post-scope`,
        );
        const identityDelta = resolveCrudMutationScopedRowCreateIdentityDelta(
          snapshot.scopeRecords.map((row) =>
            recordIdentityKey(row, namedEffect.scope.identityFields),
          ),
          after.map((row) => recordIdentityKey(row, namedEffect.scope.identityFields)),
        );
        const { added, removed } = identityDelta;
        const created =
          added.length === 1
            ? (after.find(
                (row) => recordIdentityKey(row, namedEffect.scope.identityFields) === added[0],
              ) ?? null)
            : null;
        assertions.push(
          check(
            `${namedEffect.effectId} created exactly one new row in the closed scope`,
            identityDelta.isExactCreate && Boolean(created),
            `added ${added.length}, removed ${removed.length}`,
          ),
        );
        assertions.push(
          compoundExpectedFieldsAssertion(
            namedEffect,
            created,
            fixture,
            actorId,
            response,
            context,
            startedAt,
            finishedAt,
          ),
        );
        assertions.push(
          ...(await generatedCreateFieldAssertions(
            namedEffect,
            namedEffect.effectId,
            created,
            response,
            fixture,
            actorId,
            generatedContext,
            startedAt,
            finishedAt,
          )),
        );
        const primaryFields = prismaPrimaryIdentityFields(namedEffect.model);
        const primaryIdentityValue =
          created && primaryFields.length === 1 ? created[primaryFields[0]] : undefined;
        const createdId = typeof primaryIdentityValue === 'string' ? primaryIdentityValue : '';
        assertions.push(
          createMutationFieldClosureAssertion(
            namedEffect,
            created,
            createdId,
            fixture,
            actorId,
            startedAt,
            finishedAt,
          ),
        );
        context.effectResults.set(namedEffect.effectId, {
          ...(createdId ? { id: createdId } : {}),
          ...(created ? { record: created } : {}),
        });
        if (created) {
          deltaClaims.push({
            claimId: namedEffect.effectId,
            model: namedEffect.model,
            kind: 'create',
            identity: recordIdentityKey(created, primaryFields),
          });
        }
        continue;
      }

      if (namedEffect.kind === 'row-update') {
        const id = String(resolveMutationValue(namedEffect.id, fixture, actorId));
        const persisted = await readMutationRecord(namedEffect.model, id);
        assertions.push(
          check(`${namedEffect.effectId} target row still exists`, Boolean(persisted)),
        );
        assertions.push(
          compoundExpectedFieldsAssertion(
            namedEffect,
            persisted,
            fixture,
            actorId,
            response,
            context,
            startedAt,
            finishedAt,
          ),
        );
        const before = context.rowSnapshots.get(namedEffect.effectId)?.record;
        const changedForbidden = (namedEffect.forbiddenFields ?? []).filter(
          (field) => !comparableEqual(before?.[field], persisted?.[field]),
        );
        assertions.push(
          check(
            `${namedEffect.effectId} forbidden fields remained unchanged`,
            changedForbidden.length === 0,
            changedForbidden.length ? `changed: ${changedForbidden.join(', ')}` : undefined,
          ),
        );
        context.effectResults.set(namedEffect.effectId, {
          id,
          ...(persisted ? { record: persisted } : {}),
        });
        if (persisted) {
          deltaClaims.push({
            claimId: namedEffect.effectId,
            model: namedEffect.model,
            kind: 'update',
            identity: primaryRecordIdentityKey(namedEffect.model, persisted),
            fields: Object.keys(namedEffect.expectedFields).sort(),
          });
        }
        continue;
      }

      if (namedEffect.kind === 'row-delete') {
        const id = String(resolveMutationValue(namedEffect.id, fixture, actorId));
        const persisted = await readMutationRecord(namedEffect.model, id, true);
        const deletedAt = persisted
          ? readUnknownPath(persisted, namedEffect.deletedAtPath ?? ['deletedAt'])
          : undefined;
        assertions.push(
          check(
            `${namedEffect.effectId} applied the exact declared delete`,
            namedEffect.mode === 'soft' ? Boolean(deletedAt) : persisted === null,
          ),
        );
        const before = context.rowSnapshots.get(namedEffect.effectId)?.record;
        assertions.push(
          compoundExpectedFieldsAssertion(
            namedEffect,
            namedEffect.mode === 'soft' ? persisted : (before ?? null),
            fixture,
            actorId,
            response,
            context,
            startedAt,
            finishedAt,
          ),
        );
        context.effectResults.set(namedEffect.effectId, {
          id,
          ...(persisted ? { record: persisted } : {}),
        });
        if (before) {
          deltaClaims.push(
            namedEffect.mode === 'hard'
              ? {
                  claimId: namedEffect.effectId,
                  model: namedEffect.model,
                  kind: 'delete',
                  identity: primaryRecordIdentityKey(namedEffect.model, before),
                }
              : {
                  claimId: namedEffect.effectId,
                  model: namedEffect.model,
                  kind: 'update',
                  identity: primaryRecordIdentityKey(namedEffect.model, before),
                  fields: Object.keys(namedEffect.expectedFields).sort(),
                },
          );
        }
        continue;
      }

      const snapshot = context.scopeSnapshots.get(namedEffect.effectId);
      if (!snapshot) throw new Error(`Missing compound scope snapshot ${namedEffect.effectId}.`);
      const after = await mutationDelegate(namedEffect.model).findMany({
        where: resolveMutationMap(namedEffect.scope.equals, fixture, actorId),
      });
      assertUniqueRecordIdentities(
        after,
        namedEffect.scope.identityFields,
        `${namedEffect.effectId} post-scope`,
      );
      if (namedEffect.kind === 'count-delta') {
        const actualDelta = after.length - snapshot.scopeRecords.length;
        assertions.push(
          check(
            `${namedEffect.effectId} produced the exact scoped count delta`,
            actualDelta === namedEffect.expectedDelta,
            `expected ${namedEffect.expectedDelta}, received ${actualDelta}`,
          ),
        );
        const primaryFields = prismaPrimaryIdentityFields(namedEffect.model);
        const beforeByPrimary = new Map(
          snapshot.scopeRecords.map((row) => [recordIdentityKey(row, primaryFields), row]),
        );
        const afterByPrimary = new Map(
          after.map((row) => [recordIdentityKey(row, primaryFields), row]),
        );
        const created = [...afterByPrimary.keys()]
          .filter((identity) => !beforeByPrimary.has(identity))
          .sort();
        const deleted = [...beforeByPrimary.keys()]
          .filter((identity) => !afterByPrimary.has(identity))
          .sort();
        const polarityMatches =
          namedEffect.expectedDelta > 0
            ? created.length === namedEffect.expectedDelta && deleted.length === 0
            : deleted.length === -namedEffect.expectedDelta && created.length === 0;
        assertions.push(
          check(
            `${namedEffect.effectId} count delta has one exact create/delete polarity`,
            polarityMatches,
            `created ${created.length}, deleted ${deleted.length}`,
          ),
        );
        for (const identity of created) {
          deltaClaims.push({
            claimId: namedEffect.effectId,
            model: namedEffect.model,
            kind: 'create',
            identity,
          });
        }
        for (const identity of deleted) {
          deltaClaims.push({
            claimId: namedEffect.effectId,
            model: namedEffect.model,
            kind: 'delete',
            identity,
          });
        }
      } else if (namedEffect.kind === 'set-delta') {
        const beforeKeys = new Set(
          snapshot.scopeRecords.map((row) =>
            recordIdentityKey(row, namedEffect.scope.identityFields),
          ),
        );
        const afterKeys = new Set(
          after.map((row) => recordIdentityKey(row, namedEffect.scope.identityFields)),
        );
        const added = [...afterKeys].filter((key) => !beforeKeys.has(key)).sort();
        const removed = [...beforeKeys].filter((key) => !afterKeys.has(key)).sort();
        const expectedAdded = namedEffect.expectedAdded
          .map((identity) =>
            expectedIdentityKey(namedEffect.model, identity, fixture, actorId, response, context),
          )
          .sort();
        const expectedRemoved = namedEffect.expectedRemoved
          .map((identity) =>
            expectedIdentityKey(namedEffect.model, identity, fixture, actorId, response, context),
          )
          .sort();
        assertions.push(
          check(
            `${namedEffect.effectId} produced the exact scoped identity-set delta`,
            canonicalJson({ added, removed }) ===
              canonicalJson({ added: expectedAdded, removed: expectedRemoved }),
            `expected ${canonicalJson({ added: expectedAdded, removed: expectedRemoved })}, received ${canonicalJson({ added, removed })}`,
          ),
        );
        const primaryFields = prismaPrimaryIdentityFields(namedEffect.model);
        for (const scopeIdentity of added) {
          const record = after.find(
            (row) => recordIdentityKey(row, namedEffect.scope.identityFields) === scopeIdentity,
          );
          if (record) {
            deltaClaims.push({
              claimId: namedEffect.effectId,
              model: namedEffect.model,
              kind: 'create',
              identity: recordIdentityKey(record, primaryFields),
            });
          }
        }
        for (const scopeIdentity of removed) {
          const record = snapshot.scopeRecords.find(
            (row) => recordIdentityKey(row, namedEffect.scope.identityFields) === scopeIdentity,
          );
          if (record) {
            deltaClaims.push({
              claimId: namedEffect.effectId,
              model: namedEffect.model,
              kind: 'delete',
              identity: recordIdentityKey(record, primaryFields),
            });
          }
        }
        if (added.length === 1) {
          const addedRecord = after.find(
            (row) => recordIdentityKey(row, namedEffect.scope.identityFields) === added[0],
          );
          context.effectResults.set(namedEffect.effectId, {
            ...(typeof addedRecord?.id === 'string' ? { id: addedRecord.id } : {}),
            ...(addedRecord ? { record: addedRecord } : {}),
          });
        }
      } else {
        throw new Error('Unsupported compound scope effect.');
      }
    }

    const modelDeltas = await resolveCompoundModelDeltas(context);
    const reconciliationErrors = reconcileCrudMutationModelDeltas(modelDeltas, deltaClaims);
    assertions.push(
      check(
        'every compound model, row, and scalar-field delta is declared exactly once',
        reconciliationErrors.length === 0,
        reconciliationErrors.join('; ') || undefined,
      ),
    );

    const entityId = String(
      resolveCompoundEffectValue(effect.auditEntityId, fixture, actorId, response, context),
    );
    return { assertions, createdId: '', entityId };
  }

  function compoundExpectedFieldsAssertion(
    effect: Extract<
      CrudMutationCompoundNamedEffect,
      { kind: 'row-create' | 'scoped-row-create' | 'row-update' | 'row-delete' }
    >,
    persisted: Record<string, unknown> | null,
    fixture: CrudMutationAnyFixtureRegistration,
    actorId: string,
    response: Record<string, unknown>,
    context: CompoundExecutionContext,
    startedAt: Date,
    finishedAt: Date,
  ): CrudEvidenceAssertion {
    const mismatches: string[] = [];
    for (const [field, expected] of Object.entries(effect.expectedFields)) {
      const actual = persisted?.[field];
      if (
        'now' in expected
          ? !mutationValueMatches(actual, expected, fixture, actorId, startedAt, finishedAt)
          : !comparableEqual(
              actual,
              resolveCompoundEffectValue(expected, fixture, actorId, response, context),
            )
      ) {
        mismatches.push(`${field}=${safeComparable(actual)}`);
      }
    }
    return check(
      `${effect.effectId} matches every declared persisted field`,
      mismatches.length === 0,
      mismatches.length ? `mismatches: ${mismatches.join(', ')}` : undefined,
    );
  }

  async function resolveCompoundModelDeltas(
    context: CompoundExecutionContext,
  ): Promise<CrudMutationResolvedModelDelta[]> {
    const deltas: CrudMutationResolvedModelDelta[] = [];
    for (const [model, before] of [...context.modelSnapshots.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      const after = await mutationDelegate(model).findMany({
        where: includingSoftDeletedWhere(model),
      });
      await attachJsonNullProvenance(model, after);
      const primaryFields = prismaPrimaryIdentityFields(model);
      const scalarFields = prismaScalarFieldNames(model).filter(
        (field) => !primaryFields.includes(field),
      );
      const beforeByIdentity = new Map(
        before.map((row) => [recordIdentityKey(row, primaryFields), row]),
      );
      const afterByIdentity = new Map(
        after.map((row) => [recordIdentityKey(row, primaryFields), row]),
      );
      const created = [...afterByIdentity.keys()]
        .filter((identity) => !beforeByIdentity.has(identity))
        .sort();
      const deleted = [...beforeByIdentity.keys()]
        .filter((identity) => !afterByIdentity.has(identity))
        .sort();
      const updated = [...beforeByIdentity.keys()]
        .filter((identity) => afterByIdentity.has(identity))
        .sort()
        .map((identity) => {
          const beforeRow = beforeByIdentity.get(identity)!;
          const afterRow = afterByIdentity.get(identity)!;
          const fields = scalarFields.filter(
            (field) => !databaseRecordFieldEqual(beforeRow, afterRow, field),
          );
          return { identity, fields };
        })
        .filter((item) => item.fields.length > 0);
      deltas.push({ model, created, deleted, updated });
    }
    return deltas;
  }

  function primaryRecordIdentityKey(model: string, record: Record<string, unknown>): string {
    return recordIdentityKey(record, prismaPrimaryIdentityFields(model));
  }

  function prismaScalarFieldNames(modelName: string): string[] {
    const model = Prisma.dmmf.datamodel.models.find((item) => item.name === modelName);
    if (!model) throw new Error(`Prisma model ${modelName} is absent.`);
    return model.fields
      .filter((field) => field.kind !== 'object')
      .map((field) => field.name)
      .sort();
  }

  function databaseValueEqual(left: unknown, right: unknown): boolean {
    return (
      canonicalJson(normalizeDatabaseValue(left)) === canonicalJson(normalizeDatabaseValue(right))
    );
  }

  function resolveCompoundEffectValue(
    value: CrudMutationEffectValue,
    fixture: CrudMutationAnyFixtureRegistration,
    actorId: string,
    response: Record<string, unknown>,
    context: CompoundExecutionContext,
  ): unknown {
    if ('response' in value) {
      const resolved = readUnknownPath(response, value.response.path);
      if (resolved === undefined) {
        throw new Error(`Compound response path ${value.response.path.join('.')} is absent.`);
      }
      return resolved;
    }
    if ('effectRef' in value) {
      const prior = context.effectResults.get(value.effectRef.effectId);
      if (!prior) throw new Error(`Compound effect ${value.effectRef.effectId} is unavailable.`);
      if (!value.effectRef.path?.length) {
        if (prior.id === undefined) {
          throw new Error(`Compound effect ${value.effectRef.effectId} has no scalar id.`);
        }
        return prior.id;
      }
      const resolved = readUnknownPath(prior.record, value.effectRef.path);
      if (resolved === undefined) {
        throw new Error(
          `Compound effect ${value.effectRef.effectId} path ${value.effectRef.path.join('.')} is absent.`,
        );
      }
      return resolved;
    }
    return resolveMutationValue(value, fixture, actorId);
  }

  function expectedIdentityKey(
    modelName: string,
    identity: Readonly<Record<string, CrudMutationEffectValue>>,
    fixture: CrudMutationAnyFixtureRegistration,
    actorId: string,
    response: Record<string, unknown>,
    context: CompoundExecutionContext,
  ): string {
    return canonicalJson(
      Object.fromEntries(
        Object.entries(identity)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([field, value]) => [
            field,
            normalizeExpectedDatabaseFieldValue(
              modelName,
              field,
              resolveCompoundEffectValue(value, fixture, actorId, response, context),
            ),
          ]),
      ),
    );
  }

  function normalizeExpectedDatabaseFieldValue(
    modelName: string,
    fieldName: string,
    value: unknown,
  ): unknown {
    const model = Prisma.dmmf.datamodel.models.find((candidate) => candidate.name === modelName);
    const field = model?.fields.find((candidate) => candidate.name === fieldName);
    if (!field || field.kind === 'object') {
      throw new Error(`Expected identity field ${modelName}.${fieldName} is not a Prisma scalar.`);
    }
    if (field.type === 'Decimal' && typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
    if (field.type === 'DateTime' && typeof value === 'string') {
      const timestamp = Date.parse(value);
      if (Number.isFinite(timestamp)) return normalizeDatabaseValue(new Date(timestamp));
    }
    if (field.type === 'BigInt' && (typeof value === 'number' || typeof value === 'string')) {
      try {
        return { $bigint: BigInt(value).toString() };
      } catch {
        // Preserve the original value so the exact set-delta assertion fails closed.
      }
    }
    return normalizeDatabaseValue(value);
  }

  async function recoverCompoundMutation(
    effect: CrudMutationCompoundEffect,
    context: CompoundExecutionContext,
    fixture: CrudMutationAnyFixtureRegistration,
    actorId: string,
  ): Promise<void> {
    const errors: string[] = [];
    const allEffects = [
      ...effect.effects,
      ...(effect.allowedTableExceptions ?? []).map((exception) => exception.effect),
    ];
    for (const item of crudMutationRecoveryPlan(effect)) {
      try {
        const namedEffect = allEffects.find((candidate) => candidate.effectId === item.contractId);
        if (!namedEffect) throw new Error(`Missing recovery effect ${item.contractId}.`);
        if (namedEffect.recovery === 'delete-created') {
          const id = context.effectResults.get(namedEffect.effectId)?.id;
          if (!id) throw new Error(`Created effect ${namedEffect.effectId} has no recovery id.`);
          await cleanupCreatedMutationRecord(namedEffect.model, id);
        } else if (namedEffect.recovery === 'restore-row') {
          const snapshot = context.rowSnapshots.get(namedEffect.effectId);
          if (!snapshot) throw new Error(`Missing row snapshot ${namedEffect.effectId}.`);
          await restoreMutationSnapshot(snapshot);
        } else {
          const snapshot = context.scopeSnapshots.get(namedEffect.effectId);
          if (!snapshot) throw new Error(`Missing scope snapshot ${namedEffect.effectId}.`);
          await restoreCompoundScope(snapshot);
        }
      } catch (error) {
        errors.push(`${item.contractId}: ${safeError(error)}`);
      }
    }

    // The arguments are intentionally consumed here to keep recovery bound to
    // the exact signed fixture actor even when the plan currently needs no new
    // value resolution during rollback.
    void fixture;
    void actorId;
    if (errors.length > 0) throw new Error(errors.join('; '));
  }

  async function restoreCompoundScope(snapshot: CompoundScopeSnapshot): Promise<void> {
    const delegate = mutationDelegate(snapshot.model);
    const primaryFields = prismaPrimaryIdentityFields(snapshot.model);
    const beforeById = new Map(
      snapshot.modelRecords.map((row) => [recordIdentityKey(row, primaryFields), row]),
    );
    const current = await delegate.findMany({
      where: includingSoftDeletedWhere(snapshot.model),
    });
    const currentById = new Map(current.map((row) => [recordIdentityKey(row, primaryFields), row]));

    for (const [identity, row] of currentById) {
      if (!beforeById.has(identity)) {
        await physicallyDeleteMutationRecord(snapshot.model, recordIdentity(row, primaryFields));
      }
    }
    for (const [identity, row] of beforeById) {
      const scalarRecord = mutationScalarRecord(snapshot.model, row);
      const existing = currentById.get(identity);
      if (existing) {
        const data = { ...scalarRecord };
        for (const field of primaryFields) delete data[field];
        await delegate.updateMany({
          where: includingSoftDeletedWhere(snapshot.model, recordIdentity(row, primaryFields)),
          data,
        });
      } else {
        await delegate.create({ data: scalarRecord });
      }
    }

    const restored = await delegate.findMany({
      where: includingSoftDeletedWhere(snapshot.model),
    });
    await attachJsonNullProvenance(snapshot.model, restored);
    if (databaseRecordSetKey(restored) !== databaseRecordSetKey(snapshot.modelRecords)) {
      throw new Error(`Compound scope recovery did not exactly restore model ${snapshot.model}.`);
    }
  }

  function assertCompoundScopeFields(modelName: string, scope: CrudMutationClosedScope): void {
    const model = Prisma.dmmf.datamodel.models.find((item) => item.name === modelName);
    if (!model) throw new Error(`Compound scope model ${modelName} is absent.`);
    const scalarFields = new Set(
      model.fields.filter((field) => field.kind !== 'object').map((field) => field.name),
    );
    for (const field of [...Object.keys(scope.equals), ...scope.identityFields]) {
      if (!scalarFields.has(field)) {
        throw new Error(`Compound scope ${modelName}.${field} is not a scalar Prisma field.`);
      }
    }
  }

  function prismaPrimaryIdentityFields(modelName: string): string[] {
    const model = Prisma.dmmf.datamodel.models.find((item) => item.name === modelName);
    if (!model) throw new Error(`Prisma model ${modelName} is absent.`);
    const fields = model.primaryKey?.fields.length
      ? [...model.primaryKey.fields]
      : model.fields.filter((field) => field.isId).map((field) => field.name);
    if (fields.length === 0) {
      throw new Error(`Prisma model ${modelName} has no primary identity for exact recovery.`);
    }
    return fields;
  }

  function assertUniqueRecordIdentities(
    records: readonly Record<string, unknown>[],
    fields: readonly string[],
    label: string,
  ): void {
    const keys = records.map((row) => recordIdentityKey(row, fields));
    if (new Set(keys).size !== keys.length) {
      throw new Error(`${label} does not have unique declared identities.`);
    }
  }

  function recordIdentity(
    row: Record<string, unknown>,
    fields: readonly string[],
  ): Record<string, unknown> {
    return Object.fromEntries(
      [...fields].sort().map((field) => {
        if (!Object.prototype.hasOwnProperty.call(row, field)) {
          throw new Error(`Recovery identity field ${field} is absent from a Prisma row.`);
        }
        return [field, row[field]];
      }),
    );
  }

  function recordIdentityKey(row: Record<string, unknown>, fields: readonly string[]): string {
    return canonicalJson(normalizeDatabaseValue(recordIdentity(row, fields)));
  }

  function databaseRecordSetKey(records: readonly Record<string, unknown>[]): string {
    return canonicalJson(
      records
        .map((record) =>
          canonicalJson({
            record: normalizeDatabaseValue(record),
            jsonNullProvenance:
              (record as ProvenancedMutationRecord)[mutationJsonNullProvenance] ?? {},
          }),
        )
        .sort(),
    );
  }

  function databaseRecordFieldEqual(
    before: Record<string, unknown>,
    after: Record<string, unknown>,
    field: string,
  ): boolean {
    const comparable = (record: Record<string, unknown>) => ({
      value: normalizeDatabaseValue(record[field]),
      jsonNullKind:
        (record as ProvenancedMutationRecord)[mutationJsonNullProvenance]?.[field] ?? null,
    });
    return canonicalJson(comparable(before)) === canonicalJson(comparable(after));
  }

  function normalizeDatabaseValue(value: unknown): unknown {
    if (value instanceof Date) return { $date: value.toISOString() };
    if (typeof value === 'bigint') return { $bigint: value.toString() };
    if (Buffer.isBuffer(value)) return { $bytes: value.toString('base64') };
    if (Array.isArray(value)) return value.map(normalizeDatabaseValue);
    if (value && typeof value === 'object') {
      if ('toJSON' in value && typeof value.toJSON === 'function') {
        return normalizeDatabaseValue(value.toJSON());
      }
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, item]) => [key, normalizeDatabaseValue(item)]),
      );
    }
    if (value === undefined) return { $undefined: true };
    return value;
  }

  async function mutationAuditAssertions(
    fixture: CrudMutationAnyFixtureRegistration,
    actorId: string,
    entityId: string,
    auditDelta: readonly MutationAuditRow[],
    result: InvocationResult,
    singularActionTargetBefore: MutationSnapshot | undefined,
    compoundContext: CompoundExecutionContext | undefined,
    startedAt: Date,
    finishedAt: Date,
  ): Promise<CrudEvidenceAssertion[]> {
    const auditEntityIdValue = fixture.audit.entityId
      ? resolveMutationValue(fixture.audit.entityId, fixture, actorId)
      : entityId;
    if (auditEntityIdValue !== null && typeof auditEntityIdValue !== 'string') {
      throw new Error('Exact mutation audit entity binding must resolve to a string or null.');
    }
    const expectedEntityId = auditEntityIdValue;
    const expectedCompanyId = await mutationAuditCompanyId(
      fixture,
      actorId,
      entityId,
      singularActionTargetBefore,
      compoundContext,
    );
    const response = unwrapRecord(result.body);
    const additionalExpected = await Promise.all(
      (fixture.audit.additionalAudits ?? []).map(async (contract) => {
        const resolvedEntityId = resolveAdditionalAuditEntityId(
          contract.entityId,
          fixture,
          actorId,
          response,
          compoundContext,
        );
        if (typeof resolvedEntityId !== 'string') {
          throw new Error('Additional mutation audit entity binding must resolve to a string.');
        }
        const companyId = await mutationAdditionalAuditCompanyId(
          contract,
          fixture,
          actorId,
          resolvedEntityId,
        );
        const companyScopes = contract.companyScopeBindings
          ? [
              ...new Set(
                contract.companyScopeBindings.map((binding) => {
                  if (binding === 'companyA') return companyAId;
                  if (binding === 'companyB') return companyBId;
                  throw new Error(
                    `Unsupported signed additional-audit company binding: ${binding}`,
                  );
                }),
              ),
            ].sort()
          : companyId
            ? [companyId]
            : [];
        const rows = auditDelta.filter(
          (row) =>
            row.action === contract.action &&
            row.entityType === contract.entityType &&
            row.entityId === resolvedEntityId &&
            row.userId === actorId,
        );
        return { contract, entityId: resolvedEntityId, companyId, companyScopes, rows };
      }),
    );
    if (!fixture.audit.scopeKind) {
      throw new Error('Mutation fixture omitted its signed immutable audit scope kind.');
    }
    const expectedCompanyScopes = fixture.audit.companyScopeBindings
      ? [
          ...new Set(
            fixture.audit.companyScopeBindings.map((binding) => {
              if (binding === 'companyA') return companyAId;
              if (binding === 'companyB') return companyBId;
              throw new Error(`Unsupported signed mutation audit company binding: ${binding}`);
            }),
          ),
        ].sort()
      : expectedCompanyId
        ? [expectedCompanyId]
        : [];
    const exact = auditDelta.filter(
      (row) =>
        row.action === fixture.audit.action &&
        row.entityType === fixture.audit.entityType &&
        row.entityId === expectedEntityId &&
        row.userId === actorId,
    );
    const audit = exact[0];
    const controllerEntityType = fixture.capabilityId
      .slice(0, fixture.capabilityId.indexOf('.'))
      .replace(/Controller$/, '');
    const exactIds = new Set([
      ...exact.map((row) => row.id),
      ...additionalExpected.flatMap((item) => item.rows.map((row) => row.id)),
    ]);
    const ancillary = auditDelta.filter((row) => !exactIds.has(row.id));
    const requiresSensitiveObservation = capabilityRequiresSensitiveAccessAudit(
      capabilityFor(fixture.capabilityId),
    );
    const fixedAssetsSensitiveObservation =
      fixture.capabilityId === 'FixedAssetsController.dispose' ? ancillary[0] : undefined;
    const invalidAncillary = ancillary.filter(
      (row) =>
        row.action !== 'VIEW_SENSITIVE' ||
        row.entityType !== controllerEntityType ||
        row.entityId !== null,
    );
    const unattributed = auditDelta.filter(
      (row) =>
        row.channel !== AuditChannel.AGENT ||
        row.agentSessionId !== agentSessionId ||
        row.userId !== actorId,
    );
    const diagnosticTimestamp = audit?.createdAt.getTime();
    const additionalAuditAssertions: CrudEvidenceAssertion[] = additionalExpected.flatMap(
      ({ contract, companyId, companyScopes, rows }) => {
        const row = rows[0];
        const timestamp = row?.createdAt.getTime();
        return [
          check(
            `additional audit ${contract.action}/${contract.entityType} occurs exactly once`,
            rows.length === 1,
          ),
          check(
            `additional audit ${contract.action} has exact company/scope provenance`,
            row?.companyId === companyId &&
              row?.scopeKind === contract.scopeKind &&
              row?.attributionStatus === contract.attributionStatus &&
              JSON.stringify(row?.companyScopes.map((scope) => scope.companyId) ?? []) ===
                JSON.stringify(companyScopes),
            `expected company=${companyId ?? '<global>'} scope=${contract.scopeKind} attribution=${contract.attributionStatus}`,
          ),
          check(
            `additional audit ${contract.action} has exact agent attribution`,
            row?.channel === AuditChannel.AGENT &&
              row.agentSessionId === agentSessionId &&
              row.userId === actorId,
          ),
          check(
            `additional audit ${contract.action} timestamp is bounded by the action`,
            timestamp !== undefined &&
              timestamp >= startedAt.getTime() - 1_000 &&
              timestamp <= finishedAt.getTime() + 1_000,
          ),
        ];
      },
    );
    const executionFields = [
      'principalType',
      'principalId',
      'mandateId',
      'initiatedByUserId',
      'taskId',
      'stepId',
      'deviceId',
    ] as const;
    const unexpectedlyAttributed = auditDelta.filter((row) =>
      executionFields.some((field) => row[field] !== null),
    );
    const payloadContract = fixture.audit.payload;
    const auditPayload = audit
      ? { oldValue: audit.oldValue, newValue: audit.newValue, metadata: audit.metadata }
      : undefined;
    const payloadJson = canonicalJson(normalizeDatabaseValue(auditPayload));
    const exactPayloadAssertions: CrudEvidenceAssertion[] = payloadContract
      ? (['oldValue', 'newValue', 'metadata'] as const)
          .filter((field) => payloadContract[field] !== undefined)
          .map((field) => {
            const expected = resolveMutationValue(payloadContract[field]!, fixture, actorId);
            return check(
              `audit ${field} matches the exact signed payload contract`,
              audit !== undefined &&
                canonicalJson(normalizeDatabaseValue(audit[field])) ===
                  canonicalJson(normalizeDatabaseValue(expected)),
              `expected=${canonicalJson(normalizeDatabaseValue(expected))} actual=${canonicalJson(
                normalizeDatabaseValue(audit?.[field]),
              )}`,
            );
          })
      : [];
    const responseSecretAssertions: CrudEvidenceAssertion[] = (
      payloadContract?.responseSecretsAbsent ?? []
    ).map((path) => {
      const secret = capabilityResponseValueAtPath(result.body, path);
      const serializedSecret = typeof secret === 'string' ? secret : '';
      return check(
        `response secret ${path.join('.')} is absent from stored audit JSON`,
        serializedSecret.length > 0 && !payloadJson.includes(serializedSecret),
        serializedSecret.length === 0
          ? 'response secret was absent from the action response'
          : 'stored audit JSON contained the response secret',
      );
    });
    const forbiddenKeyAssertions: CrudEvidenceAssertion[] = (
      payloadContract?.forbiddenKeys ?? []
    ).map((key) =>
      check(
        `sensitive key ${key} is absent from stored audit JSON`,
        !payloadJson.toLowerCase().includes(`\"${key.toLowerCase()}\"`),
      ),
    );
    return [
      check(
        'every new audit row is attributed to the exact agent session and fixture actor',
        auditDelta.length > 0 && unattributed.length === 0,
        unattributed.length
          ? `unattributed audit ids: ${unattributed.map((row) => row.id).join(', ')}`
          : undefined,
      ),
      check(
        'the exact new audit row matches action, entity type, and entity id',
        exact.length === 1,
      ),
      check(
        'the exact audit row has the signed attribution provenance',
        audit?.attributionStatus === fixture.audit.attributionStatus,
        `expected=${fixture.audit.attributionStatus ?? '<absent>'} actual=${audit?.attributionStatus ?? '<absent>'}`,
      ),
      check(
        'additional audit rows are declared sensitive-access observations',
        invalidAncillary.length === 0,
        invalidAncillary.length
          ? `unexpected audit ids: ${invalidAncillary.map((row) => row.id).join(', ')}`
          : undefined,
      ),
      check(
        'sensitive-access observation cardinality matches the live manifest policy',
        requiresSensitiveObservation ? ancillary.length === 1 : ancillary.length === 0,
        `required=${String(requiresSensitiveObservation)} observed=${ancillary.length}`,
      ),
      check(
        'Fixed Assets sensitive observation is exact COMPANY/EXPLICIT company A attribution',
        fixture.capabilityId !== 'FixedAssetsController.dispose' ||
          (ancillary.length === 1 &&
            fixedAssetsSensitiveObservation?.action === 'VIEW_SENSITIVE' &&
            fixedAssetsSensitiveObservation.entityType === 'FixedAssets' &&
            fixedAssetsSensitiveObservation.entityId === null &&
            fixedAssetsSensitiveObservation.companyId === companyAId &&
            fixedAssetsSensitiveObservation.scopeKind === AuditScopeKind.COMPANY &&
            fixedAssetsSensitiveObservation.attributionStatus === AuditAttributionStatus.EXPLICIT &&
            JSON.stringify(
              fixedAssetsSensitiveObservation.companyScopes.map((scope) => scope.companyId),
            ) === JSON.stringify([companyAId])),
      ),
      check(
        'audit delta is attributed to the AGENT channel',
        audit?.channel === AuditChannel.AGENT,
      ),
      check('audit delta identifies the authenticated fixture actor', audit?.userId === actorId),
      check(
        'human-loopback audit rows do not claim autonomous principal or task attribution',
        unexpectedlyAttributed.length === 0,
        unexpectedlyAttributed.length
          ? `unexpected audit ids: ${unexpectedlyAttributed.map((row) => row.id).join(', ')}`
          : undefined,
      ),
      check(
        'audit compatibility company id carries the exact fixture binding',
        audit?.companyId === expectedCompanyId,
        `expected=${expectedCompanyId ?? '<global>'} actual=${audit?.companyId ?? '<global>'}`,
      ),
      check(
        'audit delta carries the exact signed immutable scope kind',
        audit?.scopeKind === fixture.audit.scopeKind,
        `expected=${fixture.audit.scopeKind} actual=${audit?.scopeKind ?? '<absent>'}`,
      ),
      check(
        'audit delta carries the exact immutable company scope snapshots',
        JSON.stringify(audit?.companyScopes.map((scope) => scope.companyId) ?? []) ===
          JSON.stringify(expectedCompanyScopes),
        `expected=${JSON.stringify(expectedCompanyScopes)} actual=${JSON.stringify(audit?.companyScopes.map((scope) => scope.companyId) ?? [])}`,
      ),
      check(
        'audit timestamp is within the bounded diagnostic window',
        diagnosticTimestamp !== undefined &&
          diagnosticTimestamp >= startedAt.getTime() - 5 * 60 * 1000 &&
          diagnosticTimestamp <= finishedAt.getTime() + 5 * 60 * 1000,
        diagnosticTimestamp === undefined
          ? 'exact audit row absent'
          : `audit=${new Date(diagnosticTimestamp).toISOString()} app=${startedAt.toISOString()}..${finishedAt.toISOString()}`,
      ),
      ...(payloadContract
        ? [
            check(
              'audit severity matches the exact signed payload contract',
              audit?.severity === payloadContract.severity,
              `expected=${payloadContract.severity} actual=${audit?.severity ?? '<absent>'}`,
            ),
          ]
        : []),
      ...exactPayloadAssertions,
      ...responseSecretAssertions,
      ...forbiddenKeyAssertions,
      ...additionalAuditAssertions,
    ];
  }

  function resolveAdditionalAuditEntityId(
    value: CrudMutationEffectValue,
    fixture: CrudMutationAnyFixtureRegistration,
    actorId: string,
    response: Record<string, unknown>,
    context: CompoundExecutionContext | undefined,
  ): unknown {
    if ('response' in value) {
      const resolved = readUnknownPath(response, value.response.path);
      if (resolved === undefined) throw new Error('Additional audit response identity is absent.');
      return resolved;
    }
    if ('effectRef' in value) {
      if (!context) throw new Error('Additional audit effect identity requires compound context.');
      return resolveCompoundEffectValue(value, fixture, actorId, response, context);
    }
    return resolveMutationValue(value, fixture, actorId);
  }

  async function mutationAdditionalAuditCompanyId(
    contract: NonNullable<CrudMutationAnyFixtureRegistration['audit']['additionalAudits']>[number],
    fixture: CrudMutationAnyFixtureRegistration,
    actorId: string,
    entityId: string,
  ): Promise<string | null> {
    if (contract.companyId.kind === 'exact') {
      const value = resolveMutationValue(contract.companyId.value, fixture, actorId);
      if (value !== null && typeof value !== 'string') {
        throw new Error('Exact additional-audit company binding must resolve to string/null.');
      }
      return value;
    }
    const source = await readMutationRecord(contract.entityType, entityId, true);
    const value = source?.companyId;
    if (value !== null && typeof value !== 'string') {
      throw new Error(
        `Additional-audit company source ${contract.entityType}:${entityId} is unavailable.`,
      );
    }
    return value ?? null;
  }

  async function mutationAuditCompanyId(
    fixture: CrudMutationAnyFixtureRegistration,
    actorId: string,
    entityId: string,
    singularActionTargetBefore: MutationSnapshot | undefined,
    compoundContext: CompoundExecutionContext | undefined,
  ): Promise<string | null> {
    if (fixture.audit.companyId.kind === 'exact') {
      const value = resolveMutationValue(fixture.audit.companyId.value, fixture, actorId);
      if (value !== null && typeof value !== 'string') {
        throw new Error('Exact mutation audit company binding must resolve to a string or null.');
      }
      return value;
    }
    const effect = fixture.effect;
    if (effect.kind === 'compound') {
      if (!compoundContext) {
        throw new Error('Compound mutation audit company binding requires execution context.');
      }
      const candidates = effect.effects.flatMap((namedEffect) => {
        const result = compoundContext.effectResults.get(namedEffect.effectId);
        if (result?.id !== entityId || !result.record) return [];
        const model = Prisma.dmmf.datamodel.models.find(
          (candidate) => candidate.name === namedEffect.model,
        );
        if (!model) return [];
        const value =
          namedEffect.model === 'Company'
            ? result.record.id
            : model.fields.some((field) => field.kind !== 'object' && field.name === 'companyId')
              ? result.record.companyId
              : undefined;
        return value === undefined ? [] : [value];
      });
      if (
        candidates.length !== 1 ||
        (candidates[0] !== null && typeof candidates[0] !== 'string')
      ) {
        throw new Error(
          `Compound mutation audit company source is ambiguous for effect entity ${entityId}.`,
        );
      }
      return candidates[0] as string | null;
    }
    if (effect.kind === 'audit-only') {
      throw new Error('Audit-only mutation audit company binding must be declared as exact.');
    }

    const model = Prisma.dmmf.datamodel.models.find((candidate) => candidate.name === effect.model);
    if (!model) throw new Error(`Mutation audit model ${effect.model} is absent.`);
    const companyPath =
      effect.kind === 'create' && effect.companyPath
        ? effect.companyPath
        : model.fields.some((field) => field.kind !== 'object' && field.name === 'companyId')
          ? ['companyId']
          : effect.model === 'Company'
            ? ['id']
            : [];
    if (companyPath.length === 0) return null;
    if (companyPath.length !== 1) {
      throw new Error('Mutation audit effect-company binding must identify one scalar field.');
    }

    const current = await readMutationRecord(effect.model, entityId, true);
    const source =
      current ??
      (singularActionTargetBefore?.id === entityId ? singularActionTargetBefore.record : null);
    if (!source) {
      throw new Error(`Mutation audit company source ${effect.model}:${entityId} is unavailable.`);
    }
    const value = readUnknownPath(source, companyPath);
    if (value !== null && typeof value !== 'string') {
      throw new Error(
        `Mutation audit company field ${effect.model}.${companyPath[0]} is not string/null.`,
      );
    }
    return value;
  }

  function resolveMutationMap(
    values: Readonly<Record<string, CrudMutationValue>>,
    fixture: CrudMutationAnyFixtureRegistration,
    actorId: string,
  ): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(values).map(([name, value]) => [
        name,
        resolveMutationValue(value, fixture, actorId),
      ]),
    );
  }

  function resolveMutationValue(
    value: CrudMutationValue,
    fixture: CrudMutationAnyFixtureRegistration,
    actorId: string,
  ): unknown {
    if ('literal' in value) return value.literal;
    if ('binding' in value) {
      let resolved: unknown;
      if (value.binding === 'companyA') resolved = companyAId;
      else if (value.binding === 'companyB') resolved = companyBId;
      else if (value.binding === 'userA') resolved = actorId;
      else if (value.binding === 'posterUserA') resolved = posterUserId;
      else if (value.binding === 'posterRefreshToken') resolved = posterRefreshTokenId;
      else if (value.binding === 'unitA') resolved = unitAId;
      else if (value.binding === 'unitB') resolved = unitBId;
      else if (mutationBindings.has(value.binding)) resolved = mutationBindings.get(value.binding);
      else if (Object.prototype.hasOwnProperty.call(exactRecordIds, value.binding)) {
        resolved = exactRecordIds[value.binding as CrudExactRecordBinding];
      } else if (value.binding.startsWith('model:')) {
        resolved = seededModels.get(value.binding.slice('model:'.length));
      }
      if (resolved === undefined) {
        throw new Error(`Mutation binding ${value.binding} is not available.`);
      }
      return value.path
        ? readUnknownPath(resolved, value.path)
        : isRecord(resolved)
          ? resolved.id
          : resolved;
    }
    if ('unique' in value) {
      const digest = createHash('sha256')
        .update(`${runId}:${fixture.fixtureId}:${value.unique.prefix}`)
        .digest('hex')
        .slice(0, 12);
      return `${value.unique.prefix}-${digest}`;
    }
    if ('now' in value) return new Date().toISOString();
    if ('array' in value)
      return value.array.map((item) => resolveMutationValue(item, fixture, actorId));
    return Object.fromEntries(
      Object.entries(value.object).map(([name, item]) => [
        name,
        resolveMutationValue(item, fixture, actorId),
      ]),
    );
  }

  function mutationValueMatches(
    actual: unknown,
    expected: CrudMutationValue,
    fixture: CrudMutationAnyFixtureRegistration,
    actorId: string,
    startedAt: Date,
    finishedAt: Date,
  ): boolean {
    if ('now' in expected) {
      const timestamp = actual instanceof Date ? actual.getTime() : Date.parse(String(actual));
      return (
        Number.isFinite(timestamp) &&
        timestamp >= startedAt.getTime() - 1000 &&
        timestamp <= finishedAt.getTime() + 1000
      );
    }
    return comparableEqual(actual, resolveMutationValue(expected, fixture, actorId));
  }

  function comparableEqual(actual: unknown, expected: unknown): boolean {
    return canonicalPersistedValueMatches(actual, expected);
  }

  function safeComparable(value: unknown): string {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'bigint') return value.toString();
    if (value && typeof value === 'object' && 'toJSON' in value) {
      return JSON.stringify((value as { toJSON(): unknown }).toJSON());
    }
    return JSON.stringify(value);
  }

  function readUnknownPath(value: unknown, path: readonly string[]): unknown {
    let current = value;
    for (const segment of path) {
      if (Array.isArray(current)) {
        if (!/^(0|[1-9]\d*)$/.test(segment)) return undefined;
        const index = Number(segment);
        if (!Number.isSafeInteger(index) || index >= current.length) return undefined;
        current = current[index];
        continue;
      }
      if (!isRecord(current)) return undefined;
      current = current[segment];
    }
    return current;
  }

  async function readMutationRecord(
    model: string,
    id: string,
    includeDeleted = false,
  ): Promise<Record<string, unknown> | null> {
    const modelMetadata = Prisma.dmmf.datamodel.models.find((item) => item.name === model);
    const hasDeletedAt = modelMetadata?.fields.some((field) => field.name === 'deletedAt') ?? false;
    const where = { id, ...(!includeDeleted && hasDeletedAt ? { deletedAt: null } : {}) };
    const record = await mutationDelegate(model).findFirst({
      where: includeDeleted ? includingSoftDeletedWhere(model, where) : where,
    });
    if (record) await attachJsonNullProvenance(model, [record]);
    return record;
  }

  function mutationDelegate(model: string): MutationDelegate {
    const delegateName = `${model.charAt(0).toLowerCase()}${model.slice(1)}`;
    const delegate = (prisma as unknown as Record<string, MutationDelegate>)[delegateName];
    if (
      !delegate?.findFirst ||
      !delegate.findMany ||
      !delegate.create ||
      !delegate.update ||
      !delegate.updateMany ||
      !delegate.delete ||
      !delegate.deleteMany
    ) {
      throw new Error(`Prisma mutation delegate ${delegateName} is incomplete.`);
    }
    return delegate;
  }

  async function restoreMutationSnapshots(snapshots: readonly MutationSnapshot[]): Promise<void> {
    for (const snapshot of [...snapshots].reverse()) {
      await restoreMutationSnapshot(snapshot);
    }
  }

  async function restoreMutationSnapshot(snapshot: MutationSnapshot): Promise<void> {
    const scalarRecord = mutationScalarRecord(snapshot.model, snapshot.record);
    const delegate = mutationDelegate(snapshot.model);
    const current = await readMutationRecord(snapshot.model, snapshot.id, true);
    if (current) {
      const { id: _id, ...updateData } = scalarRecord;
      await delegate.update({ where: { id: snapshot.id }, data: updateData });
    } else {
      await delegate.create({ data: scalarRecord });
    }
  }

  function mutationScalarRecord(
    modelName: string,
    record: Record<string, unknown>,
  ): Record<string, unknown> {
    const model = Prisma.dmmf.datamodel.models.find((item) => item.name === modelName);
    if (!model) throw new Error(`Cannot restore absent Prisma model ${modelName}.`);
    const provenance = (record as ProvenancedMutationRecord)[mutationJsonNullProvenance] ?? {};
    return Object.fromEntries(
      model.fields
        .filter(
          (field) =>
            field.kind !== 'object' && Object.prototype.hasOwnProperty.call(record, field.name),
        )
        .map((field) => {
          const value = record[field.name];
          if (field.type === 'Json' && value === null) {
            const nullKind = provenance[field.name];
            if (!nullKind) {
              throw new Error(
                `Cannot restore ambiguous JSON null provenance for ${modelName}.${field.name}.`,
              );
            }
            return [field.name, nullKind === 'DB_NULL' ? Prisma.DbNull : Prisma.JsonNull] as const;
          }
          return [field.name, value] as const;
        }),
    );
  }

  async function attachJsonNullProvenance(
    modelName: string,
    records: readonly Record<string, unknown>[],
  ): Promise<void> {
    if (records.length === 0) return;
    const model = Prisma.dmmf.datamodel.models.find((item) => item.name === modelName);
    if (!model) throw new Error(`Cannot inspect absent Prisma model ${modelName}.`);
    const jsonFields = model.fields.filter(
      (field) => field.kind !== 'object' && field.type === 'Json' && !field.isList,
    );
    if (jsonFields.length === 0) return;
    const identityFields = prismaPrimaryIdentityFields(modelName);
    const schemaName = requiredEnv('CRUD_COVERAGE_SCHEMA');
    if (!/^msaidizi_crud_evidence_[a-z0-9_]{8,80}$/.test(schemaName)) {
      throw new Error('JSON null provenance query received an unsafe evidence schema.');
    }
    const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const tableName = model.dbName ?? model.name;
    const fieldMetadata = new Map(model.fields.map((field) => [field.name, field]));

    for (const record of records) {
      const ambiguousFields = jsonFields.filter((field) => record[field.name] === null);
      if (ambiguousFields.length === 0) continue;
      const values = identityFields.map((fieldName) => {
        if (!Object.prototype.hasOwnProperty.call(record, fieldName)) {
          throw new Error(`JSON null provenance identity ${modelName}.${fieldName} is absent.`);
        }
        return record[fieldName];
      });
      const select = ambiguousFields
        .map((field) => {
          const columnName = field.dbName ?? field.name;
          return `(${quote(columnName)} IS NULL) AS ${quote(field.name)}`;
        })
        .join(', ');
      const where = identityFields
        .map((fieldName, index) => {
          const field = fieldMetadata.get(fieldName);
          if (!field) throw new Error(`Missing Prisma field ${modelName}.${fieldName}.`);
          return `${quote(field.dbName ?? field.name)} = $${index + 1}`;
        })
        .join(' AND ');
      const rows = await prisma.$queryRawUnsafe<Array<Record<string, boolean>>>(
        `SELECT ${select} FROM ${quote(schemaName)}.${quote(tableName)} WHERE ${where}`,
        ...values,
      );
      if (rows.length !== 1) {
        throw new Error(`JSON null provenance row ${modelName} was not uniquely resolved.`);
      }
      const provenance = Object.fromEntries(
        ambiguousFields.map((field) => [field.name, rows[0][field.name] ? 'DB_NULL' : 'JSON_NULL']),
      ) as Record<string, 'DB_NULL' | 'JSON_NULL'>;
      Object.defineProperty(record, mutationJsonNullProvenance, {
        configurable: false,
        enumerable: false,
        value: Object.freeze(provenance),
        writable: false,
      });
    }
  }

  async function cleanupCreatedMutationRecord(model: string, id: string): Promise<void> {
    await physicallyDeleteMutationRecord(model, { id });
    const remaining = await readMutationRecord(model, id, true);
    if (remaining)
      throw new Error(`Created mutation row ${model}/${id} remained live after cleanup.`);
  }

  async function mutationModelIds(model: string): Promise<Set<string>> {
    const identityFields = prismaPrimaryIdentityFields(model);
    if (identityFields.length !== 1 || identityFields[0] !== 'id') {
      throw new Error(
        `Create recovery requires a single id identity for ${model}; found ${identityFields.join(',') || 'none'}.`,
      );
    }
    const rows = await mutationDelegate(model).findMany({
      where: includingSoftDeletedWhere(model),
    });
    return new Set(
      rows.map((row) => requiredEvidenceString(row.id, `${model}.id during create recovery`)),
    );
  }

  async function physicallyDeleteMutationRecord(
    model: string,
    identity: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    await physicallyDeleteDisposableRecord(
      (statement, ...values) => prisma.$executeRawUnsafe(statement, ...values),
      requiredEnv('CRUD_COVERAGE_SCHEMA'),
      model,
      identity,
    );
  }

  async function cleanupNewMutationRecords(
    model: string,
    idsBefore: ReadonlySet<string>,
    reportedId?: string,
  ): Promise<void> {
    const idsAfter = await mutationModelIds(model);
    const newIds = [...idsAfter].filter((id) => !idsBefore.has(id));
    if (reportedId && !idsBefore.has(reportedId) && !newIds.includes(reportedId)) {
      newIds.push(reportedId);
    }
    for (const id of newIds) await cleanupCreatedMutationRecord(model, id);

    const remainingNewIds = [...(await mutationModelIds(model))].filter((id) => !idsBefore.has(id));
    if (remainingNewIds.length > 0) {
      throw new Error(
        `Create recovery left new ${model} row(s): ${remainingNewIds.sort().join(',')}.`,
      );
    }
  }

  function mutationTablePolicyAssertion(
    fixture: CrudMutationAnyFixtureRegistration,
    before: Awaited<ReturnType<typeof databaseMutationSentinel>>,
    after: Awaited<ReturnType<typeof databaseMutationSentinel>>,
  ): CrudEvidenceAssertion {
    const allowed = new Set(
      [...crudMutationAllowedModels(fixture.effect)].map((model) => prismaTableName(model)),
    );
    const unexpected = changedDatabaseTables(before, after).filter(
      (tableName) => !allowed.has(tableName),
    );
    return check(
      'action changed only its declared effect table and attributable audit ledger',
      unexpected.length === 0,
      unexpected.length
        ? `undeclared changed tables: ${unexpected.join(', ')}; ${databaseMutationDetail(before, after)}`
        : undefined,
    );
  }

  function prismaTableName(modelName: string): string {
    const model = Prisma.dmmf.datamodel.models.find((item) => item.name === modelName);
    if (!model) throw new Error(`Prisma model ${modelName} is absent from the table policy.`);
    return model.dbName ?? model.name;
  }

  async function positive(
    fixtureId: string,
    token: string,
    args: Record<string, unknown>,
    assertions: (result: InvocationResult) => Promise<CrudEvidenceAssertion[]>,
  ): Promise<InvocationResult> {
    const fixture = fixtureFor(fixtureId, 'positive');
    const result = await invoke(fixture.capabilityId, token, args);
    const evaluated = await safelyEvaluate(assertions, result);
    addCase(fixtureId, 'positive', result, evaluated);
    return result;
  }

  async function positiveRead(
    fixtureId: string,
    token: string,
    args: Record<string, unknown>,
    assertions: (result: InvocationResult) => Promise<CrudEvidenceAssertion[]>,
  ): Promise<InvocationResult> {
    const fixture = fixtureFor(fixtureId, 'positive');
    const read = await invokeReadWithDatabaseClosure(
      fixture.capabilityId,
      token,
      args,
      'governance' in fixture ? fixture.governance.auditScope : undefined,
    );
    const evaluated = await safelyEvaluate(assertions, read.result);
    evaluated.push(read.noDatabaseMutation);
    addCase(fixtureId, 'positive', read.result, evaluated);
    return read.result;
  }

  async function security(
    fixtureId: string,
    controlKind: Exclude<CrudEvidenceControlKind, 'positive'>,
    result: InvocationResult,
    assertions: () => Promise<CrudEvidenceAssertion[]>,
  ) {
    fixtureFor(fixtureId, controlKind);
    const evaluated = await safelyEvaluate(async () => assertions(), result);
    addCase(fixtureId, controlKind, result, evaluated);
  }

  async function safelyEvaluate(
    evaluator: (result: InvocationResult) => Promise<CrudEvidenceAssertion[]>,
    result: InvocationResult,
  ): Promise<CrudEvidenceAssertion[]> {
    try {
      return await evaluator(result);
    } catch (error) {
      return [check('fixture assertion code completed', false, safeError(error))];
    }
  }

  function addCase(
    fixtureId: string,
    controlKind: CrudEvidenceControlKind,
    result: InvocationResult,
    assertions: CrudEvidenceAssertion[],
  ) {
    if (assertions.length > CRUD_EVIDENCE_MAX_CASE_ASSERTIONS) {
      throw new Error(
        `CRUD evidence case ${fixtureId} has ${assertions.length} assertions; maximum is ${CRUD_EVIDENCE_MAX_CASE_ASSERTIONS}.`,
      );
    }
    const fixture = fixtureFor(fixtureId, controlKind);
    const capability = capabilityFor(fixture.capabilityId);
    cases.push({
      fixtureId,
      fixtureVersion: fixture.fixtureVersion,
      capabilityId: fixture.capabilityId,
      capabilityContractDigest: capabilityContractDigest(capability),
      fixtureContractDigest: fixtureContractDigest(fixture),
      controlKind,
      outcome:
        assertions.length > 0 && assertions.every((item) => item.passed) ? 'passed' : 'failed',
      httpStatus: result.status,
      assertions,
      finishedAt: new Date().toISOString(),
    });
  }

  function skipped(fixtureId: string, detail: string) {
    const fixture = fixtureFor(fixtureId, 'positive');
    const capability = capabilityFor(fixture.capabilityId);
    cases.push({
      fixtureId,
      fixtureVersion: fixture.fixtureVersion,
      capabilityId: fixture.capabilityId,
      capabilityContractDigest: capabilityContractDigest(capability),
      fixtureContractDigest: fixtureContractDigest(fixture),
      controlKind: 'positive',
      outcome: 'skipped',
      assertions: [check('fixture prerequisites available', false, detail)],
      finishedAt: new Date().toISOString(),
    });
  }

  async function invoke(
    capabilityId: string,
    token: string,
    args: Record<string, unknown>,
    inputProvenanceSha256?: string,
  ): Promise<InvocationResult> {
    return invoker.invoke({
      capability: capabilityFor(capabilityId),
      args,
      authorization: `Bearer ${token}`,
      agentSessionId,
      inputProvenanceSha256,
    });
  }

  /**
   * A read is evidence only when its complete database state is identical on
   * both sides of that exact HTTP request. Keep the snapshots adjacent to the
   * invocation so writes by one fixture cannot be hidden by a later fixture.
   */
  async function invokeReadWithDatabaseClosure(
    capabilityId: string,
    token: string,
    args: Record<string, unknown>,
    auditScope?: CrudFixtureAuditScopeContract,
    auditAction: 'VIEW_SENSITIVE' | 'VIEW_SENSITIVE_DENIED' = 'VIEW_SENSITIVE',
  ): Promise<{ result: InvocationResult; noDatabaseMutation: CrudEvidenceAssertion }> {
    const before = await databaseMutationSentinel();
    const auditIdsBefore = new Set(
      (await prisma.auditLog.findMany({ select: { id: true } })).map((row) => row.id),
    );
    const result = await invoke(capabilityId, token, args);
    const auditDelta = (
      await prisma.auditLog.findMany({
        select: {
          id: true,
          action: true,
          entityType: true,
          entityId: true,
          userId: true,
          companyId: true,
          scopeKind: true,
          attributionStatus: true,
          companyScopes: {
            select: { companyId: true },
            orderBy: { companyId: 'asc' },
          },
          agentSessionId: true,
          channel: true,
          principalType: true,
          principalId: true,
          mandateId: true,
          initiatedByUserId: true,
          taskId: true,
          stepId: true,
          deviceId: true,
          createdAt: true,
        },
      })
    ).filter((row) => !auditIdsBefore.has(row.id));
    const expectedEntityType = capabilityId
      .slice(0, capabilityId.indexOf('.'))
      .replace(/Controller$/, '');
    const expectedActorId = evidenceActorId(token);
    const expectedScope = auditScope ? resolveReadAuditScope(auditScope) : undefined;
    const audit = auditDelta[0];
    const actualAuditCompanyScopeIds = (
      audit?.companyScopes.map((scope) => scope.companyId) ?? []
    ).sort();
    const expectedAuditCompanyScopeIds = expectedScope
      ? [...expectedScope.companyScopeIds].sort()
      : [];
    const declaredAuditIsExact = expectedScope
      ? auditDelta.length === 1 &&
        audit?.action === auditAction &&
        audit?.entityType === expectedEntityType &&
        audit?.entityId === null &&
        audit?.userId === expectedActorId &&
        audit?.companyId === expectedScope.companyId &&
        audit?.scopeKind === expectedScope.scopeKind &&
        audit?.attributionStatus === expectedScope.attributionStatus &&
        JSON.stringify(actualAuditCompanyScopeIds) ===
          JSON.stringify(expectedAuditCompanyScopeIds) &&
        audit?.channel === AuditChannel.AGENT &&
        audit?.agentSessionId === agentSessionId &&
        audit?.principalType === null &&
        audit?.principalId === null &&
        audit?.mandateId === null &&
        audit?.initiatedByUserId === null &&
        audit?.taskId === null &&
        audit?.stepId === null &&
        audit?.deviceId === null
      : auditDelta.length === 0;
    const auditMismatchFields: string[] = expectedScope
      ? (
          [
            ['rowCount', auditDelta.length === 1],
            ['action', audit?.action === auditAction],
            ['entityType', audit?.entityType === expectedEntityType],
            ['entityId', audit?.entityId === null],
            ['userId', audit?.userId === expectedActorId],
            ['companyId', audit?.companyId === expectedScope.companyId],
            ['scopeKind', audit?.scopeKind === expectedScope.scopeKind],
            ['attributionStatus', audit?.attributionStatus === expectedScope.attributionStatus],
            [
              'companyScopes',
              JSON.stringify(actualAuditCompanyScopeIds) ===
                JSON.stringify(expectedAuditCompanyScopeIds),
            ],
            ['channel', audit?.channel === AuditChannel.AGENT],
            ['agentSessionId', audit?.agentSessionId === agentSessionId],
            ['principalType', audit?.principalType === null],
            ['principalId', audit?.principalId === null],
            ['mandateId', audit?.mandateId === null],
            ['initiatedByUserId', audit?.initiatedByUserId === null],
            ['taskId', audit?.taskId === null],
            ['stepId', audit?.stepId === null],
            ['deviceId', audit?.deviceId === null],
          ] satisfies Array<[string, boolean]>
        )
          .filter(([, matches]) => !matches)
          .map(([field]) => field)
      : auditDelta.length === 0
        ? []
        : ['unexpectedAudit'];
    let cleanupError: string | undefined;
    try {
      if (auditDelta.length > 0) {
        await deleteAuditLogsForTest(prisma, {
          id: { in: auditDelta.map((row) => row.id) },
        });
      }
    } catch (error) {
      cleanupError = safeError(error);
    }
    const after = await databaseMutationSentinel();
    const unchanged = JSON.stringify(after) === JSON.stringify(before) && !cleanupError;
    const passed = unchanged && declaredAuditIsExact;
    const auditDetail = auditDelta.map((row) => ({
      id: row.id,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      userId: row.userId,
      companyId: row.companyId,
      scopeKind: row.scopeKind,
      attributionStatus: row.attributionStatus,
      companyScopes: row.companyScopes.map((scope) => scope.companyId),
      channel: row.channel,
      agentSessionId: row.agentSessionId,
      principalType: row.principalType,
      principalId: row.principalId,
      mandateId: row.mandateId,
      initiatedByUserId: row.initiatedByUserId,
      taskId: row.taskId,
      stepId: row.stepId,
      deviceId: row.deviceId,
    }));
    return {
      result,
      noDatabaseMutation: check(
        'read changed no business state and emitted only its declared audit effect',
        passed,
        passed
          ? undefined
          : [
              `auditMismatches=${auditMismatchFields.join(',') || 'none'}`,
              `actualCompanyScopes=${JSON.stringify(actualAuditCompanyScopeIds)}`,
              `expectedCompanyScopes=${JSON.stringify(expectedAuditCompanyScopeIds)}`,
              `expectedAudit=${auditScope ? `${auditAction}:${JSON.stringify(auditScope)}` : 'not_applicable'}`,
              `expectedActor=${expectedActorId}`,
              `expectedScope=${expectedScope ? JSON.stringify(expectedScope) : 'none'}`,
              `auditDelta=${JSON.stringify(auditDetail)}`,
              cleanupError ? `auditCleanup=${cleanupError}` : '',
              unchanged ? '' : databaseMutationDetail(before, after),
            ]
              .filter(Boolean)
              .join('; '),
      ),
    };
  }

  function evidenceActorId(token: string): string {
    if (token === creatorToken) return creatorUserId;
    if (token === groupReaderToken) return groupReaderUserId;
    if (token === groupCompanyAReaderToken) return groupCompanyAReaderUserId;
    if (token === posterToken) return posterUserId;
    if (token === restrictedToken) return restrictedUserId;
    throw new Error('Read closure received an unregistered evidence bearer token.');
  }

  function readExecutionToken(audit: 'required' | 'not_applicable', defaultToken: string): string {
    return audit === 'required' ? groupCompanyAReaderToken : defaultToken;
  }

  function resolveReadAuditScope(contract: CrudFixtureAuditScopeContract): {
    scopeKind: AuditScopeKind;
    attributionStatus: AuditAttributionStatus;
    companyId: string | null;
    companyScopeIds: string[];
  } {
    const companyScopeIds = [
      ...new Set(
        contract.companyScopeBindings.map((binding) => {
          if (binding === 'companyA') return companyAId;
          if (binding === 'companyB') return companyBId;
          if (binding === 'adminOperationsCompany') {
            return requiredEvidenceString(
              (mutationBindings.get('adminOperationsCompany') as { id?: unknown } | undefined)?.id,
              'adminOperationsCompany audit scope binding',
            );
          }
          throw new Error(`Unsupported signed audit company binding: ${String(binding)}`);
        }),
      ),
    ].sort();
    if (contract.scopeKind === 'COMPANY' && companyScopeIds.length !== 1) {
      throw new Error('Signed COMPANY audit scope must bind exactly one company snapshot.');
    }
    if (contract.scopeKind === 'MULTI_COMPANY' && companyScopeIds.length < 2) {
      throw new Error('Signed MULTI_COMPANY audit scope must bind at least two company snapshots.');
    }
    if (!['COMPANY', 'MULTI_COMPANY'].includes(contract.scopeKind) && companyScopeIds.length > 0) {
      throw new Error(`${contract.scopeKind} audit scope cannot bind company snapshots.`);
    }
    return {
      scopeKind: contract.scopeKind as AuditScopeKind,
      attributionStatus: contract.attributionStatus as AuditAttributionStatus,
      companyId: contract.scopeKind === 'COMPANY' ? companyScopeIds[0] : null,
      companyScopeIds,
    };
  }

  function capabilityFor(capabilityId: string): Capability {
    const capability = manifest.capabilities().find((candidate) => candidate.id === capabilityId);
    if (!capability) throw new Error(`Manifest capability ${capabilityId} is absent.`);
    return capability;
  }

  function fixtureFor(fixtureId: string, controlKind: CrudEvidenceControlKind) {
    const fixture = evidenceFixtures().find((candidate) => candidate.fixtureId === fixtureId);
    if (!fixture || fixture.controlKind !== controlKind) {
      throw new Error(`Fixture ${fixtureId} is not registered as ${controlKind}.`);
    }
    return fixture;
  }

  function evidenceFixtures() {
    return crudEvidenceFixturesForManifest(manifest.capabilities());
  }

  /**
   * Starts from the live DTO-derived schema and applies only fixture-specific
   * referential values. This prevents a renamed required DTO field from being
   * silently omitted by a stale hand-written body.
   */
  function schemaRequest(capabilityId: string, overrides: Record<string, unknown>) {
    const capability = capabilityFor(capabilityId);
    const schema = capability.params.bodySchema?.schema;
    const body = schema ? deriveRequiredSchemaValues(schema) : {};
    return { path: {}, query: {}, body: { ...body, ...overrides } };
  }

  function metadataReadRequest(
    capability: Capability,
    fixture: CrudMetadataReadFixtureRegistration,
  ) {
    const schema = capability.params.querySchema?.schema;
    if (fixture.request) {
      const bindings = fixture.request.queryBindings;
      const names = bindings.map((binding) => binding.name);
      const required = schema?.required ?? [];
      const missingRequired = required.filter((name) => !names.includes(name));
      const unknown = names.filter((name) => !schema?.properties[name]);
      if (
        new Set(names).size !== names.length ||
        missingRequired.length > 0 ||
        unknown.length > 0
      ) {
        throw new Error(
          `${fixture.capabilityId} signed metadata query does not match its strict schema: ` +
            `duplicates=${names.length - new Set(names).size} ` +
            `missingRequired=${missingRequired.join(',') || '<none>'} ` +
            `unknown=${unknown.join(',') || '<none>'}`,
        );
      }
      return {
        path: {},
        query: Object.fromEntries(
          bindings.map((binding) => [binding.name, metadataReadQueryBindingValue(binding)]),
        ),
      };
    }

    const required = schema?.required ?? [];
    const names = new Set([...required, ...capability.params.query]);
    for (const contextual of ['companyId', 'page', 'limit', 'pageSize']) {
      if (schema?.properties[contextual]) names.add(contextual);
    }
    const query = Object.fromEntries(
      [...names].map((name) => [name, metadataReadQueryValue(name)]),
    );
    return { path: {}, query };
  }

  function metadataReadQueryBindingValue(
    binding: CrudMetadataReadQueryBinding,
  ): string | number | boolean {
    if (binding.binding === 'companyA') return companyAId;
    if (binding.binding === 'divisionA') return divisionAId;
    if (binding.binding === 'branchA') return branchAId;
    if (binding.literal !== undefined) return binding.literal;
    throw new Error(`Metadata read query binding ${binding.name} has no value.`);
  }

  function metadataReadQueryValue(name: string): string | number {
    if (!(CRUD_EVIDENCE_METADATA_READ_QUERY_KEYS as readonly string[]).includes(name)) {
      throw new Error(`Metadata read query key ${name} is not derivable by this harness.`);
    }
    const values: Record<string, string | number> = {
      companyId: companyAId,
      branchId: branchAId,
      divisionId: divisionAId,
      fiscalYearId,
      accountingPeriodId,
      customerId: seededCustomerAId,
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      date: '2026-08-25',
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
      asOfDate: '2026-08-25',
      periodStart: '2026-01-01',
      periodEnd: '2026-12-31',
      month: 8,
      year: 2026,
      page: 1,
      limit: 20,
      pageSize: 20,
    };
    return values[name];
  }

  function metadataReadScopeAssertions(
    fixture: CrudMetadataReadFixtureRegistration,
    capability: Capability,
    query: Record<string, unknown>,
    body: unknown,
  ): CrudEvidenceAssertion[] {
    if (fixture.governance.scope === 'actor') {
      return [
        check(
          'actor-scoped metadata read uses the exact isolated actor oracle',
          fixture.observable.present.binding === 'userA' &&
            fixture.observable.absent.binding === 'userB' &&
            fixture.executionPrincipal === 'actor' &&
            fixture.observable.negativeControl?.actorBinding === 'userB' &&
            fixture.observable.negativeControl.companyBinding === 'companyA' &&
            fixture.observable.negativeControl.seedModel === fixture.observable.seedModel,
        ),
      ];
    }

    const exposedCompanyIds = collectExposedCompanyIds(body);
    const foreignCompanyIds = exposedCompanyIds.filter((companyId) => companyId !== companyAId);
    const assertions = [
      check(
        'company-scoped metadata read uses the exact isolated company oracle',
        fixture.governance.scope === 'company' &&
          fixture.executionPrincipal ===
            (capability.params.querySchema?.schema.properties.companyId ? 'group' : 'company') &&
          fixture.observable.present.binding === 'companyA' &&
          fixture.observable.absent.binding === 'companyB',
      ),
    ];
    if (capability.params.querySchema?.schema.properties.companyId) {
      assertions.push(
        check(
          'company-scoped metadata read used the isolated company filter',
          query.companyId === companyAId,
        ),
      );
    }
    if (fixture.request) {
      const expectedEntries = fixture.request.queryBindings.map((binding) => [
        binding.name,
        metadataReadQueryBindingValue(binding),
      ]);
      assertions.push(
        check(
          'metadata read used the exact ordered signed query bindings',
          canonicalJson(Object.entries(query)) === canonicalJson(expectedEntries),
          `expected=${JSON.stringify(expectedEntries)} actual=${JSON.stringify(Object.entries(query))}`,
        ),
      );
    }
    assertions.push(
      check(
        'response exposed no record from another company',
        foreignCompanyIds.length === 0,
        foreignCompanyIds.length > 0
          ? `foreignCompanyIds=${JSON.stringify([...new Set(foreignCompanyIds)].sort())}`
          : `observedCompanyIds=${JSON.stringify([...new Set(exposedCompanyIds)].sort())}`,
      ),
    );
    return assertions;
  }

  function metadataReadObservableAssertions(
    fixture: CrudMetadataReadFixtureRegistration,
    body: unknown,
    dedicatedSeed?: MetadataReadDedicatedSeedRecords,
  ): CrudEvidenceAssertion[] {
    const present = metadataReadMarker(fixture.observable.present.binding);
    const absent = metadataReadMarker(fixture.observable.absent.binding);
    const observation = evaluateMetadataReadCompanyMarkers(body, present, absent);
    const assertions = [
      check(
        'response contains the exact seeded in-scope marker',
        observation.present,
        `marker=${present} observed=${JSON.stringify([...new Set(observation.observed)].slice(0, 20))}`,
      ),
      check(
        'response excludes the exact seeded out-of-scope marker',
        observation.absent,
        !observation.absent ? `foreignMarker=${absent}` : undefined,
      ),
    ];
    const causalRecordControl = fixture.observable.causalRecordControl;
    if (causalRecordControl) {
      const scenarioMatches =
        dedicatedSeed?.seedScenario === causalRecordControl.seedScenario &&
        causalRecordControl.lifecycle === 'fixture_isolated' &&
        causalRecordControl.responseMarkerField === 'id' &&
        causalRecordControl.present.binding === 'scenarioA' &&
        causalRecordControl.present.companyBinding === 'companyA' &&
        causalRecordControl.absent.binding === 'scenarioB' &&
        causalRecordControl.absent.companyBinding === 'companyB';
      const presentRecordId = dedicatedSeed ? stringField(dedicatedSeed.present, 'id') : '';
      const absentRecordId = dedicatedSeed ? stringField(dedicatedSeed.absent, 'id') : '';
      const recordObservation = evaluateMetadataReadCompanyMarkers(
        body,
        presentRecordId,
        absentRecordId,
      );
      assertions.push(
        check(
          'fixture-private causal record bindings match the signed seed scenario',
          scenarioMatches,
        ),
        check(
          'response contains the exact fixture-private in-scope record',
          Boolean(presentRecordId) && recordObservation.present,
          `marker=${presentRecordId || '<missing>'}`,
        ),
        check(
          'response excludes the exact fixture-private foreign-company record',
          Boolean(absentRecordId) && recordObservation.absent,
          !recordObservation.absent ? `foreignMarker=${absentRecordId}` : undefined,
        ),
      );
    }
    return assertions;
  }

  function assertMetadataReadSeedFields(
    fixture: CrudMetadataReadFixtureRegistration,
    seeded: Record<string, unknown>,
  ): void {
    const mismatches = Object.entries(fixture.observable.seedFields ?? {})
      .filter(([field, expected]) => !crudEvidenceMetadataSeedValueMatches(seeded[field], expected))
      .map(
        ([field, expected]) =>
          `${field} expected=${JSON.stringify(expected)} actual=${String(seeded[field])}`,
      );
    if (mismatches.length > 0) {
      throw new Error(
        `${fixture.capabilityId} semantic seed precondition failed: ${mismatches.join(', ')}`,
      );
    }
  }

  async function shapeMetadataReadSeedFields(
    modelName: string,
    seeded: Record<string, unknown>,
    fields: CrudEvidenceMetadataSeedFields | undefined,
  ): Promise<Record<string, unknown>> {
    if (!fields || Object.keys(fields).length === 0) return seeded;
    // Several protected ledgers (notably AuditLog) are append-only. If the
    // foundation seed already has the required semantic shape, retain it
    // instead of issuing even a no-op UPDATE that the database must reject.
    if (
      Object.entries(fields).every(([field, expected]) =>
        crudEvidenceMetadataSeedValueMatches(seeded[field], expected),
      )
    ) {
      return seeded;
    }
    const id = stringField(seeded, 'id');
    if (!id) throw new Error(`${modelName} metadata read seed has no scalar id.`);
    type UpdateDelegate = {
      update(args: {
        where: { id: string };
        data: ReturnType<typeof materializeCrudEvidenceMetadataSeedFields>;
      }): Promise<Record<string, unknown>>;
    };
    const delegateName = `${modelName.charAt(0).toLowerCase()}${modelName.slice(1)}`;
    const delegate = (prisma as unknown as Record<string, UpdateDelegate>)[delegateName];
    if (!delegate?.update) throw new Error(`Prisma delegate ${delegateName}.update is absent.`);
    const shaped = await delegate.update({
      where: { id },
      data: materializeCrudEvidenceMetadataSeedFields(fields),
    });
    rememberSeededModel(modelName, shaped);
    return shaped;
  }

  function metadataReadMarker(binding: 'companyA' | 'companyB' | 'userA' | 'userB'): string {
    if (binding === 'companyA') return companyAId;
    if (binding === 'companyB') return companyBId;
    if (binding === 'userA') return creatorUserId;
    const userB = seededModels.get('UserB')?.id;
    if (typeof userB !== 'string' || !userB) {
      throw new Error('CRUD metadata read actor-B binding was not seeded.');
    }
    return userB;
  }

  function collectExposedCompanyIds(value: unknown, depth = 0): string[] {
    if (depth > 12 || value === null || value === undefined) return [];
    if (Array.isArray(value)) {
      return value.flatMap((item) => collectExposedCompanyIds(item, depth + 1));
    }
    if (typeof value !== 'object') return [];

    const record = value as Record<string, unknown>;
    const ids: string[] = [];
    if (typeof record.companyId === 'string') ids.push(record.companyId);
    if (
      record.company &&
      typeof record.company === 'object' &&
      typeof (record.company as Record<string, unknown>).id === 'string'
    ) {
      ids.push((record.company as Record<string, unknown>).id as string);
    }
    for (const [key, nested] of Object.entries(record)) {
      if (key === 'companyId' || key === 'company') continue;
      ids.push(...collectExposedCompanyIds(nested, depth + 1));
    }
    return ids;
  }

  function boundGlobalAdminReadArguments(
    bindings: CrudGlobalAdminReadFixtureRegistration['queryBindings'],
  ): Record<string, string | number | boolean> {
    return Object.fromEntries(
      bindings.map((binding) => {
        if (binding.binding === 'companyA') return [binding.name, companyAId];
        if (binding.literal !== undefined) return [binding.name, binding.literal];
        throw new Error(`Global administrative read argument ${binding.name} has no signed value.`);
      }),
    );
  }

  function boundRemainingReadArguments(
    bindings: CrudRemainingReadFixtureRegistration['queryBindings'],
  ): Record<string, string | number | boolean> {
    return Object.fromEntries(
      bindings.map((binding) => {
        if (binding.binding === 'companyA') return [binding.name, companyAId];
        if (binding.literal !== undefined) return [binding.name, binding.literal];
        throw new Error(`Remaining read argument ${binding.name} has no signed value.`);
      }),
    );
  }

  function remainingReadBindingValue(binding: CrudRemainingReadBinding): string | number | boolean {
    const result = remainingReadValues.get(binding);
    if (result === undefined) throw new Error(`Remaining read binding ${binding} was not seeded.`);
    return result;
  }

  function remainingReadExecutionToken(fixture: CrudRemainingReadFixtureRegistration): string {
    if (fixture.executionPrincipal === 'group') return groupReaderToken;
    if (fixture.executionPrincipal === 'group_company_a') return groupCompanyAReaderToken;
    return creatorToken;
  }

  async function executeRemainingReadScopeProbe(
    fixture: CrudRemainingReadFixtureRegistration,
    query: Record<string, string | number | boolean>,
  ): Promise<{ result: InvocationResult; noDatabaseMutation: CrudEvidenceAssertion } | undefined> {
    const probe = fixture.oracle.scopeProbe;
    if (!probe) return undefined;
    if (probe.kind === 'foreign_company_denied') {
      return invokeReadWithDatabaseClosure(fixture.capabilityId, creatorToken, {
        path: {},
        query: { ...query, [probe.argumentName]: companyBId },
      });
    }
    if (probe.kind === 'company_principal_denied_group_read') {
      return invokeReadWithDatabaseClosure(fixture.capabilityId, creatorToken, {
        path: {},
        query,
      });
    }
    if (probe.kind === 'group_principal_value') {
      return invokeReadWithDatabaseClosure(
        fixture.capabilityId,
        groupReaderToken,
        { path: {}, query },
        probe.auditScope,
      );
    }
    return invokeReadWithDatabaseClosure(
      fixture.capabilityId,
      probe.kind === 'poster_actor_value' ? posterToken : groupReaderToken,
      { path: {}, query },
    );
  }

  function remainingReadAssertions(
    fixture: CrudRemainingReadFixtureRegistration,
    result: InvocationResult,
    permissionProbe: InvocationResult,
    scopeProbe?: InvocationResult,
  ): CrudEvidenceAssertion[] {
    const payload = derivedReportPayload(result.body);
    const assertions: CrudEvidenceAssertion[] = [
      check('HTTP remaining deterministic read returned 2xx', result.ok, statusDetail(result)),
      check(
        'principal without the exact route permission was denied',
        !permissionProbe.ok &&
          permissionProbe.status === fixture.oracle.permissionProbe.expectedStatus,
        statusDetail(permissionProbe),
      ),
    ];

    for (const claim of fixture.oracle.values) {
      const actual = derivedReportPathValue(payload, claim.responsePath);
      const expected = remainingReadBindingValue(claim.binding);
      assertions.push(
        check(
          `remaining read reconciles ${claim.responsePath.join('.') || '<root>'} to its exact source value`,
          reportValueEqual(actual, expected),
          `binding=${claim.binding} expected=${String(expected)} actual=${String(actual)}`,
        ),
      );
    }

    for (const claim of fixture.oracle.markers) {
      const subtree = derivedReportPathValue(payload, claim.responsePath);
      const expected = remainingReadBindingValue(claim.binding);
      const found = containsScalar(subtree, expected);
      assertions.push(
        check(
          claim.match === 'contains'
            ? `remaining read ${claim.responsePath.join('.') || '<root>'} contains its exact source identity`
            : `remaining read ${claim.responsePath.join('.') || '<root>'} excludes its foreign source identity or value`,
          claim.match === 'contains' ? found : !found,
          `binding=${claim.binding} marker=${String(expected)}`,
        ),
      );
    }

    for (const claim of fixture.oracle.rows) {
      const collection = derivedReportPathValue(payload, claim.collectionPath);
      const rows = Array.isArray(collection) ? collection.filter(isRecord) : [];
      const match = remainingReadBindingValue(claim.matchBinding);
      const matching = rows.filter((item) =>
        reportValueEqual(derivedReportPathValue(item, claim.matchResponsePath), match),
      );
      assertions.push(
        check(
          `remaining read ${claim.collectionPath.join('.')} contains exactly one signed source row`,
          matching.length === 1,
          `binding=${claim.matchBinding} matches=${matching.length}`,
        ),
      );
      for (const rowValue of claim.values) {
        const actual = matching[0]
          ? derivedReportPathValue(matching[0], rowValue.responsePath)
          : undefined;
        const expected = remainingReadBindingValue(rowValue.binding);
        assertions.push(
          check(
            `remaining source row reconciles ${rowValue.responsePath.join('.')} exactly`,
            matching.length === 1 && reportValueEqual(actual, expected),
            `binding=${rowValue.binding} expected=${String(expected)} actual=${String(actual)}`,
          ),
        );
      }
    }

    const probe = fixture.oracle.scopeProbe;
    if (
      probe?.kind === 'foreign_company_denied' ||
      probe?.kind === 'company_principal_denied_group_read'
    ) {
      assertions.push(
        check(
          probe.kind === 'foreign_company_denied'
            ? 'company-A principal was denied the signed foreign-company substitution'
            : 'company principal was denied the signed group-only read',
          scopeProbe !== undefined && !scopeProbe.ok && scopeProbe.status === probe.expectedStatus,
          scopeProbe ? statusDetail(scopeProbe) : 'scope probe was not executed',
        ),
      );
    } else if (probe?.kind === 'group_principal_includes_foreign') {
      assertions.push(
        check(
          'broader group principal returned the exact signed foreign source identity',
          scopeProbe !== undefined &&
            scopeProbe.status === probe.expectedStatus &&
            containsScalar(
              derivedReportPayload(scopeProbe.body),
              remainingReadBindingValue(probe.presentBinding),
            ),
          scopeProbe ? statusDetail(scopeProbe) : 'scope probe was not executed',
        ),
      );
    } else if (probe?.kind === 'group_principal_value' || probe?.kind === 'poster_actor_value') {
      const probePayload = scopeProbe ? derivedReportPayload(scopeProbe.body) : undefined;
      const actual = probePayload
        ? derivedReportPathValue(probePayload, probe.claim.responsePath)
        : undefined;
      const expected = remainingReadBindingValue(probe.claim.binding);
      assertions.push(
        check(
          probe.kind === 'group_principal_value'
            ? 'broader group principal reconciles the signed multi-company source value'
            : 'alternate actor reconciles only that actor’s signed source value',
          scopeProbe !== undefined &&
            scopeProbe.status === probe.expectedStatus &&
            reportValueEqual(actual, expected),
          `binding=${probe.claim.binding} expected=${String(expected)} actual=${String(actual)}`,
        ),
      );
    }

    return assertions;
  }

  function globalAdminReadBindingValue(binding: CrudGlobalAdminReadBinding): string {
    const value = globalAdminReadValues.get(binding);
    if (!value) throw new Error(`Global administrative read binding ${binding} was not seeded.`);
    return value;
  }

  async function globalAdminReadAssertions(
    fixture: CrudGlobalAdminReadFixtureRegistration,
    result: InvocationResult,
    permissionProbe: InvocationResult,
    scopeProbe?: InvocationResult,
  ): Promise<CrudEvidenceAssertion[]> {
    const payload = derivedReportPayload(result.body);
    const present = globalAdminReadBindingValue(fixture.oracle.presentBinding);
    const absent = fixture.oracle.absentBinding
      ? globalAdminReadBindingValue(fixture.oracle.absentBinding)
      : undefined;
    const companyQuery = fixture.queryBindings.find((binding) => binding.name === 'companyId');
    const scopeContractMatches = fixture.oracle.scopeProbe
      ? fixture.oracle.scopeProbe.kind === 'company_principal_denied_group_read'
        ? fixture.governance.scope === 'global' &&
          fixture.executionPrincipal === 'group' &&
          companyQuery === undefined
        : fixture.governance.scope === 'company' &&
          fixture.executionPrincipal === 'company' &&
          companyQuery?.binding === 'companyA' &&
          fixture.oracle.scopeProbe.deniedCompanyBinding === 'companyB'
      : fixture.seedScenario === 'global-admin-records-v1'
        ? fixture.governance.scope === 'global' && fixture.executionPrincipal === 'company'
        : fixture.governance.scope === 'company' &&
          fixture.executionPrincipal === 'company' &&
          fixture.oracle.absentBinding !== undefined;

    const assertions: CrudEvidenceAssertion[] = [
      check('HTTP global administrative read returned 2xx', result.ok, statusDetail(result)),
      check(
        'global administrative read contains the exact signed source identity or content',
        containsScalar(payload, present),
        `binding=${fixture.oracle.presentBinding} marker=${present}`,
      ),
      check(
        'global administrative read scope contract matches its reviewed principal',
        scopeContractMatches,
      ),
      check(
        'principal without the exact route permission was denied',
        !permissionProbe.ok &&
          permissionProbe.status === fixture.oracle.permissionProbe.expectedStatus,
        statusDetail(permissionProbe),
      ),
    ];

    if (absent !== undefined) {
      assertions.push(
        check(
          'company-bound administrative read excludes the foreign source identity or content',
          !containsScalar(payload, absent),
          `binding=${fixture.oracle.absentBinding} marker=${absent}`,
        ),
      );
    }

    if (fixture.oracle.scopeProbe) {
      assertions.push(
        check(
          fixture.oracle.scopeProbe.kind === 'company_principal_denied_group_read'
            ? 'company principal was denied the group-only administrative read'
            : 'company-A principal was denied the signed company-B substitution',
          scopeProbe !== undefined &&
            !scopeProbe.ok &&
            scopeProbe.status === fixture.oracle.scopeProbe.expectedStatus,
          scopeProbe ? statusDetail(scopeProbe) : 'scope probe was not executed',
        ),
      );
    }

    return assertions;
  }

  function boundDerivedReportArguments(
    bindings: CrudDerivedReportReadFixtureRegistration['queryBindings'],
  ): Record<string, string | number | boolean> {
    return Object.fromEntries(
      bindings.map((binding) => {
        if (binding.binding === 'companyA') return [binding.name, companyAId];
        if (binding.literal !== undefined) return [binding.name, binding.literal];
        throw new Error(`Derived report argument ${binding.name} has no signed value.`);
      }),
    );
  }

  function derivedReportBindingValue(binding: CrudDerivedReportBinding): string | number | boolean {
    const value = derivedReportValues.get(binding);
    if (value === undefined) {
      throw new Error(`Derived report binding ${binding} was not seeded.`);
    }
    return value;
  }

  async function derivedReportReadAssertions(
    fixture: CrudDerivedReportReadFixtureRegistration,
    result: InvocationResult,
    scopeProbe: InvocationResult,
  ): Promise<CrudEvidenceAssertion[]> {
    const payload = derivedReportPayload(result.body);
    const present = fixture.oracle.presentBindings.map((binding) => ({
      binding,
      value: derivedReportBindingValue(binding),
    }));
    const absent = fixture.oracle.absentBindings.map((binding) => ({
      binding,
      value: derivedReportBindingValue(binding),
    }));
    const successfulCompanyQuery = fixture.queryBindings.find(
      (binding) => binding.name === 'companyId',
    );
    const scopeContractMatches =
      fixture.oracle.scopeProbe.kind === 'foreign_company_denied'
        ? fixture.governance.scope === 'company' &&
          fixture.executionPrincipal === 'company' &&
          successfulCompanyQuery?.binding === 'companyA' &&
          fixture.oracle.scopeProbe.deniedCompanyBinding === 'companyB'
        : fixture.executionPrincipal === 'group' &&
          ((fixture.governance.scope === 'global' && successfulCompanyQuery === undefined) ||
            (fixture.governance.scope === 'company' &&
              successfulCompanyQuery?.binding === 'companyA'));

    const assertions: CrudEvidenceAssertion[] = [
      check('HTTP derived report read returned 2xx', result.ok, statusDetail(result)),
      check(
        'derived report returned a non-null payload',
        payload !== null && payload !== undefined,
      ),
      check(
        'derived report scope oracle matches its reviewed execution principal',
        scopeContractMatches,
      ),
      check(
        'derived report contains every signed in-scope causal value',
        present.every((marker) => containsScalar(payload, marker.value)),
        `missing=${JSON.stringify(
          present
            .filter((marker) => !containsScalar(payload, marker.value))
            .map((marker) => marker.binding),
        )}`,
      ),
      check(
        'derived report excludes every signed foreign-company causal value',
        absent.every((marker) => !containsScalar(payload, marker.value)),
        `leaked=${JSON.stringify(
          absent
            .filter((marker) => containsScalar(payload, marker.value))
            .map((marker) => marker.binding),
        )}`,
      ),
      check(
        fixture.oracle.scopeProbe.kind === 'foreign_company_denied'
          ? 'company-A report denied the signed company-B substitution'
          : 'group report denied the company-scoped principal',
        !scopeProbe.ok && scopeProbe.status === fixture.oracle.scopeProbe.expectedStatus,
        statusDetail(scopeProbe),
      ),
    ];

    for (const expectation of fixture.oracle.rootValues ?? []) {
      const actual = derivedReportPathValue(payload, expectation.responsePath);
      const expected = derivedReportBindingValue(expectation.binding);
      assertions.push(
        check(
          `derived report reconciles ${expectation.responsePath.join('.')} to its source aggregate`,
          reportValueEqual(actual, expected),
          `binding=${expectation.binding} expected=${String(expected)} actual=${String(actual)}`,
        ),
      );
    }

    for (const expectation of fixture.oracle.rows ?? []) {
      const collection = derivedReportPathValue(payload, expectation.collectionPath);
      const expectedMatch = derivedReportBindingValue(expectation.matchBinding);
      const rows = Array.isArray(collection) ? collection.filter(isRecord) : [];
      const matchingRows = rows.filter((row) =>
        reportValueEqual(derivedReportPathValue(row, expectation.matchResponsePath), expectedMatch),
      );
      assertions.push(
        check(
          'derived report contains exactly one signed source row',
          matchingRows.length === 1,
          `binding=${expectation.matchBinding} matches=${matchingRows.length}`,
        ),
      );
      for (const value of expectation.values) {
        const actual = matchingRows[0]
          ? derivedReportPathValue(matchingRows[0], value.responsePath)
          : undefined;
        const expected = derivedReportBindingValue(value.binding);
        assertions.push(
          check(
            `derived report row reconciles ${value.responsePath.join('.')} to its source aggregate`,
            matchingRows.length === 1 && reportValueEqual(actual, expected),
            `binding=${value.binding} expected=${String(expected)} actual=${String(actual)}`,
          ),
        );
      }
    }

    for (const expectation of fixture.oracle.pathMarkers ?? []) {
      const subtree = derivedReportPathValue(payload, expectation.responsePath);
      const presentAtPath = expectation.presentBindings.map((binding) => ({
        binding,
        value: derivedReportBindingValue(binding),
      }));
      const absentAtPath = expectation.absentBindings.map((binding) => ({
        binding,
        value: derivedReportBindingValue(binding),
      }));
      assertions.push(
        check(
          `derived report ${expectation.responsePath.join('.')} contains its signed causal values`,
          presentAtPath.every((marker) => containsScalar(subtree, marker.value)),
          `missing=${JSON.stringify(
            presentAtPath
              .filter((marker) => !containsScalar(subtree, marker.value))
              .map((marker) => marker.binding),
          )}`,
        ),
        check(
          `derived report ${expectation.responsePath.join('.')} excludes its signed causal values`,
          absentAtPath.every((marker) => !containsScalar(subtree, marker.value)),
          `unexpected=${JSON.stringify(
            absentAtPath
              .filter((marker) => containsScalar(subtree, marker.value))
              .map((marker) => marker.binding),
          )}`,
        ),
      );
    }

    return assertions;
  }

  function derivedReportPayload(body: unknown): unknown {
    return isRecord(body) && body.data !== undefined ? body.data : body;
  }

  function reportValueEqual(left: unknown, right: unknown): boolean {
    if (databaseValueEqual(left, right)) return true;
    const numberValue = typeof left === 'number' ? left : typeof right === 'number' ? right : null;
    const stringValue = typeof left === 'string' ? left : typeof right === 'string' ? right : null;
    if (numberValue === null || !Number.isFinite(numberValue) || stringValue === null) return false;
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(stringValue)) return false;
    try {
      return new Prisma.Decimal(numberValue).equals(new Prisma.Decimal(stringValue));
    } catch {
      return false;
    }
  }

  function requiredWestsidesReportReadSeed(): CrudWestsidesReportReadSeed {
    if (!westsidesReportReadSeed) {
      throw new Error('Westsides report read controls were not seeded.');
    }
    return westsidesReportReadSeed;
  }

  function westsidesReportArguments(
    fixture: CrudWestsidesReportReadFixtureRegistration,
    company: 'A' | 'B',
  ) {
    const seed = requiredWestsidesReportReadSeed();
    const companyId = company === 'A' ? companyAId : companyBId;
    const branchId = company === 'A' ? seed.branchAId : seed.branchBId;
    const date = company === 'A' ? seed.salesDateA : seed.salesDateB;
    const query =
      fixture.requestKind === 'daily-close'
        ? { companyId, branchId, date }
        : {
            companyId,
            branchId,
            dateFrom: `${date}T00:00:00.000Z`,
            dateTo: `${date}T23:59:59.999Z`,
          };
    return { path: {}, query };
  }

  function westsidesReportBinding(binding: string): unknown {
    const seed = requiredWestsidesReportReadSeed();
    if (!seed.bindings.has(binding)) {
      throw new Error(`Westsides report binding ${binding} was not seeded.`);
    }
    return seed.bindings.get(binding);
  }

  function westsidesReportOracleAssertions(
    label: 'company A' | 'company B',
    payload: unknown,
    oracle: CrudWestsidesReportRowOracle,
  ): CrudEvidenceAssertion[] {
    const collection = derivedReportPathValue(payload, oracle.collectionPath);
    const rows = Array.isArray(collection) ? collection.filter(isRecord) : [];
    const expectedMatch = westsidesReportBinding(oracle.match.binding);
    const matchingRows = rows.filter((row) =>
      reportValueEqual(derivedReportPathValue(row, oracle.match.path), expectedMatch),
    );
    const assertions = [
      check(
        `${label} report exposes the signed row collection`,
        Array.isArray(collection),
        `collectionPath=${oracle.collectionPath.join('.') || '<root>'}`,
      ),
      check(
        `${label} report contains exactly one signed causal row`,
        matchingRows.length === 1,
        `binding=${oracle.match.binding} matches=${matchingRows.length}`,
      ),
    ];
    for (const field of oracle.fields) {
      const expected = westsidesReportBinding(field.binding);
      const actual = matchingRows[0]
        ? derivedReportPathValue(matchingRows[0], field.path)
        : undefined;
      assertions.push(
        check(
          `${label} report reconciles ${field.path.join('.')} to its source aggregate`,
          matchingRows.length === 1 && reportValueEqual(actual, expected),
          `binding=${field.binding} expected=${String(expected)} actual=${String(actual)}`,
        ),
      );
    }
    return assertions;
  }

  async function westsidesReportReadAssertions(
    fixture: CrudWestsidesReportReadFixtureRegistration,
    companyAResult: InvocationResult,
    companyBResult: InvocationResult,
    companyBDenied: InvocationResult,
  ): Promise<CrudEvidenceAssertion[]> {
    const companyAPayload = derivedReportPayload(companyAResult.body);
    const companyBPayload = derivedReportPayload(companyBResult.body);
    const companyBMatch = westsidesReportBinding(fixture.companyBOracle.match.binding);
    const companyACollection = derivedReportPathValue(
      companyAPayload,
      fixture.companyAOracle.collectionPath,
    );
    const companyARows = Array.isArray(companyACollection)
      ? companyACollection.filter(isRecord)
      : [];

    return [
      check(
        'HTTP company-A Westsides report returned 2xx',
        companyAResult.ok,
        statusDetail(companyAResult),
      ),
      check(
        'HTTP company-B Westsides control report returned 2xx',
        companyBResult.ok,
        statusDetail(companyBResult),
      ),
      check(
        'Westsides report fixture remains explicitly company-scoped',
        fixture.governance.scope === 'company' &&
          fixture.execution.companyA === 'company' &&
          fixture.execution.companyB === 'group' &&
          fixture.execution.foreignCompanyProbe.principal === 'company',
      ),
      ...westsidesReportOracleAssertions('company A', companyAPayload, fixture.companyAOracle),
      ...westsidesReportOracleAssertions('company B', companyBPayload, fixture.companyBOracle),
      check(
        'company-A report excludes the signed company-B causal row',
        !companyARows.some((row) =>
          reportValueEqual(
            derivedReportPathValue(row, fixture.companyBOracle.match.path),
            companyBMatch,
          ),
        ),
        `foreignBinding=${fixture.companyBOracle.match.binding}`,
      ),
      check(
        'company-A principal cannot substitute the signed company-B scope',
        !companyBDenied.ok &&
          companyBDenied.status === fixture.execution.foreignCompanyProbe.expectedStatus,
        statusDetail(companyBDenied),
      ),
    ];
  }

  function derivedReportPathValue(value: unknown, path: readonly string[]): unknown {
    let current = value;
    for (const segment of path) {
      if (!isRecord(current)) return undefined;
      current = current[segment];
    }
    return current;
  }

  function boundArguments(
    bindings: readonly {
      name: string;
      binding?: CrudPathReadBinding;
      literal?: string | number | boolean;
    }[],
  ): Record<string, string | number | boolean> {
    return Object.fromEntries(
      bindings.map((argument) => {
        if (argument.binding) {
          const value = pathReadValues.get(argument.binding);
          if (value === undefined) {
            throw new Error(`CRUD path-read binding ${argument.binding} was not seeded.`);
          }
          return [argument.name, value];
        }
        if (argument.literal !== undefined) return [argument.name, argument.literal];
        throw new Error(`CRUD path-read argument ${argument.name} has no value.`);
      }),
    );
  }

  function boundDomainHeaderArguments(
    bindings: readonly {
      name: string;
      binding?: CrudDomainHeaderBinding;
      literal?: string | number | boolean;
    }[],
  ): Record<string, string | number | boolean> {
    return Object.fromEntries(
      bindings.map((argument) => {
        if (argument.binding) {
          const value = domainHeaderBindingValue(argument.binding);
          if (value === undefined) {
            throw new Error(`CRUD domain/header binding ${argument.binding} was not seeded.`);
          }
          return [argument.name, value];
        }
        if (argument.literal !== undefined) return [argument.name, argument.literal];
        throw new Error(`CRUD domain/header argument ${argument.name} has no value.`);
      }),
    );
  }

  function domainHeaderBindingValue(
    bindingName: CrudDomainHeaderBinding,
  ): string | number | boolean | undefined {
    if (bindingName === 'agentSessionA') return agentSessionId;
    return pathReadValues.get(bindingName);
  }

  async function domainHeaderReadAssertions(
    fixture: CrudDomainHeaderFixtureRegistration,
    result: InvocationResult,
    scopeProbe?: InvocationResult,
  ): Promise<CrudEvidenceAssertion[]> {
    const exposedCompanyIds = collectExposedCompanyIds(result.body);
    const foreignCompanyIds = exposedCompanyIds.filter((companyId) => companyId !== companyAId);
    const bindsCompanyA = fixture.queryBindings.some(
      (argument) => argument.name === 'companyId' && argument.binding === 'companyA',
    );
    const classifiedCompanyScope =
      fixture.governance.scope === 'company' || fixture.governance.scope === 'seeded-company';
    const executionMatchesScope =
      fixture.governance.scope === 'global'
        ? fixture.executionPrincipal === 'group' && !bindsCompanyA
        : fixture.governance.scope === 'actor'
          ? fixture.executionPrincipal === 'actor'
          : fixture.governance.scope === 'seeded-company'
            ? fixture.executionPrincipal === 'company' && Boolean(fixture.expectedResponseBinding)
            : fixture.governance.scope === 'company' &&
              (fixture.executionPrincipal === 'company' || bindsCompanyA);
    const oracleMatchesScope =
      !fixture.scopeOracle ||
      (fixture.scopeOracle.kind === 'response_markers'
        ? fixture.scopeOracle.scope === fixture.governance.scope
        : fixture.governance.scope === 'company' &&
          fixture.scopeOracle.deniedCompanyBinding === 'companyB');
    const assertions = [
      check('HTTP domain/header read returned 2xx', result.ok, statusDetail(result)),
      check(
        'domain/header read returned a non-null payload',
        result.body !== null && result.body !== undefined,
      ),
    ];

    if (fixture.governance.scope !== 'unclassified') {
      assertions.push(
        check(
          'domain/header scope classification matches its reviewed execution binding',
          executionMatchesScope && oracleMatchesScope,
        ),
      );
    }

    if (classifiedCompanyScope || fixture.governance.scope === 'unclassified') {
      assertions.push(
        check(
          'domain/header response exposed no record from another company',
          foreignCompanyIds.length === 0,
          foreignCompanyIds.length > 0
            ? `foreignCompanyIds=${JSON.stringify([...new Set(foreignCompanyIds)].sort())}`
            : `observedCompanyIds=${JSON.stringify([...new Set(exposedCompanyIds)].sort())}`,
        ),
      );
    }

    if (fixture.expectedResponseBinding) {
      const expected = domainHeaderBindingValue(fixture.expectedResponseBinding);
      assertions.push(
        check(
          'domain/header response contains the exact isolated seed',
          expected !== undefined && containsScalar(result.body, expected),
        ),
      );
    }
    if (fixture.scopeOracle?.kind === 'response_markers') {
      const present = fixture.scopeOracle.presentBindings.map(domainHeaderBindingValue);
      const absent = fixture.scopeOracle.absentBindings.map(domainHeaderBindingValue);
      assertions.push(
        check(
          'domain/header response contains every signed in-scope causal marker',
          present.length > 0 &&
            present.every(
              (expected) => expected !== undefined && containsScalar(result.body, expected),
            ),
        ),
        check(
          'domain/header response excludes every signed out-of-scope causal marker',
          absent.every(
            (expected) => expected !== undefined && !containsScalar(result.body, expected),
          ),
        ),
      );
    }
    if (fixture.scopeOracle?.kind === 'denied_request') {
      const targetsCompanyB = fixture.scopeOracle.queryBindings.some(
        (argument) =>
          argument.binding === 'companyB' ||
          fixture.scopeOracle?.controls.some(
            (control) =>
              control.binding === argument.binding && control.companyBinding === 'companyB',
          ),
      );
      assertions.push(
        check(
          'domain/header company-B probe is bound to a real signed foreign tenant control',
          targetsCompanyB,
        ),
        check(
          'domain/header company-B probe was denied with the exact reviewed status',
          scopeProbe !== undefined &&
            !scopeProbe.ok &&
            scopeProbe.status === fixture.scopeOracle.expectedStatus,
          scopeProbe ? statusDetail(scopeProbe) : 'scope probe did not execute',
        ),
      );
    }
    return assertions;
  }

  function containsScalar(value: unknown, expected: unknown, depth = 0): boolean {
    if (reportValueEqual(value, expected)) return true;
    if (depth > 12 || value === null || value === undefined) return false;
    if (Array.isArray(value)) {
      return value.some((item) => containsScalar(item, expected, depth + 1));
    }
    if (typeof value !== 'object') return false;
    return Object.values(value as Record<string, unknown>).some((item) =>
      containsScalar(item, expected, depth + 1),
    );
  }

  async function pathReadAssertions(
    fixture: CrudPathReadFixtureRegistration,
    result: InvocationResult,
  ): Promise<CrudEvidenceAssertion[]> {
    const record = unwrapRecord(result.body);
    const rows = unwrapList(result.body);
    const assertions = [
      check('HTTP path-record read returned 2xx', result.ok, statusDetail(result)),
      check(
        'path-record read returned a non-null payload',
        result.body !== null && result.body !== undefined,
      ),
    ];

    if (fixture.response.identity) {
      const expected = pathReadValues.get(fixture.response.identity.binding);
      const identityMatches =
        fixture.response.kind === 'collection'
          ? rows.some(
              (row) => nestedValue(row, fixture.response.identity!.responsePath) === expected,
            )
          : nestedValue(record, fixture.response.identity.responsePath) === expected;
      assertions.push(
        check(
          'response contains the exact seeded record identity',
          expected !== undefined && identityMatches,
        ),
      );
    }

    assertions.push(
      pathReadScopeAssertion(fixture.response.scope, fixture.response.kind, record, rows),
    );
    return assertions;
  }

  function pathReadScopeAssertion(
    scope: CrudPathReadScopeAssertion,
    responseKind: 'record' | 'collection' | 'payload',
    record: Record<string, unknown>,
    rows: Array<Record<string, unknown>>,
  ): CrudEvidenceAssertion {
    if (scope.kind === 'global') {
      return check('route is explicitly classified as global rather than company-owned', true);
    }
    if (scope.kind === 'seeded-company') {
      const seed = seededModels.get(scope.seedModel);
      const expected = pathReadValues.get(scope.binding);
      return check(
        'path parent remained bound to the seeded company scope',
        Boolean(seed) && nestedValue(seed!, scope.seedCompanyPath) === expected,
      );
    }
    const expected = pathReadValues.get(scope.binding);
    const values =
      responseKind === 'collection'
        ? rows.map((row) => nestedValue(row, scope.responsePath))
        : [nestedValue(record, scope.responsePath)];
    return check(
      scope.kind === 'company'
        ? 'response remained in the seeded company scope'
        : 'response remained scoped to the seeded actor',
      expected !== undefined && values.length > 0 && values.every((value) => value === expected),
    );
  }

  async function databaseMutationSentinel() {
    const schemaRows = await prisma.$queryRaw<Array<{ schema_name: string }>>`
      SELECT current_schema()::text AS schema_name
    `;
    const schemaName = schemaRows[0]?.schema_name;
    if (!schemaName || !/^msaidizi_crud_evidence_[a-z0-9_]{8,80}$/.test(schemaName)) {
      throw new Error(`Unexpected CRUD evidence schema ${schemaName ?? '<missing>'}.`);
    }
    const attestedSchemaName = requiredEnv('CRUD_COVERAGE_SCHEMA');
    if (schemaName !== attestedSchemaName) {
      throw new Error(
        `CRUD evidence connection schema ${schemaName} does not match the attested runner schema ${attestedSchemaName}.`,
      );
    }
    const internalStateTable = '__msaidizi_evidence_table_state';
    const allTables = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT tablename::text AS table_name
      FROM pg_catalog.pg_tables
      WHERE schemaname = current_schema()
      ORDER BY tablename
    `;
    const stateAlreadyInstalled = allTables.some((row) => row.table_name === internalStateTable);
    const tables = allTables.filter((row) => row.table_name !== internalStateTable);
    if (tables.some((row) => !/^[a-zA-Z0-9_]+$/.test(row.table_name))) {
      throw new Error('CRUD evidence schema contains an unsafe table identifier.');
    }
    if (tables.length === 0) throw new Error('CRUD evidence schema has no tables to snapshot.');
    const tableNames = new Set(tables.map((row) => row.table_name));
    if (tableNames.size !== tables.length) {
      throw new Error('CRUD evidence schema table enumeration contains duplicates.');
    }
    const missingModelTables = Prisma.dmmf.datamodel.models
      .map((model) => model.dbName ?? model.name)
      .filter((tableName) => !tableNames.has(tableName))
      .sort();
    if (missingModelTables.length > 0) {
      throw new Error(
        `CRUD evidence schema is missing Prisma model tables: ${missingModelTables.join(', ')}`,
      );
    }

    const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const sequences = await prisma.$queryRaw<
      Array<{
        sequence_name: string;
        sequence_cache: string;
        sequence_increment: string;
        sequence_min: string;
        sequence_max: string;
        sequence_start: string;
        sequence_cycle: boolean;
        sequence_type: string;
      }>
    >`
      SELECT
        c.relname::text AS sequence_name,
        s.seqcache::text AS sequence_cache,
        s.seqincrement::text AS sequence_increment,
        s.seqmin::text AS sequence_min,
        s.seqmax::text AS sequence_max,
        s.seqstart::text AS sequence_start,
        s.seqcycle AS sequence_cycle,
        pg_catalog.format_type(s.seqtypid, NULL)::text AS sequence_type
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_catalog.pg_sequence s ON s.seqrelid = c.oid
      WHERE n.nspname = current_schema() AND c.relkind = 'S'
      ORDER BY c.relname
    `;
    if (sequences.some((row) => !/^[a-zA-Z0-9_]+$/.test(row.sequence_name))) {
      throw new Error('CRUD evidence schema contains an unsafe sequence identifier.');
    }
    if (sequences.some((row) => row.sequence_cache !== '1')) {
      throw new Error('CRUD evidence sequences must use CACHE 1 for exact nextval tracking.');
    }
    if (!stateAlreadyInstalled) {
      await installIncrementalDatabaseSentinel(
        schemaName,
        tables.map((row) => row.table_name),
      );
    }
    await assertIncrementalDatabaseSentinelBindings(
      schemaName,
      tables.map((row) => row.table_name),
    );
    const snapshot = await prisma.$queryRawUnsafe<
      Array<{ table_name: string; row_count: string; row_digest: string }>
    >(
      `SELECT "tableName"::text AS table_name, "rowCount"::text AS row_count, ` +
        `MD5(CONCAT_WS(':', "rowCount"::text, "sum0"::text, "sum1"::text, ` +
        `"sum2"::text, "sum3"::text, "truncateCount"::text)) AS row_digest ` +
        `FROM ${quote(schemaName)}.${quote(internalStateTable)} ORDER BY "tableName"`,
    );
    const sequenceUnion = sequences
      .map(
        ({ sequence_name: sequenceName }) =>
          `SELECT '${sequenceName.replace(/'/g, "''")}'::text AS sequence_name, ` +
          `last_value::text AS last_value, is_called ` +
          `FROM ${quote(schemaName)}.${quote(sequenceName)}`,
      )
      .join(' UNION ALL ');
    const sequenceStates = sequenceUnion
      ? await prisma.$queryRawUnsafe<
          Array<{ sequence_name: string; last_value: string; is_called: boolean }>
        >(sequenceUnion)
      : [];
    const sequenceSnapshot = sequenceStates.map((state) => {
      if (!/^-?\d+$/.test(state.last_value) || typeof state.is_called !== 'boolean') {
        throw new Error(`CRUD evidence sequence ${state.sequence_name} state is malformed.`);
      }
      return {
        table_name: `__sequence__${state.sequence_name}`,
        row_count: '1',
        row_digest: createHash('md5')
          .update(`${state.last_value}:${state.is_called ? 'called' : 'uncalled'}`, 'utf8')
          .digest('hex'),
      };
    });
    const snapshotNames = new Set(snapshot.map((row) => row.table_name));
    if (
      snapshot.length !== tables.length ||
      snapshotNames.size !== snapshot.length ||
      [...tableNames].some((tableName) => !snapshotNames.has(tableName)) ||
      snapshot.some((row) => !/^\d+$/.test(row.row_count) || !/^[a-f0-9]{32}$/.test(row.row_digest))
    ) {
      throw new Error('CRUD evidence full-schema scalar snapshot is incomplete or malformed.');
    }
    const catalogState = await databaseCatalogState(schemaName);
    const catalogSnapshot = {
      table_name: '__catalog__',
      row_count: String(catalogState.length),
      row_digest: createHash('sha256').update(canonicalJson(catalogState), 'utf8').digest('hex'),
    };
    return [...snapshot, ...sequenceSnapshot, catalogSnapshot].sort((left, right) =>
      left.table_name.localeCompare(right.table_name),
    );
  }

  async function assertDatabaseMutationSentinelSemantics(): Promise<void> {
    const schemaName = requiredEnv('CRUD_COVERAGE_SCHEMA');
    const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const reportDefinition = seededModels.get('ReportDefinition');
    const reportDefinitionId = reportDefinition?.id;
    if (typeof reportDefinitionId !== 'string' || !reportDefinitionId) {
      throw new Error('CRUD evidence sentinel probe lacks its seeded ReportDefinition row.');
    }
    const table = `${quote(schemaName)}.${quote('report_definitions')}`;
    const baseline = await databaseMutationSentinel();
    const initial = await prisma.$queryRawUnsafe<Array<{ is_database_null: boolean }>>(
      `SELECT ("defaultFilters" IS NULL) AS is_database_null FROM ${table} WHERE "id" = $1`,
      reportDefinitionId,
    );
    if (initial.length !== 1 || initial[0].is_database_null !== true) {
      throw new Error('CRUD evidence sentinel probe must begin with a database NULL JSON field.');
    }

    await prisma.$executeRawUnsafe(
      `UPDATE ${table} SET "defaultFilters" = 'null'::jsonb WHERE "id" = $1`,
      reportDefinitionId,
    );
    const jsonNullState = await databaseMutationSentinel();
    if (!changedDatabaseTables(baseline, jsonNullState).includes('report_definitions')) {
      throw new Error('CRUD evidence sentinel collapsed database NULL and JSON literal null.');
    }
    await prisma.$executeRawUnsafe(
      `UPDATE ${table} SET "defaultFilters" = NULL WHERE "id" = $1`,
      reportDefinitionId,
    );
    const nullRestored = await databaseMutationSentinel();
    if (canonicalJson(nullRestored) !== canonicalJson(baseline)) {
      throw new Error('CRUD evidence sentinel JSON-null probe did not restore exact state.');
    }

    await prisma.$executeRawUnsafe(
      `ALTER TABLE ${table} DISABLE TRIGGER "__msaidizi_evidence_row_state"`,
    );
    let disabledTriggerRejected = false;
    try {
      await databaseMutationSentinel();
    } catch (error) {
      disabledTriggerRejected = safeError(error).includes(
        'incremental sentinel trigger bindings are incomplete',
      );
    } finally {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE ${table} ENABLE TRIGGER "__msaidizi_evidence_row_state"`,
      );
    }
    if (!disabledTriggerRejected) {
      throw new Error('CRUD evidence sentinel accepted a disabled row-tracking trigger.');
    }
    const triggerRestored = await databaseMutationSentinel();
    if (canonicalJson(triggerRestored) !== canonicalJson(baseline)) {
      throw new Error(
        'CRUD evidence sentinel trigger-integrity probe did not restore exact state.',
      );
    }
  }

  async function installIncrementalDatabaseSentinel(
    schemaName: string,
    tableNames: string[],
  ): Promise<void> {
    const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const schema = quote(schemaName);
    const stateTable = quote('__msaidizi_evidence_table_state');
    const triggerFunction = quote('__msaidizi_evidence_track_table_state');
    const fingerprintPrime = '1152921504606846883';
    const tableColumns = await evidenceTableColumns(schemaName, tableNames);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE ${schema}.${stateTable} (
        "tableName" TEXT PRIMARY KEY,
        "rowCount" BIGINT NOT NULL,
        "sum0" NUMERIC NOT NULL,
        "sum1" NUMERIC NOT NULL,
        "sum2" NUMERIC NOT NULL,
        "sum3" NUMERIC NOT NULL,
        "truncateCount" BIGINT NOT NULL DEFAULT 0
      )
    `);
    const initialStateUnion = tableNames
      .map((tableName) => {
        const columns = tableColumns.get(tableName);
        if (!columns?.length) {
          throw new Error(`CRUD evidence table ${tableName} has no tracked columns.`);
        }
        const nullBitmap = `CONCAT(${columns
          .map((column) => `((t.${quote(column)} IS NULL)::int)::text`)
          .join(', ')})`;
        return `
          SELECT
            '${tableName.replace(/'/g, "''")}'::text AS table_name,
            COUNT(*)::bigint AS row_count,
            MOD(COALESCE(SUM((('x' || SUBSTR(row_hash, 1, 15))::bit(60)::bigint)::numeric), 0), ${fingerprintPrime}) AS sum0,
            MOD(COALESCE(SUM((('x' || SUBSTR(row_hash, 16, 15))::bit(60)::bigint)::numeric), 0), ${fingerprintPrime}) AS sum1,
            MOD(COALESCE(SUM((('x' || SUBSTR(row_hash, 31, 15))::bit(60)::bigint)::numeric), 0), ${fingerprintPrime}) AS sum2,
            MOD(COALESCE(SUM((('x' || SUBSTR(row_hash, 46, 15))::bit(60)::bigint)::numeric), 0), ${fingerprintPrime}) AS sum3
          FROM (
            SELECT
              MD5('msaidizi-evidence-0:' || ${nullBitmap} || ':' || TO_JSONB(t)::text) ||
              MD5('msaidizi-evidence-1:' || ${nullBitmap} || ':' || TO_JSONB(t)::text) AS row_hash
            FROM ${schema}.${quote(tableName)} AS t
          ) AS fingerprints
        `;
      })
      .join(' UNION ALL ');
    await prisma.$executeRawUnsafe(`
      INSERT INTO ${schema}.${stateTable}
        ("tableName", "rowCount", "sum0", "sum1", "sum2", "sum3")
      ${initialStateUnion}
    `);
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION ${schema}.${triggerFunction}()
      RETURNS TRIGGER
      LANGUAGE plpgsql
      AS $msaidizi_evidence$
      DECLARE
        row_hash TEXT;
        null_bitmap TEXT;
        part0 NUMERIC;
        part1 NUMERIC;
        part2 NUMERIC;
        part3 NUMERIC;
        fingerprint_prime CONSTANT NUMERIC := ${fingerprintPrime};
      BEGIN
        IF TG_OP = 'TRUNCATE' THEN
          UPDATE ${schema}.${stateTable}
          SET "truncateCount" = "truncateCount" + 1
          WHERE "tableName" = TG_TABLE_NAME;
          RETURN NULL;
        END IF;

        IF TG_OP IN ('DELETE', 'UPDATE') THEN
          EXECUTE 'SELECT ' || TG_ARGV[0] INTO null_bitmap USING OLD;
          row_hash :=
            MD5('msaidizi-evidence-0:' || null_bitmap || ':' || TO_JSONB(OLD)::text) ||
            MD5('msaidizi-evidence-1:' || null_bitmap || ':' || TO_JSONB(OLD)::text);
          part0 := (('x' || SUBSTR(row_hash, 1, 15))::bit(60)::bigint)::numeric;
          part1 := (('x' || SUBSTR(row_hash, 16, 15))::bit(60)::bigint)::numeric;
          part2 := (('x' || SUBSTR(row_hash, 31, 15))::bit(60)::bigint)::numeric;
          part3 := (('x' || SUBSTR(row_hash, 46, 15))::bit(60)::bigint)::numeric;
          UPDATE ${schema}.${stateTable}
          SET
            "rowCount" = "rowCount" - 1,
            "sum0" = MOD("sum0" - part0 + fingerprint_prime * 2, fingerprint_prime),
            "sum1" = MOD("sum1" - part1 + fingerprint_prime * 2, fingerprint_prime),
            "sum2" = MOD("sum2" - part2 + fingerprint_prime * 2, fingerprint_prime),
            "sum3" = MOD("sum3" - part3 + fingerprint_prime * 2, fingerprint_prime)
          WHERE "tableName" = TG_TABLE_NAME;
        END IF;

        IF TG_OP IN ('INSERT', 'UPDATE') THEN
          EXECUTE 'SELECT ' || TG_ARGV[0] INTO null_bitmap USING NEW;
          row_hash :=
            MD5('msaidizi-evidence-0:' || null_bitmap || ':' || TO_JSONB(NEW)::text) ||
            MD5('msaidizi-evidence-1:' || null_bitmap || ':' || TO_JSONB(NEW)::text);
          part0 := (('x' || SUBSTR(row_hash, 1, 15))::bit(60)::bigint)::numeric;
          part1 := (('x' || SUBSTR(row_hash, 16, 15))::bit(60)::bigint)::numeric;
          part2 := (('x' || SUBSTR(row_hash, 31, 15))::bit(60)::bigint)::numeric;
          part3 := (('x' || SUBSTR(row_hash, 46, 15))::bit(60)::bigint)::numeric;
          UPDATE ${schema}.${stateTable}
          SET
            "rowCount" = "rowCount" + 1,
            "sum0" = MOD("sum0" + part0, fingerprint_prime),
            "sum1" = MOD("sum1" + part1, fingerprint_prime),
            "sum2" = MOD("sum2" + part2, fingerprint_prime),
            "sum3" = MOD("sum3" + part3, fingerprint_prime)
          WHERE "tableName" = TG_TABLE_NAME;
        END IF;
        RETURN NULL;
      END;
      $msaidizi_evidence$
    `);
    for (const tableName of tableNames) {
      const table = `${schema}.${quote(tableName)}`;
      const columns = tableColumns.get(tableName);
      if (!columns?.length) {
        throw new Error(`CRUD evidence table ${tableName} has no tracked columns.`);
      }
      const triggerNullBitmapExpression = `CONCAT(${columns
        .map((column) => `((($1).${quote(column)} IS NULL)::int)::text`)
        .join(', ')})`;
      const triggerArgument = triggerNullBitmapExpression.replace(/'/g, "''");
      await prisma.$executeRawUnsafe(`
        CREATE TRIGGER "__msaidizi_evidence_row_state"
        AFTER INSERT OR UPDATE OR DELETE ON ${table}
        FOR EACH ROW EXECUTE FUNCTION ${schema}.${triggerFunction}('${triggerArgument}')
      `);
      await prisma.$executeRawUnsafe(`
        CREATE TRIGGER "__msaidizi_evidence_truncate_state"
        AFTER TRUNCATE ON ${table}
        FOR EACH STATEMENT EXECUTE FUNCTION ${schema}.${triggerFunction}()
      `);
    }
  }

  async function evidenceTableColumns(
    schemaName: string,
    tableNames: readonly string[],
  ): Promise<Map<string, string[]>> {
    const rows = await prisma.$queryRawUnsafe<Array<{ table_name: string; column_name: string }>>(
      `SELECT c.relname::text AS table_name, a.attname::text AS column_name
       FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
       WHERE n.nspname = $1
         AND c.relkind IN ('r', 'p')
         AND a.attnum > 0
         AND NOT a.attisdropped
       ORDER BY c.relname, a.attnum`,
      schemaName,
    );
    const expected = new Set(tableNames);
    const columns = new Map<string, string[]>();
    for (const row of rows) {
      if (!expected.has(row.table_name)) continue;
      if (!/^[a-zA-Z0-9_]+$/.test(row.table_name) || !row.column_name) {
        throw new Error('CRUD evidence catalog returned an unsafe table column.');
      }
      const existing = columns.get(row.table_name) ?? [];
      existing.push(row.column_name);
      columns.set(row.table_name, existing);
    }
    if (
      columns.size !== expected.size ||
      [...expected].some((tableName) => !(columns.get(tableName)?.length ?? 0))
    ) {
      throw new Error('CRUD evidence catalog did not resolve every monitored table column.');
    }
    return columns;
  }

  async function assertIncrementalDatabaseSentinelBindings(
    schemaName: string,
    tableNames: readonly string[],
  ): Promise<void> {
    const rows = await prisma.$queryRawUnsafe<
      Array<{
        table_name: string;
        trigger_name: string;
        enabled: string;
        trigger_type: number;
        function_schema: string;
        function_name: string;
        trigger_arguments: string;
      }>
    >(
      `SELECT
         c.relname::text AS table_name,
         t.tgname::text AS trigger_name,
         t.tgenabled::text AS enabled,
         t.tgtype::int AS trigger_type,
         fn.nspname::text AS function_schema,
         p.proname::text AS function_name,
         pg_catalog.encode(t.tgargs, 'escape')::text AS trigger_arguments
       FROM pg_catalog.pg_trigger t
       JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
       JOIN pg_catalog.pg_namespace fn ON fn.oid = p.pronamespace
       WHERE n.nspname = $1
         AND NOT t.tgisinternal
         AND t.tgname IN ('__msaidizi_evidence_row_state', '__msaidizi_evidence_truncate_state')
       ORDER BY c.relname, t.tgname`,
      schemaName,
    );
    const expectedTables = new Set(tableNames);
    const byTable = new Map<string, typeof rows>();
    for (const row of rows) {
      const existing = byTable.get(row.table_name) ?? [];
      existing.push(row);
      byTable.set(row.table_name, existing);
    }
    const valid =
      rows.length === tableNames.length * 2 &&
      byTable.size === expectedTables.size &&
      [...expectedTables].every((tableName) => {
        const bindings = byTable.get(tableName) ?? [];
        const rowTrigger = bindings.find(
          (binding) => binding.trigger_name === '__msaidizi_evidence_row_state',
        );
        const truncateTrigger = bindings.find(
          (binding) => binding.trigger_name === '__msaidizi_evidence_truncate_state',
        );
        const common = (binding: (typeof rows)[number] | undefined) =>
          binding?.enabled === 'O' &&
          binding.function_schema === schemaName &&
          binding.function_name === '__msaidizi_evidence_track_table_state';
        return (
          common(rowTrigger) &&
          rowTrigger?.trigger_type === 29 &&
          rowTrigger.trigger_arguments.length > 0 &&
          common(truncateTrigger) &&
          truncateTrigger?.trigger_type === 32 &&
          truncateTrigger.trigger_arguments.length === 0
        );
      });
    if (!valid) {
      throw new Error('CRUD evidence incremental sentinel trigger bindings are incomplete.');
    }
  }

  type DatabaseCatalogStateRow = {
    kind: string;
    object_name: string;
    definition: string;
  };

  async function databaseCatalogState(schemaName: string): Promise<DatabaseCatalogStateRow[]> {
    const queries = [
      `SELECT 'relation'::text AS kind,
              c.relname::text AS object_name,
              pg_catalog.jsonb_build_array(
                c.relkind, c.relpersistence, c.relrowsecurity, c.relforcerowsecurity,
                c.relreplident, c.reloptions, am.amname, ts.spcname,
                CASE WHEN c.relkind IN ('v', 'm') THEN pg_catalog.pg_get_viewdef(c.oid, true) ELSE NULL END
              )::text AS definition
       FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       LEFT JOIN pg_catalog.pg_am am ON am.oid = c.relam
       LEFT JOIN pg_catalog.pg_tablespace ts ON ts.oid = c.reltablespace
       WHERE n.nspname = $1 AND c.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')`,
      `SELECT 'column'::text AS kind,
              (c.relname || ':' || a.attnum::text)::text AS object_name,
              pg_catalog.jsonb_build_array(
                a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod), a.attnotnull,
                a.attidentity, a.attgenerated, a.attcollation::regcollation::text,
                a.attstorage, a.attcompression,
                pg_catalog.pg_get_expr(d.adbin, d.adrelid, true)
              )::text AS definition
       FROM pg_catalog.pg_attribute a
       JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
       WHERE n.nspname = $1 AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
         AND a.attnum > 0 AND NOT a.attisdropped`,
      `SELECT 'constraint'::text AS kind,
              (COALESCE(c.relname, '') || ':' || con.conname)::text AS object_name,
              pg_catalog.jsonb_build_array(
                con.contype, con.condeferrable, con.condeferred, con.convalidated,
                pg_catalog.pg_get_constraintdef(con.oid, true)
              )::text AS definition
       FROM pg_catalog.pg_constraint con
       JOIN pg_catalog.pg_namespace n ON n.oid = con.connamespace
       LEFT JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
       WHERE n.nspname = $1`,
      `SELECT 'index'::text AS kind,
              (t.relname || ':' || i.relname)::text AS object_name,
              pg_catalog.jsonb_build_array(
                x.indisunique, x.indisprimary, x.indisexclusion, x.indimmediate,
                x.indisclustered, x.indisvalid, x.indcheckxmin, x.indisready,
                x.indislive, x.indisreplident, pg_catalog.pg_get_indexdef(i.oid)
              )::text AS definition
       FROM pg_catalog.pg_index x
       JOIN pg_catalog.pg_class i ON i.oid = x.indexrelid
       JOIN pg_catalog.pg_class t ON t.oid = x.indrelid
       JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
       WHERE n.nspname = $1`,
      `SELECT 'trigger'::text AS kind,
              (c.relname || ':' || t.tgname)::text AS object_name,
              pg_catalog.jsonb_build_array(
                t.tgenabled, t.tgisinternal, t.tgtype,
                fn.nspname, p.proname, pg_catalog.encode(t.tgargs, 'escape'),
                pg_catalog.pg_get_triggerdef(t.oid, true)
              )::text AS definition
       FROM pg_catalog.pg_trigger t
       JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
       JOIN pg_catalog.pg_namespace fn ON fn.oid = p.pronamespace
       WHERE n.nspname = $1`,
      `SELECT 'routine'::text AS kind,
              (p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')')::text AS object_name,
              pg_catalog.jsonb_build_array(
                p.prokind, p.provolatile, p.proparallel, p.prosecdef, p.proleakproof,
                p.proisstrict, p.proconfig, pg_catalog.pg_get_functiondef(p.oid)
              )::text AS definition
       FROM pg_catalog.pg_proc p
       JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = $1 AND p.prokind IN ('f', 'p')`,
      `SELECT 'type'::text AS kind,
              t.typname::text AS object_name,
              pg_catalog.jsonb_build_array(
                t.typtype, t.typcategory, t.typnotnull,
                pg_catalog.format_type(t.typbasetype, t.typtypmod), t.typdefault,
                t.typcollation::regcollation::text
              )::text AS definition
       FROM pg_catalog.pg_type t
       JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
       WHERE n.nspname = $1`,
      `SELECT 'enum'::text AS kind,
              (t.typname || ':' || e.enumsortorder::text)::text AS object_name,
              e.enumlabel::text AS definition
       FROM pg_catalog.pg_enum e
       JOIN pg_catalog.pg_type t ON t.oid = e.enumtypid
       JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
       WHERE n.nspname = $1`,
      `SELECT 'policy'::text AS kind,
              (c.relname || ':' || p.polname)::text AS object_name,
              pg_catalog.jsonb_build_array(
                p.polcmd, p.polpermissive, p.polroles,
                pg_catalog.pg_get_expr(p.polqual, p.polrelid, true),
                pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid, true)
              )::text AS definition
       FROM pg_catalog.pg_policy p
       JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1`,
      `SELECT 'rule'::text AS kind,
              (c.relname || ':' || r.rulename)::text AS object_name,
              pg_catalog.pg_get_ruledef(r.oid, true)::text AS definition
       FROM pg_catalog.pg_rewrite r
       JOIN pg_catalog.pg_class c ON c.oid = r.ev_class
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1`,
      `SELECT 'sequence'::text AS kind,
              c.relname::text AS object_name,
              pg_catalog.jsonb_build_array(
                pg_catalog.format_type(s.seqtypid, NULL), s.seqstart, s.seqincrement,
                s.seqmax, s.seqmin, s.seqcache, s.seqcycle,
                owner_table.relname, owner_column.attname
              )::text AS definition
       FROM pg_catalog.pg_sequence s
       JOIN pg_catalog.pg_class c ON c.oid = s.seqrelid
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       LEFT JOIN pg_catalog.pg_depend dep
         ON dep.classid = 'pg_catalog.pg_class'::regclass
        AND dep.objid = c.oid
        AND dep.objsubid = 0
        AND dep.deptype IN ('a', 'i')
       LEFT JOIN pg_catalog.pg_class owner_table ON owner_table.oid = dep.refobjid
       LEFT JOIN pg_catalog.pg_attribute owner_column
         ON owner_column.attrelid = dep.refobjid AND owner_column.attnum = dep.refobjsubid
       WHERE n.nspname = $1`,
    ] as const;
    const results = await Promise.all(
      queries.map((query) => prisma.$queryRawUnsafe<DatabaseCatalogStateRow[]>(query, schemaName)),
    );
    return results
      .flat()
      .map((row) => ({
        kind: row.kind,
        object_name: row.object_name,
        definition: row.definition,
      }))
      .sort(
        (left, right) =>
          left.kind.localeCompare(right.kind) ||
          left.object_name.localeCompare(right.object_name) ||
          left.definition.localeCompare(right.definition),
      );
  }

  function databaseMutationDetail(
    before: Array<{ table_name: string; row_count: string; row_digest: string }>,
    after: Array<{ table_name: string; row_count: string; row_digest: string }>,
  ): string {
    const beforeByTable = new Map(before.map((row) => [row.table_name, row]));
    const afterByTable = new Map(after.map((row) => [row.table_name, row]));
    const changedTables = changedDatabaseTables(before, after).map((tableName) => {
      const left = beforeByTable.get(tableName);
      const right = afterByTable.get(tableName);
      return `${tableName}:${left?.row_count ?? '<missing>'}/${left?.row_digest ?? '<missing>'}->${right?.row_count ?? '<missing>'}/${right?.row_digest ?? '<missing>'}`;
    });
    return `before=${sha256Hex(JSON.stringify(before))} after=${sha256Hex(JSON.stringify(after))} changed=${changedTables.join(',') || '<none>'}`;
  }

  function changedDatabaseTables(
    before: Array<{ table_name: string; row_count: string; row_digest: string }>,
    after: Array<{ table_name: string; row_count: string; row_digest: string }>,
  ): string[] {
    const beforeByTable = new Map(before.map((row) => [row.table_name, row]));
    const afterByTable = new Map(after.map((row) => [row.table_name, row]));
    return [...new Set([...beforeByTable.keys(), ...afterByTable.keys()])]
      .sort()
      .filter((tableName) => {
        const left = beforeByTable.get(tableName);
        const right = afterByTable.get(tableName);
        return left?.row_count !== right?.row_count || left?.row_digest !== right?.row_digest;
      });
  }

  function writeUnsignedEvidencePayload() {
    const outputPath = requiredAbsoluteEnv('CRUD_COVERAGE_UNSIGNED_OUTPUT_PATH');
    const schema = requiredEnv('CRUD_COVERAGE_SCHEMA');
    const finalPrismaSchemaMigrationDigest = currentPrismaSchemaMigrationDigest();
    if (finalPrismaSchemaMigrationDigest !== initialPrismaSchemaMigrationDigest) {
      throw new Error('Prisma schema or migrations changed while evidence was executing.');
    }
    const generatedAt = new Date();
    const payload: CrudEvidencePayload = {
      contract: CRUD_EVIDENCE_CONTRACT,
      harnessVersion: CRUD_EVIDENCE_HARNESS_VERSION,
      runId,
      generatedAt: generatedAt.toISOString(),
      expiresAt: new Date(generatedAt.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      manifestDigest: manifestContractDigest(manifest.capabilities()),
      provenance: {
        applicationBuildDigest,
        prismaSchemaMigrationDigest: finalPrismaSchemaMigrationDigest,
      },
      database: {
        disposable: true,
        isolatedSchemaNameDigest: sha256Hex(schema),
      },
      cases: [...cases].sort((left, right) => left.fixtureId.localeCompare(right.fixtureId)),
    };
    const temporaryPath = `${outputPath}.${process.pid}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    renameSync(temporaryPath, outputPath);
  }
});

function assertDisposableHarnessConfiguration() {
  const schema = requiredEnv('CRUD_COVERAGE_SCHEMA');
  if (!/^msaidizi_crud_evidence_[a-z0-9_]{8,80}$/.test(schema)) {
    throw new Error('CRUD_COVERAGE_SCHEMA is not a runner-created isolated evidence schema.');
  }
  requiredAbsoluteEnv('CRUD_COVERAGE_UNSIGNED_OUTPUT_PATH');
  requiredSha256Env('CRUD_COVERAGE_APPLICATION_BUILD_DIGEST');
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required by the CRUD evidence harness.`);
  return value;
}

function requiredAbsoluteEnv(name: string): string {
  const value = requiredEnv(name);
  if (!isAbsolute(value)) throw new Error(`${name} must be an absolute external path.`);
  return value;
}

function requiredSha256Env(name: string): string {
  const value = requiredEnv(name);
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${name} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function currentPrismaSchemaMigrationDigest(): string {
  return prismaSchemaMigrationDigest(resolve(process.cwd(), '../database/prisma'));
}

function deriveRequiredSchemaValues(schema: {
  properties: Record<string, unknown>;
  required?: string[];
}): Record<string, unknown> {
  return Object.fromEntries(
    (schema.required ?? []).map((name) => [name, safeSchemaValue(schema.properties[name], name)]),
  );
}

function safeSchemaValue(schema: unknown, propertyName: string): unknown {
  if (!isRecord(schema)) return `fixture-${propertyName}`;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
  if (schema.type === 'number' || schema.type === 'integer') {
    return typeof schema.minimum === 'number' ? Math.max(schema.minimum, 1) : 1;
  }
  if (schema.type === 'boolean') return false;
  if (schema.type === 'array') return [];
  if (schema.type === 'object' && isRecord(schema.properties)) {
    return deriveRequiredSchemaValues({
      properties: schema.properties,
      required: Array.isArray(schema.required)
        ? schema.required.filter((item): item is string => typeof item === 'string')
        : [],
    });
  }
  if (schema.format === 'date-time' || /date/i.test(propertyName)) {
    return '2026-08-25T00:00:00.000Z';
  }
  return `fixture-${propertyName}`;
}

function unwrapRecord(body: unknown): Record<string, unknown> {
  const first = isRecord(body) && isRecord(body.data) ? body.data : body;
  return isRecord(first) ? first : {};
}

function unwrapList(body: unknown): Array<Record<string, unknown>> {
  const first = isRecord(body) && body.data !== undefined ? body.data : body;
  const list = Array.isArray(first)
    ? first
    : isRecord(first) && Array.isArray(first.data)
      ? first.data
      : isRecord(first) && Array.isArray(first.items)
        ? first.items
        : isRecord(first) && Array.isArray(first.rows)
          ? first.rows
          : [];
  return list.filter(isRecord);
}

function stringField(record: Record<string, unknown>, name: string): string {
  return typeof record[name] === 'string' ? record[name] : '';
}

function nestedStringField(record: Record<string, unknown>, path: readonly string[]): string {
  const value = nestedValue(record, path);
  return typeof value === 'string' ? value : '';
}

function nestedValue(record: Record<string, unknown>, path: readonly string[]): unknown {
  let value: unknown = record;
  for (const segment of path) {
    if (!isRecord(value)) return undefined;
    value = value[segment];
  }
  return value;
}

function check(name: string, passed: boolean, detail?: string): CrudEvidenceAssertion {
  return { name, passed, ...(detail ? { detail: detail.slice(0, 512) } : {}) };
}

function statusDetail(result: InvocationResult): string {
  return `HTTP ${result.status}${result.error ? `: ${result.error}` : ''}`;
}

function caseFailure(item: CrudEvidenceCase): string {
  const failed = item.assertions.filter((assertion) => !assertion.passed);
  return `${item.fixtureId}: ${failed.map((assertion) => `${assertion.name}${assertion.detail ? ` (${assertion.detail})` : ''}`).join(', ')}`;
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 512) : String(error).slice(0, 512);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
