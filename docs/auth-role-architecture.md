# Itemba ERP — Authorization Role Architecture

**Status:** Proposed canonical role model
**Source:** Derived from the founder's hierarchy sketch (`Hierarchical Structure Described`), the existing `RoleScope` and access-table schema, and standard enterprise ERP governance practice (NetSuite / SAP Business One / Dynamics / Odoo).
**Scope:** Group, Company, Division, Branch — applied to Itemba Group (Mwanjalisi Oil, Itemba Enterprises, Westsides).
**Last updated:** 2026-05-18 (revised HR model — Group-strong, Division-executed, no Company HR role, no Branch HR role)

---

## 1. Design Principles

Before listing roles, fix the principles every role must obey. The role catalog flows from these.

### 1.1 Scope is separate from capability

A **role** answers *"what can this person do?"*
A **scope grant** answers *"where can they do it?"*

The two are stored separately and combined at runtime. A user is never simply "Accountant" — they are "Accountant at Westsides" or "Group Accountant across all companies". This is the single most important rule. It prevents the classic mistake of cloning a role per company.

### 1.2 The Four Scopes are strictly hierarchical

```
GROUP   ─ entire ecosystem (Itemba Group)
  └─ COMPANY    ─ single legal entity (Mwanjalisi / Itemba Enterprises / Westsides)
       └─ DIVISION   ─ functional vertical inside a company
            └─ BRANCH     ─ physical operational point
```

Each lower level is contained by its parent. A user scoped to a Branch can never reach data at sibling Branches; a user scoped to a Division can see all that Division's Branches but not other Divisions; and so on.

### 1.3 Authority flows DOWN, data rolls UP

- **Authority** flows top-down: a Group GM can act inside any Company; a Company GM can act inside any of its Divisions; etc.
- **Data aggregation** flows bottom-up: every transaction is recorded at the lowest applicable level (Branch where possible), and reports roll up from there to Division → Company → Group.

This is why we never write a transaction at "Group level" — Group reports are always the consolidation of Company reports, which are themselves the consolidation of Division/Branch data.

### 1.4 Three access tiers

Within any granted scope, a user has one of three access levels:

| Tier | Meaning | Typical use |
|---|---|---|
| **READ** | View only | Auditors, observers, board members |
| **WRITE** | Create / update transactions, but no governance | Operators, accountants, sales staff |
| **MANAGE** | Configure the level, approve, lock periods, assign access | Managers, GMs, CFO |

Higher tiers always imply lower tiers (MANAGE includes WRITE, which includes READ).

### 1.5 Legal-entity isolation by default

Even at Group level, a user must be **explicitly granted** access to each Company they need. The default is *no cross-company visibility*. This is non-negotiable for legal/tax/audit separation. Group consolidation reports are a privileged operation, not an implicit grant.

> *Mwanjalisi loans must not automatically appear inside Westsides accounting unless consolidated at group level.* — preserved as the canonical example.

### 1.6 Separation of duties is enforced by role pairing

No single role both *creates* and *approves* the same transaction class. A Branch Cashier records sales; a Branch Manager approves them. An Accountant prepares a payment; a CFO authorizes it. The role catalog assigns "creator" and "approver" permissions to **different** roles. This is enforced by the approval-workflow engine, not optional.

### 1.7 Read access ≠ write access ≠ approval rights

These are three distinct permission families. Where a sensitive resource exists (payroll, banking, contracts), each family is granted independently so an auditor can read without being able to write, and a creator can write without being able to approve.

### 1.8 Group-Control resources are special

Some resources logically belong to the Group regardless of which Company they nominally sit under: bank accounts, loans, debts, contracts, fixed assets, and company profile records. Permissions for these are restricted to GROUP-scope roles by seed. A Company GM does not have authority to open a new bank account; only the Group CFO or Super Admin does.

### 1.9 Roles are namespaced, not duplicated

We do **not** create `MwanjalisiCFO`, `WestsidesCFO`, `ItembaCFO`. There is one `CompanyCFO` role. Scope grants determine which Company that user's CFO authority applies to. Cloning roles per entity is what kills maintainability in legacy ERP installs.

### 1.10 Industry-specific roles attach to Division Types

A division of type `PETROLEUM` has Pump Attendants and Fuel Shift Supervisors. A division of type `HOSPITALITY` has Front Desk and Housekeeping Supervisors. These roles only make sense in their vertical and are granted only on divisions of the matching `DivisionType`. The platform supports many verticals; each contributes its own optional role pack.

### 1.11 HR is Group-policy, Division-executed, Branch-absent

HR authority concentrates at the Group, executes through Division Managers, and is absent from Branch entirely. There is **no Company HR role** — the Company is a legal/financial boundary, not an HR organizational unit. Day-to-day people decisions live with the Division Manager (who already manages the people in question); policy, executive hiring, terminations, payroll governance, transfers, and compensation framework live with the Group HR Director. Branch Managers have **no HR authority** — staff issues escalate to the Division Manager. This keeps one HR policy across the group, eliminates a redundant Company-HR layer, and concentrates approval power in two well-audited roles (Group HR Director + Division Manager) instead of fragmenting it across companies.

---

## 2. The Role Catalog

The catalog below is the **canonical superset**. A live deployment activates a subset depending on which Companies, Divisions, and verticals are in use.

Each role lists:
- **Scope** — the level it operates at
- **Core capability** — what it does
- **Approvals** — what it can approve (or is approved by)
- **Notable restrictions** — anything it explicitly cannot do

---

### 2.1 GROUP LEVEL — Executive & Governance

These are the top-of-tree roles. They are powerful and should be granted sparingly.

#### Super Admin (President)
- **Scope:** GROUP
- **Capability:** Unrestricted system-wide. Manages organizational tree itself (creating/dissolving companies, divisions, branches). Manages all roles and access grants. Final authority on strategic configuration.
- **Approvals:** Approves *anything* but is typically the approver of last resort. Most day-to-day approvals route to functional executives.
- **Restrictions:** Even Super Admin is logged. Sensitive actions require recent re-authentication (password re-prompt + MFA). Super Admin is the only role allowed to grant the Super Admin role.
- **Tanzanian context:** Typically the President/Chairman of the holding group.

