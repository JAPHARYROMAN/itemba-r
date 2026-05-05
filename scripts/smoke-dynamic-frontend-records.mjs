#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const allowLocal = args.has('--allow-local') || npmBoolean('allow_local');
const useStaging = args.has('--staging') || npmBoolean('staging');
const useProduction = args.has('--production') || npmBoolean('production');

if (useStaging && useProduction) {
  fail('Use either --staging or --production, not both.');
}

if (!process.env.CI && !allowLocal) {
  fail(
    'Refusing to run dynamic frontend record smoke outside CI without --allow-local because deployment compose files use fixed container names and host ports.',
  );
}

const target = useStaging
  ? {
      name: 'staging',
      composeFile: 'docker-compose.staging.yml',
      postgresDb: 'itemba_r_staging_dynamic_frontend_smoke',
      postgresUser: 'itemba_staging_dynamic_frontend_smoke',
    }
  : {
      name: 'production',
      composeFile: 'docker-compose.production.yml',
      postgresDb: 'itemba_r_dynamic_frontend_smoke',
      postgresUser: 'itemba_dynamic_frontend_smoke',
    };

const sampleEnv = {
  POSTGRES_DB: target.postgresDb,
  POSTGRES_USER: target.postgresUser,
  POSTGRES_PASSWORD: 'postgres-dynamic-frontend-smoke-validation-secret-40',
  REDIS_PASSWORD: 'redis-dynamic-frontend-smoke-validation-secret-40',
  JWT_ACCESS_SECRET: 'jwt-access-dynamic-frontend-smoke-validation-secret-40',
  JWT_REFRESH_SECRET: 'jwt-refresh-dynamic-frontend-smoke-validation-secret-40',
  TWO_FACTOR_ENCRYPTION_KEY: 'two-factor-dynamic-frontend-smoke-validation-secret-40',
  REFRESH_TOKEN_PEPPER: 'refresh-pepper-dynamic-frontend-smoke-validation-secret-40',
  APP_ENCRYPTION_KEY: 'app-encryption-dynamic-frontend-smoke-validation-secret-40',
  JWT_ACCESS_EXPIRES_IN: '15m',
  JWT_REFRESH_EXPIRES_IN: '7d',
  JOB_WORKER_ENABLED: 'true',
  FRONTEND_URL: 'http://127.0.0.1:3000',
  CORS_ORIGIN: 'http://127.0.0.1:3000',
  NEXT_PUBLIC_API_URL: 'http://127.0.0.1:3001/api/v1',
  BACKEND_INTERNAL_URL: 'http://backend:3001/api/v1',
  STORAGE_DRIVER: 'local',
  STORAGE_LOCAL_PATH: '/app/storage',
  BACKUP_STORAGE_PATH: '/app/backups',
  BACKUPS_DIR: '/app/backups',
};

const tempDir = mkdtempSync(join(tmpdir(), 'itemba-dynamic-frontend-smoke-'));
const envFile = join(tempDir, `${target.name}.env`);
writeFileSync(
  envFile,
  `${Object.entries(sampleEnv)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')}\n`,
  'utf8',
);

const FRONTEND = 'http://127.0.0.1:3000';
const ERROR_SIGNATURES = [
  'id="__next_error__"',
  'NEXT_HTTP_ERROR_FALLBACK;500',
  'Application error',
  'Internal Server Error',
];

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

