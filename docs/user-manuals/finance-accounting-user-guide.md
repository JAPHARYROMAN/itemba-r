# Finance & Accounting User Guide

## Overview

The Finance & Accounting module is the financial backbone of ITEMBA-R. It provides a full double-entry accounting engine with chart of accounts, journal entries, expense management, accounts receivable (AR), accounts payable (AP), cash management, inter-company transactions, financial statements, bank reconciliation, and depreciation. Each company maintains its own independent books.

---

## 1. Chart of Accounts Setup

The Chart of Accounts (COA) defines every GL account used in the company's books.

**Standard account categories:**
- **Assets** (1000–1999): Current assets (cash, receivables, inventory), fixed assets
- **Liabilities** (2000–2999): Current liabilities (payables, accruals), long-term debt
- **Equity** (3000–3999): Share capital, retained earnings
- **Revenue** (4000–4999): Sales revenue by product/service type
- **Cost of Sales** (5000–5999): COGS, fuel cost, cost of goods
- **Operating Expenses** (6000–6999): Staff costs, utilities, rent, marketing
- **Other Income/Expense** (7000–7999): Interest income, FX gain/loss

### Adding an Account
1. Navigate to **Finance → Chart of Accounts → New Account**.
2. Enter the account code, name, type, and parent account (for sub-accounts).
3. Specify whether the account is a **posting account** (transactions post here) or a **summary account** (used for grouping only).
4. Set the account currency (TZS or USD).
5. Click **Save**.

### Importing a COA
Use **Finance → Chart of Accounts → Import** to upload a CSV file with account codes and names. A template is available for download.

---

## 2. Fiscal Years and Periods

ITEMBA-R uses fiscal years aligned with each company's financial year (typically July–June for Tanzanian companies).

### Creating a Fiscal Year
1. Navigate to **Finance → Fiscal Years → New Year**.
2. Enter the start and end date.
3. The system auto-generates 12 monthly periods.
4. Click **Activate** to make this the current fiscal year.

### Period Status
| Status | Meaning |
|---|---|
| **Open** | Transactions can be posted |
| **Closed** | No further postings allowed — period is locked |
| **Future** | Period not yet started |

> **Period close is irreversible.** Once a period is closed, only a Finance Controller with the `finance.periods.reopen` permission can reopen it (audit-logged).

---

## 3. Journal Entries

### Creating a Journal Entry
1. Navigate to **Finance → Journal Entries → New Entry**.
2. Select the **fiscal period** and enter a memo/description.
3. Add debit and credit lines:
   - Select the GL account
   - Enter the amount in TZS (or USD for forex accounts)
   - Add a narration for each line
4. The system enforces **balanced entries** — total debits must equal total credits before you can save.
5. Click **Save as Draft** or **Post** directly.

### Posting Rules
- Only **Posted** journal entries affect the trial balance and financial statements.
- Draft entries are visible only to Finance staff.
- Journal entries cannot be posted to **closed periods**.
- Reversals: Use **Reverse Entry** on any posted entry to auto-create a mirror reversal entry in the current period.

### Recurring Journals
For monthly fixed entries (e.g., depreciation, accruals):
1. Create the journal entry.
2. Click **Set as Recurring** and specify the recurrence interval (Monthly/Quarterly).
3. The entry is auto-created at the start of each applicable period.

---

## 4. Expenses

### Submitting an Expense
1. Navigate to **Finance → Expenses → New Expense**.
2. Select the expense category, date, and amount.
3. Attach a receipt (required for amounts above the receipt threshold set by your company).
4. Select the cost center / division.
5. Click **Submit for Approval**.

### Expense Approval Workflow
- The expense is routed to the configured approver (typically the departmental manager or Finance Controller).
- Approver receives a notification and reviews the expense.
- Approver can **Approve**, **Reject**, or **Request More Info**.
- Rejected expenses are returned to the submitter with a reason.

### Paying an Approved Expense
1. Navigate to **Finance → Expenses → Approved**.
2. Select the expense(s) to pay.
3. Click **Record Payment**, select the cash/bank account, and enter the payment date and reference.
4. A journal entry is automatically posted: Debit Expense Account / Credit Cash Account.

---

## 5. Accounts Receivable (AR) and AR Aging

