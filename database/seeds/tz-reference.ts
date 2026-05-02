/**
 * Tanzania payroll reference data — Phase 0 of HR & Payroll refinement.
 *
 * Seeds the regulatory facts every payroll calculation depends on:
 *   - Tax types (PAYE Mainland, PAYE Zanzibar, NSSF, PSSSF, WCF, SDL, NHIF, HESLB)
 *   - Tax rates + tiered brackets (PAYE bands)
 *   - Statutory deduction rules (NSSF/PSSSF/WCF/SDL/NHIF/HESLB rates)
 *   - Public holidays (Mainland + Zanzibar, 2026)
 *   - Sectoral minimum wages
 *
 * NOTE on currency: amounts in TZS. PAYE bands and minimum wages are MONTHLY.
 *
 * NOTE on bands: PAYE Mainland 2024/25 monthly bands gazetted by TRA. The
 * 2025/26 Finance Act may adjust thresholds — operators should verify and
 * supersede with new TaxRate rows (effectiveFrom dated to the gazette date)
 * rather than mutating these.
 */
import {
  PrismaClient,
  TaxRateCalculationMethod,
  TaxRateStatus,
  TaxCodeStatus,
  TaxCategory,
  StatutoryDeductionCalcMethod,
  StatutoryDeductionStatus,
  HolidayRegion,
  MinimumWageStatus,
  CurrencyCode,
} from '../../backend/node_modules/@prisma/client';

interface TaxTypeSeed {
  code: string;
  name: string;
  category: TaxCategory;
  isWithholding?: boolean;
  appliesToPayroll?: boolean;
  appliesToSales?: boolean;
  appliesToPurchases?: boolean;
  description?: string;
}

const TAX_TYPES: TaxTypeSeed[] = [
  {
    code: 'PAYE_MAINLAND',
    name: 'Pay As You Earn — Mainland Tanzania',
    category: TaxCategory.INCOME_TAX,
    isWithholding: true,
    appliesToPayroll: true,
    description: 'Personal income tax withheld monthly from employee wages, mainland Tanzania.',
  },
  {
    code: 'PAYE_ZANZIBAR',
    name: 'Pay As You Earn — Zanzibar',
    category: TaxCategory.INCOME_TAX,
    isWithholding: true,
    appliesToPayroll: true,
    description: 'Personal income tax withheld monthly from employee wages, Zanzibar.',
  },
  {
    code: 'NSSF',
    name: 'National Social Security Fund',
    category: TaxCategory.PAYROLL_TAX,
    appliesToPayroll: true,
    description: 'Pension contribution for private-sector employees. 10% employee + 10% employer.',
  },
  {
    code: 'PSSSF',
    name: 'Public Service Social Security Fund',
    category: TaxCategory.PAYROLL_TAX,
    appliesToPayroll: true,
    description: 'Pension contribution for public-sector employees. 10% employee + 10% employer.',
  },
  {
    code: 'WCF',
    name: 'Workers Compensation Fund',
    category: TaxCategory.PAYROLL_TAX,
    appliesToPayroll: true,
    description:
      'Workplace injury and disease compensation, employer-only. 0.5% private sector, 1.0% public sector.',
  },
  {
    code: 'SDL',
    name: 'Skills Development Levy',
    category: TaxCategory.PAYROLL_TAX,
    appliesToPayroll: true,
    description:
      'Workforce-skills levy paid to TRA, employer-only. 3.5% of monthly gross. Threshold: 10+ employees.',
  },
  {
    code: 'NHIF',
    name: 'National Health Insurance Fund',
    category: TaxCategory.PAYROLL_TAX,
    appliesToPayroll: true,
    description:
      'Mandatory health insurance contribution. Rates vary by scheme; placeholder default included.',
  },
  {
    code: 'HESLB',
    name: 'Higher Education Students Loans Board',
    category: TaxCategory.PAYROLL_TAX,
    appliesToPayroll: true,
    description:
      'Loan repayment deduction for graduates with active HESLB loans. 15% of basic salary above threshold.',
  },
];

interface PayeBandSeed {
  tierOrder: number;
  fromAmount: number;
  toAmount: number | null;
  marginalRate: number;
  fixedAmount: number;
  description: string;
}