async function main() {
  let shouldPrintDiagnostics = true;
  let exitCode = 0;

  try {
    await runSmoke();
    shouldPrintDiagnostics = false;
    console.log(`smoke-dynamic-frontend-records: OK ${target.name}`);
  } catch (error) {
    if (shouldPrintDiagnostics) {
      printDiagnostics();
    }
    console.error(error.message);
    exitCode = 1;
  } finally {
    compose(['down', '-v', '--remove-orphans'], { allowFailure: true });
    rmSync(tempDir, { recursive: true, force: true });
  }

  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

async function runSmoke() {
  console.log(`Starting ${target.name} dynamic frontend record smoke...`);
  compose(['down', '-v', '--remove-orphans'], { allowFailure: true });
  compose(['up', '--build', '-d']);

  await waitForBackendReady();
  await waitForFrontendReady();

  const fixture = createFixture();
  const cookie = await frontendLogin(fixture.email, fixture.password);
  const checks = buildChecks(fixture);

  for (const check of checks) {
    await assertFrontendRoute(check, cookie);
    for (const apiCheck of check.apiChecks) {
      await assertFrontendApi(apiCheck, cookie);
    }
    console.log(`dynamic page real-record check OK: ${check.name}`);
  }
}

function createFixture() {
  const suffix = Date.now().toString();
  const script = `
const { PrismaClient } = require('@prisma/client');
const argon2 = require('argon2');
const prisma = new PrismaClient();
const suffix = ${JSON.stringify(suffix)};
const password = 'DynamicFrontendSmoke123!';
const now = new Date();
const today = new Date(Date.UTC(2026, 0, 15));
const tomorrow = new Date(Date.UTC(2026, 0, 16));
const nextMonth = new Date(Date.UTC(2026, 1, 15));

const permissionCodes = [
  'companies.read',
  'company-profiles.read',
  'branches.read',
  'contracts.view',
  'documents.view',
  'fixed-assets.read',
  'loans.read',
  'cash_accounts.view',
  'hospitality.bookings.view',
  'employees.view',
  'payroll.view',
  'trips.view',
  'logistics.reports.view',
  'trip_expenses.view',
  'trip_fuel_usage.view',
  'fuel_shifts.view',
  'fuel_nozzles.view',
  'support.tickets.view',
  'support.tickets.create',
  'training.courses.view',
  'customers.view',
];

function code(prefix) {
  return prefix + suffix.slice(-8);
}

async function main() {
  const permissions = await Promise.all(
    permissionCodes.map((permissionCode) =>
      prisma.permission.upsert({
        where: { code: permissionCode },
        update: {},
        create: {
          code: permissionCode,
          description: 'Dynamic frontend smoke permission ' + permissionCode,
          module: permissionCode.split('.')[0],
          action: permissionCode.split('.')[1] || 'view',
        },
      }),
    ),
  );

  const group = await prisma.group.create({
    data: {
      code: code('DFSG'),
      name: 'Dynamic Frontend Smoke Group ' + suffix,
    },
  });
  const company = await prisma.company.create({
    data: {
      groupId: group.id,
      code: code('DFSC'),
      name: 'Dynamic Frontend Smoke Company ' + suffix,
      employeeCodePrefix: 'DFSM',
    },
  });
  await prisma.companyProfile.create({
    data: {
      companyId: company.id,
      registeredName: 'Dynamic Frontend Smoke Registered ' + suffix,
      tradingName: 'Dynamic Frontend Smoke Trading ' + suffix,
      brelaRegNumber: 'BRELA-DF-' + suffix,
      tin: 'TIN-DF-' + suffix,
      registeredAddress: 'Dynamic Frontend Smoke Address ' + suffix,
      postalAddress: 'P.O. Box DF ' + suffix,
      natureOfBusiness: 'Smoke verification',
    },
  });
  const division = await prisma.division.create({
    data: {
      companyId: company.id,
      name: 'Dynamic Frontend Smoke Division ' + suffix,
      code: code('DFSD'),
      type: 'OTHER',
    },
  });
  const branch = await prisma.branch.create({
    data: {
      divisionId: division.id,
      name: 'Dynamic Frontend Smoke Branch ' + suffix,
      code: code('DFSB'),
      type: 'BRANCH',
      location: 'Dar es Salaam',
    },
  });

  const role = await prisma.role.create({
    data: {
      name: 'dynamic_frontend_smoke_' + suffix,
      displayName: 'Dynamic Frontend Smoke',
      scope: 'GROUP',
      rolePermissions: {
        create: permissions.map((permission) => ({ permissionId: permission.id })),
      },
    },
  });
  const email = 'dynamic-frontend-smoke-' + suffix + '@itemba.local';
  const passwordHash = await argon2.hash(password);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      fullName: 'Dynamic Frontend Smoke User',
      status: 'ACTIVE',
      companyId: company.id,
      userRoles: { create: { roleId: role.id } },
      companyAccess: { create: { companyId: company.id, accessLevel: 'MANAGE' } },
    },
  });

  const employee = await prisma.employee.create({
    data: {
      employeeCode: code('EMP'),
      companyId: company.id,
      divisionId: division.id,
      branchId: branch.id,
      firstName: 'Dynamic',
      lastName: 'Employee ' + suffix.slice(-4),
      fullName: 'Dynamic Employee Smoke ' + suffix,
      gender: 'NOT_SPECIFIED',
      email: 'employee-' + suffix + '@itemba.local',
      hireDate: today,
      baseSalary: '1200000',
      bankName: 'Dynamic Smoke Bank',
      bankAccountName: 'Dynamic Employee Smoke',
      bankAccountNumber: 'DF' + suffix,
    },
  });
  await prisma.mobileMoneyAccount.create({
    data: {
      employeeId: employee.id,
      provider: 'M_PESA',
      accountName: 'Dynamic Employee Smoke',
      msisdn: '+255700' + suffix.slice(-6),
      isPrimary: true,
      status: 'ACTIVE',
    },
  });
  const dispute = await prisma.employmentDispute.create({
    data: {
      disputeNumber: code('DSP'),
      companyId: company.id,
      employeeId: employee.id,
      raisedById: user.id,
      type: 'UNFAIR_TERMINATION',
      status: 'CMA_REFERRED',
      raisedAt: today,
      summary: 'Dynamic Frontend Smoke Dispute ' + suffix,
      initialPosition: 'Employee disputes termination',
      cmaReferenceNumber: 'CMA-DF-' + suffix,
      cmaReferredById: user.id,
      cmaReferredAt: today,
      cmaHearingDate: nextMonth,
    },
  });
  const payrollPeriod = await prisma.payrollPeriod.create({
    data: {
      payrollPeriodCode: code('PRD'),
      companyId: company.id,
      name: 'Dynamic Frontend Smoke Payroll Period ' + suffix,
      startDate: today,
      endDate: nextMonth,
      paymentDate: nextMonth,
      createdById: user.id,
    },
  });
  const payrollRun = await prisma.payrollRun.create({
    data: {
      payrollRunNumber: code('RUN'),
      companyId: company.id,
      payrollPeriodId: payrollPeriod.id,
      runDate: today,
      status: 'APPROVED',
      totalGrossPay: '1200000',
      totalDeductions: '200000',
      totalNetPay: '1000000',
      createdById: user.id,
    },
  });
  const payrollEntry = await prisma.payrollEntry.create({
    data: {
      payrollRunId: payrollRun.id,
      companyId: company.id,
      employeeId: employee.id,
      basePay: '1200000',
      grossPay: '1200000',
      totalDeductions: '200000',
      netPay: '1000000',
      daysWorked: '22',
      status: 'APPROVED',
    },
  });

  const contract = await prisma.contract.create({
    data: {
      companyId: company.id,
      owningLevel: 'COMPANY',
      title: 'Dynamic Frontend Smoke Contract ' + suffix,
      contractType: 'SERVICE',
      contractNumber: code('CON'),
      counterpartyName: 'Dynamic Frontend Smoke Counterparty',
      startDate: today,
      endDate: nextMonth,
      status: 'ACTIVE',
      riskLevel: 'LOW',
      createdById: user.id,
    },
  });
  const fixedAsset = await prisma.fixedAsset.create({
    data: {
      companyId: company.id,
      ownershipLevel: 'COMPANY',
      divisionId: division.id,
      branchId: branch.id,
      assetCode: code('AST'),
      name: 'Dynamic Frontend Smoke Asset ' + suffix,
      category: 'EQUIPMENT',
      acquisitionDate: today,
      acquisitionCost: '2500000',
      currentBookValue: '2100000',
      status: 'ACTIVE',
      condition: 'GOOD',
      createdById: user.id,
    },
  });
  const loan = await prisma.loan.create({
    data: {
      companyId: company.id,
      borrowerLevel: 'COMPANY',
      obligationType: 'BANK_LOAN',
      loanReference: code('LOAN'),
      lenderName: 'Dynamic Frontend Smoke Lender ' + suffix,
      principalAmount: '5000000',
      interestRate: '0.1200',
      disbursementDate: today,
      maturityDate: nextMonth,
      repaymentFrequency: 'MONTHLY',
      outstandingBalance: '4500000',
      status: 'ACTIVE',
      riskLevel: 'LOW',
      createdById: user.id,
    },
  });
  const document = await prisma.document.create({
    data: {
      documentCode: code('DOC'),
      title: 'Dynamic Frontend Smoke Document ' + suffix,
      category: 'OTHER',
      ownerType: 'COMPANY',
      ownerId: company.id,
      fileName: 'dynamic-frontend-smoke.txt',
      storageKey: 'dynamic-frontend-smoke/' + suffix + '.txt',
      mimeType: 'text/plain',
      fileSizeBytes: 42,
      companyId: company.id,
      uploadedById: user.id,
      status: 'ACTIVE',
    },
  });

  const customer = await prisma.customer.create({
    data: {
      customerCode: code('CUS'),
      companyId: company.id,
      divisionId: division.id,
      branchId: branch.id,
      customerType: 'INDIVIDUAL',
      name: 'Dynamic Frontend Smoke Customer ' + suffix,
      phone: '+255711' + suffix.slice(-6),
      currentBalance: '12345',
      createdById: user.id,
    },
  });
  const cashAccount = await prisma.cashAccount.create({
    data: {
      companyId: company.id,
      accountName: 'Dynamic Frontend Smoke Cash ' + suffix,
      accountType: 'CASH_ON_HAND',
      currentBalance: '1000000',
    },
  });

  const facility = await prisma.hospitalityFacility.create({
    data: {
      facilityCode: code('HSP'),
      companyId: company.id,
      divisionId: division.id,
      branchId: branch.id,
      facilityName: 'Dynamic Frontend Smoke Lodge ' + suffix,
      facilityType: 'HOTEL',
      location: 'Dar es Salaam',
    },
  });
  const room = await prisma.room.create({
    data: {
      roomCode: code('ROM'),
      companyId: company.id,
      hospitalityFacilityId: facility.id,
      roomNumber: 'DF-' + suffix.slice(-4),
      roomType: 'SINGLE',
      defaultRate: '150000',
      status: 'OCCUPIED',
    },
  });
  const guest = await prisma.guest.create({
    data: {
      guestCode: code('GST'),
      companyId: company.id,
      customerId: customer.id,
      fullName: 'Dynamic Frontend Smoke Guest ' + suffix,
      phone: '+255712' + suffix.slice(-6),
    },
  });
  const booking = await prisma.roomBooking.create({
    data: {
      bookingNumber: code('BKG'),
      companyId: company.id,
      hospitalityFacilityId: facility.id,
      roomId: room.id,
      guestId: guest.id,
      expectedCheckIn: today,
      expectedCheckOut: tomorrow,
      actualCheckIn: today,
      nights: 1,
      ratePerNight: '150000',
      subtotal: '150000',
      totalAmount: '150000',
      outstandingAmount: '150000',
      status: 'CHECKED_IN',
      createdById: user.id,
      checkedInById: user.id,
    },
  });
  const folio = await prisma.guestFolio.create({
    data: {
      folioNumber: code('FOL'),
      companyId: company.id,
      bookingId: booking.id,
      guestId: guest.id,
      subtotal: '150000',
      totalAmount: '150000',
      status: 'OPEN',
    },
  });
  await prisma.folioCharge.create({
    data: {
      folioId: folio.id,
      chargeType: 'ROOM',
      description: 'Dynamic Frontend Smoke room night',
      quantity: '1',
      unitPrice: '150000',
      amount: '150000',
      postedById: user.id,
    },
  });

  const vehicle = await prisma.vehicle.create({
    data: {
      vehicleCode: code('VEH'),
      companyId: company.id,
      divisionId: division.id,
      registrationNumber: 'DF-' + suffix.slice(-6),
      vehicleType: 'TRUCK',
      status: 'ACTIVE',
    },
  });
  const driver = await prisma.driverProfile.create({
    data: {
      driverCode: code('DRV'),
      companyId: company.id,
      divisionId: division.id,
      employeeId: employee.id,
      fullName: 'Dynamic Frontend Smoke Driver ' + suffix,
      phone: '+255713' + suffix.slice(-6),
      status: 'ACTIVE',
    },
  });
  const trip = await prisma.trip.create({
    data: {
      tripNumber: code('TRP'),
      companyId: company.id,
      divisionId: division.id,
      branchId: branch.id,
      customerId: customer.id,
      vehicleId: vehicle.id,
      driverId: driver.id,
      origin: 'Dynamic Origin ' + suffix,
      destination: 'Dynamic Destination ' + suffix,
      cargoDescription: 'Dynamic Frontend Smoke cargo',
      tripDate: today,
      revenueAmount: '750000',
      currency: 'TZS',
      status: 'PLANNED',
      createdById: user.id,
    },
  });
  await prisma.tripExpense.create({
    data: {
      tripExpenseNumber: code('TEX'),
      tripId: trip.id,
      companyId: company.id,
      divisionId: division.id,
      expenseType: 'OTHER',
      amount: '25000',
      currency: 'TZS',
      expenseDate: today,
      description: 'Dynamic Frontend Smoke trip expense',
      createdById: user.id,
    },
  });

  const fuelShift = await prisma.fuelShift.create({
    data: {
      shiftNumber: code('FSH'),
      companyId: company.id,
      divisionId: division.id,
      branchId: branch.id,
      shiftDate: today,
      startTime: now,
      status: 'OPEN',
      openedById: user.id,
      notes: 'Dynamic Frontend Smoke fuel shift ' + suffix,
    },
  });
  await prisma.fuelShiftAttendant.create({
    data: {
      fuelShiftId: fuelShift.id,
      employeeId: employee.id,
      attendantName: 'Dynamic Frontend Smoke Attendant',
    },
  });

  const supportTicket = await prisma.supportTicket.create({
    data: {
      ticketNumber: code('TKT'),
      companyId: company.id,
      reportedById: user.id,
      title: 'Dynamic Frontend Smoke Ticket ' + suffix,
      description: 'Dynamic Frontend Smoke support ticket description',
      moduleName: 'deployment-smoke',
      ticketType: 'QUESTION',
      priority: 'NORMAL',
      status: 'OPEN',
    },
  });
  await prisma.supportTicketComment.create({
    data: {
      supportTicketId: supportTicket.id,
      userId: user.id,
      comment: 'Dynamic Frontend Smoke ticket comment ' + suffix,
    },
  });
  const trainingCourse = await prisma.trainingCourse.create({
    data: {
      courseCode: code('CRS'),
      title: 'Dynamic Frontend Smoke Course ' + suffix,
      description: 'Dynamic Frontend Smoke course description',
      moduleName: 'deployment-smoke',
      status: 'ACTIVE',
      createdById: user.id,
    },
  });
  await prisma.trainingLesson.create({
    data: {
      trainingCourseId: trainingCourse.id,
      lessonCode: code('LSN'),
      title: 'Dynamic Frontend Smoke Lesson ' + suffix,
      lessonOrder: 1,
      content: 'Dynamic Frontend Smoke lesson content',
      status: 'ACTIVE',
    },
  });

  console.log(JSON.stringify({
    email,
    password,
    suffix,
    ids: {
      company: company.id,
      contract: contract.id,
      document: document.id,
      fixedAsset: fixedAsset.id,
      loan: loan.id,
      booking: booking.id,
      employee: employee.id,
      dispute: dispute.id,
      payrollRun: payrollRun.id,
      payrollEntry: payrollEntry.id,
      trip: trip.id,
      fuelShift: fuelShift.id,
      supportTicket: supportTicket.id,
      trainingCourse: trainingCourse.id,
      customer: customer.id,
    },
    markers: {
      company: company.name,
      contract: contract.title,
      document: document.title,
      fixedAsset: fixedAsset.name,
      loan: loan.lenderName,
      folioGuest: guest.fullName,
      employee: employee.fullName,
      dispute: dispute.summary,
      payrollRun: payrollRun.payrollRunNumber,
      trip: trip.tripNumber,
      fuelShift: fuelShift.shiftNumber,
      supportTicket: supportTicket.title,
      trainingCourse: trainingCourse.title,
      customer: customer.name,
    },
  }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
`;
  const result = compose(['exec', '-T', 'backend', 'node', '-e', script], { capture: true });
  const output = result.stdout.trim().split(/\r?\n/).at(-1);
  if (!output) throw new Error('Fixture creation returned no output');
  return JSON.parse(output);
}

async function frontendLogin(email, password) {
  const response = await fetchWithTimeout(
    `${FRONTEND}/api/auth/login`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    },
    30_000,
  );
  const body = await readJson(response, 'frontend login');
  if (!body.user) throw new Error('Frontend login did not return a user profile');

  const setCookies = response.headers.getSetCookie?.() ?? splitSetCookie(response.headers.get('set-cookie'));
  const cookie = setCookies.map((entry) => entry.split(';')[0]).join('; ');
  if (!cookie.includes('itemba_access=') || !cookie.includes('itemba_backend_refresh=')) {
    throw new Error(`Frontend login did not set the expected auth cookies: ${cookie}`);
  }
  return cookie;
}

