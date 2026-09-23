import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(root, 'backend/package.json'));
const { PrismaClient, Prisma } = require('@prisma/client');
const argon2 = require('argon2');
require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { module: 'CommonJS', moduleResolution: 'node' },
});
const { seedTzReferenceData } = require(resolve(root, 'database/seeds/tz-reference.ts'));
const env = Object.fromEntries(
  readFileSync(resolve(root, '.release/rehearsal.env'), 'utf8')
    .trim()
    .split(/\r?\n/)
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
);
const url = new URL(env.DATABASE_URL);
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.port, '5549');
assert.equal(url.pathname, '/itemba_release_proof');
const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
const apiBase = 'http://127.0.0.1:3114/api/v1';
const stamp = Date.now().toString(36);
const checks = [];
const date = (value) => new Date(`${value}T00:00:00Z`);
const day = '2026-09-19';
const D = (value = 0) => new Prisma.Decimal(value);
const equal = (actual, expected, label) => {
  assert.equal(String(actual), String(expected), label);
  checks.push({ name: label, status: 'passed' });
};
async function call(token, method, path, body, expected) {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30000),
  });
  const json = await response.json();
  if (expected !== undefined)
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(json)}`);
  else assert.ok(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(json)}`);
  return json.data ?? json;
}
async function check(name, fn) {
  try {
    await fn();
    checks.push({ name, status: 'passed' });
    console.log(`PASS ${name}`);
  } catch (error) {
    checks.push({ name, status: 'failed', error: error.message });
    console.log(`FAIL ${name}: ${error.message}`);
  }
}
async function main() {
  await call(null, 'GET', '/health');
  const group = await db.group.create({
    data: { code: `PROOF-${stamp}`, name: `Release rehearsal — synthetic ${stamp}` },
  });
  async function company(code) {
    const company = await db.company.create({
      data: { groupId: group.id, code: `${code}-${stamp}`, name: `Rehearsal ${code} ${stamp}` },
    });
    await db.companyProfile.create({
      data: {
        companyId: company.id,
        registeredName: company.name,
        brelaRegNumber: `PROOF-${stamp}-${code}`,
        tin: `PROOF-${stamp}-${code}`,
        registeredAddress: 'Synthetic fixture',
        currency: 'TZS',
      },
    });
    const division = await db.division.create({
      data: { companyId: company.id, name: 'Main division', code: 'MAIN', type: 'OTHER' },
    });
    const branch = await db.branch.create({
      data: { divisionId: division.id, name: 'Main branch', code: 'MAIN', type: 'OTHER' },
    });
    const sibling = await db.branch.create({
      data: { divisionId: division.id, name: 'Sibling branch', code: 'SIBLING', type: 'OTHER' },
    });
    const otherDivision = await db.division.create({
      data: { companyId: company.id, name: 'Other division', code: 'OTHER', type: 'OTHER' },
    });
    const otherBranch = await db.branch.create({
      data: { divisionId: otherDivision.id, name: 'Other branch', code: 'OTHER', type: 'OTHER' },
    });
    const fiscal = await db.fiscalYear.create({
      data: {
        companyId: company.id,
        name: '2026 proof',
        startDate: date('2026-01-01'),
        endDate: date('2026-12-31'),
        status: 'OPEN',
      },
    });
    await db.accountingPeriod.create({
      data: {
        companyId: company.id,
        fiscalYearId: fiscal.id,
        name: 'September proof',
        startDate: date('2026-09-01'),
        endDate: date('2026-09-30'),
        status: 'OPEN',
      },
    });
    const gl = {};
    for (const [code, type] of Object.entries({
      1010: 'ASSET',
      1100: 'ASSET',
      1110: 'ASSET',
      2000: 'LIABILITY',
      3000: 'EQUITY',
      4000: 'INCOME',
      5000: 'EXPENSE',
      6000: 'EXPENSE',
      6040: 'EXPENSE',
      6045: 'EXPENSE',
      6050: 'EXPENSE',
      6060: 'EXPENSE',
      6070: 'EXPENSE',
      2210: 'LIABILITY',
      2220: 'LIABILITY',
      2225: 'LIABILITY',
      2230: 'LIABILITY',
      2240: 'LIABILITY',
      2250: 'LIABILITY',
      2260: 'LIABILITY',
      2270: 'LIABILITY',
      2280: 'LIABILITY',
    })) {
      gl[code] = (
        await db.chartOfAccount.create({
          data: {
            companyId: company.id,
            accountCode: code,
            accountName: `Proof ${code}`,
            accountType: type,
          },
        })
      ).id;
    }
    const bank = await db.cashAccount.create({
      data: {
        companyId: company.id,
        divisionId: division.id,
        branchId: branch.id,
        accountName: 'Proof bank',
        currency: 'TZS',
        ledgerAccountId: gl['1010'],
      },
    });
    return { company, division, branch, sibling, otherDivision, otherBranch, gl, bank };
  }
  const a = await company('A'),
    b = await company('B');
  const permissions = [
    'invoice_desk.view',
    'invoice_desk.manage',
    'invoice_desk.payments',
    'sales_desk.view',
    'sales_desk.manage',
    'sales_desk.payments',
    'cash_desk.view',
    'cash_desk.manage',
    'cash_desk.record',
    'cash_desk.reverse',
    'cash_accounts.manage',
    'journal_entries.view',
    'journal_entries.create',
    'journal_entries.post',
    'journal_entries.reverse',
    'bank_reconciliations.list',
    'bank_reconciliations.view',
    'bank_reconciliations.create',
    'bank_reconciliations.update',
    'bank_reconciliations.approve',
    'bank_reconciliations.close',
    'payroll.view',
    'payroll.manage',
    'payroll.calculate',
    'payroll.submit',
    'payroll.approve',
    'payroll.approve.hr',
    'payroll.approve.finance',
    'payroll.pay',
    'employees.view',
    'hr.reports.view',
    'companies.read',
    'divisions.read',
    'branches.read',
  ];
  for (const code of permissions)
    await db.permission.upsert({
      where: { code },
      update: {},
      create: {
        code,
        description: 'Isolated release-proof permission',
        module: code.split('.')[0],
        action: code.split('.').slice(1).join('.'),
      },
    });
  const passwordHash = await argon2.hash(env.RELEASE_PROOF_USER_PASSWORD);
  async function actor(name, scope, permitted = permissions) {
    const role = await db.role.create({
      data: {
        name: `${name}-${stamp}`,
        displayName: `Proof ${name}`,
        scope,
        rolePermissions: {
          create: permitted.map((code) => ({ permission: { connect: { code } } })),
        },
      },
    });
    const user = await db.user.create({
      data: {
        fullName: `Proof ${name}`,
        email: `${name}-${stamp}@example.invalid`,
        passwordHash,
        status: 'ACTIVE',
        companyId: a.company.id,
        userRoles: { create: { roleId: role.id } },
        companyAccess: { create: { companyId: a.company.id, accessLevel: 'MANAGE' } },
        ...(scope === 'DIVISION'
          ? { divisionAccess: { create: { divisionId: a.division.id, accessLevel: 'WRITE' } } }
          : {}),
        ...(scope === 'BRANCH'
          ? { branchAccess: { create: { branchId: a.branch.id, accessLevel: 'WRITE' } } }
          : {}),
      },
    });
    const login = await call(null, 'POST', '/auth/login', {
      email: user.email,
      password: env.RELEASE_PROOF_USER_PASSWORD,
    });
    assert.ok(login.accessToken);
    return { user, token: login.accessToken };
  }
  const finance = await actor('finance', 'COMPANY'),
    hr = await actor('hr', 'COMPANY');
  // Exercise the repository's configured rates. Regulatory sign-off is a separate release gate.
  await seedTzReferenceData(db, hr.user.id);
  const division = await actor('division', 'DIVISION'),
    branch = await actor('branch', 'BRANCH');
  const reader = await actor('reader', 'BRANCH', [
    'invoice_desk.view',
    'sales_desk.view',
    'cash_desk.view',
  ]);
  const scope = { companyId: a.company.id, divisionId: a.division.id, branchId: a.branch.id };
  const bank = await call(finance.token, 'POST', '/cash-desk/accounts', {
    ...scope,
    requestId: randomUUID(),
    name: 'Release proof bank',
    kind: 'BANK',
    currency: 'TZS',
    openingDate: '2026-09-01',
    openingBalance: '1000000.00',
  });
  await call(finance.token, 'POST', '/cash-connections/accounts', {
    deskAccountId: bank.id,
    cashAccountId: a.bank.id,
    ledgerAccountId: a.gl['1010'],
  });
  const opening = await db.cashDeskMovement.findFirstOrThrow({
    where: { entries: { some: { accountId: bank.id } }, kind: 'OPENING' },
  });
  async function postCash(movementId, offsetAccountId) {
    const review = await call(finance.token, 'GET', `/cash-connections/movements/${movementId}`);
    return call(finance.token, 'POST', `/cash-connections/movements/${movementId}`, {
      fingerprint: review.fingerprint,
      offsetAccountId,
    });
  }
  await postCash(opening.id, a.gl['3000']);
  const supplier = await call(finance.token, 'POST', '/invoice-desk/suppliers', {
    companyId: a.company.id,
    name: 'Synthetic supplier',
  });
  const customer = await call(finance.token, 'POST', '/sales-desk/customers', {
    companyId: a.company.id,
    name: 'Synthetic customer',
  });
  let invoice, sale;
  await check('purchase → supplier payment → posted ledger and purchase report', async () => {
    invoice = await call(branch.token, 'POST', '/invoice-desk/invoices', {
      ...scope,
      supplierId: supplier.id,
      invoiceNumber: `INV-${stamp}`,
      description: 'Synthetic purchase',
      currency: 'TZS',
      invoiceDate: day,
      dueDate: '2026-09-30',
      totalAmount: '1200.00',
    });
    const review = await call(finance.token, 'GET', `/desk-posting/purchases/${invoice.id}`);
    await call(finance.token, 'POST', `/desk-posting/purchases/${invoice.id}`, {
      fingerprint: review.fingerprint,
      debitAccountId: a.gl['5000'],
      creditAccountId: a.gl['2000'],
    });
    const requestId = randomUUID();
    const payment = {
      requestId,
      kind: 'SUPPLIER_PAYMENT',
      accountId: bank.id,
      invoiceId: invoice.id,
      invoiceVersion: invoice.version,
      amount: '1200.00',
      businessDate: day,
      description: 'Synthetic supplier settlement',
      reference: 'PROOF-SUPPLIER',
    };
    const movement = await call(branch.token, 'POST', '/cash-desk/movements', payment);
    await call(branch.token, 'POST', '/cash-desk/movements', payment);
    equal(
      await db.cashDeskMovement.count({ where: { requestId } }),
      1,
      'supplier-payment retry creates one movement',
    );
    await postCash(movement.id, a.gl['2000']);
    const stored = await db.invoiceDeskInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
    equal(stored.paidAmount, 1200, 'supplier invoice is fully paid');
    const report = await call(
      branch.token,
      'GET',
      '/desk-reports/purchases?from=2026-09-01&to=2026-09-30',
    );
    const row = report.tables
      .find((table) => table.id === 'parties')
      .rows.find((row) => row.id === supplier.id || row.name === supplier.name);
    equal(row.closing, '0.00', 'supplier report has zero balance');
  });
  await check('sale → collection → posted ledger and sales report', async () => {
    sale = await call(branch.token, 'POST', '/sales-desk/sales', {
      ...scope,
      requestId: randomUUID(),
      customerId: customer.id,
      currency: 'TZS',
      saleDate: day,
      dueDate: '2026-09-30',
      lines: [{ description: 'Synthetic service', quantity: '2', unitPrice: '1000.00' }],
    });
    const review = await call(finance.token, 'GET', `/desk-posting/sales/${sale.id}`);
    await call(finance.token, 'POST', `/desk-posting/sales/${sale.id}`, {
      fingerprint: review.fingerprint,
      debitAccountId: a.gl['1100'],
      creditAccountId: a.gl['4000'],
    });
    const requestId = randomUUID();
    const payment = {
      requestId,
      accountId: bank.id,
      version: sale.version,
      amount: '2000.00',
      paymentDate: day,
      reference: 'PROOF-CUSTOMER',
    };
    await call(branch.token, 'POST', `/sales-desk/sales/${sale.id}/payments`, payment);
    await call(branch.token, 'POST', `/sales-desk/sales/${sale.id}/payments`, payment);
    equal(
      await db.salesDeskPayment.count({ where: { requestId } }),
      1,
      'customer-payment retry creates one payment',
    );
    const movement = await db.cashDeskMovement.findFirstOrThrow({
      where: { salesPayment: { requestId } },
    });
    await postCash(movement.id, a.gl['1100']);
    const stored = await db.salesDeskSale.findUniqueOrThrow({ where: { id: sale.id } });
    equal(stored.paidAmount, 2000, 'sale is fully collected');
    const report = await call(
      branch.token,
      'GET',
      '/desk-reports/sales?from=2026-09-01&to=2026-09-30',
    );
    equal(
      report.tables.find((table) => table.id === 'parties').rows[0].closing,
      '0.00',
      'customer report has zero balance',
    );
  });
  await check(
    'company, division and branch permissions reject out-of-scope writes and reads',
    async () => {
      const payload = {
        ...scope,
        supplierId: supplier.id,
        invoiceNumber: `DENY-${stamp}`,
        description: 'Scope check',
        currency: 'TZS',
        invoiceDate: day,
        dueDate: day,
        totalAmount: '1.00',
      };
      await call(reader.token, 'POST', '/invoice-desk/invoices', payload, 403);
      await call(
        branch.token,
        'POST',
        '/invoice-desk/invoices',
        { ...payload, branchId: a.sibling.id },
        403,
      );
      await call(
        division.token,
        'POST',
        '/invoice-desk/invoices',
        { ...payload, divisionId: a.otherDivision.id, branchId: a.otherBranch.id },
        403,
      );
      await call(
        finance.token,
        'POST',
        '/invoice-desk/suppliers',
        { companyId: b.company.id, name: 'Denied supplier' },
        403,
      );
      const siblingInvoice = await call(finance.token, 'POST', '/invoice-desk/invoices', {
        ...payload,
        branchId: a.sibling.id,
        invoiceNumber: `SIB-${stamp}`,
      });
      await call(
        branch.token,
        'GET',
        `/invoice-desk/invoices/${siblingInvoice.id}`,
        undefined,
        404,
      );
      await call(division.token, 'GET', `/invoice-desk/invoices/${siblingInvoice.id}`);
    },
  );
  await check('Cash Desk and the mapped bank ledger agree before reconciliation', async () => {
    const entry = await db.cashDeskEntry.aggregate({
      where: { accountId: bank.id },
      _sum: { amount: true },
    });
    const ledger = await db.journalEntryLine.aggregate({
      where: {
        accountId: a.gl['1010'],
        journalEntry: { status: { in: ['POSTED', 'REVERSED'] }, deletedAt: null },
      },
      _sum: { debit: true, credit: true },
    });
    const glBalance = D(ledger._sum.debit ?? 0).minus(ledger._sum.credit ?? 0);
    equal(entry._sum.amount, '1000800', 'Cash Desk closing balance');
    equal(entry._sum.amount, glBalance, 'Cash Desk agrees with posted general ledger');
    const connections = await call(finance.token, 'GET', '/cash-connections/accounts');
    equal(
      connections.bank.find((row) => row.id === a.bank.id).ledgerBalance,
      glBalance.toFixed(2),
      'bank connection displays its mapped ledger balance',
    );
    equal(glBalance, '1000800', 'posted bank ledger closing balance');
  });
  await check(
    'bank statement imports, matches, approves and closes with zero difference',
    async () => {
      const recon = await call(finance.token, 'POST', '/bank-reconciliations', {
        companyId: a.company.id,
        cashAccountId: a.bank.id,
        reconciliationNumber: `REC-${stamp}`,
        statementStartDate: '2026-09-01',
        statementEndDate: '2026-09-30',
        statementOpeningBalance: 0,
        statementClosingBalance: 1000800,
        bookOpeningBalance: 0,
        bookClosingBalance: 1000800,
        currency: 'TZS',
      });
      await call(finance.token, 'POST', `/bank-reconciliations/${recon.id}/import`, {
        rows: [
          {
            transactionDate: '2026-09-01',
            description: 'Opening deposit',
            reference: 'OPENING',
            debitAmount: '0',
            creditAmount: '1000000',
          },
          {
            transactionDate: day,
            description: 'Supplier settlement',
            reference: 'PROOF-SUPPLIER',
            debitAmount: '1200',
            creditAmount: '0',
          },
          {
            transactionDate: day,
            description: 'Customer collection',
            reference: 'PROOF-CUSTOMER',
            debitAmount: '0',
            creditAmount: '2000',
          },
        ],
      });
      await call(finance.token, 'POST', `/bank-reconciliations/${recon.id}/run-matching`, {});
      await call(finance.token, 'POST', `/bank-reconciliations/${recon.id}/approve`, {}, 400);
      await call(hr.token, 'POST', `/bank-reconciliations/${recon.id}/approve`, {});
      const closed = await call(
        finance.token,
        'POST',
        `/bank-reconciliations/${recon.id}/close`,
        {},
      );
      equal(closed.status, 'CLOSED', 'bank reconciliation closes');
    },
  );
  let payrollRun, payrollMovement, payrollRequest, payrollAdvance, payrollCommission;
  await check(
    'payroll calculation → distinct HR/finance approval → payment → posted journals',
    async () => {
      const employee = await db.employee.create({
        data: {
          ...scope,
          employeeCode: `EMP-${stamp}`,
          firstName: 'Synthetic',
          lastName: 'Employee',
          fullName: 'Synthetic Employee',
          baseSalary: '500000',
          hireDate: date('2026-01-01'),
        },
      });
      await db.deductionType.create({
        data: { companyId: a.company.id, code: 'ADVANCE', name: 'Advance recovery' },
      });
      payrollAdvance = await db.salaryAdvance.create({
        data: {
          companyId: a.company.id,
          employeeId: employee.id,
          advanceNumber: 'PROOF-ADVANCE',
          requestDate: date(day),
          paidAt: date(day),
          status: 'PAID',
          amount: '1000',
          createdById: hr.user.id,
        },
      });
      await db.allowanceType.create({
        data: {
          companyId: a.company.id,
          code: 'SALES_COMMISSION',
          name: 'Sales commission',
          taxable: true,
        },
      });
      const order = await db.salesOrder.create({
        data: {
          companyId: a.company.id,
          salesOrderNumber: 'PROOF-COMMISSION',
          orderDate: date(day),
          createdById: hr.user.id,
        },
      });
      payrollCommission = await db.salesCommission.create({
        data: {
          companyId: a.company.id,
          employeeId: employee.id,
          salesOrderId: order.id,
          rate: '0.01',
          amount: '100',
          status: 'APPROVED',
          createdById: hr.user.id,
        },
      });
      const period = await db.payrollPeriod.create({
        data: {
          companyId: a.company.id,
          payrollPeriodCode: `SEP-${stamp}`,
          name: 'Proof September',
          startDate: date('2026-09-01'),
          endDate: date('2026-09-30'),
          paymentDate: date(day),
          createdById: hr.user.id,
        },
      });
      const run = await call(hr.token, 'POST', '/hr/payroll-runs', {
        companyId: a.company.id,
        payrollPeriodId: period.id,
        payrollRunNumber: `PAY-${stamp}`,
        runDate: day,
        createdById: hr.user.id,
      });
      await call(hr.token, 'PATCH', `/hr/payroll-runs/${run.id}/calculate`, {});
      await call(hr.token, 'PATCH', `/hr/payroll-runs/${run.id}/submit`, {});
      await call(hr.token, 'PATCH', `/hr/payroll-runs/${run.id}/approve-hr`, {});
      await call(hr.token, 'PATCH', `/hr/payroll-runs/${run.id}/approve-finance`, {}, 400);
      await call(finance.token, 'PATCH', `/hr/payroll-runs/${run.id}/approve-finance`, {});
      const approved = await db.payrollRun.findUniqueOrThrow({ where: { id: run.id } });
      payrollRun = run;
      payrollRequest = { requestId: randomUUID(), cashDeskAccountId: bank.id, businessDate: day };
      await call(finance.token, 'PATCH', `/hr/payroll-runs/${run.id}/pay`, payrollRequest, 400);
      // Accrual retains independent accounting review; the approved payment posts atomically.
      await call(hr.token, 'PATCH', `/journal-entries/${approved.journalEntryId}/post`, {});
      await call(finance.token, 'PATCH', `/hr/payroll-runs/${run.id}/pay`, payrollRequest);
      const stored = await db.payrollRun.findUniqueOrThrow({ where: { id: run.id } });
      equal(stored.status, 'PAID', 'payroll run paid');
      equal(
        (await db.salaryAdvance.findUniqueOrThrow({ where: { id: payrollAdvance.id } }))
          .recoveredAmount,
        '1000',
        'advance recovered once',
      );
      equal(
        (await db.salesCommission.findUniqueOrThrow({ where: { id: payrollCommission.id } }))
          .status,
        'PAID',
        'commission settled',
      );
      payrollMovement = await db.cashDeskMovement.findUniqueOrThrow({
        where: { requestId: payrollRequest.requestId },
      });
      equal(
        await db.salaryPayment.count({
          where: { cashMovementId: payrollMovement.id, status: 'PAID' },
        }),
        1,
        'employee salary payment recorded',
      );
      const journal = await db.journalEntry.findUniqueOrThrow({
        where: { id: stored.paymentJournalEntryId },
      });
      equal(journal.status, 'POSTED', 'paid payroll is reflected in posted financial reports');
    },
  );
  await check(
    'payroll payment is reflected in Cash Desk as well as the general ledger',
    async () => {
      const cash = await db.cashDeskAccount.findUniqueOrThrow({ where: { id: bank.id } });
      const ledger = await db.journalEntryLine.aggregate({
        where: {
          accountId: a.gl['1010'],
          journalEntry: { status: { in: ['POSTED', 'REVERSED'] }, deletedAt: null },
        },
        _sum: { debit: true, credit: true },
      });
      equal(
        cash.balance,
        D(ledger._sum.debit ?? 0).minus(ledger._sum.credit ?? 0),
        'Cash Desk reflects net payroll disbursement',
      );
    },
  );
  await check(
    'payroll concurrent retries create one cash movement, journal and employee payment',
    async () => {
      await Promise.all([
        call(finance.token, 'PATCH', `/hr/payroll-runs/${payrollRun.id}/pay`, payrollRequest),
        call(finance.token, 'PATCH', `/hr/payroll-runs/${payrollRun.id}/pay`, payrollRequest),
      ]);
      equal(
        await db.cashDeskMovement.count({ where: { payrollRunId: payrollRun.id } }),
        1,
        'one cash outflow',
      );
      equal(
        await db.journalEntry.count({
          where: { referenceId: payrollRun.id, referenceType: 'PayrollRunPayment' },
        }),
        1,
        'one journal',
      );
      await call(
        finance.token,
        'PATCH',
        `/hr/payroll-runs/${payrollRun.id}/pay`,
        { ...payrollRequest, businessDate: '2026-09-18' },
        409,
      );
      await call(
        finance.token,
        'PATCH',
        `/hr/payroll-runs/${payrollRun.id}/pay`,
        { ...payrollRequest, requestId: randomUUID() },
        400,
      );
    },
  );
  await check(
    'payroll company-wide payments deny branch, division and read-only actors',
    async () => {
      for (const who of [branch, division, reader])
        await call(
          who.token,
          'PATCH',
          `/hr/payroll-runs/${payrollRun.id}/pay`,
          payrollRequest,
          403,
        );
    },
  );
  await check('cash and manual journal routes cannot detach payroll evidence', async () => {
    await call(
      finance.token,
      'POST',
      `/cash-desk/movements/${payrollMovement.id}/reverse`,
      { requestId: randomUUID(), businessDate: day, reason: 'Incorrect payment' },
      400,
    );
    await call(
      finance.token,
      'PATCH',
      `/journal-entries/${payrollMovement.payrollJournalEntryId}/reverse`,
      { reversalReason: 'Incorrect payment', transactionDate: day },
      400,
    );
    const review = await call(
      finance.token,
      'GET',
      `/cash-connections/movements/${payrollMovement.id}`,
    );
    equal(
      review.issues.some((i) => i.includes('Payroll')),
      true,
      'payroll-owned connection',
    );
  });
  const reversal = () => ({
    movementId: payrollMovement.id,
    businessDate: day,
    reason: 'Bank returned payment',
  });
  await check(
    'payroll reversal atomically restores cash, payable and employee payment history',
    async () => {
      await call(
        finance.token,
        'PATCH',
        `/hr/payroll-runs/${payrollRun.id}/reverse-payment`,
        reversal(),
      );
      await call(
        finance.token,
        'PATCH',
        `/hr/payroll-runs/${payrollRun.id}/reverse-payment`,
        reversal(),
      );
      equal(
        (await db.payrollRun.findUniqueOrThrow({ where: { id: payrollRun.id } })).status,
        'APPROVED',
        'run reopened',
      );
      equal(
        (await db.cashDeskAccount.findUniqueOrThrow({ where: { id: bank.id } })).balance,
        '1000800',
        'cash restored',
      );
      equal(
        await db.salaryPayment.count({
          where: { cashMovementId: payrollMovement.id, status: 'REVERSED' },
        }),
        1,
        'salary register reversed',
      );
      await call(
        finance.token,
        'PATCH',
        `/hr/payroll-runs/${payrollRun.id}/pay`,
        payrollRequest,
        409,
      );
    },
  );
  await check(
    'payroll reversal restores advance recoveries and commission eligibility',
    async () => {
      equal(
        (await db.salaryAdvance.findUniqueOrThrow({ where: { id: payrollAdvance.id } }))
          .recoveredAmount,
        '0',
        'advance recovery restored',
      );
      const commission = await db.salesCommission.findUniqueOrThrow({
        where: { id: payrollCommission.id },
      });
      equal(commission.status, 'APPROVED', 'commission reopened');
      equal(commission.paidPayrollEntryId, null, 'commission payout link cleared');
    },
  );
  await check('wrong-company and currency-mismatched accounts cannot fund payroll', async () => {
    const foreign = await db.cashDeskAccount.create({
      data: {
        companyId: b.company.id,
        divisionId: b.division.id,
        branchId: b.branch.id,
        name: 'Foreign bank',
        nameKey: 'foreign bank',
        kind: 'BANK',
        currency: 'TZS',
        openingDate: date(day),
        balance: '0',
        erpCashAccountId: b.bank.id,
      },
    });
    await call(
      finance.token,
      'PATCH',
      `/hr/payroll-runs/${payrollRun.id}/pay`,
      { ...payrollRequest, requestId: randomUUID(), cashDeskAccountId: foreign.id },
      400,
    );
    await db.cashDeskAccount.update({ where: { id: bank.id }, data: { currency: 'USD' } });
    try {
      await call(
        finance.token,
        'PATCH',
        `/hr/payroll-runs/${payrollRun.id}/pay`,
        { ...payrollRequest, requestId: randomUUID() },
        400,
      );
    } finally {
      await db.cashDeskAccount.update({ where: { id: bank.id }, data: { currency: 'TZS' } });
    }
  });
  await check(
    'closed-period payroll payment leaves no cash, journal or salary records',
    async () => {
      const periods = await db.accountingPeriod.findMany({ where: { companyId: a.company.id } });
      await db.accountingPeriod.updateMany({
        where: { companyId: a.company.id },
        data: { status: 'CLOSED' },
      });
      try {
        await call(
          finance.token,
          'PATCH',
          `/hr/payroll-runs/${payrollRun.id}/pay`,
          { ...payrollRequest, requestId: randomUUID() },
          400,
        );
      } finally {
        for (const p of periods)
          await db.accountingPeriod.update({ where: { id: p.id }, data: { status: p.status } });
      }
      equal(
        await db.cashDeskMovement.count({ where: { payrollRunId: payrollRun.id } }),
        2,
        'no additional movement',
      );
    },
  );
  await check(
    'insufficient funds rolls back payment and journal; corrected payment succeeds',
    async () => {
      const openingEntry = await db.cashDeskEntry.findFirstOrThrow({
        where: { movementId: opening.id },
      });
      // Deliberately reduce only this isolated synthetic account's available funds.
      await db.cashDeskEntry.update({ where: { id: openingEntry.id }, data: { amount: 1 } });
      try {
        await call(
          finance.token,
          'PATCH',
          `/hr/payroll-runs/${payrollRun.id}/pay`,
          { ...payrollRequest, requestId: randomUUID() },
          400,
        );
        equal(
          await db.journalEntry.count({
            where: { referenceId: payrollRun.id, referenceType: 'PayrollRunPayment' },
          }),
          2,
          'failed journal rolled back',
        );
        equal(
          (await db.payrollRun.findUniqueOrThrow({ where: { id: payrollRun.id } })).status,
          'APPROVED',
          'payment state rolled back',
        );
      } finally {
        await db.cashDeskEntry.update({
          where: { id: openingEntry.id },
          data: { amount: openingEntry.amount },
        });
      }
      await call(finance.token, 'PATCH', `/hr/payroll-runs/${payrollRun.id}/pay`, {
        ...payrollRequest,
        requestId: randomUUID(),
      });
      // A late retry for the old reversal must not undo the corrected payment.
      await call(
        finance.token,
        'PATCH',
        `/hr/payroll-runs/${payrollRun.id}/reverse-payment`,
        reversal(),
      );
      equal(
        (await db.payrollRun.findUniqueOrThrow({ where: { id: payrollRun.id } })).status,
        'PAID',
        'corrected payment survives old retry',
      );
      const ledger = await db.journalEntryLine.aggregate({
        where: {
          accountId: a.gl['1010'],
          journalEntry: { status: { in: ['POSTED', 'REVERSED'] }, deletedAt: null },
        },
        _sum: { debit: true, credit: true },
      });
      equal(
        (await db.cashDeskAccount.findUniqueOrThrow({ where: { id: bank.id } })).balance,
        D(ledger._sum.debit ?? 0).minus(ledger._sum.credit ?? 0),
        'cash and ledger agree after correction',
      );
    },
  );
  for (const journal of await db.journalEntry.findMany({
    where: { companyId: a.company.id },
    include: { lines: true },
  })) {
    equal(
      journal.lines.reduce((sum, l) => sum.plus(l.debit).minus(l.credit), D()).toFixed(2),
      '0.00',
      `balanced journal ${journal.referenceType}`,
    );
  }
  writeFileSync(
    resolve(root, '.release/browser-fixture.json'),
    JSON.stringify(
      {
        companyId: a.company.id,
        email: finance.user.email,
        invoiceId: invoice?.id,
        saleId: sale?.id,
        payrollRunId: payrollRun?.id,
      },
      null,
      2,
    ),
  );
}
try {
  await main();
} catch (error) {
  checks.push({ name: 'rehearsal setup', status: 'failed', error: error.message });
  console.error(error.message);
} finally {
  await db.$disconnect();
  const failed = checks.filter((c) => c.status === 'failed');
  writeFileSync(
    resolve(root, '.release/workflows.json'),
    JSON.stringify(
      { createdAt: new Date().toISOString(), environment: 'isolated local rehearsal', checks },
      null,
      2,
    ),
  );
  console.log(
    `${checks.length - failed.length} passed; ${failed.length} failed. Evidence: .release/workflows.json`,
  );
  if (failed.length) process.exitCode = 1;
}
