# Accounting Verification Plan

## 1. Purpose

The Accounting Verification Plan ensures the financial integrity of ITEMBA-R before go-live. Financial systems must be held to the highest verification standard: every transaction that records money must produce balanced double-entry journal entries, post to the correct GL accounts, and appear correctly in financial statements.

A single undetected accounting error in a live system can cascade through the general ledger and corrupt financial statements. This plan verifies accounting integrity across all revenue-generating and cost-recording workflows.

---

## 2. Trial Balance Verification

### TC-ACCT-TRIAL-001: Trial Balance Balances After Any Transaction
**Procedure:**
1. Record a transaction (journal entry, invoice, payment, or payroll).
2. Navigate to **Finance → Reports → Trial Balance**.
3. Verify: **Total Debits = Total Credits**.

**Expected:** The trial balance balances to zero variance at all times.

### TC-ACCT-TRIAL-002: Trial Balance Includes All Posted Transactions
**Procedure:**
1. Post 10 journal entries of varying amounts.
2. Run the Trial Balance for the same period.
3. Verify all 10 journals appear in the trial balance.

**Expected:** All posted journals are reflected. Draft journals do not appear.

---

## 3. Journal Entry Balance Checks

### TC-ACCT-JE-001: System Rejects Unbalanced Journal Entry
**Steps:** Attempt to save a journal entry where debits ≠ credits.
**Expected:** The system rejects the entry with an error: "Journal entry is not balanced."

### TC-ACCT-JE-002: System Rejects Posting to Closed Period
**Steps:** Set a period to Closed. Attempt to post a journal entry dated within that period.
**Expected:** The system rejects the entry with an error: "Period [name] is closed."

### TC-ACCT-JE-003: Journal Reversal Creates Mirror Entry
**Steps:** Post a journal entry. Click **Reverse Entry**.
**Expected:** A new journal entry is created in the current period with all debit and credit amounts exactly reversed. Both entries appear in the trial balance with zero net effect.

---

## 4. Posting Rule Validation

### TC-ACCT-POST-001: Fuel Shift Revenue Posts to Correct Accounts
**Steps:** Close a fuel shift with known total revenue.
**Expected GL entries:**
- Debit: Cash on Hand (or Mobile Money Clearing) — total collections amount
- Credit: Fuel Sales Revenue — same amount
**Verify:** Navigate to Finance → General Ledger → Fuel Sales Revenue account. The shift's revenue appears on the credit side.

### TC-ACCT-POST-002: Supplier Invoice Posts Correctly
**Steps:** Record and approve a supplier invoice for TZS 500,000 + 18% VAT = TZS 590,000.
**Expected GL entries:**
- Debit: Purchases/Expense account — TZS 500,000
- Debit: VAT Input — TZS 90,000
- Credit: Accounts Payable — TZS 590,000

### TC-ACCT-POST-003: Customer Invoice Posts Correctly
**Steps:** Post a customer invoice for TZS 300,000 + 18% VAT = TZS 354,000.
**Expected GL entries:**
- Debit: Accounts Receivable — TZS 354,000
- Credit: Sales Revenue — TZS 300,000
- Credit: VAT Output — TZS 54,000

### TC-ACCT-POST-004: Expense Payment Posts Correctly
**Steps:** Pay an approved expense of TZS 50,000 from the petty cash account.
**Expected GL entries:**
- Debit: Expense Account — TZS 50,000
- Credit: Petty Cash / Cash on Hand — TZS 50,000

### TC-ACCT-POST-005: Inventory Receipt Posts Correctly
**Steps:** Receive goods worth TZS 200,000.
**Expected GL entries:**
- Debit: Inventory — TZS 200,000
- Credit: Accounts Payable — TZS 200,000

---

## 5. Period Lock Enforcement

### TC-ACCT-LOCK-001: No Posting to Locked Period (All Transaction Types)
Test each transaction type against a closed period:
- [ ] Journal Entry → Expected: Rejected
- [ ] Sales Invoice → Expected: Rejected or forces current period
- [ ] Supplier Invoice → Expected: Rejected or forces current period
- [ ] Expense Payment → Expected: Rejected or forces current period
- [ ] Payroll → Expected: Cannot run payroll for a closed period

