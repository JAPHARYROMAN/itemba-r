# Hospitality User Guide — Uzunguni Inn

## Overview

**Uzunguni Inn** is the hospitality property operated by **Itemba Enterprises Co. Ltd**. The Hospitality module in ITEMBA-R manages the full guest experience — from room setup and housekeeping to bookings, check-in/check-out, restaurant and bar orders, room service, payments, and daily reporting.

---

## 1. Uzunguni Inn Setup

### Property Configuration
1. Navigate to **Hospitality → Property Setup**.
2. Enter the property name (Uzunguni Inn), address, and contact details.
3. Set the property currency (TZS) and time zone (Africa/Dar_es_Salaam).
4. Configure check-in time (default 12:00) and check-out time (default 10:00).
5. Set late check-out policy and associated fee.
6. Configure early check-in policy.

### Restaurant and Bar Configuration
1. Navigate to **Hospitality → F&B Setup**.
2. Configure the restaurant and bar as separate revenue centres.
3. Set operating hours for restaurant, bar, and room service.
4. Configure service charge percentage (if applicable).
5. Set the VAT treatment for hospitality (typically 18% VAT in Tanzania).

---

## 2. Room Types and Rooms

### Defining Room Types
1. Navigate to **Hospitality → Room Types → New Room Type**.
2. Enter the room type name (e.g., Standard Single, Standard Double, Deluxe Double, Executive Suite, Family Room).
3. Enter the **rack rate** (standard nightly rate in TZS).
4. Set the maximum occupancy.
5. List amenities (AC, En-suite bathroom, TV, Wi-Fi, Balcony, Hot Water, King Bed, Twin Beds).
6. Upload room type photos.
7. Set the cleaning time (minutes required between guests).

### Adding Rooms
1. Navigate to **Hospitality → Rooms → New Room**.
2. Select the room type.
3. Enter room number and floor.
4. Set initial status: **Available**, **Under Maintenance**, or **Out of Service**.
5. Click **Save**.

### Room Status Overview
| Status | Meaning |
|---|---|
| **Available – Clean** | Ready to receive a guest |
| **Available – Dirty** | Vacant but needs cleaning |
| **Occupied** | Guest currently checked in |
| **Checked Out – Dirty** | Guest departed, awaiting cleaning |
| **Blocked** | Reserved for maintenance or VIP hold |
| **Out of Service** | Not available for booking |

---

## 3. Housekeeping Tasks

### Daily Housekeeping List
1. Navigate to **Hospitality → Housekeeping → Daily Tasks**.
2. The system auto-generates cleaning tasks based on room status:
   - Rooms with checkouts: Full clean and reset
   - Occupied rooms: Daily service (unless guest declined)
   - Available dirty rooms: Quick clean and inspection
3. Assign tasks to housekeeping staff.
4. Staff confirm task completion — room status updates to **Clean** automatically.

### Maintenance Requests
1. When a room defect is found (e.g., broken shower, faulty AC), navigate to **Hospitality → Maintenance → New Request**.
2. Select the room, describe the issue, and assign to maintenance staff.
3. Track request status: Open → In Progress → Resolved.
4. Room is marked **Blocked** until the maintenance request is closed.

---

## 4. Guest Management

### Adding a Guest Record
Guest records are created at booking or check-in:
1. Navigate to **Hospitality → Guests → New Guest**.
2. Enter: full name, nationality, ID/passport number, date of birth, phone, email.
3. For corporate guests: company name and billing address for company invoicing.
4. Upload a copy of the guest's ID document.
5. Click **Save**.

Returning guests are automatically recognized by ID number or email — previous stays and preferences are visible.

---

## 5. Room Bookings

### Creating a Booking
1. Navigate to **Hospitality → Bookings → New Booking**.
2. Search and select the guest.
3. Select the room type (or a specific room if the guest requested it).
4. Enter check-in date and check-out date.
5. The system shows availability for the selected dates.
6. Enter the agreed nightly rate (the rack rate is pre-filled but can be adjusted for group rates, loyalty rates, or corporate rates).
7. Add special requests (extra bed, early check-in, specific floor preference).
8. Select the rate plan (Bed Only, Bed & Breakfast, Half Board, Full Board).
9. Confirm whether payment is by the guest or by a company (for corporate bookings).
10. Click **Confirm Booking**.

