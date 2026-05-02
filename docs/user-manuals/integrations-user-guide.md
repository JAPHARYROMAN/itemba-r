# Integrations User Guide

## Overview

The Integrations module connects ITEMBA-R to external services — mobile money payment providers (M-Pesa, Airtel Money, TigoPesa), email (SMTP), SMS gateways, and device-based offline sync. This guide covers setting up integration providers, managing API clients and keys, configuring webhooks, registering devices, processing offline sync uploads, and messaging templates.

---

## 1. Integration Providers

ITEMBA-R supports the following integration providers:

| Provider | Type | Purpose |
|---|---|---|
| **Vodacom M-Pesa** | Mobile Money | Receive payments, B2B payments |
| **Airtel Money** | Mobile Money | Receive payments |
| **TigoPesa (MIC Tanzania)** | Mobile Money | Receive payments |
| **SMTP Email Provider** | Email | System notifications, invoices, payslips |
| **SMS Gateway** | SMS | Alerts, OTP, notifications |

### Viewing Configured Providers
Navigate to **Settings → Integrations → Providers** to see all configured integration providers and their current status (Connected / Disconnected / Error).

### Adding a New Integration Provider
1. Navigate to **Settings → Integrations → Providers → New Provider**.
2. Select the provider type (Mobile Money, SMTP, SMS).
3. Enter the provider name and select the specific service.
4. Fill in the required credentials (see below for each provider).
5. Click **Test Connection** to verify the credentials work.
6. Click **Save**.

#### M-Pesa Configuration
Required fields:
- **Consumer Key** and **Consumer Secret** (from Safaricom Developer Portal)
- **Shortcode** (Paybill or Till Number)
- **Passkey** (for STK Push)
- **Callback URL** (auto-filled: `https://[your-domain]/api/v1/integrations/mpesa/callback`)
- **Environment**: Sandbox or Production

#### Airtel Money Configuration
Required fields:
- **Client ID** and **Client Secret** (from Airtel Developer Portal)
- **Merchant ID**
- **Environment**: Sandbox or Production

#### TigoPesa Configuration
Required fields:
- **Username** and **Password** (from MIC Tanzania)
- **Biller Code**
- **Account Reference**

#### SMTP Email Configuration
Required fields:
- **Host** (e.g., smtp.gmail.com, mail.your-domain.com)
- **Port** (465 for SSL, 587 for STARTTLS)
- **Username** and **Password**
- **From Name** and **From Email**
- **Encryption**: SSL or STARTTLS

