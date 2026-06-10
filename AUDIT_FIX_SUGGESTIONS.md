# ITEMBA-R — Audit Fix Suggestions

**Companion to:** AUDIT_FINDINGS.md
**Date:** 2026-05-30

Every fix below is designed to be **minimal and production-safe** (narrowing/additive — they add missing access checks, validation, transactions, or token expiry rather than changing established behaviour). IDs match AUDIT_FINDINGS.md.

## Remediation strategy & roll-out order

1. **Critical & high IDOR / cross-tenant write (do first).** Add `CompanyScopeService` to every flagged service: thread the authenticated `AuthUser` from the controller into `findOne` and all id-based mutations, and call `assertCanAccessCompany(user, record.companyId[, WRITE])` after loading. These are *narrowing-only*: legitimate same-company access is unchanged; only cross-company access (which should never have worked) starts being rejected.
2. **Privilege-escalation & mass-assignment.** Add authority checks to role create/update; remove server-controlled fields (`approvedById`, `createdById`, `companyId`, monetary totals, `paymentStatus`, `status`) from create DTOs and derive them server-side; replace untyped `@Body() dto: any` with validated DTOs.
3. **Token longevity.** Give access tokens an explicit short TTL; rotate refresh tokens even for long-lived sessions.
4. **Atomicity & arithmetic.** Wrap multi-write business operations in `prisma.$transaction`; use atomic `{ increment }`/unique constraints for counters and balances; recompute monetary totals server-side.
5. **Reliability / contracts / schema.** Apply the targeted fixes per finding.

## A reusable pattern for the IDOR fixes

Most isolation findings share one remedy. The canonical shape (already used correctly in `customer-statements.service.ts`):

```ts
// service
constructor(private readonly companyScope: CompanyScopeService, /* ... */) {}

async findOne(id: string, user: AuthUser) {
  const item = await this.prisma.<model>.findFirst({ where: { id, deletedAt: null } });
  if (!item) throw new NotFoundException();
  await this.companyScope.assertCanAccessCompany(user, item.companyId); // WRITE for mutations
  return item;
}

// every id-based mutation calls findOne(id, user) BEFORE mutating
// controller passes @CurrentUser() user into findOne and each mutation handler
```

## Fixes by finding


### CRITICAL severity

#### ITMB-001 — Intercompany transactions service has zero company-scoping: cross-company read, write, and GL posting

- **Location:** `backend/src/modules/intercompany-transactions/intercompany-transactions.service.ts:29`  •  **Severity:** critical  •  **Confidence:** high

Inject CompanyScopeService and pass the full AuthUser from the controller to every method. In findAll, accept the user and constrain results to accessible companies (e.g. where.OR = [{ fromCompanyId: { in: accessibleIds } }, { toCompanyId: { in: accessibleIds } }] using the same accessible-company resolution that companyWhereFor uses; group admins keep full access). When an explicit from/toCompanyId filter is supplied, assertCanAccessCompany on it. In findOne, after loading, assert the caller can access at least one side (fromCompanyId OR toCompanyId). In create/update assert WRITE access to BOTH fromCompanyId and toCompanyId; in post assert WRITE/MANAGE access to BOTH companies before resolving accounts and posting. Mirror the correct pattern already used in customer-statements.service / supplier-statements.service.

---

#### ITMB-002 — Restaurant order subtotal, taxAmount, totalAmount, paidAmount/outstanding and paymentStatus are accepted from the client and stored with no server-side computation

- **Location:** `backend/src/modules/restaurant-orders/restaurant-orders.service.ts:14`  •  **Severity:** critical  •  **Confidence:** high

Remove subtotal/taxAmount/totalAmount/paidAmount/outstandingAmount/lineTotal from the create/update DTOs and compute them server-side: load each menuItem price, lineTotal = qty*price, subtotal = sum, tax from the configured rate, totalAmount = subtotal+tax; derive paymentStatus from recorded payments. Type the lines array with @ValidateNested + @Type so unknown fields are stripped.

---

#### ITMB-003 — Sales order line tax, discount and totals are taken verbatim from the client and persisted with no server-side recomputation (VAT under-reporting / receivable manipulation)

- **Location:** `backend/src/modules/sales-orders/sales-orders.service.ts:45`  •  **Severity:** critical  •  **Confidence:** high

Compute tax server-side from the product/tax configuration during create() and update() and ignore client-supplied taxAmount; validate discountAmount against a max-discount policy and clamp to 0..(qty*unitPrice). Persist only server-computed taxAmount/discountAmount/lineTotal/subtotal/totalAmount. Have TaxAutoApply derive tax from the authoritative rate rather than mirroring the stored value.

---


### HIGH severity

#### ITMB-004 — Audit-adjustment posting uses JS float math with a 0.01 tolerance, allowing an unbalanced journal entry to be posted to the ledger

- **Location:** `backend/src/modules/audit-adjustments/audit-adjustments.service.ts:157`  •  **Severity:** high  •  **Confidence:** high

Replace the float tolerance with the strict integer-cent check used by JournalEntriesService.validateLines: convert each line via Math.round((line.debit ?? 0) * 100) / Math.round((line.credit ?? 0) * 100), require the integer-cent debit sum to equal the integer-cent credit sum EXACTLY (drop the 0.01 tolerance), reject negative amounts, and derive the persisted totalDebit/totalCredit from those cents (cents/100). Apply the same to create() (lines 38-40). Keep the existing $transaction; just swap the validation/total derivation so this path matches the rest of the GL.

---

#### ITMB-005 — Access tokens are minted with no exp claim (JWT_ACCESS_EXPIRES_IN defaults to 'never', and production sets 'never') — a leaked access token is valid until the bound ActiveSession is manually revoked

- **Location:** `backend/src/modules/auth/auth.module.ts:42`  •  **Severity:** high  •  **Confidence:** high

Always set a short, explicit access-token TTL independent of the refresh/session policy. Pass an explicit expiresIn (e.g. '15m') on the access-token signAsync calls in auth.service.ts (the issueTokens sign at line 509 and the persistent-refresh re-sign at lines 407-411), or change auth.module.ts to default JWT_ACCESS_EXPIRES_IN to '15m' AND reject 'never' specifically for the access token. Set JWT_ACCESS_EXPIRES_IN=15m in the production/staging env to take effect on the live system. Keep long-lived sessions via the refresh token if desired; the access token must always carry exp. Verify the frontend silent-refresh timer (already 14m per docs/audit-report-2026-05-01.md H-27) matches the new TTL before deploying.

---

#### ITMB-006 — Persistent refresh tokens are never rotated and reuse detection is disabled by default — refresh-token theft is undetectable

- **Location:** `backend/src/modules/auth/auth.service.ts:333`  •  **Severity:** high  •  **Confidence:** high

Decouple 'long-lived' from 'non-rotating'. Rotate the refresh token on every successful refresh even for long-lived sessions: in the persistentRefresh branch (auth.service.ts:406-412) issue a NEW refresh token (route through issueTokens with the existing familyId/sid instead of returning rawToken), mark the consumed row revokedReason='ROTATION', and keep reuse detection active by treating a non-ROTATION revoked token as replay regardless of persistence. A long expiry is acceptable; never returning a new token and never detecting replay is the hole. Roll out carefully: ensure the rotation grace window (REFRESH_TOKEN_ROTATION_GRACE_MS, line 68) covers concurrent in-flight refreshes so legitimate parallel requests are not logged out.

---

#### ITMB-007 — List query DTOs (e.g. chart-of-accounts) lack @Max on limit/page; value forwarded straight to Prisma take with relation includes

- **Location:** `backend/src/modules/chart-of-accounts/dto/query-chart-of-account.dto.ts:13`  •  **Severity:** high  •  **Confidence:** high

Add `@Max(100)` (or `@Max(200)` to match the existing helper) to the `limit` field of chart-of-accounts and other uncapped query DTOs, OR have the services run page/limit through the existing `pagination({ page, limit, maxLimit: 100 })` helper before using `take`. Safe to apply: clamping only reduces oversized requests; well-behaved clients (default limit=20) are unaffected. Optionally add a lint rule forbidding a `limit` DTO field without `@Max` and `take: limit` without a clamp.

---

#### ITMB-008 — Construction labour reclass allocates the employee's ENTIRE gross to projects even for partial project time

- **Location:** `backend/src/modules/construction-labour-cost/construction-labour-cost.service.ts:109`  •  **Severity:** high  •  **Confidence:** high

Divide project overlap days by the employee's total available/paid days for the period (standard working days or actual attendance days), not by the sum of project-only days, so non-project time stays in general salaries: allocate grossPlusEr * (projectDays / totalAvailableDays).

---

#### ITMB-009 — Depreciation schedule findOne has no company-scope check (IDOR)

- **Location:** `backend/src/modules/depreciation/depreciation.service.ts:54`  •  **Severity:** high  •  **Confidence:** high

