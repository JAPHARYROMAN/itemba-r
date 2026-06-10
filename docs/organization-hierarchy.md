# Organization Hierarchy

**Scope:** Group / Company / Division / Branch model in the Itemba ERP
**Sources:** [`database/prisma/schema.prisma`](database/prisma/schema.prisma), [`database/seeds/seed.ts`](database/seeds/seed.ts), supporting auth + scoping services
**Last updated:** 2026-05-18

---

## TL;DR

Four-level org tree, strictly parent-child, enforced by required FKs:

```
                      Group  (1)
                        │
        ┌───────────────┼───────────────────┐
     Company         Company             Company   (n per group)
        │               │                   │
   ┌────┴────┐     ┌────┴────┐       ┌──────┴──────┐
 Div  Div  Div   Div  Div  Div     Div   Div   Div    (n per company)
  │    │    │     │    │    │       │     │     │
 Br   Br   Br    Br   Br   Br      Br    Br    Br    (n per division)
```

Currently seeded: **1 Group → 3 Companies → 10 Divisions → 6 Branches**. The Company is the primary scoping boundary used by `CompanyScopeService`; Division and Branch are well-modeled in the schema but inconsistently propagated to financial tables (see the [financial-module audit](../FINANCIAL_MODULE_AUDIT.md)).

---

## Level 1 — Group

[`schema.prisma:316-336`](database/prisma/schema.prisma)

The root of the org tree.

```prisma
model Group {
  id, name (unique), code (unique), description, address, phone, email, website

  companies    Company[]
  bankAccounts BankAccount[]    // group-level treasury
  loans        Loan[]            // group-level facilities
  contracts    Contract[]
  fixedAssets  FixedAsset[]      // rare; usually company-owned
  documents    Document[]
}
```

**Key properties:**
- Single Group seeded in production: **`ITEMBA`** ("ITEMBA Group"), address `ITEMBA House, Ohio Street, Dar es Salaam` ([`seed.ts:2078-2082`](database/seeds/seed.ts)).
- Group has **no `deletedAt`** — intentionally permanent.
- `BankAccount`, `Loan`, `Contract`, `FixedAsset`, `Document` all carry an optional `groupId` and an optional `companyId`. They can live at either layer.
- These are the **Group-Control resources** — permissions for them are restricted to `RoleScope.GROUP` roles by seed ([`permissions.guard.ts:16-19`](backend/src/common/guards/permissions.guard.ts)).

---

## Level 2 — Company

[`schema.prisma:338-602`](database/prisma/schema.prisma)

A BRELA-registered legal entity within the Group. **The primary scoping boundary for everything else in the system.**

```prisma
model Company {
  id, groupId (Restrict on delete),
  code (unique), name,
  industryType, status (CompanyStatus),
  phone, email, website, logoUrl,
  employeeCodePrefix?,    // 4-char prefix used by auto-codes (MWAN/WEST/ITEM)
  deletedAt?,

  group     Group           @relation(onDelete: Restrict)
  profile   CompanyProfile?
  divisions Division[]
  users     User[]
  // ...100+ relations to every domain table in the system
}

enum CompanyStatus { ACTIVE  DORMANT  SUSPENDED  DISSOLVED }
```

**Why Company has so many relations:** the schema deliberately makes Company the primary tenant boundary. Virtually every operational/financial table in the system carries `companyId`. That's how `CompanyScopeService.applyCompanyScopeWhere(...)` enforces multi-tenant isolation in one place.

**Sister model — `CompanyProfile`** ([`schema.prisma:606-630`](database/prisma/schema.prisma))
- 1:1 with `Company`, kept separate to avoid bloating `Company`.
- Holds legal/tax fields: `brelaRegNumber`, `tin`, `vrn` (VAT registration), `businessLicenseNumber`, `incorporationDate`, `registeredAddress`, `postalAddress`, `taxOffice`, `natureOfBusiness`, `authorizedCapital`, `currency` (defaults `TZS`).

### Seeded companies

| Code | Name | Industry | Code prefix | BRELA |
|---|---|---|---|---|
| `MWANJALISI` | Mwanjalisi Oil Ltd | Petroleum & Energy | `MWAN` | BRN-TZ-2010-001234 |
| `ITEMBA_ENT` | Itemba Enterprises Co. Ltd | Logistics, Agriculture & Construction | `ITEM` | BRN-TZ-2008-005678 |
| `WESTSIDES` | Westsides Company Ltd | Wholesale & Retail Trade | `WEST` | BRN-TZ-2015-009012 |

([`seed.ts:1866-1982`](database/seeds/seed.ts))

All three under the single `ITEMBA` Group.

---

## Level 3 — Division

[`schema.prisma:633-718`](database/prisma/schema.prisma)

