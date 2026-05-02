# Rentals & Parking User Guide

## Overview

This guide covers two operational areas under **Mwanjalisi Oil Co. Ltd** and **Itemba Enterprises Co. Ltd**:
1. **Property Rentals** — residential and commercial rental units, tenant management, leases, invoicing, and collections.
2. **Truck Parking Facility** — vehicle entry/exit management, payment collection, and parking reports.

---

## Part A: Property Rentals

### 1. Rental Properties and Units Setup

#### Adding a Rental Property
1. Navigate to **Rentals → Properties → New Property**.
2. Enter the property name, address, and type (Residential, Commercial, Mixed Use).
3. Assign the property to the owning company (Mwanjalisi Oil or Itemba Enterprises).
4. Enter total land area and number of units.
5. Upload the title deed (linked to Group Control Documents Vault).
6. Click **Save**.

#### Adding Units to a Property
1. Open the property record and click **Add Unit**.
2. Enter the unit reference (e.g., Flat 1A, Shop 3, Office Suite B).
3. Select unit type: Studio, 1-Bedroom, 2-Bedroom, Commercial Shop, Office.
4. Enter floor area (m²) and facilities (parking, garden, electricity meter number, water meter number).
5. Set the **standard rent** (TZS per month).
6. Mark as **Available** or **Occupied**.
7. Click **Save**.

### 2. Tenant Management

#### Adding a Tenant
1. Navigate to **Rentals → Tenants → New Tenant**.
2. Enter tenant type: Individual or Company.
3. For individuals: full name, national ID or passport number, phone, email.
4. For companies: company name, TIN, contact person, registered address.
5. Upload the tenant's identification document.
6. Click **Save**.

#### Tenant History
Each tenant record shows their full rental history: current and past leases, payment history, outstanding balance, and any breach notices.

### 3. Lease Agreements

#### Creating a Lease
1. Navigate to **Rentals → Leases → New Lease**.
2. Select the property unit and tenant.
3. Enter:
   - Lease start date and end date
   - Monthly rent amount (TZS)
   - Security deposit amount
   - Rent advance (number of months)
   - Payment due date (e.g., 1st of each month)
   - Grace period (days before late fee applies)
   - Late payment fee (TZS or percentage)
4. Set the lease type: Fixed Term or Periodic (month-to-month).
5. Upload the signed lease agreement document.
6. Click **Activate Lease**.
7. The security deposit invoice is automatically created.

#### Lease Renewals
1. Open the expiring lease and click **Renew Lease**.
2. Adjust the rent amount and enter the new end date.
3. A renewal agreement document is generated for signing.
4. Upload the signed renewal.
5. Click **Activate Renewal**.

#### Lease Termination
1. Open the lease and click **Terminate Lease**.
2. Enter the notice date, effective termination date, and reason.
3. The system calculates any outstanding rent, penalties, or security deposit refund.
4. Process the deposit refund or deduction.
5. Update the unit status to **Available** after tenant vacates.

### 4. Rent Invoices and Payments

#### Generating Rent Invoices
Rent invoices are generated automatically at the start of each billing period:
1. Navigate to **Rentals → Invoices → Generate Monthly Invoices**.
2. Select the billing month.
3. Review the list of leases with rent amounts due.
4. Click **Generate** — invoices are created for all active leases.
5. Invoices are sent to tenants via email automatically (if email is configured).

#### Recording a Rent Payment
1. Navigate to **Rentals → Payments → Record Payment**.
2. Select the tenant and the invoice being paid.
3. Enter the payment date, amount, and payment method (Cash, M-Pesa, Bank Transfer).
4. For bank transfers, enter the bank reference number.
5. Click **Save** — the invoice is marked Paid and the AR balance is updated.

#### Handling Partial Payments
If a tenant pays less than the full amount:
1. Record the partial payment amount.
2. The system marks the invoice as **Partially Paid** and shows the outstanding balance.
3. The outstanding amount carries forward to the next period.

### 5. Rental Aging and Reports

#### Rental Aging Report
Navigate to **Rentals → Reports → Rental Aging** to see outstanding rent balances:
- Current (current month)
- 1 month overdue
- 2 months overdue
- 3+ months overdue (potential eviction trigger)

Use the aging report for rent collection follow-up. Generate and send account statements to tenants with outstanding balances.

#### Key Rental Reports

| Report | Description |
|---|---|
| **Occupancy Summary** | Occupied vs. vacant units across all properties |
| **Rental Income Report** | Monthly rent income by property |
| **Lease Expiry Calendar** | Leases expiring in next 30/60/90 days |
| **Security Deposit Ledger** | Deposits held, applied, and refunded |
| **Late Payment Report** | Tenants with habitual late payments |
| **Vacancy Report** | Units vacant with duration of vacancy |

---

## Part B: Truck Parking Facility

Mwanjalisi Oil operates a **truck parking facility** adjacent to the fuel station. The Parking module manages vehicle entry, parking fees, and payments.

### 6. Truck Parking Facility Setup

1. Navigate to **Parking → Facility Setup**.
2. Enter the facility name, location, and total parking bays.
3. Set bay types: Standard Truck, Extra-Long Truck, Light Vehicle.
4. Configure pricing:
   - Rate type: Hourly, Daily, or Weekly
   - Rate per bay type in TZS
5. Set operating hours (or 24/7).
6. Assign parking staff (attendants).

### 7. Parking Sessions (Entry/Exit)

#### Recording Vehicle Entry
1. Navigate to **Parking → Sessions → New Session**.
2. Select the bay or let the system auto-assign the next available bay.
3. Enter the vehicle registration plate number.
4. Select the vehicle type.
5. Enter the driver's name and phone number (optional).
6. Note the purpose of visit (in transit, loading, fueling, overnight).
7. Click **Check In** — the entry timestamp is recorded.

#### Recording Vehicle Exit
1. Navigate to **Parking → Sessions → Active Sessions**.
2. Find the vehicle by registration number or bay number.
3. Click **Check Out**.
4. The system calculates the parking duration and fee due.
5. Select the payment method.
6. Process payment and click **Confirm Exit**.
7. The bay is marked as available.

#### Extended Stay
For trucks staying more than 24 hours:
1. The system automatically applies daily rates after the first 24 hours.
2. Send a daily notification to the truck driver/company for extended stays.
3. For trucks staying without payment beyond the configured threshold, the system flags the session for management attention.

### 8. Payment Collection

Payment methods accepted at the truck parking facility:
- **Cash** — attendant collects and enters in the system
- **M-Pesa** — Paybill or Till number, enter reference
- **Airtel Money / TigoPesa** — enter transaction reference
- **Credit Account** — for transport companies with accounts (monthly billing)

All payments are recorded per session and posted to the revenue GL account.

### 9. Parking Reports

| Report | Description |
|---|---|
| **Daily Parking Summary** | Number of vehicles, total revenue, payment method breakdown |
| **Bay Utilization Report** | Occupancy rate per bay type per day |
| **Session History** | All sessions with durations and fees |
| **Extended Stay Report** | Vehicles staying beyond 24 hours |
| **Monthly Revenue Report** | Parking revenue by month |
| **Credit Account Statements** | Outstanding balances for corporate parking accounts |
| **Shift Handover Report** | Collections per attendant per shift |
