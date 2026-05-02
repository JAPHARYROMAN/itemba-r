/**
 * Tanzania tax library — extensions for the transactional + corporate-income
 * tax surface. Sprint C1.
 *
 * What this seed adds, on top of `tz-reference.ts` (payroll: PAYE Mainland +
 * Zanzibar bands, NSSF, PSSSF, WCF, SDL, NHIF, HESLB) and `seedM10` (TRA /
 * BRELA / DCC / NSSF / NHIF authorities + VAT-18 / WHT-5 / WHT-10 types):
 *
 *   1. Authorities the existing seed missed: PSSSF, WCF, HESLB.
 *   2. Tax types the existing seed missed:
 *        - WHT-15 (non-resident technical/management/royalties)
 *        - WHT-2  (goods supply to corporate buyers)
 *        - WHT-RENT-10 (rent paid to residents)
 *        - WHT-RENT-15 (rent paid to non-residents)
 *        - WHT-DIVIDEND-5  (dividends to resident shareholders)
 *        - WHT-DIVIDEND-10 (dividends to non-residents)
 *        - WHT-INTEREST-10 (interest to residents)
 *        - VAT-0 (zero-rated supplies — exports)
 *        - VAT-EXEMPT (exempt supplies — financial services, education, etc.)
 *        - CST (City Service Levy — 0.3% of turnover, local government)
 *        - CIT-30 (Corporate Income Tax — standard 30%)
 *        - CIT-25-LISTED (newly listed companies — 25% for 3 years)
 *        - PIT-PROVISIONAL (quarterly provisional income tax)
 *   3. TaxRate rows for each new type, effective FY2025/26.
 *   4. Tax codes operators select on transactions (OUT-VAT-0, IN-WHT-2, etc.).
 *
 * Idempotent — every row is upserted by its natural key. Safe to re-run.
 *
 * NOTE: rates here are FY2025/26 baselines. When the Finance Act updates
 * rates, supersede with new TaxRate rows (effectiveFrom = gazette date), do
 * NOT mutate these. Effective-dated resolution in TaxCalculatorService picks
 * the latest applicable row automatically.
 */
import {
  PrismaClient,
  TaxAuthorityType,
  TaxAuthorityStatus,
  TaxCategory,
  TaxRateCalculationMethod,
  TaxRateStatus,
  TaxCodeStatus,
  TaxCodeAppliesTo,
} from '../../backend/node_modules/@prisma/client';

const EFFECTIVE_FROM = new Date('2025-07-01'); // TZ FY2025/26

// ── Authorities ──────────────────────────────────────────────────────────────
interface AuthoritySeed {
  authorityCode: string;
  name: string;
  authorityType: TaxAuthorityType;
  website?: string;
  contactEmail?: string;
}

const EXTRA_AUTHORITIES: AuthoritySeed[] = [
  {
    authorityCode: 'PSSSF-TZ',
    name: 'Public Service Social Security Fund',
    authorityType: TaxAuthorityType.SOCIAL_SECURITY,
    website: 'https://www.psssf.go.tz',
  },
  {
    authorityCode: 'WCF-TZ',
    name: 'Workers Compensation Fund',
    authorityType: TaxAuthorityType.SOCIAL_SECURITY,
    website: 'https://www.wcf.go.tz',
  },
  {
    authorityCode: 'HESLB-TZ',
    name: 'Higher Education Students Loans Board',
    authorityType: TaxAuthorityType.OTHER,
    website: 'https://www.heslb.go.tz',
  },
];

// ── Tax types ────────────────────────────────────────────────────────────────
interface TaxTypeSeed {
  code: string;
  name: string;
  category: TaxCategory;
  isWithholding?: boolean;
  isRecoverable?: boolean;
  appliesToSales?: boolean;
  appliesToPurchases?: boolean;
  appliesToExpenses?: boolean;
  description: string;
}

