# Group Control User Guide

## Overview

Group Control is the most sensitive layer of ITEMBA-R. It provides a unified view of legally sensitive records across all companies in the Itemba Group — **Mwanjalisi Oil Co. Ltd**, **Westsides Company Ltd**, and **Itemba Enterprises Co. Ltd** — while enforcing strict access control so that only authorized Group-level roles can view or modify these records.

> **Access is restricted.** Only users holding roles such as **Group Super Admin**, **Group Director**, **Finance Controller**, or **Compliance Officer** (with the appropriate `group_control.*` permissions) can access Group Control. Unauthorized access attempts are blocked and logged.

---

## 1. Purpose and Legal Entity Separation

Each company in the Itemba Group is a separate BRELA-registered legal entity with its own:
- Bank accounts and signatories
- Loans, credit facilities, and debts
- Fixed assets and depreciation schedules
- Contracts (supplier, customer, employment, lease)
- Legal documents (memoranda, share certificates, TIN certificates, licenses)
- Insurance policies and collateral records

Group Control exists to give senior management and authorized finance staff a **single controlled window** into these records across all entities — without exposing them to general company users who have no need to see them.

Audit logging is applied to every access event in Group Control. Who accessed what record, when, and from which IP address is always recorded.

---

## 2. Accessing Company Profiles

1. Navigate to **Group Control → Company Profiles**.
2. A list of all registered companies is displayed with their BRELA registration number, TIN, legal address, and incorporation date.
3. Click on a company to view its full legal profile:
   - Registered office address
   - Directors and shareholding summary
   - TIN number and VAT registration status
   - BRELA registration certificate (linked document)
   - Company status (Active / Dormant / Winding Up)
4. To update a company profile, click **Edit** (requires `group_control.companies.update` permission).
5. All edits are versioned and audit-logged.

---

## 3. Bank Accounts Registry

The Bank Accounts Registry is restricted to Group Control and is one of the most sensitive sections of the system.

### Viewing Bank Accounts
1. Navigate to **Group Control → Bank Accounts**.
2. Use the company filter to view accounts for a specific company.
3. Each record shows: bank name, branch, account number (masked), account type, currency, signatory names, and status.

### Adding a Bank Account
1. Click **New Bank Account**.
2. Select the company this account belongs to.
3. Enter the bank name, branch, account number, SWIFT/sort code, account type (Current / Savings / Loan / USD), and currency.
4. Add signatories — link to employee records where possible.
5. Upload the bank mandate document.
6. Click **Save**. An audit event is created recording who added the account.

### Editing or Deactivating
- Click **Edit** on any account to update details.
- To deactivate an account (e.g., closed account), use **Mark Inactive** — the record is retained for audit purposes, not deleted.

> **Never delete bank account records.** Deletion is disabled to preserve audit integrity.

---

## 4. Loans and Debts Registry

Track all company borrowings, credit facilities, and outstanding debts.

### Viewing Loans
1. Navigate to **Group Control → Loans & Debts**.
2. Filter by company, lender, loan type, and status.
3. Each record shows: lender name, principal amount, disbursement date, interest rate, repayment schedule, collateral linked, and outstanding balance.

### Adding a Loan Record
1. Click **New Loan**.
2. Select the company and enter:
   - Lender name and type (Bank, SACCOS, Individual, Other)
   - Loan amount and currency
   - Disbursement date and maturity date
   - Interest rate and repayment frequency
   - Linked collateral (if any)
3. Upload the loan agreement document.
4. Click **Save**.

### Recording Repayments
- Navigate to the loan record and click **Add Repayment**.
- Enter the repayment date, amount paid (principal + interest split), and payment reference.
- The outstanding balance is automatically recalculated.
- Link to the corresponding journal entry in Finance.

---

## 5. Fixed Assets Registry

Manage all significant assets across companies: land, buildings, vehicles, machinery, furniture, and equipment.

1. Navigate to **Group Control → Fixed Assets**.
2. View assets by company and category.
3. Each asset record includes: asset name, category, acquisition date, acquisition cost, accumulated depreciation, net book value, location, and assigned user.

### Adding an Asset
1. Click **New Asset**.
2. Fill in asset details including purchase invoice reference and supplier.
3. Set the **depreciation method** (Straight Line or Reducing Balance), useful life (years), and residual value.
4. Upload the purchase invoice and any warranty documents.
5. Link the asset to the appropriate GL account in the Chart of Accounts.

### Running Depreciation
- Monthly depreciation entries are generated automatically at period close (see Finance → Depreciation).
- The depreciation schedule can be viewed and verified from the asset record.

---

## 6. Contracts Registry

Central repository for all significant contracts across the group.

| Contract Type | Example |
|---|---|
| Supplier Contract | Fuel supply agreement with TotalEnergies Tanzania |
| Customer Contract | Corporate fuel account for a fleet company |
| Employment Contract | Senior management contracts |
| Lease Agreement | Property lease for Westsides branch |
| Service Agreement | Security, cleaning, IT services |

### Registering a Contract
1. Navigate to **Group Control → Contracts → New Contract**.
2. Select the company and contract type.
3. Enter: counterparty name, start date, end date, contract value, notice period, and renewal terms.
4. Upload the signed contract document.
5. Set **review reminders** — ITEMBA-R will alert responsible users 30 and 7 days before expiry.

---

## 7. Documents Vault

The Documents Vault stores all critical legal and compliance documents for each company.

**Document categories:**
- Certificate of Incorporation
- TIN Certificate
- VAT Registration Certificate
- Business Licenses (TBS, TFDA, EWURA, OSHA, Municipal)
- Insurance Policies
- Title Deeds and Property Documents
- Share Certificates
- Shareholder Resolutions
- Legal Correspondence

### Uploading Documents
1. Navigate to **Group Control → Documents Vault → Upload**.
2. Select the company, document category, and document date.
3. Enter expiry date if applicable (licenses, insurance).
4. Upload the file (PDF, JPG, PNG — max 20MB).
5. Documents approaching expiry trigger compliance alerts.

---

## 8. Sensitive Access Audit

Every action in Group Control — view, create, edit, download — is recorded in the Sensitive Access Audit Log.

1. Navigate to **Group Control → Access Audit Log**.
2. Filter by date range, user, company, and record type.
3. Each entry shows: timestamp, user, action, record type, record ID, IP address, and device.
4. This log is **read-only** — it cannot be modified or deleted by any user.
5. Periodic review of this log is a control requirement for Group Directors and Finance Controllers.

---

## 9. Group-Level Reports

| Report | Description |
|---|---|
| **Group Balance Sheet** | Consolidated assets, liabilities, and equity across all companies |
| **Group P&L** | Consolidated revenue and expenses |
| **Loans Summary** | All outstanding loans by company and lender |
| **Fixed Assets Schedule** | Asset register with depreciation summary |
| **Contract Expiry Calendar** | Upcoming contract renewals and expirations |
| **Compliance Obligations Matrix** | Status of all regulatory obligations per company |
| **Bank Account Summary** | Active accounts across all companies |

Reports can be exported to PDF or CSV. Each exported report carries a watermark with the user's name and export timestamp.
