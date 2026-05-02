# Procurement User Guide

## Overview

The Procurement module manages the end-to-end purchasing process for all companies in the Itemba Group — from the initial purchase requisition through supplier selection, purchase order issuance, goods receipt, supplier invoice matching, and payment. A structured workflow with approvals ensures financial controls are maintained.

---

## 1. Purchase Requisition Workflow

A Purchase Requisition (PR) is the starting point for any significant purchase. It documents what is needed, why, and by when.

### Creating a Purchase Requisition
1. Navigate to **Procurement → Requisitions → New Requisition**.
2. Select the **company** and **division/department** for which the goods or services are needed.
3. Enter the **requisition date** and **required by date**.
4. Add line items:
   - Description of goods/services
   - Quantity and unit of measure
   - Estimated unit price (if known)
   - GL account to charge
5. Add a justification note.
6. Click **Submit for Approval**.

### PR Approval Flow
- The PR is routed to the departmental manager for initial approval.
- For high-value PRs (above the company threshold), additional approval by the Finance Controller or Director is required.
- Approved PRs are available to the Procurement team to proceed with sourcing.
- Rejected PRs are returned to the requester with comments.

---

## 2. RFQ Creation and Supplier Distribution

Once a PR is approved, the Procurement Officer creates a Request for Quotation (RFQ) to solicit prices from suppliers.

### Creating an RFQ
1. Navigate to **Procurement → RFQs → New RFQ**.
2. Link to the approved Purchase Requisition.
3. Set the **RFQ deadline** (date by which suppliers must respond).
4. The line items are pre-populated from the PR.
5. Add or adjust items as needed.
6. Select **minimum number of quotations** required (typically 3).
7. Click **Save**.

### Distributing to Suppliers
1. From the RFQ record, click **Select Suppliers**.
2. Choose from the registered supplier list or add a new supplier.
3. Click **Send RFQ** — the system emails the RFQ document to each selected supplier.
4. Track supplier responses in the **RFQ → Responses** tab.

---

## 3. Supplier Quotation Comparison

As supplier quotations arrive, record them in the system for comparison.

### Recording a Quotation
1. Navigate to **Procurement → RFQs → [RFQ] → Add Quotation**.
2. Select the supplier and enter quotation date and reference.
3. Enter the quoted price and lead time for each line item.
4. Upload the supplier's quotation document.
5. Click **Save**.

### Quotation Comparison Table
1. From the RFQ record, click **Compare Quotations**.
2. A side-by-side comparison table shows all received quotations:
   - Unit price per item
   - Total price
   - Delivery lead time
   - Supplier rating (from supplier profile)
3. The lowest-price supplier and the best-overall supplier are highlighted.
4. Add evaluation notes — consider price, quality, delivery time, payment terms, and past performance.

---

## 4. Bid Comparison and Approval

For significant procurement above the tender threshold, a formal bid comparison report is required.

### Preparing the Bid Comparison Report
1. Navigate to **Procurement → Bid Comparisons → New Bid Comparison**.
2. Link to the RFQ and all received quotations.
3. Complete the evaluation criteria matrix — score each supplier on price (40%), quality (20%), delivery (20%), terms (20%) or as configured.
4. The system calculates a weighted score for each supplier.
5. Enter the recommended supplier and justification.
6. Click **Submit for Approval**.

### Bid Approval
- The Bid Comparison Report is routed to the approver (Finance Controller / Company Manager / Director depending on value).
- Approver reviews the report and either **Approves** or **Rejects with Comments**.
- Approved bid comparisons proceed to PO generation.

---

## 5. Purchase Order Generation

### Creating a Purchase Order
1. Navigate to **Procurement → Purchase Orders → New PO**.
2. Link to the approved Bid Comparison or approved PR (for smaller purchases).
3. ITEMBA-R pre-populates the PO from the selected supplier quotation.
4. Verify line items, quantities, unit prices, and total.
5. Set **delivery address**, **payment terms**, and **expected delivery date**.
6. Click **Submit for Approval** (POs require Finance Controller or Director sign-off above the approval threshold).

### Issuing the PO to Supplier
1. Once approved, click **Issue PO**.
2. The system generates a formatted PO document with the company letterhead.
3. Click **Send to Supplier** — the PO is emailed automatically.
4. The PO status changes to **Issued**.

---

## 6. Goods Received Note (GRN)

When goods arrive, a Goods Received Note is created to record the delivery.

### Creating a GRN
1. Navigate to **Procurement → GRNs → New GRN**.
2. Link to the issued Purchase Order.
3. Enter the **receipt date**, **delivery note number** from the supplier, and **received by** (staff member).
4. For each line item, enter the **quantity received**:
   - If all items received as ordered: match quantities.
   - If partial delivery: enter quantities received — the remaining balance stays open on the PO.
   - If items rejected (damaged, wrong spec): note quantity rejected and reason.
5. Upload photos of received goods if required.
6. Click **Save GRN**.
7. Inventory is automatically updated for stock items.

---

## 7. Supplier Invoice Matching

When the supplier invoice arrives, match it against the GRN and PO.

### Recording a Supplier Invoice
1. Navigate to **Procurement → Supplier Invoices → New Invoice**.
2. Enter the supplier, invoice number, invoice date, and due date.
3. Link to the relevant Purchase Order.
4. ITEMBA-R pre-populates the invoice lines from the PO.
5. Verify quantities and prices match the invoice.

---

## 8. Three-Way Match

ITEMBA-R enforces a **three-way match** before a supplier invoice can be approved for payment:

| Document | Must Match |
|---|---|
| Purchase Order | Approved quantities and prices |
| Goods Received Note | Quantities actually received |
| Supplier Invoice | Quantities and amounts charged |

### Match Verification
- Navigate to **Procurement → Supplier Invoices → [Invoice] → Verify Match**.
- The system compares PO, GRN, and Invoice line by line.
- **Green**: Perfect match — invoice can proceed to payment.
- **Yellow**: Minor discrepancy (within tolerance) — Finance Controller review required.
- **Red**: Significant mismatch — invoice is flagged and payment is blocked until resolved.

Discrepancy resolution:
- Contact supplier for a credit note or corrected invoice.
- Adjust GRN if there was a recording error.
- Document the resolution in the match notes.

---

## 9. Procurement Dashboard and Plans

### Procurement Dashboard
Navigate to **Procurement → Dashboard** for an overview:
- **Open Requisitions**: PRs awaiting approval or action.
- **Active RFQs**: RFQs awaiting supplier responses.
- **POs Issued**: Open POs awaiting full delivery.
- **Invoices Pending Match**: Invoices awaiting three-way match verification.
- **Overdue Deliveries**: POs where expected delivery date has passed.

### Procurement Plans
For planned procurement (annual or quarterly):
1. Navigate to **Procurement → Plans → New Plan**.
2. Define the planning period and total budget.
3. Add planned purchase categories with estimated values and timing.
4. Track actual procurement against the plan throughout the period.

### Supplier Performance
Navigate to **Procurement → Suppliers → [Supplier] → Performance**:
- On-time delivery rate
- Invoice accuracy rate
- Quality rejection rate
- Average lead time
Use performance data when evaluating future quotations.