const EXTRA_TAX_TYPES: TaxTypeSeed[] = [
  // ── WHT variants the existing seed didn't cover.
  {
    code: 'WHT-15',
    name: 'Withholding Tax — 15% (non-resident services)',
    category: TaxCategory.WITHHOLDING_TAX,
    isWithholding: true,
    appliesToPurchases: true,
    appliesToExpenses: true,
    description:
      'WHT 15% on technical/management/professional services + royalties paid to non-residents. ITA 2004 s. 83.',
  },
  {
    code: 'WHT-2',
    name: 'Withholding Tax — 2% (goods supply to corporates)',
    category: TaxCategory.WITHHOLDING_TAX,
    isWithholding: true,
    appliesToPurchases: true,
    description:
      'WHT 2% on supply of goods to a corporation by a resident. ITA 2004 s. 83A.',
  },
  {
    code: 'WHT-RENT-10',
    name: 'Withholding Tax — 10% (rent, resident landlord)',
    category: TaxCategory.WITHHOLDING_TAX,
    isWithholding: true,
    appliesToPurchases: true,
    appliesToExpenses: true,
    description: 'WHT 10% on rent paid to a resident landlord. ITA 2004 s. 82.',
  },
  {
    code: 'WHT-RENT-15',
    name: 'Withholding Tax — 15% (rent, non-resident landlord)',
    category: TaxCategory.WITHHOLDING_TAX,
    isWithholding: true,
    appliesToPurchases: true,
    appliesToExpenses: true,
    description: 'WHT 15% on rent paid to a non-resident landlord. ITA 2004 s. 82.',
  },
  {
    code: 'WHT-DIVIDEND-5',
    name: 'Withholding Tax — 5% (dividend, resident shareholder of listed co.)',
    category: TaxCategory.WITHHOLDING_TAX,
    isWithholding: true,
    description: 'WHT 5% on dividends from DSE-listed companies to residents. ITA 2004 s. 81.',
  },
  {
    code: 'WHT-DIVIDEND-10',
    name: 'Withholding Tax — 10% (dividend, other)',
    category: TaxCategory.WITHHOLDING_TAX,
    isWithholding: true,
    description: 'WHT 10% on dividends from non-listed resident companies, or to non-residents. ITA 2004 s. 81.',
  },
  {
    code: 'WHT-INTEREST-10',
    name: 'Withholding Tax — 10% (interest)',
    category: TaxCategory.WITHHOLDING_TAX,
    isWithholding: true,
    description: 'WHT 10% on interest paid by a resident to a resident or non-resident. ITA 2004 s. 82.',
  },

  // ── VAT companions: zero-rated and exempt.
  {
    code: 'VAT-0',
    name: 'VAT — Zero-rated (0%)',
    category: TaxCategory.VAT,
    isRecoverable: true,
    appliesToSales: true,
    appliesToPurchases: true,
    description:
      'Zero-rated supplies — exports of goods/services, supplies to embassies. Input VAT remains recoverable.',
  },
  {
    code: 'VAT-EXEMPT',
    name: 'VAT — Exempt (no VAT, no input recovery)',
    category: TaxCategory.VAT,
    isRecoverable: false,
    appliesToSales: true,
    appliesToPurchases: true,
    description:
      'Exempt supplies — financial services, education, residential rent, basic foodstuffs. Input VAT not recoverable.',
  },

  // ── Local-government and corporate-income.
  {
    code: 'CST',
    name: 'City Service Levy (0.3% of turnover)',
    category: TaxCategory.SERVICE_LEVY,
    appliesToSales: true,
    description:
      '0.3% on turnover, levied by local government on businesses with annual turnover > TZS 4M. Local Government Finance Act, 1982.',
  },
  {
    code: 'CIT-30',
    name: 'Corporate Income Tax (30% standard)',
    category: TaxCategory.INCOME_TAX,
    description:
      'Standard corporate income tax — 30% of chargeable income. Annual return Form ITX 200. ITA 2004 First Schedule.',
  },
  {
    code: 'CIT-25-LISTED',
    name: 'Corporate Income Tax — 25% (newly listed)',
    category: TaxCategory.INCOME_TAX,
    description:
      'Reduced rate for companies newly listed on DSE — 25% for the first 3 years. Conditional on 30%+ public float.',
  },
  {
    code: 'PIT-PROVISIONAL',
    name: 'Provisional Income Tax (quarterly)',
    category: TaxCategory.INCOME_TAX,
    description:
      'Quarterly provisional ITX instalments based on estimated annual taxable income. ITA 2004 s. 88.',
  },
];

// ── Tax rates (one current row per type) ─────────────────────────────────────
interface TaxRateSeed {
  taxTypeCode: string;
  rateName: string;
  rate: number;
  method?: TaxRateCalculationMethod;
  notes?: string;
}

