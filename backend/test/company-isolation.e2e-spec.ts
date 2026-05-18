import { INestApplication } from '@nestjs/common';
import {
  AccessLevel,
  AccountType,
  BranchType,
  DivisionType,
  ProductCategoryType,
  ProductType,
  RoleScope,
  UnitType,
} from '@prisma/client';
import type { Permission } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2eApp } from './e2e-app';

jest.setTimeout(30000);

const TEST_PASS = 'TestPass123!';

type DivisionResponse = {
  id: string;
  companyId: string;
};

type BranchResponse = {
  id: string;
  division?: {
    companyId?: string;
    company?: {
      id?: string;
    };
  };
};

type CompanyRecordResponse = {
  id: string;
  companyId: string;
};

type UserResponse = {
  id: string;
  companyId: string | null;
  companyAccess?: Array<{ companyId: string }>;
};

type UserSecurityProfileResponse = {
  id: string;
  userId: string;
};

async function loginAs(app: INestApplication, email: string, password: string) {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password })
    .expect(200);
  const data = res.body?.data ?? res.body;
  expect(data.accessToken).toBeTruthy();
  return data.accessToken as string;
}

function bodyArray<T>(body: unknown): T[] {
  const envelope = body as { data?: unknown };
  const value = Array.isArray(envelope.data) ? envelope.data : body;
  return Array.isArray(value) ? (value as T[]) : [];
}

function authorization(token: string) {
  return `Bearer ${token}`;
}