#### Group Board / Executive Observer
- **Scope:** GROUP
- **Capability:** Read-only access to all consolidated reports and dashboards. Can read every Company's books for governance review. Cannot mutate anything.
- **Approvals:** Strategic items above defined thresholds (M&A, large facilities, dividend authorization) — workflow-driven, not direct mutation.
- **Restrictions:** No write access anywhere. Cannot see operational PII (e.g., individual employee salaries) without a separate elevated grant.
- **Used for:** Board members, external directors, principal shareholders.

#### Group CFO
- **Scope:** GROUP
- **Capability:** Full financial visibility across all Companies. Owns Group-Control resources (bank accounts, loans, contracts, fixed assets at Group level). Approves cross-company financial moves (intercompany transfers, capital allocation, dividend declarations). Manages Group treasury, banking relationships, debt facilities, and consolidated tax position. Locks/unlocks consolidated accounting periods.
- **Approvals:** Approves Group-level financial transactions above CFO thresholds. Second-stage approver for large Company-level transactions per company-specific thresholds.
- **Restrictions:** Cannot unilaterally hire/fire — HR functions are separate.
- **Reports to:** Super Admin / Board (for strategic decisions).

#### Group GM (Group General Manager)
- **Scope:** GROUP
- **Capability:** Operational authority across all Companies. Coordinates inter-company operations, sets group-wide operational standards, manages Company GMs, oversees branch performance group-wide. Reads all operational data; can mutate at any Company when needed (with audit trail).
- **Approvals:** Inter-company resource transfers (staff secondment, equipment moves between companies). Performance escalations. Operational policy.
- **Restrictions:** Cannot approve financial transactions above his/her threshold without CFO countersignature.

#### Group Accountant
- **Scope:** GROUP
- **Capability:** Maintains consolidated chart of accounts, posts group-level journal entries (intercompany eliminations, consolidation adjustments), reconciles intercompany balances, prepares consolidated financial statements. Read access to all Companies' books.
- **Approvals:** None unilaterally — works under Group CFO oversight.
- **Restrictions:** Cannot post directly to a Company's books — must be a CompanyAccountant for that. Cannot approve own work.

#### Group Auditor
- **Scope:** GROUP
- **Capability:** Read-only across the entire group. Generates audit evidence packs. Flags anomalies. Has visibility into audit logs across all entities. Can run audit-adjustment proposals (proposed, not posted).
- **Approvals:** None. Proposes adjustments; CFO/CompanyAccountant must post.
- **Restrictions:** *No write access anywhere*. Strict separation from operators — Auditor cannot also hold an operational role at any company. Enforced by mutual-exclusion at role-assignment time.

#### Group HR Director
- **Scope:** GROUP (single role grant; a designated backup holds the role only when explicitly elevated).
- **Position in the model:** The **only** dedicated HR role in the system. There is no Company HR Manager and no Branch HR. Group HR sets policy and approves all material HR actions; Division Managers execute on the ground.
- **Owns outright (no delegation):**
  - **HR policy** — single canonical employment handbook, code of conduct, leave policy, disciplinary procedure, grievance process across all Companies.
  - **Compensation framework** — salary bands per job grade, allowance schedules, deduction schedules, bonus policy. Sets the bands; individual salaries flow from band × grade × performance via Division Managers' proposals.
  - **Group-wide transfers** — moving employees between Companies or Divisions; inter-company secondments.
  - **Executive appointments** — Company GMs, Company CFOs, Division Managers, Group-level roles. Not in any Division Manager's authority.
  - **Payroll governance** — sees and approves consolidated payroll runs per Company. Sees totals; does not edit individual entries.
  - **HR compliance oversight** — OSHA, NSSF, NHIF, WCF, SDL obligations (filing executes via Company Compliance Officer; HR Director sees the obligations).
  - **HR system configuration** — job grades, departments, position catalog, public holidays, leave/allowance/deduction types.
  - **Group-wide reporting** — headcount, turnover, absenteeism, payroll cost as % of revenue, by Company and consolidated.
- **Approvals (workflow inbox):**
  - New hires above defined band (executive and senior management).
  - Salary changes above defined %.
  - Terminations of senior staff and any termination escalated by a Division Manager.
  - Disciplinary actions above written-warning level.
  - Leave requests for Division Managers and above.
  - Payroll runs (final HR-side sign-off; paired with Company CFO on finance side before disbursement).
- **Reads (visibility):** Full HR data across all Companies — every employee, every contract, every payroll run, all HR audit logs. Compensation detail for everyone (one of the few roles with this visibility; that is exactly the point of the role).
- **Restrictions:**
  - Cannot edit their own employment terms.
  - Cannot edit Super Admin's employment terms (Board owns those).
  - Cannot directly hire into a Division — Division Managers propose, Group HR approves.
  - Cannot run payroll mechanically — approves what Division Managers and accountants prepared.
  - Sensitive actions (full employee record, bulk PII export, salary detail outside their own management line) require recent re-authentication.
- **Grievance channel:** Group HR Director is the recipient of the formal grievance channel that routes **directly to them, bypassing the Division Manager** — required because there is no Company HR layer in between.

#### Group IT Admin
- **Scope:** GROUP
- **Capability:** Manages system configuration: roles, permissions catalog, integrations, API keys, system settings, deployments, backups. **Does not have business-data permissions** — IT admin can configure access but cannot see financial transactions, HR records, or operational data unless separately granted.
- **Approvals:** Role/permission changes, API integration setup, security policy changes.
- **Restrictions:** This is the *configuration* role, not a *data* role. Heavy audit logging. Sensitive operations require recent re-auth.

#### Group Compliance Officer
- **Scope:** GROUP
- **Capability:** Oversees regulatory compliance across all Companies — BRELA filings, TRA tax returns, business licenses, OSHA, environmental permits. Tracks compliance obligations and due dates. Generates compliance reports for regulators.
- **Approvals:** Tax-return submissions, license renewals, regulatory disclosures.
- **Restrictions:** Read access to operational data necessary for compliance only; not a general operator.

#### Group Procurement Director
- **Scope:** GROUP
- **Capability:** Sets procurement policy group-wide. Approves vendor master additions, large RFQ awards, master contracts. Coordinates cross-company purchasing (volume leverage).
- **Approvals:** Vendor master changes; RFQ awards above threshold; master service contracts.
- **Restrictions:** Cannot single-handedly post supplier invoices to GL — that is split between Company Accountant (record) and CFO (approve).

---

### 2.2 COMPANY LEVEL — Legal Entity Management