A business unit / product line / industry vertical within a Company. **This is where industry-specific behavior is anchored** via `DivisionType`.

```prisma
model Division {
  id, companyId (Cascade on delete), name, code,
  type (DivisionType), description, isActive, deletedAt?,

  @@unique([companyId, code])   // codes unique per company, not globally

  company        Company
  branches       Branch[]
  divisionAccess UserDivisionAccess[]
  // ...100+ operational relations
}

enum DivisionType {
  PETROLEUM          // fuel stations
  LOGISTICS          // fleet, trips
  AGRICULTURE        // farms, crops
  CONSTRUCTION       // projects, BOQ
  BEVERAGES          // wholesale/retail beverages
  HARDWARE_BUILDING
  TRUCK_PARKING
  RENTAL_SHOPS
  HOSPITALITY        // hotels, restaurants
  REAL_ESTATE
  OTHER
}
```

**Why DivisionType matters:** the type drives which modules apply to the division. Petroleum modules require `division.type === PETROLEUM`; Hospitality modules expect `HOSPITALITY`; etc. It's how the platform supports radically different verticals without forking the schema.

### Seeded divisions

| Company | Divisions (code · type) |
|---|---|
| Mwanjalisi Oil | `PETRO` Petroleum · `PARKING` Truck Parking · `RENTAL` Rental Shops |
| Itemba Enterprises | `LOG` Logistics · `AGRI` Agriculture · `CON` Construction · `REAL_ESTATE` Real Estate |
| Westsides | `BEV` Beverages · `HWB` Hardware & Building · `HOSPITALITY` Uzunguni Inn |

10 divisions total. ([`seed.ts:1882-1980`](database/seeds/seed.ts))

---

## Level 4 — Branch

[`schema.prisma:722-801`](database/prisma/schema.prisma)

The operational unit. Despite the name, a "branch" is a **generic operational location** — physical branch, project site, farm, warehouse, fuel station, parking facility, hotel facility, etc. The form factor is captured by `BranchType`.

```prisma
model Branch {
  id, divisionId (Cascade on delete), name, code,
  type (BranchType), location?, address?, phone?, isActive, deletedAt?,

  @@unique([divisionId, code])   // codes unique per division

  division     Division
  branchAccess UserBranchAccess[]
  // ...80+ operational relations
}

enum BranchType {
  BRANCH                  // generic branch
  SITE                    // construction site
  PROJECT
  FARM
  WAREHOUSE
  FUEL_STATION
  OFFICE
  PARKING_FACILITY
  HOSPITALITY_FACILITY
  OTHER
}
```

### Seeded branches

| Code | Name | Type | Company / Division |
|---|---|---|---|
| `FS-001` | Main Fuel Station | `FUEL_STATION` | MWANJALISI / PETRO |
| `LOG-HQ` | Logistics HQ | `OFFICE` | ITEMBA_ENT / LOG |
| `FARM-001` | Main Farm | `FARM` | ITEMBA_ENT / AGRI |
| `SITE-001` | Construction Site 1 | `SITE` | ITEMBA_ENT / CON |
| `BEV-STORE` | Beverages Warehouse | `WAREHOUSE` | WESTSIDES / BEV |
| `HWB-STORE` | Hardware Store | `BRANCH` | WESTSIDES / HWB |

6 branches seeded. ([`seed.ts:1994-2043`](database/seeds/seed.ts)) Real deployments will grow this substantially — fuel stations alone will multiply.

---

## Cascade & lifecycle rules

| Action | Behavior | Why |
|---|---|---|
| Delete a `Group` | **Blocked** if any `Company` exists (`Company.group` → `Restrict`) | Groups are foundational |
| Delete a `Company` | Cascades to its `Division`s (and their `Branch`es) | Companies own their hierarchy |
| Delete a `Division` | Cascades to its `Branch`es | Same logic |
| Soft-delete | `Company`, `Division`, `Branch` all have `deletedAt`; `Group` does not | Reversible deletion below Group level |

In practice the recommended path is status transitions (e.g. `CompanyStatus.DORMANT`) and `deletedAt`, not hard deletes — the cascade chain is the safety net, not the workflow.

---

## Auth alignment with the hierarchy