### Recording a Receivable
Receivables are created automatically when a sales invoice is posted or can be manually entered:
1. Navigate to **Finance → Receivables → New Invoice**.
2. Select the customer, due date, and line items.
3. Post the invoice — AR balance is updated.

### AR Aging Report
Navigate to **Finance → Reports → AR Aging**. The report shows outstanding customer balances bucketed by age:
- Current (0–30 days)
- 31–60 days
- 61–90 days
- Over 90 days (bad debt risk)

Use the aging report for credit control and collection follow-up.

---

## 6. Accounts Payable (AP) and AP Aging

### Recording a Supplier Invoice
1. Navigate to **Finance → Payables → New Invoice**.
2. Select the supplier, invoice date, due date, and line items.
3. Match to a Purchase Order if applicable (three-way match).
4. Post the invoice.

### AP Aging Report
Navigate to **Finance → Reports → AP Aging** to view what is owed to suppliers, aged by due date. Use this to plan cash outflows and avoid late payment penalties.

---

## 7. Cash Accounts

ITEMBA-R maintains a ledger for each cash account (petty cash, till cash, bank accounts):

1. Navigate to **Finance → Cash Accounts**.
2. Each account shows the current balance and recent transactions.
3. To record a cash receipt: **Cash Accounts → Record Receipt** — select account, amount, payer, and reference.
4. To record a cash payment: **Cash Accounts → Record Payment** — select account, payee, amount.

---

## 8. Inter-Company Transactions

For transactions between group companies (e.g., Itemba Enterprises providing logistics services to Mwanjalisi Oil):

1. Navigate to **Finance → Inter-Company Transactions → New**.
2. Select the **source company** and **target company**.
3. Enter the transaction type (charge, loan, transfer), amount, and description.
4. ITEMBA-R posts **mirror journal entries** in both companies:
   - Source company: Debit Inter-Company Receivable / Credit Revenue
   - Target company: Debit Expense / Credit Inter-Company Payable
5. Inter-company balances must be reconciled before period close.

---

## 9. Financial Statements

### Trial Balance
**Finance → Reports → Trial Balance** — shows all GL account balances at a given date. Verify that total debits equal total credits.

### Profit & Loss (P&L)
**Finance → Reports → Profit & Loss** — Revenue minus Cost of Sales gives Gross Profit. Gross Profit minus Operating Expenses gives Net Profit.

### Balance Sheet
**Finance → Reports → Balance Sheet** — Assets = Liabilities + Equity. Verify the balance sheet balances before presenting to management.

All financial statements can be filtered by period, compared to prior periods, and exported to PDF or Excel.

---

## 10. Period Close Procedure

1. Complete all transactions for the period.
2. Run the **Trial Balance** — verify it balances.
3. Post all outstanding accruals and prepayments.
4. Run **Depreciation** for the period (Finance → Depreciation → Run Depreciation).
5. Reconcile all bank accounts.
6. Reconcile inter-company balances.
7. Review AR and AP aging — provision for bad debts if required.
8. Navigate to **Finance → Fiscal Periods** and click **Close Period**.
9. Run the final P&L and Balance Sheet — save copies as PDFs for the period file.

---

## 11. Bank Reconciliation

1. Navigate to **Finance → Bank Reconciliation**.
2. Select the bank account and the reconciliation period.
3. Enter the closing bank statement balance.
4. The system displays GL transactions for the period.
5. Match each GL transaction to the bank statement line.
6. Unmatched items are flagged — investigate and resolve.
7. When the GL balance (adjusted for timing differences) equals the bank statement balance, click **Complete Reconciliation**.
8. The reconciliation report is saved and audit-logged.

---

## 12. Depreciation

ITEMBA-R calculates depreciation for all active fixed assets in the Fixed Assets Registry.

1. Navigate to **Finance → Depreciation → Run Depreciation**.
2. Select the fiscal period.
3. Click **Preview** — a list of all assets with calculated depreciation amounts is shown.
4. Review — adjust any assets if needed.
5. Click **Post Depreciation** — journal entries are posted for each asset: Debit Depreciation Expense / Credit Accumulated Depreciation.
6. The Fixed Assets Registry NBV is automatically updated.