### Booking Status
| Status | Description |
|---|---|
| **Confirmed** | Booking accepted and room reserved |
| **Checked In** | Guest has arrived and is in the room |
| **Checked Out** | Guest has departed |
| **No Show** | Guest did not arrive (no-show policy applies) |
| **Cancelled** | Booking cancelled (cancellation policy applies) |

### Booking Amendments
- Change dates, room type, or rate: Open the booking and click **Amend Booking**.
- All amendments are audit-logged with who changed what and when.

---

## 6. Check-In Procedure

1. Navigate to **Hospitality → Bookings → Today's Arrivals**.
2. Find the guest's booking and click **Check In**.
3. Verify the guest's identity against the ID on file.
4. Update the ID document if it has changed.
5. Confirm the room assignment (or assign if not yet assigned).
6. Collect payment deposit or credit card details.
7. Issue the **Room Key** (record key number in the system).
8. Click **Complete Check-In** — the room status changes to **Occupied** and a folio (guest bill) is opened.

---

## 7. Check-Out Procedure

1. Navigate to **Hospitality → Bookings → Today's Departures**.
2. Select the guest and click **Check Out**.
3. Review the **Guest Folio** — all charges:
   - Room charges (nightly rate × nights)
   - Restaurant and bar charges
   - Room service charges
   - Mini-bar charges (if applicable)
   - Laundry or other extras
4. Apply any discounts or comp items (requires authorization).
5. Present the folio to the guest for review.
6. Process payment (see section 10).
7. Click **Complete Check-Out** — room status changes to **Checked Out – Dirty**.
8. Issue the final receipt.

---

## 8. Restaurant Orders

### Creating a Restaurant Order
1. Navigate to **Hospitality → Restaurant → New Order** (or use the table layout view).
2. Select the table number.
3. Link to a guest folio if charging to a room, or mark as external (walk-in).
4. Browse the menu and add items to the order.
5. Send the order to the kitchen printer/display.
6. When complete, click **Bill Order** to finalize.

### Menu Setup
- Navigate to **Hospitality → F&B → Menu → New Item** to add food and beverages.
- Categorize items: Starters, Main Course, Grills, Ugali & Stew, Breakfast, Soft Drinks, Juices, Beers, Spirits.
- Set selling price and VAT treatment.

---

## 9. Bar Orders

1. Navigate to **Hospitality → Bar → New Order**.
2. Select guest folio (room charge) or cash/mobile payment.
3. Add drinks to the order.
4. Finalize and collect payment or post to room folio.

---

## 10. Room Service

1. Navigate to **Hospitality → Room Service → New Order**.
2. Select the room number.
3. Link to the guest folio automatically.
4. Add items from the room service menu.
5. Enter the delivery time.
6. Dispatch to the kitchen.
7. When delivered, mark the order as **Delivered** and update the folio.

---

## 11. Hospitality Payments

### Payment Methods Accepted
- Cash (TZS)
- M-Pesa, Airtel Money, TigoPesa (mobile money)
- Bank transfer
- Company/corporate account billing
- Credit card (where POS terminal is available)

### Processing Folio Payment
1. From the guest folio, click **Settle Folio**.
2. Select the payment method.
3. Enter amount and reference (for mobile money).
4. For split payment: apply first payment, then add second payment method for the balance.
5. Issue the receipt and close the folio.

---

## 12. Receipts

All completed transactions generate a receipt:
- Receipts are numbered sequentially and include the property name, TIN, and VAT amount.
- Receipts can be printed at the front desk printer or emailed.
- EFD (Electronic Fiscal Device) integration should be configured by the IT Administrator.

---

## 13. Daily Hospitality Reports

| Report | Description |
|---|---|
| **Daily Revenue Report** | Revenue by department (rooms, restaurant, bar, room service) |
| **Occupancy Report** | Rooms occupied vs. available, occupancy %, RevPAR |
| **Arrivals and Departures** | Guest arrivals and departures for the day |
| **Housekeeping Status Report** | Clean/dirty/blocked rooms at shift change |
| **F&B Sales Report** | Food and beverage revenue by category |
| **Outstanding Folios** | Guests with unpaid balances |
| **No-Show Report** | Guests who did not arrive |
| **Monthly Revenue Summary** | Revenue by month with year-on-year comparison |