/**
 * PAYE Mainland Tanzania monthly bands.
 * Source: TRA Income Tax Act, 2024/25 monthly rates (Sec. 2A First Schedule).
 *
 * Worked example: salary TZS 850,000
 *   tier 4 covers 760,001 – 1,000,000
 *   PAYE = 68,000 + (850,000 − 760,000) × 25%
 *        = 68,000 + 22,500
 *        = 90,500
 */
const PAYE_MAINLAND_BANDS: PayeBandSeed[] = [
  {
    tierOrder: 1,
    fromAmount: 0,
    toAmount: 270_000,
    marginalRate: 0,
    fixedAmount: 0,
    description: 'Tax-free band: up to TZS 270,000',
  },
  {
    tierOrder: 2,
    fromAmount: 270_000,
    toAmount: 520_000,
    marginalRate: 0.08,
    fixedAmount: 0,
    description: '8% on monthly income from 270,001 to 520,000',
  },
  {
    tierOrder: 3,
    fromAmount: 520_000,
    toAmount: 760_000,
    marginalRate: 0.2,
    fixedAmount: 20_000,
    description: '20,000 + 20% on excess of 520,000 (up to 760,000)',
  },
  {
    tierOrder: 4,
    fromAmount: 760_000,
    toAmount: 1_000_000,
    marginalRate: 0.25,
    fixedAmount: 68_000,
    description: '68,000 + 25% on excess of 760,000 (up to 1,000,000)',
  },
  {
    tierOrder: 5,
    fromAmount: 1_000_000,
    toAmount: null,
    marginalRate: 0.3,
    fixedAmount: 128_000,
    description: '128,000 + 30% on excess of 1,000,000',
  },
];

/**
 * PAYE Zanzibar monthly bands.
 * Source: ZRB Personal Income Tax (mirror of mainland in 2024/25 with marginal
 * adjustments — operators should verify against the latest ZRB notice).
 *
 * Currently mirrors mainland rates as a baseline. Update via supersede if ZRB
 * publishes different bands.
 */
const PAYE_ZANZIBAR_BANDS: PayeBandSeed[] = PAYE_MAINLAND_BANDS;

interface PublicHolidaySeed {
  region: HolidayRegion;
  name: string;
  date: string; // ISO date YYYY-MM-DD
  isReligious?: boolean;
  religiousDateApprox?: boolean;
  description?: string;
}

/**
 * Tanzania public holidays for calendar year 2026. Religious dates marked with
 * `religiousDateApprox` shift each year by moon sighting and must be confirmed
 * by the religious authority before the year begins.
 */
const HOLIDAYS_2026: PublicHolidaySeed[] = [
  { region: HolidayRegion.BOTH, name: "New Year's Day", date: '2026-01-01' },
  { region: HolidayRegion.ZANZIBAR, name: 'Zanzibar Revolution Day', date: '2026-01-12' },
  {
    region: HolidayRegion.BOTH,
    name: 'Eid al-Fitr (Idd el-Fitri)',
    date: '2026-03-20',
    isReligious: true,
    religiousDateApprox: true,
    description: 'Subject to moon sighting; planning date.',
  },
  { region: HolidayRegion.BOTH, name: 'Good Friday', date: '2026-04-03', isReligious: true },
  { region: HolidayRegion.BOTH, name: 'Easter Monday', date: '2026-04-06', isReligious: true },
  { region: HolidayRegion.ZANZIBAR, name: 'Karume Day', date: '2026-04-07' },
  { region: HolidayRegion.BOTH, name: 'Union Day', date: '2026-04-26' },
  { region: HolidayRegion.BOTH, name: "Workers' Day (Mei Mosi)", date: '2026-05-01' },
  {
    region: HolidayRegion.BOTH,
    name: 'Eid al-Adha (Idd el-Hajj)',
    date: '2026-05-27',
    isReligious: true,
    religiousDateApprox: true,
    description: 'Subject to moon sighting; planning date.',
  },
  { region: HolidayRegion.MAINLAND, name: 'Saba Saba (Industries Day)', date: '2026-07-07' },
  { region: HolidayRegion.MAINLAND, name: 'Nane Nane (Farmers Day)', date: '2026-08-08' },
  {
    region: HolidayRegion.BOTH,
    name: "Maulid (Prophet's Birthday)",
    date: '2026-08-25',
    isReligious: true,
    religiousDateApprox: true,
    description: 'Subject to moon sighting; planning date.',
  },
  { region: HolidayRegion.BOTH, name: 'Mwalimu Nyerere Memorial Day', date: '2026-10-14' },
  { region: HolidayRegion.BOTH, name: 'Independence and Republic Day', date: '2026-12-09' },
  { region: HolidayRegion.BOTH, name: 'Christmas Day', date: '2026-12-25', isReligious: true },
  { region: HolidayRegion.BOTH, name: 'Boxing Day', date: '2026-12-26', isReligious: true },
];

