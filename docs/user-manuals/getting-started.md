# Getting Started with ITEMBA-R

**ITEMBA-R** is the Group Digital Governance and Enterprise Management System for the Itemba Group of Companies, Tanzania. It serves three BRELA-registered companies — Mwanjalisi Oil Co. Ltd, Westsides Company Ltd, and Itemba Enterprises Co. Ltd — under a unified platform with strict data isolation and Group Control governance.

---

## 1. ITEMBA-R Overview

ITEMBA-R provides end-to-end management for:

| Layer | Purpose |
|---|---|
| **Group Control** | Sensitive records — bank accounts, loans, fixed assets, contracts, documents — owned by each company but accessed only by authorized Group-level roles |
| **Company Operations** | Finance, procurement, HR, compliance, BI, and module-specific operations per company |
| **Division/Branch** | Granular activity tracking per operational site or project |

The three companies cover diverse industries:
- **Mwanjalisi Oil Co. Ltd** — petroleum fuel retail, truck parking
- **Westsides Company Ltd** — beverages (alcoholic and non-alcoholic), hardware and building materials
- **Itemba Enterprises Co. Ltd** — logistics, agriculture, construction, property rentals, hospitality (Uzunguni Inn)

---

## 2. Logging In

1. Open your browser and navigate to the ITEMBA-R URL provided by your IT Administrator (e.g., `https://app.itemba.local` or `http://localhost:3000` in development).
2. Enter your **Email Address** and **Password** in the login form.
3. Click **Sign In**.
4. On first login, you will be prompted to **change your temporary password**. Choose a strong password of at least 8 characters including uppercase, lowercase, a digit, and a special character.
5. If your account has **Two-Factor Authentication (2FA)** enabled, you will be prompted for your authentication code after entering your credentials.

**Forgot your password?** Contact your IT Administrator to reset your account. Self-service password reset is available if configured.

**Account locked?** After several failed login attempts, your account may be temporarily locked. Contact IT Administration.

---

## 3. Navigating the Sidebar

The left sidebar is your primary navigation. It is organized by module and collapses to icons on smaller screens.

| Section | What You Find There |
|---|---|
| **Dashboard** | Group overview and company KPI snapshots |
| **Group Control** | Sensitive company records (restricted roles only) |
| **Finance & Accounting** | Chart of accounts, journals, expenses, AR/AP, reports |
| **Procurement** | Requisitions, RFQs, purchase orders, supplier management |
| **Sales & Inventory** | Products, customers, orders, deliveries, stock |
| **Petroleum** | Fuel shifts, tanks, nozzles, deliveries (Mwanjalisi) |
| **Westsides** | POS, wholesale, batches, packages (Westsides) |
| **Itemba Enterprises** | Logistics, Agriculture, Construction |
| **Rentals & Parking** | Properties, tenants, leases, truck parking |
| **Hospitality** | Uzunguni Inn rooms, bookings, restaurant, bar |
| **HR & Payroll** | Employees, attendance, leave, payroll |
| **Compliance & Tax** | Obligations, licenses, TRA filings, regulatory docs |
| **Approvals** | Pending approvals, approval history |
| **BI & Reports** | Executive dashboards, KPIs, standard reports |
| **Help & Training** | Help Center, courses, walkthroughs, manuals |
| **Support** | Submit and track support tickets |
| **Settings** | Profile, notifications, preferences |

Sidebar items you cannot access due to your role will appear greyed out or hidden entirely.

---

## 4. Switching Company Context

If your account has access to more than one company (e.g., a Group Super Admin), you can switch the active company context:

1. Look for the **Company Selector** in the top bar, showing the currently active company name and logo.
2. Click the selector to open the company switcher dropdown.
3. Select the target company.
4. The dashboard and all module data will reload scoped to that company.

> **Note:** Switching company context does not grant you additional permissions. You will only see data and actions permitted by your roles in each company.

---

## 5. Reading the Dashboard

The **Dashboard** provides a snapshot of key metrics across the group or within the active company.

### Group-Level Dashboard Elements
- **Company Cards**: Each registered company (Mwanjalisi Oil, Westsides, Itemba Enterprises) shows a status card with headline KPIs.
- **Recent Activity Feed**: Latest significant events — new approvals, high-value transactions, compliance alerts.
- **Alert Banners**: System alerts, pending approvals requiring your attention, overdue compliance obligations.

### Company-Level Dashboard Elements
- **Revenue StatCard**: Current month revenue vs. prior month.
- **Expenses StatCard**: Current month operating expenses.
- **Outstanding Receivables**: Total AR balance.
- **Outstanding Payables**: Total AP balance.
- **Low Stock Alerts**: Products below reorder level.
- **Pending Approvals**: Items waiting for your approval.

Click any StatCard to drill into the underlying data table.

---

## 6. Viewing Notifications

1. Click the **bell icon** in the top bar to open the notifications panel.
2. Notifications are categorized: Approvals, Finance Alerts, System Events, HR Reminders, Compliance Deadlines.
3. Click a notification to navigate directly to the relevant record.
4. Mark individual notifications as read by clicking the checkmark, or use **Mark All Read** to clear the panel.
5. Notification preferences can be configured under **Settings → Notifications**.

---

## 7. Updating Your Profile

1. Click your **avatar or name** in the top-right corner of the top bar.
2. Select **My Profile** from the dropdown.
3. Update your display name, phone number, and job title.
4. Upload a profile photo (optional).
5. Under the **Security** tab, you can change your password.
6. Click **Save Changes**.

> Your email address is managed by the IT Administrator and cannot be self-changed.

---

## 8. Logging Out

1. Click your **avatar or name** in the top-right corner.
2. Select **Sign Out**.
3. You will be redirected to the login page. Your session is invalidated server-side.

For security, ITEMBA-R automatically logs you out after **15 minutes of inactivity** (access token expiry). You will be prompted to re-authenticate. If you have an active refresh token (valid for 7 days), re-authentication is seamless.

---

## 9. Getting Help

### In-System Help
- Navigate to **Help & Training → Help Center** to browse articles and user manuals.
- Use the **search bar** at the top of the Help Center to find answers by keyword.
- Click the **?** icon on any page to open context-sensitive help for that module.
- Start a guided **Walkthrough** from Help Center for step-by-step in-system guidance.

### Support Tickets
1. Navigate to **Support → My Tickets → New Ticket**.
2. Select the relevant category (Finance, HR, Technical, etc.).
3. Describe your issue clearly.
4. Attach screenshots if needed.
5. Submit — your IT Administrator or support staff will respond within the SLA window.

### Contact IT Administration
For urgent access issues (locked account, missing roles, urgent system errors), contact your IT Administrator directly using the contact details provided during onboarding.

---

## 10. Quick Reference

| Task | Where to Go |
|---|---|
| View your pending approvals | Approvals → Pending |
| Submit an expense | Finance → Expenses → New Expense |
| Check inventory stock | Sales & Inventory → Products → Stock |
| View payslip | HR & Payroll → My Payslips |
| Open a petroleum shift | Petroleum → Shifts → Open Shift |
| Record a support ticket | Support → My Tickets → New Ticket |
| Find a user manual | Help & Training → Help Center → Manuals |
| Change your password | Settings → My Profile → Security |
