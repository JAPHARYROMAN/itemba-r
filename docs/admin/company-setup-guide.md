# Company Setup Guide

## Overview

This guide provides step-by-step instructions for onboarding a new BRELA-registered company into ITEMBA-R. Follow each step in order to ensure the company is fully configured before activating user access.

---

## Prerequisites

Before starting the setup, gather the following information:
- BRELA Certificate of Incorporation (scanned copy)
- TIN Certificate (from TRA)
- VAT Registration Certificate (if VAT-registered)
- Company physical address and postal address
- Names and ID details of directors
- Bank account details (for Group Control registry)
- Company fiscal year start and end months
- Existing Chart of Accounts (if migrating from another system)

---

## Step 1: Create Company Record

1. Log in as **Group Super Admin**.
2. Navigate to **Settings → Companies → New Company**.
3. Fill in the **Legal Information** tab:
   - Company name (exactly as on BRELA certificate)
   - BRELA registration number
   - TIN number
   - VAT number (if applicable)
   - Date of incorporation
   - Company type (Private Limited Company, Public Ltd, etc.)
4. Fill in the **Contact Information** tab:
   - Registered physical address (street, city, region, Tanzania)
   - Postal address
   - Main telephone number
   - Company email address
   - Website (if any)
5. Upload the company logo.
6. Click **Save Company**.

---

## Step 2: Set Legal Profile

1. From the company record, click **Legal Profile**.
2. Add company directors:
   - Full name, nationality, national ID / passport number
   - Date of birth
   - Shareholding percentage
3. Add the company secretary (if applicable).
4. Set the company's **accounting currency** (TZS for Tanzanian operations; USD if dual-currency).
5. Set **decimal places** for currency display (2 decimal places standard).
6. Click **Save Legal Profile**.

---

## Step 3: Add Divisions and Branches

1. From the company record, click **Divisions → Add Division**.
2. For each operating division, enter:
   - Division name (e.g., Fuel Retail, Logistics, Agriculture, Construction, Hospitality)
   - Division type
   - Division head (assign after employees are added)
3. Click **Save Division**.
4. Within each division, click **Add Branch**:
   - Branch name and physical location
   - Branch manager (assign after employees are added)
   - Operating hours
5. Repeat for all divisions and branches.

---

## Step 4: Set Up Chart of Accounts

### Option A: Use the Standard ITEMBA-R COA Template
1. Navigate to **Finance → Chart of Accounts → Import**.
2. Download the ITEMBA-R standard COA template.
3. The template includes all standard accounts for Tanzanian SMEs.
4. Customize as needed for this company.
5. Upload and confirm the import.

### Option B: Manual Setup
1. Navigate to **Finance → Chart of Accounts → New Account**.
2. Create accounts following the standard numbering convention:
   - 1000–1999: Assets
   - 2000–2999: Liabilities
   - 3000–3999: Equity
   - 4000–4999: Revenue
   - 5000–5999: Cost of Sales
   - 6000–6999: Operating Expenses
   - 7000–7999: Other Income/Expense
3. Ensure all GL accounts required for the company's industry are created.

### Minimum Required Accounts
- Cash on Hand (1001)
- Bank Account – Main (1010)
- Accounts Receivable (1100)
- Inventory (1200)
- Fixed Assets (1500)
- Accumulated Depreciation (1510)
- Accounts Payable (2100)
- VAT Output (2200)
- VAT Input (1300)
- PAYE Payable (2210)
- NSSF Payable (2220)
- Share Capital (3100)
- Retained Earnings (3200)
- Revenue (4000+)
- Cost of Sales (5000+)
- Operating Expenses (6000+)

---

## Step 5: Configure Fiscal Year

1. Navigate to **Finance → Fiscal Years → New Year**.
2. Set the fiscal year start and end dates (e.g., 1 July 2025 – 30 June 2026 for the 2025/26 year).
3. The system auto-generates 12 monthly periods.
4. Click **Activate Fiscal Year**.

---

## Step 6: Assign Admin Users

1. Navigate to **Settings → Users → New User**.
2. Create the Company Manager account:
   - Name, email, temporary password
   - Assign role: **Company Manager** scoped to this company
3. Create the Finance Manager account:
   - Assign role: **Finance Manager** scoped to this company
4. Create the IT Admin account (if different from Group Super Admin):
   - Assign role: **Company Manager** + relevant module roles
5. Notify each user of their login credentials and require password change on first login.

---

## Step 7: Set Company Bank Accounts (Group Control)

1. Log in as **Group Finance Controller** or **Group Super Admin**.
2. Navigate to **Group Control → Bank Accounts → New Bank Account**.
3. Select the new company.
4. Enter all active bank accounts:
   - Main operating account (TZS)
   - USD account (if applicable)
   - Loan accounts (if applicable)
5. Add signatories for each account.
6. Upload bank mandate documents.

---

## Step 8: Configure Compliance Obligations

1. Navigate to **Compliance → Obligations**.
2. Add the standard obligations for a Tanzanian company:
   - Monthly VAT Return (due 20th of following month)
   - Monthly PAYE & SDL Return (due 7th of following month)
   - Quarterly WHT Return (due 30 days after quarter end)
   - Annual CIT Return (due 6 months after fiscal year end)
   - Annual Business License Renewal
   - Annual OSHA Certificate
   - Annual Fire Certificate
   - Industry-specific licenses (EWURA for petroleum, TFDA for food/beverage, etc.)
3. Assign responsible staff and due dates for each obligation.

---

## Step 9: Initial Seed Data Checklist

Before going live, verify the following seed data has been entered or confirmed:

**Finance**
- [ ] Chart of Accounts complete and reviewed
- [ ] Fiscal year created and activated
- [ ] Opening balances entered as journal entries (opening retained earnings, asset values, liabilities)
- [ ] Bank accounts configured in Group Control

**HR**
- [ ] All departments and positions created
- [ ] All employees entered with correct department and position
- [ ] Bank account details for all employees (for payroll)
- [ ] NSSF and NHIF numbers recorded

**Inventory (if applicable)**
- [ ] All products entered with correct SKU, UOM, and prices
- [ ] Opening stock entered via stock adjustment
- [ ] Reorder levels set

**Compliance**
- [ ] TIN, VAT, and BRELA numbers recorded
- [ ] All obligations entered with due dates
- [ ] All current licenses uploaded with expiry dates

**System**
- [ ] All users created and roles assigned
- [ ] Approval workflows configured
- [ ] Integration providers configured (M-Pesa, SMTP, SMS)

---

## Step 10: Verification

Before handing over to the Company Manager:
1. Log in as the Company Manager — verify the dashboard loads correctly.
2. Verify the company name appears in the Company Selector.
3. Run the **Trial Balance** — verify it shows opening balances correctly.
4. Test creating a sample journal entry — verify it posts.
5. Test the approval workflow — submit an expense and verify it routes correctly.
6. Confirm all compliance obligations are visible in the Compliance calendar.
