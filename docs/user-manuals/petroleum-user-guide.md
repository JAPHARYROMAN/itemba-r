# Petroleum Operations User Guide — Mwanjalisi Oil Co. Ltd

## Overview

This guide covers the Petroleum module for **Mwanjalisi Oil Co. Ltd**, including fuel tank management, pump and nozzle configuration, shift operations (opening, recording readings, collecting payments, closing), tank dips and fuel deliveries, credit sales, daily reconciliation, and petroleum-specific reports.

---

## 1. Fuel Tank Setup

Before shift operations can begin, fuel tanks must be configured.

### Adding a Tank
1. Navigate to **Petroleum → Tanks → New Tank**.
2. Enter the **tank name/number** (e.g., Tank 1 – Diesel), **fuel type** (Diesel, Petrol/PMS, Kerosene), and **capacity in litres**.
3. Enter the **current dipstick reading** (opening stock).
4. Set the **dead stock level** (minimum safe operating level).
5. Set the **reorder level** to trigger low-stock alerts.
6. Click **Save**.

### Tank Status
Each tank shows real-time status:
- Current theoretical stock (calculated from deliveries minus sales)
- Last dip reading and variance
- Active pumps assigned to this tank

---

## 2. Pump and Nozzle Configuration

### Adding a Pump
1. Navigate to **Petroleum → Pumps → New Pump**.
2. Enter the pump number, location (e.g., Island 1), and the tank it draws from.
3. Click **Save**.

### Adding Nozzles to a Pump
Each pump has one or more nozzles (typically 2–4):
1. Open the pump record and click **Add Nozzle**.
2. Enter the nozzle number and fuel type.
3. Enter the **current meter reading** (from the physical nozzle display — this is the opening cumulative meter).
4. Click **Save**.

> **Important:** Nozzle meter readings are cumulative (they never reset to zero). ITEMBA-R calculates volume sold by comparing closing meter to opening meter for each shift.

---

## 3. Fuel Prices

### Setting the Current Price
1. Navigate to **Petroleum → Fuel Prices → New Price**.
2. Select the fuel type (Diesel, PMS, Kerosene).
3. Enter the **selling price per litre** in TZS.
4. Enter the **effective date**.
5. Click **Save**.

Price changes take effect immediately for new shifts opened after the effective date. Active shifts retain the price at which they were opened.

> Fuel prices in Tanzania are regulated by EWURA. Ensure prices comply with the current EWURA-published pump prices.

---

## 4. Opening a Fuel Shift

A **shift** represents one operational session at the fuel station — typically an 8-hour or 12-hour block.

### Opening a Shift
1. Navigate to **Petroleum → Shifts → Open New Shift**.
2. Select the **shift date** and **shift time** (Morning, Afternoon, Night — or custom).
3. Select the **attendant** (linked to an employee record).
4. Click **Add Nozzles to Shift** and select all active nozzles for this shift.
5. For each nozzle, confirm the **opening meter reading** (read from the physical pump display).
6. Verify the opening readings — an alert is shown if the reading is lower than the previous closing reading (this indicates a data entry error).
7. Click **Open Shift**.

---

## 5. Recording Nozzle Readings

Throughout the shift or at shift close, the attendant records the closing nozzle meter readings.

### Recording Closing Readings
1. Navigate to **Petroleum → Shifts → [Active Shift] → Record Readings**.
2. For each nozzle, enter the **closing meter reading** from the physical pump display.
3. ITEMBA-R calculates: **Volume Sold = Closing Reading – Opening Reading**.
4. The system multiplies volume by the current fuel price to give the **expected collection** for each nozzle.
5. If a nozzle had test sales or maintenance mode (pump test), enter those volumes separately so they are excluded from revenue.

---

## 6. Recording Collections

Collections are the cash, mobile money, or card payments collected during the shift.

