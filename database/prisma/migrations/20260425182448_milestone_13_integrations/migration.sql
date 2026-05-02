-- CreateEnum
CREATE TYPE "IntegrationProviderType" AS ENUM ('MOBILE_MONEY', 'BANK', 'SMS', 'EMAIL', 'WHATSAPP', 'TAX_AUTHORITY', 'E_INVOICE', 'PAYMENT_GATEWAY', 'POS_DEVICE', 'LOGISTICS', 'HOSPITALITY_BOOKING', 'BI_EXPORT', 'ACCOUNTING_EXPORT', 'CUSTOM');

-- CreateEnum
CREATE TYPE "IntegrationProviderStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'TESTING', 'DEPRECATED');

-- CreateEnum
CREATE TYPE "IntegrationConnectionEnvironment" AS ENUM ('SANDBOX', 'PRODUCTION', 'TEST');

-- CreateEnum
CREATE TYPE "IntegrationConnectionStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ERROR', 'SUSPENDED', 'PENDING_SETUP');

-- CreateEnum
CREATE TYPE "IntegrationEventType" AS ENUM ('REQUEST_SENT', 'RESPONSE_RECEIVED', 'WEBHOOK_RECEIVED', 'WEBHOOK_VERIFIED', 'WEBHOOK_FAILED', 'SYNC_STARTED', 'SYNC_COMPLETED', 'SYNC_FAILED', 'TOKEN_REFRESH', 'CONNECTION_TEST', 'ERROR', 'OTHER');

-- CreateEnum
CREATE TYPE "IntegrationEventDirection" AS ENUM ('INBOUND', 'OUTBOUND', 'INTERNAL');

-- CreateEnum
CREATE TYPE "IntegrationEventStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'RETRYING', 'IGNORED');

-- CreateEnum
CREATE TYPE "WebhookEndpointStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "WebhookVerificationStatus" AS ENUM ('VERIFIED', 'FAILED', 'NOT_REQUIRED', 'PENDING');

-- CreateEnum
CREATE TYPE "WebhookProcessingStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'IGNORED', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "ApiClientType" AS ENUM ('INTERNAL_SERVICE', 'MOBILE_APP', 'EXTERNAL_APP', 'PARTNER', 'DEVICE', 'PUBLIC_API', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ApiClientStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'REVOKED');

-- CreateEnum
CREATE TYPE "ApiKeyStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "DeviceType" AS ENUM ('MOBILE', 'TABLET', 'POS_TERMINAL', 'FUEL_STATION_DEVICE', 'PARKING_GATE_DEVICE', 'HOTEL_RECEPTION_DEVICE', 'WAREHOUSE_DEVICE', 'FIELD_DEVICE', 'DESKTOP', 'OTHER');

-- CreateEnum
CREATE TYPE "DevicePlatform" AS ENUM ('ANDROID', 'IOS', 'WEB', 'WINDOWS', 'MACOS', 'LINUX', 'OTHER');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'BLOCKED', 'LOST', 'REVOKED');

-- CreateEnum
CREATE TYPE "MobileSessionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED', 'LOGGED_OUT');

-- CreateEnum
CREATE TYPE "OfflineSyncDirection" AS ENUM ('UPLOAD', 'DOWNLOAD', 'BIDIRECTIONAL');

-- CreateEnum
CREATE TYPE "OfflineSyncBatchStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED', 'CONFLICT', 'REJECTED');

-- CreateEnum
CREATE TYPE "OfflineSyncOperation" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'UPSERT');

-- CreateEnum
CREATE TYPE "OfflineSyncRecordStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED', 'CONFLICT', 'REJECTED', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "ExternalPaymentContext" AS ENUM ('SALES_ORDER', 'POS_TRANSACTION', 'RENT_INVOICE', 'PARKING_SESSION', 'ROOM_BOOKING', 'RESTAURANT_ORDER', 'FUEL_SHIFT', 'FUEL_CREDIT_SALE', 'PAYABLE', 'RECEIVABLE', 'SALARY_PAYMENT', 'TAX_RETURN', 'GENERAL');

-- CreateEnum
CREATE TYPE "ExternalPaymentMethod" AS ENUM ('MOBILE_MONEY', 'BANK_TRANSFER', 'CARD', 'USSD', 'QR', 'CASH_DEPOSIT', 'OTHER');