Each Company has its own management team. By default they have no visibility into sister companies. Each role below exists once per Company, granted via `UserCompanyAccess`.

#### Company GM
- **Scope:** COMPANY (one specific Company)
- **Capability:** Full operational and managerial authority inside this one legal entity. Manages Division Managers, sets company policy, approves company-level transactions up to defined thresholds. Reads all data for this Company.
- **Approvals:** Company-level operational decisions, division creation, branch creation (within existing divisions), Division Manager appointments, transactions up to threshold (beyond threshold escalates to Group).
- **Restrictions:** Cannot reach sister companies. Cannot touch Group-Control resources (bank accounts, loans, contracts, fixed assets at group level). Cannot self-grant additional access.

#### Company CFO / Finance Director
- **Scope:** COMPANY
- **Capability:** Full financial authority for this Company. Manages Company's chart of accounts, fiscal years, accounting periods. Approves period close. Posts/reverses journal entries up to threshold. Manages company-level bank accounts (if not group-controlled). Approves company-level tax filings.
- **Approvals:** Company journal entries, expense approvals above Manager threshold, period close, fiscal year close, statutory return filings for the Company.
- **Restrictions:** Cannot mutate Group-Control resources. Cannot post to sister companies' books. Must escalate to Group CFO for transactions above Company threshold.

#### Company Accountant
- **Scope:** COMPANY
- **Capability:** Records day-to-day accounting transactions for this Company — journal entries, expense entries, receivables, payables, supplier invoices, depreciation. Prepares trial balance, P&L, balance sheet, cash flow for the Company. Performs bank reconciliations.
- **Approvals:** None unilaterally. Prepares entries; Company CFO approves.
- **Restrictions:** Cannot post in a closed period. Cannot approve own work. Cannot reach Group-Control resources or sister companies.

> **No Company HR role exists.** HR is concentrated at the Group (policy, governance, approvals) and executed by Division Managers (day-to-day people decisions). What a Company HR Manager would typically own is redistributed: HR policy → Group HR; per-Company payroll approval → Group HR + Company CFO jointly; statutory HR filings (PAYE/SDL/NSSF/NHIF/WCF) → Company Compliance Officer with Group HR oversight; per-Company headcount/attrition reporting → Group HR Director (with Company GM as informed reader). The Company GM has *visibility* into HR for their Company but performs no HR actions.

#### Company Operations Director / COO
- **Scope:** COMPANY
- **Capability:** Operational oversight across all Divisions of the Company. Coordinates Division Managers. Oversees inventory, procurement execution, sales, customer service.
- **Approvals:** Cross-division operational decisions; inter-division stock transfers; large customer credit limit changes.
- **Restrictions:** Defers to Company CFO on financial policy; defers to Group HR on staffing matters.

#### Company Procurement Manager
- **Scope:** COMPANY
- **Capability:** Manages procurement workflow for this Company — purchase requisitions, RFQs, supplier quotations, bid comparisons, purchase orders, goods received notes, supplier invoice three-way matching.
- **Approvals:** Purchase orders up to defined threshold; goods received notes (after physical verification).
- **Restrictions:** Cannot post supplier invoice to GL — that splits between Company Accountant (record) and Company CFO (approve). Cannot add a new supplier without Group Procurement Director approval (vendor master is governed).

#### Company Sales Director
- **Scope:** COMPANY
- **Capability:** Owns the customer relationship across the Company. Manages customer master, customer credit profiles, customer segmentation, price lists, customer price agreements, sales commission policies. Reads all sales orders, quotations, proformas across the Company's Divisions.
- **Approvals:** Customer master additions, customer credit limit changes up to defined ceiling, price list changes, sales commission policy.
- **Restrictions:** Credit limit increases above ceiling escalate to Company CFO.

#### Company Compliance Officer
- **Scope:** COMPANY
- **Capability:** Tracks regulatory obligations specific to this Company — its BRELA, TRA, sector licenses (e.g., EWURA for petroleum). Files VAT, WHT, PAYE returns for this Company. Coordinates with Group Compliance Officer on cross-company items.
- **Approvals:** Tax-return submissions for this Company (paired with Company CFO).
- **Restrictions:** Cannot mutate financial data — proposes/files what the Accountant prepared.

#### Company Internal Auditor
- **Scope:** COMPANY
- **Capability:** Read-only across this Company. Performs internal audit reviews. Flags control violations.
- **Approvals:** None.
- **Restrictions:** Strict mutual exclusion with operational roles in this Company. Reports findings to Group Auditor.

---

### 2.3 DIVISION LEVEL — Functional Vertical

Divisions are where the platform specializes by industry. The generic Division roles below apply to every division regardless of type; the industry-specific roles in §2.5 add to them.

#### Division Manager
- **Scope:** DIVISION
- **Position in the model:** Holds **both operational and HR authority** for the Division. With no Company HR role in the system, the Division Manager is the *only* on-the-ground HR-acting role for the people in their Division. Group HR Director sets policy and approves material actions; Division Manager executes.
- **Operational capability:** Full operational authority within the Division. Manages Branch Managers. Sets division policy, approves division-level transactions up to defined threshold. Reads all data within the Division.
- **Operational approvals:** Branch creation requests (proposed to Company GM), shift schedules, sales discounts above branch threshold, stock transfers between branches in the Division, employee assignments within the Division.
- **HR capability — owns:**
  - Recruitment within the Division: identifies need, drafts requisitions, interviews, proposes hires up to defined band.
  - Onboarding / offboarding: admits staff to the Division, assigns them to Branches, ends employment per approval rules.
  - Leave management: approves / declines leave for Division staff up to defined ceiling; longer leaves escalate to Group HR.
  - Attendance & shift management: approves attendance, shift rosters, overtime within budget.
  - Performance management: appraisals, performance records, development plans.
  - First-line discipline: verbal warnings (no escalation needed); written warnings (notification to Group HR for audit).
  - Payroll inputs: prepares and verifies Division payroll inputs (hours, overtime, bonuses, deductions). Submits for Group HR + Company CFO approval before the run.
- **HR proposes (escalates to Group HR for approval):**
  - Hires above their band.
  - Salary changes above defined %.
  - Promotions across grade boundaries.
  - **Terminations of any kind** (every termination is proposed by Division Manager, approved by Group HR — never unilateral).
  - Disciplinary actions above written-warning level.
  - Inter-Division and inter-Company transfers.
