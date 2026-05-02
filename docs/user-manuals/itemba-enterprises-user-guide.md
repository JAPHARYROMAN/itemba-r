# Itemba Enterprises Co. Ltd — Operations User Guide

## Overview

**Itemba Enterprises Co. Ltd** operates across four major divisions: **Logistics**, **Agriculture**, **Construction**, and overview dashboards. Each division has its own operational workflows within ITEMBA-R. This guide covers each division in detail.

---

## Division 1: Logistics

Itemba Enterprises provides road transport and logistics services within Tanzania. The Logistics module manages vehicles, drivers, trips, fuel consumption, maintenance, and trip billing.

### 1.1 Vehicle Fleet Setup

1. Navigate to **Itemba → Logistics → Vehicles → New Vehicle**.
2. Enter the vehicle details:
   - Registration number (e.g., T 123 ABC)
   - Vehicle type (Truck, Pickup, Tanker, Trailer, Light Vehicle)
   - Make, model, and year
   - Carrying capacity (tonnes or cubic metres)
   - Current odometer reading
   - Insurance expiry date
   - Road worthiness certificate expiry
   - TRA vehicle license expiry
3. Upload vehicle documents (insurance, road licence, logbook).
4. Set **maintenance schedule** — based on kilometres or calendar interval.
5. Click **Save**.

### 1.2 Driver Management

1. Navigate to **Itemba → Logistics → Drivers → New Driver**.
2. Link to the employee record.
3. Enter driving licence number, class, and expiry date.
4. Enter Police clearance certificate date.
5. Record driver's medically fitness certificate.
6. Assign primary and secondary vehicles.
7. The system alerts when licences or certificates are approaching expiry.

### 1.3 Trip Management

#### Creating a Trip
1. Navigate to **Itemba → Logistics → Trips → New Trip**.
2. Enter: origin, destination, trip date, expected return date.
3. Select vehicle and driver.
4. Enter the cargo/load description, weight, and customer (who is paying for the trip).
5. Enter the agreed trip rate or link to a customer contract.
6. Click **Start Trip**.

#### Recording Trip Progress
- Update trip status: Loaded, In Transit, Delivered, Returned.
- Record delays and reasons.
- Record fuel issued for the trip (see section 1.4).

#### Closing a Trip
1. Open the trip and click **Close Trip**.
2. Enter the return odometer reading.
3. Record actual fuel consumed vs. issued.
4. Note any incidents, damage, or deviations.
5. Generate the **Trip Billing Invoice** for the customer.

### 1.4 Fuel Tracking for Vehicles

For each vehicle fuel fill:
1. Navigate to **Itemba → Logistics → Fuel Issues → New Issue**.
2. Select the vehicle, driver, and date.
3. Enter litres issued, fuel station or internal tank, cost per litre, and total cost.
4. Enter the odometer reading at fill.
5. Click **Save**.

The system tracks fuel efficiency (km per litre) per vehicle. Significant deviations from the vehicle's expected efficiency trigger alerts.

### 1.5 Vehicle Maintenance

#### Scheduling Maintenance
1. Navigate to **Itemba → Logistics → Maintenance → New Work Order**.
2. Select the vehicle and maintenance type (Scheduled Service, Repair, Tyre Change, Inspection).
3. Enter the service provider (garage name) and expected cost.
4. Set the status to **Scheduled** or **In Progress**.

#### Recording Completed Maintenance
1. Open the work order and click **Mark Complete**.
2. Enter the actual cost, date completed, and work performed.
3. Update the odometer and next service due.
4. Upload the garage invoice.
5. A payable is created in Finance for the maintenance cost.

### 1.6 Trip Billing

Monthly invoicing for logistics customers:
1. Navigate to **Itemba → Logistics → Billing → Generate Invoices**.
2. Select the billing period and customer(s).
3. The system compiles all completed trips for the customer in the period.
4. Review and confirm.
5. Post invoices to Accounts Receivable.

---

## Division 2: Agriculture

Itemba Enterprises conducts agricultural operations including farm management, crop production, input procurement, harvest tracking, and produce sales.

### 2.1 Farm Setup

1. Navigate to **Itemba → Agriculture → Farms → New Farm**.
2. Enter farm name, location (region, district, ward), total area (hectares), and ownership status (owned, leased).
3. Map farm plots/fields as sub-units with their sizes.
4. Record soil type and irrigation status.

### 2.2 Crop and Season Management

