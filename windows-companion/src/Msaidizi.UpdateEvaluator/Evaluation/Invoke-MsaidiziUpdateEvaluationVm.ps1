[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$RequestPath,
  [Parameter(Mandatory)][string]$ResponsePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-Identifier([string]$Value, [string]$Name) {
  if ($Value -notmatch '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$') {
    throw "invalid_$Name"
  }
}

function Assert-RunId([string]$Value) {
  $parsed = [Guid]::Empty
  if (-not [Guid]::TryParseExact($Value, 'D', [ref]$parsed)) { throw 'invalid_run_id' }
}

function New-GuestSession($Request) {
  if (-not (Test-Path -LiteralPath $Request.guestCredentialPath -PathType Leaf)) {
    throw 'guest_credential_unavailable'
  }
  $credential = Import-Clixml -LiteralPath $Request.guestCredentialPath
  if ($credential -isnot [PSCredential]) { throw 'guest_credential_invalid' }
  New-PSSession -VMName $Request.vmName -Credential $credential
}

function Wait-Heartbeat([string]$VmName, [int]$TimeoutSeconds) {
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    $heartbeat = Get-VMIntegrationService -VMName $VmName -Name 'Heartbeat' -ErrorAction Stop
    if ($heartbeat.Enabled -and $heartbeat.PrimaryStatusDescription -eq 'OK') { return }
    Start-Sleep -Seconds 2
  } while ([DateTime]::UtcNow -lt $deadline)
  throw 'vm_heartbeat_timeout'
}

function Write-Result($Value) {
  $json = $Value | ConvertTo-Json -Depth 20 -Compress
  $parent = Split-Path -Parent $ResponsePath
  if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
    throw 'response_parent_missing'
  }
  [IO.File]::WriteAllText($ResponsePath, $json, [Text.UTF8Encoding]::new($false))
}

$requestFile = Get-Item -LiteralPath $RequestPath -Force
if ($requestFile.PSIsContainer -or $requestFile.LinkType) { throw 'request_file_invalid' }
$request = Get-Content -Raw -LiteralPath $requestFile.FullName -Encoding utf8 | ConvertFrom-Json
Assert-RunId ([string]$request.runId)