Add an AuthUser parameter to findOne and assert this.companyScope.assertCanAccessCompany(user, item.companyId) (with WRITE for the addEntry/generateEntries callers) before returning; inject CompanyScopeService; have the controller pass @CurrentUser() user.

---

#### ITMB-010 — Depreciation create/addEntry/generateEntries/postEntry never verify caller access to the target company

- **Location:** `backend/src/modules/depreciation/depreciation.service.ts:62`  •  **Severity:** high  •  **Confidence:** high

Inject CompanyScopeService. In create, assert assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE) and stop spreading untrusted ...dto for scope fields (set companyId/fixedAssetId explicitly). In addEntry/generateEntries, route through a findOne that asserts WRITE access to the schedule's companyId. In postEntry, after loading the entry, assert WRITE/MANAGE access to entry.depreciationSchedule.companyId before resolving accounts and posting.

---

#### ITMB-011 — Financial statement run findOne has no company-scope check (IDOR exposing another company's trial balance)

- **Location:** `backend/src/modules/financial-statements/financial-statements.service.ts:25`  •  **Severity:** high  •  **Confidence:** high

Change findOne(id) to findOne(id, user: AuthUser): load the run, then await this.companyScope.assertCanAccessCompany(user, item.companyId) before returning (inject CompanyScopeService, mirroring customer-statements.service.ts findOne). Update the controller to pass @CurrentUser() user. Guard against item.companyId being null for legacy group-level runs.

---

#### ITMB-012 — Financial statement generation does not verify access to the requested company

- **Location:** `backend/src/modules/financial-statements/financial-statements.service.ts:31`  •  **Severity:** high  •  **Confidence:** high

Inject CompanyScopeService and add await this.companyScope.assertCanAccessCompany(user, companyId, AccessLevel.WRITE) as the first statement in generate, rejecting requests with no companyId for non-group users (mirror customer-statements.service.ts:44).

---

#### ITMB-013 — Fixed-asset disposal posts no journal entry (asset cost & accumulated depreciation never removed; proceeds/gain-loss unrecorded)

- **Location:** `backend/src/modules/fixed-assets/fixed-assets.service.ts:236`  •  **Severity:** high  •  **Confidence:** high

Inside a $transaction in dispose(), resolve FIXED_ASSET, ACCUMULATED_DEPRECIATION, a Cash/Bank or AR account (per disposal type), and a Gain/Loss-on-Disposal account; post a balanced entry: DR Accumulated Depreciation (to-date) + DR Cash/AR (proceeds = dto.disposalValue) + DR/CR Gain or Loss for the residual, CR Fixed Asset (original acquisitionCost). Persist the resulting journalEntryId on the asset, mirroring capitalize() (lines 305-326). Guard against double-posting by checking for an existing disposal JE as capitalize() does at lines 273-283.

---

#### ITMB-014 — IDOR + cross-company list leakage: Fuel Credit Sales not company-scoped

- **Location:** `backend/src/modules/fuel-credit-sales/fuel-credit-sales.service.ts:91`  •  **Severity:** high  •  **Confidence:** high

Inject CompanyScopeService, thread AuthUser into findAll, and replace `if (query.companyId) where.companyId = query.companyId` with merging await this.companyScope.companyWhereFor(user, query.companyId) into where. In findOne and every id-based mutation, after fetching the record add await this.companyScope.assertCanAccessCompany(user, record.companyId) before any write or audit log. Mirror the already-scoped fuel-shifts pattern. Narrowing-only.

---

#### ITMB-015 — Fuel credit sale persists without its Receivable when A/R creation fails — bare catch swallows every error with no log and no transaction

- **Location:** `backend/src/modules/fuel-credit-sales/fuel-credit-sales.service.ts:67`  •  **Severity:** high  •  **Confidence:** high

Wrap the FuelCreditSale create + Receivable create + back-link update in a single prisma.$transaction so they commit or roll back together (the entity-code-generator calls can be hoisted before the transaction). If decoupling is genuinely required for resilience, at minimum log at error level inside the catch (this.logger.error with sale.id) and leave receivableId null so a reconciliation job can find and repair sales missing their A/R. Do not swallow silently.

---

#### ITMB-016 — Fuel daily reconciliation number uses a GLOBAL count()+1 -> P2002 crash on concurrent close (@@unique([companyId, reconciliationNumber]))

- **Location:** `backend/src/modules/fuel-daily-reconciliation/fuel-daily-reconciliation.service.ts:32`  •  **Severity:** high  •  **Confidence:** high

Scope by company and make number+create atomic: move a companyId+year-scoped count and the create into one $transaction with a single P2002 retry, preserving the 'RECON-' prefix. Do NOT blindly use codes.next -- there is no Reconciliation/FuelDailyReconciliation key in DEFAULT_PATTERNS so fallbackPattern would change the prefix; if migrating, add a default with prefix 'RECON-{YYYY}-' first.

---

#### ITMB-017 — IDOR: Fuel Nozzle Readings findOne/update not company-scoped (list IS scoped)

- **Location:** `backend/src/modules/fuel-nozzle-readings/fuel-nozzle-readings.service.ts:55`  •  **Severity:** high  •  **Confidence:** high

Inject CompanyScopeService and add an AuthUser parameter to findOne; after fetching call await this.companyScope.assertCanAccessCompany(user, record.companyId). Have update call findOne(id, user) so the assertion runs before mutation, and pass @CurrentUser() from the controller's findOne/update handlers. Narrowing-only.

---

#### ITMB-018 — IDOR + cross-company list leakage: Fuel Tank Dips not company-scoped (post() also mutates another company's tank + inventory)

- **Location:** `backend/src/modules/fuel-tank-dips/fuel-tank-dips.service.ts:25`  •  **Severity:** high  •  **Confidence:** high

Inject CompanyScopeService, thread AuthUser through findAll/findOne and the lifecycle methods. In findAll merge await this.companyScope.companyWhereFor(user, query.companyId) into where instead of the bare companyId assignment. In findOne (and therefore all mutations) add await this.companyScope.assertCanAccessCompany(user, record.companyId) after fetch; in create assert access to dto.companyId. Narrowing-only.

---

#### ITMB-019 — PAYE bands and statutory contribution rates are not effective-dated — back-dated / re-run payroll re-rates a prior period at today's rate table

- **Location:** `backend/src/modules/hr/payroll-calculator/payroll-calculator.service.ts:36`  •  **Severity:** high  •  **Confidence:** high

Thread the run's period start/end into loadReferenceData and add to every taxRates sub-query: `effectiveFrom: { lte: periodStart }` plus `OR: [{ effectiveTo: null }, { effectiveTo: { gte: periodEnd } }]`, keeping `orderBy: { effectiveFrom: 'desc' }, take: 1`. Pass `run.period.startDate`/`endDate` (or paymentDate) from payroll-runs.service.ts:146. To stay safe on the live app, keep the existing 'newest ACTIVE' result as a fallback only when no date-bounded row exists (so currently-running payrolls do not break if historical TaxRate effective windows were never backfilled), and log when the fallback is used.

---

#### ITMB-020 — Net pay is never floored at zero — deductions exceeding gross persist a negative paycheck and corrupt the payroll accrual

- **Location:** `backend/src/modules/hr/payroll-runs/payroll-runs.service.ts:367`  •  **Severity:** high  •  **Confidence:** high

Before persisting, floor net at zero and cap discretionary deductions at available pay: compute netPay = Math.max(0, grossPay - totalEmployeeStatutory - cappedNonStatutory - cappedAdvanceRecovery), keep totalDeductions consistent (gross = net + deductions), and raise a validation error / record only the partially-withheld amount when deductions would exceed gross.

---

#### ITMB-021 — Salary advance recorded as recovered/SETTLED even when the installment was never withheld from a sufficient net pay

- **Location:** `backend/src/modules/hr/payroll-runs/payroll-runs.service.ts:835`  •  **Severity:** high  •  **Confidence:** high

Cap each advance installment to the pay available after statutory and higher-priority deductions in calculate(), persist the actually-withheld amount on the deduction line as the source of truth, and in syncAdvanceRecoveries() credit recoveredAmount only by that actually-withheld amount.

---

#### ITMB-022 — Payroll period attribution differs between statutory-returns (paymentDate-first, half-open) and the tax filing engine (startDate, inclusive) — the same PAYE/NSSF lands in different months

- **Location:** `backend/src/modules/hr/statutory-returns/statutory-returns.service.ts:443`  •  **Severity:** high  •  **Confidence:** high

Adopt one canonical attribution rule and apply it identically in both places. paymentDate-first (the defensible 'remittance month', falling back to startDate when paymentDate is null) over a consistent half-open [periodStart, periodEnd) window is recommended. Update tax-filing-engine.service.ts computePayroll (200-202) to match statutory-returns.lineWhere rather than the reverse, since the CSV is what is actually submitted.

---

#### ITMB-023 — SSRF: integration connection "test" fetches a fully user-controlled URL with no private-IP / metadata blocking and follows redirects

