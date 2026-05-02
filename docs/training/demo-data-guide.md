# Demo Data Guide

## Overview

ITEMBA-R includes a pre-seeded demo data set for training purposes. This guide explains what demo data is available, how to use it safely, how to reset the training environment, and what you must never do with training data.

---

## 1. What Demo Data Is Seeded

When the training environment is set up (or after a demo data reset), the following records are pre-populated:

### Companies and Group Structure
- **Itemba Group** — the parent group entity
- **Mwanjalisi Oil Co. Ltd** — with Fuel Retail division and one fuel station branch
- **Westsides Company Ltd** — with Beverages and Hardware divisions and two branches
- **Itemba Enterprises Co. Ltd** — with Logistics, Agriculture, Construction, Rentals, and Hospitality divisions

### Users and Roles
A full set of demo users, one per major role:
| Username | Role | Company |
|---|---|---|
| `demo.director@itemba.demo` | Group Director | Group Level |
| `demo.finance@itemba.demo` | Finance Controller | Group Level |
| `demo.accountant.mwanjalisi@itemba.demo` | Accountant | Mwanjalisi Oil |
| `demo.petroleum@itemba.demo` | Petroleum Supervisor | Mwanjalisi Oil |
| `demo.attendant@itemba.demo` | Fuel Attendant | Mwanjalisi Oil |
| `demo.westsides@itemba.demo` | Westsides Supervisor | Westsides |
| `demo.cashier@itemba.demo` | POS Cashier | Westsides |
| `demo.itemba@itemba.demo` | Company Manager | Itemba Enterprises |
| `demo.logistics@itemba.demo` | Logistics Supervisor | Itemba Enterprises |
| `demo.frontdesk@itemba.demo` | Front Desk Staff | Itemba Enterprises |
| `demo.hr@itemba.demo` | HR Manager | Group Level |
| `demo.compliance@itemba.demo` | Compliance Officer | Group Level |
| `demo.admin@itemba.demo` | Group Super Admin | Group Level |

All demo passwords: `Training!2025` (change after setup if needed)

### Sample Transactions
| Module | Demo Data |
|---|---|
| **Finance** | 30 journal entries (various types), 15 AR invoices, 12 supplier invoices, 3 months of period data |
| **Petroleum** | 14 closed shifts (2 weeks of daily shifts), 3 fuel deliveries, 8 credit sales |
| **Westsides** | 50 POS transactions, 10 wholesale orders, 3 batch records, 20 returnable movement records |
| **Logistics** | 8 completed trips, 3 active trips, 15 fuel issues |
| **Agriculture** | 1 active season, 2 harvest records, 5 input records |
| **Construction** | 2 active projects with BOQ, 5 progress claims |
| **Hospitality** | 10 completed bookings, 5 active guests, restaurant and bar orders |
| **HR** | 20 employees (across all companies), 2 months of payroll history, 5 leave records |
| **Compliance** | 12 obligations with various due dates, 4 filed returns |
| **Procurement** | 5 purchase requisitions, 3 POs, 2 GRNs |

### QA Suites
All 22 QA test suites are seeded with their test cases. These are available in **QA & Launch → QA Dashboard → Test Suites**.

### User Manuals and Help Articles
10 help articles covering each major module are pre-seeded in the Help Center.

### Training Courses and Walkthroughs
- 10 training courses (one per major role group)
- 8 guided walkthroughs for common operational workflows

---

## 2. How to Use Demo Data Safely

### The Training Environment Is for Learning
The training environment exists so you can practice without consequences. You can:
- Post journal entries that don't balance (to see the error message)
- Open and close fuel shifts with test data
- Process test POS transactions
- Create test employees and run test payroll
- Try any action and see what happens

**None of this affects the production system.**

### Using Demo Accounts
Log in using the demo user accounts listed above. Each account is pre-configured with the correct role and permissions for that user type.

Use these accounts during:
- Training sessions (instructor-led or self-paced)
- UAT testing
- Testing a fix in the staging environment

---

## 3. How to Reset Training Environment

If the training data becomes messy (too many test transactions, corrupted records), reset it to the original demo data state.

### Who Can Reset
Only users with the `training.environments.manage` permission (IT Admin or Group Super Admin).

### Reset via API
```bash
curl -X POST \
  https://[training-url]/api/v1/training/environments/{env-id}/reset-demo-data \
  -H "Authorization: Bearer [admin-token]" \
  -H "Content-Type: application/json"
```

### Reset via UI
1. Log in as the IT Admin on the training environment.
2. Navigate to **Settings → Training → Environments**.
3. Find the training environment.
4. Click **Reset Demo Data**.
5. Confirm the reset.
6. Wait approximately 2–3 minutes for the seed to complete.
7. All demo data is restored to the original state.

> **Warning:** A reset deletes ALL data in the training environment and replaces it with the seed data. Any test transactions, users, or configurations added during training are permanently deleted.

---

## 4. What NOT to Do

### ❌ Do Not Use Real Transactions in Training
- Never enter real customers, real supplier names, or real transaction amounts in the training environment.
- Never use the training environment for any real business activity (processing real payments, recording actual fuel sales, etc.).
- Training is for learning — not for business operations.

### ❌ Do Not Use Real Personal Data
- Never enter real employee names, NSSF numbers, NHIF numbers, bank account details, or salaries in the training environment.
- Use fictional names and numbers (e.g., "Test Employee One", fake ID number, fake bank account).
- Entering real personal data in a training environment violates data privacy.

### ❌ Do Not Copy Production Data to Training
- Do not export data from the production system and import it into the training environment.
- Demo data is sufficient for training purposes.
- If you need production-like volume for performance testing, use the staging environment — not training.

### ❌ Do Not Share Training Credentials
- Demo account credentials are for authorized training participants only.
- Do not share the demo passwords with external parties.
- Reset training passwords after each training cohort if necessary.

---

## 5. Using Guided Walkthroughs

Walkthroughs are in-system step-by-step guides that overlay on the actual ITEMBA-R interface.

### Starting a Walkthrough
1. Navigate to **Help & Training → Help Center → Walkthroughs**.
2. Select a walkthrough relevant to your role.
3. Click **Start Walkthrough**.
4. A step-by-step overlay appears on the screen.
5. Follow each step — the walkthrough highlights which button to click or which field to fill.
6. Complete all steps to finish the walkthrough.
7. Your completion is recorded in **My Training**.

### Available Walkthroughs
| Walkthrough | For Role |
|---|---|
| "Your First Login and Dashboard Tour" | All users |
| "Open and Close a Fuel Shift" | Petroleum staff |
| "Process a POS Transaction" | Westsides cashier |
| "Post a Journal Entry" | Accountant |
| "Complete a Bank Reconciliation" | Accountant, Finance Controller |
| "Check In and Check Out a Hotel Guest" | Front Desk Staff |
| "Run Payroll and Generate Payslips" | HR Manager |
| "Review and Approve a Purchase Order" | Manager, Finance Controller |

---

## 6. Training Environment Safety Rules

1. **Never use training for real business operations.**
2. **Never enter real personal data.**
3. **Never copy production data to training.**
4. **Reset the environment after each training cohort** to keep it clean for the next group.
5. **Deactivate demo accounts after go-live** — all staff should be on real accounts by then.
6. **Do not expose the training URL publicly** — training credentials are not secure enough for external access.
