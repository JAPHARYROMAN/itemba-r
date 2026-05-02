#!/usr/bin/env pwsh
# ITEMBA-R one-command build pipeline.
#
# Usage:
#   .\scripts\build-all.ps1                  # validate + generate + build (no DB ops)
#   .\scripts\build-all.ps1 -Migrate         # also run prisma migrate deploy
#   .\scripts\build-all.ps1 -SkipFrontend    # backend only
#   .\scripts\build-all.ps1 -SkipBackend     # frontend only
#   .\scripts\build-all.ps1 -SkipInstall     # use existing node_modules
#   .\scripts\build-all.ps1 -SkipPrismaGenerate  # avoid Windows locked DLL regenerate
#
# Steps (in order):
#   1. prisma validate     (schema integrity)
#   2. prisma generate     (regenerate client)
#   3. prisma migrate deploy   [opt-in via -Migrate]
#   4. backend tsc --noEmit + nest build
#   5. frontend next build
#
# Exits non-zero on any failure so this can be wired into pre-push hooks or CI.

param(
    [switch]$Migrate,
    [switch]$SkipBackend,
    [switch]$SkipFrontend,
    [switch]$SkipInstall,
    [switch]$SkipPrismaGenerate
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot

function Step($label) {
    Write-Host ""
    Write-Host "==> $label" -ForegroundColor Cyan
}

function Run($cmd) {
    Write-Host "    $cmd" -ForegroundColor DarkGray
    Invoke-Expression $cmd
    if ($LASTEXITCODE -ne 0) { throw "FAILED: $cmd" }
}

Set-Location $ProjectRoot

if (-not $SkipBackend) {
    Set-Location "$ProjectRoot\backend"
    if (-not $SkipInstall) {
        Step "Installing backend dependencies"
        Run "npm ci"
    }

    Step "Validating Prisma schema"
    Run "npx prisma validate --schema=../database/prisma/schema.prisma"

    if (-not $SkipPrismaGenerate) {
        Step "Generating Prisma client"
        Run "npx prisma generate --schema=../database/prisma/schema.prisma"
    }

    if ($Migrate) {
        Step "Applying Prisma migrations (prisma migrate deploy)"
        Run "npx prisma migrate deploy --schema=../database/prisma/schema.prisma"
    }

    Step "Backend type check"
    Run "npx tsc --noEmit"

    Step "Backend build"
    Run "npm run build"
}

if (-not $SkipFrontend) {
    Set-Location "$ProjectRoot\frontend"
    if (-not $SkipInstall) {
        Step "Installing frontend dependencies"
        Run "npm ci"
    }

    Step "Frontend type check"
    Run "npx tsc --noEmit"

    Step "Frontend build"
    Run "npm run build"
}

Set-Location $ProjectRoot

Write-Host ""
Write-Host "All build steps passed." -ForegroundColor Green
