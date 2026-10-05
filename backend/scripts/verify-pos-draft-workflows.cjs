/* Repeatable synthetic proof. Intentionally refuses every non-rehearsal database/API. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const argon2 = require('argon2');
const { PrismaClient } = require('@prisma/client');

const root = path.resolve(__dirname, '../..');
const env = require('dotenv').parse(fs.readFileSync(path.join(root, '.release/rehearsal.env')));
const database = new URL(env.DATABASE_URL);
assert.equal(
  database.hostname,
  '127.0.0.1',
  'Proof database must use the exact rehearsal loopback',
);
assert.equal(database.port, '18564', 'Proof database must use the dedicated rehearsal port');
assert.equal(database.pathname, '/itemba_release_proof', 'Proof database name must be isolated');
const api = 'http://127.0.0.1:28001/api/v1';
const db = new PrismaClient({ datasourceUrl: env.DATABASE_URL, log: [] });
const stamp = Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
const password = env.RELEASE_PROOF_USER_PASSWORD || crypto.randomBytes(24).toString('base64url');
const report = {
  sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim(),
  sourceTreeClean:
    execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], {
      cwd: root,
      encoding: 'utf8',
    }).trim() === '',
  compiledEntrySha256: crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(root, 'backend/dist/main.js')))
    .digest('hex'),
  startedAt: new Date().toISOString(),
  fixture: null,
  checks: [],
};
let failures = 0;

async function request(token, method, route, body, expected, deviceSecret, rateRetries = 0) {
  const response = await fetch(api + route, {
    method,
    redirect: 'error',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(deviceSecret ? { 'x-mobile-pos-device': deviceSecret } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(90000),
  });
  const text = await response.text();
  if (response.status === 429 && rateRetries < 2) {
    const retrySeconds = Number(response.headers.get('retry-after'));
    const waitSeconds =
      Number.isFinite(retrySeconds) && retrySeconds > 0 ? Math.min(retrySeconds + 1, 61) : 61;
    console.log('WAIT local API rate limit; bounded retry after ' + waitSeconds + ' seconds');
    await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
    return request(token, method, route, body, expected, deviceSecret, rateRetries + 1);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = {};
  }
  // Do not put route secrets, authentication bodies, or response tokens into failures.
  if (expected !== undefined)
    assert.equal(response.status, expected, `Expected HTTP ${expected}; got ${response.status}`);
  else assert.ok(response.ok, `Expected success; got HTTP ${response.status}`);
  return { status: response.status, data: parsed.data ?? parsed };
}
async function call(token, method, route, body, expected, deviceSecret) {
  return (await request(token, method, route, body, expected, deviceSecret)).data;
}
async function check(name, fn) {
  try {
    await fn();
    report.checks.push({ name, passed: true });
    console.log('PASS ' + name);
  } catch (error) {
    failures++;
    // Assertions contain only synthetic state. Database/API failures stay redacted.
    const reason =
      error.code === 'ERR_ASSERTION' ? error.message.slice(0, 400) : error.constructor.name;
    report.checks.push({ name, passed: false, reason });
    console.log('FAIL ' + name + ': ' + reason);
  }
}
const n = (value) => Number(value);
const captureTime = () => new Date().toISOString();
const eastAfricaDay = (timestamp) =>
  new Date(new Date(timestamp).getTime() + 3 * 3600000).toISOString().slice(0, 10);

async function fixtures() {
  const group = await db.group.create({
    data: { code: 'POS-PROOF-' + stamp, name: 'Synthetic POS proof ' + stamp },
  });
  const company = await db.company.create({
    data: { groupId: group.id, code: 'POS-' + stamp, name: 'Synthetic POS ' + stamp },
  });
  await db.companyProfile.create({
    data: {
      companyId: company.id,
      registeredName: company.name,
      brelaRegNumber: stamp,
      tin: stamp,
      registeredAddress: 'Private rehearsal fixture',
      currency: 'TZS',
    },
  });
  const division = await db.division.create({
    data: { companyId: company.id, name: 'Proof division', code: 'POS', type: 'OTHER' },
  });
  const branch = await db.branch.create({
    data: { divisionId: division.id, name: 'Proof source', code: 'SOURCE', type: 'OTHER' },
  });
  const destination = await db.branch.create({
    data: { divisionId: division.id, name: 'Proof destination', code: 'DEST', type: 'OTHER' },
  });
  const year = new Date().getUTCFullYear();
  const startDate = new Date(`${year}-01-01T00:00:00Z`),
    endDate = new Date(`${year}-12-31T23:59:59Z`);
  const fiscalYear = await db.fiscalYear.create({
    data: { companyId: company.id, name: 'Proof year', startDate, endDate, status: 'OPEN' },
  });
  await db.accountingPeriod.create({
    data: {
      companyId: company.id,
      fiscalYearId: fiscalYear.id,
      name: 'Proof period',
      startDate,
      endDate,
      status: 'OPEN',
    },
  });
  const chart = {};
  for (const [accountCode, accountType, accountSubType] of [
    ['1010', 'ASSET', 'cash_on_hand'],
    ['1100', 'ASSET', 'ar_control'],
    ['1200', 'ASSET', 'inventory_asset'],
    ['2000', 'LIABILITY', 'ap_control'],
    ['2200', 'LIABILITY', 'tax_vat_payable'],
    ['1400', 'ASSET', 'tax_vat_receivable'],
    ['4000', 'INCOME', 'sales_revenue'],
    ['5000', 'EXPENSE', 'cost_of_goods_sold'],
    ['6000', 'EXPENSE', 'general_expense'],
    ['6950', 'EXPENSE', 'purchase_variance'],
    ['5400', 'EXPENSE', 'inventory_adjustment_variance'],
  ])
    chart[accountCode] = await db.chartOfAccount.create({
      data: {
        companyId: company.id,
        accountCode,
        accountName: 'Proof ' + accountCode,
        accountType,
        accountSubType,
      },
    });
  const cash = await db.cashAccount.create({
    data: {
      companyId: company.id,
      divisionId: division.id,
      branchId: branch.id,
      accountName: 'Proof till',
      accountType: 'CASH_ON_HAND',
      ledgerAccountId: chart['1010'].id,
      currency: 'TZS',
    },
  });
  await db.cashDeskAccount.create({
    data: {
      companyId: company.id,
      divisionId: division.id,
      branchId: branch.id,
      erpCashAccountId: cash.id,
      name: 'Proof till mirror',
      nameKey: 'proof-till',
      kind: 'CASH',
      currency: 'TZS',
      openingDate: new Date(),
    },
  });
  const customer = await db.customer.create({
    data: {
      customerCode: 'PROOF-GENERAL',
      companyId: company.id,
      name: 'Proof general customer',
      creditLimit: 1000000,
    },
  });
  const supplier = await db.supplier.create({
    data: { supplierCode: 'PROOF-SUPPLIER', companyId: company.id, name: 'Proof supplier' },
  });
  const category = await db.productCategory.create({
    data: { companyId: company.id, name: 'Proof category' },
  });
  const unit = await db.unitOfMeasure.create({
    data: { companyId: company.id, name: 'Proof piece', symbol: 'pc', isBaseUnit: true },
  });
  const product = await db.product.create({
    data: {
      companyId: company.id,
      productCode: 'PROOF-PRODUCT',
      name: 'Proof stock item',
      categoryId: category.id,
      baseUnitId: unit.id,
      defaultPurchasePrice: 40,
      defaultSellingPrice: 100,
      retailPrice: 100,
      trackInventory: true,
      isTaxable: false,
    },
  });
  await db.inventoryBalance.create({
    data: {
      companyId: company.id,
      divisionId: division.id,
      branchId: branch.id,
      productId: product.id,
      quantityOnHand: 100,
      quantityReserved: 0,
      averageCost: 40,
      totalValue: 4000,
    },
  });
  const permissions = [
    'purchases.create',
    'purchases.view',
    'purchases.confirm',
    'purchases.receive',
    'purchases.cancel',
    'supplier_order_drafts.view',
    'supplier_order_drafts.create',
    'supplier_order_drafts.send',
    'notifications.view',
    'mobile_pos_onboarding.manage',
    'mobile_pos_lite.access',
    'mobile_pos_lite.manage',
    'mobile_pos_lite.view',
    'mobile_pos_lite.edit_price',
    'pos_drafts.view',
    'pos_drafts.create',
    'pos_drafts.dispatch',
    'pos_drafts.approve',
    'pos_drafts.reject',
    'pos_drafts.direct_post',
    'sales_orders.create',
    'sales_orders.confirm',
    'sales_orders.read',
    'sales_orders.update',
    'purchase_orders.create',
    'purchase_orders.confirm',
    'purchase_orders.receive',
    'purchase_orders.read',
    'customer_payments.create',
    'customer_payments.confirm',
    'stock_adjustments.post',
    'stock_damage.post',
    'inventory_movements.create',
    'journal_entries.post',
    'supplier_invoices.create',
    'supplier_invoices.approve',
    'three_way_match.create',
    'three_way_match.view',
    'sales.view',
    'sales_desk.view',
    'cash_desk.view',
    'cash_desk.record',
    'cash_desk.reverse',
    'payables.view',
    'supplier-payments.view',
    'supplier-payments.manage',
    'invoice_desk.view',
    'invoice_desk.payments',
    'cash_accounts.view',
    'inventory.view',
    'operations.reports.view',
    'grn.post',
    'sales.create',
    'sales.confirm',
    'inventory.adjustments.create',
  ];
  for (const code of permissions)
    await db.permission.upsert({
      where: { code },
      update: {},
      create: {
        code,
        description: 'Private POS proof permission',
        module: code.split('.')[0],
        action: code.split('.').slice(1).join('.'),
      },
    });
  const passwordHash = await argon2.hash(password);
  async function actor(label, permitted = permissions) {
    const role = await db.role.create({
      data: {
        name: 'POS-PROOF-' + label + '-' + stamp,
        displayName: 'Synthetic ' + label,
        scope: 'COMPANY',
        rolePermissions: {
          create: permitted.map((code) => ({ permission: { connect: { code } } })),
        },
      },
    });
    const user = await db.user.create({
      data: {
        fullName: 'Proof ' + label,
        email: `${label}-${stamp}@example.invalid`,
        passwordHash,
        companyId: company.id,
        status: 'ACTIVE',
        userRoles: { create: { roleId: role.id } },
        companyAccess: { create: { companyId: company.id, accessLevel: 'MANAGE' } },
      },
    });
    const session = await call(null, 'POST', '/auth/login', { email: user.email, password });
    assert.ok(session.accessToken, 'Office login must issue access token');
    return { user, token: session.accessToken, refreshToken: session.refreshToken };
  }
  const admin = await actor('admin'),
    reviewer = await actor('reviewer'),
    legacyStaff = await actor(
      'legacy-staff',
      permissions.filter(
        (code) => !['mobile_pos_lite.manage', 'mobile_pos_onboarding.manage'].includes(code),
      ),
    );
  report.fixture = { companyId: company.id, branchId: branch.id, run: stamp };
  fs.writeFileSync(
    path.join(root, '.release/pos-proof-fixture.json'),
    JSON.stringify(
      {
        ...report.fixture,
        divisionId: division.id,
        destinationBranchId: destination.id,
        adminUserId: admin.user.id,
        adminEmail: admin.user.email,
        reviewerUserId: reviewer.user.id,
        reviewerEmail: reviewer.user.email,
        customerId: customer.id,
        supplierId: supplier.id,
        productId: product.id,
        cashAccountId: cash.id,
      },
      null,
      2,
    ),
  );
  return {
    company,
    division,
    branch,
    destination,
    chart,
    cash,
    customer,
    supplier,
    unit,
    product,
    admin,
    reviewer,
    legacyStaff,
  };
}

async function main() {
  await call(null, 'GET', '/health');
  const f = await fixtures();
  const scope = { companyId: f.company.id, divisionId: f.division.id, branchId: f.branch.id };
  const query = '?companyId=' + f.company.id + '&branchId=' + f.branch.id;
  const balance = () =>
    db.inventoryBalance.findUniqueOrThrow({
      where: {
        companyId_productId_branchId: {
          companyId: f.company.id,
          productId: f.product.id,
          branchId: f.branch.id,
        },
      },
    });
  const financial = async () => ({
    sales: await db.salesOrder.count({ where: { companyId: f.company.id } }),
    journals: await db.journalEntry.count({ where: { companyId: f.company.id } }),
    movements: await db.inventoryMovement.count({ where: { companyId: f.company.id } }),
    money: n((await db.cashAccount.findUniqueOrThrow({ where: { id: f.cash.id } })).currentBalance),
  });
  const readProjection = async () => {
    const [sales, accounts, inventory, operations, directSales, deskAccounts] = await Promise.all([
      call(f.admin.token, 'GET', '/desk-reports/business' + query + '&kind=sales'),
      call(f.admin.token, 'GET', '/desk-reports/business' + query + '&kind=accounts'),
      call(f.admin.token, 'GET', '/inventory-balances/summary' + query),
      call(f.admin.token, 'GET', '/operations-reports/sales-summary' + query),
      call(f.admin.token, 'GET', '/sales-desk/overview' + query),
      call(f.admin.token, 'GET', '/cash-desk/accounts' + query),
    ]);
    const total = (report) => report.totals.find((total) => total.currency === 'TZS');
    return {
      sales: n(total(sales)?.amount ?? 0),
      salesCount: total(sales)?.count ?? 0,
      cash: n(total(accounts)?.balance ?? 0),
      inventoryValue: inventory.totalValue,
      operationSales: operations.totalSalesValue,
      cashDeskMirror: n(
        deskAccounts.find((account) => account.erpCashAccount?.id === f.cash.id)?.erpCashAccount
          .currentBalance,
      ),
      directSalesCount: directSales.currencies.reduce(
        (count, currency) => count + currency.count,
        0,
      ),
    };
  };
  const purchaseOrder = async (quantity, label, purchaseType = 'CREDIT_PURCHASE') =>
    db.purchaseOrder.create({
      data: {
        ...scope,
        purchaseOrderNumber: `PROOF-${label}-${stamp}`,
        supplierId: f.supplier.id,
        supplierName: f.supplier.name,
        purchaseType,
        status: 'CONFIRMED',
        orderDate: new Date(),
        subtotal: quantity * 40,
        totalAmount: quantity * 40,
        outstandingAmount: quantity * 40,
        createdById: f.admin.user.id,
        confirmedById: f.reviewer.user.id,
        confirmedAt: new Date(),
        lines: {
          create: [
            {
              productId: f.product.id,
              unitId: f.unit.id,
              quantity,
              unitCost: 40,
              lineTotal: quantity * 40,
            },
          ],
        },
      },
    });
  const balancedJournal = async (id, amount) => {
    const journal = await db.journalEntry.findUniqueOrThrow({
      where: { id },
      include: { lines: true },
    });
    assert.equal(journal.status, 'POSTED');
    assert.equal(n(journal.totalDebit), amount);
    assert.equal(n(journal.totalCredit), amount);
    assert.equal(
      journal.lines.reduce((sum, line) => sum + n(line.debit), 0),
      amount,
    );
    assert.equal(
      journal.lines.reduce((sum, line) => sum + n(line.credit), 0),
      amount,
    );
  };
  const employeeCount = await db.employee.count({ where: { companyId: f.company.id } });
  const setup = await call(f.admin.token, 'POST', '/mobile-pos-onboarding/branch-setups', {
    ...scope,
    generalCustomerId: f.customer.id,
    paymentMappings: [{ paymentMethod: 'CASH', cashAccountId: f.cash.id }],
    approvalRequired: true,
  });
  const invite = await call(f.admin.token, 'POST', '/mobile-pos-onboarding/invites', {
    branchSetupId: setup.id,
  });
  const publicInfo = await call(null, 'GET', '/mobile-pos-auth/invite/' + invite.token);
  assert.equal(publicInfo.branch.id, f.branch.id);
  assert.ok(!('paymentMappings' in publicInfo), 'Public install link exposes no payment registry');
  async function enroll(name, role) {
    const requestId = crypto.randomUUID();
    const claimToken = crypto.randomBytes(24).toString('base64url');
    const registration = await call(null, 'POST', '/mobile-pos-auth/invite/' + invite.token, {
      name,
      role,
      requestId,
      claimToken,
    });
    return {
      ...registration,
      requestName: name,
      requestedRole: role,
      secret: crypto.randomBytes(32).toString('hex'),
      pin: role === 'CASHIER' ? '123456' : '234567',
    };
  }
  const cashier = await enroll('Proof cashier', 'CASHIER');
  const stockist = await enroll('Proof stockist', 'STOCKIST');
  const adminClaim = await enroll('Existing office administrator', 'ADMIN');
  await check(
    'A lost enrollment response retries the same request and exact inbox delivery',
    async () => {
      const retry = await call(null, 'POST', '/mobile-pos-auth/invite/' + invite.token, {
        name: cashier.requestName,
        role: cashier.requestedRole,
        requestId: cashier.enrollmentId,
        claimToken: cashier.claimToken,
      });
      assert.equal(retry.enrollmentId, cashier.enrollmentId);
      assert.ok(
        retry.claimToken === cashier.claimToken,
        'Retry did not preserve the enrollment claim',
      );
      await call(
        null,
        'POST',
        '/mobile-pos-auth/invite/' + invite.token,
        {
          name: 'Changed request',
          role: cashier.requestedRole,
          requestId: cashier.enrollmentId,
          claimToken: cashier.claimToken,
        },
        409,
      );
      const delivered = await db.notification.findMany({
        where: {
          linkedEntityType: 'MobilePosEnrollment',
          linkedEntityId: cashier.enrollmentId,
          notificationType: 'APPROVAL_REQUIRED',
        },
      });
      assert.deepEqual(
        delivered.map((item) => item.recipientUserId).sort(),
        [f.admin.user.id, f.reviewer.user.id].sort(),
      );
      assert.ok(!JSON.stringify(delivered).includes(cashier.claimToken));
      assert.ok(
        !JSON.stringify(delivered).includes(
          crypto.createHash('sha256').update(cashier.claimToken).digest('hex'),
        ),
      );
    },
  );
  await check('Main OS inboxes contain scoped review links without claim credentials', async () => {
    for (const actor of [f.admin, f.reviewer]) {
      const inbox = await call(actor.token, 'GET', '/notifications/my?limit=100');
      const item = inbox.data.find((row) => row.linkedEntityId === cashier.enrollmentId);
      assert.equal(item.notificationType, 'APPROVAL_REQUIRED');
      assert.equal(item.actionUrl, `/pos-draft?view=devices&enrollmentId=${cashier.enrollmentId}`);
    }
    const other = await call(f.legacyStaff.token, 'GET', '/notifications/my?limit=100');
    assert.ok(!other.data.some((row) => row.linkedEntityId === cashier.enrollmentId));
  });
  await check(
    'Pending enrollment cannot set a PIN; public status does not contain a setup secret',
    async () => {
      const status = await call(null, 'GET', '/mobile-pos-auth/enrollment/' + cashier.claimToken);
      assert.equal(status.status, 'PENDING');
      assert.ok(!JSON.stringify(status).includes(cashier.claimToken));
      await call(
        null,
        'POST',
        '/mobile-pos-auth/setup',
        { claimToken: cashier.claimToken, deviceSecret: cashier.secret, pin: cashier.pin },
        401,
      );
    },
  );
  await check(
    'Administrator selection requires review then an existing scoped OS account without new privileges',
    async () => {
      await call(
        f.admin.token,
        'POST',
        `/mobile-pos-onboarding/enrollments/${adminClaim.enrollmentId}/admin-link`,
        { claimToken: adminClaim.claimToken },
        403,
      );
      await call(
        f.admin.token,
        'POST',
        `/mobile-pos-onboarding/enrollments/${adminClaim.enrollmentId}/approve`,
        { role: 'CASHIER' },
        400,
      );
      const usersBefore = await db.user.count({ where: { companyId: f.company.id } });
      const terminalsBefore = await db.mobilePosTerminal.count({
        where: { companyId: f.company.id },
      });
      const approved = await call(
        f.reviewer.token,
        'POST',
        `/mobile-pos-onboarding/enrollments/${adminClaim.enrollmentId}/approve`,
        { role: 'ADMIN' },
      );
      assert.equal(approved.userId, null);
      assert.equal(approved.terminalId, null);
      assert.equal(approved.adminLinked, false);
      assert.equal(await db.user.count({ where: { companyId: f.company.id } }), usersBefore);
      assert.equal(
        await db.mobilePosTerminal.count({ where: { companyId: f.company.id } }),
        terminalsBefore,
      );
      const links = await Promise.all(
        [0, 1].map(() =>
          call(
            f.admin.token,
            'POST',
            `/mobile-pos-onboarding/enrollments/${adminClaim.enrollmentId}/admin-link`,
            { claimToken: adminClaim.claimToken },
          ),
        ),
      );
      const linked = links[0];
      assert.equal(linked.userId, f.admin.user.id);
      assert.equal(linked.approvedRole, 'ADMIN');
      assert.equal(linked.adminLinked, true);
      assert.deepEqual(links[0], links[1]);
      const retry = await call(null, 'POST', '/mobile-pos-auth/invite/' + invite.token, {
        name: adminClaim.requestName,
        role: 'ADMIN',
        requestId: adminClaim.enrollmentId,
        claimToken: adminClaim.claimToken,
      });
      assert.equal(retry.status, 'APPROVED');
      assert.equal(retry.role, 'ADMIN');
      assert.equal(retry.adminLinked, true);
      assert.equal(
        await db.notification.count({
          where: {
            linkedEntityType: 'MobilePosEnrollment',
            linkedEntityId: adminClaim.enrollmentId,
            notificationType: 'APPROVAL_REQUIRED',
            status: 'UNREAD',
          },
        }),
        0,
      );
      const reviewed = await db.mobilePosEnrollment.findUniqueOrThrow({
        where: { id: adminClaim.enrollmentId },
      });
      assert.equal(reviewed.approvedById, f.reviewer.user.id);
      assert.equal(reviewed.approvedAt.toISOString(), approved.approvedAt);
      assert.equal(
        await db.auditLog.count({
          where: { action: 'MOBILE_POS_ADMIN_LINKED', entityId: adminClaim.enrollmentId },
        }),
        1,
      );
    },
  );
  await check(
    'Rejection closes the review notification and announces the decision without issuing a PIN account',
    async () => {
      const rejected = await enroll('Proof rejected request', 'CASHIER');
      await call(
        f.admin.token,
        'POST',
        `/mobile-pos-onboarding/enrollments/${rejected.enrollmentId}/reject`,
        { reason: 'Synthetic review rejected' },
      );
      const inbox = await call(f.admin.token, 'GET', '/notifications/my?limit=100');
      const rows = inbox.data.filter((row) => row.linkedEntityId === rejected.enrollmentId);
      assert.ok(
        rows.some((row) => row.notificationType === 'APPROVAL_REQUIRED' && row.status === 'READ'),
      );
      assert.ok(
        rows.some((row) => row.notificationType === 'APPROVAL_REJECTED' && row.status === 'UNREAD'),
      );
      const row = await db.mobilePosEnrollment.findUniqueOrThrow({
        where: { id: rejected.enrollmentId },
      });
      assert.equal(row.userId, null);
      assert.equal(row.pinHash, null);
    },
  );
  for (const [operator, role] of [
    [cashier, 'CASHIER'],
    [stockist, 'STOCKIST'],
  ]) {
    await call(
      f.admin.token,
      'POST',
      `/mobile-pos-onboarding/enrollments/${operator.enrollmentId}/approve`,
      { role },
    );
    const session = await call(null, 'POST', '/mobile-pos-auth/setup', {
      claimToken: operator.claimToken,
      deviceSecret: operator.secret,
      pin: operator.pin,
    });
    Object.assign(operator, session);
  }
  await check(
    'Approval creates a POS identity and terminal without fabricating an HR employee',
    async () => {
      assert.equal(await db.employee.count({ where: { companyId: f.company.id } }), employeeCount);
      const row = await db.mobilePosEnrollment.findUniqueOrThrow({
        where: { id: cashier.enrollmentId },
      });
      const user = await db.user.findUniqueOrThrow({ where: { id: row.userId } });
      const terminal = await db.mobilePosTerminal.findUniqueOrThrow({
        where: { id: row.terminalId },
      });
      assert.equal(user.authKind, 'POS_PIN');
      assert.equal(terminal.salespersonId, null);
      assert.equal(terminal.assignedUserId, user.id);
      assert.notEqual(row.deviceSecretHash, cashier.secret);
      assert.notEqual(row.pinHash, cashier.pin);
      await call(
        null,
        'POST',
        '/mobile-pos-auth/setup',
        {
          claimToken: cashier.claimToken,
          deviceSecret: crypto.randomBytes(32).toString('hex'),
          pin: '345678',
        },
        401,
      );
      const recovered = await call(null, 'POST', '/mobile-pos-auth/setup', {
        claimToken: cashier.claimToken,
        deviceSecret: cashier.secret,
        pin: cashier.pin,
      });
      assert.equal(recovered.user.id, cashier.user.id);
      Object.assign(cashier, recovered);
    },
  );
  await check(
    'PIN sessions retain narrow permissions and cannot use office auth or direct ERP writers',
    async () => {
      const profile = await call(cashier.accessToken, 'GET', '/mobile-pos-auth/me');
      assert.deepEqual(
        profile.user.permissions.sort(),
        ['mobile_pos_lite.access', 'pos_drafts.create', 'pos_drafts.view'].sort(),
      );
      assert.equal(profile.user.email, '');
      await call(cashier.accessToken, 'GET', '/auth/me', undefined, 403);
      await call(cashier.accessToken, 'POST', '/sales-orders', {}, 403);
      await call(cashier.accessToken, 'POST', '/mobile-pos-lite/sales', {}, 403);
      await call(cashier.accessToken, 'POST', '/purchase-orders', {}, 403);
      await call(cashier.accessToken, 'POST', '/stock-adjustments', {}, 403);
      await call(cashier.refreshToken, 'POST', '/auth/refresh', {}, 401);
      const enrollment = await db.mobilePosEnrollment.findUniqueOrThrow({
        where: { id: cashier.enrollmentId },
      });
      const user = await db.user.findUniqueOrThrow({ where: { id: enrollment.userId } });
      await call(null, 'POST', '/auth/login', { email: user.email, password }, 401);
      const context = await call(cashier.accessToken, 'GET', '/pos-drafts/context');
      assert.equal(context.scope.branchId, f.branch.id);
      const scopes = await call(cashier.accessToken, 'GET', '/pos-drafts/scopes');
      assert.deepEqual(
        scopes.branches.map((branch) => branch.id),
        [f.branch.id],
      );
      await call(
        cashier.accessToken,
        'GET',
        '/pos-drafts/context?companyId=' + f.company.id + '&branchId=' + f.destination.id,
        undefined,
        403,
      );
    },
  );
  await check(
    'Mobile refresh requires device proof, rotates once, and cannot widen the role',
    async () => {
      await call(
        null,
        'POST',
        '/mobile-pos-auth/refresh',
        {
          refreshToken: f.admin.refreshToken,
          deviceSecret: cashier.secret,
        },
        401,
      );
      await call(
        null,
        'POST',
        '/mobile-pos-auth/refresh',
        {
          refreshToken: cashier.refreshToken,
          deviceSecret: crypto.randomBytes(32).toString('hex'),
        },
        401,
      );
      const prior = cashier.refreshToken;
      const refreshed = await call(null, 'POST', '/mobile-pos-auth/refresh', {
        refreshToken: prior,
        deviceSecret: cashier.secret,
      });
      assert.equal(refreshed.role, 'CASHIER');
      assert.ok(!refreshed.user.permissions.includes('pos_drafts.approve'));
      await call(
        null,
        'POST',
        '/mobile-pos-auth/refresh',
        { refreshToken: prior, deviceSecret: cashier.secret },
        401,
      );
      Object.assign(cashier, refreshed);
    },
  );
  const envelope = (kind, payload, requestId = crypto.randomUUID()) => {
    const capturedAt = captureTime();
    return {
      ...scope,
      requestId,
      revision: undefined,
      kind,
      businessDate: eastAfricaDay(capturedAt),
      capturedAt,
      payload,
    };
  };
  const sale = (quantity) => ({
    customerId: f.customer.id,
    paymentMethod: 'CASH',
    lines: [{ productId: f.product.id, quantity }],
    expectedTotal: quantity * 100,
  });
  let cashierDraft, stockistDraft, beforeProjection;
  await check(
    'Cashier submission changes no stock, money, or canonical records and retries exactly once',
    async () => {
      const before = await financial(),
        beforeStock = n((await balance()).quantityOnHand);
      beforeProjection = await readProjection();
      const payload = envelope('SALE', sale(2));
      cashierDraft = await call(cashier.accessToken, 'POST', '/pos-drafts', payload);
      assert.equal(cashierDraft.status, 'SUBMITTED');
      assert.equal(cashierDraft.pendingMoney, 200);
      const retry = await call(cashier.accessToken, 'POST', '/pos-drafts', payload);
      assert.equal(retry.id, cashierDraft.id);
      await call(cashier.accessToken, 'POST', '/pos-drafts', { ...payload, payload: sale(3) }, 409);
      assert.deepEqual(await financial(), before);
      assert.deepEqual(await readProjection(), beforeProjection);
      assert.equal(n((await balance()).quantityOnHand), beforeStock);
      assert.equal(
        await db.posDraft.count({
          where: { companyId: f.company.id, requestId: payload.requestId },
        }),
        1,
      );
    },
  );
  await check(
    'Admin approval reserves full cashier stock; stockist prepares; final approval posts once',
    async () => {
      assert.ok(cashierDraft, 'Submission dependency passed');
      const before = await financial(),
        beforeStock = n((await balance()).quantityOnHand);
      await call(
        cashier.accessToken,
        'POST',
        `/pos-drafts/${cashierDraft.id}/approve`,
        { revision: 1 },
        403,
      );
      await call(
        cashier.accessToken,
        'POST',
        `/pos-drafts/${cashierDraft.id}/prepare`,
        { revision: 1 },
        403,
      );
      const approved = await call(f.admin.token, 'POST', `/pos-drafts/${cashierDraft.id}/approve`, {
        revision: 1,
      });
      assert.equal(approved.status, 'AWAITING_STOCKIST');
      assert.equal(n((await balance()).quantityReserved), 2);
      assert.equal(n((await balance()).quantityOnHand), beforeStock);
      assert.deepEqual(await financial(), before);
      const prepared = await call(
        stockist.accessToken,
        'POST',
        `/pos-drafts/${cashierDraft.id}/prepare`,
        { revision: approved.revision },
      );
      assert.equal(prepared.status, 'READY_FINAL');
      const results = await Promise.allSettled(
        [f.admin.token, f.reviewer.token].map((token) =>
          call(token, 'POST', `/pos-drafts/${cashierDraft.id}/approve`, {
            revision: prepared.revision,
          }),
        ),
      );
      const posted = results
        .filter((result) => result.status === 'fulfilled')
        .map((result) => result.value);
      assert.equal(posted.length, 1, 'Concurrent review accepts exactly one revision');
      assert.equal(posted[0].status, 'POSTED');
      const retry = await call(f.admin.token, 'POST', `/pos-drafts/${cashierDraft.id}/approve`, {
        revision: posted[0].revision,
      });
      assert.equal(retry.postedEntityId, posted[0].postedEntityId);
      const details = await call(f.admin.token, 'GET', `/pos-drafts/${cashierDraft.id}`);
      assert.ok(
        details.duplicateCandidates.every((candidate) => candidate.id !== posted[0].postedEntityId),
        'A posted sale must not list its own canonical document as a suspected duplicate',
      );
      assert.equal(
        await db.salesOrder.count({
          where: { companyId: f.company.id, id: posted[0].postedEntityId },
        }),
        1,
      );
      assert.equal(n((await balance()).quantityOnHand), beforeStock - 2);
      assert.equal(n((await balance()).quantityReserved), 0);
      assert.equal((await financial()).money, before.money + 200);
      const outcome = await call(
        cashier.accessToken,
        'GET',
        '/pos-drafts/outcome/' + cashierDraft.requestId,
      );
      assert.equal(outcome.state, 'posted');
      const projected = await readProjection();
      assert.equal(projected.sales, beforeProjection.sales + 200);
      assert.equal(projected.salesCount, beforeProjection.salesCount + 1);
      assert.equal(projected.operationSales, beforeProjection.operationSales + 200);
      assert.equal(projected.cash, beforeProjection.cash + 200);
      assert.equal(projected.cashDeskMirror, beforeProjection.cashDeskMirror + 200);
      assert.equal(projected.inventoryValue, beforeProjection.inventoryValue - 80);
      assert.equal(projected.directSalesCount, beforeProjection.directSalesCount);
    },
  );
  await check(
    'Stockist sale posts after a single admin decision without cashier preparation',
    async () => {
      const before = n((await balance()).quantityOnHand);
      stockistDraft = await call(
        stockist.accessToken,
        'POST',
        '/pos-drafts',
        envelope('SALE', sale(3)),
      );
      assert.equal(stockistDraft.originRole, 'STOCKIST');
      const result = await call(f.admin.token, 'POST', `/pos-drafts/${stockistDraft.id}/approve`, {
        revision: 1,
      });
      assert.equal(result.status, 'POSTED');
      assert.equal(n((await balance()).quantityOnHand), before - 3);
    },
  );
  await check(
    'Matching cashier and stockist captures reconcile without a second sale',
    async () => {
      const draft = await call(
        stockist.accessToken,
        'POST',
        '/pos-drafts',
        envelope('SALE', sale(2)),
      );
      assert.equal(draft.continuedExisting, true);
      const alias = await db.posDraft.findUniqueOrThrow({ where: { id: draft.captureDraftId } });
      assert.equal(alias.status, 'NEEDS_ATTENTION');
      assert.equal(n(alias.pendingMoney), 0);
      const outcome = await call(
        stockist.accessToken,
        'GET',
        '/pos-drafts/outcome/' + alias.requestId,
      );
      assert.equal(
        outcome.postedEntityId,
        (await db.posDraft.findUniqueOrThrow({ where: { id: cashierDraft.id } })).postedEntityId,
      );
      await call(
        f.admin.token,
        'POST',
        `/pos-drafts/${alias.id}/approve`,
        { revision: alias.revision },
        400,
      );
    },
  );
  await check(
    'A genuine repeated sale requires explicit review of every duplicate candidate',
    async () => {
      const before = await financial();
      const repeat = await call(
        stockist.accessToken,
        'POST',
        '/pos-drafts',
        envelope('SALE', sale(3)),
      );
      await request(
        f.admin.token,
        'POST',
        `/pos-drafts/${repeat.id}/approve`,
        { revision: 1 },
        409,
      );
      assert.deepEqual(await financial(), before);
      const detail = await call(f.admin.token, 'GET', `/pos-drafts/${repeat.id}`);
      assert.ok(detail.duplicateCandidates.length, 'Review detail lists duplicate candidates');
      const approved = await call(f.admin.token, 'POST', `/pos-drafts/${repeat.id}/approve`, {
        revision: detail.revision,
        duplicateReason: 'Customer made a separate genuine purchase',
        reviewedCandidateIds: detail.duplicateCandidates.map((candidate) => candidate.id),
      });
      assert.equal(approved.status, 'POSTED');
      assert.equal((await financial()).sales, before.sales + 1);
    },
  );
  await check(
    'Approved corrections release their own hold, preserve collected funds and require review again',
    async () => {
      const before = await financial();
      const capture = envelope('SALE', sale(19));
      const draft = await call(cashier.accessToken, 'POST', '/pos-drafts', capture);
      const approved = await call(f.admin.token, 'POST', `/pos-drafts/${draft.id}/approve`, {
        revision: 1,
      });
      assert.equal(n((await balance()).quantityReserved), 19);
      await call(
        cashier.accessToken,
        'PATCH',
        `/pos-drafts/${draft.id}/correct`,
        {
          ...capture,
          revision: approved.revision,
          payload: sale(18),
        },
        409,
      );
      assert.equal(n((await balance()).quantityReserved), 19);
      assert.equal(
        n((await db.posDraft.findUniqueOrThrow({ where: { id: draft.id } })).pendingMoney),
        1900,
      );
      const corrected = await call(
        cashier.accessToken,
        'PATCH',
        `/pos-drafts/${draft.id}/correct`,
        {
          ...capture,
          revision: approved.revision,
        },
      );
      assert.equal(corrected.status, 'SUBMITTED');
      assert.equal(corrected.pendingMoney, 1900);
      assert.equal(n((await balance()).quantityReserved), 0);
      await call(
        stockist.accessToken,
        'POST',
        `/pos-drafts/${draft.id}/prepare`,
        { revision: corrected.revision },
        404,
      );
      const renewed = await call(f.admin.token, 'POST', `/pos-drafts/${draft.id}/approve`, {
        revision: corrected.revision,
      });
      assert.equal(renewed.status, 'AWAITING_STOCKIST');
      await call(f.admin.token, 'POST', `/pos-drafts/${draft.id}/reject`, {
        revision: renewed.revision,
        reason: 'Customer cancelled; return collected funds',
      });
      assert.equal(n((await balance()).quantityReserved), 0);
      assert.deepEqual(await financial(), before);
    },
  );
  await check(
    'Reservation expiry releases availability and retains pending money for reconciliation',
    async () => {
      const expired = await call(
        cashier.accessToken,
        'POST',
        '/pos-drafts',
        envelope('SALE', sale(4)),
      );
      await call(f.admin.token, 'POST', `/pos-drafts/${expired.id}/approve`, { revision: 1 });
      const before = await financial();
      await db.posDraftReservation.updateMany({
        where: { draftId: expired.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await db.posDraft.update({
        where: { id: expired.id },
        data: { reservedUntil: new Date(Date.now() - 1000) },
      });
      await call(stockist.accessToken, 'GET', '/pos-drafts/context');
      const state = await db.posDraft.findUniqueOrThrow({ where: { id: expired.id } });
      const attention = await call(f.admin.token, 'GET', `/pos-drafts/${expired.id}`);
      assert.equal(attention.status, 'NEEDS_ATTENTION');
      assert.equal(state.status, 'NEEDS_ATTENTION');
      assert.equal(n(state.pendingMoney), 400);
      assert.equal(n((await balance()).quantityReserved), 0);
      assert.deepEqual(await financial(), before);
      await call(
        stockist.accessToken,
        'POST',
        `/pos-drafts/${expired.id}/prepare`,
        { revision: state.revision },
        404,
      );
      await call(f.admin.token, 'POST', `/pos-drafts/${expired.id}/reject`, {
        revision: state.revision,
        reason: 'Collected money needs an office refund',
      });
      assert.equal(
        n((await db.posDraft.findUniqueOrThrow({ where: { id: expired.id } })).pendingMoney),
        400,
      );
      const rejected = await db.posDraft.findUniqueOrThrow({ where: { id: expired.id } });
      const pending = await call(cashier.accessToken, 'GET', '/pos-drafts?view=pending');
      assert.ok(
        pending.data.some((draft) => draft.id === expired.id),
        'Unreturned money remains in pending work',
      );
      const returned = {
        revision: rejected.revision,
        fundsReturned: true,
        reason: 'Collected cash returned to the customer',
        reference: 'PROOF-RETURN',
      };
      await call(
        cashier.accessToken,
        'POST',
        `/pos-drafts/${expired.id}/confirm-return`,
        returned,
        403,
      );
      await call(
        f.admin.token,
        'POST',
        `/pos-drafts/${expired.id}/confirm-return`,
        { ...returned, fundsReturned: false },
        400,
      );
      const reconciled = await call(
        f.admin.token,
        'POST',
        `/pos-drafts/${expired.id}/confirm-return`,
        returned,
      );
      assert.equal(reconciled.pendingMoney, 0);
      assert.equal(reconciled.amount, 400);
      assert.deepEqual(await financial(), before);
      const repeat = await call(
        f.admin.token,
        'POST',
        `/pos-drafts/${expired.id}/confirm-return`,
        returned,
      );
      assert.equal(repeat.pendingMoney, 0);
      assert.equal(
        await db.posDraftDecision.count({ where: { draftId: expired.id, action: 'RETURN_FUNDS' } }),
        1,
      );
    },
  );
  await check(
    'Maker checker rejects own admin approval; explicit authorized direct sale posts',
    async () => {
      const draft = await call(
        f.admin.token,
        'POST',
        '/pos-drafts',
        envelope('SALE', { ...sale(5), cashAccountId: f.cash.id }),
      );
      await call(f.admin.token, 'POST', `/pos-drafts/${draft.id}/approve`, { revision: 1 }, 403);
      const posted = await call(f.admin.token, 'POST', `/pos-drafts/${draft.id}/direct-post`, {
        revision: 1,
      });
      assert.equal(posted.status, 'POSTED');
    },
  );
  await check(
    'Collection posts one receipt against an approved credit sale and its actual debt',
    async () => {
      const credit = await call(
        f.admin.token,
        'POST',
        '/pos-drafts',
        envelope('SALE', {
          customerId: f.customer.id,
          paymentMethod: 'CREDIT',
          expectedTotal: 100,
          lines: [{ productId: f.product.id, quantity: 1 }],
        }),
      );
      const posted = await call(f.reviewer.token, 'POST', `/pos-drafts/${credit.id}/approve`, {
        revision: 1,
      });
      const before = await financial();
      const collection = await call(
        cashier.accessToken,
        'POST',
        '/pos-drafts',
        envelope('COLLECTION', { salesOrderId: posted.postedEntityId, method: 'CASH', amount: 60 }),
      );
      assert.deepEqual(await financial(), before);
      const paid = await call(f.admin.token, 'POST', `/pos-drafts/${collection.id}/approve`, {
        revision: 1,
      });
      assert.equal(paid.postedEntityType, 'CustomerPayment');
      assert.equal(
        n(
          (await db.salesOrder.findUniqueOrThrow({ where: { id: posted.postedEntityId } }))
            .outstandingAmount,
        ),
        40,
      );
      assert.equal((await financial()).money, before.money + 60);
    },
  );
  await check(
    'A changed sale price needs no reason and still waits for a separate admin decision',
    async () => {
      const before = await financial();
      const draft = await call(
        f.admin.token,
        'POST',
        '/pos-drafts',
        envelope('SALE', {
          customerId: f.customer.id,
          paymentMethod: 'CASH',
          cashAccountId: f.cash.id,
          expectedTotal: 111,
          lines: [{ productId: f.product.id, quantity: 1, unitPrice: 111 }],
        }),
      );
      assert.equal(draft.status, 'SUBMITTED');
      assert.equal(draft.payload.lines[0].listUnitPrice, 100);
      assert.equal(draft.payload.lines[0].unitPrice, 111);
      assert.ok(!('priceReason' in draft.payload.lines[0]));
      const stored = await db.posDraft.findUniqueOrThrow({ where: { id: draft.id } });
      assert.deepEqual(stored.payload._sale.priceEdits, [
        {
          productId: f.product.id,
          listUnitPrice: 100,
          chargedUnitPrice: 111,
          reasonCode: null,
        },
      ]);
      assert.deepEqual(await financial(), before);
      const rejected = await call(f.reviewer.token, 'POST', `/pos-drafts/${draft.id}/reject`, {
        revision: draft.revision,
        reason: 'Synthetic price rejected by reviewer',
      });
      assert.equal(rejected.status, 'REJECTED');
      assert.deepEqual(await financial(), before);
    },
  );
  await check(
    'A full confirmed purchase receipt posts stock once; partial receipt input is rejected',
    async () => {
      const po = await db.purchaseOrder.create({
        data: {
          ...scope,
          purchaseOrderNumber: 'PROOF-PO-' + stamp,
          supplierId: f.supplier.id,
          supplierName: f.supplier.name,
          purchaseType: 'STOCK_PURCHASE',
          status: 'CONFIRMED',
          orderDate: new Date(),
          subtotal: 400,
          totalAmount: 400,
          outstandingAmount: 400,
          createdById: f.admin.user.id,
          confirmedById: f.reviewer.user.id,
          confirmedAt: new Date(),
          lines: {
            create: [
              {
                productId: f.product.id,
                unitId: f.unit.id,
                quantity: 10,
                unitCost: 40,
                lineTotal: 400,
              },
            ],
          },
        },
      });
      const before = n((await balance()).quantityOnHand);
      await call(
        stockist.accessToken,
        'POST',
        '/pos-drafts',
        envelope('RECEIPT', { purchaseOrderId: po.id, receivedQuantity: 5 }),
        400,
      );
      const draft = await call(
        stockist.accessToken,
        'POST',
        '/pos-drafts',
        envelope('RECEIPT', { purchaseOrderId: po.id, fullOrderArrived: true }),
      );
      assert.equal(n((await balance()).quantityOnHand), before);
      const posted = await call(f.admin.token, 'POST', `/pos-drafts/${draft.id}/approve`, {
        revision: 1,
      });
      assert.equal(posted.status, 'POSTED');
      assert.equal(n((await balance()).quantityOnHand), before + 10);
      await call(
        stockist.accessToken,
        'POST',
        '/pos-drafts',
        envelope('RECEIPT', { purchaseOrderId: po.id, fullOrderArrived: true }),
        400,
      );
    },
  );
  await check(
    'Physical count requires a current physical revision; a later stock movement blocks stale count',
    async () => {
      let baseline = await balance();
      const payload = {
        lines: [
          {
            productId: f.product.id,
            countedQuantity: n(baseline.quantityOnHand) - 1,
            baselineQuantity: n(baseline.quantityOnHand),
            physicalRevision: baseline.physicalRevision,
          },
        ],
      };
      const draft = await call(
        stockist.accessToken,
        'POST',
        '/pos-drafts',
        envelope('COUNT', payload),
      );
      const posted = await call(f.admin.token, 'POST', `/pos-drafts/${draft.id}/approve`, {
        revision: 1,
      });
      assert.equal(posted.status, 'POSTED');
      baseline = await balance();
      assert.equal(n(baseline.quantityOnHand), payload.lines[0].countedQuantity);
      const stale = await call(
        stockist.accessToken,
        'POST',
        '/pos-drafts',
        envelope('COUNT', {
          lines: [
            {
              productId: f.product.id,
              countedQuantity: n(baseline.quantityOnHand),
              baselineQuantity: n(baseline.quantityOnHand),
              physicalRevision: baseline.physicalRevision,
            },
          ],
        }),
      );
      // Simulate a later physical event only in this isolated fixture.
      await db.inventoryBalance.update({
        where: { id: baseline.id },
        data: { physicalRevision: { increment: 1 } },
      });
      await call(f.admin.token, 'POST', `/pos-drafts/${stale.id}/approve`, { revision: 1 }, 409);
      assert.equal(
        (await db.posDraft.findUniqueOrThrow({ where: { id: stale.id } })).status,
        'NEEDS_ATTENTION',
      );
    },
  );
  await check(
    'Same-company branch transfer preserves total quantity and inventory value',
    async () => {
      const before = await balance();
      const draft = await call(
        stockist.accessToken,
        'POST',
        '/pos-drafts',
        envelope('TRANSFER', {
          destinationBranchId: f.destination.id,
          lines: [{ productId: f.product.id, quantity: 2 }],
        }),
      );
      const result = await call(f.admin.token, 'POST', `/pos-drafts/${draft.id}/approve`, {
        revision: 1,
      });
      assert.equal(result.status, 'POSTED');
      const after = await balance();
      const dest = await db.inventoryBalance.findUniqueOrThrow({
        where: {
          companyId_productId_branchId: {
            companyId: f.company.id,
            productId: f.product.id,
            branchId: f.destination.id,
          },
        },
      });
      assert.equal(n(after.quantityOnHand) + n(dest.quantityOnHand), n(before.quantityOnHand));
      assert.equal(n(after.totalValue) + n(dest.totalValue), n(before.totalValue));
    },
  );
  await check(
    'Damage waits for approval then reduces physical stock and posts an expense',
    async () => {
      const before = await balance();
      const draft = await call(
        stockist.accessToken,
        'POST',
        '/pos-drafts',
        envelope('DAMAGE', {
          productId: f.product.id,
          quantity: 1,
          damageType: 'BREAKAGE',
          reason: 'Synthetic broken item',
        }),
      );
      assert.equal(n((await balance()).quantityOnHand), n(before.quantityOnHand));
      const result = await call(f.admin.token, 'POST', `/pos-drafts/${draft.id}/approve`, {
        revision: 1,
      });
      assert.equal(result.status, 'POSTED');
      assert.equal(n((await balance()).quantityOnHand), n(before.quantityOnHand) - 1);
      assert.equal(
        (await db.stockDamage.findUniqueOrThrow({ where: { id: result.postedEntityId } })).status,
        'POSTED',
      );
    },
  );
  await check(
    'Invoice arrival before or after receiving reuses one payable and one balanced journal',
    async () => {
      for (const invoiceFirst of [true, false]) {
        const quantity = invoiceFirst ? 2 : 3;
        const po = await purchaseOrder(quantity, invoiceFirst ? 'INVOICE-FIRST' : 'RECEIPT-FIRST');
        const payableCount = await db.payable.count({ where: { companyId: f.company.id } });
        const journalCount = await db.journalEntry.count({ where: { companyId: f.company.id } });
        const stock = n((await balance()).quantityOnHand);
        const createInvoice = async () =>
          call(f.admin.token, 'POST', '/supplier-invoices', {
            ...scope,
            supplierId: f.supplier.id,
            purchaseOrderId: po.id,
            supplierInvoiceNumber: 'SI-' + po.purchaseOrderNumber,
            invoiceDate: captureTime(),
            currency: 'TZS',
            lines: [
              {
                productId: f.product.id,
                unitId: f.unit.id,
                description: 'Proof stock item',
                quantity,
                unitPrice: 40,
              },
            ],
          });
        let invoice;
        if (invoiceFirst) {
          invoice = await createInvoice();
          await call(
            f.admin.token,
            'POST',
            `/supplier-invoices/${invoice.id}/approve`,
            {
              allowVariance: true,
            },
            400,
          );
          assert.equal(
            await db.payable.count({ where: { companyId: f.company.id } }),
            payableCount,
          );
          assert.equal(
            await db.journalEntry.count({ where: { companyId: f.company.id } }),
            journalCount,
          );
        }
        const receipt = await call(
          stockist.accessToken,
          'POST',
          '/pos-drafts',
          envelope('RECEIPT', { purchaseOrderId: po.id, fullOrderArrived: true }),
        );
        const result = await call(f.admin.token, 'POST', `/pos-drafts/${receipt.id}/approve`, {
          revision: receipt.revision,
        });
        assert.equal(result.status, 'POSTED');
        assert.equal(n((await balance()).quantityOnHand), stock + quantity);
        if (!invoiceFirst) {
          invoice = await createInvoice();
        }
        await call(f.admin.token, 'POST', `/supplier-invoices/${invoice.id}/approve`, {
          allowVariance: true,
        });
        const finalPo = await db.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } });
        const finalInvoice = await db.supplierInvoice.findUniqueOrThrow({
          where: { id: invoice.id },
        });
        assert.equal(finalPo.payableId, finalInvoice.payableId);
        const payable = await db.payable.findUniqueOrThrow({ where: { id: finalPo.payableId } });
        assert.equal(n(payable.amount), quantity * 40);
        assert.equal(
          await db.payable.count({ where: { companyId: f.company.id } }),
          payableCount + 1,
        );
        assert.equal(
          await db.journalEntry.count({ where: { companyId: f.company.id } }),
          journalCount + 1,
        );
        await balancedJournal(payable.journalEntryId, quantity * 40);
        const postedRetry = await call(f.admin.token, 'POST', `/pos-drafts/${receipt.id}/approve`, {
          revision: result.revision,
        });
        assert.equal(postedRetry.postedEntityId, result.postedEntityId);
        await call(
          f.admin.token,
          'POST',
          `/supplier-invoices/${invoice.id}/approve`,
          { allowVariance: true },
          400,
        );
        assert.equal(
          await db.payable.count({ where: { companyId: f.company.id } }),
          payableCount + 1,
        );
        assert.equal(
          await db.journalEntry.count({ where: { companyId: f.company.id } }),
          journalCount + 1,
        );
      }
      // Each company starts its matching sequence at one. A global number index
      // used to turn the second company's valid match into a database conflict.
      const firstMatch = await db.threeWayMatch.findFirstOrThrow({
        where: { companyId: f.company.id },
        orderBy: { createdAt: 'asc' },
      });
      const otherCompany = await db.company.create({
        data: {
          groupId: f.company.groupId,
          code: 'POS-MATCH-' + stamp,
          name: 'Synthetic second matching company ' + stamp,
        },
      });
      const originalRole = await db.userRole.findFirstOrThrow({
        where: { userId: f.admin.user.id },
      });
      const otherUser = await db.user.create({
        data: {
          fullName: 'Proof second-company matching operator',
          email: `matching-${stamp}@example.invalid`,
          passwordHash: f.admin.user.passwordHash,
          companyId: otherCompany.id,
          status: 'ACTIVE',
          userRoles: { create: { roleId: originalRole.roleId } },
          companyAccess: { create: { companyId: otherCompany.id, accessLevel: 'MANAGE' } },
        },
      });
      const otherSupplier = await db.supplier.create({
        data: {
          companyId: otherCompany.id,
          supplierCode: 'SECOND-MATCH-SUPPLIER',
          name: 'Proof second matching supplier',
        },
      });
      const otherCategory = await db.productCategory.create({
        data: { companyId: otherCompany.id, name: 'Proof matching category' },
      });
      const otherUnit = await db.unitOfMeasure.create({
        data: { companyId: otherCompany.id, name: 'Proof piece', symbol: 'pc', isBaseUnit: true },
      });
      const otherProduct = await db.product.create({
        data: {
          companyId: otherCompany.id,
          productCode: 'SECOND-MATCH-PRODUCT',
          name: 'Proof second matching product',
          categoryId: otherCategory.id,
          baseUnitId: otherUnit.id,
        },
      });
      const otherOrder = await db.purchaseOrder.create({
        data: {
          companyId: otherCompany.id,
          purchaseOrderNumber: 'SECOND-MATCH-' + stamp,
          supplierId: otherSupplier.id,
          supplierName: otherSupplier.name,
          purchaseType: 'CREDIT_PURCHASE',
          status: 'CONFIRMED',
          orderDate: new Date(),
          subtotal: 40,
          totalAmount: 40,
          outstandingAmount: 40,
          createdById: otherUser.id,
          lines: {
            create: [
              {
                productId: otherProduct.id,
                unitId: otherUnit.id,
                quantity: 1,
                unitCost: 40,
                lineTotal: 40,
              },
            ],
          },
        },
      });
      const otherInvoice = await db.supplierInvoice.create({
        data: {
          companyId: otherCompany.id,
          supplierId: otherSupplier.id,
          purchaseOrderId: otherOrder.id,
          supplierInvoiceNumber: 'SECOND-MATCH-' + stamp,
          invoiceDate: new Date(),
          subtotal: 40,
          totalAmount: 40,
          outstandingAmount: 40,
          createdById: otherUser.id,
          lines: {
            create: [
              {
                productId: otherProduct.id,
                unitId: otherUnit.id,
                description: 'Proof matching stock',
                quantity: 1,
                unitPrice: 40,
                lineTotal: 40,
              },
            ],
          },
        },
      });
      const otherSession = await call(null, 'POST', '/auth/login', {
        email: otherUser.email,
        password,
      });
      const otherMatch = await call(otherSession.accessToken, 'POST', '/three-way-matching', {
        companyId: otherCompany.id,
        purchaseOrderId: otherOrder.id,
        supplierInvoiceId: otherInvoice.id,
      });
      assert.equal(otherMatch.matchNumber, firstMatch.matchNumber);
      assert.equal(
        await db.threeWayMatch.count({
          where: {
            matchNumber: firstMatch.matchNumber,
            companyId: { in: [f.company.id, otherCompany.id] },
          },
        }),
        2,
      );
      await assert.rejects(
        db.threeWayMatch.create({
          data: {
            matchNumber: otherMatch.matchNumber,
            companyId: otherCompany.id,
            purchaseOrderId: otherOrder.id,
            supplierInvoiceId: otherInvoice.id,
            matchedById: otherUser.id,
          },
        }),
        (error) => error.code === 'P2002',
        'A matching number remains unique within its company',
      );
      await call(
        otherSession.accessToken,
        'GET',
        `/three-way-matching/${firstMatch.id}`,
        undefined,
        403,
      );
      await call(f.admin.token, 'GET', `/three-way-matching/${otherMatch.id}`, undefined, 403);
    },
  );
  // These acceptance cases need the office reviewer before the later security
  // cases deliberately enroll, revoke and log out that same password account.
  await require('./verify-pos-reviewed-repeat.cjs').verifyPosReviewedRepeat({
    db,
    check,
    fixture: f,
    call,
  });
  await require('./verify-pos-validation-boundaries.cjs').verifyPosValidationBoundaries({
    db,
    check,
    fixture: f,
    call,
  });
  await require('./verify-pos-canonical-duplicates.cjs').verifyPosCanonicalDuplicates({
    db,
    check,
    fixture: f,
    call,
  });
  await require('./verify-pos-legacy-reconciliation.cjs').verifyPosLegacyReconciliation({
    db,
    check,
    fixture: f,
    call,
    cashier,
  });
  await check('Approval rechecks the origin recorder company access after capture', async () => {
    const draft = await call(
      f.reviewer.token,
      'POST',
      '/pos-drafts',
      envelope('SALE', { ...sale(6), cashAccountId: f.cash.id }),
    );
    const before = await financial();
    await db.user.update({ where: { id: f.reviewer.user.id }, data: { companyId: null } });
    await db.userCompanyAccess.updateMany({
      where: { userId: f.reviewer.user.id, companyId: f.company.id },
      data: { accessLevel: 'READ' },
    });
    try {
      await call(
        f.admin.token,
        'POST',
        `/pos-drafts/${draft.id}/approve`,
        { revision: draft.revision },
        403,
      );
      assert.deepEqual(await financial(), before);
      const retained = await db.posDraft.findUniqueOrThrow({ where: { id: draft.id } });
      assert.notEqual(retained.status, 'POSTED');
      assert.equal(n(retained.pendingMoney), 600);
    } finally {
      await db.user.update({
        where: { id: f.reviewer.user.id },
        data: { companyId: f.company.id },
      });
      await db.userCompanyAccess.updateMany({
        where: { userId: f.reviewer.user.id, companyId: f.company.id },
        data: { accessLevel: 'MANAGE' },
      });
    }
    await call(f.admin.token, 'POST', `/pos-drafts/${draft.id}/reject`, {
      revision: draft.revision,
      reason: 'Synthetic recorder access withdrawn',
    });
  });
  await check(
    'Authorized administrator explicitly validates and directly posts count, damage, transfer, and full receipt',
    async () => {
      const direct = async (kind, payload) => {
        const draft = await call(f.admin.token, 'POST', '/pos-drafts', envelope(kind, payload));
        await call(
          f.admin.token,
          'POST',
          `/pos-drafts/${draft.id}/approve`,
          { revision: draft.revision },
          403,
        );
        const result = await call(f.admin.token, 'POST', `/pos-drafts/${draft.id}/direct-post`, {
          revision: draft.revision,
        });
        assert.equal(result.status, 'POSTED');
        assert.equal(
          (
            await db.posDraftDecision.findFirstOrThrow({
              where: { draftId: draft.id, action: 'DIRECT_POST' },
            })
          ).actorUserId,
          f.admin.user.id,
        );
        return result;
      };
      const before = await balance();
      await direct('COUNT', {
        lines: [
          {
            productId: f.product.id,
            countedQuantity: n(before.quantityOnHand) + 1,
            baselineQuantity: n(before.quantityOnHand),
            physicalRevision: before.physicalRevision,
          },
        ],
      });
      assert.equal(n((await balance()).quantityOnHand), n(before.quantityOnHand) + 1);
      await direct('DAMAGE', {
        productId: f.product.id,
        quantity: 1,
        damageType: 'BREAKAGE',
        reason: 'Administrator validated broken item',
      });
      assert.equal(n((await balance()).quantityOnHand), n(before.quantityOnHand));
      await direct('TRANSFER', {
        destinationBranchId: f.destination.id,
        lines: [{ productId: f.product.id, quantity: 1 }],
      });
      assert.equal(n((await balance()).quantityOnHand), n(before.quantityOnHand) - 1);
      const po = await purchaseOrder(4, 'ADMIN-DIRECT');
      await direct('RECEIPT', { purchaseOrderId: po.id, fullOrderArrived: true });
      assert.equal(n((await balance()).quantityOnHand), n(before.quantityOnHand) + 3);
      const received = await db.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } });
      const payable = await db.payable.findUniqueOrThrow({ where: { id: received.payableId } });
      await balancedJournal(payable.journalEntryId, 160);
    },
  );
  await check(
    'Password sessions and historical terminal assignments cannot bypass staff approval through ERP writers',
    async () => {
      await db.mobilePosTerminal.create({
        data: {
          terminalCode: 'UNCONFIGURED-' + stamp,
          name: 'Historical unconfigured branch assignment',
          ...scope,
          branchId: f.destination.id,
          assignedUserId: f.legacyStaff.user.id,
          generalCustomerId: f.customer.id,
        },
      });
      const grn = await db.goodsReceivedNote.create({
        data: {
          ...scope,
          grnNumber: 'GUARD-' + stamp,
          supplierId: f.supplier.id,
          receivedById: f.legacyStaff.user.id,
          approvedById: f.admin.user.id,
          status: 'APPROVED',
          lines: {
            create: [
              {
                productId: f.product.id,
                unitId: f.unit.id,
                orderedQuantity: 1,
                receivedQuantity: 1,
                acceptedQuantity: 1,
                unitCost: 40,
              },
            ],
          },
        },
      });
      const before = await financial(),
        beforeStock = n((await balance()).quantityOnHand);
      await db.mobilePosTerminal.create({
        data: {
          terminalCode: 'LEGACY-' + stamp,
          name: 'Synthetic historical staff terminal',
          ...scope,
          assignedUserId: f.legacyStaff.user.id,
          generalCustomerId: f.customer.id,
        },
      });
      const grnPath = `/goods-received-notes/${grn.id}/post`;
      await call(f.legacyStaff.token, 'POST', grnPath, {}, 403);
      await call(f.legacyStaff.token, 'POST', '/sales-orders', {}, 403);
      const enrollment = await db.mobilePosEnrollment.create({
        data: {
          branchSetupId: setup.id,
          ...scope,
          name: 'Existing password staff account',
          requestedRole: 'CASHIER',
          approvedRole: 'CASHIER',
          status: 'APPROVED',
          userId: f.reviewer.user.id,
          approvedById: f.admin.user.id,
          approvedAt: new Date(),
          claimTokenHash: crypto.randomBytes(32).toString('hex'),
          claimExpiresAt: new Date(Date.now() + 86400000),
        },
      });
      await call(f.reviewer.token, 'POST', grnPath, {}, 403);
      await call(f.reviewer.token, 'POST', '/stock-adjustments', {}, 403);
      await call(f.reviewer.token, 'GET', '/auth/me');
      await db.mobilePosBranchSetup.update({ where: { id: setup.id }, data: { enabled: false } });
      try {
        await call(f.reviewer.token, 'POST', grnPath, {}, 403);
        await call(f.legacyStaff.token, 'POST', '/sales-orders', {}, 403);
        await call(f.reviewer.token, 'POST', '/pos-drafts', envelope('SALE', sale(7)), 403);
      } finally {
        await db.mobilePosBranchSetup.update({ where: { id: setup.id }, data: { enabled: true } });
      }
      await db.mobilePosEnrollment.update({
        where: { id: enrollment.id },
        data: { status: 'REVOKED' },
      });
      await call(f.reviewer.token, 'POST', grnPath, {}, 403);
      await call(f.reviewer.token, 'POST', '/pos-drafts', envelope('SALE', sale(7)), 403);
      await call(f.reviewer.token, 'POST', '/auth/logout', {
        refreshToken: f.reviewer.refreshToken,
      });
      assert.equal(
        (await db.goodsReceivedNote.findUniqueOrThrow({ where: { id: grn.id } })).status,
        'APPROVED',
      );
      assert.deepEqual(await financial(), before);
      assert.equal(n((await balance()).quantityOnHand), beforeStock);
    },
  );
  await check(
    'Five PIN failures persist a 15-minute lock, including denial of the correct PIN',
    async () => {
      for (let i = 0; i < 5; i++)
        await call(
          null,
          'POST',
          '/mobile-pos-auth/login',
          { enrollmentId: cashier.enrollmentId, deviceSecret: cashier.secret, pin: '999999' },
          401,
        );
      const row = await db.mobilePosEnrollment.findUniqueOrThrow({
        where: { id: cashier.enrollmentId },
      });
      assert.equal(row.failedPinAttempts, 5);
      assert.ok(row.lockedUntil.getTime() > Date.now() + 14 * 60000);
      await call(
        null,
        'POST',
        '/mobile-pos-auth/login',
        { enrollmentId: cashier.enrollmentId, deviceSecret: cashier.secret, pin: cashier.pin },
        401,
      );
    },
  );
  await check(
    'Administrator PIN recovery immediately revokes tokens, preserves device ownership, and consumes its claim',
    async () => {
      const oldAccess = cashier.accessToken,
        oldRefresh = cashier.refreshToken;
      const reset = await call(
        f.admin.token,
        'POST',
        `/mobile-pos-onboarding/enrollments/${cashier.enrollmentId}/reset-pin`,
        {},
      );
      await call(oldAccess, 'GET', '/mobile-pos-auth/me', undefined, 401);
      await call(
        null,
        'POST',
        '/mobile-pos-auth/refresh',
        { refreshToken: oldRefresh, deviceSecret: cashier.secret },
        401,
      );
      await call(
        null,
        'POST',
        '/mobile-pos-auth/login',
        { enrollmentId: cashier.enrollmentId, deviceSecret: cashier.secret, pin: cashier.pin },
        401,
      );
      const status = await call(null, 'GET', '/mobile-pos-auth/enrollment/' + reset.resetToken);
      assert.equal(status.resetRequired, true);
      await call(
        null,
        'POST',
        '/mobile-pos-auth/reset-pin',
        {
          enrollmentId: cashier.enrollmentId,
          resetToken: reset.resetToken,
          deviceSecret: crypto.randomBytes(32).toString('hex'),
          pin: '456789',
        },
        401,
      );
      const recovered = await call(null, 'POST', '/mobile-pos-auth/setup', {
        claimToken: reset.resetToken,
        deviceSecret: cashier.secret,
        pin: '456789',
      });
      assert.equal(recovered.operator.credentialVersion, cashier.operator.credentialVersion + 1);
      await call(
        null,
        'POST',
        '/mobile-pos-auth/setup',
        {
          claimToken: reset.resetToken,
          deviceSecret: cashier.secret,
          pin: '456789',
        },
        404,
      );
      const lostResponseRecovery = await call(null, 'POST', '/mobile-pos-auth/login', {
        enrollmentId: cashier.enrollmentId,
        deviceSecret: cashier.secret,
        pin: '456789',
      });
      assert.equal(
        lostResponseRecovery.operator.credentialVersion,
        recovered.operator.credentialVersion,
      );
      await call(
        null,
        'POST',
        '/mobile-pos-auth/reset-pin',
        {
          enrollmentId: cashier.enrollmentId,
          resetToken: reset.resetToken,
          deviceSecret: cashier.secret,
          pin: '567890',
        },
        401,
      );
      Object.assign(cashier, lostResponseRecovery);
    },
  );
  await check(
    'Revoking a device invalidates access and refresh immediately without revoking office administrators',
    async () => {
      await call(
        f.admin.token,
        'POST',
        `/mobile-pos-onboarding/enrollments/${cashier.enrollmentId}/revoke`,
        { reason: 'Proof device retired' },
      );
      await call(cashier.accessToken, 'GET', '/pos-drafts/context', undefined, 401);
      await call(
        null,
        'POST',
        '/mobile-pos-auth/refresh',
        { refreshToken: cashier.refreshToken, deviceSecret: cashier.secret },
        401,
      );
      await call(
        f.admin.token,
        'POST',
        `/mobile-pos-onboarding/enrollments/${adminClaim.enrollmentId}/revoke`,
        { reason: 'Proof admin device retired' },
      );
      await call(f.admin.token, 'GET', '/auth/me');
    },
  );
  await require('./verify-pos-reservation-hardening.cjs').verifyPosReservationHardening({
    db,
    check,
    fixture: f,
  });
  await require('./verify-cash-purchases.cjs').verifyCashPurchases({ db, check, fixture: f, call });
  await require('./verify-purchase-draft-conversion.cjs').verifyPurchaseDraftConversion({
    db,
    check,
    fixture: f,
    call,
  });
  await require('./verify-supplier-purchase-advances.cjs').verifySupplierPurchaseAdvances({
    db,
    check,
    fixture: f,
    call,
  });
}

main()
  .catch((error) => {
    failures++;
    report.checks.push({
      name: 'Proof setup or dependency',
      passed: false,
      reason: error.code === 'ERR_ASSERTION' ? error.message.slice(0, 400) : error.constructor.name,
    });
    console.error('FAIL proof dependency: ' + error.constructor.name);
  })
  .finally(async () => {
    report.completedAt = new Date().toISOString();
    report.passed = failures === 0;
    fs.writeFileSync(
      path.join(root, '.release/pos-draft-proof.json'),
      JSON.stringify(report, null, 2),
    );
    await db.$disconnect();
    console.log(
      `${report.checks.filter((check) => check.passed).length}/${report.checks.length} POS proof checks passed`,
    );
    process.exitCode = failures ? 1 : 0;
  });
