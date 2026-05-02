# Westsides Company Ltd — Operations User Guide

## Overview

This guide covers operations for **Westsides Company Ltd**, which operates in two major product lines: **Beverages** (alcoholic and non-alcoholic) and **Hardware & Building Materials**. Operations include product setup with batch tracking, point of sale (POS), wholesale and retail sales, quotations, delivery notes, returnable packaging management, damage and breakage recording, and Westsides-specific reports.

---

## 1. Beverage and Hardware Product Setup

### Beverage Products
1. Navigate to **Sales & Inventory → Products → New Product**.
2. Select category: **Beverages – Alcoholic** or **Beverages – Non-Alcoholic**.
3. Enter product name, SKU, brand, and size (e.g., Castle Lager 500ml, Sayona Juice 1L).
4. Set unit of measure: Bottle, Crate (e.g., 1 Crate = 24 Bottles — configure UOM conversion).
5. Set selling price per bottle and per crate.
6. Mark as **returnable packaging** if the bottle/crate is returnable (see section 7).
7. Set the reorder level and preferred supplier.

### Hardware Products
1. Navigate to **Sales & Inventory → Products → New Product**.
2. Select category: **Hardware & Building Materials**.
3. Enter product name, SKU, and description (e.g., Iron Sheet 28G 6ft, Cement 50kg, PVC Pipe 1/2″).
4. Set unit of measure: Sheet, Bag, Piece, Metre, Litre.
5. Set selling price and cost price.
6. Enter dimensions or specifications in the description field.

### Price Lists
Westsides maintains separate price lists for retail (walk-in customers) and wholesale (bulk buyers):
1. Navigate to **Sales & Inventory → Price Lists → New Price List**.
2. Name the price list (e.g., Retail Prices, Wholesale Prices, Contractor Prices).
3. Assign prices per product (or use a percentage markup/discount from the base price).
4. Assign customer groups to the appropriate price list — prices auto-populate when selecting those customers.

---

## 2. Product Batches and Expiry Tracking

For beverages and food products with manufacturing dates and expiry dates:

### Creating a Batch on Receipt
1. When a goods received note (GRN) is created for a beverage product, the system prompts for batch details.
2. Enter the **batch number** (from the supplier/manufacturer).
3. Enter the **manufacturing date** and **expiry date**.
4. Enter the quantity received in this batch.
5. Click **Save Batch**.

### Batch Tracking During Sales
- When creating a sales order or POS transaction for a batched product, the system shows available batches with remaining quantities and expiry dates.
- The system applies **FEFO (First Expiry First Out)** by default — the batch expiring soonest is allocated first.
- Staff can override FEFO if needed (with permission).

### Expiry Alerts
- Navigate to **Sales & Inventory → Batches → Expiry Alerts** to see products expiring within 30, 60, or 90 days.
- Products already expired are flagged in red and blocked from new sales.

---

## 3. POS Transactions

The **Point of Sale (POS)** is used for walk-in retail customers at Westsides outlets.

### Opening a POS Session
1. Navigate to **Westsides → POS → Open Session**.
2. Select the till/register and enter the opening cash float amount.
3. Click **Open Session**.

### Processing a Sale
1. Click **New Transaction**.
2. Search for products by name, SKU, or scan barcode.
3. Click to add products to the cart. Adjust quantities.
4. Apply a discount if authorized.
5. Select the payment method: Cash, M-Pesa, Airtel Money, TigoPesa, Card.
6. For cash payments: enter amount tendered — the system calculates change due.
7. Click **Complete Sale** to finalize.
8. Print or email the receipt.

### POS Returns
1. From the POS session, click **Return / Refund**.
2. Enter the original receipt number or search for the transaction.
3. Select items being returned and reason (defective, customer changed mind, wrong product).
4. Authorize the refund — a negative transaction is posted and inventory is updated.