const EXTRA_TAX_RATES: TaxRateSeed[] = [
  { taxTypeCode: 'WHT-15', rateName: 'WHT 15% non-resident services 2025/26', rate: 15 },
  { taxTypeCode: 'WHT-2', rateName: 'WHT 2% goods supply 2025/26', rate: 2 },
  { taxTypeCode: 'WHT-RENT-10', rateName: 'WHT 10% rent (resident) 2025/26', rate: 10 },
  { taxTypeCode: 'WHT-RENT-15', rateName: 'WHT 15% rent (non-resident) 2025/26', rate: 15 },
  { taxTypeCode: 'WHT-DIVIDEND-5', rateName: 'WHT 5% listed dividend 2025/26', rate: 5 },
  { taxTypeCode: 'WHT-DIVIDEND-10', rateName: 'WHT 10% other dividend 2025/26', rate: 10 },
  { taxTypeCode: 'WHT-INTEREST-10', rateName: 'WHT 10% interest 2025/26', rate: 10 },
  {
    taxTypeCode: 'VAT-0',
    rateName: 'VAT 0% (zero-rated) 2025/26',
    rate: 0,
    method: TaxRateCalculationMethod.ZERO_RATED,
  },
  {
    taxTypeCode: 'VAT-EXEMPT',
    rateName: 'VAT exempt 2025/26',
    rate: 0,
    method: TaxRateCalculationMethod.EXEMPT,
  },
  { taxTypeCode: 'CST', rateName: 'City Service Levy 0.3% 2025/26', rate: 0.3 },
  { taxTypeCode: 'CIT-30', rateName: 'CIT standard 30% 2025/26', rate: 30 },
  { taxTypeCode: 'CIT-25-LISTED', rateName: 'CIT listed 25% 2025/26', rate: 25 },
  {
    taxTypeCode: 'PIT-PROVISIONAL',
    rateName: 'Provisional ITX (rate per quarter share) 2025/26',
    rate: 0,
    method: TaxRateCalculationMethod.FIXED_AMOUNT,
    notes:
      'Provisional ITX is computed from estimated annual chargeable income — this row is a placeholder so rate-resolution can find a matching record. The engine resolves the actual quarterly amount per company.',
  },
];

// ── Tax codes operators select on transactions ───────────────────────────────
interface TaxCodeSeed {
  taxCode: string;
  taxTypeCode: string;
  rateName: string; // links to a specific TaxRate
  name: string;
  appliesTo: TaxCodeAppliesTo;
  isDefault?: boolean;
}

const EXTRA_TAX_CODES: TaxCodeSeed[] = [
  // VAT companions
  { taxCode: 'OUT-VAT-0', taxTypeCode: 'VAT-0', rateName: 'VAT 0% (zero-rated) 2025/26', name: 'Output VAT 0% (export)', appliesTo: TaxCodeAppliesTo.SALES },
  { taxCode: 'IN-VAT-0', taxTypeCode: 'VAT-0', rateName: 'VAT 0% (zero-rated) 2025/26', name: 'Input VAT 0%', appliesTo: TaxCodeAppliesTo.PURCHASES },
  { taxCode: 'OUT-VAT-EX', taxTypeCode: 'VAT-EXEMPT', rateName: 'VAT exempt 2025/26', name: 'Output VAT exempt', appliesTo: TaxCodeAppliesTo.SALES },
  { taxCode: 'IN-VAT-EX', taxTypeCode: 'VAT-EXEMPT', rateName: 'VAT exempt 2025/26', name: 'Input VAT exempt', appliesTo: TaxCodeAppliesTo.PURCHASES },

  // WHT codes (typically applied on supplier-side / payable lines)
  { taxCode: 'WHT-2-GOODS', taxTypeCode: 'WHT-2', rateName: 'WHT 2% goods supply 2025/26', name: 'WHT 2% on goods supply (resident corp)', appliesTo: TaxCodeAppliesTo.PURCHASES },
  { taxCode: 'WHT-15-NRES', taxTypeCode: 'WHT-15', rateName: 'WHT 15% non-resident services 2025/26', name: 'WHT 15% non-resident services', appliesTo: TaxCodeAppliesTo.PURCHASES },
  { taxCode: 'WHT-RENT-10', taxTypeCode: 'WHT-RENT-10', rateName: 'WHT 10% rent (resident) 2025/26', name: 'WHT 10% rent (resident landlord)', appliesTo: TaxCodeAppliesTo.EXPENSES },
  { taxCode: 'WHT-RENT-15', taxTypeCode: 'WHT-RENT-15', rateName: 'WHT 15% rent (non-resident) 2025/26', name: 'WHT 15% rent (non-resident landlord)', appliesTo: TaxCodeAppliesTo.EXPENSES },
  { taxCode: 'WHT-DIV-5', taxTypeCode: 'WHT-DIVIDEND-5', rateName: 'WHT 5% listed dividend 2025/26', name: 'WHT 5% dividend (listed → resident)', appliesTo: TaxCodeAppliesTo.GENERAL },
  { taxCode: 'WHT-DIV-10', taxTypeCode: 'WHT-DIVIDEND-10', rateName: 'WHT 10% other dividend 2025/26', name: 'WHT 10% dividend (other)', appliesTo: TaxCodeAppliesTo.GENERAL },
  { taxCode: 'WHT-INT-10', taxTypeCode: 'WHT-INTEREST-10', rateName: 'WHT 10% interest 2025/26', name: 'WHT 10% interest', appliesTo: TaxCodeAppliesTo.GENERAL },

  // City Service Levy (output-side)
  { taxCode: 'CST-03', taxTypeCode: 'CST', rateName: 'City Service Levy 0.3% 2025/26', name: 'City Service Levy 0.3% turnover', appliesTo: TaxCodeAppliesTo.SALES },
];