interface MinimumWageSeed {
  sectorCode: string;
  sectorName: string;
  region: HolidayRegion;
  monthlyMinimum: number;
  notes?: string;
}

/**
 * Sectoral minimum wages, Tanzania mainland. Baseline values; operators should
 * supersede when the Wages Council publishes new gazette notices.
 */
const MINIMUM_WAGES: MinimumWageSeed[] = [
  { sectorCode: 'PUBLIC_SERVICE', sectorName: 'Public service (lowest cadre)', region: HolidayRegion.MAINLAND, monthlyMinimum: 380_000 },
  { sectorCode: 'AGRICULTURE', sectorName: 'Agriculture', region: HolidayRegion.MAINLAND, monthlyMinimum: 100_000 },
  { sectorCode: 'DOMESTIC_DSM', sectorName: 'Domestic services — Dar es Salaam', region: HolidayRegion.MAINLAND, monthlyMinimum: 80_000 },
  { sectorCode: 'DOMESTIC_OTHER', sectorName: 'Domestic services — other regions', region: HolidayRegion.MAINLAND, monthlyMinimum: 60_000 },
  { sectorCode: 'MINING_LARGE', sectorName: 'Large-scale mining', region: HolidayRegion.MAINLAND, monthlyMinimum: 400_000 },
  { sectorCode: 'MINING_SMALL', sectorName: 'Small-scale mining', region: HolidayRegion.MAINLAND, monthlyMinimum: 150_000 },
  { sectorCode: 'HOTEL_TOURISM', sectorName: 'Hotel & tourism', region: HolidayRegion.MAINLAND, monthlyMinimum: 200_000 },
  { sectorCode: 'INDUSTRIAL', sectorName: 'Industrial / manufacturing', region: HolidayRegion.MAINLAND, monthlyMinimum: 220_000 },
  { sectorCode: 'TRADE_FINANCE', sectorName: 'Trade, commerce, finance, insurance', region: HolidayRegion.MAINLAND, monthlyMinimum: 220_000 },
  { sectorCode: 'TRANSPORT', sectorName: 'Transport (road/rail)', region: HolidayRegion.MAINLAND, monthlyMinimum: 200_000 },
  { sectorCode: 'COMMUNICATION', sectorName: 'Communication', region: HolidayRegion.MAINLAND, monthlyMinimum: 350_000 },
  { sectorCode: 'ENERGY', sectorName: 'Energy (electricity/gas)', region: HolidayRegion.MAINLAND, monthlyMinimum: 280_000 },
  { sectorCode: 'PETROL_STATION', sectorName: 'Petrol station attendants', region: HolidayRegion.MAINLAND, monthlyMinimum: 150_000 },
  { sectorCode: 'HEALTH_NONMED', sectorName: 'Health (non-medical staff)', region: HolidayRegion.MAINLAND, monthlyMinimum: 200_000 },
  { sectorCode: 'CONSTRUCTION', sectorName: 'Construction', region: HolidayRegion.MAINLAND, monthlyMinimum: 220_000 },
];

const REFERENCE_EFFECTIVE_FROM = new Date('2025-07-01'); // TZ fiscal year FY2025/26