- **Location:** `backend/src/modules/integration-connections/integration-connections.service.ts:256`  •  **Severity:** high  •  **Confidence:** high

In resolveProbeTarget (and again on every redirect hop), resolve the hostname to IP(s) and reject loopback/private/link-local/reserved ranges (127/8, 10/8, 172.16/12, 192.168/16, 169.254/16, 0.0.0.0, ::1, fc00::/7) plus the metadata IP 169.254.169.254; validate the RESOLVED IP and pin the connection to it to defeat DNS rebinding. Pass redirect:'manual' to fetch and re-validate any Location target before following. Prefer an allowlist of approved provider base URLs, and do not forward arbitrary caller-supplied testHeaders to the target.

---

#### ITMB-024 — labor-records create() has no company-access check and trusts client paymentStatus + unbounded totalAmount (cross-tenant write + mass-assignment)

- **Location:** `backend/src/modules/labor-records/labor-records.service.ts:18`  •  **Severity:** high  •  **Confidence:** high

Change the controller and service to pass the AuthUser and call await companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE) at the top of create(). Remove paymentStatus from CreateLaborRecordDto (payment recorded via a dedicated endpoint) and add @Min(0) to totalAmount/hoursWorked/dayRate.

---

#### ITMB-025 — lease-agreements create() mass-assigns client createdById/approvedById (forged authorship + self-approval of a binding contract)

- **Location:** `backend/src/modules/lease-agreements/lease-agreements.service.ts:12`  •  **Severity:** high  •  **Confidence:** high

Remove approvedById from CreateLeaseAgreementDto (approval only via the approve endpoint) and derive createdById = user.id in the service rather than from the body (destructure-and-omit before the prisma create). Optionally restrict status so it cannot be set to ACTIVE at creation.

---

#### ITMB-026 — loan-repayment-schedules create()/recordPayment() spread an untyped @Body() with no loan/company scoping (cross-tenant financial write + GL posting)

- **Location:** `backend/src/modules/loan-repayment-schedules/loan-repayment-schedules.service.ts:65`  •  **Severity:** high  •  **Confidence:** high

Add CreateLoanRepaymentScheduleDto and RecordRepaymentDto with class-validator decorators (@IsUUID loanDebtId, @IsInt @Min(1) installmentNumber, @IsNumber @Min(0) amounts, @IsEnum status, @IsDateString dueDate/paymentDate) and type the controller params. In create(), load the parent loan and call companyScope.assertCanAccessCompany(user, loan.companyId, WRITE), then derive companyId/loanDebtId from the loan rather than the body. In findOne()/recordPayment(), resolve the schedule's loan companyId and assertCanAccessCompany before posting.

---

#### ITMB-027 — parking-rates create() mass-assigns client createdById/approvedById (self-approval of pricing + forged authorship)

- **Location:** `backend/src/modules/parking-rates/parking-rates.service.ts:13`  •  **Severity:** high  •  **Confidence:** high

Remove approvedById from CreateParkingRateDto (approval only via the permission-gated approve endpoint sourcing the approver from @CurrentUser), derive createdById = user.id in the service, and prevent status from being set to ACTIVE at creation.

---

#### ITMB-028 — IDOR: Rent Payments / Lease Agreements / Parking Sessions / Restaurant Orders findOne + mutations not company-scoped (lists ARE scoped)

- **Location:** `backend/src/modules/parking-sessions/parking-sessions.service.ts:78`  •  **Severity:** high  •  **Confidence:** high

Add an AuthUser parameter to each findOne and call await this.companyScope.assertCanAccessCompany(user, record.companyId) (AccessLevel.WRITE for mutations) before returning; inject CompanyScopeService where not present; thread @CurrentUser() from every controller handler (including the findOne endpoints that currently pass none) and have all id-based mutations go through the now-scoped findOne. Narrowing-only.

---

#### ITMB-029 — Product batch number via count()+1 with no transaction -> P2002 crash under concurrency (@@unique([companyId, batchNumber]))

- **Location:** `backend/src/modules/product-batches/product-batches.service.ts:16`  •  **Severity:** high  •  **Confidence:** high

Make number+create atomic: move count+create into one $transaction with a single P2002 retry, preserving the 'BATCH-' prefix. Do NOT blindly use codes.next({entityType:'ProductBatch'}) -- there is no ProductBatch entry in DEFAULT_PATTERNS, so fallbackPattern() would derive a different prefix (e.g. 'PRODUC-...') and change the visible batch numbers. If migrating to the generator, add a ProductBatch:{prefix:'BATCH-{YYYY}-',padding:5} default first.

---

#### ITMB-030 — Proforma invoice number generated via count()+1 outside the tx -> P2002 crash under concurrency (@@unique([companyId, proformaNumber]))

- **Location:** `backend/src/modules/proforma-invoices/proforma-invoices.service.ts:28`  •  **Severity:** high  •  **Confidence:** high

Make the read-modify-write atomic. IMPORTANT: do NOT route this through codes.next({entityType:'ProformaInvoice'}) without first fixing the default -- DEFAULT_PATTERNS.ProformaInvoice is 'PFI-{YYYY}-' (defaults.ts:74) which would silently change the customer-facing prefix from PRF to PFI on this live system. Safest fix: move count+create into one $transaction with a single P2002 retry, preserving the 'PRF-' prefix. If standardizing on the generator, first change the ProformaInvoice default prefix to 'PRF-{YYYY}-'.

---

#### ITMB-031 — project-material-issues post() bypasses the locking balance mutator: TOCTOU oversell, and a null-balance branch records a movement with no balance decrement

- **Location:** `backend/src/modules/project-material-issues/project-material-issues.service.ts:152`  •  **Severity:** high  •  **Confidence:** high

Inside the existing $transaction, replace the manual findFirst + conditional decrement with this.inventoryMovements.createMovement({ companyId: existing.companyId, productId: line.productId, branchId: sourceBranchId, movementType: 'INTERNAL_USE', quantity: Number(line.quantity), unitCost, referenceType: 'PROJECT_MATERIAL_ISSUE', referenceId: existing.id, tx }); that path takes the FOR UPDATE lock, enforces the negative-stock guard, and upserts the balance row when missing so a movement is never recorded without a matching balance change.

---

#### ITMB-032 — Quotation/proforma conversion writes a CONFIRMED sales order directly, bypassing inventory issue, receivable and tax-ledger posting

- **Location:** `backend/src/modules/quotations/quotations.service.ts:183`  •  **Severity:** high  •  **Confidence:** high

Have convertToSalesOrder create a DRAFT SalesOrder via SalesOrdersService.create() (which validates and recomputes totals) then call confirm() so inventory, receivable and tax ledger run; never write status:'CONFIRMED' with copied client totals.

---

#### ITMB-033 — Quotation and proforma number generation via count()+1 outside the transaction races to duplicate document numbers

- **Location:** `backend/src/modules/quotations/quotations.service.ts:31`  •  **Severity:** high  •  **Confidence:** high

Generate the number via EntityCodeGeneratorService.next({ entityType: 'Quotation'|'Proforma', companyId, tx }) inside the create $transaction (as sales-orders does), so numbering is atomic, instead of count()+1 outside the transaction.

---

#### ITMB-034 — Quotation->SalesOrder conversion: three writes with no $transaction + inline SO number bypassing the central sequence

- **Location:** `backend/src/modules/quotations/quotations.service.ts:237`  •  **Severity:** high  •  **Confidence:** high

Wrap salesOrder.create + salesOrderLine.createMany + quotation.update(status CONVERTED) in one this.prisma.$transaction(async (tx)=>{...}) using tx for all three, re-checking status==='ACCEPTED' inside the tx, and mint the number via this.codes.next({entityType:'SalesOrder',companyId:quotation.companyId,tx}) (inject EntityCodeGeneratorService into QuotationsService as SalesOrdersService already does). DEFAULT_PATTERNS.SalesOrder is 'SO-{YYYY}-' padding 6 (defaults.ts:70) -- the canonical format -- so this aligns converted orders with the rest. Apply the identical fix to proforma-invoices.service.ts convertToSalesOrder (line 216).

---

#### ITMB-035 — Quotation number generated via count()+1 outside the tx -> P2002 crash under concurrency (@@unique([companyId, quotationNumber]))

- **Location:** `backend/src/modules/quotations/quotations.service.ts:28`  •  **Severity:** high  •  **Confidence:** high

Inject EntityCodeGeneratorService and mint via this.codes.next({entityType:'Quotation',companyId:dto.companyId,tx}) INSIDE the existing $transaction at line 40. DEFAULT_PATTERNS.Quotation='QUO-{YYYY}-' padding 5 (defaults.ts:73), so the visible format is preserved. Minimal alternative: move count+create into the tx and retry once on P2002.

---

#### ITMB-036 — Receivable payment is a non-atomic read-modify-write (lost-update race; payables does it correctly)