---

## 6. Bank Reconciliation Checks

### TC-ACCT-BANK-001: Reconciliation Clears When Matched
**Steps:**
1. Record a bank transfer of TZS 1,000,000 in the GL.
2. Open Bank Reconciliation for the same account.
3. Match the GL transaction to the bank statement line.
**Expected:** After matching, the reconciliation balance difference is zero.

### TC-ACCT-BANK-002: Unreconciled Items are Highlighted
**Steps:** Complete a bank reconciliation leaving 2 items unmatched.
**Expected:** The unmatched items remain in the "Unreconciled" section. The reconciliation cannot be marked complete until all items are matched or explained.

---

## 7. AR Aging Accuracy

### TC-ACCT-AR-001: AR Aging Matches Outstanding Invoices
**Steps:**
1. Create 3 invoices: one current, one 45 days old, one 75 days old.
2. Run the AR Aging Report.
**Expected:**
- Current invoice appears in the "0–30 days" bucket.
- 45-day invoice appears in the "31–60 days" bucket.
- 75-day invoice appears in the "61–90 days" bucket.
- Total AR aging matches the total AR account balance in the trial balance.

---

## 8. AP Aging Accuracy

### TC-ACCT-AP-001: AP Aging Matches Outstanding Supplier Invoices
Similar to AR aging: verify that AP aging totals match the AP GL account balance.

---

## 9. Payroll GL Reconciliation

### TC-ACCT-PAY-001: Payroll Journal Entry Balances
**Steps:** Run payroll for a period with 3 employees. Review the auto-generated journal entry.
**Expected:**
- Debit: Salaries Expense = Gross Pay total
- Credit: PAYE Payable = PAYE deducted total
- Credit: NSSF Payable (employee) = NSSF employee deducted total
- Credit: Net Salaries Payable = Net pay total
- Total Debits = Total Credits

### TC-ACCT-PAY-002: Employer NSSF Contribution Posted
**Expected:**
- Debit: NSSF Expense (employer) = 10% of gross pay
- Credit: NSSF Payable (employer) = same amount

---

## 10. Petroleum Revenue vs. Shift Collections

### TC-ACCT-PET-001: Shift Revenue = Nozzle Volume × Price
**Steps:** Close a shift where Nozzle 1 sold 500 litres at TZS 3,200/litre.
**Expected:**
- Expected revenue = TZS 1,600,000
- Collections recorded = TZS 1,600,000 (within tolerance)
- Revenue journal credit to Fuel Sales = TZS 1,600,000

### TC-ACCT-PET-002: Credit Sales Create AR, Not Cash Receipt
**Steps:** Record a credit sale of 100 litres to a corporate customer.
**Expected:**
- No cash collection for this sale.
- AR is debited (receivable created for the customer).
- Revenue is credited.

---

## 11. Rent Revenue vs. Invoices

### TC-ACCT-RENT-001: Monthly Rent Invoice Matches Lease Rate
**Steps:** Generate monthly invoices for a lease of TZS 250,000/month.
**Expected:** Invoice amount = TZS 250,000 (plus any applicable VAT). AR is debited by the invoice total.

---

## 12. Hospitality Revenue vs. Payments

### TC-ACCT-HOSP-001: Folio Total Matches Posted Revenue
**Steps:** Check out a guest with room charges TZS 180,000 + restaurant TZS 45,000 = TZS 225,000.
**Expected:**
- Payment of TZS 225,000 collected.
- Revenue journal: Credit Room Revenue TZS 180,000 + Credit F&B Revenue TZS 45,000.
- Debit Cash/Mobile Money TZS 225,000.

---

## 13. Financial Statement Accuracy

### TC-ACCT-FS-001: Balance Sheet Balances
After all transactions: **Total Assets = Total Liabilities + Total Equity**.

### TC-ACCT-FS-002: P&L Net Profit Matches Retained Earnings Movement
Net Profit on P&L = Change in Retained Earnings on Balance Sheet (when no dividends paid).

### TC-ACCT-FS-003: Reports Match Trial Balance
- P&L revenue total = sum of all revenue account balances in trial balance.
- Balance Sheet total assets = sum of all asset account balances in trial balance.
