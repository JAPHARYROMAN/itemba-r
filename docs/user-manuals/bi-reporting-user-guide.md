# BI & Reporting User Guide

## Overview

The Business Intelligence (BI) & Reporting module provides executives, managers, and operational staff with real-time insights across all companies and modules. It includes executive dashboards, KPI tracking, standard report library, saved report views, data export, and module-specific BI dashboards.

---

## 1. Executive Dashboard

The Executive Dashboard is the primary entry point for senior management and the Group Director.

### Accessing the Executive Dashboard
Navigate to **BI & Reports → Executive Dashboard**.

### Dashboard Components

**Group Summary Row** — top-level metrics across all three companies:
- Total group revenue (month-to-date)
- Total group expenses (month-to-date)
- Net group profit (month-to-date)
- Total outstanding receivables
- Total outstanding payables
- Cash position (consolidated bank balances)

**Company Performance Cards** — one card per company (Mwanjalisi Oil, Westsides, Itemba Enterprises):
- Revenue vs. budget (progress bar)
- Net profit vs. prior month
- Key operational metric (fuel litres sold / POS transactions / active trips)

**Trend Charts**:
- 12-month revenue trend by company
- Expense trend vs. revenue (ratio chart)
- Cash flow trend

**Recent Activity Feed**: Latest high-value transactions, approved POs, completed shifts, payroll runs.

---

## 2. KPI Indicators and Snapshots

### Viewing KPIs
Navigate to **BI & Reports → KPIs** to see all configured Key Performance Indicators.

| KPI Category | Example KPIs |
|---|---|
| **Finance** | Revenue growth %, Gross margin %, Operating cost ratio, Current ratio |
| **Petroleum** | Daily litres sold, Fuel margin per litre, Shift variance %, Tank turnover rate |
| **Trading (Westsides)** | POS transactions per day, Average sale value, Stock turnover, Returnable return rate |
| **Logistics** | Fleet utilization %, Average revenue per trip, Fuel efficiency (km/l), On-time delivery rate |
| **Hospitality** | Occupancy %, Average Daily Rate (ADR), RevPAR, F&B revenue per room night |
| **HR** | Headcount by company, Payroll cost ratio, Leave utilization %, Staff turnover rate |
| **Compliance** | Compliance obligations on-time %, Open overdue obligations |

### KPI Snapshots
KPI Snapshots are saved at the end of each month:
1. Navigate to **BI & Reports → KPI Snapshots**.
2. Select the month and company.
3. View the historical snapshot — useful for performance reviews and board reporting.
4. Export the snapshot to PDF.

---

## 3. Running Standard Reports

### Accessing the Standard Report Library
Navigate to **BI & Reports → Reports**.

Reports are organized by category:

**Finance Reports**
- Trial Balance
- Profit & Loss (monthly, quarterly, annual)
- Balance Sheet
- Cash Flow Statement
- AR Aging
- AP Aging
- General Ledger Detail

**Petroleum Reports**
- Daily Reconciliation
- Shift Summary
- Monthly Fuel Sales
- Credit Account Statement
- Tank Movement Report

**Trading Reports (Westsides)**
- Daily Sales Summary
- POS Session Report
- Stock Valuation Report
- Product Performance
- Batch Expiry Report

**Logistics Reports**
- Trip Summary
- Fleet Utilization
- Fuel Efficiency by Vehicle
- Driver Performance

**Hospitality Reports**
- Daily Revenue Report
- Occupancy Report
- F&B Sales Report

**HR Reports**
- Payroll Summary
- Attendance Summary
- Leave Utilization Report
- Staff Headcount Report

**Compliance Reports**
- Compliance Calendar
- License Expiry Report
- VAT Summary
- PAYE Summary

### Running a Report
1. Click the report name.
2. Set the filter parameters (date range, company, department, etc.).
3. Click **Generate Report**.
4. The report loads with the data in tabular or chart format.
5. Use **Export to CSV** or **Export to PDF** as needed.

