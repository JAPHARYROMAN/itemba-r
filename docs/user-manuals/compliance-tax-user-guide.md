# Compliance & Tax User Guide

## Overview

The Compliance & Tax module helps all Itemba Group companies manage their regulatory obligations under Tanzanian law — including TRA tax registration and filings, BRELA compliance, business licenses, insurance, and other regulatory requirements. The module provides structured workflows for tracking, filing, and evidencing compliance.

---

## 1. Tax Registration (TRA Compliance)

### Recording Company TIN
Each company's TIN (Taxpayer Identification Number) is recorded in the company profile:
1. Navigate to **Group Control → Company Profiles → [Company]**.
2. Verify the TIN number is entered and correct.
3. Upload the TIN certificate.

### VAT Registration
For VAT-registered companies:
1. Navigate to **Compliance → Tax → VAT Registration**.
2. Enter the VAT registration number and effective date.
3. Upload the VAT registration certificate.
4. Set the VAT filing frequency (monthly, quarterly — as assigned by TRA).

---

## 2. Tax Types and Rates

ITEMBA-R comes pre-configured with standard Tanzanian taxes:

| Tax Type | Rate | Applicability |
|---|---|---|
| **VAT (Value Added Tax)** | 18% | Standard-rated goods and services |
| **VAT – Zero Rated** | 0% | Exports, certain agricultural inputs |
| **VAT – Exempt** | N/A | Exempt supplies (basic foodstuffs, medical) |
| **PAYE** | Graduated | Employee salaries (see HR module) |
| **Corporate Income Tax (CIT)** | 30% | Annual company profits |
| **Withholding Tax – Services** | 5% | Payments to resident service providers |
| **Withholding Tax – Rent** | 10% | Rental payments |
| **Withholding Tax – Dividends** | 5% / 10% | Resident / non-resident dividends |
| **Skills and Development Levy (SDL)** | 4.5% | On gross payroll |
| **NSSF Employer Contribution** | 10% | On gross salary |

### Adding Custom Tax Rates
For special tax treatments:
1. Navigate to **Compliance → Tax → Tax Rates → New Rate**.
2. Enter the tax name, type, and rate.
3. Set the effective date.
4. Assign to product categories or account codes as needed.

---

## 3. Recording Tax Transactions

### VAT on Sales (Output Tax)
- VAT is automatically calculated on invoices based on the tax treatment set on each product.
- Output VAT is posted to the **VAT Output** GL account.

### VAT on Purchases (Input Tax)
- Input VAT is captured when supplier invoices are entered.
- Input VAT is posted to the **VAT Input** GL account.
- Ensure supplier TIN is recorded — TRA disallows input tax claims from non-TIN suppliers.

### Withholding Tax
When making payments subject to withholding tax:
1. Navigate to **Finance → Payments → [Payment] → Apply WHT**.
2. Select the WHT rate applicable.
3. The system deducts WHT from the payment and records the WHT liability.
4. Remit WHT to TRA by the 7th of the following month.

---

## 4. Filing Periods

### VAT Filing Period Setup
1. Navigate to **Compliance → Tax → Filing Periods → New Period**.
2. Select the tax type (VAT, PAYE, SDL, WHT, etc.).
3. Enter the period start date and end date.
4. Set the **due date** for filing and payment.
5. Assign the responsible staff member.
6. Click **Save**.

ITEMBA-R will send reminder alerts 7 days, 3 days, and 1 day before the due date.

---

## 5. Submitting Tax Returns

### VAT Return
1. Navigate to **Compliance → Tax → Returns → New VAT Return**.
2. Select the VAT period.
3. The system pulls all output VAT and input VAT transactions for the period.
4. Review the VAT summary:
   - Total output VAT (VAT collected on sales)
   - Total input VAT (VAT paid on purchases)
   - Net VAT payable = Output – Input
5. Verify the figures against the TRA portal.
6. Click **Mark as Filed** and enter the filing reference number from TRA e-Filing.
7. Upload the filed return document.
8. If VAT is payable, record the payment in Finance → Payments.

### PAYE Return
1. Navigate to **Compliance → Tax → Returns → New PAYE Return**.
2. Select the payroll period.
3. PAYE figures are pulled automatically from the approved payroll.
4. Review and confirm.
5. File on TRA e-Filing portal and record the filing reference.
6. Record PAYE payment (must be paid by the 7th of the following month).

### SDL Return
- SDL is 4.5% of gross payroll.
- SDL return is filed together with PAYE monthly.

### Corporate Income Tax
- Provisional CIT returns are filed twice a year (6th and 9th month of the tax year).
- Annual CIT return is filed within 6 months of the financial year end.
- Navigate to **Compliance → Tax → Returns → New CIT Return** and follow the workflow.

---

## 6. Compliance Obligations

### Viewing Compliance Obligations
1. Navigate to **Compliance → Obligations**.
2. A comprehensive list of all regulatory obligations is displayed:
   - Description of obligation
   - Regulatory authority (TRA, BRELA, OSHA, EWURA, Municipal Council, etc.)
   - Frequency (Monthly, Quarterly, Annual, One-time)
   - Due date
   - Responsible person
   - Status: Pending, Filed, Overdue, Waived

### Adding a Compliance Obligation
1. Navigate to **Compliance → Obligations → New Obligation**.
2. Enter the obligation name, authority, frequency, and responsible staff.
3. Set the next due date.
4. Click **Save**.
5. The system automatically creates the next occurrence when the current one is marked complete.

---

## 7. Business Licenses

### Managing Business Licenses
All operating licenses must be registered and tracked:

| License Type | Authority | Typical Frequency |
|---|---|---|
| **Business License** | Municipal/District Council | Annual |
| **TBS Certification** | Tanzania Bureau of Standards | Annual/Per Product |
| **TFDA License** | Tanzania Food and Drugs Authority | Annual |
| **EWURA License** | Energy and Water Utilities Regulatory Authority | Annual (Petroleum) |
| **OSHA Certificate** | Occupational Safety and Health Authority | Annual |
| **Fire Certificate** | Fire and Rescue Force | Annual |
| **Liquor License** | Municipal Council | Annual (Westsides/Hospitality) |
| **Tourism License** | Tourism Division | Annual (Uzunguni Inn) |

### Adding a License Record
1. Navigate to **Compliance → Licenses → New License**.
2. Select the company and license type.
3. Enter the license number, issue date, and **expiry date**.
4. Upload the license certificate.
5. The system sends renewal reminders 60, 30, and 7 days before expiry.

---

## 8. Document Requirements and Evidence Packs

For each compliance obligation, ITEMBA-R allows you to attach evidence:

1. Open a compliance obligation or filing record.
2. Click **Attach Evidence**.
3. Upload supporting documents (filed return copy, payment receipt, license, correspondence).
4. Documents are stored in the Compliance Documents area and linked to the obligation.
5. The **Evidence Pack** can be exported as a PDF bundle for auditor review.

---

## 9. Regulatory Reports

| Report | Description |
|---|---|
| **Compliance Calendar** | All obligations due in the next 30/60/90 days |
| **Overdue Obligations** | Obligations past their due date |
| **VAT Summary** | Monthly input/output VAT reconciliation |
| **PAYE Summary** | Monthly payroll tax by employee |
| **License Expiry Report** | Licenses expiring within 60 days |
| **Withholding Tax Ledger** | All WHT deducted and remitted |
| **SDL Summary** | Skills levy by payroll period |
| **Compliance Score** | Overall compliance completion rate by company |
