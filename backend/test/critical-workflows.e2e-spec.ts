import { INestApplication } from '@nestjs/common';
import {
  AccessLevel,
  AccountType,
  ApiKeyStatus,
  BranchType,
  DivisionType,
  ExternalPaymentMethod,
  ProductCategoryType,
  ProductType,
  RoleScope,
  UnitType,
} from '@prisma/client';
import type { Permission } from '@prisma/client';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2eApp } from './e2e-app';

jest.setTimeout(60000);

const TEST_PASS = 'TestPass123!';

function authorization(token: string) {
  return `Bearer ${token}`;
}

function unwrap<T = any>(body: unknown): T {
  return ((body as { data?: T })?.data ?? body) as T;
}

function unwrapArray<T = any>(body: unknown): T[] {
  const value = unwrap<any>(body);
  if (Array.isArray(value)) return value as T[];
  return Array.isArray(value?.data) ? (value.data as T[]) : [];
}

async function loginAs(app: INestApplication, email: string, password: string) {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password })
    .expect(200);
  const data = unwrap<{ accessToken: string }>(res.body);
  expect(data.accessToken).toBeTruthy();
  return data.accessToken;
}

describe('Critical Business Workflows (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const suffix = `${Date.now()}`;
  const short = suffix.slice(-8);
  const roleIds: string[] = [];
  const userIds: string[] = [];
  const companyIds: string[] = [];
  const divisionIds: string[] = [];
  const branchIds: string[] = [];
  const fiscalYearIds: string[] = [];
  const accountingPeriodIds: string[] = [];
  const chartAccountIds: string[] = [];
  const journalEntryIds: string[] = [];
  const unitIds: string[] = [];
  const productCategoryIds: string[] = [];
  const productIds: string[] = [];
  const inventoryBalanceIds: string[] = [];
  const stockAdjustmentIds: string[] = [];
  const externalPaymentIds: string[] = [];
  const apiClientIds: string[] = [];
  const apiKeyIds: string[] = [];

  let groupId = '';
  let companyAId = '';
  let companyBId = '';
  let divisionAId = '';
  let branchAId = '';
  let accountingPeriodAId = '';
  let companyToken = '';
  let posterToken = '';
  let apiKeyValue = '';
  let unitBId = '';
  let productCategoryBId = '';
  let productBId = '';
  let inventoryBalanceBId = '';
  let externalPaymentBId = '';

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);

    const permissions = await ensurePermissions([
      'chart_of_accounts.view',
      'chart_of_accounts.manage',
      'journal_entries.view',
      'journal_entries.create',
      'journal_entries.post',
      'journal_entries.reverse',
      'product_categories.view',
      'product_categories.manage',
      'products.view',
      'products.create',
      'products.update',
      'products.delete',
      'units.view',
      'units.manage',
      'inventory.view',
      'inventory.manage',
      'inventory.adjustments.create',
      'inventory.adjustments.approve',
      'inventory.adjustments.post',
      'external_payments.view',
      'external_payments.create',
      'external_payments.confirm',
      'external_payments.reverse',
    ]);

    const companyRole = await prisma.role.create({
      data: {
        name: `e2e_critical_company_${suffix}`,
        displayName: 'E2E Critical Company Operator',
        scope: RoleScope.COMPANY,
        rolePermissions: {
          create: permissions.map((permission) => ({ permissionId: permission.id })),
        },
      },
    });
    roleIds.push(companyRole.id);

    const group = await prisma.group.create({
      data: {
        code: `E2ECW${short}`,
        name: `E2E Critical Workflows ${suffix}`,
      },
    });
    groupId = group.id;

    const [companyA, companyB] = await Promise.all([
      prisma.company.create({
        data: { groupId, code: `E2ECWA${short}`, name: `E2E Critical A ${suffix}` },
      }),
      prisma.company.create({
        data: { groupId, code: `E2ECWB${short}`, name: `E2E Critical B ${suffix}` },
      }),
    ]);
    companyAId = companyA.id;
    companyBId = companyB.id;
    companyIds.push(companyA.id, companyB.id);

    const [divisionA, divisionB] = await Promise.all([
      prisma.division.create({
        data: {
          companyId: companyA.id,
          code: `DIVA${short}`,
          name: `E2E Critical Division A ${suffix}`,
          type: DivisionType.OTHER,
        },
      }),
      prisma.division.create({
        data: {
          companyId: companyB.id,
          code: `DIVB${short}`,
          name: `E2E Critical Division B ${suffix}`,
          type: DivisionType.OTHER,
        },
      }),
    ]);
    divisionAId = divisionA.id;
    divisionIds.push(divisionA.id, divisionB.id);

    const [branchA, branchB] = await Promise.all([
      prisma.branch.create({
        data: {
          divisionId: divisionA.id,
          code: `BRA${short}`,
          name: `E2E Critical Branch A ${suffix}`,
          type: BranchType.BRANCH,
        },
      }),
      prisma.branch.create({
        data: {
          divisionId: divisionB.id,
          code: `BRB${short}`,
          name: `E2E Critical Branch B ${suffix}`,
          type: BranchType.BRANCH,
        },
      }),
    ]);
    branchAId = branchA.id;
    branchIds.push(branchA.id, branchB.id);

    const fiscalYear = await prisma.fiscalYear.create({
      data: {
        companyId: companyA.id,
        name: `FY-${suffix}`,
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        endDate: new Date('2026-12-31T00:00:00.000Z'),
      },
    });
    fiscalYearIds.push(fiscalYear.id);

    const accountingPeriod = await prisma.accountingPeriod.create({
      data: {
        companyId: companyA.id,
        fiscalYearId: fiscalYear.id,
        name: `JAN-${suffix}`,
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        endDate: new Date('2026-01-31T00:00:00.000Z'),
      },
    });
    accountingPeriodAId = accountingPeriod.id;
    accountingPeriodIds.push(accountingPeriod.id);

    const passwordHash = await argon2.hash(TEST_PASS);
    const [creator, poster] = await Promise.all([
      prisma.user.create({
        data: {
          email: `e2e-critical-creator-${suffix}@itemba.local`,
          passwordHash,
          fullName: 'E2E Critical Creator',
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
          email: `e2e-critical-poster-${suffix}@itemba.local`,
          passwordHash,
          fullName: 'E2E Critical Poster',
          status: 'ACTIVE',
          companyId: companyA.id,
          userRoles: { create: { roleId: companyRole.id } },
          companyAccess: {
            create: { companyId: companyA.id, accessLevel: AccessLevel.MANAGE },
          },
        },
      }),
    ]);
    userIds.push(creator.id, poster.id);

    const [unitB, productCategoryB, externalPaymentB] = await Promise.all([
      prisma.unitOfMeasure.create({
        data: {
          companyId: companyB.id,
          name: `E2E Unit B ${suffix}`,
          symbol: `EUB${short}`,
          unitType: UnitType.PIECE,
        },
      }),
      prisma.productCategory.create({
        data: {
          companyId: companyB.id,
          name: `E2E Product Category B ${suffix}`,
          categoryType: ProductCategoryType.OTHER,
        },
      }),
      prisma.externalPayment.create({
        data: {
          companyId: companyB.id,
          paymentNumber: `PAY-B-${suffix}`,
          amount: 42,
          paymentMethod: ExternalPaymentMethod.MOBILE_MONEY,
        },
      }),
    ]);
    unitBId = unitB.id;
    productCategoryBId = productCategoryB.id;
    externalPaymentBId = externalPaymentB.id;
    unitIds.push(unitB.id);
    productCategoryIds.push(productCategoryB.id);
    externalPaymentIds.push(externalPaymentB.id);

    const productB = await prisma.product.create({
      data: {
        companyId: companyB.id,
        categoryId: productCategoryB.id,
        productCode: `PRDB${short}`,
        name: `E2E Product B ${suffix}`,
        productType: ProductType.STOCK_ITEM,
        baseUnitId: unitB.id,
        trackInventory: true,
      },
    });
    productBId = productB.id;
    productIds.push(productB.id);

    const inventoryBalanceB = await prisma.inventoryBalance.create({
      data: {
        companyId: companyB.id,
        productId: productB.id,
        branchId: branchB.id,
        quantityOnHand: 9,
      },
    });
    inventoryBalanceBId = inventoryBalanceB.id;
    inventoryBalanceIds.push(inventoryBalanceB.id);

    const apiClient = await prisma.apiClient.create({
      data: {
        clientCode: `E2E-CW-API-${short}`,
        companyId: companyA.id,
        name: `E2E Critical API Client ${suffix}`,
        allowedScopes: ['payments.read', 'payments.write'],
        createdById: creator.id,
      },
    });
    apiClientIds.push(apiClient.id);

    apiKeyValue = `e2e_cw_${suffix}_secret`;
    const apiKey = await prisma.apiKey.create({
      data: {
        apiKeyCode: `E2E-CW-KEY-${short}`,
        apiClientId: apiClient.id,
        keyPrefix: apiKeyValue.slice(0, 12),
        keyHash: crypto.createHash('sha256').update(apiKeyValue).digest('hex'),
        name: `E2E Critical API Key ${suffix}`,
        scopes: ['payments.read', 'payments.write'],
        status: ApiKeyStatus.ACTIVE,
        createdById: creator.id,
      },
    });
    apiKeyIds.push(apiKey.id);

    companyToken = await loginAs(app, creator.email, TEST_PASS);
    posterToken = await loginAs(app, poster.email, TEST_PASS);
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
            description: `E2E critical workflow permission for ${code}`,
            module,
            action,
          },
        });
      }),
    );
  }

  async function cleanupTestData() {
    await prisma.apiRequestLog.deleteMany({
      where: {
        OR: [
          { apiClientId: { in: apiClientIds } },
          { apiKeyId: { in: apiKeyIds } },
          { companyId: { in: companyIds } },
        ],
      },
    });
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { userId: { in: userIds } },
          { companyId: { in: companyIds } },
          { entityId: { in: [...journalEntryIds, ...stockAdjustmentIds, ...externalPaymentIds] } },
        ],
      },
    });
    await prisma.externalPayment.deleteMany({ where: { id: { in: externalPaymentIds } } });
    await prisma.journalEntryLine.deleteMany({
      where: { journalEntryId: { in: journalEntryIds } },
    });
    await prisma.journalEntry.deleteMany({ where: { id: { in: journalEntryIds } } });
    await prisma.inventoryMovement.deleteMany({
      where: {
        OR: [{ referenceId: { in: stockAdjustmentIds } }, { productId: { in: productIds } }],
      },
    });
    await prisma.inventoryBalance.deleteMany({
      where: {
        OR: [{ id: { in: inventoryBalanceIds } }, { productId: { in: productIds } }],
      },
    });
    await prisma.stockAdjustmentLine.deleteMany({
      where: { stockAdjustmentId: { in: stockAdjustmentIds } },
    });
    await prisma.stockAdjustment.deleteMany({ where: { id: { in: stockAdjustmentIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.productCategory.deleteMany({ where: { id: { in: productCategoryIds } } });
    await prisma.unitOfMeasure.deleteMany({ where: { id: { in: unitIds } } });
    await prisma.chartOfAccount.deleteMany({ where: { id: { in: chartAccountIds } } });
    await prisma.accountingPeriod.deleteMany({ where: { id: { in: accountingPeriodIds } } });
    await prisma.fiscalYear.deleteMany({ where: { id: { in: fiscalYearIds } } });
    await prisma.documentNumberSequence.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.apiKey.deleteMany({ where: { id: { in: apiKeyIds } } });
    await prisma.apiClient.deleteMany({ where: { id: { in: apiClientIds } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.activeSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.userCompanyAccess.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.securityEvent.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.rolePermission.deleteMany({ where: { roleId: { in: roleIds } } });
    await prisma.role.deleteMany({ where: { id: { in: roleIds } } });
    await prisma.branch.deleteMany({ where: { id: { in: branchIds } } });
    await prisma.division.deleteMany({ where: { id: { in: divisionIds } } });
    await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
    if (groupId) await prisma.group.deleteMany({ where: { id: groupId } });
  }

  it('creates, posts, and reverses a balanced journal entry through maker-checker GL controls', async () => {
    const asset = unwrap<any>(
      (
        await request(app.getHttpServer())
          .post('/api/v1/chart-of-accounts')
          .set('Authorization', authorization(companyToken))
          .send({
            companyId: companyAId,
            accountCode: `101-${short}`,
            accountName: `E2E Cash ${suffix}`,
            accountType: AccountType.ASSET,
          })
          .expect(201)
      ).body,
    );
    const income = unwrap<any>(
      (
        await request(app.getHttpServer())
          .post('/api/v1/chart-of-accounts')
          .set('Authorization', authorization(companyToken))
          .send({
            companyId: companyAId,
            accountCode: `401-${short}`,
            accountName: `E2E Income ${suffix}`,
            accountType: AccountType.INCOME,
          })
          .expect(201)
      ).body,
    );
    chartAccountIds.push(asset.id, income.id);

    const created = unwrap<any>(
      (
        await request(app.getHttpServer())
          .post('/api/v1/journal-entries')
          .set('Authorization', authorization(companyToken))
          .send({
            companyId: companyAId,
            accountingPeriodId: accountingPeriodAId,
            transactionDate: '2026-01-15T00:00:00.000Z',
            description: `E2E balanced journal ${suffix}`,
            lines: [
              { accountId: asset.id, debit: 125, credit: 0 },
              { accountId: income.id, debit: 0, credit: 125 },
            ],
          })
          .expect(201)
      ).body,
    );
    journalEntryIds.push(created.id);
    expect(created.status).toBe('DRAFT');
    expect(Number(created.totalDebit)).toBe(125);
    expect(Number(created.totalCredit)).toBe(125);

    await request(app.getHttpServer())
      .patch(`/api/v1/journal-entries/${created.id}/post`)
      .set('Authorization', authorization(companyToken))
      .expect(400);

    const posted = unwrap<any>(
      (
        await request(app.getHttpServer())
          .patch(`/api/v1/journal-entries/${created.id}/post`)
          .set('Authorization', authorization(posterToken))
          .expect(200)
      ).body,
    );
    expect(posted.status).toBe('POSTED');

    const reversal = unwrap<any>(
      (
        await request(app.getHttpServer())
          .patch(`/api/v1/journal-entries/${created.id}/reverse`)
          .set('Authorization', authorization(companyToken))
          .send({
            reversalReason: `E2E reversal ${suffix}`,
            transactionDate: '2026-01-16T00:00:00.000Z',
            accountingPeriodId: accountingPeriodAId,
          })
          .expect(200)
      ).body,
    );
    journalEntryIds.push(reversal.id);
    expect(reversal.status).toBe('POSTED');
    expect(reversal.reversalOfId).toBe(created.id);

    const originalAfterReversal = unwrap<any>(
      (
        await request(app.getHttpServer())
          .get(`/api/v1/journal-entries/${created.id}`)
          .set('Authorization', authorization(companyToken))
          .expect(200)
      ).body,
    );
    expect(originalAfterReversal.status).toBe('REVERSED');
  });

  it('creates stock master data, posts an adjustment, and exposes the resulting balance safely', async () => {
    const unit = unwrap<any>(
      (
        await request(app.getHttpServer())
          .post('/api/v1/units')
          .set('Authorization', authorization(companyToken))
          .send({
            companyId: companyAId,
            name: `E2E Piece ${suffix}`,
            symbol: `EA${short}`,
            unitType: UnitType.PIECE,
            isBaseUnit: true,
          })
          .expect(201)
      ).body,
    );
    unitIds.push(unit.id);

    await request(app.getHttpServer())
      .get(`/api/v1/units/${unitBId}`)
      .set('Authorization', authorization(companyToken))
      .expect(403);

    await request(app.getHttpServer())
      .post('/api/v1/units')
      .set('Authorization', authorization(companyToken))
      .send({
        companyId: companyBId,
        name: `Forbidden Unit ${suffix}`,
        symbol: `FU${short}`,
        unitType: UnitType.PIECE,
      })
      .expect(403);

    const category = unwrap<any>(
      (
        await request(app.getHttpServer())
          .post('/api/v1/product-categories')
          .set('Authorization', authorization(companyToken))
          .send({
            companyId: companyAId,
            name: `E2E Category ${suffix}`,
            categoryType: ProductCategoryType.OTHER,
          })
          .expect(201)
      ).body,
    );
    productCategoryIds.push(category.id);

    const product = unwrap<any>(
      (
        await request(app.getHttpServer())
          .post('/api/v1/products')
          .set('Authorization', authorization(companyToken))
          .send({
            companyId: companyAId,
            divisionId: divisionAId,
            categoryId: category.id,
            name: `E2E Product A ${suffix}`,
            productType: ProductType.STOCK_ITEM,
            baseUnitId: unit.id,
            trackInventory: true,
          })
          .expect(201)
      ).body,
    );
    productIds.push(product.id);

    const adjustment = unwrap<any>(
      (
        await request(app.getHttpServer())
          .post('/api/v1/stock-adjustments')
          .set('Authorization', authorization(companyToken))
          .send({
            companyId: companyAId,
            divisionId: divisionAId,
            branchId: branchAId,
            reason: `E2E stock count ${suffix}`,
            lines: [
              {
                productId: product.id,
                systemQuantity: 0,
                countedQuantity: 7,
                unitId: unit.id,
                reason: 'Opening count',
              },
            ],
          })
          .expect(201)
      ).body,
    );
    stockAdjustmentIds.push(adjustment.id);

    await request(app.getHttpServer())
      .patch(`/api/v1/stock-adjustments/${adjustment.id}/submit`)
      .set('Authorization', authorization(companyToken))
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/stock-adjustments/${adjustment.id}/approve`)
      .set('Authorization', authorization(posterToken))
      .expect(200);
    const postedAdjustment = unwrap<any>(
      (
        await request(app.getHttpServer())
          .patch(`/api/v1/stock-adjustments/${adjustment.id}/post`)
          .set('Authorization', authorization(posterToken))
          .expect(200)
      ).body,
    );
    expect(postedAdjustment.status).toBe('POSTED');

    const balances = unwrapArray<any>(
      (
        await request(app.getHttpServer())
          .get('/api/v1/inventory-balances')
          .query({ companyId: companyAId, productId: product.id, locationId: branchAId })
          .set('Authorization', authorization(companyToken))
          .expect(200)
      ).body,
    );
    expect(balances).toHaveLength(1);
    inventoryBalanceIds.push(balances[0].id);
    expect(Number(balances[0].quantityOnHand)).toBe(7);

    const live = unwrap<any>(
      (
        await request(app.getHttpServer())
          .get('/api/v1/inventory-balances/live')
          .query({ companyId: companyAId })
          .set('Authorization', authorization(companyToken))
          .expect(200)
      ).body,
    );
    expect(live.locations.map((item: any) => item.locationId)).toContain(branchAId);

    await request(app.getHttpServer())
      .get(`/api/v1/inventory-balances/${inventoryBalanceBId}`)
      .set('Authorization', authorization(companyToken))
      .expect(403);

    await request(app.getHttpServer())
      .get('/api/v1/inventory-balances/live')
      .query({ companyId: companyBId })
      .set('Authorization', authorization(companyToken))
      .expect(403);
  });

  it('creates and confirms integration payments under the API key company scope', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/external-payments')
      .set('Authorization', authorization(companyToken))
      .send({
        companyId: companyBId,
        payerName: 'Forbidden payer',
        amount: 50,
        paymentMethod: ExternalPaymentMethod.MOBILE_MONEY,
      })
      .expect(403);

    await request(app.getHttpServer())
      .get(`/api/v1/external-payments/${externalPaymentBId}`)
      .set('Authorization', authorization(companyToken))
      .expect(403);

    await request(app.getHttpServer())
      .post(`/api/v1/external-payments/${externalPaymentBId}/confirm`)
      .set('Authorization', authorization(companyToken))
      .expect(403);

    const created = unwrap<any>(
      (
        await request(app.getHttpServer())
          .post('/api/v1/integration/payments')
          .set('x-api-key', apiKeyValue)
          .send({
            companyId: companyBId,
            externalReference: `E2E-REF-${suffix}`,
            payerName: 'Integration Payer',
            amount: 80,
            paymentMethod: ExternalPaymentMethod.MOBILE_MONEY,
            idempotencyKey: `e2e-idem-${suffix}`,
          })
          .expect(201)
      ).body,
    );
    externalPaymentIds.push(created.id);
    expect(created.companyId).toBe(companyAId);
    expect(created.status).toBe('INITIATED');

    const list = unwrapArray<any>(
      (
        await request(app.getHttpServer())
          .get('/api/v1/integration/payments')
          .set('x-api-key', apiKeyValue)
          .expect(200)
      ).body,
    );
    expect(list.map((payment) => payment.id)).toContain(created.id);
    expect(list.every((payment) => payment.companyId === companyAId)).toBe(true);

    const confirmed = unwrap<any>(
      (
        await request(app.getHttpServer())
          .post(`/api/v1/integration/payments/${created.id}/confirm`)
          .set('x-api-key', apiKeyValue)
          .expect(201)
      ).body,
    );
    expect(confirmed.status).toBe('SUCCESS');

    const fetched = unwrap<any>(
      (
        await request(app.getHttpServer())
          .get(`/api/v1/integration/payments/${created.id}`)
          .set('x-api-key', apiKeyValue)
          .expect(200)
      ).body,
    );
    expect(fetched.id).toBe(created.id);
    expect(fetched.companyId).toBe(companyAId);
  });
});