Each level has a parallel access table (full detail in the [auth hierarchy doc](#) — see `CompanyScopeService` at [`backend/src/common/services/company-scope.service.ts`](backend/src/common/services/company-scope.service.ts)).

| Level | Access table | Role scope |
|---|---|---|
| Group | (implicit — `RoleScope.GROUP` users see everything they're listed in) | `GROUP` |
| Company | `UserCompanyAccess` | `COMPANY` |
| Division | `UserDivisionAccess` | `DIVISION` |
| Branch | `UserBranchAccess` | `BRANCH` |

Plus `User.companyId` — the user's "home" company. Access entries grant additional companies at `READ`/`WRITE`/`MANAGE` levels.

Note: `CompanyScopeService` only handles the **Company** axis. There is no equivalent `DivisionScopeService` or `BranchScopeService` — services that need division/branch filtering have to roll their own, and most currently don't.

---

## Data scoping in practice

Most domain entities follow this pattern, based on what level the data conceptually belongs to:

| Scope pattern | Examples | Rationale |
|---|---|---|
| Group-only | `Document` (group docs), some `BankAccount`/`Loan`/`Contract`/`FixedAsset` rows | Group treasury / governance assets |
| Company-only | `ChartOfAccount`, `FiscalYear`, `AccountingPeriod`, `Customer`, `Supplier`, `CompanyProfile`, `Receivable`, `Payable`, `SupplierInvoice` | Legal-entity-bound data |
| Company + Division | `SalesOrder`, `PurchaseOrder`, `InventoryMovement`, `StockAdjustment` | Operational data tied to a vertical |
| Company + Division + Branch | `JournalEntry` / `JournalEntryLine`, `FuelShift`, `Trip`, `RoomBooking`, `InventoryBalance`, `Expense`, `FixedAsset` | Physical / location-bound data |

### Known gap (also flagged in the financial-module audit)

The schema *supports* the four-level hierarchy. The financial tables don't fully *use* it:

| Entity | companyId | divisionId | branchId |
|---|---|---|---|
| JournalEntry / JournalEntryLine | ✓ | ✓ | ✓ |
| Expense | ✓ | ✓ | ✓ |
| FixedAsset | ✓ | ✓ | ✓ |
| **Receivable** | ✓ | ✗ | ✗ |
| **Payable** | ✓ | ✗ | ✗ |
| **SupplierInvoice** | ✓ | ✗ | ✗ |
| **CashAccount** | ✓ | ✗ | ✗ |
| **ChartOfAccount** | ✓ | ✗ | ✗ |
| **BankAccount** | groupId or companyId | ✗ | ✗ |
| **Loan** | groupId or companyId | ✗ | ✗ |

Result: roll-up *from branch upward* breaks for AR/AP/cash/COA. Reports can only stop at the company level for these tables. See [FINANCIAL_MODULE_AUDIT.md](../FINANCIAL_MODULE_AUDIT.md) §1 for the fix plan.

---

## Code-level conventions

### Uniqueness rules

- `Group.code` — globally unique
- `Company.code` — globally unique
- `Division.code` — unique per `(companyId, code)` — two companies can both have a division coded `OPS`
- `Branch.code` — unique per `(divisionId, code)` — two divisions can both have `BR-001`

### Auto-generated entity codes

Use `Company.employeeCodePrefix` (4-char string, e.g. `MWAN`, `WEST`, `ITEM`) → produces codes like `MWAN-EMP-001`, `WEST-EMP-002`, `ITEM-EMP-003`. Falls back to the first 4 chars of `Company.code` when null.

### Industry semantics

- `Company.industryType` is free-text. Use it for display only.
- `Division.type` is enumerated (`DivisionType`) and is what drives behavior. Module-routing and seeded permission packs key off this enum, not the company's text industry.

### Group-Control gating

The following resources are considered Group-Control and only granted to `RoleScope.GROUP` roles in the seed:

- `BankAccount`
- `Loan`
- `Debt`
- `Contract`
- `FixedAsset`
- `CompanyProfile`

The standard `@RequirePermissions(...)` check is sufficient because their permissions are only attached to GROUP-scoped role definitions ([`permissions.guard.ts:16-19`](backend/src/common/guards/permissions.guard.ts)).

---

## Current seeded snapshot (single-line)

`ITEMBA Group → { Mwanjalisi Oil [PETRO, PARKING, RENTAL]; Itemba Enterprises [LOG, AGRI, CON, REAL_ESTATE]; Westsides [BEV, HWB, HOSPITALITY] } → 6 branches across fuel-station, office, farm, site, warehouse, and generic-branch types.`

---

## Related documents

- [FINANCIAL_MODULE_AUDIT.md](../FINANCIAL_MODULE_AUDIT.md) — calls out where the financial tables fail to honor the four-level hierarchy.
- [docs/bug-hunt-2026-05-18.md](bug-hunt-2026-05-18.md) — §4.1 lists the FK relations missing explicit `onDelete` policies, several of which affect this hierarchy.
- Schema source of truth: [`database/prisma/schema.prisma`](database/prisma/schema.prisma) (lines 316–801 cover Group/Company/CompanyProfile/Division/Branch).
- Seed source of truth: [`database/seeds/seed.ts`](database/seeds/seed.ts) (Group: line 2078; Companies: 1866; Branches: 1994).
