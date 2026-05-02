#!/usr/bin/env pwsh
# ITEMBA-R Database Migration Script
# Usage: .\scripts\run-migrations.ps1 [-Env staging|production]

param(
    [string]$Env = "staging"
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot

Write-Host "Running ITEMBA-R migrations for: $Env" -ForegroundColor Cyan

$EnvFile = "$ProjectRoot\.env.$Env"
if (-not (Test-Path $EnvFile)) {
    Write-Host "ERROR: $EnvFile not found" -ForegroundColor Red
    exit 1
}

Set-Location $ProjectRoot
Set-Location backend

# Load env file
Get-Content $EnvFile | ForEach-Object {
    if ($_ -match '^([^#][^=]*)=(.*)$') {
        [Environment]::SetEnvironmentVariable($Matches[1].Trim(), $Matches[2].Trim(), 'Process')
    }
}

Write-Host "Running prisma migrate deploy..." -ForegroundColor Green
npx prisma migrate deploy --schema=..\database\prisma\schema.prisma

Write-Host "Generating Prisma client..." -ForegroundColor Green
npx prisma generate --schema=..\database\prisma\schema.prisma

Write-Host "✅ Migrations complete." -ForegroundColor Green