export async function seedC1TaxExtensions(prisma: PrismaClient, adminUserId: string) {
  console.log('  ▸ C1 — TZ tax library extensions...');

  // 1. Authorities (additive — existing M10 entries untouched).
  for (const a of EXTRA_AUTHORITIES) {
    await prisma.taxAuthority.upsert({
      where: { authorityCode: a.authorityCode },
      update: { name: a.name, authorityType: a.authorityType, website: a.website },
      create: {
        authorityCode: a.authorityCode,
        name: a.name,
        country: 'Tanzania',
        region: 'National',
        authorityType: a.authorityType,
        website: a.website,
        contactEmail: a.contactEmail,
        status: TaxAuthorityStatus.ACTIVE,
      },
    });
  }
  console.log(`      Authorities (extras): ${EXTRA_AUTHORITIES.length}`);

  // 2. Tax types.
  const taxTypeMap = new Map<string, string>();
  for (const t of EXTRA_TAX_TYPES) {
    const tt = await prisma.taxType.upsert({
      where: { taxTypeCode: t.code },
      update: {
        name: t.name,
        taxCategory: t.category,
        isWithholding: t.isWithholding ?? false,
        isRecoverable: t.isRecoverable ?? false,
        appliesToSales: t.appliesToSales ?? false,
        appliesToPurchases: t.appliesToPurchases ?? false,
        appliesToExpenses: t.appliesToExpenses ?? false,
        description: t.description,
      },
      create: {
        taxTypeCode: t.code,
        name: t.name,
        taxCategory: t.category,
        isWithholding: t.isWithholding ?? false,
        isRecoverable: t.isRecoverable ?? false,
        appliesToSales: t.appliesToSales ?? false,
        appliesToPurchases: t.appliesToPurchases ?? false,
        appliesToExpenses: t.appliesToExpenses ?? false,
        description: t.description,
        status: TaxCodeStatus.ACTIVE,
      },
    });
    taxTypeMap.set(t.code, tt.id);
  }
  console.log(`      Tax types (extras): ${taxTypeMap.size}`);

  // 3. Tax rates.
  const rateMap = new Map<string, string>(); // rateName → id, for code linking below
  for (const r of EXTRA_TAX_RATES) {
    const taxTypeId = taxTypeMap.get(r.taxTypeCode);
    if (!taxTypeId) continue;
    const existing = await prisma.taxRate.findFirst({
      where: { taxTypeId, rateName: r.rateName, deletedAt: null },
    });
    const rate = existing
      ? await prisma.taxRate.update({
          where: { id: existing.id },
          data: { rate: r.rate, status: TaxRateStatus.ACTIVE, notes: r.notes },
        })
      : await prisma.taxRate.create({
          data: {
            taxTypeId,
            rateName: r.rateName,
            rate: r.rate,
            calculationMethod: r.method ?? TaxRateCalculationMethod.PERCENTAGE,
            effectiveFrom: EFFECTIVE_FROM,
            status: TaxRateStatus.ACTIVE,
            createdById: adminUserId,
            approvedById: adminUserId,
            approvedAt: EFFECTIVE_FROM,
            notes: r.notes,
          },
        });
    rateMap.set(r.rateName, rate.id);
  }
  console.log(`      Tax rates (extras): ${rateMap.size}`);

  // 4. Tax codes.
  let codeCount = 0;
  for (const c of EXTRA_TAX_CODES) {
    const taxTypeId = taxTypeMap.get(c.taxTypeCode);
    const taxRateId = rateMap.get(c.rateName);
    if (!taxTypeId || !taxRateId) continue;

    // companyId is null for group-wide codes; the unique key is (taxCode, companyId).
    const existing = await prisma.taxCode.findFirst({
      where: { taxCode: c.taxCode, companyId: null, deletedAt: null },
    });
    if (existing) {
      await prisma.taxCode.update({
        where: { id: existing.id },
        data: {
          taxTypeId,
          taxRateId,
          name: c.name,
          appliesTo: c.appliesTo,
          isDefault: c.isDefault ?? false,
        },
      });
    } else {
      await prisma.taxCode.create({
        data: {
          taxCode: c.taxCode,
          taxTypeId,
          taxRateId,
          name: c.name,
          appliesTo: c.appliesTo,
          isDefault: c.isDefault ?? false,
          status: TaxCodeStatus.ACTIVE,
        },
      });
    }
    codeCount += 1;
  }
  console.log(`      Tax codes (extras): ${codeCount}`);

  console.log('  ✓ C1 tax extensions seeded.\n');
}