- **HR restrictions — separation of duties (critical):**
  - **Cannot approve their own time/leave.** Their own attendance, leave, overtime are approved by Company GM (operational supervisor) + Group HR Director (HR supervisor) jointly.
  - **Cannot adjust their own compensation.** Their salary changes are owned by Group HR + Company GM.
  - **Cannot perform payroll runs.** Payroll execution is by Company / Group Accountant; Division Manager prepares inputs only.
  - **Cannot post HR-related financial entries** — salary advances, disciplinary fines, deduction recoveries all flow to Accounting via standard preparer/approver split.
  - **Cannot read other Divisions' HR data**, even within the same Company.
  - **Cannot read direct reports' full payroll history** beyond what's needed for the current cycle — full salary history requires Group HR involvement.
- **General restrictions:** Cannot touch other Divisions (operationally or in HR). Cannot reach Company-level financial governance.

#### Division Accountant
- **Scope:** DIVISION
- **Capability:** Records and reviews Division-level financial activity — cost-center transactions, division P&L, division-level expense categorization. Reconciles division-level sub-ledgers (where applicable) with Company GL.
- **Approvals:** None unilaterally. Prepares; Company Accountant or Company CFO approves.
- **Restrictions:** Cannot post directly to Company GL — entries flow through the Company Accountant.

#### Division Supervisor
- **Scope:** DIVISION
- **Capability:** Operational supervision of branches in the Division. Reviews daily operations across branches. Coordinates between Branch Managers. Approves routine operational items (shift handovers, inventory variances within tolerance).
- **Approvals:** Routine operational items only; anything material escalates to Division Manager.
- **Restrictions:** Read access to financial summaries; no direct posting.

#### Division HR Coordinator (optional, large divisions)
- **Scope:** DIVISION
- **Position in the model:** An **assist role**, not an approval role. Activated only when a Division is large enough that the Division Manager's HR workload requires support staff. Their job is to keep the paperwork moving — they do not decide.
- **Capability:** Coordinates HR paperwork inside the Division — collects leave requests, maintains employee record updates, prepares payroll input drafts, schedules training, tracks contract renewals, manages onboarding logistics.
- **Approvals:** **None.** All approvals stay with the Division Manager and Group HR. The Coordinator prepares; the Division Manager approves; Group HR signs off on material items.
- **Restrictions:** Cannot approve any HR action. Cannot edit compensation. Cannot terminate. Cannot read other Divisions' HR data. Read access to division-scoped HR records only.

---

### 2.4 BRANCH LEVEL — Operational Point

The lowest operational level. Most users in a deployment live here. Branch roles have the tightest scope and the heaviest separation-of-duties.

> **No HR role exists at Branch.** Branch Managers have **no HR authority** — they record attendance and report incidents but cannot hire, fire, discipline beyond informal coaching, approve leave, or change compensation. All HR matters escalate to the Division Manager. Sensitive HR data (salary, full contract, disciplinary history) is **invisible at branch level**; the Branch Manager sees only what they need to operate (name, role, contact, schedule).

