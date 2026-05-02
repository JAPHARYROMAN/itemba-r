#!/usr/bin/env pwsh
# ITEMBA-R Staging Deployment Script (Windows PowerShell)
# Usage: .\scripts\deploy-staging.ps1

param(
    [switch]$SkipBuild,
    [switch]$SkipMigrations,
    [switch]$SkipSeed,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot

Write-Host "╔══════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║         ITEMBA-R Staging Deployment                      ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════════════╝" -ForegroundColor Cyan

# Check .env.staging exists
if (-not (Test-Path "$ProjectRoot\.env.staging")) {
    Write-Host "ERROR: .env.staging not found." -ForegroundColor Red
    Write-Host "Copy .env.staging.example to .env.staging and fill in values." -ForegroundColor Yellow
    exit 1
}

Set-Location $ProjectRoot

# Step 1: Validate deployment configuration
Write-Host "`n[1/7] Validating staging deployment configuration..." -ForegroundColor Green
node scripts/validate-deployment.mjs --staging-only
docker compose -f docker-compose.staging.yml --env-file .env.staging config *> $null

# Step 2: Pull latest (if git)
if (Test-Path ".git") {
    Write-Host "`n[2/7] Pulling latest changes..." -ForegroundColor Green
    git pull origin main --rebase
} else {
    Write-Host "`n[2/7] Skipping git pull (not a git repo)" -ForegroundColor Yellow
}

# Step 3: Build images
if (-not $SkipBuild) {
    Write-Host "`n[3/7] Building Docker images..." -ForegroundColor Green
    docker compose -f docker-compose.staging.yml --env-file .env.staging build --no-cache
} else {
    Write-Host "`n[3/7] Skipping build (--SkipBuild)" -ForegroundColor Yellow
}

# Step 4: Start data services
Write-Host "`n[4/7] Starting staging data services..." -ForegroundColor Green
docker compose -f docker-compose.staging.yml --env-file .env.staging up -d postgres redis

Write-Host "Waiting for database to be ready..." -ForegroundColor Yellow
Start-Sleep -Seconds 10

# Step 5: Run migrations
if (-not $SkipMigrations) {
    Write-Host "`n[5/7] Running database migrations..." -ForegroundColor Green
    docker compose -f docker-compose.staging.yml --env-file .env.staging up `
        --force-recreate `
        --abort-on-container-exit `
        --exit-code-from backend-migrate `
        backend-migrate
} else {
    Write-Host "`n[5/7] Skipping migrations (--SkipMigrations; only use for already-migrated stacks)" -ForegroundColor Yellow
}

# Step 6: Seed database
if (-not $SkipSeed) {
    if (-not $Force) {
        $confirm = Read-Host "`n[6/7] Run seed data? This may overwrite existing data. (y/N)"
        if ($confirm -ne 'y' -and $confirm -ne 'Y') {
            Write-Host "Skipping seed." -ForegroundColor Yellow
            $SkipSeed = $true
        }
    }
    if (-not $SkipSeed) {
        Write-Host "`n[6/7] Running seed..." -ForegroundColor Green
        docker compose -f docker-compose.staging.yml --env-file .env.staging run --rm backend `
            npm run db:seed
    }
} else {
    Write-Host "`n[6/7] Skipping seed (--SkipSeed)" -ForegroundColor Yellow
}

# Step 7: Start application services
Write-Host "`n[7/7] Starting application services..." -ForegroundColor Green
if ($SkipMigrations) {
    docker compose -f docker-compose.staging.yml --env-file .env.staging up -d --no-deps backend
    docker compose -f docker-compose.staging.yml --env-file .env.staging up -d --no-deps frontend
} else {
    docker compose -f docker-compose.staging.yml --env-file .env.staging up -d backend frontend
}

Write-Host "`n✅ Staging deployment complete!" -ForegroundColor Green
Write-Host "Frontend: http://localhost:3000" -ForegroundColor Cyan
Write-Host "Backend:  http://localhost:3001/api/v1/health" -ForegroundColor Cyan

# Health check
Write-Host "`nRunning health check in 15 seconds..." -ForegroundColor Yellow
Start-Sleep -Seconds 15
try {
    $health = Invoke-RestMethod "http://localhost:3001/api/v1/health" -Method Get
    Write-Host "Health check: ✅ $($health | ConvertTo-Json)" -ForegroundColor Green
} catch {
    Write-Host "Health check: ⚠️  Backend not yet responding (may still be starting)" -ForegroundColor Yellow
    Write-Host "Check logs: docker compose -f docker-compose.staging.yml logs backend" -ForegroundColor Yellow
}