### Adding a Collection Entry
1. From the active shift, navigate to the **Collections** tab.
2. Click **Add Collection**.
3. Select the **payment method**: Cash, M-Pesa, Airtel Money, TigoPesa, Credit Account, POS Card.
4. Enter the **amount collected**.
5. For M-Pesa/Airtel/Tigo payments, enter the transaction reference number.
6. For credit account sales, select the customer.
7. Repeat for all payment methods used.

Total collections are shown and compared against the expected collection from nozzle readings.

---

## 7. Closing a Shift

### Shift Close Procedure
1. From the active shift, click **Close Shift**.
2. Review the **shift summary**:
   - Total volume sold per fuel type
   - Total expected revenue
   - Total collections recorded
   - **Variance** = Expected Revenue – Total Collections
3. A small variance (within tolerance, typically TZS 5,000) is acceptable.
4. For variances above tolerance, the system requires a **variance explanation**.
5. Enter the closing time and click **Confirm Close**.

### Shift Status after Close
- The shift moves to **Closed** status.
- Collections are posted to the cash accounts.
- Revenue journal entries are generated automatically.
- The shift is locked — no further edits are possible.

---

## 8. Tank Dips

A **dip reading** is a physical measurement of fuel remaining in a tank using a dipstick.

### Recording a Dip
1. Navigate to **Petroleum → Tank Dips → New Dip**.
2. Select the tank and enter the dip date and time.
3. Enter the measured dip in **millimetres or litres** (depending on configuration).
4. ITEMBA-R converts the dip measurement to litres using the tank's calibration chart.
5. The system shows the **theoretical stock** vs. the **measured dip** and highlights any significant variance.

Dip variances may indicate evaporation, leakage, meter tampering, or dipstick measurement error. Significant variances require investigation and documentation.

---

## 9. Fuel Deliveries

### Recording a Fuel Delivery
1. Navigate to **Petroleum → Deliveries → New Delivery**.
2. Enter the delivery date, supplier (e.g., TotalEnergies, Lake Oil, Gapco), and delivery note number.
3. Select the destination tank.
4. Enter the **quantity delivered in litres** (from the waybill/delivery note).
5. Enter the **invoice price per litre** (cost price).
6. Upload the delivery note and invoice.
7. Click **Save**.

The delivered quantity is added to the tank's theoretical stock. A cost of goods received journal entry is posted automatically.

---

## 10. Credit Sales

For corporate accounts (fleet companies, government, NGOs) purchasing on credit:

1. Navigate to **Petroleum → Credit Sales → New Credit Sale**.
2. Select the credit customer from the registered accounts.
3. Enter the date, nozzle/pump, fuel type, and litres dispensed.
4. Or link to the shift nozzle readings for credit portions.
5. A receivable is created in the AR module automatically.
6. Monthly statements are generated per credit customer.

---

## 11. Daily Reconciliation

The **Daily Reconciliation** report is the key management report for Mwanjalisi Oil.

1. Navigate to **Petroleum → Reports → Daily Reconciliation**.
2. Select the date.
3. The report shows:
   - Opening stock per tank
   - Deliveries received
   - Theoretical closing stock
   - Volume sold (from shift readings)
   - Closing theoretical balance
   - Dip reading (physical measurement)
   - Over/Short variance
   - Revenue by payment method
   - Collections by attendant and shift

---

## 12. Petroleum Reports

| Report | Description |
|---|---|
| **Daily Reconciliation** | Tank balance, sales, collections, variances |
| **Shift Summary** | Per-shift attendant sales and collection |
| **Monthly Fuel Sales** | Volume and revenue by fuel type |
| **Nozzle Performance** | Volume sold per nozzle |
| **Tank Movement Report** | All tank-level movements (deliveries, sales, dips) |
| **Credit Account Statement** | Outstanding balance per credit customer |
| **Fuel Purchase History** | Supplier deliveries and unit cost trend |
| **Daily Cash by Payment Method** | M-Pesa, cash, Airtel split per day |
