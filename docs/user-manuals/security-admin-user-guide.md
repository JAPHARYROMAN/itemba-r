# Security & Admin User Guide

## Overview

This guide covers the security configuration, user session management, security event monitoring, two-factor authentication, backup scheduling, restore procedures, health checks, system monitoring, error log management, and deployment release management for ITEMBA-R administrators.

---

## 1. Security Policies Configuration

### Accessing Security Policies
Navigate to **Settings → Security → Security Policies**.

### Configurable Policies

**Password Policy**
- Minimum length (recommended: 10 characters)
- Require uppercase letters
- Require numbers
- Require special characters
- Maximum password age (days — force periodic password changes)
- Password history (prevent reuse of last N passwords)

**Session Policy**
- Access token lifetime (default: 15 minutes)
- Refresh token lifetime (default: 7 days)
- Maximum concurrent sessions per user
- Force logout on IP change (optional, may impact mobile users)

**Login Policy**
- Maximum failed login attempts before lock (recommended: 5)
- Account lockout duration (minutes)
- Lockout notification (email the user when their account is locked)

**Two-Factor Authentication (2FA) Policy**
- Require 2FA for all users
- Require 2FA for specific roles (recommended: require for Admin, Finance, Group Control roles)

To update a policy:
1. Click **Edit Policies**.
2. Adjust the values.
3. Click **Save Policies**.
4. Changes take effect for the next login session.

---

## 2. Managing User Sessions

### Viewing Active Sessions
1. Navigate to **Settings → Security → Active Sessions**.
2. See all currently active user sessions:
   - User name and email
   - Login timestamp
   - IP address and location (country/city)
   - Device (browser and OS)
   - Last activity time

### Revoking a Session
To immediately log out a specific user (e.g., suspected compromise, lost device):
1. Find the session in the active sessions list.
2. Click **Revoke Session**.
3. The user is immediately logged out — their tokens are invalidated.
4. The revocation is audit-logged.

### Revoking All Sessions for a User
To log out all active sessions for a user (e.g., before disabling an account):
1. Navigate to **Users → [User] → Security**.
2. Click **Revoke All Sessions**.
3. All active sessions are invalidated.

---

## 3. Viewing and Responding to Security Events

### Security Events Log
Navigate to **Settings → Security → Security Events** to see all security-related events:

| Event Type | Example |
|---|---|
| **Login Success** | User authenticated successfully |
| **Login Failure** | Invalid password entered |
| **Account Locked** | Account locked after N failed attempts |
| **Password Changed** | User changed their password |
| **2FA Passed / Failed** | Two-factor authentication result |
| **Session Revoked** | Admin revoked a session |
| **Sensitive Access** | Group Control records accessed |
| **Permission Denied** | User attempted an unauthorized action |
| **Admin Action** | Role changes, user creation/deletion |

### Responding to Suspicious Events
- Multiple failed logins from an unusual IP: investigate and consider blocking IP at the network layer.
- Failed logins followed by a success from the same IP: possible brute-force success — contact the user to verify.
- Sensitive access at unusual hours: review the access audit log in Group Control.

---

## 4. Failed Login Monitoring

Navigate to **Settings → Security → Failed Logins** for a dedicated view of all failed authentication attempts:
- Filter by date range, user, IP address.
- See the pattern of failures (are they targeting one account? one IP?).
- Click **Lock Account** directly from this view if a brute-force attack is suspected.
- Click **Block IP** to add the IP to the ITEMBA-R blocklist (requires network configuration support).

Set up an **alert** to notify the IT Administrator when more than 10 failed logins occur within 5 minutes: **Settings → Security → Alerts → New Alert → Failed Logins Threshold**.

---

## 5. Two-Factor Authentication (2FA) Setup

### Enabling 2FA for Your Account
1. Navigate to **Settings → My Profile → Security → Two-Factor Authentication**.
2. Click **Enable 2FA**.
3. Scan the QR code with your authenticator app (Google Authenticator, Microsoft Authenticator, Authy).
4. Enter the 6-digit code from the app to confirm setup.
5. Save your **backup codes** — these are one-time codes for emergency access.
6. 2FA is now active on your account.