#### Creating a Season
1. Navigate to **Itemba → Agriculture → Seasons → New Season**.
2. Enter season name (e.g., Long Rains 2025), start and end dates, and primary crop.
3. Link to one or more farms/plots.

#### Crop Planning
1. Within a season, click **Add Crop Plan**.
2. Select the crop (Maize, Rice, Sunflower, Vegetables, etc.).
3. Enter planned area, expected yield per hectare, and target market.

### 2.3 Agricultural Inputs

Record all inputs used (seeds, fertilizers, pesticides, herbicides, labour):

1. Navigate to **Itemba → Agriculture → Inputs → Record Input**.
2. Select the season, farm/plot, and date.
3. Select the input type and product (linked to inventory).
4. Enter quantity used and unit cost.
5. The system tracks total input cost per crop per season.

### 2.4 Harvest Recording

1. Navigate to **Itemba → Agriculture → Harvests → Record Harvest**.
2. Select the season and crop.
3. Enter harvest date, field, quantity harvested (kg or bags), and grade/quality.
4. Record the harvest team or contractor.
5. Harvested produce enters the **Produce Inventory**.

### 2.5 Produce Inventory and Sales

Agricultural produce is managed in inventory:
- View current produce stock at **Itemba → Agriculture → Produce Inventory**.
- Create sales orders for produce buyers (millers, traders, direct buyers).
- Issue delivery notes and invoices following the standard Sales workflow.

---

## Division 3: Construction

Itemba Enterprises undertakes construction projects (residential, commercial, infrastructure). The Construction module manages projects, Bills of Quantities, materials, labour, subcontractors, and progress billing.

### 3.1 Project Setup

1. Navigate to **Itemba → Construction → Projects → New Project**.
2. Enter project name, client name, location, contract value, start date, and expected completion date.
3. Link to the signed construction contract (upload in Group Control → Contracts).
4. Set the project manager (employee).
5. Click **Save**.

### 3.2 Bill of Quantities (BOQ)

1. From the project record, click **Create BOQ**.
2. Add BOQ sections (e.g., Substructure, Superstructure, Roofing, Finishes, External Works).
3. Within each section, add line items:
   - Description of work
   - Unit (m², m³, Lm, No., Sum)
   - Quantity
   - Rate (unit price)
   - Amount (auto-calculated)
4. The BOQ total gives the contract value breakdown.
5. Approved BOQ serves as the budget baseline.

### 3.3 Materials Management

#### Material Requisition
1. Navigate to **Itemba → Construction → Materials → New Requisition**.
2. Link to the project and BOQ item.
3. Enter materials needed, quantities, and required date.
4. Submit for approval — triggers Procurement RFQ workflow.

#### Materials Delivered to Site
- Record site deliveries via GRN (linked to construction project).
- Materials are tracked per project for cost allocation.

### 3.4 Labour Recording

1. Navigate to **Itemba → Construction → Labour → Daily Attendance**.
2. Select the project and date.
3. Record workers present, hours worked, and trade category.
4. Daily labour cost is calculated from the rate per trade.
5. Weekly labour summaries feed into project cost reports.

### 3.5 Subcontractor Management

1. Navigate to **Itemba → Construction → Subcontractors → New Subcontract**.
2. Select the project and scope of work (BOQ items).
3. Enter subcontractor name, contract value, start date.
4. Record progress claims and payments.
5. Retention percentages are tracked and released at practical completion.

### 3.6 Progress Billing

For client invoicing based on construction progress:
1. Navigate to **Itemba → Construction → Progress Claims → New Claim**.
2. Select the project and billing period.
3. Enter percentage complete per BOQ section.
4. The system calculates the claim value based on BOQ rates and completion percentages.
5. Deduct previous claims and retention.
6. Generate the progress certificate for client approval.
7. Once approved, post the invoice to AR.

---

## Division Overview Dashboards

Navigate to **Itemba → Dashboard** for the Itemba Enterprises overview:

| Widget | Description |
|---|---|
| **Active Trips** | Vehicles currently in transit with last known status |
| **Fleet Utilization** | % of fleet on active trips vs. available |
| **Crop Season Status** | Current season progress by farm |
| **Active Projects** | Construction projects with % complete and schedule status |
| **Revenue by Division** | Revenue breakdown: Logistics, Agriculture, Construction |
| **Alerts** | Overdue maintenance, expiring licences, project delays |