### Closing a POS Session
1. Click **Close Session**.
2. Count the physical cash in the till.
3. Enter the closing cash count.
4. The system shows the expected closing cash and any variance.
5. Enter a variance explanation if needed.
6. Click **Confirm Close** — session summary is saved.

---

## 4. Wholesale and Retail Sales

For larger orders (wholesale customers, contractors, bulk buyers):

### Creating a Wholesale Sales Order
1. Navigate to **Sales & Inventory → Sales Orders → New Order**.
2. Select the wholesale customer.
3. Add line items with quantities and confirm prices from the wholesale price list.
4. Set delivery terms (pickup or delivery) and expected date.
5. Confirm the order and proceed to delivery note and invoice.

### Credit Sales for Wholesale Customers
- Wholesale customers can purchase on credit (within approved credit limit).
- Overdue credit balances trigger alerts to the Finance team.
- Monthly statements are generated and sent to credit customers.

---

## 5. Quotations and Delivery Notes

For customers requesting prices before ordering:
- Follow the standard Quotation workflow (see Sales & Inventory User Guide, Section 5).
- Westsides-specific: quotations for hardware often include material quantities for construction projects. Use the line item description field for detailed specifications.

Delivery notes for Westsides deliveries:
- Include the vehicle and driver details for deliveries.
- For beverage deliveries, the delivery note must list crate quantities and note any returnables collected.

---

## 6. Returnable Packages Management

Westsides handles returnable bottles and crates (glass beverage bottles, plastic crates).

### Setting Up Returnables
1. Navigate to **Westsides → Returnables → Package Types**.
2. Add each returnable type: Beer Bottle 500ml, Soda Bottle 350ml, Beer Crate 24-bottle, Juice Crate, etc.
3. Set the **deposit value** per unit (the amount charged to customers as returnable deposit).

### Charging Deposits on Sales
- When a sale includes returnable products, the system automatically adds a deposit charge for the packaging.
- The deposit appears as a separate line item on the invoice.
- The deposit is held as a liability (Returnable Deposits Payable) in the GL.

### Recording Returns
1. Navigate to **Westsides → Returnables → Record Return**.
2. Select the customer (or walk-in if no account).
3. Enter quantities returned by package type.
4. The deposit amount is refunded (cash, credit to account, or deducted from next invoice).
5. The GL entry reverses the deposit liability.

### Returnable Balance Report
Navigate to **Westsides → Reports → Returnable Balances** to see:
- Total packages outstanding per customer
- Total deposit liability
- Packages overdue for return

---

## 7. Damage and Breakage Recording

### Recording Damaged/Broken Goods
1. Navigate to **Westsides → Inventory → Damage Report → New Report**.
2. Select the date and location.
3. Enter the product, batch (if applicable), quantity damaged, and reason (transport damage, storage, handling).
4. Attach a photo of the damaged goods.
5. Submit for supervisor approval.
6. Once approved, inventory is reduced and a cost-of-goods-lost entry is posted to the GL.

### Supplier Claims for Damaged Goods
If damage occurred during delivery from supplier:
1. Create a **Supplier Damage Claim** linked to the GRN.
2. Document the claim and submit to the supplier.
3. Track the claim status (pending, accepted, credit note received, rejected).

---

## 8. Westsides Reports

| Report | Description |
|---|---|
| **Daily Sales Summary** | Revenue by product category, payment method, and location |
| **POS Session Report** | Till-by-till cash and payment analysis |
| **Wholesale Sales Report** | Bulk order sales and customer analysis |
| **Batch Expiry Report** | Products expiring within 30/60/90 days |
| **Returnable Package Balance** | Outstanding packages and deposits by customer |
| **Damage and Loss Report** | Stock losses, their causes, and financial impact |
| **Product Performance** | Best-selling and slow-moving products |
| **Credit Customer Aging** | Outstanding wholesale credit balances |
| **Stock Valuation** | Current inventory value by category and location |