---

## 4. Creating Saved Views

Saved views allow you to save a report with specific filters for quick re-access.

### Saving a View
1. Run a report and configure the filters.
2. Click **Save View**.
3. Enter a name for the view (e.g., "Mwanjalisi Oil – Weekly Fuel Sales").
4. Choose whether the view is personal (only you) or shared (all users with access to this module).
5. Click **Save**.

### Accessing Saved Views
1. Navigate to **BI & Reports → Saved Views**.
2. Find your saved view and click to run it immediately with the saved filters.
3. Edit or delete saved views as needed.

---

## 5. Export to CSV and PDF

All reports support export:
- **Export to CSV**: Click the CSV button. A flat file is downloaded — suitable for Excel analysis.
- **Export to PDF**: Click the PDF button. A formatted report document is generated — suitable for sharing and archiving.

Exports are audit-logged (who exported what and when).

---

## 6. Data Quality Checks

### Running Data Quality Checks
Navigate to **BI & Reports → Data Quality → Run Check**.

ITEMBA-R checks for common data quality issues:
- Journal entries that don't balance (debit ≠ credit)
- Invoices without a corresponding GL entry
- Employees without payroll records for the current period
- Fixed assets with no depreciation posted
- Fuel shifts with large unexplained variances
- Inventory negative balances (indicates data entry errors)

Results are presented as a list of issues with severity (Critical / Warning / Info) and a link to the affected record.

Resolve issues and re-run the check before period close.

---

## 7. BI Dashboards by Module

Each module has a built-in BI dashboard:

### Petroleum BI Dashboard (Mwanjalisi Oil)
Navigate to **BI & Reports → Petroleum Dashboard**:
- Fuel sales trend (30 days rolling)
- Revenue by fuel type (Diesel vs. PMS)
- Daily variance history (shift variance trend)
- Tank stock levels
- Top 10 credit customers by outstanding balance

### Trading BI Dashboard (Westsides)
Navigate to **BI & Reports → Trading Dashboard**:
- Revenue split: Beverages vs. Hardware
- POS daily transaction count and revenue
- Top 10 best-selling products
- Stock aging analysis
- Returnable package recovery rate

### Itemba Enterprises BI Dashboard
Navigate to **BI & Reports → Itemba Dashboard**:
- Active trips map/list with status
- Logistics revenue by month
- Agricultural produce output by crop/season
- Construction project progress (% complete vs. schedule)
- Division revenue comparison

### Hospitality BI Dashboard (Uzunguni Inn)
Navigate to **BI & Reports → Hospitality Dashboard**:
- Occupancy % trend (30 days)
- Revenue by department (rooms, restaurant, bar)
- ADR and RevPAR trend
- Upcoming arrivals and departures

### HR BI Dashboard
Navigate to **BI & Reports → HR Dashboard**:
- Headcount by company and department
- Payroll cost by month
- Leave utilization rate
- Attendance trend (present % per week)

### Finance BI Dashboard
Navigate to **BI & Reports → Finance Dashboard**:
- Revenue vs. budget by company
- Expense ratio trend
- Working capital (current assets vs. current liabilities)
- Top 5 customers by outstanding receivables
- Top 5 suppliers by outstanding payables

---

## 8. Executive Insights and Recommendations

Navigate to **BI & Reports → Insights** for AI-assisted analysis of your data:

- **Anomaly Alerts**: Unusual spikes or drops in revenue, expenses, or stock levels.
- **Trend Analysis**: Automatically identified positive and negative trends across KPIs.
- **Recommendations**: Suggested actions based on data patterns (e.g., "Stock of Product X is below reorder level — consider raising a purchase requisition").
- **Comparative Analysis**: Month-on-month and year-on-year comparisons with variance explanations.

Insights are refreshed daily and are viewable only by users with BI access permissions.