function buildChecks(fixture) {
  const { ids, markers } = fixture;
  return [
    {
      name: 'company detail',
      route: `/companies/${ids.company}`,
      apiChecks: [
        api(`/api/backend/companies/${ids.company}`, [markers.company]),
        api(`/api/backend/companies/${ids.company}/profile`, ['Dynamic Frontend Smoke Registered']),
      ],
    },
    {
      name: 'contract detail',
      route: `/group-control/contracts/${ids.contract}`,
      apiChecks: [
        api(`/api/backend/contracts/${ids.contract}`, [markers.contract]),
        api(`/api/backend/contracts/${ids.contract}/audit-history`),
      ],
    },
    {
      name: 'document detail',
      route: `/group-control/documents/${ids.document}`,
      apiChecks: [
        api(`/api/backend/documents/${ids.document}`, [markers.document]),
        api(`/api/backend/documents/${ids.document}/audit-history`),
      ],
    },
    {
      name: 'fixed asset detail',
      route: `/group-control/fixed-assets/${ids.fixedAsset}`,
      apiChecks: [
        api(`/api/backend/fixed-assets/${ids.fixedAsset}`, [markers.fixedAsset]),
        api(`/api/backend/fixed-assets/${ids.fixedAsset}/audit-history`),
      ],
    },
    {
      name: 'loan detail',
      route: `/group-control/loans-debts/loans/${ids.loan}`,
      apiChecks: [
        api(`/api/backend/loans/${ids.loan}`, [markers.loan]),
        api(`/api/backend/loans/${ids.loan}/audit-history`),
      ],
    },
    {
      name: 'hospitality folio',
      route: `/hospitality/folio/${ids.booking}`,
      apiChecks: [
        api(`/api/backend/hospitality/folios/booking/${ids.booking}`, [markers.folioGuest]),
        api(`/api/backend/cash-accounts?companyId=${ids.company}&limit=200`, [
          'Dynamic Frontend Smoke Cash',
        ]),
      ],
    },
    {
      name: 'CMA referral notice',
      route: `/hr/ccm-notices/cma-referral/${ids.dispute}`,
      apiChecks: [
        api(`/api/backend/hr/ccm-notices/cma-referral/${ids.dispute}`, [markers.dispute]),
      ],
    },
    {
      name: 'termination notice',
      route: `/hr/ccm-notices/termination/${ids.employee}`,
      apiChecks: [
        api(`/api/backend/hr/ccm-notices/termination/${ids.employee}`, [markers.employee]),
      ],
    },
    {
      name: 'employment dispute detail',
      route: `/hr/disputes/${ids.dispute}`,
      apiChecks: [api(`/api/backend/hr/employment-disputes/${ids.dispute}`, [markers.dispute])],
    },
    {
      name: 'employee detail',
      route: `/hr/employees/${ids.employee}`,
      apiChecks: [
        api(`/api/backend/hr/employees/${ids.employee}`, [markers.employee]),
        api(`/api/backend/hr/mobile-money-accounts?employeeId=${ids.employee}`, ['M_PESA']),
      ],
    },
    {
      name: 'payroll run payslips',
      route: `/hr/payroll-runs/${ids.payrollRun}/payslips`,
      apiChecks: [
        api(`/api/backend/hr/payslips/run/${ids.payrollRun}`, [
          markers.payrollRun,
          markers.employee,
        ]),
      ],
    },
    {
      name: 'payslip detail',
      route: `/hr/payslips/${ids.payrollEntry}`,
      apiChecks: [
        api(`/api/backend/hr/payslips/${ids.payrollEntry}`, [
          markers.payrollRun,
          markers.employee,
        ]),
      ],
    },
    {
      name: 'logistics trip detail',
      route: `/logistics/trips/${ids.trip}`,
      apiChecks: [
        api(`/api/backend/logistics/trips/${ids.trip}`, [markers.trip]),
        api(`/api/backend/logistics/trips/${ids.trip}/profitability`),
        api(`/api/backend/logistics/trip-expenses/by-trip/${ids.trip}`, [
          'Dynamic Frontend Smoke trip expense',
        ]),
        api(`/api/backend/logistics/trip-fuel-usage/by-trip/${ids.trip}`),
      ],
    },
    {
      name: 'petroleum fuel shift detail',
      route: `/petroleum/fuel-shifts/${ids.fuelShift}`,
      apiChecks: [
        api(`/api/backend/petroleum/fuel-shifts/${ids.fuelShift}`, [markers.fuelShift]),
        api(`/api/backend/petroleum/fuel-shifts/${ids.fuelShift}/efficiency`),
      ],
    },
    {
      name: 'support ticket detail',
      route: `/support/tickets/${ids.supportTicket}`,
      apiChecks: [
        api(`/api/backend/support/tickets/${ids.supportTicket}`, [markers.supportTicket]),
        api(`/api/backend/support/tickets/${ids.supportTicket}/comments`, [
          'Dynamic Frontend Smoke ticket comment',
        ]),
      ],
    },
    {
      name: 'training course detail',
      route: `/training/courses/${ids.trainingCourse}`,
      apiChecks: [
        api(`/api/backend/training/courses/${ids.trainingCourse}`, [markers.trainingCourse]),
        api(`/api/backend/training/courses/${ids.trainingCourse}/lessons`, [
          'Dynamic Frontend Smoke Lesson',
        ]),
      ],
    },
    {
      name: 'Westsides customer profile',
      route: `/westsides/customers/${ids.customer}`,
      apiChecks: [
        api(`/api/backend/customers/${ids.customer}/profile`, [markers.customer]),
      ],
    },
  ];
}