- **Location:** `backend/src/modules/receivables/receivables.service.ts:225`  •  **Severity:** high  •  **Confidence:** high

Restructure exactly like payables.recordPayment: open $transaction first, SELECT the receivable FOR UPDATE, then run the positive/overpayment checks and the Decimal arithmetic on the locked row, then update and sync the sales order — all inside the transaction.

---

#### ITMB-037 — IDOR: Rent Invoices findOne/update/issue/remove not company-scoped (cross-tenant financial-document tampering)

- **Location:** `backend/src/modules/rent-invoices/rent-invoices.service.ts:40`  •  **Severity:** high  •  **Confidence:** high

Inject CompanyScopeService and thread AuthUser from the controller into findOne. After fetching, call await this.companyScope.assertCanAccessCompany(user, item.companyId) (use AccessLevel.WRITE for the mutation paths). Change update/issue/remove to call findOne(id, user) so the assertion runs before any mutation, and add @CurrentUser() to the controller's findOne. Narrowing-only; safe to deploy live.

---

#### ITMB-038 — restaurant-orders create() persists client-supplied monetary totals and paymentStatus verbatim (financial mass-assignment)

- **Location:** `backend/src/modules/restaurant-orders/restaurant-orders.service.ts:19`  •  **Severity:** high  •  **Confidence:** high

Remove subtotal/totalAmount/paidAmount/outstandingAmount/paymentStatus from CreateRestaurantOrderDto. Compute subtotal/tax/total server-side from the validated lines, initialize paidAmount=0, outstanding=total, paymentStatus=UNPAID, and apply payments only through a dedicated payment endpoint that recomputes paymentStatus.

---

#### ITMB-039 — POST /roles and PATCH /roles/:id allow a delegated role-admin to create a GROUP-scoped role and attach arbitrary permissions, escalating privilege

- **Location:** `backend/src/modules/roles/roles.controller.ts:26`  •  **Severity:** high  •  **Confidence:** high

Pass @CurrentUser into both the create and update handlers and enforce in RolesService.create/update: (a) only an actor whose roleScopes includes 'GROUP' may set scope === RoleScope.GROUP, and (b) the actor must already possess every permission code referenced by dto.permissionIds (resolve the permission rows for dto.permissionIds and intersect against actor.permissions), or restrict scope/permission-set editing to GROUP-scoped actors. Mirror the gating in users.service.ts assertRolesAssignable. Keep the existing $transaction so the permission-set replacement stays atomic.

---

#### ITMB-040 — Room bookings never check for overlapping reservations (double-booking allowed)

- **Location:** `backend/src/modules/room-bookings/room-bookings.service.ts:19`  •  **Severity:** high  •  **Confidence:** high

In create() (and re-validate in checkIn()), before persisting query for a conflict: prisma.roomBooking.findFirst({ where: { roomId: dto.roomId, deletedAt: null, status: { in: [RoomBookingStatus.RESERVED, RoomBookingStatus.CHECKED_IN] }, expectedCheckIn: { lt: new Date(dto.expectedCheckOut) }, expectedCheckOut: { gt: new Date(dto.expectedCheckIn) } } }); if found, throw new BadRequestException('Room is already booked for an overlapping period'). Use half-open intervals (lt/gt) so a same-day checkout/checkin does not falsely collide.

---

#### ITMB-041 — Negative or zero quantity and negative price/discount accepted in sales-order line math, corrupting totals and inventory on confirm

- **Location:** `backend/src/modules/sales-orders/dto/create-sales-order.dto.ts:8`  •  **Severity:** high  •  **Confidence:** high

Add @IsPositive() to quantity and unitPrice and @Min(0) to discountAmount/taxAmount on SalesOrderLineDto (and the quotation/proforma/restaurant line DTOs), and defensively reject in computeTotals/calcLines (qty<=0, price<0, discount<0, discount>qty*price) on both create() and update().

---

#### ITMB-042 — stock-adjustments post() applies inventory movements outside any transaction and flips status separately - partial posting and double-apply on re-post

- **Location:** `backend/src/modules/stock-adjustments/stock-adjustments.service.ts:274`  •  **Severity:** high  •  **Confidence:** high

Wrap the whole post() body in a single this.prisma.$transaction(async (tx) => { ... }), thread tx into every createMovement call, and atomically claim the document at the start of the tx with a guarded transition - const claimed = await tx.stockAdjustment.updateMany({ where: { id, status: 'APPROVED' }, data: { status: 'POSTED', postedById: user.id, postedAt: new Date() } }); if (claimed.count === 0) throw new BadRequestException('Adjustment not postable'); - so movements and status commit or roll back together and concurrent/retried posts are rejected.

---

#### ITMB-043 — stock-damage post() is non-atomic across three independent writes and decrements batch quantity with no negative guard

- **Location:** `backend/src/modules/stock-damage/stock-damage.service.ts:166`  •  **Severity:** high  •  **Confidence:** high

Wrap all three writes in one this.prisma.$transaction(async (tx) => { ... }), thread tx into createMovement, perform the batch decrement and status update inside the same tx, gate the batch decrement on availability via const res = await tx.productBatch.updateMany({ where: { id: batchId, remainingQuantity: { gte: quantity } }, data: { remainingQuantity: { decrement: quantity } } }); if (res.count === 0) throw new BadRequestException('Insufficient batch quantity'); and claim the status atomically with an updateMany guarded on status === current value so re-posts are rejected.

---

#### ITMB-044 — IDOR: Trips read + state transitions (dispatch/complete/cancel/close/remove) not company-scoped

- **Location:** `backend/src/modules/trips/trips.service.ts:82`  •  **Severity:** high  •  **Confidence:** high

Add an AuthUser parameter to findOne and call await this.companyScope.assertCanAccessCompany(user, t.companyId) before returning; thread @CurrentUser() into the controller's findOne and the dispatch/markInTransit/complete/close/cancel/remove/getProfitability handlers so each mutation goes through the now-scoped findOne (use AccessLevel.WRITE for transitions). Follows the same template create()/update() already use. Narrowing-only.

---

#### ITMB-045 — Payable and receivable settlement never posts the cash/clearing journal entry (AP/AR control balances never reduced)

- **Location:** `backend/src/modules/payables/payables.service.ts:218`  •  **Severity:** high  •  **Confidence:** medium

Inside the locking transaction of each recordPayment, post a balanced settlement entry for the payment amount (payables: DR AP_CONTROL, CR selected Bank/Cash; receivables: DR Bank/Cash, CR AR_CONTROL) and link journalEntryId. Add a bank/cash account field to both payment DTOs (currently absent) to specify the settlement account.

---

#### ITMB-046 — Customer credit limit never enforced when confirming a CREDIT sales order or creating a fuel credit sale

- **Location:** `backend/src/modules/sales-orders/sales-orders.service.ts:225`  •  **Severity:** high  •  **Confidence:** medium

Before creating the Receivable (inside the same transaction), load the customer's CustomerCreditProfile and sum of open receivables; if outstanding + newAmount > creditLimit, throw BadRequestException unless an explicit credit-override permission is present.

---


### MEDIUM severity

#### ITMB-047 — PermissionsGuard performs no per-company authorization (design context for the IDORs above)

- **Location:** `backend/src/common/guards/permissions.guard.ts:50`  •  **Severity:** medium  •  **Confidence:** high

Keep the guard for coarse feature gating (do not add record lookups here). Enforce the invariant in the services: every company-owned entity service must apply companyWhereFor/applyCompanyScopeWhere on lists and assertCanAccessCompany on findOne and id-based mutations, backed by per-module isolation tests (the existing *.isolation.spec.ts pattern). No change to this file is required.

---

#### ITMB-048 — Period-lock check treats a period/fiscal-year-scoped lock with a date window as company-wide, over-blocking postings to unrelated open periods

- **Location:** `backend/src/common/services/accounting-control.service.ts:55`  •  **Severity:** medium  •  **Confidence:** high

Constrain the date-window branch to genuinely company-wide locks by requiring the lock's own scope ids to be null on that branch: `{ accountingPeriodId: null, fiscalYearId: null, AND: [ { OR: [{ lockedFrom: null }, { lockedFrom: { lte: now } }] }, { OR: [{ lockedTo: null }, { lockedTo: { gte: now } }] } ] }`. Keep the period-specific and fiscal-year-specific branches as exact-id matches so a global date-range lock still blocks while period/year-scoped locks only block their own scope.

---

#### ITMB-049 — Nest application logger hardcodes 'debug' level in all environments including production

- **Location:** `backend/src/main.ts:15`  •  **Severity:** medium  •  **Confidence:** high

Gate the level set on environment, e.g. compute isProd from process.env.NODE_ENV before create() and pass logger: isProd ? ['error','warn','log'] : ['error','warn','log','debug']. This is a safe, behavior-preserving change for non-prod.

---

#### ITMB-050 — Per-email login lockout is in-memory and per-process — bypassable across replicas and lost on restart

