Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-CanonicalLocalPathComponents {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Description,
        [switch]$AllowMissingLeaf
    )

    if ([string]::IsNullOrWhiteSpace($Path) -or
        $Path.StartsWith('\\', [StringComparison]::Ordinal) -or
        $Path.StartsWith('\\?\', [StringComparison]::Ordinal) -or
        $Path.StartsWith('\\.\', [StringComparison]::Ordinal)) {
        throw "$Description must be a canonical local drive path: $Path"
    }

    $fullPath = [IO.Path]::GetFullPath($Path)
    $volumeRoot = [IO.Path]::GetPathRoot($fullPath)
    if ([string]::IsNullOrEmpty($volumeRoot) -or $volumeRoot.StartsWith('\\', [StringComparison]::Ordinal)) {
        throw "$Description has no supported local volume root: $Path"
    }
    $relative = $fullPath.Substring($volumeRoot.Length)
    if ($relative.Contains(':')) {
        throw "$Description contains an alternate data stream or invalid drive separator: $Path"
    }

    $current = $volumeRoot
    $separators = [char[]]@(
        [IO.Path]::DirectorySeparatorChar,
        [IO.Path]::AltDirectorySeparatorChar
    )
    $segments = @($relative.Split($separators, [StringSplitOptions]::RemoveEmptyEntries))
    for ($index = 0; $index -lt $segments.Count; $index++) {
        $current = Join-Path $current $segments[$index]
        if (-not (Test-Path -LiteralPath $current)) {
            if ($AllowMissingLeaf -and $index -eq $segments.Count - 1) { break }
            throw "$Description contains a missing path component: $current"
        }
        $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "$Description contains a reparse-point component: $current"
        }
    }

    return $fullPath
}

function Assert-WindowsReleaseHost {
    if (-not $IsWindows -and $PSVersionTable.PSEdition -eq 'Core') {
        throw 'The signed Windows release pipeline must run on Windows.'
    }
}

function Resolve-ExistingLeafPath {
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$Description)

    if ([string]::IsNullOrWhiteSpace($Path)) {
        throw "$Description path is required."
    }

    $canonical = Assert-CanonicalLocalPathComponents -Path $Path -Description $Description
    $item = Get-Item -LiteralPath $canonical -Force -ErrorAction Stop
    if ($item.PSIsContainer) {
        throw "$Description must be a file: $Path"
    }

    return $item.FullName
}

function Resolve-ExistingDirectoryPath {
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$Description)

    if ([string]::IsNullOrWhiteSpace($Path)) {
        throw "$Description path is required."
    }

    $canonical = Assert-CanonicalLocalPathComponents -Path $Path -Description $Description
    $item = Get-Item -LiteralPath $canonical -Force -ErrorAction Stop
    if (-not $item.PSIsContainer) {
        throw "$Description must be a directory: $Path"
    }

    return $item.FullName.TrimEnd([IO.Path]::DirectorySeparatorChar)
}

