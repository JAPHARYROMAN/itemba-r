# Approvals & Controls User Guide

## Overview

The Approvals & Controls module governs who must authorize significant actions across ITEMBA-R. It provides configurable approval workflows, maker-checker controls, real-time notifications, task management, internal control records, and a complete audit trail. Proper use of approvals ensures that no single user can initiate and complete a sensitive transaction without a second authorized review.

---

## 1. Approval Workflow Setup

### Creating an Approval Workflow (Admin)
1. Navigate to **Settings → Approvals → Workflows → New Workflow**.
2. Enter the workflow name (e.g., Purchase Order Approval, Expense Approval, Payroll Approval).
3. Select the **module and action** this workflow applies to (e.g., Procurement → Purchase Orders → Approve).
4. Set the **trigger condition**:
   - Always require approval
   - Require approval when amount > [threshold]
   - Require approval for specific record types
5. Click **Save Workflow**.

### Defining Workflow Steps
Each workflow can have multiple sequential steps:
1. From the workflow record, click **Add Step**.
2. Enter the step name (e.g., Departmental Manager Approval, Finance Controller Approval, Director Approval).
3. Select the **approver type**:
   - Specific User
   - Role (any user with the specified role can approve)
   - Hierarchical (the requester's direct manager)
4. Set the **escalation time** — if not actioned within this time, the system escalates.
5. Set the **approval order** (sequential steps are numbered).
6. Click **Save Step**.

### Example: 3-Step PO Approval Workflow
| Step | Approver | Trigger |
|---|---|---|
| Step 1 | Departmental Manager | All POs |
| Step 2 | Finance Controller | POs > TZS 500,000 |
| Step 3 | Group Director | POs > TZS 5,000,000 |

---

## 2. Submitting Approval Requests

When a user creates a record that requires approval (expense, PO, journal entry, payroll, etc.):

1. Complete filling the form and click **Submit for Approval**.
2. The system checks which workflow applies to this record type and amount.
3. An approval request is created and routed to the first-step approver.
4. The approver receives a **notification** (in-system and email).
5. The record status changes to **Pending Approval** — it cannot be edited until approved or rejected.

---

## 3. Tracking Approval Status

### My Submissions
1. Navigate to **Approvals → My Submissions**.
2. See all records you have submitted for approval with their current status:
   - **Pending**: Awaiting approver action
   - **In Progress**: Approval partially completed (multi-step workflows)
   - **Approved**: All steps completed — record is approved
   - **Rejected**: Rejected at one of the steps — returned to you with comments
3. Click any record to see the full approval trail: who approved/rejected at each step, with timestamps and comments.

### Approvals Dashboard
Navigate to **Approvals → Dashboard** for an overview:
- Pending approvals awaiting your action
- Recently approved items
- Recently rejected items
- Escalated items (overdue)

---

## 4. Approver Actions

When you have a pending approval:

1. Navigate to **Approvals → Pending My Action**.
2. Click on the request to review the full record details.
3. Available actions:
   - **Approve**: The request proceeds to the next step (or is fully approved if this is the last step).
   - **Reject**: The request is returned to the submitter. You must provide a rejection reason.
   - **Request More Info**: The request is paused and returned to the submitter for clarification. The approval step is resumed once the submitter responds.
   - **Delegate**: Assign this approval to another authorized user (audit-logged).

---

## 5. Maker-Checker Controls

ITEMBA-R enforces **maker-checker** (four-eyes principle) on all sensitive transactions:
- The **maker** (creator/submitter) cannot also be the **checker** (approver) on the same record.
- If a user attempts to approve their own submission, the system blocks the action and logs a security event.
- Maker-checker applies to: Journal entries, Payments, Bank reconciliations, Payroll approval, Bank account changes (Group Control), Stock adjustments.

### Configuring Maker-Checker Rules
1. Navigate to **Settings → Controls → Maker-Checker Rules**.
2. View the list of all transaction types subject to maker-checker.
3. Enable or disable maker-checker per transaction type (requires Security Admin permission).
4. All changes to maker-checker rules are audit-logged.

---

## 6. Rejecting and Resubmitting

When a request is rejected:
1. The submitter receives a notification with the rejection reason.
2. Navigate to **Approvals → My Submissions → [Rejected Record]**.
3. Read the rejection comment.
4. Click **Edit** to modify the record based on the feedback.
5. Click **Resubmit** — the approval workflow restarts from the beginning (or from the rejected step, depending on configuration).
6. All rejection history is retained on the record.

---

## 7. Notification Preferences

### Configuring Your Notifications
1. Navigate to **Settings → Notifications**.
2. Toggle on/off notification types:
   - Approval requests assigned to me
   - Approval decisions on my submissions
   - Escalation alerts
   - Finance alerts (low balance, overdue AR/AP)
   - Compliance deadline reminders
   - HR reminders (payroll, leave approvals)
   - Security events
3. Choose delivery method: **In-System** (bell icon), **Email**, or both.
4. Click **Save Preferences**.

---

## 8. Alerts and Tasks

### Alerts
Navigate to **Approvals → Alerts** to see active alerts:
- Overdue approvals (no action taken within the escalation window)
- Critical compliance deadlines
- Budget overrun alerts
- Low stock alerts
- Loan repayment due alerts

Alerts have severity levels: **Critical**, **High**, **Medium**, **Low**. Critical alerts also appear in a banner on the dashboard.

### Tasks
For manual internal control tasks:
1. Navigate to **Approvals → Tasks → New Task**.
2. Describe the task (e.g., "Reconcile petty cash — October 2025").
3. Assign to a staff member and set a due date.
4. The assignee receives a notification.
5. When complete, the assignee marks the task as **Done**.
6. Overdue tasks appear in the Alerts list.

---

## 9. Internal Control Records

For documenting internal controls that are performed outside of automated workflows:
1. Navigate to **Approvals → Internal Controls → New Record**.
2. Describe the control (e.g., "Monthly physical cash count — Fuel Station").
3. Select the control category: Financial, Operational, Compliance, IT.
4. Set the frequency and responsible person.
5. When the control is performed, click **Record Evidence** and upload supporting documents.
6. Mark the control as **Passed** or **Failed** with observations.

---

## 10. Audit Trails

### Viewing the Audit Log
1. Navigate to **Approvals → Audit Trail** (or **Audit Logs** in the main menu).
2. Filter by: date range, user, module, action type, record type.
3. Each entry shows:
   - Timestamp (UTC and local time)
   - User who performed the action
   - Action performed (Created, Updated, Approved, Rejected, Deleted, Viewed)
   - Record type and ID
   - Before and after values (for updates)
   - IP address and device

### Audit Trail Properties
- The audit trail is **immutable** — no user can edit or delete audit records.
- Audit logs are retained for a minimum of 7 years.
- Only authorized roles (Group Director, Group Super Admin, Compliance Officer) can export audit logs.
- All exports of audit logs are themselves audit-logged.