#### SMS Gateway Configuration
Required fields:
- **Provider**: (e.g., Africa's Talking, Beem Africa, SMS Live)
- **API Key** and **Sender ID**
- **API Endpoint URL**

---

## 2. Creating API Clients and Keys

API clients allow external systems or internal services to access ITEMBA-R programmatically.

### Creating an API Client
1. Navigate to **Settings → Integrations → API Clients → New Client**.
2. Enter the client name (e.g., "POS Terminal Integration", "Mobile App Client").
3. Select the **permission scope** — what this client is allowed to do (read-only, specific modules).
4. Set an expiry date (optional — for time-limited integrations).
5. Click **Generate API Key**.
6. The API key is displayed **once** — copy it immediately and store it securely.
7. Click **Confirm** — the key is saved (hashed, not reversible).

### Managing API Keys
- Navigate to **Settings → Integrations → API Keys** to see all active keys.
- Each key shows: client name, creation date, last used, expiry, and scope.
- **Revoke** a key immediately if it is compromised: click **Revoke Key** — the key is invalidated instantly.
- Never share API keys in email or chat. Use secure secrets management.

---

## 3. Webhook Configuration and Testing

Webhooks allow ITEMBA-R to notify external systems when specific events occur.

### Creating a Webhook
1. Navigate to **Settings → Integrations → Webhooks → New Webhook**.
2. Enter the **endpoint URL** of the external system.
3. Select the **events** to subscribe to:
   - `payment.received` — when a mobile money payment is confirmed
   - `invoice.created` — when a new invoice is raised
   - `shift.closed` — when a fuel shift is closed
   - `stock.low` — when a product falls below reorder level
   - `approval.completed` — when an approval workflow completes
4. Enter a **secret key** — ITEMBA-R signs webhook payloads with this key (HMAC-SHA256).
5. Click **Save**.

### Testing a Webhook
1. Open the webhook record and click **Send Test Event**.
2. Select the event type.
3. ITEMBA-R sends a sample payload to the configured URL.
4. View the response in the **Webhook Delivery Log**.
5. A 200 OK response indicates the endpoint received and accepted the event.

### Webhook Delivery Log
Navigate to **Settings → Integrations → Webhook Deliveries**:
- See all webhook delivery attempts with HTTP response codes.
- Failed deliveries (non-2xx) are retried automatically 3 times with exponential backoff.
- Manual retry is available for failed deliveries.

---

## 4. Device Registration for Offline Sync

ITEMBA-R supports registered devices (tablets, mobile phones) that can operate offline and sync when connectivity is restored.

### Registering a Device
1. Navigate to **Settings → Integrations → Devices → Register Device**.
2. Enter the device name (e.g., "Fuel Station Tablet", "Westsides POS Tablet").
3. Enter the device ID (unique identifier — obtainable from the device settings).
4. Select the company and branch this device operates for.
5. Select the **sync modules** this device can access offline (e.g., Petroleum Shifts, POS Transactions).
6. Click **Register** — a **device token** is generated.
7. Enter this token in the ITEMBA-R mobile/tablet application.

### Viewing Registered Devices
Navigate to **Settings → Integrations → Devices** to see all registered devices:
- Last sync timestamp
- Sync status (Up to Date, Pending Sync, Conflict Detected)
- Deactivate a device if it is lost or decommissioned.

---

## 5. Uploading Offline Sync Data

When a device reconnects to the network:

### Automatic Sync
The ITEMBA-R app on the device automatically initiates a sync when connectivity is detected. The app sends all pending transactions to the server.

### Manual Sync Upload (Admin)
For cases where the automatic sync fails:
1. Navigate to **Settings → Integrations → Offline Sync → Upload**.
2. Select the device.
3. Upload the sync file exported from the device.
4. Click **Process Sync**.
5. The system validates and imports the transactions.
6. Any conflicts are flagged for review (see section on Conflict Resolution).

### Conflict Resolution
When a sync conflict occurs (e.g., the same record was modified both offline and online):
1. Navigate to **Settings → Integrations → Sync Conflicts**.
2. Review each conflict — the system shows the offline version and the server version side by side.
3. Choose to **Accept Offline** (override with offline data) or **Keep Server** (discard offline change).
4. Resolved conflicts are logged in the audit trail.

---

## 6. External Payment Processing

### Processing an M-Pesa Payment
When a customer pays via M-Pesa:
1. The cashier enters the transaction amount and the customer's M-Pesa number.
2. Click **Request Payment** — ITEMBA-R initiates an STK Push to the customer's phone.
3. The customer enters their M-Pesa PIN on their phone.
4. ITEMBA-R receives the confirmation callback from Safaricom within 30 seconds.
5. The payment is automatically recorded and the invoice is marked paid.

### Verifying a Manual Mobile Money Payment
If the customer initiated the payment themselves (push payment):
1. Enter the M-Pesa/Airtel/Tigo transaction reference number.
2. Click **Verify Payment** — ITEMBA-R queries the payment provider API to confirm the transaction.
3. On confirmation, the payment is recorded.

---

## 7. Messaging Templates and Sending

### Creating a Message Template
1. Navigate to **Settings → Integrations → Message Templates → New Template**.
2. Select the channel: Email or SMS.
3. Enter a template name and select the trigger event.
4. Write the message body using template variables:
   - `{{customer_name}}` — recipient's name
   - `{{invoice_number}}` — invoice reference
   - `{{amount_due}}` — amount in TZS
   - `{{due_date}}` — payment due date
   - `{{company_name}}` — sending company name
5. Click **Save**.

### Available Template Variables
Variables available depend on the template category (Invoice, Payment, HR, Compliance, General Alert). Available variables are listed when creating the template.

### Sending a Message
Templates are triggered automatically by the relevant system events (e.g., invoice created, payment received, payslip generated). For manual sends:
1. Navigate to the relevant record (e.g., an invoice).
2. Click **Send Reminder** or **Send Message**.
3. Select the template.
4. Verify the recipient and content.
5. Click **Send**.

### Message Delivery Log
Navigate to **Settings → Integrations → Message Log** to see all sent messages with delivery status (Sent, Delivered, Failed) and timestamps. Failed messages can be manually retried.