function api(path, expectedSubstrings = []) {
  return { path, expectedSubstrings };
}

async function assertFrontendRoute(check, cookie) {
  const response = await fetchWithTimeout(
    `${FRONTEND}${check.route}`,
    { headers: { cookie } },
    30_000,
  );
  const html = await response.text();
  const errorSignature = ERROR_SIGNATURES.find((signature) => html.includes(signature));
  if (response.status !== 200 || errorSignature || html.trim().length === 0) {
    throw new Error(
      `${check.name} route failed: HTTP ${response.status}, errorSignature=${errorSignature ?? 'none'}`,
    );
  }
}

async function assertFrontendApi(apiCheck, cookie) {
  const response = await fetchWithTimeout(
    `${FRONTEND}${apiCheck.path}`,
    { headers: { cookie } },
    30_000,
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${apiCheck.path} failed with HTTP ${response.status}: ${text}`);
  }
  if (!text.trim()) {
    throw new Error(`${apiCheck.path} returned an empty body`);
  }
  for (const expected of apiCheck.expectedSubstrings) {
    if (!text.includes(expected)) {
      throw new Error(`${apiCheck.path} did not include expected marker ${JSON.stringify(expected)}`);
    }
  }
}

async function readJson(response, label) {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${label} failed with HTTP ${response.status}: ${text}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} returned non-JSON response: ${text.slice(0, 200)}`);
  }
}

