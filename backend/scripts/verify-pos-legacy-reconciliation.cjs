const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const argon2 = require('argon2');

/** Extends only the guarded loopback proof with new synthetic historical fixtures. */
module.exports.verifyPosLegacyReconciliation = async ({ db, check, fixture: f, call, cashier }) => {
  assert.ok(f.company.code.startsWith('POS-'), 'Legacy proof requires the synthetic POS fixture');
  const scope = { companyId: f.company.id, divisionId: f.division.id, branchId: f.branch.id };
  const reference = (terminal) => ({
    id: terminal.id,
    code: terminal.terminalCode,
    name: terminal.name,
  });
  const sortedIds = (rows) => rows.map((row) => row.id).sort();
  const outcomePath = (terminalId, requestId) =>
    `/pos-drafts/legacy-outcome?terminalId=${terminalId}&requestId=${requestId}`;
  let historicalRecorder;
  async function terminal(
    label,
    status,
    terminalScope = scope,
    customerId = f.customer.id,
    assignedUserId = historicalRecorder.id,
  ) {
    return db.mobilePosTerminal.create({
      data: {
        ...terminalScope,
        terminalCode: 'LEGACY-' + randomUUID(),
        name: 'Synthetic legacy ' + label,
        status,
        assignedUserId,
        generalCustomerId: customerId,
        // A reconciliation response must never expose retained provisioning secrets.
        deviceSecretHash: 'synthetic-private-device-hash',
        activationTokenHash: 'synthetic-private-activation-hash',
      },
    });
  }
  async function effects() {
    const [sales, drafts, journals, movements, cash, balances] = await Promise.all([
      db.salesOrder.findMany({
        where: { companyId: f.company.id },
        select: {
          id: true,
          status: true,
          idempotencyKey: true,
          totalAmount: true,
          paidAmount: true,
        },
        orderBy: { id: 'asc' },
      }),
      db.posDraft.findMany({
        where: { companyId: f.company.id },
        select: { id: true, status: true, revision: true, pendingMoney: true },
        orderBy: { id: 'asc' },
      }),
      db.journalEntry.count({ where: { companyId: f.company.id } }),
      db.inventoryMovement.count({ where: { companyId: f.company.id } }),
      db.cashAccount.findMany({
        where: { companyId: f.company.id },
        select: { id: true, currentBalance: true },
        orderBy: { id: 'asc' },
      }),
      db.inventoryBalance.findMany({
        where: { companyId: f.company.id },
        select: {
          id: true,
          quantityOnHand: true,
          quantityReserved: true,
          totalValue: true,
          physicalRevision: true,
        },
        orderBy: { id: 'asc' },
      }),
    ]);
    return JSON.parse(JSON.stringify({ sales, drafts, journals, movements, cash, balances }));
  }
  function assertReferences(rows) {
    assert.ok(Array.isArray(rows), 'Historical terminal references must be an array');
    for (const row of rows) {
      assert.deepEqual(Object.keys(row).sort(), ['code', 'id', 'name']);
      assert.equal(typeof row.id, 'string');
      assert.equal(typeof row.code, 'string');
      assert.equal(typeof row.name, 'string');
    }
  }
  let historical;
  await check(
    'Company office reconciliation lists historical terminal references and resolves original identities without posting',
    async () => {
      historicalRecorder = await db.user.create({
        data: {
          companyId: f.company.id,
          email: 'legacy-original-' + randomUUID() + '@example.invalid',
          fullName: 'Synthetic historical legacy recorder',
          passwordHash: f.legacyStaff.user.passwordHash,
          status: 'ACTIVE',
        },
      });
      const suspended = await terminal('paused terminal', 'SUSPENDED');
      const revoked = await terminal('revoked terminal', 'REVOKED');
      const otherCompany = await db.company.create({
        data: {
          groupId: f.company.groupId,
          code: 'POS-LEGACY-' + randomUUID(),
          name: 'Synthetic inaccessible legacy company',
        },
      });
      const otherDivision = await db.division.create({
        data: {
          companyId: otherCompany.id,
          code: 'LEGACY',
          name: 'Legacy division',
          type: 'OTHER',
        },
      });
      const otherBranch = await db.branch.create({
        data: {
          divisionId: otherDivision.id,
          code: 'LEGACY',
          name: 'Legacy branch',
          type: 'OTHER',
        },
      });
      const otherCustomer = await db.customer.create({
        data: {
          companyId: otherCompany.id,
          customerCode: 'LEGACY',
          name: 'Synthetic legacy customer',
        },
      });
      const otherUser = await db.user.create({
        data: {
          companyId: otherCompany.id,
          email: 'legacy-foreign-' + randomUUID() + '@example.invalid',
          fullName: 'Synthetic inaccessible legacy recorder',
          passwordHash: f.legacyStaff.user.passwordHash,
          status: 'ACTIVE',
        },
      });
      const foreign = await terminal(
        'foreign company',
        'REVOKED',
        { companyId: otherCompany.id, divisionId: otherDivision.id, branchId: otherBranch.id },
        otherCustomer.id,
        otherUser.id,
      );
      const requestId = randomUUID();
      // Imported historical canonical evidence: reconciliation must read this
      // identity rather than re-submit or synthesize a fresh posting.
      const sale = await db.salesOrder.create({
        data: {
          ...scope,
          salesOrderNumber: 'LEGACY-' + randomUUID(),
          customerId: f.customer.id,
          orderDate: new Date(),
          currency: 'TZS',
          salesType: 'CASH_SALE',
          paymentMethod: 'CASH',
          cashAccountId: f.cash.id,
          createdById: historicalRecorder.id,
          confirmedById: f.admin.user.id,
          confirmedAt: new Date(),
          status: 'PAID',
          paymentStatus: 'PAID',
          subtotal: 100,
          totalAmount: 100,
          paidAmount: 100,
          mobilePosTerminalId: suspended.id,
          idempotencyKey: requestId,
          lines: {
            create: {
              productId: f.product.id,
              unitId: f.unit.id,
              quantity: 1,
              unitPrice: 100,
              lineTotal: 100,
            },
          },
        },
      });
      historical = { suspended, revoked, foreign, otherCompany, requestId, sale };
      const before = await effects();
      await call(f.admin.token, 'GET', '/mobile-pos-lite/terminals', undefined, 403);
      const expected = await db.mobilePosTerminal.findMany({
        where: { companyId: f.company.id },
        select: { id: true },
      });
      const rows = await call(f.admin.token, 'GET', '/pos-drafts/legacy-terminals');
      assertReferences(rows);
      assert.deepEqual(sortedIds(rows), sortedIds(expected));
      assert.deepEqual(
        rows.find((row) => row.id === suspended.id),
        reference(suspended),
      );
      assert.deepEqual(
        rows.find((row) => row.id === revoked.id),
        reference(revoked),
      );
      const filtered = await call(
        f.admin.token,
        'GET',
        `/pos-drafts/legacy-terminals?companyId=${f.company.id}&branchId=${f.branch.id}`,
      );
      assertReferences(filtered);
      assert.ok(filtered.some((row) => row.id === revoked.id));
      assert.ok(!filtered.some((row) => row.id === foreign.id));
      await call(
        f.admin.token,
        'GET',
        `/pos-drafts/legacy-terminals?companyId=${otherCompany.id}`,
        undefined,
        403,
      );
      await call(
        f.admin.token,
        'GET',
        `/pos-drafts/legacy-terminals?branchId=${otherBranch.id}`,
        undefined,
        403,
      );
      await call(f.admin.token, 'GET', outcomePath(foreign.id, requestId), undefined, 403);
      const expectedOutcome = {
        state: 'posted',
        postedEntityType: 'SalesOrder',
        postedEntityId: sale.id,
        recordStatus: 'PAID',
      };
      assert.deepEqual(
        await call(f.admin.token, 'GET', outcomePath(suspended.id, requestId)),
        expectedOutcome,
      );
      assert.deepEqual(
        await call(f.admin.token, 'GET', outcomePath(suspended.id, requestId)),
        expectedOutcome,
      );
      assert.equal(
        (await call(f.admin.token, 'GET', outcomePath(revoked.id, requestId))).state,
        'not_found',
      );
      assert.equal(
        (await call(f.admin.token, 'GET', outcomePath(suspended.id, randomUUID()))).state,
        'not_found',
      );
      assert.deepEqual(
        await effects(),
        before,
        'Legacy identity reads must not alter canonical or draft effects',
      );
    },
  );
  await check(
    'Legacy reconciliation enforces branch boundaries and denies valid PIN sessions',
    async () => {
      assert.ok(historical, 'Historical fixture must be available');
      const destination = await terminal('other branch', 'REVOKED', {
        ...scope,
        branchId: f.destination.id,
      });
      const role = await db.role.create({
        data: {
          name: 'POS-LEGACY-READER-' + randomUUID(),
          displayName: 'Synthetic branch reconciliation reader',
          scope: 'BRANCH',
          rolePermissions: {
            create: ['pos_drafts.view', 'mobile_pos_lite.manage'].map((code) => ({
              permission: { connect: { code } },
            })),
          },
        },
      });
      const password = randomBytes(24).toString('base64url');
      const user = await db.user.create({
        data: {
          fullName: 'Synthetic branch reconciliation reader',
          email: 'legacy-reader-' + randomUUID() + '@example.invalid',
          passwordHash: await argon2.hash(password),
          companyId: f.company.id,
          status: 'ACTIVE',
          userRoles: { create: { roleId: role.id } },
          companyAccess: { create: { companyId: f.company.id, accessLevel: 'READ' } },
          branchAccess: { create: { branchId: f.branch.id, accessLevel: 'READ' } },
        },
      });
      const office = await call(null, 'POST', '/auth/login', { email: user.email, password });
      assert.ok(office.accessToken, 'Branch office reader must receive a password session');
      const before = await effects();
      const expected = await db.mobilePosTerminal.findMany({
        where: { companyId: f.company.id, branchId: f.branch.id },
        select: { id: true },
      });
      const rows = await call(office.accessToken, 'GET', '/pos-drafts/legacy-terminals');
      assertReferences(rows);
      assert.deepEqual(sortedIds(rows), sortedIds(expected));
      assert.ok(rows.some((row) => row.id === historical.suspended.id));
      assert.ok(rows.some((row) => row.id === historical.revoked.id));
      assert.ok(!rows.some((row) => row.id === destination.id || row.id === historical.foreign.id));
      const companyRows = await call(f.admin.token, 'GET', '/pos-drafts/legacy-terminals');
      assert.ok(
        companyRows.some((row) => row.id === destination.id),
        'Company admin retains accessible destination references',
      );
      await call(
        office.accessToken,
        'GET',
        `/pos-drafts/legacy-terminals?branchId=${f.destination.id}`,
        undefined,
        403,
      );
      await call(
        office.accessToken,
        'GET',
        `/pos-drafts/legacy-terminals?companyId=${historical.otherCompany.id}`,
        undefined,
        403,
      );
      await call(
        office.accessToken,
        'GET',
        outcomePath(destination.id, historical.requestId),
        undefined,
        403,
      );
      const outcome = await call(
        office.accessToken,
        'GET',
        outcomePath(historical.suspended.id, historical.requestId),
      );
      assert.equal(outcome.postedEntityId, historical.sale.id);
      assert.equal(outcome.state, 'posted');
      await call(cashier.accessToken, 'GET', '/mobile-pos-auth/me', undefined, 200, cashier.secret);
      await call(
        cashier.accessToken,
        'GET',
        '/pos-drafts/legacy-terminals',
        undefined,
        403,
        cashier.secret,
      );
      await call(
        cashier.accessToken,
        'GET',
        outcomePath(historical.suspended.id, historical.requestId),
        undefined,
        403,
        cashier.secret,
      );
      assert.deepEqual(
        await effects(),
        before,
        'Denied and permitted reconciliation reads must not mutate stock, cash or posting state',
      );
    },
  );
};