describe('Company Isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const suffix = `${Date.now()}`;
  const userIds: string[] = [];
  const roleIds: string[] = [];
  const companyIds: string[] = [];
  const divisionIds: string[] = [];
  const branchIds: string[] = [];
  const chartAccountIds: string[] = [];
  const fiscalYearIds: string[] = [];
  const accountingPeriodIds: string[] = [];
  const productCategoryIds: string[] = [];
  const unitIds: string[] = [];
  const productIds: string[] = [];
  const stockAdjustmentIds: string[] = [];
  const apiClientIds: string[] = [];
  const webhookEndpointIds: string[] = [];
  const webhookEventIds: string[] = [];
  const apiRequestLogIds: string[] = [];
  const activeSessionIds: string[] = [];
  const userSecurityProfileIds: string[] = [];
  let groupId = '';
  let companyAId = '';
  let companyBId = '';
  let divisionAId = '';
  let divisionBId = '';
  let branchAId = '';
  let branchBId = '';
  let chartAccountAId = '';
  let chartAccountBId = '';
  let accountingPeriodAId = '';
  let accountingPeriodBId = '';
  let productCategoryAId = '';
  let productCategoryBId = '';
  let unitAId = '';
  let unitBId = '';
  let productAId = '';
  let productBId = '';
  let stockAdjustmentAId = '';
  let stockAdjustmentBId = '';
  let apiClientAId = '';
  let apiClientBId = '';
  let webhookEndpointAId = '';
  let webhookEndpointBId = '';
  let webhookEventAId = '';
  let webhookEventBId = '';
  let apiRequestLogAId = '';
  let apiRequestLogBId = '';
  let companyUserId = '';
  let companyBUserId = '';
  let activeSessionAId = '';
  let activeSessionBId = '';
  let userSecurityProfileAId = '';
  let userSecurityProfileBId = '';
  let companyToken = '';
  let groupToken = '';

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);

    const permissions = await ensurePermissions([
      'divisions.read',
      'branches.read',
      'chart_of_accounts.view',
      'accounting_periods.view',
      'product_categories.view',
      'inventory.view',
      'inventory.adjustments.create',
      'api_clients.view',
      'webhook_endpoints.view',
      'webhook_events.view',
      'api_request_logs.view',
      'users.read',
      'active_sessions.view',
      'user_security_profiles.view',
      'operations.dashboard.view',
      'operations.reports.view',
      'logistics.dashboard.view',
      'logistics.reports.view',
      'petroleum.dashboard.view',
      'petroleum.reports.view',
      'agriculture.dashboard.view',
      'construction.dashboard.view',
      'itemba.dashboard.view',
      'westsides.dashboard.view',
      'westsides.reports.view',
      'finance.reports.view',
      'scheduled_reports.view',
    ]);

    const companyRole = await prisma.role.create({
      data: {
        name: `e2e_iso_company_reader_${suffix}`,
        displayName: 'E2E Isolation Company Reader',
        scope: RoleScope.COMPANY,
        rolePermissions: {
          create: permissions.map((permission) => ({ permissionId: permission.id })),
        },
      },
    });
    const groupRole = await prisma.role.create({
      data: {
        name: `e2e_iso_group_reader_${suffix}`,
        displayName: 'E2E Isolation Group Reader',
        scope: RoleScope.GROUP,
        rolePermissions: {
          create: permissions.map((permission) => ({ permissionId: permission.id })),
        },
      },
    });
    roleIds.push(companyRole.id, groupRole.id);

    const group = await prisma.group.create({
      data: {
        code: `E2EISO${suffix.slice(-8)}`,
        name: `E2E Isolation Group ${suffix}`,
      },
    });
    groupId = group.id;

    const [companyA, companyB] = await Promise.all([
      prisma.company.create({
        data: { groupId: group.id, code: `E2EIA${suffix.slice(-8)}`, name: 'E2E Isolation A' },
      }),
      prisma.company.create({
        data: { groupId: group.id, code: `E2EIB${suffix.slice(-8)}`, name: 'E2E Isolation B' },
      }),
    ]);
    companyAId = companyA.id;
    companyBId = companyB.id;
    companyIds.push(companyA.id, companyB.id);

    const [divisionA, divisionB] = await Promise.all([
      prisma.division.create({
        data: {
          companyId: companyA.id,
          code: `DIVA${suffix.slice(-8)}`,
          name: 'E2E Division A',
          type: DivisionType.OTHER,
        },
      }),
      prisma.division.create({
        data: {
          companyId: companyB.id,
          code: `DIVB${suffix.slice(-8)}`,
          name: 'E2E Division B',
          type: DivisionType.OTHER,
        },
      }),
    ]);
    divisionAId = divisionA.id;
    divisionBId = divisionB.id;
    divisionIds.push(divisionA.id, divisionB.id);

    const [branchA, branchB] = await Promise.all([
      prisma.branch.create({
        data: {
          divisionId: divisionA.id,
          code: `BRA${suffix.slice(-8)}`,
          name: 'E2E Branch A',
          type: BranchType.BRANCH,
        },
      }),
      prisma.branch.create({
        data: {
          divisionId: divisionB.id,
          code: `BRB${suffix.slice(-8)}`,
          name: 'E2E Branch B',
          type: BranchType.BRANCH,
        },
      }),
    ]);
    branchAId = branchA.id;
    branchBId = branchB.id;
    branchIds.push(branchA.id, branchB.id);

    const [productCategoryA, productCategoryB] = await Promise.all([
      prisma.productCategory.create({
        data: {
          companyId: companyA.id,
          name: `E2E Product Category A ${suffix}`,
          categoryType: ProductCategoryType.OTHER,
        },
      }),
      prisma.productCategory.create({
        data: {
          companyId: companyB.id,
          name: `E2E Product Category B ${suffix}`,
          categoryType: ProductCategoryType.OTHER,
        },
      }),
    ]);
    productCategoryAId = productCategoryA.id;
    productCategoryBId = productCategoryB.id;
    productCategoryIds.push(productCategoryA.id, productCategoryB.id);

    const [unitA, unitB] = await Promise.all([
      prisma.unitOfMeasure.create({
        data: {
          companyId: companyA.id,
          name: `E2E Unit A ${suffix}`,
          symbol: `EA${suffix.slice(-6)}`,
          unitType: UnitType.PIECE,
        },
      }),
      prisma.unitOfMeasure.create({
        data: {
          companyId: companyB.id,
          name: `E2E Unit B ${suffix}`,
          symbol: `EB${suffix.slice(-6)}`,
          unitType: UnitType.PIECE,
        },
      }),
    ]);
    unitAId = unitA.id;
    unitBId = unitB.id;
    unitIds.push(unitA.id, unitB.id);

    const [productA, productB] = await Promise.all([
      prisma.product.create({
        data: {
          companyId: companyA.id,
          divisionId: divisionA.id,
          categoryId: productCategoryA.id,
          productCode: `PRDA${suffix.slice(-8)}`,
          name: `E2E Product A ${suffix}`,
          productType: ProductType.STOCK_ITEM,
          baseUnitId: unitA.id,
          trackInventory: true,
        },
      }),
      prisma.product.create({
        data: {
          companyId: companyB.id,
          divisionId: divisionB.id,
          categoryId: productCategoryB.id,
          productCode: `PRDB${suffix.slice(-8)}`,
          name: `E2E Product B ${suffix}`,
          productType: ProductType.STOCK_ITEM,
          baseUnitId: unitB.id,
          trackInventory: true,
        },
      }),
    ]);
    productAId = productA.id;
    productBId = productB.id;
    productIds.push(productA.id, productB.id);

    const [chartAccountA, chartAccountB] = await Promise.all([
      prisma.chartOfAccount.create({
        data: {
          companyId: companyA.id,
          accountCode: `10A${suffix.slice(-8)}`,
          accountName: `E2E Asset A ${suffix}`,
          accountType: AccountType.ASSET,
        },
      }),
      prisma.chartOfAccount.create({
        data: {
          companyId: companyB.id,
          accountCode: `10B${suffix.slice(-8)}`,
          accountName: `E2E Asset B ${suffix}`,
          accountType: AccountType.ASSET,
        },
      }),
    ]);
    chartAccountAId = chartAccountA.id;
    chartAccountBId = chartAccountB.id;
    chartAccountIds.push(chartAccountA.id, chartAccountB.id);

    const [fiscalYearA, fiscalYearB] = await Promise.all([
      prisma.fiscalYear.create({
        data: {
          companyId: companyA.id,
          name: `FY-A-${suffix}`,
          startDate: new Date('2026-01-01T00:00:00.000Z'),
          endDate: new Date('2026-12-31T00:00:00.000Z'),
        },
      }),
      prisma.fiscalYear.create({
        data: {
          companyId: companyB.id,
          name: `FY-B-${suffix}`,
          startDate: new Date('2026-01-01T00:00:00.000Z'),
          endDate: new Date('2026-12-31T00:00:00.000Z'),
        },
      }),
    ]);
    fiscalYearIds.push(fiscalYearA.id, fiscalYearB.id);

    const [accountingPeriodA, accountingPeriodB] = await Promise.all([
      prisma.accountingPeriod.create({
        data: {
          companyId: companyA.id,
          fiscalYearId: fiscalYearA.id,
          name: `JAN-A-${suffix}`,
          startDate: new Date('2026-01-01T00:00:00.000Z'),
          endDate: new Date('2026-01-31T00:00:00.000Z'),
        },
      }),
      prisma.accountingPeriod.create({
        data: {
          companyId: companyB.id,
          fiscalYearId: fiscalYearB.id,
          name: `JAN-B-${suffix}`,
          startDate: new Date('2026-01-01T00:00:00.000Z'),
          endDate: new Date('2026-01-31T00:00:00.000Z'),
        },
      }),
    ]);
    accountingPeriodAId = accountingPeriodA.id;
    accountingPeriodBId = accountingPeriodB.id;
    accountingPeriodIds.push(accountingPeriodA.id, accountingPeriodB.id);

    const passwordHash = await argon2.hash(TEST_PASS);
    const [companyUser, companyBUser, groupUser] = await Promise.all([
      prisma.user.create({
        data: {
          email: `e2e-iso-company-${suffix}@itemba.local`,
          passwordHash,
          fullName: 'E2E Isolation Company User',
          status: 'ACTIVE',
          companyId: companyA.id,
          userRoles: { create: { roleId: companyRole.id } },
          companyAccess: {
            create: { companyId: companyA.id, accessLevel: AccessLevel.MANAGE },
          },
        },
      }),
      prisma.user.create({
        data: {
          email: `e2e-iso-company-b-${suffix}@itemba.local`,
          passwordHash,
          fullName: 'E2E Isolation Company B User',
          status: 'ACTIVE',
          companyId: companyB.id,
          userRoles: { create: { roleId: companyRole.id } },
          companyAccess: {
            create: { companyId: companyB.id, accessLevel: AccessLevel.MANAGE },
          },
        },
      }),
      prisma.user.create({
        data: {
          email: `e2e-iso-group-${suffix}@itemba.local`,
          passwordHash,
          fullName: 'E2E Isolation Group User',
          status: 'ACTIVE',
          userRoles: { create: { roleId: groupRole.id } },
          companyAccess: {
            create: [
              { companyId: companyA.id, accessLevel: AccessLevel.READ },
              { companyId: companyB.id, accessLevel: AccessLevel.READ },
            ],
          },
        },
      }),
    ]);
    companyUserId = companyUser.id;
    companyBUserId = companyBUser.id;
    userIds.push(companyUser.id, companyBUser.id, groupUser.id);

    const [activeSessionA, activeSessionB] = await Promise.all([
      prisma.activeSession.create({
        data: {
          sessionCode: `SESS-A-${suffix}`,
          userId: companyUser.id,
          companyId: companyA.id,
          sessionType: 'WEB',
          startedAt: new Date(),
          lastActivityAt: new Date(),
          expiresAt: new Date(Date.now() + 86400000),
          status: 'ACTIVE',
        },
      }),
      prisma.activeSession.create({
        data: {
          sessionCode: `SESS-B-${suffix}`,
          userId: companyBUser.id,
          companyId: companyB.id,
          sessionType: 'WEB',
          startedAt: new Date(),
          lastActivityAt: new Date(),
          expiresAt: new Date(Date.now() + 86400000),
          status: 'ACTIVE',
        },
      }),
    ]);
    activeSessionAId = activeSessionA.id;
    activeSessionBId = activeSessionB.id;
    activeSessionIds.push(activeSessionA.id, activeSessionB.id);

    const [userSecurityProfileA, userSecurityProfileB] = await Promise.all([
      prisma.userSecurityProfile.create({
        data: {
          userId: companyUser.id,
          securityRiskLevel: 'LOW',
        },
      }),
      prisma.userSecurityProfile.create({
        data: {
          userId: companyBUser.id,
          securityRiskLevel: 'MEDIUM',
        },
      }),
    ]);
    userSecurityProfileAId = userSecurityProfileA.id;
    userSecurityProfileBId = userSecurityProfileB.id;
    userSecurityProfileIds.push(userSecurityProfileA.id, userSecurityProfileB.id);

    const [stockAdjustmentA, stockAdjustmentB] = await Promise.all([
      prisma.stockAdjustment.create({
        data: {
          adjustmentNumber: `SA-A-${suffix}`,
          companyId: companyA.id,
          divisionId: divisionA.id,
          branchId: branchA.id,
          reason: 'E2E isolation stock count A',
          createdById: companyUser.id,
          lines: {
            create: {
              productId: productA.id,
              systemQuantity: 0,
              countedQuantity: 1,
              varianceQuantity: 1,
              unitId: unitA.id,
            },
          },
        },
      }),
      prisma.stockAdjustment.create({
        data: {
          adjustmentNumber: `SA-B-${suffix}`,
          companyId: companyB.id,
          divisionId: divisionB.id,
          branchId: branchB.id,
          reason: 'E2E isolation stock count B',
          createdById: companyUser.id,
          lines: {
            create: {
              productId: productB.id,
              systemQuantity: 0,
              countedQuantity: 1,
              varianceQuantity: 1,
              unitId: unitB.id,
            },
          },
        },
      }),
    ]);
    stockAdjustmentAId = stockAdjustmentA.id;
    stockAdjustmentBId = stockAdjustmentB.id;
    stockAdjustmentIds.push(stockAdjustmentA.id, stockAdjustmentB.id);

    const [apiClientA, apiClientB] = await Promise.all([
      prisma.apiClient.create({
        data: {
          clientCode: `CLI-A-${suffix}`,
          companyId: companyA.id,
          name: `E2E API Client A ${suffix}`,
          allowedScopes: ['e2e.read'],
          createdById: companyUser.id,
        },
      }),
      prisma.apiClient.create({
        data: {
          clientCode: `CLI-B-${suffix}`,
          companyId: companyB.id,
          name: `E2E API Client B ${suffix}`,
          allowedScopes: ['e2e.read'],
          createdById: companyUser.id,
        },
      }),
    ]);
    apiClientAId = apiClientA.id;
    apiClientBId = apiClientB.id;
    apiClientIds.push(apiClientA.id, apiClientB.id);

    const [webhookEndpointA, webhookEndpointB] = await Promise.all([
      prisma.webhookEndpoint.create({
        data: {
          webhookCode: `WH-A-${suffix}`,
          companyId: companyA.id,
          name: `E2E Webhook A ${suffix}`,
          endpointPath: `/e2e/${suffix}/a`,
          secretHash: 'e2e-secret-hash-a',
          createdById: companyUser.id,
        },
      }),
      prisma.webhookEndpoint.create({
        data: {
          webhookCode: `WH-B-${suffix}`,
          companyId: companyB.id,
          name: `E2E Webhook B ${suffix}`,
          endpointPath: `/e2e/${suffix}/b`,
          secretHash: 'e2e-secret-hash-b',
          createdById: companyUser.id,
        },
      }),
    ]);
    webhookEndpointAId = webhookEndpointA.id;
    webhookEndpointBId = webhookEndpointB.id;
    webhookEndpointIds.push(webhookEndpointA.id, webhookEndpointB.id);

    const [webhookEventA, webhookEventB] = await Promise.all([
      prisma.webhookEvent.create({
        data: {
          webhookEventNumber: `WHE-A-${suffix}`,
          webhookEndpointId: webhookEndpointA.id,
          companyId: companyA.id,
          eventName: 'e2e.integration.test',
          payload: { ok: true, company: 'A' },
        },
      }),
      prisma.webhookEvent.create({
        data: {
          webhookEventNumber: `WHE-B-${suffix}`,
          webhookEndpointId: webhookEndpointB.id,
          companyId: companyB.id,
          eventName: 'e2e.integration.test',
          payload: { ok: true, company: 'B' },
        },
      }),
    ]);
    webhookEventAId = webhookEventA.id;
    webhookEventBId = webhookEventB.id;
    webhookEventIds.push(webhookEventA.id, webhookEventB.id);

    const [apiRequestLogA, apiRequestLogB] = await Promise.all([
      prisma.apiRequestLog.create({
        data: {
          requestNumber: `REQ-A-${suffix}`,
          apiClientId: apiClientA.id,
          companyId: companyA.id,
          method: 'GET',
          path: '/e2e/a',
          statusCode: 200,
        },
      }),
      prisma.apiRequestLog.create({
        data: {
          requestNumber: `REQ-B-${suffix}`,
          apiClientId: apiClientB.id,
          companyId: companyB.id,
          method: 'GET',
          path: '/e2e/b',
          statusCode: 200,
        },
      }),
    ]);
    apiRequestLogAId = apiRequestLogA.id;
    apiRequestLogBId = apiRequestLogB.id;
    apiRequestLogIds.push(apiRequestLogA.id, apiRequestLogB.id);

    companyToken = await loginAs(app, companyUser.email, TEST_PASS);
    groupToken = await loginAs(app, groupUser.email, TEST_PASS);
  }, 120000);

  afterAll(async () => {
    if (prisma) await cleanupTestData();
    if (app) await app.close();
  });

  async function ensurePermissions(codes: string[]): Promise<Permission[]> {
    return Promise.all(
      codes.map((code) => {
        const [module, action] = code.split('.');
        return prisma.permission.upsert({
          where: { code },
          update: {},
          create: {
            code,
            description: `E2E permission for ${code}`,
            module,
            action,
          },
        });
      }),
    );
  }

  async function cleanupTestData() {
    if (apiRequestLogIds.length > 0) {
      await prisma.apiRequestLog.deleteMany({ where: { id: { in: apiRequestLogIds } } });
    }
    if (webhookEventIds.length > 0) {
      await prisma.webhookEvent.deleteMany({ where: { id: { in: webhookEventIds } } });
    }
    if (webhookEndpointIds.length > 0) {
      await prisma.webhookEndpoint.deleteMany({ where: { id: { in: webhookEndpointIds } } });
    }
    if (apiClientIds.length > 0) {
      await prisma.apiClient.deleteMany({ where: { id: { in: apiClientIds } } });
    }
    if (stockAdjustmentIds.length > 0) {
      await prisma.stockAdjustmentLine.deleteMany({
        where: { stockAdjustmentId: { in: stockAdjustmentIds } },
      });
      await prisma.stockAdjustment.deleteMany({ where: { id: { in: stockAdjustmentIds } } });
    }
    if (productIds.length > 0) {
      await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    }
    if (userSecurityProfileIds.length > 0) {
      await prisma.userSecurityProfile.deleteMany({
        where: { id: { in: userSecurityProfileIds } },
      });
    }
    if (activeSessionIds.length > 0) {
      await prisma.activeSession.deleteMany({ where: { id: { in: activeSessionIds } } });
    }
    if (userIds.length > 0) {
      await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.activeSession.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.userSecurityProfile.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.userCompanyAccess.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.securityEvent.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    if (roleIds.length > 0) {
      await prisma.rolePermission.deleteMany({ where: { roleId: { in: roleIds } } });
      await prisma.role.deleteMany({ where: { id: { in: roleIds } } });
    }
    if (chartAccountIds.length > 0) {
      await prisma.chartOfAccount.deleteMany({ where: { id: { in: chartAccountIds } } });
    }
    if (accountingPeriodIds.length > 0) {
      await prisma.accountingPeriod.deleteMany({ where: { id: { in: accountingPeriodIds } } });
    }
    if (fiscalYearIds.length > 0) {
      await prisma.fiscalYear.deleteMany({ where: { id: { in: fiscalYearIds } } });
    }
    if (productCategoryIds.length > 0) {
      await prisma.productCategory.deleteMany({ where: { id: { in: productCategoryIds } } });
    }
    if (unitIds.length > 0) {
      await prisma.unitOfMeasure.deleteMany({ where: { id: { in: unitIds } } });
    }
    if (branchIds.length > 0) {
      await prisma.branch.deleteMany({ where: { id: { in: branchIds } } });
    }
    if (divisionIds.length > 0) {
      await prisma.division.deleteMany({ where: { id: { in: divisionIds } } });
    }
    if (companyIds.length > 0) {
      await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
    }
  }

  describe('Unauthenticated access', () => {
    it('should deny access to companies endpoint without auth', async () => {
      await request(app.getHttpServer()).get('/api/v1/companies').expect(401);
    });

    it('should deny access to divisions endpoint without auth', async () => {
      await request(app.getHttpServer()).get('/api/v1/divisions').expect(401);
    });

    it('should deny access to users endpoint without auth', async () => {
      await request(app.getHttpServer()).get('/api/v1/users').expect(401);
    });

    it('should deny access to bank-accounts endpoint without auth', async () => {
      await request(app.getHttpServer()).get('/api/v1/bank-accounts').expect(401);
    });

    it('should deny access to payroll endpoint without auth', async () => {
      await request(app.getHttpServer()).get('/api/v1/hr/payroll-runs').expect(401);
    });

    it('should deny access to finance accounts without auth', async () => {
      await request(app.getHttpServer()).get('/api/v1/chart-of-accounts').expect(401);
    });
  });

  describe('Authenticated company scoping', () => {
    it('limits division lists to the caller company when no company filter is supplied', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/divisions')
        .set('Authorization', authorization(companyToken))
        .expect(200);

      const ids = bodyArray<DivisionResponse>(res.body).map((division) => division.id);
      expect(ids).toContain(divisionAId);
      expect(ids).not.toContain(divisionBId);
    });

    it('rejects an explicit division list filter for another company', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/divisions')
        .query({ companyId: companyBId })
        .set('Authorization', authorization(companyToken))
        .expect(403);
    });

    it('rejects direct division reads across companies', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/divisions/${divisionBId}`)
        .set('Authorization', authorization(companyToken))
        .expect(403);
    });

    it('limits branch lists to divisions under the caller company', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/branches')
        .set('Authorization', authorization(companyToken))
        .expect(200);

      const ids = bodyArray<BranchResponse>(res.body).map((branch) => branch.id);
      expect(ids).toContain(branchAId);
      expect(ids).not.toContain(branchBId);
    });

    it('rejects an explicit branch list filter for another company', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/branches')
        .query({ companyId: companyBId })
        .set('Authorization', authorization(companyToken))
        .expect(403);
    });

    it('rejects direct branch reads across companies', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/branches/${branchBId}`)
        .set('Authorization', authorization(companyToken))
        .expect(403);
    });

    it('limits chart of accounts lists to the caller company', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/chart-of-accounts')
        .set('Authorization', authorization(companyToken))
        .expect(200);

      const ids = bodyArray<CompanyRecordResponse>(res.body).map((account) => account.id);
      expect(ids).toContain(chartAccountAId);
      expect(ids).not.toContain(chartAccountBId);
    });

    it('rejects chart of accounts access across companies', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/chart-of-accounts')
        .query({ companyId: companyBId })
        .set('Authorization', authorization(companyToken))
        .expect(403);

      await request(app.getHttpServer())
        .get(`/api/v1/chart-of-accounts/${chartAccountBId}`)
        .set('Authorization', authorization(companyToken))
        .expect(403);
    });

    it('limits accounting period lists to the caller company', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/accounting-periods')
        .set('Authorization', authorization(companyToken))
        .expect(200);

      const ids = bodyArray<CompanyRecordResponse>(res.body).map((period) => period.id);
      expect(ids).toContain(accountingPeriodAId);
      expect(ids).not.toContain(accountingPeriodBId);
    });

    it('rejects accounting period access across companies', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/accounting-periods')
        .query({ companyId: companyBId })
        .set('Authorization', authorization(companyToken))
        .expect(403);

      await request(app.getHttpServer())
        .get(`/api/v1/accounting-periods/${accountingPeriodBId}`)
        .set('Authorization', authorization(companyToken))
        .expect(403);
    });

    it('limits product category lists to the caller company', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/product-categories')
        .set('Authorization', authorization(companyToken))
        .expect(200);

      const ids = bodyArray<CompanyRecordResponse>(res.body).map((category) => category.id);
      expect(ids).toContain(productCategoryAId);
      expect(ids).not.toContain(productCategoryBId);
    });

    it('rejects product category access across companies', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/product-categories')
        .query({ companyId: companyBId })
        .set('Authorization', authorization(companyToken))
        .expect(403);

      await request(app.getHttpServer())
        .get(`/api/v1/product-categories/${productCategoryBId}`)
        .set('Authorization', authorization(companyToken))
        .expect(403);
    });

    it('limits stock adjustment lists to the caller company', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/stock-adjustments')
        .set('Authorization', authorization(companyToken))
        .expect(200);

      const ids = bodyArray<CompanyRecordResponse>(res.body).map((adjustment) => adjustment.id);
      expect(ids).toContain(stockAdjustmentAId);
      expect(ids).not.toContain(stockAdjustmentBId);
    });

    it('rejects stock adjustment access across companies', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/stock-adjustments')
        .query({ companyId: companyBId })
        .set('Authorization', authorization(companyToken))
        .expect(403);

      await request(app.getHttpServer())
        .get(`/api/v1/stock-adjustments/${stockAdjustmentBId}`)
        .set('Authorization', authorization(companyToken))
        .expect(403);
    });

    it('rejects stock adjustments that reference another company product', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/stock-adjustments')
        .set('Authorization', authorization(companyToken))
        .send({
          companyId: companyAId,
          divisionId: divisionAId,
          branchId: branchAId,
          reason: 'Cross-company reference attempt',
          lines: [
            {
              productId: productBId,
              systemQuantity: 0,
              countedQuantity: 1,
              unitId: unitAId,
            },
          ],
        })
        .expect(400);
    });

    it('limits API client lists to the caller company', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/api-clients')
        .set('Authorization', authorization(companyToken))
        .expect(200);

      const ids = bodyArray<CompanyRecordResponse>(res.body).map((client) => client.id);
      expect(ids).toContain(apiClientAId);
      expect(ids).not.toContain(apiClientBId);
    });

    it('rejects API client access across companies', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/api-clients')
        .query({ companyId: companyBId })
        .set('Authorization', authorization(companyToken))
        .expect(403);

      await request(app.getHttpServer())
        .get(`/api/v1/api-clients/${apiClientBId}`)
        .set('Authorization', authorization(companyToken))
        .expect(403);
    });

    it('limits webhook endpoint lists to the caller company', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/webhook-endpoints')
        .set('Authorization', authorization(companyToken))
        .expect(200);

      const ids = bodyArray<CompanyRecordResponse>(res.body).map((endpoint) => endpoint.id);
      expect(ids).toContain(webhookEndpointAId);
      expect(ids).not.toContain(webhookEndpointBId);
    });

    it('rejects webhook endpoint access across companies', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/webhook-endpoints')
        .query({ companyId: companyBId })
        .set('Authorization', authorization(companyToken))
        .expect(403);

      await request(app.getHttpServer())
        .get(`/api/v1/webhook-endpoints/${webhookEndpointBId}`)
        .set('Authorization', authorization(companyToken))
        .expect(403);
    });

    it('limits webhook event lists to the caller company', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/webhook-events')
        .set('Authorization', authorization(companyToken))
        .expect(200);

      const ids = bodyArray<CompanyRecordResponse>(res.body).map((event) => event.id);
      expect(ids).toContain(webhookEventAId);
      expect(ids).not.toContain(webhookEventBId);
    });

    it('rejects webhook event access across companies', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/webhook-events')
        .query({ companyId: companyBId })
        .set('Authorization', authorization(companyToken))
        .expect(403);

      await request(app.getHttpServer())
        .get(`/api/v1/webhook-events/${webhookEventBId}`)
        .set('Authorization', authorization(companyToken))
        .expect(403);
    });

    it('limits API request log lists to the caller company', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/api-request-logs')
        .set('Authorization', authorization(companyToken))
        .expect(200);

      const ids = bodyArray<CompanyRecordResponse>(res.body).map((log) => log.id);
      expect(ids).toContain(apiRequestLogAId);
      expect(ids).not.toContain(apiRequestLogBId);
    });

    it('rejects API request log filters for another company', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/api-request-logs')
        .query({ companyId: companyBId })
        .set('Authorization', authorization(companyToken))
        .expect(403);
    });

    it('limits user lists to users in the caller company', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/users')
        .set('Authorization', authorization(companyToken))
        .expect(200);

      const ids = bodyArray<UserResponse>(res.body).map((user) => user.id);
      expect(ids).toContain(companyUserId);
      expect(ids).not.toContain(companyBUserId);
    });

    it('rejects user access across companies', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/users')
        .query({ companyId: companyBId })
        .set('Authorization', authorization(companyToken))
        .expect(403);

      await request(app.getHttpServer())
        .get(`/api/v1/users/${companyBUserId}`)
        .set('Authorization', authorization(companyToken))
        .expect(403);
    });

    it('limits active session lists to the caller company', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/active-sessions')
        .set('Authorization', authorization(companyToken))
        .expect(200);

      const ids = bodyArray<CompanyRecordResponse>(res.body).map((session) => session.id);
      expect(ids).toContain(activeSessionAId);
      expect(ids).not.toContain(activeSessionBId);
    });

    it('rejects active session access across companies', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/active-sessions')
        .query({ companyId: companyBId })
        .set('Authorization', authorization(companyToken))
        .expect(403);

      const crossCompanySession = await request(app.getHttpServer())
        .get(`/api/v1/active-sessions/${activeSessionBId}`)
        .set('Authorization', authorization(companyToken));
      expect([403, 404]).toContain(crossCompanySession.status);
    });

    it('limits user security profile lists to users in the caller company', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/user-security-profiles')
        .set('Authorization', authorization(companyToken))
        .expect(200);

      const ids = bodyArray<UserSecurityProfileResponse>(res.body).map((profile) => profile.id);
      expect(ids).toContain(userSecurityProfileAId);
      expect(ids).not.toContain(userSecurityProfileBId);
    });

    it('rejects user security profile access across companies', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/user-security-profiles')
        .query({ companyId: companyBId })
        .set('Authorization', authorization(companyToken))
        .expect(403);

      await request(app.getHttpServer())
        .get(`/api/v1/user-security-profiles/${userSecurityProfileBId}`)
        .set('Authorization', authorization(companyToken))
        .expect(403);
    });

    it('rejects dashboard and report queries scoped to another company', async () => {
      const forbiddenQueries = [
        { path: '/api/v1/operations-dashboard/summary', query: { companyId: companyBId } },
        { path: '/api/v1/operations-reports/sales-summary', query: { companyId: companyBId } },
        { path: '/api/v1/logistics/dashboard', query: { companyId: companyBId } },
        {
          path: '/api/v1/logistics/dashboard/reports/fleet-utilization',
          query: { companyId: companyBId },
        },
        { path: '/api/v1/petroleum/dashboard', query: { companyId: companyBId } },
        { path: '/api/v1/petroleum/reports/fuel-stock', query: { companyId: companyBId } },
        { path: '/api/v1/agriculture/dashboard', query: { companyId: companyBId } },
        {
          path: '/api/v1/agriculture/dashboard/reports/yield-analysis',
          query: { companyId: companyBId },
        },
        { path: '/api/v1/construction/dashboard', query: { companyId: companyBId } },
        { path: '/api/v1/itemba/dashboard', query: { companyId: companyBId } },
        { path: '/api/v1/itemba/dashboard/cockpit', query: { companyId: companyBId } },
        { path: '/api/v1/westsides/dashboard/summary', query: { companyId: companyBId } },
        { path: '/api/v1/westsides/dashboard/cockpit', query: { companyId: companyBId } },
        { path: '/api/v1/westsides/reports/daily-sales-summary', query: { companyId: companyBId } },
        { path: '/api/v1/westsides/reports/daily-close', query: { companyId: companyBId } },
        { path: `/api/v1/financial-reports/company-summary/${companyBId}` },
        { path: '/api/v1/financial-reports/group-summary' },
        { path: '/api/v1/financial-reports/group/trial-balance' },
        { path: '/api/v1/group-reports/sales' },
        { path: '/api/v1/group-reports/audit-trail' },
        { path: '/api/v1/bi/scheduled-reports', query: { companyId: companyBId } },
      ];

      for (const { path, query } of forbiddenQueries) {
        const req = request(app.getHttpServer())
          .get(path)
          .set('Authorization', authorization(companyToken));
        if (query) req.query(query);
        await req.expect(403);
      }
    });

    it('allows group-scoped readers to list both companies', async () => {
      const divisions = await request(app.getHttpServer())
        .get('/api/v1/divisions')
        .set('Authorization', authorization(groupToken))
        .expect(200);
      const divisionListIds = bodyArray<DivisionResponse>(divisions.body).map(
        (division) => division.id,
      );
      expect(divisionListIds).toEqual(expect.arrayContaining([divisionAId, divisionBId]));

      const branches = await request(app.getHttpServer())
        .get('/api/v1/branches')
        .set('Authorization', authorization(groupToken))
        .expect(200);
      const branchListIds = bodyArray<BranchResponse>(branches.body).map((branch) => branch.id);
      expect(branchListIds).toEqual(expect.arrayContaining([branchAId, branchBId]));

      const chartAccounts = await request(app.getHttpServer())
        .get('/api/v1/chart-of-accounts')
        .set('Authorization', authorization(groupToken))
        .expect(200);
      const chartAccountListIds = bodyArray<CompanyRecordResponse>(chartAccounts.body).map(
        (account) => account.id,
      );
      expect(chartAccountListIds).toEqual(
        expect.arrayContaining([chartAccountAId, chartAccountBId]),
      );

      const accountingPeriods = await request(app.getHttpServer())
        .get('/api/v1/accounting-periods')
        .set('Authorization', authorization(groupToken))
        .expect(200);
      const accountingPeriodListIds = bodyArray<CompanyRecordResponse>(accountingPeriods.body).map(
        (period) => period.id,
      );
      expect(accountingPeriodListIds).toEqual(
        expect.arrayContaining([accountingPeriodAId, accountingPeriodBId]),
      );

      const productCategories = await request(app.getHttpServer())
        .get('/api/v1/product-categories')
        .set('Authorization', authorization(groupToken))
        .expect(200);
      const productCategoryListIds = bodyArray<CompanyRecordResponse>(productCategories.body).map(
        (category) => category.id,
      );
      expect(productCategoryListIds).toEqual(
        expect.arrayContaining([productCategoryAId, productCategoryBId]),
      );

      const stockAdjustments = await request(app.getHttpServer())
        .get('/api/v1/stock-adjustments')
        .set('Authorization', authorization(groupToken))
        .expect(200);
      const stockAdjustmentListIds = bodyArray<CompanyRecordResponse>(stockAdjustments.body).map(
        (adjustment) => adjustment.id,
      );
      expect(stockAdjustmentListIds).toEqual(
        expect.arrayContaining([stockAdjustmentAId, stockAdjustmentBId]),
      );

      const apiClients = await request(app.getHttpServer())
        .get('/api/v1/api-clients')
        .set('Authorization', authorization(groupToken))
        .expect(200);
      const apiClientListIds = bodyArray<CompanyRecordResponse>(apiClients.body).map(
        (client) => client.id,
      );
      expect(apiClientListIds).toEqual(expect.arrayContaining([apiClientAId, apiClientBId]));

      const webhookEndpoints = await request(app.getHttpServer())
        .get('/api/v1/webhook-endpoints')
        .set('Authorization', authorization(groupToken))
        .expect(200);
      const webhookEndpointListIds = bodyArray<CompanyRecordResponse>(webhookEndpoints.body).map(
        (endpoint) => endpoint.id,
      );
      expect(webhookEndpointListIds).toEqual(
        expect.arrayContaining([webhookEndpointAId, webhookEndpointBId]),
      );

      const webhookEvents = await request(app.getHttpServer())
        .get('/api/v1/webhook-events')
        .set('Authorization', authorization(groupToken))
        .expect(200);
      const webhookEventListIds = bodyArray<CompanyRecordResponse>(webhookEvents.body).map(
        (event) => event.id,
      );
      expect(webhookEventListIds).toEqual(
        expect.arrayContaining([webhookEventAId, webhookEventBId]),
      );

      const apiRequestLogs = await request(app.getHttpServer())
        .get('/api/v1/api-request-logs')
        .set('Authorization', authorization(groupToken))
        .expect(200);
      const apiRequestLogListIds = bodyArray<CompanyRecordResponse>(apiRequestLogs.body).map(
        (log) => log.id,
      );
      expect(apiRequestLogListIds).toEqual(
        expect.arrayContaining([apiRequestLogAId, apiRequestLogBId]),
      );

      const users = await request(app.getHttpServer())
        .get('/api/v1/users')
        .set('Authorization', authorization(groupToken))
        .expect(200);
      const userListIds = bodyArray<UserResponse>(users.body).map((user) => user.id);
      expect(userListIds).toEqual(expect.arrayContaining([companyUserId, companyBUserId]));

      const activeSessions = await request(app.getHttpServer())
        .get('/api/v1/active-sessions')
        .set('Authorization', authorization(groupToken))
        .expect(200);
      const activeSessionListIds = bodyArray<CompanyRecordResponse>(activeSessions.body).map(
        (session) => session.id,
      );
      expect(activeSessionListIds).toEqual(
        expect.arrayContaining([activeSessionAId, activeSessionBId]),
      );

      const userSecurityProfiles = await request(app.getHttpServer())
        .get('/api/v1/user-security-profiles')
        .set('Authorization', authorization(groupToken))
        .expect(200);
      const userSecurityProfileListIds = bodyArray<UserSecurityProfileResponse>(
        userSecurityProfiles.body,
      ).map((profile) => profile.id);
      expect(userSecurityProfileListIds).toEqual(
        expect.arrayContaining([userSecurityProfileAId, userSecurityProfileBId]),
      );
    });
  });
});