- **Location:** `backend/src/modules/auth/auth.service.ts:75`  •  **Severity:** medium  •  **Confidence:** high

Back the login-failure throttle with the already-configured Redis cache (or a distributed ThrottlerStorage), keyed by normalized email (and/or IP), so the lock is cluster-wide and survives restarts. Keep the existing DB per-account lock as the durable second layer.

---

#### ITMB-051 — 2FA login challenge has no per-account lockout and ignores account lock — distributed OTP brute force possible once the password is known

- **Location:** `backend/src/modules/auth/two-factor.service.ts:139`  •  **Severity:** medium  •  **Confidence:** high

In completeLogin2FA, re-check user.lockedUntil before verifying the code and reject when locked. Persist 2FA challenge failures per user (reuse user.failedLoginAttempts/lockedUntil or a dedicated counter incremented inside verifyChallenge / the completeLogin2FA failure path) and lock the account / invalidate the tempToken after a small number of bad codes. Ensure the TOTP verification window is narrow (authenticator.options.window = 0 or 1) to minimize the live code set.

---

#### ITMB-052 — BI company_comparison dataset ignores company scope (cross-tenant leak) and is unbounded; cash_position also unbounded

- **Location:** `backend/src/modules/bi/bi.service.ts:172`  •  **Severity:** medium  •  **Confidence:** high

Apply `companyFilter` to the company_comparison branch (`where: { deletedAt: null, ...companyFilter }`) so it respects the caller's scope, and add a clamped `take` to both cash_position and company_comparison (reuse the existing pagination() helper). Safe to apply: tightens results to the caller's tenant and a sane page size.

---

#### ITMB-053 — BOQ item code via count()+1 with no transaction -> P2002 crash under concurrency (@@unique([projectId, boqCode]))

- **Location:** `backend/src/modules/boq-items/boq-items.service.ts:12`  •  **Severity:** medium  •  **Confidence:** high

Move count+create into a single $transaction with a P2002 retry, preserving project-scoped 'BOQ-NNNNN'. Do NOT route through EntityCodeGeneratorService.next({companyId}): the generator keys its DocumentNumberSequence by companyId (buildSequenceCode = entityType_companyId, entity-code-generator.service.ts:109-111), which would change the counter scope from per-project to per-company. A per-project sequence (or the tx+retry) is required.

---

#### ITMB-054 — cash-accounts create() persists a client-supplied currentBalance via full ...dto spread (running balance set with no backing movement)

- **Location:** `backend/src/modules/cash-accounts/cash-accounts.service.ts:87`  •  **Severity:** medium  •  **Confidence:** high

Remove currentBalance from CreateCashAccountDto and explicitly initialize currentBalance from the validated openingBalance in the service (currentBalance: dto.openingBalance ?? 0) instead of relying on the ...dto spread. Add @Min(0) to openingBalance, and ensure currentBalance thereafter changes only via posted movements.

---

#### ITMB-055 — Labour reclass credits Salaries Expense (6000) for gross+employer-statutory, but the accrual only debited 6000 with gross

- **Location:** `backend/src/modules/construction-labour-cost/construction-labour-cost.service.ts:112`  •  **Severity:** medium  •  **Confidence:** high

Reclass only the gross-salary portion through 6000 (Cr 6000 = sum(allocatedGross)), and reclass the employer-statutory portion out of the specific employer-statutory expense accounts into 5100 separately, so each credit matches the account that was originally debited.

---

#### ITMB-056 — Depreciation postEntry reads the DRAFT status check outside the transaction (TOCTOU → double-post of depreciation)

- **Location:** `backend/src/modules/depreciation/depreciation.service.ts:66`  •  **Severity:** medium  •  **Confidence:** high

Move the DRAFT guard inside the transaction with a conditional write, e.g. `tx.depreciationScheduleEntry.updateMany({ where: { id: entryId, status: 'DRAFT' }, data: { status: 'POSTED', ... } })` and abort/throw if count === 0 before posting the JE and incrementing the schedule (or SELECT ... FOR UPDATE the entry inside the tx). Company scoping here is already correct (assertCanAccessCompany at line 77).

---

#### ITMB-057 — Path traversal in multer temp filename: upload written under os.tmpdir() using raw client originalname; Date.now() prefix does NOT prevent traversal

- **Location:** `backend/src/modules/documents/documents.controller.ts:66`  •  **Severity:** medium  •  **Confidence:** high

Never use originalname in the on-disk path. Generate the temp filename from server-only values, e.g. `cb(null, `${Date.now()}-${randomUUID()}`)`, or apply `path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g,'_')` in the callback (the same sanitization the service already applies for the persistent copy). Keep originalname only as DB metadata.

---

#### ITMB-058 — Employee code generated via count()+1 (self-admitted race) -> P2002 crash on concurrent onboarding (@@unique([companyId, employeeCode]))

- **Location:** `backend/src/modules/hr/employees/employees.service.ts:132`  •  **Severity:** medium  •  **Confidence:** high

Wrap the count+create in a $transaction with a single P2002 retry to preserve the existing per-company '${prefix}-EMP-NNNN' (padding 4) format. Do NOT switch to codes.next() -- the format depends on the per-company prefix, which the generic generator cannot reproduce (no Employee default; even if added, the prefix is company-specific). Long-term, a per-company prefixed DocumentNumberSequence could carry that prefix.

---

#### ITMB-059 — Pension (NSSF/PSSSF) is contributed on full gross including non-pensionable allowances, ignoring the AllowanceType.pensionable flag, and the inflated employee contribution over-reduces the PAYE base

- **Location:** `backend/src/modules/hr/payroll-calculator/payroll-calculator.service.ts:102`  •  **Severity:** medium  •  **Confidence:** high

Derive a separate pensionable-earnings base in buildInput (sum allowances where allowanceType.pensionable is true, plus basic), thread it into PayrollCalculationInput, and pass it to calculatePension instead of full grossPay. Drive 'pensionable' and 'taxable' independently from AllowanceType flags. Keep PAYE base = taxable earnings minus the deductible pension. Validate against a sample employee before applying to the live run.

---

#### ITMB-060 — inventory-balances lowStock filter is inverted: returns only out-of-stock rows instead of low-but-positive stock

- **Location:** `backend/src/modules/inventory-balances/inventory-balances.service.ts:16`  •  **Severity:** medium  •  **Confidence:** high

Filter on a positive-but-low band consistent with liveStock(), e.g. where.quantityOnHand = { gt: 0, lte: lowThreshold }; (default lowThreshold to 10, matching liveStock). If the flag is genuinely intended to mean out-of-stock, rename it to outOfStock.

---

#### ITMB-061 — journal-entries create()/update() persist caller-supplied divisionId/branchId (header and per-line) without verifying they belong to the journal's company

- **Location:** `backend/src/modules/journal-entries/journal-entries.service.ts:212`  •  **Severity:** medium  •  **Confidence:** high

