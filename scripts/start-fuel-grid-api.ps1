param(
  [string]$FuelGridRoot = (Join-Path (Split-Path $PSScriptRoot -Parent | Split-Path -Parent) 'fuelGrid os'),
  [int]$Port = 8090,
  [string]$RedisUrl = 'redis://127.0.0.1:6382/0'
)

$ErrorActionPreference = 'Stop'
$fgRootPath = (Resolve-Path -LiteralPath $FuelGridRoot).Path
if (-not (Test-Path -LiteralPath (Join-Path $fgRootPath 'services/api/cmd/api/main.go'))) {
  throw 'The supplied directory is not the Fuel Grid API project.'
}

# Only load the existing API credentials needed for this local service. They
# are inherited by the child process, never printed or placed in arguments.
$fgConfigKeys = @('DATABASE_URL', 'AUTH_PASSWORD_PEPPER', 'AUTH_SESSION_TTL', 'AUTH_REFRESH_TTL')
foreach ($fgLine in Get-Content -LiteralPath (Join-Path $fgRootPath '.env')) {
  if ($fgLine -match '^([A-Z_][A-Z0-9_]*)=(.*)$' -and $Matches[1] -in $fgConfigKeys) {
    [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim().Trim('"').Trim("'"), 'Process')
  }
}
$env:NODE_ENV = 'development'
$env:REDIS_URL = $RedisUrl
$env:API_HOST = '127.0.0.1'
$env:API_PORT = "$Port"
$env:API_CORS_ALLOWED_ORIGINS = 'http://localhost:3000,http://127.0.0.1:3000'
$fgProcess = Start-Process -FilePath 'go.exe' -ArgumentList @('run', './services/api/cmd/api') -WorkingDirectory $fgRootPath -WindowStyle Hidden -RedirectStandardOutput (Join-Path $env:TEMP 'itemba-os-fuelgrid-api.log') -RedirectStandardError (Join-Path $env:TEMP 'itemba-os-fuelgrid-api.err.log') -PassThru
Write-Output "Fuel Grid API starting (process $($fgProcess.Id)) on 127.0.0.1:$Port."
