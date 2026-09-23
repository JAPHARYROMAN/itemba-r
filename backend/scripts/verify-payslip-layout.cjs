// Generate real PDF bytes with synthetic source data and in-memory persistence.
// Run after npm run build. This never connects to the application database.
require('reflect-metadata');
const fs = require('node:fs');
const path = require('node:path');
const { GeneratedDocumentsService } = require('../dist/modules/generated-documents/generated-documents.service');
const output = path.resolve(__dirname, '../../tmp/pdfs');
const actor = { id: 'synthetic-operator', email: 'fixture@example.invalid', roles: [], roleScopes: ['COMPANY'], companyId: 'synthetic-company', permissions: ['payroll.view'] };
let record;
let pdfBuffer;
const prisma = {
  payrollEntry: { findFirst: async ({ where }) => {
    if (where.id !== record.id || !where.companyId.in.includes(actor.companyId)) throw new Error('Missing payslip scope');
    return record;
  } },
  documentTemplate: { upsert: async () => ({ id: 'synthetic-template' }) },
  generatedDocument: { create: async ({ data }) => ({ id: 'synthetic-generated', ...data }) },
};
const service = new GeneratedDocumentsService(prisma, { log: async () => {} }, {
  createFromBuffer: async ({ buffer }) => { pdfBuffer = buffer; return { id: 'synthetic-document' }; },
}, { assertCanAccessCompany: async () => {} });
async function generate(name, allowanceCount) {
  const allowances = Array.from({ length: allowanceCount }, (_, index) => ({ amount: 10000, allowanceType: { name: `Synthetic allowance ${index + 1} for layout verification`, code: `TEST-${index + 1}` } }));
  const gross = 1050000 + allowanceCount * 10000;
  record = {
    id: 'synthetic-entry', companyId: actor.companyId, status: 'CALCULATED', notes: 'SYNTHETIC QA FIXTURE - not a payroll record or proof of payment.',
    basePay: 1000000, attendancePay: 0, overtimePay: 50000, totalAllowances: allowanceCount * 10000,
    grossPay: gross, totalDeductions: 230000, netPay: gross - 230000,
    company: { id: actor.companyId, name: 'Example Company - QA Fixture', code: 'EXAMPLE', profile: null },
    employee: { fullName: 'Alex Example - Synthetic Fixture', employeeCode: 'EXAMPLE-01', tin: 'TEST-TIN', nssfNumber: 'TEST-NSSF', nhifNumber: null, bankName: 'Example Bank', bankAccountNumber: 'TEST-NOT-AN-ACCOUNT', department: { name: 'Operations' }, position: { title: 'Operations coordinator' }, branch: null },
    payrollRun: { payrollRunNumber: 'PR-EXAMPLE-01', runDate: new Date('2026-09-28'), payrollPeriod: { name: 'September 2026', startDate: new Date('2026-09-01'), endDate: new Date('2026-09-30'), paymentDate: new Date('2026-09-28') } },
    allowances, deductions: [{ amount: 30000, deductionType: { name: 'Advance recovery', code: 'ADV' } }],
    statutoryLines: [{ employeeContribution: 115000, employerContribution: 115000, taxType: { name: 'NSSF', taxTypeCode: 'NSSF' } }, { employeeContribution: 85000, employerContribution: 0, taxType: { name: 'PAYE', taxTypeCode: 'PAYE' } }],
  };
  await service.generateBusinessPdf({ entityType: 'PAYSLIP', entityId: record.id }, actor);
  if (!pdfBuffer || pdfBuffer.subarray(0, 5).toString() !== '%PDF-') throw new Error('No PDF generated');
  fs.mkdirSync(output, { recursive: true });
  const file = path.join(output, name + '.pdf');
  fs.writeFileSync(file, pdfBuffer);
  console.log(JSON.stringify({ file, bytes: pdfBuffer.length, allowanceCount, expectedGross: gross, expectedNet: gross - 230000 }));
}
(async () => { await generate('payslip-standard-fixture', 2); await generate('payslip-long-fixture', 32); })().catch(error => { console.error(error); process.exitCode = 1; });