-- CreateEnum
CREATE TYPE "ExternalPaymentStatus" AS ENUM ('INITIATED', 'PENDING', 'SUCCESS', 'FAILED', 'CANCELLED', 'REVERSED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ExternalMessageRecipientType" AS ENUM ('PHONE', 'EMAIL', 'WHATSAPP', 'USER', 'CUSTOMER', 'SUPPLIER', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "ExternalMessageChannel" AS ENUM ('SMS', 'EMAIL', 'WHATSAPP', 'PUSH', 'IN_APP');

-- CreateEnum
CREATE TYPE "ExternalMessageStatus" AS ENUM ('DRAFT', 'QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MessageTemplateType" AS ENUM ('PAYMENT_RECEIPT', 'APPROVAL_NOTIFICATION', 'COMPLIANCE_REMINDER', 'DOCUMENT_EXPIRY', 'LICENSE_EXPIRY', 'BOOKING_CONFIRMATION', 'RENT_REMINDER', 'PARKING_RECEIPT', 'PAYSLIP_NOTIFICATION', 'GENERAL');

-- CreateEnum
CREATE TYPE "MessageTemplateStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'DRAFT');

-- CreateEnum
CREATE TYPE "IntegrationMappingStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'CONFLICT');

-- CreateTable
CREATE TABLE "integration_providers" (
    "id" TEXT NOT NULL,
    "providerCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "providerType" "IntegrationProviderType" NOT NULL,
    "description" TEXT,
    "baseUrl" TEXT,
    "documentationUrl" TEXT,
    "status" "IntegrationProviderStatus" NOT NULL DEFAULT 'ACTIVE',
    "supportsWebhooks" BOOLEAN NOT NULL DEFAULT false,
    "supportsSandbox" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "integration_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_connections" (
    "id" TEXT NOT NULL,
    "connectionCode" TEXT NOT NULL,
    "companyId" TEXT,
    "divisionId" TEXT,
    "branchId" TEXT,
    "licensedBusinessUnitId" TEXT,
    "providerId" TEXT NOT NULL,
    "connectionName" TEXT NOT NULL,
    "environment" "IntegrationConnectionEnvironment" NOT NULL DEFAULT 'SANDBOX',
    "status" "IntegrationConnectionStatus" NOT NULL DEFAULT 'PENDING_SETUP',
    "credentialsEncrypted" JSONB,
    "publicConfig" JSONB,
    "privateConfigEncrypted" JSONB,
    "lastTestedAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastErrorMessage" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "integration_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_events" (
    "id" TEXT NOT NULL,
    "eventNumber" TEXT NOT NULL,
    "companyId" TEXT,
    "providerId" TEXT,
    "connectionId" TEXT,
    "eventType" "IntegrationEventType" NOT NULL DEFAULT 'OTHER',
    "direction" "IntegrationEventDirection" NOT NULL DEFAULT 'OUTBOUND',
    "entityType" TEXT,
    "entityId" TEXT,
    "status" "IntegrationEventStatus" NOT NULL DEFAULT 'PENDING',
    "requestPayload" JSONB,
    "responsePayload" JSONB,
    "errorMessage" TEXT,
    "correlationId" TEXT,
    "idempotencyKey" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_endpoints" (
    "id" TEXT NOT NULL,
    "webhookCode" TEXT NOT NULL,
    "companyId" TEXT,
    "providerId" TEXT,
    "connectionId" TEXT,
    "name" TEXT NOT NULL,
    "endpointPath" TEXT NOT NULL,
    "secretHash" TEXT,
    "status" "WebhookEndpointStatus" NOT NULL DEFAULT 'ACTIVE',
    "allowedEvents" JSONB,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "webhookEventNumber" TEXT NOT NULL,
    "webhookEndpointId" TEXT,
    "providerId" TEXT,
    "connectionId" TEXT,
    "companyId" TEXT,
    "eventName" TEXT NOT NULL,
    "externalEventId" TEXT,
    "payload" JSONB NOT NULL,
    "headers" JSONB,
    "verificationStatus" "WebhookVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "processingStatus" "WebhookProcessingStatus" NOT NULL DEFAULT 'RECEIVED',
    "linkedEntityType" TEXT,
    "linkedEntityId" TEXT,
    "errorMessage" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_clients" (
    "id" TEXT NOT NULL,
    "clientCode" TEXT NOT NULL,
    "companyId" TEXT,
    "name" TEXT NOT NULL,
    "clientType" "ApiClientType" NOT NULL DEFAULT 'EXTERNAL_APP',
    "status" "ApiClientStatus" NOT NULL DEFAULT 'ACTIVE',
    "description" TEXT,
    "allowedScopes" JSONB NOT NULL,
    "allowedIpAddresses" JSONB,
    "rateLimitPerMinute" INTEGER,
    "rateLimitPerDay" INTEGER,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "api_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "apiKeyCode" TEXT NOT NULL,
    "apiClientId" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scopes" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "status" "ApiKeyStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_request_logs" (
    "id" TEXT NOT NULL,
    "requestNumber" TEXT NOT NULL,
    "apiClientId" TEXT,
    "apiKeyId" TEXT,
    "userId" TEXT,
    "companyId" TEXT,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "statusCode" INTEGER,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "requestId" TEXT,
    "durationMs" INTEGER,
    "rateLimited" BOOLEAN NOT NULL DEFAULT false,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_request_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_registrations" (
    "id" TEXT NOT NULL,
    "deviceCode" TEXT NOT NULL,
    "userId" TEXT,
    "employeeId" TEXT,
    "companyId" TEXT,
    "deviceName" TEXT,
    "deviceType" "DeviceType" NOT NULL DEFAULT 'MOBILE',
    "platform" "DevicePlatform" NOT NULL DEFAULT 'ANDROID',
    "appVersion" TEXT,
    "deviceIdentifierHash" TEXT,
    "pushToken" TEXT,
    "status" "DeviceStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastSeenAt" TIMESTAMP(3),
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "device_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mobile_sessions" (
    "id" TEXT NOT NULL,
    "sessionCode" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT,
    "companyId" TEXT,
    "refreshTokenHash" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "appVersion" TEXT,
    "status" "MobileSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mobile_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offline_sync_batches" (
    "id" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "clientBatchId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT,
    "companyId" TEXT,
    "syncDirection" "OfflineSyncDirection" NOT NULL DEFAULT 'UPLOAD',
    "status" "OfflineSyncBatchStatus" NOT NULL DEFAULT 'RECEIVED',
    "recordCount" INTEGER NOT NULL DEFAULT 0,
    "processedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "conflictCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offline_sync_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offline_sync_records" (
    "id" TEXT NOT NULL,
    "syncBatchId" TEXT NOT NULL,
    "clientRecordId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "operation" "OfflineSyncOperation" NOT NULL DEFAULT 'CREATE',
    "payload" JSONB NOT NULL,
    "clientUpdatedAt" TIMESTAMP(3),
    "serverProcessedAt" TIMESTAMP(3),
    "status" "OfflineSyncRecordStatus" NOT NULL DEFAULT 'PENDING',
    "conflictReason" TEXT,
    "serverValue" JSONB,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offline_sync_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_checkpoints" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT,
    "companyId" TEXT,
    "entityType" TEXT NOT NULL,
    "lastSyncAt" TIMESTAMP(3) NOT NULL,
    "lastServerCursor" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_checkpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_payments" (
    "id" TEXT NOT NULL,
    "paymentNumber" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "providerId" TEXT,
    "connectionId" TEXT,
    "paymentContextType" "ExternalPaymentContext" NOT NULL DEFAULT 'GENERAL',
    "paymentContextId" TEXT,
    "externalReference" TEXT,
    "payerName" TEXT,
    "payerPhone" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TZS',
    "paymentMethod" "ExternalPaymentMethod" NOT NULL DEFAULT 'MOBILE_MONEY',
    "status" "ExternalPaymentStatus" NOT NULL DEFAULT 'INITIATED',
    "initiatedById" TEXT,
    "confirmedById" TEXT,
    "initiatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "rawProviderResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "external_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_messages" (
    "id" TEXT NOT NULL,
    "messageNumber" TEXT NOT NULL,
    "companyId" TEXT,
    "providerId" TEXT,
    "connectionId" TEXT,
    "recipient" TEXT NOT NULL,
    "recipientType" "ExternalMessageRecipientType" NOT NULL DEFAULT 'PHONE',
    "channel" "ExternalMessageChannel" NOT NULL DEFAULT 'SMS',
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "templateId" TEXT,
    "status" "ExternalMessageStatus" NOT NULL DEFAULT 'QUEUED',
    "externalReference" TEXT,
    "errorMessage" TEXT,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_templates" (
    "id" TEXT NOT NULL,
    "templateCode" TEXT NOT NULL,
    "companyId" TEXT,
    "name" TEXT NOT NULL,
    "channel" "ExternalMessageChannel" NOT NULL,
    "templateType" "MessageTemplateType" NOT NULL DEFAULT 'GENERAL',
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "variables" JSONB,
    "status" "MessageTemplateStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_mappings" (
    "id" TEXT NOT NULL,
    "mappingCode" TEXT NOT NULL,
    "companyId" TEXT,
    "providerId" TEXT,
    "connectionId" TEXT,
    "internalEntityType" TEXT NOT NULL,
    "externalEntityType" TEXT NOT NULL,
    "internalEntityId" TEXT,
    "externalEntityId" TEXT NOT NULL,
    "mappingData" JSONB,
    "status" "IntegrationMappingStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "integration_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "integration_providers_providerCode_key" ON "integration_providers"("providerCode");

-- CreateIndex
CREATE INDEX "integration_providers_providerCode_status_providerType_idx" ON "integration_providers"("providerCode", "status", "providerType");

-- CreateIndex
CREATE UNIQUE INDEX "integration_connections_connectionCode_key" ON "integration_connections"("connectionCode");

-- CreateIndex
CREATE INDEX "integration_connections_companyId_providerId_status_environ_idx" ON "integration_connections"("companyId", "providerId", "status", "environment");

-- CreateIndex
CREATE UNIQUE INDEX "integration_events_eventNumber_key" ON "integration_events"("eventNumber");

-- CreateIndex
CREATE INDEX "integration_events_companyId_providerId_connectionId_eventT_idx" ON "integration_events"("companyId", "providerId", "connectionId", "eventType", "status", "direction", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_endpoints_webhookCode_key" ON "webhook_endpoints"("webhookCode");

-- CreateIndex
CREATE INDEX "webhook_endpoints_webhookCode_status_companyId_idx" ON "webhook_endpoints"("webhookCode", "status", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_webhookEventNumber_key" ON "webhook_events"("webhookEventNumber");

-- CreateIndex
CREATE INDEX "webhook_events_companyId_providerId_processingStatus_verifi_idx" ON "webhook_events"("companyId", "providerId", "processingStatus", "verificationStatus", "receivedAt");

-- CreateIndex
CREATE INDEX "webhook_events_externalEventId_idx" ON "webhook_events"("externalEventId");

-- CreateIndex
CREATE UNIQUE INDEX "api_clients_clientCode_key" ON "api_clients"("clientCode");

-- CreateIndex
CREATE INDEX "api_clients_clientCode_status_clientType_companyId_idx" ON "api_clients"("clientCode", "status", "clientType", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_apiKeyCode_key" ON "api_keys"("apiKeyCode");

-- CreateIndex
CREATE INDEX "api_keys_apiClientId_status_expiresAt_idx" ON "api_keys"("apiClientId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "api_keys_keyPrefix_idx" ON "api_keys"("keyPrefix");

-- CreateIndex
CREATE UNIQUE INDEX "api_request_logs_requestNumber_key" ON "api_request_logs"("requestNumber");

-- CreateIndex
CREATE INDEX "api_request_logs_apiClientId_apiKeyId_statusCode_rateLimite_idx" ON "api_request_logs"("apiClientId", "apiKeyId", "statusCode", "rateLimited", "createdAt");

-- CreateIndex
CREATE INDEX "api_request_logs_path_createdAt_idx" ON "api_request_logs"("path", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "device_registrations_deviceCode_key" ON "device_registrations"("deviceCode");

-- CreateIndex
CREATE INDEX "device_registrations_userId_companyId_status_deviceType_idx" ON "device_registrations"("userId", "companyId", "status", "deviceType");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_sessions_sessionCode_key" ON "mobile_sessions"("sessionCode");

-- CreateIndex
CREATE INDEX "mobile_sessions_userId_deviceId_status_expiresAt_idx" ON "mobile_sessions"("userId", "deviceId", "status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "offline_sync_batches_batchNumber_key" ON "offline_sync_batches"("batchNumber");

-- CreateIndex
CREATE UNIQUE INDEX "offline_sync_batches_clientBatchId_key" ON "offline_sync_batches"("clientBatchId");

-- CreateIndex
CREATE INDEX "offline_sync_batches_userId_companyId_status_syncDirection__idx" ON "offline_sync_batches"("userId", "companyId", "status", "syncDirection", "createdAt");

-- CreateIndex
CREATE INDEX "offline_sync_records_syncBatchId_entityType_status_operatio_idx" ON "offline_sync_records"("syncBatchId", "entityType", "status", "operation");

-- CreateIndex
CREATE INDEX "sync_checkpoints_userId_deviceId_entityType_idx" ON "sync_checkpoints"("userId", "deviceId", "entityType");

-- CreateIndex
CREATE UNIQUE INDEX "sync_checkpoints_userId_deviceId_entityType_key" ON "sync_checkpoints"("userId", "deviceId", "entityType");

-- CreateIndex
CREATE UNIQUE INDEX "external_payments_paymentNumber_key" ON "external_payments"("paymentNumber");

-- CreateIndex
CREATE INDEX "external_payments_companyId_providerId_status_paymentContex_idx" ON "external_payments"("companyId", "providerId", "status", "paymentContextType", "initiatedAt");

-- CreateIndex
CREATE INDEX "external_payments_externalReference_idx" ON "external_payments"("externalReference");

-- CreateIndex
CREATE UNIQUE INDEX "external_messages_messageNumber_key" ON "external_messages"("messageNumber");

-- CreateIndex
CREATE INDEX "external_messages_companyId_channel_status_createdAt_idx" ON "external_messages"("companyId", "channel", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "message_templates_templateCode_key" ON "message_templates"("templateCode");

-- CreateIndex
CREATE INDEX "message_templates_companyId_channel_templateType_status_idx" ON "message_templates"("companyId", "channel", "templateType", "status");

-- CreateIndex
CREATE UNIQUE INDEX "integration_mappings_mappingCode_key" ON "integration_mappings"("mappingCode");

-- CreateIndex
CREATE INDEX "integration_mappings_companyId_providerId_internalEntityTyp_idx" ON "integration_mappings"("companyId", "providerId", "internalEntityType", "externalEntityType", "status");

-- CreateIndex
CREATE INDEX "integration_mappings_internalEntityId_internalEntityType_idx" ON "integration_mappings"("internalEntityId", "internalEntityType");

-- AddForeignKey
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "integration_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_events" ADD CONSTRAINT "integration_events_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_events" ADD CONSTRAINT "integration_events_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "integration_providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_events" ADD CONSTRAINT "integration_events_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "integration_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_events" ADD CONSTRAINT "integration_events_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "integration_providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "integration_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_webhookEndpointId_fkey" FOREIGN KEY ("webhookEndpointId") REFERENCES "webhook_endpoints"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "integration_providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "integration_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_clients" ADD CONSTRAINT "api_clients_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_clients" ADD CONSTRAINT "api_clients_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_apiClientId_fkey" FOREIGN KEY ("apiClientId") REFERENCES "api_clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_request_logs" ADD CONSTRAINT "api_request_logs_apiClientId_fkey" FOREIGN KEY ("apiClientId") REFERENCES "api_clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_request_logs" ADD CONSTRAINT "api_request_logs_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "api_keys"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_request_logs" ADD CONSTRAINT "api_request_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_request_logs" ADD CONSTRAINT "api_request_logs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_registrations" ADD CONSTRAINT "device_registrations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_registrations" ADD CONSTRAINT "device_registrations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_sessions" ADD CONSTRAINT "mobile_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_sessions" ADD CONSTRAINT "mobile_sessions_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "device_registrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_sessions" ADD CONSTRAINT "mobile_sessions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offline_sync_batches" ADD CONSTRAINT "offline_sync_batches_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offline_sync_batches" ADD CONSTRAINT "offline_sync_batches_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "device_registrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offline_sync_batches" ADD CONSTRAINT "offline_sync_batches_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offline_sync_records" ADD CONSTRAINT "offline_sync_records_syncBatchId_fkey" FOREIGN KEY ("syncBatchId") REFERENCES "offline_sync_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offline_sync_records" ADD CONSTRAINT "offline_sync_records_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_checkpoints" ADD CONSTRAINT "sync_checkpoints_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_checkpoints" ADD CONSTRAINT "sync_checkpoints_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "device_registrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_checkpoints" ADD CONSTRAINT "sync_checkpoints_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_payments" ADD CONSTRAINT "external_payments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_payments" ADD CONSTRAINT "external_payments_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "integration_providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_payments" ADD CONSTRAINT "external_payments_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "integration_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_payments" ADD CONSTRAINT "external_payments_initiatedById_fkey" FOREIGN KEY ("initiatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_payments" ADD CONSTRAINT "external_payments_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_messages" ADD CONSTRAINT "external_messages_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_messages" ADD CONSTRAINT "external_messages_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "integration_providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_messages" ADD CONSTRAINT "external_messages_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "integration_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_messages" ADD CONSTRAINT "external_messages_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "message_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_messages" ADD CONSTRAINT "external_messages_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_mappings" ADD CONSTRAINT "integration_mappings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_mappings" ADD CONSTRAINT "integration_mappings_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "integration_providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_mappings" ADD CONSTRAINT "integration_mappings_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "integration_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;