Add a private resolveScope({companyId, divisionId, branchId}) helper mirroring chart-of-accounts.resolveAccountScope: when branchId is set, load the branch with division.companyId and throw BadRequestException unless it equals dto.companyId (and unless the branch's divisionId matches any supplied divisionId); when divisionId is set, load the division and throw unless division.companyId === dto.companyId. In create(), call it for the header (dto.divisionId/dto.branchId against dto.companyId) and for each line's effective scope before persisting; in update() do the same against existing.companyId. Validate-only (do not silently null out ids) to avoid changing existing valid entries.

---

#### ITMB-062 — Loan installment payment does not lock/guard the schedule row (concurrent payments race; loan principal double-decremented)

- **Location:** `backend/src/modules/loan-repayment-schedules/loan-repayment-schedules.service.ts:57`  •  **Severity:** medium  •  **Confidence:** high

Open the $transaction first and SELECT the schedule (and the parent loan) FOR UPDATE; re-read outstanding/paidAmount from the locked row; perform the overpayment check and all arithmetic inside the transaction so concurrent payments serialize.

---

#### ITMB-063 — Loans recordRepayment only updates the balance when the client supplies remainingBalance (client-controlled, no server derivation)

- **Location:** `backend/src/modules/loans/loans.service.ts:236`  •  **Severity:** medium  •  **Confidence:** high

Derive the new outstanding balance server-side from the prior locked balance (rows[0].outstandingBalance) minus the principal portion of the repayment (defaulting principal to amount when not split), clamp to >= 0, reject values inconsistent with the recorded principal, and update unconditionally. Post a JE for the cash inflow/principal reduction.

---

#### ITMB-064 — package-movements create() silently no-ops the customer balance for unhandled movement types and never guards against negative owed balance

- **Location:** `backend/src/modules/package-movements/package-movements.service.ts:27`  •  **Severity:** medium  •  **Confidence:** high

Add a default branch to the switch that throws BadRequestException for movement types not valid against a customerId (or explicitly handle every allowed type), validate the movementType-vs-customerId/supplierId combination, and guard the decrements so quantityOwedByCustomer cannot go below zero.

---

#### ITMB-065 — Parking close() ignores the rate's gracePeriodMinutes and maxDailyAmount, over-billing short stays

- **Location:** `backend/src/modules/parking-sessions/parking-sessions.service.ts:135`  •  **Severity:** medium  •  **Confidence:** high

In close(), apply the rate's grace and cap: subtract rate.gracePeriodMinutes from the elapsed minutes before ceiling (e.g. Math.ceil(Math.max(0, durationMinutes - rate.gracePeriodMinutes)/60) for HOURLY), guard the zero/near-zero-duration case, and after computing calculatedAmount clamp it to rate.maxDailyAmount per 24h when that field is set. These fields already exist on ParkingRate, so honour them rather than the current unconditional Math.ceil.

---

#### ITMB-066 — Financial/procurement controllers type the request body as @Body() dto: any, disabling the global ValidationPipe (verified: posting-rules, loan-repayment-schedules)

- **Location:** `backend/src/modules/posting-rules/posting-rules.controller.ts:24`  •  **Severity:** medium  •  **Confidence:** high

Replace each @Body() dto: any with a proper DTO class carrying class-validator decorators (@IsUUID, @IsEnum, @IsInt/@IsNumber @Min(0), @IsDateString, @ValidateNested for line arrays). Prioritize accounting/procurement modules (posting-rules, loan-repayment-schedules, depreciation, goods-received-notes line items, purchase-requisitions, rfqs).

---

#### ITMB-067 — CSV/Excel formula injection: print-engine renderExcel writes request-supplied cell values, headers and metadata without neutralizing leading = + - @

- **Location:** `backend/src/modules/print-engine/print-engine.service.ts:278`  •  **Severity:** medium  •  **Confidence:** high

Add a neutralizeFormula helper: if a string cell value begins with =, +, -, @, TAB or CR, prefix it with a single quote (or set the ExcelJS cell to explicit text type). Apply it to every value in the row map (line 278), the header names (line 272), and the metadata values (line 266).

---

#### ITMB-068 — Regex injection / ReDoS in print-engine: user-controlled template-data keys compiled into RegExp without escaping

- **Location:** `backend/src/modules/print-engine/print-engine.service.ts:182`  •  **Severity:** medium  •  **Confidence:** high

Do not build a regex from user keys. Either escape the key before interpolation — `const safe = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');` then `new RegExp('\\{\\{\\s*'+safe+'\\s*\\}\\}','g')` — or, preferably, precompile one pattern `/\{\{\s*([\w.]+)\s*\}\}/g` and replace via a callback that looks the captured name up in `vars`. Safe to apply: behavior for legitimate `{{key}}` placeholders is unchanged.

---

#### ITMB-069 — Project material issues are never reconciled against BOQ quantities (no over-issue control)

- **Location:** `backend/src/modules/project-material-issues/project-material-issues.service.ts:126`  •  **Severity:** medium  •  **Confidence:** high

Add a BOQ reconciliation step in post() (or submit()): for each line resolve the matching BOQItem (via line.boqItemId, or productId mapped to a BOQ line), sum already-POSTED issued quantity for that BOQ line plus the current line quantity, and compare to BOQItem.quantity less a configurable wastage tolerance. If exceeded, either throw BadRequestException or require an explicit over-issue approval flag; at minimum persist and surface a variance warning. Keep it non-breaking on a live app by gating the hard block behind a company setting/tolerance.

---

#### ITMB-070 — Purchase-order pay() ignores prior partial payments — overwrites paidAmount to full total, posts no JE, no row lock

- **Location:** `backend/src/modules/purchase-orders/purchase-orders.service.ts:468`  •  **Severity:** medium  •  **Confidence:** high

Lock the PO row (SELECT ... FOR UPDATE) inside a transaction, compute newPaid = existing.paidAmount + payAmount, set paymentStatus from the resulting outstanding (PARTIAL vs PAID), reject overpayment, and post a balanced AP/Cash journal entry for the actual amount paid. Capture the settlement bank/cash account on PayPurchaseOrderDto.

---

#### ITMB-071 — Quotation/proforma conversion generates the sales-order number with Date.now().toString(36), risking collisions and sequence bypass

- **Location:** `backend/src/modules/quotations/quotations.service.ts:194`  •  **Severity:** medium  •  **Confidence:** high

Generate the number via EntityCodeGeneratorService.next({ entityType: 'SalesOrder', companyId, tx }) inside the conversion transaction, matching SalesOrdersService.create().

---

#### ITMB-072 — Rent invoice create/update blindly spread the client DTO with no company-scope assertion and per-record scope missing on findOne/update/remove

- **Location:** `backend/src/modules/rent-invoices/rent-invoices.service.ts:14`  •  **Severity:** medium  •  **Confidence:** high

Call companyScope.assertCanAccessCompany(user, dto.companyId, 'WRITE') in create, and in findOne/update/remove load the record and assert access on its companyId (or apply companyWhereFor to the findFirst); add @Min(0) to monetary DTO fields.

---

#### ITMB-073 — Restaurant order findOne and create lack company-scope enforcement (cross-tenant read and create)

- **Location:** `backend/src/modules/restaurant-orders/restaurant-orders.controller.ts:24`  •  **Severity:** medium  •  **Confidence:** high

Pass req.user into findOne and apply companyWhereFor(user,'READ') to the where (as quotations/proforma findOne do); in create() call companyScope.assertCanAccessCompany(user, dto.companyId, 'WRITE') before the insert.

---

#### ITMB-074 — Five operational document numbers use count()+1 with no transaction -> P2002 crash under concurrency (stock-damage, project-billing, project-progress, trip-expenses, vehicle-maintenance)

- **Location:** `backend/src/modules/stock-damage/stock-damage.service.ts:18`  •  **Severity:** medium  •  **Confidence:** high

For each module, move count+create into a single $transaction with a P2002 retry to preserve the existing prefix (DMG/PBIL/PROG/TEXP/MAINT). CAUTION before routing through codes.next(): DEFAULT_PATTERNS prefixes do NOT all match the inline ones -- ProjectBilling default is 'PBI-{YYYY}-' (defaults.ts:66) vs inline 'PBIL-', and there are NO defaults for StockDamage / ProjectProgressRecord / TripExpense / VehicleMaintenance (fallbackPattern would derive different prefixes). So the tx+retry approach is the safe live-compatible fix; only use the generator after adding/aligning the correct prefixes. Do NOT add unique constraints (they already exist as @@unique([companyId,...])).

---

#### ITMB-075 — Auth cookies (including refresh) default to ~10-year max-age, far outliving the 30-day refresh token

- **Location:** `frontend/src/lib/auth-cookie-config.ts:1`  •  **Severity:** medium  •  **Confidence:** high

Lower the default to align with refresh-token lifetime (e.g. 30 days = 60*60*24*30) so cookies expire alongside the credential; keep AUTH_COOKIE_MAX_AGE_SECONDS as an opt-in override. Safe to apply since access/refresh are renewed on each refresh call.

---

#### ITMB-076 — All auth/session cookies issued with a ~10-year Max-Age, giving captured cookies an effectively unlimited reuse window

- **Location:** `frontend/src/lib/auth-cookie-config.ts:1`  •  **Severity:** medium  •  **Confidence:** high

Align cookie Max-Age with token lifetimes: set a short Max-Age for itemba_access (e.g. 15-60 min, matching the backend JWT exp) and a bounded Max-Age for the refresh cookies (e.g. 7-30 days) backed by the existing server-side refresh rotation. Implement 'stay signed in' via refresh-token rotation rather than a multi-year cookie. Roll this out by changing the default in auth-cookie-config.ts (or setting AUTH_COOKIE_MAX_AGE_SECONDS) and verifying refresh still re-issues cookies before old ones expire so users are not logged out unexpectedly.

---

#### ITMB-077 — Edge auth middleware is dead code: proxy.ts is never loaded as Next.js middleware, so server/edge route protection never runs (page gate is client-only)

- **Location:** `frontend/src/proxy.ts:12`  •  **Severity:** medium  •  **Confidence:** high

Add frontend/src/middleware.ts that re-exports the existing logic so Next loads it without breaking the test that imports { proxy }: `export { config } from './proxy'; export { proxy as middleware } from './proxy';`. Do NOT simply rename the function (proxy.test.ts imports `{ proxy }` from './proxy' and would break). After deploying, confirm an unauthenticated request to a protected path returns a 307 redirect to /login. Keep the existing config.matcher (it already excludes _next/static, _next/image, favicon.ico, and api).

---

#### ITMB-078 — External payment confirm/reverse have no row lock or transaction (check-then-act status race, double-confirm window)

- **Location:** `backend/src/modules/external-payments/external-payments.service.ts:108`  •  **Severity:** medium  •  **Confidence:** medium

Perform the status transition with a conditional atomic update: `updateMany({ where: { id, status: { in: ['INITIATED','PENDING'] } }, data: { status: 'SUCCESS', ... } })` and treat count === 0 as already-confirmed/invalid; same pattern for reverse (where status = 'SUCCESS'). Optionally wrap with SELECT ... FOR UPDATE in a transaction.

---

#### ITMB-079 — Fuel credit sale totalAmount is client-supplied and never reconciled against litres * pricePerLitre or the official fuel price

- **Location:** `backend/src/modules/fuel-credit-sales/fuel-credit-sales.service.ts:18`  •  **Severity:** medium  •  **Confidence:** medium

Compute totalAmount server-side as litres * pricePerLitre, sourcing pricePerLitre from the active fuel-prices record for the product/branch/date, and reject/ignore a mismatching client totalAmount.

---

#### ITMB-080 — harvest-records post() updates inventory balance via non-locking findFirst-then-create/update instead of the locking mutator

- **Location:** `backend/src/modules/harvest-records/harvest-records.service.ts:152`  •  **Severity:** medium  •  **Confidence:** medium

Route harvest stock-in through this.inventoryMovements.createMovement({ movementType: 'PRODUCTION_IN', quantity, unitCost: unitValue, ... , tx }) inside the existing transaction, reusing its FOR UPDATE lock and ON CONFLICT upsert + atomic WAC update, instead of the hand-rolled findFirst/create/update.

---

#### ITMB-081 — LWOP / unpaid-absence days double-counted when approved unpaid leave and an UNPAID_ABSENT attendance record cover the same day

- **Location:** `backend/src/modules/hr/payroll-runs/payroll-runs.service.ts:207`  •  **Severity:** medium  •  **Confidence:** medium

Collect the distinct set of unpaid calendar dates from both leave requests and attendance (e.g. a Set of YYYY-MM-DD) and deduct one day per distinct date instead of summing two independent counts.

---

#### ITMB-082 — Posting-runs post/reverse only flip a status flag (no journal entries) and use a non-atomic check-then-update race

- **Location:** `backend/src/modules/posting-runs/posting-runs.service.ts:37`  •  **Severity:** medium  •  **Confidence:** medium

If PostingRun is purely descriptive metadata, remove the misleading post/reverse mutations. If it is meant to drive the ledger, implement the actual JournalEntry create/reverse inside a single $transaction. In all cases make the state transition race-safe with a conditional updateMany asserting it claimed exactly one DRAFT/POSTED row, e.g. `const r = await this.prisma.postingRun.updateMany({ where: { id, status: 'DRAFT' }, data: { status: 'POSTED', postedAt: new Date(), postedById: userId } }); if (r.count !== 1) throw new BadRequestException('Only draft runs can be posted');` (mirror for reverse with status: 'POSTED').

---

#### ITMB-083 — Project billing 'send' increments billedAmount with no cap against contract value or progress

- **Location:** `backend/src/modules/project-billing/project-billing.service.ts:63`  •  **Severity:** medium  •  **Confidence:** medium

In send(), load the project's contractValue and current billedAmount and warn/reject if billedAmount + b.amount would exceed contractValue plus a configurable variation-order tolerance. Because variation orders legitimately exceed the original contract on a live system, prefer a configurable tolerance or a warning-plus-override rather than an unconditional hard reject so existing workflows are not broken.

---

#### ITMB-084 — Rent invoices have no period-duplicate guard - the same lease period can be invoiced twice

- **Location:** `backend/src/modules/rent-invoices/rent-invoices.service.ts:12`  •  **Severity:** medium  •  **Confidence:** medium

Before create(), look up an existing non-deleted RentInvoice for the same leaseAgreementId whose [billingPeriodStart, billingPeriodEnd] overlaps the requested period (billingPeriodStart < requestedEnd AND billingPeriodEnd > requestedStart) and reject or return the existing one. Optionally add a unique composite index on (leaseAgreementId, billingPeriodStart) plus an idempotent generateForPeriod() routine.

---

#### ITMB-085 — Auto-commission created after the confirm transaction via non-atomic check-then-insert with no unique constraint, allowing duplicate (or silently dropped) commissions

- **Location:** `backend/src/modules/sales-orders/sales-orders.service.ts:241`  •  **Severity:** medium  •  **Confidence:** medium

Add a @@unique([salesOrderId]) (or [salesOrderId, employeeId]) constraint to SalesCommission, move commission creation inside the confirm $transaction using tx, and create-with-P2002-catch (or upsert) instead of findFirst-then-create; do not swallow non-P2002 errors silently.

---

#### ITMB-086 — Tax auto-apply fails open: lookup/DB errors return booked:0+error instead of throwing, so VAT silently fails to post while the order still confirms (latent — feature defaults off)

- **Location:** `backend/src/modules/tax-auto-apply/tax-auto-apply.service.ts:127`  •  **Severity:** medium  •  **Confidence:** medium

Distinguish 'legitimately nothing to book' (disabled / zero-tax lines, already-booked) from 'failed to determine tax' (the catch paths at 127-130 and 162-165 and the no-default branch at 167-171). When the feature is enabled, surface the hard-failure result to the caller as a visible/fatal error (or persist a 'tax-pending' marker on the order) so a retry or alert can reconcile it, instead of returning `booked:0 + error` that callers swallow as a no-op.

---


### LOW severity

#### ITMB-087 — Single lenient global Throttler (100/60s) governs both cheap CRUD and expensive uncapped list/render endpoints

- **Location:** `backend/src/app.module.ts:334`  •  **Severity:** low  •  **Confidence:** high

Add a strict per-route throttle on heavy endpoints, e.g. `@Throttle({ default: { limit: 5, ttl: 60000 } })` on list/report/render controller methods, or define a named 'heavy' tier in ThrottlerModule.forRoot, keeping 100/60s for normal CRUD. Best paired with the @Max limit cap (finding 1) and the regex fix (finding 2), which address the underlying per-request cost.

---

#### ITMB-088 — Prisma exception filter returns raw driver error text to clients in the default case

- **Location:** `backend/src/common/filters/prisma-exception.filter.ts:39`  •  **Severity:** low  •  **Confidence:** high

In the default branch return a generic 'Database error' to the client and log the (scrubbed) exception.message server-side instead. Keep the P2025/P2003 mappings; consider a generic 'Duplicate value' for P2002 rather than echoing meta.target.

---

#### ITMB-089 — Field-level encryption derives the AES key with a hardcoded, source-committed scrypt salt

- **Location:** `backend/src/common/services/encryption.service.ts:50`  •  **Severity:** low  •  **Confidence:** high

Optionally source the salt from a separate per-deployment env var (e.g. APP_ENCRYPTION_SALT, with a documented fallback to the current constant so existing ciphertext still decrypts), or explicitly document that at-rest security rests solely on APP_ENCRYPTION_KEY strength. Do not change the constant in place without a migration path — existing rows are keyed to the current salt.

---

#### ITMB-090 — Account enumeration via registration ConflictException (only when public registration is enabled)

- **Location:** `backend/src/modules/auth/auth.service.ts:103`  •  **Severity:** low  •  **Confidence:** high

If public registration is enabled, do not reveal existence on conflict: return the same generic 'check your email to complete registration' response and notify the existing user out-of-band, making the conflict response indistinguishable from a normal success. If registration is intended to be admin-only, keep ALLOW_PUBLIC_REGISTRATION=false and document it.

---

#### ITMB-091 — Support ticket reporter and comment-author names never render because backend queries omit the user relations

- **Location:** `backend/src/modules/support-tickets/support-tickets.service.ts:24`  •  **Severity:** low  •  **Confidence:** high

Add user-relation includes returning fullName/email in the backend only. In support-tickets.service.ts: findAll/findMine -> `include: { reportedBy: { select: { id: true, fullName: true, email: true } } }`; findOne -> add `reportedBy`/`assignedTo` selects plus `comments: { include: { user: { select: { id: true, fullName: true, email: true } } }, orderBy: { createdAt: 'asc' } }`. In support-ticket-comments.service.ts getComments -> `include: { user: { select: { id: true, fullName: true, email: true } } }`. No frontend change required.

---

#### ITMB-092 — My Tickets (and All Tickets / ticket detail) hang on a permanent 'Loading...' spinner when the initial fetch rejects

- **Location:** `frontend/src/app/(dashboard)/support/tickets/me/page.tsx:24`  •  **Severity:** low  •  **Confidence:** high

Move `setLoading(false)` into `.finally()` and add a `.catch` that records an error to render, e.g. `fetch(...).then(r=>r.json()).then(d=>setTickets(unwrapList(d))).catch(()=>setError('Failed to load tickets')).finally(()=>setLoading(false));`. Apply to all three load() sites. In create()/addComment(), check `res.ok` and surface failures instead of silently closing. Purely additive, safe to apply live.

---

#### ITMB-093 — formatDateTime uses toLocaleDateString (which ignores hour/minute), so it drops the time and is identical to formatDate

- **Location:** `frontend/src/lib/design-system/formatters.ts:56`  •  **Severity:** low  •  **Confidence:** high

Change `toLocaleDateString` to `toLocaleString` at line 56, keeping the same options (optionally add `hour12: false` for 24-hour output): `return new Date(value).toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:false });`. Add a unit test asserting the time portion renders. Safe, no behavioral change to formatDate.

---

#### ITMB-094 — d2286f9 makes GROUP scope an unconditional bypass that skips the requested AccessLevel in company-scope checks (defense-in-depth regression)

- **Location:** `backend/src/common/services/company-scope.service.ts:122`  •  **Severity:** low  •  **Confidence:** medium

Do not treat GROUP scope as an unconditional AccessLevel bypass. Either (a) restrict the blanket bypass to a true super-admin (e.g. user.roles.includes('GROUP_SUPER_ADMIN')) instead of any roleScopes.includes('GROUP'), or (b) keep allowing GROUP-scoped users to target any company but still evaluate the requested minimum against the role's actual capability rather than returning early. Apply symmetrically to both assertCanAccessCompanyFromUser (line 38) and assertCanAccessCompany (line 122) and update the two flipped spec cases accordingly. This is safe for live behavior: GROUP_SUPER_ADMIN/GROUP_FINANCE_CONTROLLER retain MANAGE; read-only GROUP roles regain the intended ceiling.

---

#### ITMB-095 — helmet() applied with library defaults — HSTS/CSP not explicitly hardened, and Caddy adds no HSTS

- **Location:** `backend/src/main.ts:28`  •  **Severity:** low  •  **Confidence:** medium

Configure helmet explicitly with prod-only strong HSTS, e.g. helmet({ hsts: isProd ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false }), and a CSP tuned to the frontend; optionally also set headers at the Caddy layer. Move app.use(helmet()) below the isProd computation (already at L22).

---

#### ITMB-096 — Audit-adjustment post/reverse run the period-lock check outside the transaction, leaving a TOCTOU window to post into a concurrently-closed period

- **Location:** `backend/src/modules/audit-adjustments/audit-adjustments.service.ts:161`  •  **Severity:** low  •  **Confidence:** medium

Move the posting-allowed check inside the $transaction so it shares the writing connection: have AccountingControlService accept an optional Prisma.TransactionClient and re-read AccountingPeriod.status plus active AccountingPeriodLock rows within the tx immediately before tx.journalEntry.create. Apply to both post() and reverse().

---

#### ITMB-097 — Unbounded auditLog.findMany distinct scan in getEntityTypes (no take) on append-only table

- **Location:** `backend/src/modules/audit-logs/audit-logs.service.ts:360`  •  **Severity:** low  •  **Confidence:** medium

Back the dropdown with a bounded source — a small distinct-entity-type lookup, a short-lived cache (values change rarely), or at minimum a covering index on (companyId, entityType) so the distinct is index-only. Avoid an unbounded distinct scan on the hot path. Safe, read-only optimization.

---

#### ITMB-098 — Verified TOTP codes are not consumed — replay within the time-step window

- **Location:** `backend/src/modules/auth/two-factor.service.ts:115`  •  **Severity:** low  •  **Confidence:** medium

Persist the last accepted TOTP counter/time-step per user (e.g. on UserSecurityProfile) and reject a code whose step is <= the last accepted step, making each TOTP single-use. Keep the verification window narrow (window: 0 or 1).

---

#### ITMB-099 — Debt has no payment endpoint; amountPaid set directly from client via free-form update with no validation, derived status, or money-movement audit

- **Location:** `backend/src/modules/debts/debts.service.ts:71`  •  **Severity:** low  •  **Confidence:** medium

Add a dedicated recordPayment(debtId, amount) that locks the debt row, validates amount <= outstanding (amount - amountPaid), increments amountPaid, derives status (PARTIALLY_PAID/SETTLED), logs a debt.payment audit action, and (if debts are in-ledger) posts a balanced settlement entry.

---

#### ITMB-100 — Depreciation findOne and getEntries enforce no company scope — cross-company read of depreciation/asset data

- **Location:** `backend/src/modules/depreciation/depreciation.service.ts:49`  •  **Severity:** low  •  **Confidence:** medium

Pass the AuthUser into findOne/getEntries and call companyScope.assertCanAccessCompany(user, schedule.companyId) (resolving the entry's schedule.companyId in getEntries), mirroring postEntry which already scopes via assertCanAccessCompany at line 77 and findAll which uses applyCompanyScopeWhere.

---

#### ITMB-101 — Leave balance year derived from start date only — a year-spanning leave is charged entirely to the start year

- **Location:** `backend/src/modules/hr/leave-requests/leave-requests.service.ts:333`  •  **Severity:** low  •  **Confidence:** medium

Split totalDays across the calendar years the request spans and decrement each year proportionally in both apply and reverse, or define and consistently enforce an explicit single-year policy.

---

#### ITMB-102 — No cancel path reverses an already-approved leave — balance only restored via delete

- **Location:** `backend/src/modules/hr/leave-requests/leave-requests.service.ts:276`  •  **Severity:** low  •  **Confidence:** medium

Add an explicit cancel-approved endpoint that runs reverseLeaveBalanceUsage() inside a transaction, and ensure any status transition away from APPROVED restores the balance.

---

#### ITMB-103 — SDL exemption uses the live active-employee count at recalculation time, not the headcount during the payroll period

- **Location:** `backend/src/modules/hr/payroll-runs/payroll-runs.service.ts:148`  •  **Severity:** low  •  **Confidence:** medium

Snapshot the active-employee count as-of the payroll period (employees with active assignments during [periodStart, periodEnd]) and persist it on PayrollRun so SDL eligibility is deterministic and period-correct on recomputation. Until then, restrict recalculation of finalized prior-month runs.

---

#### ITMB-104 — WAC: cost-less inbound movement values added quantity at the existing average cost, silently inflating totalValue

- **Location:** `backend/src/modules/inventory-movements/inventory-movements.service.ts:234`  •  **Severity:** low  •  **Confidence:** medium

Define an explicit policy for cost-less inbound movements: require/forward a unitCost for cost-bearing inbound types, or when unitCost is null compute the added value deliberately (e.g. explicitly value the new units at the current average and document the convention) rather than relying on the implicit recompute. Document the intended valuation behaviour.

---

#### ITMB-105 — loans create() accepts unvalidated numeric strings for principalAmount/interestRate/outstandingBalance and client-settable status

- **Location:** `backend/src/modules/loans/dto/create-loan.dto.ts:22`  •  **Severity:** low  •  **Confidence:** medium

Use @IsNumberString (or @IsDecimal) plus a positivity/@Min constraint on principalAmount/outstandingBalance, bound interestRate to a sane range, add a cross-field check outstandingBalance <= principalAmount, and default status to ACTIVE at creation (status changes only via the existing mark-loan-status endpoint).

---

#### ITMB-106 — CIT and City Service Levy silently fall back to hardcoded rates when no effective TaxRate row covers the period

- **Location:** `backend/src/modules/tax-filing-engine/tax-filing-engine.service.ts:230`  •  **Severity:** low  •  **Confidence:** medium

On a missing date-bounded rate, surface a blocking validation/warning (or throw notSupported, as other categories do) rather than silently defaulting, so the operator must configure the rate before the return can be submitted. Reserve the numeric default for an explicit override flag.

---

#### ITMB-107 — BankAccount uniqueness is global ([bankName, accountNumber]) instead of scoped to the owning company/group

- **Location:** `database/prisma/schema.prisma:1389`  •  **Severity:** low  •  **Confidence:** medium

Only change this if per-owner accounts must be independently unique. Decide intended semantics first. Option A (per-company): replace with `@@unique([companyId, bankName, accountNumber])` -- but note Postgres treats NULLs as distinct, so pure group-level accounts (companyId null) would no longer be deduplicated by this key; add a partial unique index for group-level rows if needed. Option B: keep the global constraint if global distinctness is genuinely desired. Either way, add an explicit duplicate pre-check in BankAccountsService.create that throws a ConflictException so users get a clean error instead of a raw P2002. Before any migration on the live DB, query for existing rows that would violate the new key (and consider soft-deleted rows) so the migration does not fail.

---

#### ITMB-108 — Proxy origin allowlist is partly built from client-controlled Host / X-Forwarded-Host headers (weak origin layer; CSRF still held by double-submit token)

- **Location:** `frontend/src/app/api/backend/[...path]/route.ts:48`  •  **Severity:** low  •  **Confidence:** medium

Pin the allowed origin to server-configured canonical values: use req.nextUrl.origin and the explicit ALLOWED_PROXY_ORIGINS env list only, and remove the `${proto}://${host}` entry derived from raw host/x-forwarded-host unless a trusted edge proxy is known to sanitize those headers. Keep csrfTokenValid() as the primary defense.

---

