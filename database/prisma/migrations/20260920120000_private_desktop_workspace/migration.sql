ALTER TABLE "user_preferences" ADD COLUMN "desktop" JSONB, ADD COLUMN "desktopRevision" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "workspace_sessions" (
  "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "deviceId" TEXT NOT NULL, "name" TEXT NOT NULL, "layout" JSONB NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "workspace_sessions_userId_updatedAt_idx" ON "workspace_sessions"("userId", "updatedAt");
CREATE TABLE "workspace_drafts" (
  "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "appId" TEXT NOT NULL, "formType" TEXT NOT NULL, "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "companyId" TEXT, "divisionId" TEXT, "branchId" TEXT, "encryptedContent" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1, "leaseToken" TEXT, "leaseUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "workspace_drafts_userId_updatedAt_idx" ON "workspace_drafts"("userId", "updatedAt");
CREATE TABLE "workspace_wallpapers" (
  "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL, "width" INTEGER NOT NULL, "height" INTEGER NOT NULL, "image" BYTEA NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "workspace_wallpapers_userId_createdAt_idx" ON "workspace_wallpapers"("userId", "createdAt");