function splitSetCookie(header) {
  if (!header) return [];
  return header.split(/,(?=\s*[^;,=\s]+=[^;,]+)/g).map((cookie) => cookie.trim());
}

async function waitForBackendReady() {
  await waitForHttp(
    'backend readiness',
    'http://127.0.0.1:3001/api/v1/health/ready',
    240_000,
    async (response) => {
      if (!response.ok) return false;
      const body = await response.json().catch(() => null);
      const health = body?.data ?? body;
      return health?.database === 'up' && health?.status !== 'critical';
    },
  );
}

async function waitForFrontendReady() {
  await waitForHttp(
    'frontend login route',
    `${FRONTEND}/login`,
    180_000,
    async (response) => {
      if (!response.ok) return false;
      const text = await response.text().catch(() => '');
      return text.length > 0;
    },
  );
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 5_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function compose(composeArgs, options = {}) {
  return runDocker(
    ['compose', '--env-file', envFile, '-f', resolve(rootDir, target.composeFile), ...composeArgs],
    options,
  );
}

function runDocker(dockerArgs, { allowFailure = false, capture = false } = {}) {
  const result = spawnSync('docker', dockerArgs, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    windowsHide: true,
  });

  if (result.error) {
    if (allowFailure) {
      console.error(`Unable to run docker ${dockerArgs.join(' ')}: ${result.error.message}`);
      return result;
    }
    throw new Error(`Unable to run docker ${dockerArgs.join(' ')}: ${result.error.message}`);
  }

  if (result.status !== 0 && !allowFailure) {
    if (capture) {
      console.error(result.stdout);
      console.error(result.stderr);
    }
    throw new Error(`docker ${dockerArgs.join(' ')} failed with exit code ${result.status}`);
  }

  return result;
}

async function waitForHttp(label, url, timeoutMs, predicate) {
  const startedAt = Date.now();
  let lastError = 'not attempted';

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetchWithTimeout(url);
      if (await predicate(response)) {
        console.log(`${label} is ready`);
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error.message;
    }

    await sleep(3_000);
  }

  throw new Error(
    `${label} did not become ready within ${timeoutMs / 1000}s; last result: ${lastError}`,
  );
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function printDiagnostics() {
  console.error(`\n${target.name} dynamic frontend record diagnostics:`);
  compose(['ps'], { allowFailure: true });
  compose(
    ['logs', '--no-color', '--tail', '260', 'backend-migrate', 'backend', 'frontend', 'postgres', 'redis'],
    {
      allowFailure: true,
    },
  );
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function npmBoolean(name) {
  const value = process.env[`npm_config_${name}`];
  return value === 'true' || value === '';
}