export async function seedTzReferenceData(prisma: PrismaClient, adminUserId: string) {
  console.log('  ▸ Tanzania reference data...');

  // ── 1. Tax types ─────────────────────────────────────────────────────────
  const taxTypeMap = new Map<string, string>();
  for (const t of TAX_TYPES) {
    const tt = await prisma.taxType.upsert({
      where: { taxTypeCode: t.code },
      update: {
        name: t.name,
        taxCategory: t.category,
        isWithholding: t.isWithholding ?? false,
        appliesToPayroll: t.appliesToPayroll ?? false,
        appliesToSales: t.appliesToSales ?? false,
        appliesToPurchases: t.appliesToPurchases ?? false,
        description: t.description,
      },
      create: {
        taxTypeCode: t.code,
        name: t.name,
        taxCategory: t.category,
        isWithholding: t.isWithholding ?? false,
        appliesToPayroll: t.appliesToPayroll ?? false,
        appliesToSales: t.appliesToSales ?? false,
        appliesToPurchases: t.appliesToPurchases ?? false,
        description: t.description,
        status: TaxCodeStatus.ACTIVE,
      },
    });
    taxTypeMap.set(t.code, tt.id);
  }
  console.log(`      Tax types: ${taxTypeMap.size}`);

  // ── 2. PAYE rates + brackets (Mainland + Zanzibar) ──────────────────────
  const paeyDefs: { code: string; rateName: string; bands: PayeBandSeed[] }[] = [
    { code: 'PAYE_MAINLAND', rateName: 'PAYE Mainland 2025/26 (monthly)', bands: PAYE_MAINLAND_BANDS },
    { code: 'PAYE_ZANZIBAR', rateName: 'PAYE Zanzibar 2025/26 (monthly)', bands: PAYE_ZANZIBAR_BANDS },
  ];
  let paeyCount = 0;
  for (const def of paeyDefs) {
    const taxTypeId = taxTypeMap.get(def.code)!;
    // Find or create the active tiered rate for this tax type with this effectiveFrom.
    const existing = await prisma.taxRate.findFirst({
      where: { taxTypeId, calculationMethod: TaxRateCalculationMethod.TIERED, effectiveFrom: REFERENCE_EFFECTIVE_FROM },
    });
    const rate = existing
      ? await prisma.taxRate.update({
          where: { id: existing.id },
          data: { rateName: def.rateName, status: TaxRateStatus.ACTIVE },
        })
      : await prisma.taxRate.create({
          data: {
            taxTypeId,
            rateName: def.rateName,
            rate: 0, // Tiered — actual rates live on TaxRateBracket rows.
            calculationMethod: TaxRateCalculationMethod.TIERED,
            effectiveFrom: REFERENCE_EFFECTIVE_FROM,
            status: TaxRateStatus.ACTIVE,
            createdById: adminUserId,
            notes: 'Tiered PAYE bands; see TaxRateBracket.',
          },
        });
    // Replace brackets idempotently.
    await prisma.taxRateBracket.deleteMany({ where: { taxRateId: rate.id } });
    await prisma.taxRateBracket.createMany({
      data: def.bands.map((b) => ({
        taxRateId: rate.id,
        tierOrder: b.tierOrder,
        fromAmount: b.fromAmount,
        toAmount: b.toAmount,
        marginalRate: b.marginalRate,
        fixedAmount: b.fixedAmount,
        description: b.description,
      })),
    });
    paeyCount += def.bands.length;
  }
  console.log(`      PAYE brackets: ${paeyCount} (across ${paeyDefs.length} jurisdictions)`);

  // ── 3. Statutory deduction rules ────────────────────────────────────────
  const statutoryDefs = [
    {
      ruleCode: 'NSSF_PRIVATE',
      taxTypeCode: 'NSSF',
      name: 'NSSF (private sector) — 10% employee + 10% employer',
      method: StatutoryDeductionCalcMethod.PERCENTAGE_OF_GROSS,
      employeeRate: 0.1,
      employerRate: 0.1,
      notes: 'NSSF Act, Cap. 105. Mandatory for non-public-service employees.',
    },
    {
      ruleCode: 'PSSSF_PUBLIC',
      taxTypeCode: 'PSSSF',
      name: 'PSSSF (public sector) — 10% employee + 10% employer',
      method: StatutoryDeductionCalcMethod.PERCENTAGE_OF_GROSS,
      employeeRate: 0.1,
      employerRate: 0.1,
      notes: 'PSSSF Act, 2018. Mandatory for public-service employees.',
    },
    {
      ruleCode: 'WCF_PRIVATE',
      taxTypeCode: 'WCF',
      name: 'WCF — 0.5% employer-only (private sector)',
      method: StatutoryDeductionCalcMethod.PERCENTAGE_OF_GROSS,
      employeeRate: 0,
      employerRate: 0.005,
      notes: 'Workers Compensation Act, 2008. Private-sector employer-only contribution.',
    },
    {
      ruleCode: 'WCF_PUBLIC',
      taxTypeCode: 'WCF',
      name: 'WCF — 1.0% employer-only (public sector)',
      method: StatutoryDeductionCalcMethod.PERCENTAGE_OF_GROSS,
      employeeRate: 0,
      employerRate: 0.01,
      notes: 'Workers Compensation Act, 2008. Public-sector employer-only contribution.',
    },
    {
      ruleCode: 'SDL',
      taxTypeCode: 'SDL',
      name: 'SDL — 3.5% employer-only',
      method: StatutoryDeductionCalcMethod.PERCENTAGE_OF_GROSS,
      employeeRate: 0,
      employerRate: 0.035,
      notes:
        'Skills Development Levy. Payable by employers with 10+ employees. Remitted with PAYE.',
    },
    {
      ruleCode: 'NHIF_DEFAULT',
      taxTypeCode: 'NHIF',
      name: 'NHIF — placeholder 3% employee (revise per scheme)',
      method: StatutoryDeductionCalcMethod.PERCENTAGE_OF_GROSS,
      employeeRate: 0.03,
      employerRate: 0,
      notes:
        'Placeholder. Universal Health Insurance Act, 2023; final rates depend on enrolled scheme. Adjust per company.',
    },
    {
      ruleCode: 'HESLB',
      taxTypeCode: 'HESLB',
      name: 'HESLB — 15% of basic salary (active borrowers)',
      method: StatutoryDeductionCalcMethod.PERCENTAGE_OF_BASIC,
      employeeRate: 0.15,
      employerRate: 0,
      notes:
        'Higher Education Students Loans Board. Applied only to employees flagged as active borrowers.',
    },
  ];
  for (const r of statutoryDefs) {
    const taxTypeId = taxTypeMap.get(r.taxTypeCode)!;
    await prisma.statutoryDeductionRule.upsert({
      where: { ruleCode: r.ruleCode },
      update: {
        taxTypeId,
        name: r.name,
        calculationMethod: r.method,
        employeeContributionRate: r.employeeRate,
        employerContributionRate: r.employerRate,
        notes: r.notes,
        status: StatutoryDeductionStatus.ACTIVE,
      },
      create: {
        ruleCode: r.ruleCode,
        taxTypeId,
        name: r.name,
        calculationMethod: r.method,
        rate: r.employeeRate + r.employerRate,
        employeeContributionRate: r.employeeRate,
        employerContributionRate: r.employerRate,
        effectiveFrom: REFERENCE_EFFECTIVE_FROM,
        status: StatutoryDeductionStatus.ACTIVE,
        notes: r.notes,
      },
    });
  }
  console.log(`      Statutory deduction rules: ${statutoryDefs.length}`);

  // ── 4. Public holidays (2026) ───────────────────────────────────────────
  for (const h of HOLIDAYS_2026) {
    await prisma.publicHoliday.upsert({
      where: { region_date_name: { region: h.region, date: new Date(h.date), name: h.name } },
      update: {
        isReligious: h.isReligious ?? false,
        religiousDateApprox: h.religiousDateApprox ?? false,
        description: h.description,
        recurring: true,
      },
      create: {
        region: h.region,
        name: h.name,
        date: new Date(h.date),
        isReligious: h.isReligious ?? false,
        religiousDateApprox: h.religiousDateApprox ?? false,
        recurring: true,
        description: h.description,
      },
    });
  }
  console.log(`      Public holidays (2026): ${HOLIDAYS_2026.length}`);

  // ── 5. Sectoral minimum wages ───────────────────────────────────────────
  for (const m of MINIMUM_WAGES) {
    await prisma.minimumWageRule.upsert({
      where: {
        sectorCode_region_effectiveFrom: {
          sectorCode: m.sectorCode,
          region: m.region,
          effectiveFrom: REFERENCE_EFFECTIVE_FROM,
        },
      },
      update: {
        sectorName: m.sectorName,
        monthlyMinimum: m.monthlyMinimum,
        notes: m.notes,
        status: MinimumWageStatus.ACTIVE,
      },
      create: {
        sectorCode: m.sectorCode,
        sectorName: m.sectorName,
        region: m.region,
        monthlyMinimum: m.monthlyMinimum,
        currency: CurrencyCode.TZS,
        effectiveFrom: REFERENCE_EFFECTIVE_FROM,
        status: MinimumWageStatus.ACTIVE,
        notes: m.notes,
      },
    });
  }
  console.log(`      Minimum wage rules: ${MINIMUM_WAGES.length}`);

  console.log('  ✓ Tanzania reference data seeded.\n');
}