### Admin: Enforcing 2FA for a Role
1. Navigate to **Settings → Security → Security Policies → 2FA Policy**.
2. Select the roles that must use 2FA.
3. Users in those roles will be required to set up 2FA on their next login.

### Resetting 2FA for a User (Admin)
If a user loses their 2FA device:
1. Navigate to **Users → [User] → Security → Reset 2FA**.
2. Confirm the reset — the user's 2FA is removed.
3. The user must reconfigure 2FA on their next login.
4. The reset is audit-logged.

---

## 6. Backup Schedule and Manual Backup

### Automated Backup Schedule
Navigate to **Settings → System → Backup → Schedule**:
- Configure daily backups (recommended: 2:00 AM EAT — Africa/Dar_es_Salaam).
- Set retention period (recommended: 30 days daily + 12 months monthly).
- Set the backup storage location (local path or S3-compatible object storage).
- Configure backup completion notifications.

### Running a Manual Backup
1. Navigate to **Settings → System → Backup → Run Manual Backup**.
2. Click **Start Backup**.
3. The system runs `pg_dump` on the PostgreSQL database.
4. Progress is shown in real-time.
5. On completion, the backup file location and size are displayed.
6. Verify the backup by downloading and checking the file.

---

## 7. Restore Procedure

> **Warning:** A restore operation overwrites the current database. Always perform a backup of the current state before restoring.

1. Navigate to **Settings → System → Backup → Restore**.
2. Select the backup file to restore from (list of available backups is shown).
3. Enter the confirmation code displayed on screen.
4. Click **Start Restore**.
5. The system will:
   - Stop the application
   - Run `pg_restore` with the selected backup file
   - Restart the application
   - Run integrity checks
6. After restore, verify the application is functioning correctly.
7. The restore event is logged in the system audit trail.

---

## 8. Health Checks

### Automated Health Check Endpoints
ITEMBA-R exposes health check endpoints:
- `GET /api/v1/health` — overall system health (database, queue, storage)
- `GET /api/v1/health/db` — database connection status
- `GET /api/v1/health/storage` — file storage connectivity

### Viewing the Health Dashboard
Navigate to **Settings → System → Health** to see:
- **Database**: Connection status, query latency
- **Background Jobs**: Queue length, last job run
- **File Storage**: Disk usage, storage connectivity
- **API Response Time**: Average and p95 response time
- **Memory Usage**: Application memory usage
- **Error Rate**: Errors per minute (last hour)

---

## 9. Monitoring Dashboard

Navigate to **Settings → System → Monitoring** for operational metrics:
- Active users in the last 15 minutes
- API request volume (requests/minute)
- Average API response time
- Background job queue depth
- Email queue (messages pending send)
- SMS queue (messages pending send)

Set up performance alerts: **Settings → System → Alerts → New Alert** to notify when response time exceeds threshold or error rate spikes.

---

## 10. Error Log Management

Navigate to **Settings → System → Error Logs** to view application errors:
- Filter by date range, severity, module, and error type.
- Each log entry shows: timestamp, error message, stack trace, affected user (if applicable), and module.
- **Acknowledge** errors that have been investigated to clear them from the active view.
- Export error logs for sharing with the development team.

Set up an alert for **new CRITICAL errors**: send immediate notification to the IT Admin when an uncaught error occurs.

---

## 11. Deployment Release Management

### Viewing Current Version
Navigate to **Settings → System → About** to see:
- Current application version
- Database schema version
- Last migration run date
- Build timestamp

### Applying an Update
1. Download the new release package from the authorized distribution channel.
2. Back up the database before applying any update.
3. Pull the new Docker images or update the application files.
4. Run migrations: `cd backend && npx prisma migrate deploy --schema=../database/prisma/schema.prisma`
5. Restart the application containers: `docker compose -f docker-compose.production.yml up -d`
6. Verify the health check endpoint returns 200 OK.
7. Navigate to **Settings → System → About** and confirm the new version is shown.
8. Record the release in **Settings → System → Release Log**.

### Release Log
Navigate to **Settings → System → Release Log** to maintain a record of all deployments:
- Version deployed
- Date and time
- Deployed by
- Changes summary
- Any issues encountered