#### Branch Manager
- **Scope:** BRANCH
- **Operational capability:** Full operational authority at this Branch. Manages shift schedules, branch staff assignments (within rosters set by Division Manager), daily operations, customer escalations, branch-level inventory, cash control. Approves branch-level transactions up to defined threshold.
- **Operational approvals:** End-of-day reconciliation sign-off; sales above attendant threshold up to manager threshold; stock adjustments within tolerance; cash disbursements within petty-cash limit.
- **HR-adjacent activity (data only — not authority):**
  - Records attendance for branch staff (data captured; approval is the Division Manager's).
  - Reports incidents (fights, theft, accidents) to Division Manager — does not investigate or discipline.
  - Approves shift swaps **within the branch** within tolerance — anything more goes to Division Manager.
- **HR restrictions:** Cannot hire, fire, discipline beyond informal coaching, approve leave, or change compensation. Cannot read salary, full contract, or disciplinary history of any staff member.
- **General restrictions:** Cannot reach other Branches. Cannot post journal entries. Cannot change prices (reads price lists set by Sales Director).

#### Branch Accountant / Bookkeeper
- **Scope:** BRANCH
- **Capability:** Records day-to-day financial activity at branch level — petty cash, daily sales reconciliation, branch deposits, branch-level expense entries. Reconciles cash drawer to system.
- **Approvals:** None — records; Company Accountant or Division Accountant approves.
- **Restrictions:** Cannot post directly to Company GL.

#### Shift Supervisor
- **Scope:** BRANCH (often shift-specific)
- **Capability:** Supervises a shift — opens/closes shift, assigns attendants, monitors shift performance, handles in-shift escalations, approves shift-level adjustments. Submits shift reconciliation for Branch Manager approval.
- **Approvals:** In-shift corrections within tolerance; attendant variances within limit.
- **Restrictions:** Cannot close the day's books — that's Branch Manager + Branch Accountant.

#### Sales Clerk / Salesperson
- **Scope:** BRANCH
- **Capability:** Records customer-facing sales — creates sales orders, quotations, proformas at branch level. Looks up customer accounts. Applies approved price lists.
- **Approvals:** None — initiates.
- **Restrictions:** Cannot apply discounts above defined threshold (escalates to Shift Supervisor or Branch Manager). Cannot extend credit beyond approved customer credit profile.

#### Cashier
- **Scope:** BRANCH
- **Capability:** Receives payments (cash, mobile money, card, bank transfer notification). Issues receipts. Closes cash drawer at end-of-shift with variance report.
- **Approvals:** None.
- **Restrictions:** Cannot edit sales records — only receives against them. Cannot void receipts — Shift Supervisor or Branch Manager voids.

#### Storekeeper / Inventory Controller (branch)
- **Scope:** BRANCH
- **Capability:** Receives stock (records GRN), issues stock, performs stock counts, records stock adjustments within tolerance.
- **Approvals:** None — records; Branch Manager or Division Manager approves variances.
- **Restrictions:** Cannot create new product SKUs (product master is Company-level). Cannot adjust stock beyond tolerance without approval.

---

### 2.5 INDUSTRY-SPECIFIC ROLES (Division-typed)

These roles attach only to divisions of the matching `DivisionType`. They extend the generic Branch/Division roles above with vertical-specific permissions.

#### Petroleum (DivisionType: PETROLEUM)
- **Fuel Station Manager** — Branch Manager specialization. Owns the fuel station. Approves price changes from Company Sales Director's price list. Authorizes shift reconciliations.
- **Fuel Shift Supervisor** — Shift Supervisor specialization. Opens/closes fuel shifts. Reviews nozzle readings. Approves cash collections vs sales reconciliation.
- **Pump Attendant** — Sales Clerk specialization. Records nozzle readings at shift start/end. Records cash and credit sales. No edit rights post-submission.
- **Tank Dipper** — Specialized inventory role. Records daily tank dips. Variances flagged for Fuel Station Manager approval.
- **Fuel Delivery Receiver** — Branch role. Receives fuel deliveries from suppliers, records gross/net volumes, signs off delivery.
- **EWURA Compliance Officer** — Specialized variant of Company Compliance Officer for petroleum-regulated activity (EWURA = Energy and Water Utilities Regulatory Authority).

#### Logistics (DivisionType: LOGISTICS)
- **Fleet Manager** — Division Manager specialization. Owns vehicles, drivers, routes.
- **Dispatcher** — Schedules trips, assigns drivers to vehicles and routes.
- **Driver** — Branch-level operator. Records trip starts/ends, fuel usage, expenses. Limited write scope (only their own trips).
- **Vehicle Maintenance Coordinator** — Records vehicle maintenance, books service, tracks costs.
- **Logistics Customer Service** — Records customer freight bookings.

#### Agriculture (DivisionType: AGRICULTURE)
- **Farm Manager** — Branch Manager specialization (Branch type FARM). Owns farm operations.
- **Crop Season Manager** — Owns a specific crop season — planting, inputs, harvest planning.
- **Field Supervisor** — Supervises field activities, records labor and farm-input applications.
- **Harvest Recorder** — Records harvest output volumes from fields.
- **Agronomist** — Read access to crop/field data, advises on inputs.

#### Construction (DivisionType: CONSTRUCTION)
- **Project Manager** — Branch Manager specialization (Branch type SITE/PROJECT). Owns the construction project.
- **Site Supervisor** — Supervises daily site activity, records labor, equipment, materials.
- **QS / Quantity Surveyor** — Maintains BOQ items, records progress against BOQ, prepares progress billings.
- **Site Storekeeper** — Records material issues against project requirements.
- **Subcontractor Coordinator** — Records subcontractor work, certifies for payment.

#### Hospitality (DivisionType: HOSPITALITY)
- **Hotel General Manager** — Branch Manager specialization (Branch type HOSPITALITY_FACILITY).
- **Front Desk / Receptionist** — Records guest check-in/out, room bookings, guest folios.
- **Housekeeping Supervisor** — Manages housekeeping tasks, room status.
- **Restaurant Manager** — Manages restaurant tables, menu, orders.
- **Bar Supervisor / Waiter / Bartender** — Records restaurant orders, sales.
- **Hotel Cashier** — Hospitality-specialized cashier — handles folio settlement.

#### Real Estate / Rentals (DivisionType: REAL_ESTATE, RENTAL_SHOPS)
- **Property Manager** — Manages rental properties, units, tenants, leases.
- **Lease Officer** — Drafts and registers lease agreements.
- **Rent Collection Officer** — Records rent invoices and payments.
- **Property Maintenance Coordinator** — Records property maintenance jobs.

#### Truck Parking (DivisionType: TRUCK_PARKING)
- **Parking Facility Manager** — Branch Manager specialization (Branch type PARKING_FACILITY).
- **Parking Attendant** — Records parking sessions in/out, collects parking fees.

#### Beverages / Hardware / Wholesale & Retail (DivisionType: BEVERAGES, HARDWARE_BUILDING)
- **Wholesale Manager** — Branch Manager specialization for wholesale operations. Manages bulk pricing, customer agreements.
- **Retail Manager** — Branch Manager specialization for retail outlets.
- **Batch Manager** — For perishable/dated goods (beverages): manages product batches, expiry tracking, batch recalls.
- **Returnable Package Coordinator** — Tracks returnable packages (crates, bottles, kegs).

---

### 2.6 CROSS-CUTTING FUNCTIONAL ROLES

These are not tied to a single level — they have specific, narrow permissions that span the hierarchy.

#### System Auditor (External)
- **Scope:** GROUP (read-only)
- **Capability:** Temporary read access for external audit firms during audit season. Read all books, audit logs, evidence packs. Cannot mutate anything.
- **Pattern:** Time-bound role grant (auto-expires at audit close).

#### Approval Delegate
- **Scope:** Inherits from the delegating user's scope, time-bound
- **Capability:** When a manager goes on leave, they delegate their approval authority to a named substitute for a specific date range. The delegate's approvals are tagged as such in the audit log.
- **Pattern:** Implemented as a separate `ApprovalDelegation` record, not a role assignment. Time-bound.

#### Temporary Elevation
- **Scope:** Specific resource, time-bound
- **Capability:** A Branch Manager who must cover for a Division Manager temporarily receives a time-bound elevation grant. Auto-revokes.
- **Pattern:** Tracked separately, fully audited.

#### API Client / Service Account
- **Scope:** Defined per integration
- **Capability:** Non-human accounts for external integrations (payment gateway callbacks, mobile money, accounting export, ETL). Scoped to specific endpoints via API scopes.
- **Pattern:** Authenticated via API key, not password. Has no UI access. Fully audited via API request logs.

#### Read-Only Investor / Stakeholder
- **Scope:** GROUP (curated)
- **Capability:** Read access to consolidated dashboards and KPIs only. No transaction-level visibility.
- **Pattern:** For minority shareholders, lenders requiring covenant reporting, prospective acquirers.

---

## 3. The Authority Matrix

Quick reference. Rows are roles; columns are common authority dimensions. ✓ = baseline grant; ◐ = with threshold limit; ✗ = not granted by default.

| Role | Read all in scope | Write transactions | Approve up to threshold | Approve above threshold | Manage scope (config) | Manage user access |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Super Admin | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Group Board | ✓ | ✗ | ✗ | ◐ (strategic) | ✗ | ✗ |
| Group CFO | ✓ | ✓ | ✓ | ✓ (finance) | ✓ (finance) | ◐ (finance roles) |
| Group GM | ✓ | ✓ | ✓ | ◐ (ops; co-sign for finance) | ✓ (ops) | ◐ (ops roles) |
| Group Accountant | ✓ | ✓ (group JE only) | ✗ | ✗ | ✗ | ✗ |
| Group Auditor | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Group HR Director | ✓ (HR all-Co) | ✓ (HR, transfers) | ✓ (HR, all bands) | ✓ (exec hires, terminations, payroll) | ✓ (HR config) | ◐ (HR-related roles) |
| Group IT | ✗ (config-only) | ✗ | ✗ | ✗ | ✓ (system) | ✓ (all roles) |
| Group Compliance | ◐ (compliance) | ✓ (filings) | ✗ | ✗ | ✗ | ✗ |
| Group Procurement | ◐ (procurement) | ✓ (vendor master) | ✓ (RFQ awards) | ✗ | ✗ | ✗ |
| Company GM | ✓ (within Co) | ✓ | ✓ | ✗ (escalates) | ✓ (within Co) | ◐ (within Co) |
| Company CFO | ✓ (within Co) | ✓ (finance) | ✓ (finance) | ✗ | ✓ (Co finance) | ✗ |
| Company Accountant | ✓ (within Co) | ✓ (record) | ✗ | ✗ | ✗ | ✗ |
| Company Operations | ✓ (ops within Co) | ✓ (ops) | ✓ (ops) | ✗ | ✗ | ✗ |
| Company Procurement | ◐ (proc within Co) | ✓ (PO) | ✓ (PO) | ✗ | ✗ | ✗ |
| Company Sales | ◐ (sales within Co) | ✓ (customers, prices) | ✓ (credit) | ✗ | ✗ | ✗ |
| Company Compliance | ◐ (Co compliance) | ✓ (filings) | ✗ | ✗ | ✗ | ✗ |
| Company Internal Auditor | ✓ (within Co) | ✗ | ✗ | ✗ | ✗ | ✗ |
| Division Manager | ✓ (within Div, ops + HR) | ✓ (ops + HR exec) | ✓ (ops + HR within band) | ✗ (escalates to Group HR / CFO) | ◐ (Div ops) | ✗ |
| Division Accountant | ◐ (Div) | ✓ (record) | ✗ | ✗ | ✗ | ✗ |
| Division Supervisor | ◐ (Div ops) | ✓ (routine) | ◐ (routine) | ✗ | ✗ | ✗ |
| Division HR Coordinator (optional) | ◐ (Div HR records) | ✓ (HR paperwork prep) | ✗ | ✗ | ✗ | ✗ |
| Branch Manager | ✓ (within Br, ops only) | ✓ (ops) | ✓ (ops) | ✗ | ◐ (Br ops) | ✗ |
| Branch Accountant | ◐ (Br) | ✓ (record) | ✗ | ✗ | ✗ | ✗ |
| Shift Supervisor | ◐ (shift) | ✓ (shift) | ◐ (shift) | ✗ | ✗ | ✗ |
| Sales Clerk | ◐ (Br sales) | ✓ (sales) | ✗ | ✗ | ✗ | ✗ |
| Cashier | ◐ (Br cash) | ✓ (receipts) | ✗ | ✗ | ✗ | ✗ |
| Storekeeper | ◐ (Br stock) | ✓ (movements) | ✗ | ✗ | ✗ | ✗ |

---

## 4. Approval Chains

Approvals are amount-tiered and role-tiered. The thresholds below are *defaults* — each Company configures them.

### 4.1 Expense approval chain (illustrative)

| Amount tier | Initiated by | Approved by | Final posted by |
|---|---|---|---|
| ≤ TZS 100k (petty cash) | Anyone with `expenses.create` | Branch Manager | Branch Accountant |
| TZS 100k – 1M | Anyone with `expenses.create` | Division Manager | Company Accountant |
| TZS 1M – 10M | Department head | Company CFO | Company Accountant |
| TZS 10M – 100M | Company CFO | Group CFO | Group Accountant |
| > TZS 100M | Group CFO | Super Admin / Board | Group Accountant |

### 4.2 Capital expenditure (fixed asset)

| Amount tier | Approver |
|---|---|
| ≤ Company threshold | Company GM + Company CFO |
| > Company threshold | Group CFO + Super Admin |

### 4.3 Vendor master / customer master

| Action | Approver |
|---|---|
| New supplier added | Group Procurement Director |
| New customer above credit threshold | Company Sales Director + Company CFO |

### 4.4 Period close

| Action | Approver |
|---|---|
| Close monthly accounting period (Company) | Company CFO |
| Close fiscal year (Company) | Company CFO + Group CFO |
| Reopen a closed period | Group CFO + Super Admin |

### 4.5 HR approval chain

HR approvals run exclusively between **Division Manager (initiator / line authority)** and **Group HR Director (final authority)**. There is no Company HR layer; the Company GM and Company CFO appear only where their domain is implicated (executive hires, payroll funding, exec salary changes).

| Action | Initiated by | Approved by | Final by |
|---|---|---|---|
| Hire — within division band | Division Manager | Group HR Director | Group HR Director records |
| Hire — above band / executive | Division Manager or Group GM | Group HR + Company GM + Group CFO (if exec) | Group HR records |
| Leave — short (≤ defined days) | Employee | Division Manager | Division Manager |
| Leave — long (> threshold) or sabbatical | Employee | Division Manager + Group HR | Group HR |
| Leave — for a Division Manager | Division Manager | Company GM + Group HR Director | Group HR |
| Salary change — within % | Division Manager | Group HR | Group HR |
| Salary change — above % | Division Manager | Group HR + Company GM + Group CFO | Group HR |
| Promotion across grade | Division Manager | Group HR + Company GM | Group HR |
| Disciplinary — verbal | Division Manager | (none — auto-logged) | Division Manager |
| Disciplinary — written warning | Division Manager | Group HR (notification + co-sign) | Group HR |
| Disciplinary — suspension / termination | Division Manager | Group HR + Company GM | Group HR |
| Inter-division transfer (same Company) | Both Division Managers | Company GM + Group HR | Group HR |
| Inter-company transfer | Both Division Managers | Group HR + both Company GMs + Group CFO | Group HR |
| Payroll cycle run | Division Manager (inputs) → Company Accountant (prepare) | Group HR + Company CFO | Group / Company Accountant posts; Company CFO releases funds |
| Termination of a Division Manager | Company GM | Group HR + Group GM + Super Admin | Group HR |
| Grievance against a Division Manager | Employee (direct channel) | Group HR Director (bypasses Division Manager) | Group HR + Group Auditor as needed |

### 4.6 Sensitive actions (regardless of amount)

These require **recent re-authentication** (password re-prompt + MFA if enabled) in addition to standard approval:

- Reopening a closed accounting period
- Reversing a posted journal entry older than X days
- Adding or removing a bank account
- Granting Super Admin role
- Changing any user's password (admin reset)
- Approving payroll runs
- Exporting bulk PII

---

## 5. Delegation, Substitution, Time-Bound Access

Real operations break the static role tree. The system supports:

### 5.1 Approval Delegation
A manager going on leave delegates approval authority to a specific peer/subordinate for a date range. The delegate's approvals are audit-logged and tagged as "by delegation from X". Time-bound; auto-expires.

### 5.2 Temporary Elevation
A Branch Manager covering for a sick Division Manager receives a time-bound elevation. Auto-expires.

### 5.3 Acting Capacity
An interim role assignment when a permanent appointment is pending — e.g., "Acting Company CFO" — looks like a normal role grant but is tagged "acting" for governance reporting.

### 5.4 Break-Glass / Emergency Access
A defined emergency access path that grants Super Admin temporarily, requires recent re-auth, fires an immediate notification to the Board and Group Auditor, and creates an unmissable audit record. Used for incident response.

### 5.5 External Audit Window
External auditors receive read-only Group access for a defined window (e.g., 60 days during audit season). Auto-revokes at window close.

### 5.6 Direct Grievance Channel (HR-specific)
Because there is no Company HR layer between an employee and their Division Manager, the system exposes a **direct grievance channel** that routes from any employee straight to the Group HR Director, bypassing the Division Manager. Required for any complaint *about* the Division Manager, harassment claims, whistleblowing, or any matter the employee judges should not pass through line management. Group HR investigates with Group Auditor's read access if needed. The Division Manager is never automatically notified.

---

## 6. Mutually Exclusive Role Combinations

To preserve separation of duties, certain role pairings are **not allowed on the same user**:

- Any Auditor role + any operational role *in the same scope* (e.g., Company Internal Auditor cannot also be Company Accountant in the same Company).
- Cashier + Branch Manager in the same Branch (one cannot approve their own cash reconciliation).
- Company Accountant + Company CFO in the same Company (preparer/approver split).
- Procurement role + Goods-receiving role + Invoice-approval role — the three-way matching triangle must be split across at least two people.
- **Group HR Director + Division Manager in the same Division** — Group HR is the approver of the Division Manager's HR actions; one person cannot hold both ends of the approval.
- **Group HR Director + Group Accountant / Group CFO** — payroll runs need separate HR-side and finance-side approvers; one person cannot countersign their own work.
- **Division HR Coordinator + Division Manager in the same Division** — the Coordinator's job is to prepare for the Manager's approval; preparer/approver split applies.

Enforced at role-assignment time, not just at runtime, so the conflict is caught before it can produce a problem.

---

## 7. Inheritance & Visibility Rules

### 7.1 Downward authority inheritance
A user with `RoleScope.GROUP` automatically has the read/write/manage capabilities of an equivalent COMPANY-level role across every Company they're granted access to. The Group CFO does not need a separate "Company CFO" grant per Company.

### 7.2 Upward data aggregation, not authority
A Branch Manager's transactions become part of Division reports, Company reports, and Group reports. But the Branch Manager themselves never sees data from sibling Branches or any other Division.

### 7.3 Explicit cross-Company visibility
Even at Group level, cross-Company report views are **explicitly named operations** ("Group Consolidation", "Group Cash Position", "Intercompany Reconciliation"). They are not the default lens. The default lens is single-Company. This is what preserves legal-entity isolation.

### 7.4 Read does not imply export
Read access to data and the ability to export/download/print bulk data are separate permissions. An Auditor can read everything but bulk export is a separate, audit-logged action.

---

## 8. Audit & Accountability

Every role action above a threshold generates audit log entries. Specifically tracked:

- **Authentication events** — login, logout, MFA challenge, password change, recent-auth re-prompts.
- **Authorization events** — permission denials, role assignments, scope grants, delegations.
- **Mutations** — every create/update/delete on financial and HR entities, with before/after values for changes.
- **Approvals** — who approved what, when, against which workflow, with any comment.
- **Exports** — bulk data exports, with destination and row count.
- **Sensitive reads** — viewing payroll details, individual employee compensation, board-level financial detail.
- **Configuration changes** — role/permission catalog changes, threshold changes, fiscal/period changes.

Audit logs are append-only (no deletion). Group Auditor has read access to all audit logs; even Super Admin cannot rewrite history.

---

## 9. Tanzania-specific Considerations

### 9.1 BRELA / TRA legal entity boundary
Each Company is a separately registered BRELA entity with its own TIN. The role architecture preserves this — Company-scoped roles cannot reach sister Companies, supporting clean tax filings and separate audit trails per TIN.

### 9.2 VAT (VRN) treatment
Each VAT-registered Company has its own VAT Registration Number. VAT returns are filed per Company. The Company Compliance Officer files; Company CFO countersigns. Group CFO has visibility but does not file individual Company returns.

### 9.3 EWURA-regulated petroleum
The Petroleum Division (Mwanjalisi) operates under EWURA oversight. Specialized roles (Fuel Station Manager, Fuel Shift Supervisor, Tank Dipper, EWURA Compliance Officer) capture the additional regulatory burden.

### 9.4 OSHA workplace registrations
HR-related compliance roles handle OSHA registration tracking per Branch (where required).

### 9.5 PAYE / SDL / NSSF / WCF / NHIF
Payroll tax filings are per Company. Flow under the revised HR model: Division Managers prepare and verify payroll inputs for their staff; Company Accountant compiles the Company-wide payroll; **Group HR Director approves on the HR side**; **Company CFO approves on the finance side** (cash availability, GL impact); Company Accountant posts; Company CFO releases funds; **Company Compliance Officer files** PAYE / SDL / NSSF / WCF / NHIF returns; Group HR Director and Group CFO have consolidated visibility. The double sign-off (HR + Finance) is what locks payroll integrity — neither role can release payroll alone.

### 9.6 Tanzanian Employment and Labour Relations Act conformity
Termination procedures must follow the Act. The architecture splits the work as the Act expects: **Division Manager owns the operational justification** (performance, conduct, redundancy rationale); **Group HR Director owns the legal-compliance side** (correct procedure, notice periods, statutory entitlements, documentation). No termination is unilateral — every termination is proposed by the Division Manager and signed off by Group HR plus the Company GM.

---

## 10. Recommended Initial Role Pack (Seed)

For the three currently seeded Companies (Mwanjalisi Oil, Itemba Enterprises, Westsides), the initial recommended user count is approximately:

| Role | Count | Notes |
|---|---|---|
| Super Admin | 1 | Itemba Group President |
| Group Board / Observer | 2–4 | Board members |
| Group CFO | 1 | |
| Group GM | 1 | |
| Group Accountant | 1–2 | Consolidation team |
| Group Auditor | 1 | Internal |
| Group HR Director | 1 | The **only** dedicated HR role in the system. Plus 1 designated backup (elevated on demand). |
| Group IT Admin | 1–2 | Including a backup |
| Group Compliance Officer | 1 | |
| Group Procurement Director | 1 | |
| Company GM | 3 | One per Company |
| Company CFO | 3 | One per Company |
| Company Accountant | 3–6 | One or two per Company |
| ~~Company HR Manager~~ | **0** | **Role does not exist.** HR runs via Group HR Director + Division Managers. |
| Company Operations | 3 | One per Company |
| Company Procurement Manager | 3 | One per Company |
| Company Sales Director | 3 | One per Company |
| Company Compliance Officer | 3 | One per Company — also handles per-Company PAYE/SDL/NSSF/NHIF/WCF filings |
| Company Internal Auditor | 3 | One per Company |
| Division Manager | 10 | One per Division. **Holds both operational and HR authority** for the Division. |
| Division Accountant | 5–10 | Optional per Division |
| Division Supervisor | 10 | One per Division minimum |
| Division HR Coordinator (optional) | 0–10 | Activate only for large Divisions. Paperwork assist only — no approval authority. |
| Branch Manager | 6+ | One per current branch, scaling. **No HR authority** — operational only. |
| Branch Accountant | 6+ | One per branch |
| Shift Supervisor | varies | Multiple per branch (multi-shift) |
| Sales / Cashier / Storekeeper / etc. | many | Operational staff |
| Industry-specialized roles | varies | Per division type |

System totals will run into the tens initially and grow into the hundreds as branches multiply (especially fuel stations under Mwanjalisi).

---

## 11. Failure Modes This Architecture Prevents

These are the classic ERP role failures this architecture is designed to make difficult:

1. **"One God account" syndrome** — Super Admin is logged, audit-tracked, and used sparingly; daily ops never run as Super Admin.
2. **Per-Company role duplication** — One `CompanyCFO` role, scoped via grants. No `MwanjalisiCFO_v2` proliferation.
3. **Approval bypass** — Preparer ≠ approver, enforced at role-assignment time, not as a runtime hope.
4. **Cross-tenant data leak** — Default lens is single-Company; cross-Company views are explicit operations with their own permissions.
5. **Stale access** — Time-bound roles, delegations, and elevations expire automatically; no manual cleanup required.
6. **Auditor compromise** — Auditor roles are read-only and mutually exclusive with operational roles in the same scope.
7. **Compliance drift** — Compliance Officer is a first-class role with its own permission family; not a side-duty bolted onto an accountant.
8. **Insider risk on banking** — Group-Control resources (bank accounts, loans, contracts, fixed assets, company profile) are only mutable by GROUP-scope roles, with re-auth required.
9. **Configuration drift** — IT Admin is purely configurational and explicitly *not* a business-data role; preventing the common "IT person knows all salaries" anti-pattern.
10. **Lost board oversight** — Board / Observer is a defined read-only seat at Group level; not "we'll give them a CFO login when they ask".
11. **HR-policy fragmentation across companies** — There is **one** HR Director at the Group; one handbook, one set of bands, one termination procedure. No per-Company HR Manager means no drift between Mwanjalisi's HR practice and Westsides'.
12. **Line-manager HR abuse** — Division Managers hold HR authority but cannot self-approve, self-promote, self-pay-rise, or terminate without Group HR co-signature. Direct grievance channel routes around them. Every termination requires Group HR + Company GM. Every salary change above small % requires Group HR.
13. **Branch-level HR overreach** — Branch Managers have **zero** HR authority. They cannot read salary, full contract, or disciplinary history of staff. Eliminates the "branch boss runs his own private fiefdom" anti-pattern.

---

## 12. Summary

This architecture provides:

- **Four strict scope levels** — Group, Company, Division, Branch — mirroring the legal-entity and operational structure.
- **A finite role catalog** — baseline roles + industry-specific packs per Division type.
- **Three access tiers** — READ, WRITE, MANAGE — per scope.
- **Strict separation of duties** — preparer / approver / auditor never combined in the same scope.
- **Group-Control gating** — bank accounts, loans, contracts, fixed assets, company profiles only mutable by GROUP-scope roles.
- **HR concentrated at the Group, executed at the Division, absent from Branch** — one Group HR Director, no Company HR layer, Division Managers carry HR authority for their staff with mandatory Group HR co-signature on material actions, Branch Managers have zero HR authority.
- **Time-bound and delegated authority** — leave, acting, audit windows, break-glass, direct grievance channel — all first-class concepts.
- **Cross-cutting compliance** — Auditor, Compliance Officer, IT Admin as distinct functional families.
- **Industry specialization** — vertical role packs per `DivisionType` so petroleum, hospitality, construction, agriculture, logistics, retail each get the roles they need.
- **Tanzanian regulatory fit** — BRELA-per-Company boundary, EWURA for petroleum, VAT/PAYE/SDL/NSSF/WCF/NHIF per-Company filings with HR + Finance double sign-off, OSHA per-Branch tracking, ELRA-compliant termination flow.
- **Defensible audit trail** — every action above a threshold logged; auditor reads; nobody rewrites history.

This is the role architecture the ERP should converge to. The existing `RoleScope` enum and access tables already support it structurally; what remains is the role-catalog seeding, the threshold configuration, and the approval workflow wiring.

---

## 13. Related Documents

- [docs/organization-hierarchy.md](organization-hierarchy.md) — the Group/Company/Division/Branch entity model these roles attach to.
- [FINANCIAL_MODULE_AUDIT.md](../FINANCIAL_MODULE_AUDIT.md) — the financial gaps that the Group-Control roles and approval chains will help close.
- [docs/bug-hunt-2026-05-18.md](bug-hunt-2026-05-18.md) — current authorization-layer bugs to fix before this architecture is live.
