# Sales & Inventory User Guide

## Overview

The Sales & Inventory module covers product catalog management, customer management, sales order processing, invoicing, delivery, and inventory control for all companies. For Westsides Company Ltd (beverages and hardware), this is a primary daily-use module. For Itemba Enterprises, it supports logistics and agricultural produce sales.

---

## 1. Product Catalog Setup

### Adding a Product
1. Navigate to **Sales & Inventory → Products → New Product**.
2. Enter the **product name**, **SKU code**, and **description**.
3. Select the **product category** (e.g., Beverages – Alcoholic, Beverages – Non-Alcoholic, Hardware, Fuel Accessories, Agricultural Produce).
4. Set the **unit of measure** (see section 2).
5. Set the **selling price** and **cost price**.
6. Configure **tax treatment** (VAT-inclusive, VAT-exclusive, or exempt).
7. Set the **reorder level** — the system will alert when stock falls below this quantity.
8. Upload a product image (optional).
9. Click **Save**.

### Product Variants
For products with multiple variants (e.g., a beverage in 500ml, 1L, and 5L sizes):
1. Open the product record.
2. Click **Add Variant**.
3. Specify the variant attribute (size, color, pack type) and value.
4. Set variant-specific price and SKU.

### Activating and Deactivating Products
- Use **Mark as Inactive** to hide discontinued products from sales order forms.
- Inactive products remain in inventory records and transaction history.

---

## 2. Units of Measure

ITEMBA-R supports custom units of measure and unit conversion chains.

### Adding a Unit of Measure
1. Navigate to **Sales & Inventory → Units of Measure → New UOM**.
2. Enter the unit name (e.g., Carton, Piece, Kg, Litre, Crate, Bag, Drum).
3. Set the base unit (for conversion calculations).
4. Example: 1 Carton = 12 Bottles. Enter the conversion factor.
5. Click **Save**.

Units of measure appear in product setup, purchase orders, sales orders, and inventory movements.

---

## 3. Customer Management

### Adding a Customer
1. Navigate to **Sales & Inventory → Customers → New Customer**.
2. Enter customer name, type (Individual or Company), and contact details.
3. For corporate customers, enter the TIN number (required for B2B invoicing).
4. Set the **credit limit** and **payment terms** (e.g., Net 30, Cash on Delivery).
5. Assign a **customer group** (Wholesale, Retail, Corporate Account, Walk-in).
6. Click **Save**.

### Customer Credit Accounts
For customers with credit accounts (e.g., fuel corporate accounts, wholesale customers):
1. Open the customer record → **Credit Account** tab.
2. Set the approved credit limit.
3. Transactions will be blocked if the outstanding balance exceeds the credit limit (configurable).

---

## 4. Creating Sales Orders

A Sales Order (SO) is the formal record of a customer's purchase.

### New Sales Order
1. Navigate to **Sales & Inventory → Sales Orders → New Order**.
2. Select the customer.
3. Enter the **order date** and expected **delivery/pickup date**.
4. Add line items: select product, quantity, unit price (auto-populated from price list, editable with permission).
5. Apply a discount if authorized.
6. Review the order total including VAT.
7. Click **Confirm Order**.

### Sales Order Status
| Status | Description |
|---|---|
| Draft | Not yet confirmed — can be edited freely |
| Confirmed | Order accepted — triggers delivery and invoice workflow |
| Delivered | Goods delivered, delivery note issued |
| Invoiced | Invoice raised and sent to customer |
| Paid | Payment received in full |
| Cancelled | Order cancelled — inventory returned to available stock |

---

## 5. Quotations and Proforma Invoices

For customers requesting a price before committing:

### Creating a Quotation
1. Navigate to **Sales & Inventory → Quotations → New Quotation**.
2. Select the customer and enter line items, quantities, and prices.
3. Set a **quotation validity date** (e.g., valid for 7 days).
4. Click **Save and Send** — the quotation is emailed to the customer.

### Converting to Sales Order
1. Open the quotation.
2. Click **Convert to Sales Order** — a Sales Order is created with all items pre-filled.
3. The quotation status changes to **Converted**.

### Proforma Invoice
Similar to a quotation but formatted as an invoice (used for import/export documentation):
1. Navigate to **Sales & Inventory → Proforma Invoices → New**.
2. Fill in customer and items.
3. Generate and download the proforma invoice document.

---

## 6. Delivery Notes

### Creating a Delivery Note
When goods are ready for delivery:
1. Navigate to the confirmed Sales Order and click **Create Delivery Note**.
2. Verify line items and quantities.
3. Enter the **delivery date**, **vehicle/driver** (if applicable), and **delivery address**.
4. Click **Issue Delivery Note**.
5. Print or send the delivery note to accompany the goods.

### Confirming Delivery
1. After physical delivery, open the delivery note.
2. Click **Confirm Delivery** — enter actual delivery date and recipient's name.
3. Inventory is deducted at this point.
4. The Sales Order status moves to **Delivered**.
5. Proceed to raise an invoice: click **Create Invoice** from the delivery note.

---

## 7. Inventory Locations

ITEMBA-R supports multiple inventory locations (warehouses, store rooms, shop floors):

1. Navigate to **Sales & Inventory → Inventory → Locations**.
2. Add locations per company and branch (e.g., Westsides Mwanza Store, Westsides Dodoma Store, Itemba Cold Store).
3. Each product can have stock in multiple locations.
4. Sales orders draw stock from the selected location.

---

## 8. Inventory Movements

All stock movements are tracked and audited:

| Movement Type | Trigger |
|---|---|
| **Goods Received** | GRN from Procurement |
| **Sales Delivery** | Confirmed delivery note |
| **Stock Adjustment** | Manual adjustment (with reason and authorization) |
| **Internal Transfer** | Stock moved between locations |
| **Return Inbound** | Customer returns goods |
| **Return Outbound** | Goods returned to supplier |

### Viewing Inventory Movements
Navigate to **Sales & Inventory → Inventory → Movements** and filter by product, location, date range, or movement type. Every movement shows the quantity, direction (in/out), reference document, and resulting balance.

---

## 9. Stock Adjustments

For corrections arising from stock counts:

1. Navigate to **Sales & Inventory → Inventory → Adjustments → New Adjustment**.
2. Select the location and adjustment date.
3. For each product, enter the **counted quantity**.
4. The system calculates the variance (counted vs. system balance).
5. Enter the adjustment reason (e.g., damage, theft, counting error).
6. Submit for approval (adjustments above a threshold require Finance Controller authorization).
7. Approved adjustments update the inventory balance and post a GL entry.

---

## 10. Inventory Valuation

ITEMBA-R supports **Weighted Average Cost (WAC)** as the default inventory valuation method.

- The cost of inventory is recalculated whenever new stock is received.
- The cost of sales is calculated using the current WAC at the time of dispatch.
- Navigate to **Sales & Inventory → Reports → Inventory Valuation** for the current value of stock by product and location.

---

## 11. Low Stock Alerts

Products at or below the reorder level trigger automatic alerts:

1. Navigate to **Sales & Inventory → Dashboard** to see the **Low Stock** widget.
2. The widget lists all products below reorder level with current quantity and reorder quantity.
3. Click any product to create a Purchase Requisition directly.
4. Low stock alerts are also sent as system notifications to the assigned procurement staff.

Configure reorder levels per product in the product catalog.