function Assert-SafeNewDirectoryPath {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$RequiredParent
    )

    if ([string]::IsNullOrWhiteSpace($Path) -or [IO.Path]::IsPathRooted($Path) -eq $false) {
        throw 'The candidate path must be an absolute path.'
    }

    if ($Path.StartsWith('\\', [StringComparison]::Ordinal) -or
        $Path.StartsWith('\\?\', [StringComparison]::Ordinal) -or
        $Path.StartsWith('\\.\', [StringComparison]::Ordinal)) {
        throw "UNC and device paths are forbidden: $Path"
    }

    $parent = Resolve-ExistingDirectoryPath -Path $RequiredParent -Description 'candidate output root'
    $candidate = [IO.Path]::GetFullPath($Path).TrimEnd([IO.Path]::DirectorySeparatorChar)
    if (-not $candidate.StartsWith($parent + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Candidate path must be a new child of the configured output root: $candidate"
    }

    if (Test-Path -LiteralPath $candidate) {
        throw "Refusing to overwrite an existing release candidate: $candidate"
    }

    return $candidate
}

function Assert-VerifiedDirectChildDirectory {
    param(
        [Parameter(Mandatory)][string]$Parent,
        [Parameter(Mandatory)][string]$Child,
        [Parameter(Mandatory)][string]$ExpectedLeafName
    )

    if ([string]::IsNullOrWhiteSpace($ExpectedLeafName) -or
        $ExpectedLeafName.IndexOfAny([IO.Path]::GetInvalidFileNameChars()) -ge 0 -or
        $ExpectedLeafName.Contains('\') -or $ExpectedLeafName.Contains('/')) {
        throw "Invalid expected child directory name: $ExpectedLeafName"
    }
    $parentPath = Resolve-ExistingDirectoryPath -Path $Parent -Description 'verified candidate parent'
    $childPath = Resolve-ExistingDirectoryPath -Path $Child -Description "verified candidate child '$ExpectedLeafName'"
    $childItem = Get-Item -LiteralPath $childPath -Force -ErrorAction Stop
    $actualParent = $childItem.Parent.FullName.TrimEnd([IO.Path]::DirectorySeparatorChar)
    if ($childItem.Name -cne $ExpectedLeafName -or
        -not $actualParent.Equals($parentPath, [StringComparison]::OrdinalIgnoreCase) -or
        -not ([IO.Path]::GetPathRoot($childPath)).Equals([IO.Path]::GetPathRoot($parentPath), [StringComparison]::OrdinalIgnoreCase)) {
        throw "Candidate directory is not the exact same-volume direct child '$ExpectedLeafName' of $parentPath."
    }
    return $childPath
}

function Assert-VerifiedCandidateLayout {
    param(
        [Parameter(Mandatory)][string]$OutputRoot,
        [Parameter(Mandatory)][string]$CandidateRoot
    )

    $candidateItem = Get-Item -LiteralPath (Resolve-ExistingDirectoryPath -Path $CandidateRoot -Description 'candidate root') -Force
    Assert-VerifiedDirectChildDirectory -Parent $OutputRoot -Child $candidateItem.FullName -ExpectedLeafName $candidateItem.Name | Out-Null
    foreach ($leafName in @('payload', 'package', 'evidence', 'support')) {
        Assert-VerifiedDirectChildDirectory -Parent $candidateItem.FullName -Child (Join-Path $candidateItem.FullName $leafName) -ExpectedLeafName $leafName | Out-Null
    }
}

function Remove-VerifiedStagedConfiguration {
    param(
        [Parameter(Mandatory)][string]$PayloadRoot,
        [Parameter(Mandatory)][string]$PublishDirectory,
        [Parameter(Mandatory)][string]$Path
    )

    $payload = Resolve-ExistingDirectoryPath -Path $PayloadRoot -Description 'publish payload root'
    $publish = Resolve-ExistingDirectoryPath -Path $PublishDirectory -Description 'publish staging directory'
    $publishItem = Get-Item -LiteralPath $publish -Force
    Assert-VerifiedDirectChildDirectory -Parent $payload -Child $publish -ExpectedLeafName $publishItem.Name | Out-Null
    $file = Resolve-ExistingLeafPath -Path $Path -Description 'staged publish configuration'
    $expected = [IO.Path]::GetFullPath((Join-Path $publish 'appsettings.json'))
    if (-not $file.Equals($expected, [StringComparison]::OrdinalIgnoreCase) -or
        -not ([IO.Path]::GetPathRoot($file)).Equals([IO.Path]::GetPathRoot($payload), [StringComparison]::OrdinalIgnoreCase)) {
        throw "Only the exact direct staged appsettings.json may be removed: $file"
    }

    if (-not ('Itemba.Msaidizi.Installer.Release.NativeFileIdentity' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace Itemba.Msaidizi.Installer.Release
{
  public static class NativeFileIdentity
  {
    [StructLayout(LayoutKind.Sequential)]
    private struct ByHandleFileInformation
    {
      public uint FileAttributes;
      public System.Runtime.InteropServices.ComTypes.FILETIME CreationTime;
      public System.Runtime.InteropServices.ComTypes.FILETIME LastAccessTime;
      public System.Runtime.InteropServices.ComTypes.FILETIME LastWriteTime;
      public uint VolumeSerialNumber;
      public uint FileSizeHigh;
      public uint FileSizeLow;
      public uint NumberOfLinks;
      public uint FileIndexHigh;
      public uint FileIndexLow;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct FileDispositionInfo
    {
      [MarshalAs(UnmanagedType.Bool)] public bool DeleteFile;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(
      string fileName, uint desiredAccess, uint shareMode, IntPtr securityAttributes,
      uint creationDisposition, uint flagsAndAttributes, IntPtr templateFile);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetFileInformationByHandle(
      SafeFileHandle file, out ByHandleFileInformation information);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetFinalPathNameByHandle(
      SafeFileHandle file, StringBuilder path, uint pathLength, uint flags);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetFileInformationByHandle(
      SafeFileHandle file, int informationClass, ref FileDispositionInfo information, uint bufferSize);

    public static void DeleteSingleLinkAtExactFinalPath(string path)
    {
      const uint GenericRead = 0x80000000;
      const uint Delete = 0x00010000;
      const uint FileShareRead = 0x00000001;
      const uint OpenExisting = 3;
      const uint FileFlagOpenReparsePoint = 0x00200000;
      const int FileDispositionInfoClass = 4;

      var expected = System.IO.Path.GetFullPath(path);
      using (var handle = CreateFile(expected, GenericRead | Delete, FileShareRead, IntPtr.Zero,
        OpenExisting, FileFlagOpenReparsePoint, IntPtr.Zero))
      {
        if (handle.IsInvalid)
          throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not lock the staged configuration for exact removal.");
        ByHandleFileInformation information;
        if (!GetFileInformationByHandle(handle, out information))
          throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not inspect the staged configuration identity.");
        if (information.NumberOfLinks != 1)
          throw new InvalidOperationException("The staged configuration has more than one hard link.");
        var finalPath = new StringBuilder(32768);
        var length = GetFinalPathNameByHandle(handle, finalPath, (uint)finalPath.Capacity, 0);
        if (length == 0 || length >= finalPath.Capacity)
          throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not resolve the staged configuration handle.");
        var resolved = finalPath.ToString();
        if (resolved.StartsWith(@"\\?\", StringComparison.Ordinal))
          resolved = resolved.Substring(4);
        if (!string.Equals(System.IO.Path.GetFullPath(resolved), expected, StringComparison.OrdinalIgnoreCase))
          throw new InvalidOperationException("The staged configuration handle resolved outside its exact path.");
        var disposition = new FileDispositionInfo { DeleteFile = true };
        if (!SetFileInformationByHandle(handle, FileDispositionInfoClass, ref disposition,
          (uint)Marshal.SizeOf(typeof(FileDispositionInfo))))
          throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not remove the exact staged configuration handle.");
      }
      if (System.IO.File.Exists(expected))
        throw new InvalidOperationException("The exact staged configuration still exists after removal.");
    }
  }
}
'@
    }

    [Itemba.Msaidizi.Installer.Release.NativeFileIdentity]::DeleteSingleLinkAtExactFinalPath($file)
}

function Get-RelativePathUnderRoot {
    param(
        [Parameter(Mandatory)][string]$Root,
        [Parameter(Mandatory)][string]$Path
    )

    $rootPath = [IO.Path]::GetFullPath($Root).TrimEnd([IO.Path]::DirectorySeparatorChar)
    $fullPath = [IO.Path]::GetFullPath($Path)
    $prefix = $rootPath + [IO.Path]::DirectorySeparatorChar
    if (-not $fullPath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Path is not below the required root. Root: $rootPath Path: $fullPath"
    }
    return $fullPath.Substring($prefix.Length).Replace('\', '/')
}

function Invoke-CheckedNative {
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [Parameter(Mandatory)][string[]]$ArgumentList,
        [Parameter(Mandatory)][string]$Description,
        [string]$OutputPath
    )

    $displayArguments = $ArgumentList | ForEach-Object {
        if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ }
    }
    Write-Host "[$Description] $FilePath $($displayArguments -join ' ')"

    $output = & $FilePath @ArgumentList 2>&1 | ForEach-Object { $_.ToString() }
    $exitCode = $LASTEXITCODE
    if ($OutputPath) {
        $output | Set-Content -LiteralPath $OutputPath -Encoding utf8
    }
    $output | Write-Host
    if ($exitCode -ne 0) {
        throw "$Description failed with exit code $exitCode."
    }

    return ,$output
}

function Normalize-Thumbprint {
    param([Parameter(Mandatory)][string]$Thumbprint)

    $normalized = ($Thumbprint -replace '\s', '').ToUpperInvariant()
    if ($normalized -notmatch '^[0-9A-F]{40}$') {
        throw 'Certificate thumbprints must be exactly 40 hexadecimal SHA-1 characters.'
    }
    return $normalized
}

function Assert-AuthenticatedToolHash {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$PolicySha256,
        [string]$ClaimedSha256,
        [Parameter(Mandatory)][string]$Description
    )

    $resolved = Resolve-ExistingLeafPath -Path $Path -Description $Description
    $pinned = ($PolicySha256 -replace '\s', '').ToUpperInvariant()
    if ($pinned -notmatch '^[0-9A-F]{64}$') {
        throw "$Description SHA-256 is not provisioned in authenticated release policy."
    }
    if ($PSBoundParameters.ContainsKey('ClaimedSha256')) {
        $claimed = ($ClaimedSha256 -replace '\s', '').ToUpperInvariant()
        if ($claimed -notmatch '^[0-9A-F]{64}$' -or $claimed -cne $pinned) {
            throw "Caller-controlled $Description hash substitution was refused by authenticated release policy."
        }
    }
    $actual = (Microsoft.PowerShell.Utility\Get-FileHash -LiteralPath $resolved -Algorithm SHA256).Hash.ToUpperInvariant()
    if ($actual -cne $pinned) {
        throw "$Description SHA-256 does not match authenticated release policy."
    }
    return $actual
}

function Get-ExactSigningCertificate {
    param([Parameter(Mandatory)][string]$Thumbprint)

    $normalized = Normalize-Thumbprint -Thumbprint $Thumbprint
    $matches = @(
        Get-ChildItem Cert:\CurrentUser\My, Cert:\LocalMachine\My -CodeSigningCert -ErrorAction SilentlyContinue |
            Where-Object { ($_.Thumbprint -replace '\s', '').ToUpperInvariant() -eq $normalized }
    )
    if ($matches.Count -ne 1) {
        throw "Expected exactly one code-signing certificate with thumbprint $normalized; found $($matches.Count)."
    }

    $certificate = $matches[0]
    if (-not $certificate.HasPrivateKey) {
        throw "Code-signing certificate $normalized has no accessible private key."
    }
    $now = [DateTimeOffset]::UtcNow
    if ($certificate.NotBefore.ToUniversalTime() -gt $now.UtcDateTime -or
        $certificate.NotAfter.ToUniversalTime() -le $now.UtcDateTime) {
        throw "Code-signing certificate $normalized is not currently valid."
    }
    if (-not ($certificate.EnhancedKeyUsageList.ObjectId.Value -contains '1.3.6.1.5.5.7.3.3')) {
        throw "Certificate $normalized is not valid for code signing."
    }

    $chain = [Security.Cryptography.X509Certificates.X509Chain]::new()
    try {
        $chain.ChainPolicy.RevocationMode = [Security.Cryptography.X509Certificates.X509RevocationMode]::Online
        $chain.ChainPolicy.RevocationFlag = [Security.Cryptography.X509Certificates.X509RevocationFlag]::EntireChain
        $chain.ChainPolicy.UrlRetrievalTimeout = [TimeSpan]::FromSeconds(30)
        if (-not $chain.Build($certificate)) {
            $details = ($chain.ChainStatus | ForEach-Object { "$($_.Status): $($_.StatusInformation.Trim())" }) -join '; '
            throw "Certificate chain validation failed for $normalized. $details"
        }
    }
    finally {
        $chain.Dispose()
    }

    return $certificate
}

function Assert-TrustedPipelineScript {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$ExpectedThumbprint
    )

    $resolved = Resolve-ExistingLeafPath -Path $Path -Description 'pipeline script'
    $expected = Normalize-Thumbprint -Thumbprint $ExpectedThumbprint
    $signature = Microsoft.PowerShell.Security\Get-AuthenticodeSignature -LiteralPath $resolved
    if ($signature.Status -ne [Management.Automation.SignatureStatus]::Valid -or -not $signature.SignerCertificate) {
        throw "Pipeline script is not Authenticode-valid: $resolved ($($signature.Status))."
    }
    if (-not $signature.TimeStamperCertificate) {
        throw "Pipeline script has no trusted Authenticode timestamp: $resolved"
    }
    if (($signature.SignerCertificate.Thumbprint -replace '\s', '').ToUpperInvariant() -ne $expected) {
        throw "Pipeline script signer does not match the expected organizational signer: $resolved"
    }
}

function Assert-MicrosoftSignedTool {
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$Description)

    $resolved = Resolve-ExistingLeafPath -Path $Path -Description $Description
    $signature = Microsoft.PowerShell.Security\Get-AuthenticodeSignature -LiteralPath $resolved
    if ($signature.Status -ne [Management.Automation.SignatureStatus]::Valid -or -not $signature.SignerCertificate) {
        throw "$Description is not Authenticode-valid: $resolved ($($signature.Status))."
    }
    if ($signature.SignerCertificate.Subject -notmatch '(?i)Microsoft') {
        throw "$Description is not signed by Microsoft: $resolved"
    }
    return $resolved
}

function Assert-HttpsTimestampUri {
    param([Parameter(Mandatory)][uri]$TimestampUri)

    if (-not $TimestampUri.IsAbsoluteUri -or $TimestampUri.Scheme -ne 'https') {
        throw 'The RFC 3161 timestamp URI must be an absolute HTTPS URI.'
    }
}

function Invoke-SignToolSign {
    param(
        [Parameter(Mandatory)][string]$SignToolPath,
        [Parameter(Mandatory)][string]$CertificateThumbprint,
        [Parameter(Mandatory)][uri]$TimestampUri,
        [Parameter(Mandatory)][string]$Path
    )

    $normalized = Normalize-Thumbprint -Thumbprint $CertificateThumbprint
    Invoke-CheckedNative -FilePath $SignToolPath -Description "Authenticode sign $([IO.Path]::GetFileName($Path))" -ArgumentList @(
        'sign', '/sha1', $normalized, '/fd', 'sha256', '/tr', $TimestampUri.AbsoluteUri,
        '/td', 'sha256', '/v', $Path
    ) | Out-Null
    Assert-AuthenticodeArtifact -SignToolPath $SignToolPath -Path $Path -ExpectedThumbprint $normalized -RequireTimestamp
}

function Assert-AuthenticodeArtifact {
    param(
        [Parameter(Mandatory)][string]$SignToolPath,
        [Parameter(Mandatory)][string]$Path,
        [string]$ExpectedThumbprint,
        [switch]$RequireTimestamp
    )

    $resolved = Resolve-ExistingLeafPath -Path $Path -Description 'signed artifact'
    $signature = Microsoft.PowerShell.Security\Get-AuthenticodeSignature -LiteralPath $resolved
    if ($signature.Status -ne [Management.Automation.SignatureStatus]::Valid -or -not $signature.SignerCertificate) {
        throw "Authenticode verification failed: $resolved ($($signature.Status))."
    }
    if ($ExpectedThumbprint) {
        $expected = Normalize-Thumbprint -Thumbprint $ExpectedThumbprint
        $actual = ($signature.SignerCertificate.Thumbprint -replace '\s', '').ToUpperInvariant()
        if ($actual -ne $expected) {
            throw "Unexpected Authenticode signer for $resolved."
        }
    }

    if ([IO.Path]::GetExtension($resolved).ToLowerInvariant() -in '.ps1', '.psm1', '.psd1') {
        if ($RequireTimestamp -and -not $signature.TimeStamperCertificate) {
            throw "No Authenticode timestamp was reported for PowerShell artifact $resolved."
        }
        return
    }

    $verification = Invoke-CheckedNative -FilePath $SignToolPath -Description "Authenticode verify $([IO.Path]::GetFileName($resolved))" -ArgumentList @(
        'verify', '/pa', '/all', '/v', $resolved
    )
    $verificationText = $verification -join "`n"
    if ($verificationText -notmatch '(?i)Successfully verified') {
        throw "SignTool did not report successful verification for $resolved."
    }
    if ($RequireTimestamp -and $verificationText -notmatch '(?i)timestamp') {
        throw "No RFC 3161 timestamp evidence was reported for $resolved."
    }
}

function Protect-UnsignedStagedArtifacts {
    param(
        [Parameter(Mandatory)][string]$Root,
        [Parameter(Mandatory)][string]$SignToolPath,
        [Parameter(Mandatory)][string]$CertificateThumbprint,
        [Parameter(Mandatory)][uri]$TimestampUri
    )

    $rootPath = Resolve-ExistingDirectoryPath -Path $Root -Description 'staged artifact root'
    $artifacts = @(Get-ChildItem -LiteralPath $rootPath -Recurse -File | Where-Object {
        $_.Extension -in '.exe', '.dll', '.sys', '.ps1', '.psm1', '.psd1'
    } | Sort-Object FullName)
    if ($artifacts.Count -eq 0) {
        throw "No signable staged artifacts were found below $rootPath."
    }

    $certificate = Get-ExactSigningCertificate -Thumbprint $CertificateThumbprint

    foreach ($artifact in $artifacts) {
        $signature = Microsoft.PowerShell.Security\Get-AuthenticodeSignature -LiteralPath $artifact.FullName
        if ($signature.Status -eq [Management.Automation.SignatureStatus]::NotSigned) {
            if ($artifact.Extension.ToLowerInvariant() -in '.ps1', '.psm1', '.psd1') {
                $signed = Microsoft.PowerShell.Security\Set-AuthenticodeSignature -LiteralPath $artifact.FullName -Certificate $certificate -HashAlgorithm SHA256 -TimestampServer $TimestampUri.AbsoluteUri -ErrorAction Stop
                if ($signed.Status -ne [Management.Automation.SignatureStatus]::Valid -or -not $signed.TimeStamperCertificate) {
                    throw "PowerShell Authenticode signing or RFC 3161 timestamping failed: $($artifact.FullName) ($($signed.Status))."
                }
                Assert-AuthenticodeArtifact -SignToolPath $SignToolPath -Path $artifact.FullName -ExpectedThumbprint $CertificateThumbprint -RequireTimestamp
            }
            else {
                Invoke-SignToolSign -SignToolPath $SignToolPath -CertificateThumbprint $CertificateThumbprint -TimestampUri $TimestampUri -Path $artifact.FullName
            }
            continue
        }
        if ($signature.Status -ne [Management.Automation.SignatureStatus]::Valid) {
            throw "Refusing an artifact with an invalid existing signature: $($artifact.FullName) ($($signature.Status))."
        }
        Assert-AuthenticodeArtifact -SignToolPath $SignToolPath -Path $artifact.FullName
    }
}

function New-DetachedCmsSignature {
    param(
        [Parameter(Mandatory)][string]$ContentPath,
        [Parameter(Mandatory)][Security.Cryptography.X509Certificates.X509Certificate2]$Certificate,
        [Parameter(Mandatory)][string]$SignaturePath
    )

    Add-Type -AssemblyName System.Security.Cryptography.Pkcs
    $content = [IO.File]::ReadAllBytes((Resolve-ExistingLeafPath -Path $ContentPath -Description 'CMS content'))
    $cms = [Security.Cryptography.Pkcs.SignedCms]::new([Security.Cryptography.Pkcs.ContentInfo]::new($content), $true)
    $signer = [Security.Cryptography.Pkcs.CmsSigner]::new($Certificate)
    $signer.IncludeOption = [Security.Cryptography.X509Certificates.X509IncludeOption]::EndCertOnly
    $cms.ComputeSignature($signer, $false)
    [IO.File]::WriteAllBytes($SignaturePath, $cms.Encode())
}

function Assert-DetachedCmsSignature {
    param(
        [Parameter(Mandatory)][string]$ContentPath,
        [Parameter(Mandatory)][string]$SignaturePath,
        [Parameter(Mandatory)][string]$ExpectedThumbprint
    )

    Add-Type -AssemblyName System.Security.Cryptography.Pkcs
    $content = [IO.File]::ReadAllBytes((Resolve-ExistingLeafPath -Path $ContentPath -Description 'CMS content'))
    $signature = [IO.File]::ReadAllBytes((Resolve-ExistingLeafPath -Path $SignaturePath -Description 'CMS signature'))
    $cms = [Security.Cryptography.Pkcs.SignedCms]::new([Security.Cryptography.Pkcs.ContentInfo]::new($content), $true)
    $cms.Decode($signature)
    $cms.CheckSignature($false)
    if ($cms.SignerInfos.Count -ne 1 -or -not $cms.SignerInfos[0].Certificate) {
        throw 'Detached CMS evidence must contain exactly one signer certificate.'
    }
    $expected = Normalize-Thumbprint -Thumbprint $ExpectedThumbprint
    $actual = ($cms.SignerInfos[0].Certificate.Thumbprint -replace '\s', '').ToUpperInvariant()
    if ($actual -ne $expected) {
        throw 'Detached CMS evidence was signed by an unexpected certificate.'
    }
    return $cms.SignerInfos[0].Certificate
}

function Get-RelativeFileHashInventory {
    param(
        [Parameter(Mandatory)][string]$Root,
        [string[]]$ExcludeRelativePaths = @()
    )

    $rootPath = Resolve-ExistingDirectoryPath -Path $Root -Description 'manifest root'
    $exclusions = @{}
    foreach ($exclude in $ExcludeRelativePaths) {
        $exclusions[$exclude.Replace('\', '/')] = $true
    }
    return @(
        Get-ChildItem -LiteralPath $rootPath -Recurse -File | ForEach-Object {
            $relative = Get-RelativePathUnderRoot -Root $rootPath -Path $_.FullName
            if (-not $exclusions.ContainsKey($relative)) {
                [ordered]@{
                    path = $relative
                    sha256 = (Microsoft.PowerShell.Utility\Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
                    size = $_.Length
                }
            }
        } | Sort-Object { $_.path }
    )
}

function Assert-ManifestInventory {
    param([Parameter(Mandatory)][string]$Root, [Parameter(Mandatory)]$Manifest)

    $rootPath = Resolve-ExistingDirectoryPath -Path $Root -Description 'candidate root'
    if (-not $Manifest.files -or @($Manifest.files).Count -eq 0) {
        throw 'Release manifest has no file inventory.'
    }
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($entry in @($Manifest.files)) {
        $relative = [string]$entry.path
        if ([string]::IsNullOrWhiteSpace($relative) -or [IO.Path]::IsPathRooted($relative) -or
            $relative.Contains('..') -or -not $seen.Add($relative)) {
            throw "Invalid or duplicate manifest path: $relative"
        }
        $path = [IO.Path]::GetFullPath((Join-Path $rootPath $relative))
        $expectedPrefix = $rootPath + [IO.Path]::DirectorySeparatorChar
        if (-not $path.StartsWith($expectedPrefix, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Manifest path escapes the candidate root: $relative"
        }
        $item = Get-Item -LiteralPath $path -Force -ErrorAction Stop
        if ($item.PSIsContainer -or $item.Length -ne [long]$entry.size) {
            throw "Manifest size mismatch: $relative"
        }
        $actual = (Microsoft.PowerShell.Utility\Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -ne ([string]$entry.sha256).ToLowerInvariant()) {
            throw "Manifest hash mismatch: $relative"
        }
    }
}

function Assert-DefenderReady {
    param(
        [Parameter(Mandatory)][string]$DefenderCommandPath,
        [Parameter(Mandatory)][int]$MaximumSignatureAgeHours
    )

    $resolved = Assert-MicrosoftSignedTool -Path $DefenderCommandPath -Description 'Microsoft Defender command-line scanner'
    if (-not (Get-Command Get-MpComputerStatus -ErrorAction SilentlyContinue)) {
        throw 'Get-MpComputerStatus is unavailable; Microsoft Defender cannot be attested.'
    }
    $status = Get-MpComputerStatus -ErrorAction Stop
    if (-not $status.AntivirusEnabled -or -not $status.AMServiceEnabled -or -not $status.RealTimeProtectionEnabled) {
        throw 'Microsoft Defender antivirus, service, and real-time protection must all be enabled.'
    }
    $signatureAge = [DateTimeOffset]::UtcNow - [DateTimeOffset]$status.AntivirusSignatureLastUpdated
    if ($signatureAge.TotalHours -gt $MaximumSignatureAgeHours) {
        throw "Microsoft Defender signatures are $([math]::Round($signatureAge.TotalHours, 1)) hours old."
    }
    return [pscustomobject]@{ CommandPath = $resolved; Status = $status }
}

Export-ModuleMember -Function @(
    'Assert-WindowsReleaseHost', 'Resolve-ExistingLeafPath', 'Resolve-ExistingDirectoryPath',
    'Assert-CanonicalLocalPathComponents', 'Assert-SafeNewDirectoryPath',
    'Assert-VerifiedDirectChildDirectory', 'Assert-VerifiedCandidateLayout',
    'Remove-VerifiedStagedConfiguration', 'Get-RelativePathUnderRoot', 'Invoke-CheckedNative', 'Normalize-Thumbprint',
    'Assert-AuthenticatedToolHash',
    'Get-ExactSigningCertificate', 'Assert-TrustedPipelineScript', 'Assert-MicrosoftSignedTool',
    'Assert-HttpsTimestampUri', 'Invoke-SignToolSign', 'Assert-AuthenticodeArtifact',
    'Protect-UnsignedStagedArtifacts', 'New-DetachedCmsSignature', 'Assert-DetachedCmsSignature',
    'Get-RelativeFileHashInventory', 'Assert-ManifestInventory', 'Assert-DefenderReady'
)