switch ([string]$request.action) {
  'PREPARE' {
    Assert-Identifier ([string]$request.cleanSnapshotId) 'snapshot_id'
    $vm = Get-VM -Name $request.vmName -ErrorAction Stop
    $snapshot = Get-VMSnapshot -VM $vm -Name $request.snapshotName -ErrorAction Stop
    if ($vm.State -ne 'Off') { Stop-VM -VM $vm -TurnOff -Force }
    Restore-VMSnapshot -VMSnapshot $snapshot -Confirm:$false
    Start-VM -VM $vm | Out-Null
    Wait-Heartbeat $vm.Name ([int]$request.readyTimeoutSeconds)
    $session = New-GuestSession $request
    try {
      $result = Invoke-Command -Session $session -ArgumentList @(
        [string]$request.runId,
        [string]$request.guestRepositoryPath,
        [string]$request.guestWorkspaceRoot,
        [string]$request.cleanSnapshotId
      ) -ScriptBlock {
        param($RunId, $RepositoryPath, $WorkspaceRoot, $CleanSnapshotId)
        $ErrorActionPreference = 'Stop'
        $repository = [IO.Path]::GetFullPath($RepositoryPath).TrimEnd('\')
        $workspaceBase = [IO.Path]::GetFullPath($WorkspaceRoot).TrimEnd('\')
        $runRoot = [IO.Path]::GetFullPath((Join-Path $workspaceBase $RunId))
        if (-not $runRoot.StartsWith($workspaceBase + '\', [StringComparison]::OrdinalIgnoreCase)) {
          throw 'guest_workspace_escape'
        }
        if (-not (Test-Path -LiteralPath $repository -PathType Container)) {
          throw 'guest_repository_missing'
        }
        $repositoryItem = Get-Item -LiteralPath $repository -Force
        if ($repositoryItem.LinkType) { throw 'guest_repository_reparse_denied' }
        $volume = Get-Volume -DriveLetter ([IO.Path]::GetPathRoot($repository).Substring(0, 1))
        if ($volume.FileSystem -ne 'NTFS') { throw 'guest_workspace_not_ntfs' }
        if (Test-Path -LiteralPath $runRoot) { Remove-Item -LiteralPath $runRoot -Recurse -Force }
        New-Item -ItemType Directory -Path $runRoot | Out-Null
        $baseline = Join-Path $runRoot 'baseline'
        $working = Join-Path $runRoot 'working'
        Copy-Item -LiteralPath $repository -Destination $baseline -Recurse -Force
        Copy-Item -LiteralPath $baseline -Destination $working -Recurse -Force
        $marker = Join-Path $baseline '.msaidizi-base-revision.sha256'
        if (-not (Test-Path -LiteralPath $marker -PathType Leaf)) {
          throw 'base_revision_marker_missing'
        }
        $baseRevision = ([IO.File]::ReadAllText($marker)).Trim()
        if ($baseRevision -notmatch '^[0-9a-f]{64}$') { throw 'base_revision_marker_invalid' }

        $isolationOk = $true
        foreach ($entry in Get-ChildItem -LiteralPath $runRoot -Recurse -Force) {
          if ($entry.LinkType -or ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            $isolationOk = $false
            break
          }
          if (-not $entry.PSIsContainer) {
            $links = @(& fsutil.exe hardlink list $entry.FullName 2>$null)
            if ($LASTEXITCODE -ne 0 -or $links.Count -ne 1) { $isolationOk = $false; break }
          }
        }
        $dotnet = (& dotnet.exe --version 2>$null | Select-Object -First 1)
        $node = (& node.exe --version 2>$null | Select-Object -First 1)
        $powershell = $PSVersionTable.PSVersion.ToString()
        [pscustomobject]@{
          runId = $RunId
          cleanSnapshotId = $CleanSnapshotId
          baseRevisionSha256 = $baseRevision
          toolchainVersions = [ordered]@{
            dotnet = if ($dotnet) { [string]$dotnet } else { 'unavailable' }
            node = if ($node) { ([string]$node).TrimStart('v') } else { 'unavailable' }
            powershell = $powershell
          }
          isolatedWindowsVm = $true
          ntfsIsolationVerified = $isolationOk
        }
      }
      Write-Result $result
    }
    finally { Remove-PSSession -Session $session -ErrorAction SilentlyContinue }
  }

  'MATERIALIZE' {
    $manifestFile = Get-Item -LiteralPath $request.manifestPath -Force
    if ($manifestFile.PSIsContainer -or $manifestFile.LinkType -or $manifestFile.Length -gt 5MB) {
      throw 'manifest_file_invalid'
    }
    $session = New-GuestSession $request
    $guestManifest = Join-Path $request.guestWorkspaceRoot (
      ([string]$request.runId) + '\generation-manifest.json')
    try {
      Copy-Item -LiteralPath $manifestFile.FullName -Destination $guestManifest -ToSession $session -Force
      $result = Invoke-Command -Session $session -ArgumentList @(
        [string]$request.runId,
        [string]$request.guestWorkspaceRoot,
        $guestManifest
      ) -ScriptBlock {
        param($RunId, $WorkspaceRoot, $ManifestPath)
        $ErrorActionPreference = 'Stop'
        $runRoot = [IO.Path]::GetFullPath((Join-Path $WorkspaceRoot $RunId)).TrimEnd('\')
        $baseline = Join-Path $runRoot 'baseline'
        $working = Join-Path $runRoot 'working'
        $manifest = Get-Content -Raw -LiteralPath $ManifestPath -Encoding utf8 | ConvertFrom-Json

        function Is-Protected([string]$Relative) {
          $path = $Relative.ToLowerInvariant()
          $prefixes = @(
            '.github/workflows/', 'backend/scripts/', 'backend/src/common/',
            'backend/src/config/', 'backend/src/modules/audit-logs/',
            'backend/src/modules/auth/', 'backend/src/modules/msaidizi-audit-signer/',
            'backend/src/modules/msaidizi-control-plane/', 'backend/src/modules/msaidizi-recovery/',
            'backend/src/modules/msaidizi-task-runtime/', 'backend/src/modules/msaidizi-tasks/',
            'backend/src/modules/msaidizi-updates/', 'backend/src/modules/security/',
            'backend/src/prisma/', 'database/prisma/migrations/', 'deploy/',
            'windows-companion/config/', 'windows-companion/installer/',
            'windows-companion/locks/', 'windows-companion/scripts/',
            'windows-companion/src/msaidizi.auditsigner/',
            'windows-companion/src/msaidizi.egresssupervisor/',
            'windows-companion/src/msaidizi.privilegedcommandsupervisor/',
            'windows-companion/src/msaidizi.recoverysupervisor/',
            'windows-companion/src/msaidizi.updatesupervisor/',
            'windows-companion/src/msaidizi.updateevaluator/'
          )
          foreach ($prefix in $prefixes) { if ($path.StartsWith($prefix)) { return $true } }
          return $path -match '(bootstrap|trust.?key|kill.?switch|audit.?signer|recovery.?vault|update.?verif|supervisor|device.?identity|hardware.?key)'
        }

        function Resolve-WorkspacePath([string]$Relative) {
          if ($Relative.Contains('\') -or $Relative.Contains(':') -or $Relative.StartsWith('/') -or
              $Relative -match '(^|/)(\.|\.\.)(/|$)') { throw 'guest_change_path_invalid' }
          if (Is-Protected $Relative) { throw 'guest_protected_path_denied' }
          $path = [IO.Path]::GetFullPath((Join-Path $working ($Relative.Replace('/', '\'))))
          if (-not $path.StartsWith($working + '\', [StringComparison]::OrdinalIgnoreCase)) {
            throw 'guest_change_path_escape'
          }
          $cursor = Split-Path -Parent $path
          while ($cursor.StartsWith($working, [StringComparison]::OrdinalIgnoreCase)) {
            if (Test-Path -LiteralPath $cursor) {
              $item = Get-Item -LiteralPath $cursor -Force
              if ($item.LinkType -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
                throw 'guest_change_reparse_denied'
              }
            }
            if ($cursor -eq $working) { break }
            $cursor = Split-Path -Parent $cursor
          }
          $path
        }

        function Protected-Digest([string]$Root) {
          $lines = foreach ($file in Get-ChildItem -LiteralPath $Root -File -Recurse -Force |
              Sort-Object FullName) {
            $relative = $file.FullName.Substring($Root.TrimEnd('\').Length + 1).Replace('\', '/')
            if (Is-Protected $relative) {
              "$relative`0$((Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant())"
            }
          }
          $bytes = [Text.Encoding]::UTF8.GetBytes(($lines -join "`n"))
          try {
            $sha = [Security.Cryptography.SHA256]::Create()
            try { ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() }
            finally { $sha.Dispose() }
          }
          finally { [Array]::Clear($bytes, 0, $bytes.Length) }
        }

        $protectedBefore = Protected-Digest $baseline
        $bytesRead = 0L
        $bytesWritten = 0L
        foreach ($change in $manifest.changes) {
          $path = Resolve-WorkspacePath ([string]$change.relativePath)
          $exists = Test-Path -LiteralPath $path -PathType Leaf
          if ($exists) {
            $file = Get-Item -LiteralPath $path -Force
            if ($file.LinkType -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
              throw 'guest_change_reparse_denied'
            }
            $links = @(& fsutil.exe hardlink list $path 2>$null)
            if ($LASTEXITCODE -ne 0 -or $links.Count -ne 1) { throw 'guest_change_hardlink_denied' }
            $actual = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
            $bytesRead += $file.Length
          }
          if ($change.operation -eq 'ADD' -and $exists) { throw 'guest_add_precondition_failed' }
          if ($change.operation -ne 'ADD' -and (-not $exists -or $actual -ne $change.expectedPreSha256)) {
            throw 'guest_change_precondition_failed'
          }
          if ($change.operation -eq 'DELETE') {
            Remove-Item -LiteralPath $path -Force
            continue
          }
          $content = [Convert]::FromBase64String([string]$change.contentBase64)
          try {
            $sha = [Security.Cryptography.SHA256]::Create()
            try { $digest = ([BitConverter]::ToString($sha.ComputeHash($content))).Replace('-', '').ToLowerInvariant() }
            finally { $sha.Dispose() }
            if ($digest -ne $change.contentSha256) { throw 'guest_change_content_mismatch' }
            $parent = Split-Path -Parent $path
            [IO.Directory]::CreateDirectory($parent) | Out-Null
            $temporary = Join-Path $parent ('.msaidizi-' + [Guid]::NewGuid().ToString('N') + '.tmp')
            try {
              $stream = [IO.File]::Open($temporary, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
              try { $stream.Write($content); $stream.Flush($true) } finally { $stream.Dispose() }
              if (Test-Path -LiteralPath $path -PathType Leaf) {
                [IO.File]::Replace($temporary, $path, $null, $true)
              }
              else { [IO.File]::Move($temporary, $path) }
            }
            finally { Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue }
            $bytesWritten += $content.LongLength
          }
          finally { [Array]::Clear($content, 0, $content.Length) }
        }
        $protectedAfter = Protected-Digest $working
        [pscustomobject]@{
          supervisorIntegrity = -not ($manifest.changes | Where-Object { Is-Protected $_.relativePath })
          protectedBoundaryDiff = $protectedBefore -eq $protectedAfter
          bytesRead = $bytesRead
          bytesWritten = $bytesWritten
        }
      }
      Write-Result $result
    }
    finally { Remove-PSSession -Session $session -ErrorAction SilentlyContinue }
  }

  'RUN' {
    if ([int]$request.timeoutSeconds -lt 1 -or [int]$request.timeoutSeconds -gt 1800) {
      throw 'command_timeout_invalid'
    }
    if ([string]$request.check -notin @('TESTS', 'STATIC_ANALYSIS', 'ADVERSARIAL')) {
      throw 'command_check_invalid'
    }
    $session = New-GuestSession $request
    try {
      $result = Invoke-Command -Session $session -ArgumentList @(
        [string]$request.runId,
        [string]$request.guestWorkspaceRoot,
        [string]$request.check,
        [string]$request.fileName,
        [string[]]$request.arguments,
        [string]$request.workingDirectory,
        [int]$request.timeoutSeconds
      ) -ScriptBlock {
        param($RunId, $WorkspaceRoot, $Check, $FileName, $Arguments, $RelativeWorking, $TimeoutSeconds)
        $ErrorActionPreference = 'Stop'
        $working = [IO.Path]::GetFullPath((Join-Path (Join-Path $WorkspaceRoot $RunId) 'working')).TrimEnd('\')
        if ([IO.Path]::IsPathRooted($RelativeWorking) -or $RelativeWorking.Contains('..')) {
          throw 'command_working_path_invalid'
        }
        $commandWorking = [IO.Path]::GetFullPath((Join-Path $working $RelativeWorking))
        if ($commandWorking -ne $working -and
            -not $commandWorking.StartsWith($working + '\', [StringComparison]::OrdinalIgnoreCase)) {
          throw 'command_working_path_escape'
        }
        $executable = (Get-Command -Name $FileName -CommandType Application -ErrorAction Stop).Source
        $stdout = Join-Path $env:TEMP ('msaidizi-' + [Guid]::NewGuid().ToString('N') + '.out')
        $stderr = Join-Path $env:TEMP ('msaidizi-' + [Guid]::NewGuid().ToString('N') + '.err')
        try {
          $process = Start-Process -FilePath $executable -ArgumentList $Arguments -WorkingDirectory $commandWorking `
            -RedirectStandardOutput $stdout -RedirectStandardError $stderr -NoNewWindow -PassThru
          $timedOut = -not $process.WaitForExit($TimeoutSeconds * 1000)
          if ($timedOut) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue; $process.WaitForExit() }
          $outBytes = if (Test-Path -LiteralPath $stdout) { [IO.File]::ReadAllBytes($stdout) } else { [byte[]]@() }
          $errBytes = if (Test-Path -LiteralPath $stderr) { [IO.File]::ReadAllBytes($stderr) } else { [byte[]]@() }
          $stdoutHasher = $null
          $stderrHasher = $null
          try {
            $excerptBytes = $outBytes + $errBytes
            if ($excerptBytes.Length -gt 8192) { $excerptBytes = $excerptBytes[0..8191] }
            $stdoutHasher = [Security.Cryptography.SHA256]::Create()
            $stderrHasher = [Security.Cryptography.SHA256]::Create()
            [pscustomobject]@{
              check = $Check
              exitCode = if ($timedOut) { -1 } else { $process.ExitCode }
              timedOut = $timedOut
              cpuTimeSeconds = [Math]::Ceiling($process.TotalProcessorTime.TotalSeconds)
              bytesRead = 0
              bytesWritten = $outBytes.LongLength + $errBytes.LongLength
              stdoutSha256 = ([BitConverter]::ToString($stdoutHasher.ComputeHash($outBytes))).Replace('-', '').ToLowerInvariant()
              stderrSha256 = ([BitConverter]::ToString($stderrHasher.ComputeHash($errBytes))).Replace('-', '').ToLowerInvariant()
              outputExcerpt = [Text.Encoding]::UTF8.GetString($excerptBytes).Replace("`0", '')
            }
          }
          finally {
            if ($stdoutHasher) { $stdoutHasher.Dispose() }
            if ($stderrHasher) { $stderrHasher.Dispose() }
            [Array]::Clear($outBytes, 0, $outBytes.Length)
            [Array]::Clear($errBytes, 0, $errBytes.Length)
          }
        }
        finally {
          Remove-Item -LiteralPath $stdout,$stderr -Force -ErrorAction SilentlyContinue
        }
      }
      Write-Result $result
    }
    finally { Remove-PSSession -Session $session -ErrorAction SilentlyContinue }
  }

  'EXPORT' {
    if ([string]$request.purpose -notin @('SOURCE', 'ROLLBACK')) { throw 'export_purpose_invalid' }
    $destination = [IO.Path]::GetFullPath([string]$request.destination)
    $session = New-GuestSession $request
    try {
      $treeName = if ($request.purpose -eq 'SOURCE') { 'working' } else { 'baseline' }
      $guestPath = Join-Path (Join-Path $request.guestWorkspaceRoot $request.runId) $treeName
      Copy-Item -Path (Join-Path $guestPath '*') -Destination $destination -FromSession $session -Recurse -Force
      $bytes = (Get-ChildItem -LiteralPath $destination -File -Recurse -Force |
        Measure-Object -Property Length -Sum).Sum
      if ($null -eq $bytes) { $bytes = 0 }
      Write-Result ([pscustomobject]@{
        directoryPath = $destination
        bytesRead = [long]$bytes
        bytesWritten = [long]$bytes
      })
    }
    finally { Remove-PSSession -Session $session -ErrorAction SilentlyContinue }
  }

  'CLEANUP' {
    $vm = Get-VM -Name $request.vmName -ErrorAction Stop
    $snapshot = Get-VMSnapshot -VM $vm -Name $request.snapshotName -ErrorAction Stop
    if ($vm.State -ne 'Off') { Stop-VM -VM $vm -TurnOff -Force }
    Restore-VMSnapshot -VMSnapshot $snapshot -Confirm:$false
    Write-Result ([pscustomobject]@{ cleaned = $true })
  }

  default { throw 'unsupported_evaluator_action' }
}
