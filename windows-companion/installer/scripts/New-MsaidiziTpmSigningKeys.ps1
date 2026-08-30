[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param(
    [ValidateSet(
        'EgressAttestation',
        'EgressReceipt',
        'AuditSigner',
        'UpdateSupervisorClient',
        'RecoverySupervisorClient',
        'IsolationReservationLease',
        'IsolationPreBindReservationRelease',
        'IsolationSuspendedProcessBindAcknowledgement',
        'IsolationTerminalEnforcementReceipt')]
    [string[]]$Purpose = @(
        'EgressAttestation',
        'EgressReceipt',
        'AuditSigner',
        'UpdateSupervisorClient',
        'RecoverySupervisorClient'),

    [switch]$IncludeIsolationPurposes,

    # Operator-chosen key identifiers. These reach the deployment evidence claim
    # verbatim, so they are validated against the evidence gate's own regex
    # rather than a looser local one.
    [string]$EgressAttestationKeyId = 'msaidizi-egress-attestation-v1',
    [string]$EgressReceiptKeyId = 'msaidizi-egress-receipt-v1',
    [string]$AuditSignerKeyId = 'msaidizi-audit-signer-v1',
    [string]$UpdateSupervisorClientKeyId = 'msaidizi-update-supervisor-client-v1',
    [string]$RecoverySupervisorClientKeyId = 'msaidizi-recovery-supervisor-client-v1',

    [ValidateRange(1, 3650)]
    [int]$CertificateValidityDays = 730,

    [string]$KeyContainerPrefix = 'Itemba.Msaidizi.Signing',

    [switch]$VerifyOnly,

    # Where the returned inventory is written. Required by -ApplyRestrictedKeyDacl,
    # which reads this file back rather than trusting anything in this process.
    # Written by -VerifyOnly too: the inventory is the precondition artifact for
    # the irreversible step, so it needs a regeneration path that does not
    # involve re-minting.
    [string]$InventoryPath,

    # An existing inventory is never replaced silently. A re-run that finds the
    # objects already present records no thumbprints, and overwriting the
    # captured record with that would destroy the only artifact the DACL step
    # will accept.
    [switch]$ForceInventoryOverwrite,

    [switch]$ApplyRestrictedKeyDacl,

    # The consent gate for the one-way DACL write. This is deliberately NOT
    # ShouldProcess: a runbook that suppresses prompts with -Confirm:$false must
    # not thereby authorize the irreversible step, and psexec -s cannot prompt at
    # all. Suppressing confirmation and acknowledging the write are two different
    # decisions and are spelled differently.
    [switch]$AcknowledgeIrreversibleKeyDaclWrite,

    # Where the -ApplyRestrictedKeyDacl run writes its own record. The captured
    # inventory is an input to that step and is never modified by it, so without
    # this the only account of which keys were irreversibly locked is console
    # scrollback.
    [string]$DaclReportPath,

    [string]$PrerequisiteScriptPath = (Join-Path $PSScriptRoot 'Test-ProductionPrerequisites.ps1')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# SECURITY BOUNDARY: this script mints the private signing material that every
# downstream Msaidizi trust decision is pinned to. It is deliberately NOT its own
# root of trust: it refuses to run unless the host already satisfies the
# hardware gate that Test-ProductionPrerequisites.ps1 owns, and it never invents
# a check that script already performs. The certificate template below mirrors
# DeviceIdentityProvisioner.CreateIdentity exactly; the key predicate mirrors
# EnsureKeyPolicy/IsNonExportable; the DACL mirrors the byte-for-byte descriptor
# that CertificateStoreEgressSupervisorSigningKeys.IsExactPrivateKeyDescriptor
# and CertificateStoreIsolationEvidenceSigner.IsExactPrivateKeyDescriptor demand.
# Any divergence here does not fail loudly at mint time - it fails months later
# as an unexplained service startup refusal, so the shapes are duplicated
# literally and commented with their source rather than paraphrased.

if ($PSVersionTable.PSEdition -cne 'Core' -or
    $PSVersionTable.PSVersion.Major -ne 7 -or
    $PSVersionTable.PSVersion.Minor -lt 4) {
    throw 'TPM signing-key provisioning requires PowerShell Core 7.4 or newer in the 7.x release line.'
}

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw 'TPM signing-key provisioning must run on the Windows ceremony host.'
}

# --- Compile-time pins read out of the consuming source, not from a summary ----
# src\Msaidizi.EgressSupervisor\EgressSupervisorTrustIdentity.cs:7-8
$egressSupervisorServiceName = 'Itemba Msaidizi Egress Supervisor'
$egressSupervisorServiceSid = 'S-1-5-80-2691216044-51290016-1044150087-1430489630-3303720160'
# src\Msaidizi.PrivilegedCommandSupervisor\Security\SupervisorServiceIdentity.cs:10-14
$privilegedSupervisorServiceName = 'Itemba Msaidizi Privileged Command Supervisor'
$privilegedSupervisorServiceSid = 'S-1-5-80-1792805186-3282615177-1795010573-3676175622-4117989893'
# ResolvePrivateP256 / ResolvePurposeKey both require this exact provider string.
$requiredProvider = 'Microsoft Platform Crypto Provider'
$clientAuthenticationOid = '1.3.6.1.5.5.7.3.2'
$localSystemSid = 'S-1-5-18'
# Test-ProductionPrerequisites.ps1:863,1041 - case-sensitive, and the first
# character may not be a separator (PrivilegedCommandSupervisorOptions.SafeKeyId).
$keyIdPattern = '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
# Identifiers this ceremony may never mint a private key under. The first two are
# the public verification pins (see the note below the purpose table); the rest
# are the four fixed isolation signing ids. A collision is not a style problem:
# CertificateStoreEgressSupervisorSigningKeys:58-78 throws 'Egress signing-key
# enrollment is invalid' when the attestation or receipt id equals the token
# verification id, and PrivilegedCommandSupervisorOptions.Validate:215-239 throws
# 'Action-token, driver-attestation, and evidence-signing keys must be
# purpose-distinct' on any intersection between the four signing ids and the two
# verification ids. Either way the key mints here and the service refuses to
# construct, which is exactly the failure this script exists to prevent.
$reservedKeyIds = @(
    'msaidizi-action-token-v1',
    'isolation-driver-attestation-v2',
    'reservation-lease-v1',
    'pre-bind-reservation-release-v1',
    'suspended-process-bind-acknowledgement-v1',
    'terminal-enforcement-receipt-v1')

$results = [Collections.Generic.List[object]]::new()
$narration = [Collections.Generic.List[string]]::new()

function Add-Narration {
    param([Parameter(Mandatory)][string]$Message)
    $narration.Add($Message)
    Write-Host $Message
}

function New-PurposeResult {
    param(
        [Parameter(Mandatory)][string]$PurposeName,
        [Parameter(Mandatory)][string]$KeyId,
        [Parameter(Mandatory)][string]$ContainerName,
        [Parameter(Mandatory)][bool]$Succeeded,
        [Parameter(Mandatory)][string]$ReasonCode,
        [Collections.IDictionary]$Detail = ([ordered]@{})
    )

    # The field names and their spelling are the companion verifier's contract,
    # not this script's preference: Test-MsaidiziTpmSigningKeys.ps1:1226-1233
    # reads purpose/state/store/keyId/owningService/certificateThumbprint/
    # subjectPublicKeyInfoBase64 out of every element of a 'purposes' array, and
    # :1256 requires owningService for a My-store entry. An inventory that spells
    # any of these differently is rejected wholesale at its :1474 exit 4, so the
    # generator emits the shape the verifier reads and carries its own
    # diagnostics (status, reasonCode, detail) alongside - the verifier ignores
    # keys it does not know.
    $owningService = 'NoConsumingDaclPredicate'
    if ($purposeTable.Contains($PurposeName)) {
        $serviceSid = $purposeTable[$PurposeName].DaclServiceSid
        if ($serviceSid -ceq $egressSupervisorServiceSid) { $owningService = 'EgressSupervisor' }
        elseif ($serviceSid -ceq $privilegedSupervisorServiceSid) { $owningService = 'PrivilegedCommandSupervisor' }
    }
    $entry = [pscustomobject][ordered]@{
        purpose = $PurposeName
        # state is finalised in one place, after every mode has run: an entry is
        # PROVISIONED only once a thumbprint was actually materialised.
        state = 'DEFERRED'
        deferredReason = $ReasonCode
        store = 'My'
        owningService = $owningService
        keyId = $KeyId
        containerName = $ContainerName
        status = if ($Succeeded) { 'OK' } else { 'BLOCKED' }
        reasonCode = $ReasonCode
        certificateThumbprint = $null
        subjectPublicKeyInfoBase64 = $null
        subjectPublicKeyInfoSha256 = $null
        detail = [pscustomobject]$Detail
    }
    $results.Add($entry)
    return $entry
}

function Get-DocumentValue {
    # Every read of an operator-authored JSON document goes through here. Under
    # Set-StrictMode -Version Latest, $document.missingProperty throws
    # PropertyNotFoundException, which would replace this script's carefully
    # worded refusals with a stack trace on any well-formed but wrong-shaped
    # file. Same reasoning, same shape, as Test-MsaidiziTpmSigningKeys.ps1:292.
    param(
        [Parameter(Mandatory)][AllowNull()]$Document,
        [Parameter(Mandatory)][string]$Name
    )

    if ($null -eq $Document) { return $null }
    if ($Document -is [Collections.IDictionary]) {
        if ($Document.Contains($Name)) { return $Document[$Name] }
        return $null
    }
    $property = $Document.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return $property.Value
}

function Test-CanonicalLocalFilePath {
    # The family's predicate, applied to the file that authorises the one-way
    # write: Test-ProductionPrerequisiteInventory.ps1:251-263 asserts that
    # relative, UNC, device (\\?\) and alternate-data-stream paths are refused
    # before anything touches them. [IO.Path]::IsPathFullyQualified accepts all
    # three of the latter (verified: '\\server\share\i.json',
    # '\\?\C:\x.json' and 'C:\temp\inv.json:hidden' are all fully qualified), so
    # it is not on its own a local-path test.
    param([Parameter(Mandatory)][AllowEmptyString()][string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path)) { return $false }
    if (-not [IO.Path]::IsPathFullyQualified($Path)) { return $false }
    if ($Path.Length -lt 3) { return $false }
    if (-not [char]::IsAsciiLetter($Path[0]) -or $Path[1] -ne ':') { return $false }
    if ($Path[2] -ne '\' -and $Path[2] -ne '/') { return $false }
    # A second colon is an alternate data stream, whatever follows it.
    if ($Path.IndexOf(':', 2) -ge 0) { return $false }
    return $true
}

function Test-Approved {
    # $PSCmdlet.ShouldProcess raises "PowerShell is in NonInteractive mode" when
    # ConfirmImpact='High' meets a host that cannot prompt (verified on this
    # host). With $ErrorActionPreference = 'Stop' that terminates the run from
    # inside a loop and no report is ever emitted. Failing closed is right;
    # failing closed with an unexplained stack trace and no record is not.
    param(
        [Parameter(Mandatory)][string]$Target,
        [Parameter(Mandatory)][string]$Action
    )

    try {
        return [pscustomobject]@{
            Approved = $PSCmdlet.ShouldProcess($Target, $Action)
            ReasonCode = 'skipped_no_change_made'
        }
    }
    catch {
        return [pscustomobject]@{
            Approved = $false
            ReasonCode = 'confirmation_prompt_unavailable_supply_confirm_false'
        }
    }
}

function Get-ContainerName {
    param(
        [Parameter(Mandatory)][string]$Prefix,
        [Parameter(Mandatory)][string]$KeyId
    )

    # Mirrors DeviceIdentityProvisioner.KeyName: a stable prefix plus the first
    # 32 lowercase hex characters of the SHA-256 of the logical identifier, so
    # the container name is deterministic and free of operator-supplied
    # punctuation that CNG would have to interpret.
    $digest = [Convert]::ToHexString(
        [Security.Cryptography.SHA256]::HashData(
            [Text.Encoding]::UTF8.GetBytes($KeyId))).ToLowerInvariant()
    return "$Prefix.$($digest.Substring(0, 32))"
}

function Test-NonExportablePolicy {
    param([Parameter(Mandatory)][Security.Cryptography.CngExportPolicies]$Policy)

    # DeviceIdentityProvisioner.IsNonExportable:536-540 - ALL FOUR bits clear.
    $exportable = [Security.Cryptography.CngExportPolicies]::AllowExport -bor
        [Security.Cryptography.CngExportPolicies]::AllowPlaintextExport -bor
        [Security.Cryptography.CngExportPolicies]::AllowArchiving -bor
        [Security.Cryptography.CngExportPolicies]::AllowPlaintextArchiving
    return ([int]$Policy -band [int]$exportable) -eq 0
}

function Test-KeyPolicy {
    param([Parameter(Mandatory)][Security.Cryptography.CngKey]$Key)

    # DeviceIdentityProvisioner.EnsureKeyPolicy:524-534, widened only by the
    # machine-scope and exact-algorithm requirements that the supervisors add in
    # ResolvePrivateP256 and ResolvePurposeKey.
    $provider = $null
    if ($null -ne $Key.Provider) { $provider = $Key.Provider.Provider }
    return $Key.AlgorithmGroup -eq [Security.Cryptography.CngAlgorithmGroup]::ECDsa -and
        $Key.Algorithm -eq [Security.Cryptography.CngAlgorithm]::ECDsaP256 -and
        $Key.KeySize -eq 256 -and
        $Key.IsMachineKey -and
        $provider -ceq $requiredProvider -and
        (Test-NonExportablePolicy -Policy $Key.ExportPolicy) -and
        ([int]$Key.KeyUsage -band [int][Security.Cryptography.CngKeyUsages]::Signing) -ne 0
}

function Test-ExactPrivateKeyDescriptor {
    param(
        [Parameter(Mandatory)][Security.AccessControl.RawSecurityDescriptor]$Descriptor,
        [Parameter(Mandatory)][string]$ServiceSid
    )

    # Byte-for-byte the predicate in
    # EgressSupervisorSigningKeys.IsExactPrivateKeyDescriptor:359-395 and
    # IsolationEvidenceSigner.IsExactPrivateKeyDescriptor:248-272.
    $genericAll = 0x10000000   # GENERIC_ALL, as the C# predicates spell it
    $expectedSid = [Security.Principal.SecurityIdentifier]::new($ServiceSid)
    $systemSid = [Security.Principal.SecurityIdentifier]::new($localSystemSid)
    if ($null -eq $Descriptor.Owner -or
        -not $Descriptor.Owner.Equals($systemSid) -or
        -not $Descriptor.ControlFlags.HasFlag(
            [Security.AccessControl.ControlFlags]::DiscretionaryAclProtected) -or
        $null -eq $Descriptor.DiscretionaryAcl -or
        $Descriptor.DiscretionaryAcl.Count -ne 1) {
        return $false
    }
    $ace = $Descriptor.DiscretionaryAcl[0]
    if ($ace -isnot [Security.AccessControl.CommonAce]) { return $false }
    return $ace.AceQualifier -eq [Security.AccessControl.AceQualifier]::AccessAllowed -and
        $ace.AceFlags -eq [Security.AccessControl.AceFlags]::None -and
        -not $ace.IsCallback -and
        $ace.AccessMask -eq $genericAll -and
        $null -ne $ace.SecurityIdentifier -and
        $ace.SecurityIdentifier.Equals($expectedSid)
}

function Get-KeyDaclState {
    param(
        [Parameter(Mandatory)][string]$ContainerName,
        [Parameter(Mandatory)][string]$ServiceSid
    )

    # Reads the "Security Descr" CNG property with OWNER_SECURITY_INFORMATION |
    # DACL_SECURITY_INFORMATION (0x5) - the same 0x5 this script writes with.
    #
    # DELIBERATE DIVERGENCE from the services, recorded rather than hidden.
    # EgressSupervisorSigningKeys.HasExactPrivateKeyAcl and the identical method
    # in IsolationEvidenceSigner read with 0x4 alone, and then require
    # descriptor.Owner to equal S-1-5-18. NCryptGetProperty returns only the
    # SECURITY_INFORMATION parts that were asked for, so a 0x4 read yields a
    # descriptor whose Owner is null and the owner clause can never be satisfied
    # - 'exact' would be unreachable here, the idempotent short-circuit below
    # would never fire, and every -VerifyOnly run would report
    # service_only_dacl_not_exact for a perfectly provisioned key. Mirroring that
    # bug would make this script useless; the same defect on the service side is
    # a separate finding against those two files.
    #
    # A key whose DACL has already been narrowed may refuse to open even for its
    # owner; that is reported as 'unreadable', never as a failure, because this
    # caller cannot distinguish it from a genuine mismatch.
    $key = $null
    try {
        $key = [Security.Cryptography.CngKey]::Open(
            $ContainerName,
            [Security.Cryptography.CngProvider]::MicrosoftPlatformCryptoProvider,
            [Security.Cryptography.CngKeyOpenOptions]::MachineKey)
        $property = $key.GetProperty('Security Descr', [Security.Cryptography.CngPropertyOptions]5)
        $value = $property.GetValue()
        if ($null -eq $value) {
            return [pscustomobject]@{ State = 'unreadable'; ReasonCode = 'cng_security_descriptor_absent' }
        }
        $descriptor = [Security.AccessControl.RawSecurityDescriptor]::new($value, 0)
        $exact = Test-ExactPrivateKeyDescriptor -Descriptor $descriptor -ServiceSid $ServiceSid
        return [pscustomobject]@{
            State = if ($exact) { 'exact' } else { 'mismatch' }
            ReasonCode = if ($exact) {
                'service_only_dacl_exact'
            }
            else {
                'service_only_dacl_not_exact'
            }
        }
    }
    catch [ArgumentException] {
        # RawSecurityDescriptor rejects a malformed binary descriptor with an
        # ArgumentException. Both services fold exactly this into "not exact"
        # (EgressSupervisorSigningKeys:352-356 and IsolationEvidenceSigner:241-245
        # catch CryptographicException or ArgumentException and return false), so
        # it is an answer here too - not a terminating error. This matters most
        # on the read-back after the one-way write, where dying would leave no
        # record at all for a key that has just been locked away.
        return [pscustomobject]@{ State = 'mismatch'; ReasonCode = 'cng_security_descriptor_malformed' }
    }
    catch [Security.Cryptography.CryptographicException] {
        return [pscustomobject]@{ State = 'unreadable'; ReasonCode = 'cng_key_not_readable_by_this_caller' }
    }
    catch [UnauthorizedAccessException] {
        return [pscustomobject]@{ State = 'unreadable'; ReasonCode = 'cng_key_not_readable_by_this_caller' }
    }
    finally {
        if ($null -ne $key) { $key.Dispose() }
    }
}

function Get-StoreCertificate {
    param([Parameter(Mandatory)][string]$Subject)

    # Discovery by subject uses validOnly:$false deliberately. This lookup has to
    # find the object even when it would not satisfy a chain check, so that the
    # separate consumer-resolution probe below can report that fact rather than
    # the ceremony silently reporting "not provisioned".
    $store = [Security.Cryptography.X509Certificates.X509Store]::new(
        [Security.Cryptography.X509Certificates.StoreName]::My,
        [Security.Cryptography.X509Certificates.StoreLocation]::LocalMachine)
    try {
        $store.Open(
            [Security.Cryptography.X509Certificates.OpenFlags]::OpenExistingOnly -bor
            [Security.Cryptography.X509Certificates.OpenFlags]::ReadOnly)
        $found = $store.Certificates.Find(
            [Security.Cryptography.X509Certificates.X509FindType]::FindBySubjectDistinguishedName,
            $Subject,
            $false)
        if ($found.Count -eq 0) { return $null }
        if ($found.Count -ne 1) {
            throw "LocalMachine\My holds $($found.Count) certificates for '$Subject'; the ceremony requires exactly one."
        }
        return [Security.Cryptography.X509Certificates.X509Certificate2]::new($found[0])
    }
    finally {
        $store.Close()
    }
}

function Test-ConsumerResolvable {
    param([Parameter(Mandatory)][string]$Thumbprint)

    # Exactly the resolution every consumer performs: LocalMachine\My, find by
    # thumbprint with validOnly:$true, require a count of one. A self-signed
    # ceremony certificate that is not chained to a trusted root fails this even
    # though the key is perfect, so it is reported rather than assumed.
    $store = [Security.Cryptography.X509Certificates.X509Store]::new(
        [Security.Cryptography.X509Certificates.StoreName]::My,
        [Security.Cryptography.X509Certificates.StoreLocation]::LocalMachine)
    try {
        $store.Open(
            [Security.Cryptography.X509Certificates.OpenFlags]::OpenExistingOnly -bor
            [Security.Cryptography.X509Certificates.OpenFlags]::ReadOnly)
        $found = $store.Certificates.Find(
            [Security.Cryptography.X509Certificates.X509FindType]::FindByThumbprint,
            $Thumbprint,
            $true)
        try {
            return $found.Count -eq 1
        }
        finally {
            foreach ($certificate in $found) { $certificate.Dispose() }
        }
    }
    catch {
        return $false
    }
    finally {
        $store.Close()
    }
}

function Get-PublicKeyMaterial {
    param([Parameter(Mandatory)][Security.Cryptography.X509Certificates.X509Certificate2]$Certificate)

    $publicKey = $Certificate.GetECDsaPublicKey()
    if ($null -eq $publicKey) {
        throw 'The provisioned certificate does not expose an ECDSA public key.'
    }
    try {
        if ($publicKey.KeySize -ne 256) {
            throw "The provisioned certificate exposes a $($publicKey.KeySize)-bit key; P-256 is required."
        }
        $spki = $publicKey.ExportSubjectPublicKeyInfo()
        return [pscustomobject]@{
            # Casing is load-bearing. The evidence gate matches thumbprints with
            # -cmatch '^[0-9A-F]{40}$' and SPKI digests with '^[0-9a-f]{64}$'.
            # A correct key with the wrong case reads as a crypto fault.
            Thumbprint = $Certificate.Thumbprint.ToUpperInvariant()
            SpkiBase64 = [Convert]::ToBase64String($spki)
            SpkiSha256 = [Convert]::ToHexString(
                [Security.Cryptography.SHA256]::HashData($spki)).ToLowerInvariant()
        }
    }
    finally {
        $publicKey.Dispose()
    }
}

function Set-EntryMaterial {
    param(
        [Parameter(Mandatory)]$Entry,
        [Parameter(Mandatory)][AllowNull()]$Material
    )

    if ($null -eq $Material) { return }
    $Entry.certificateThumbprint = $Material.Thumbprint
    $Entry.subjectPublicKeyInfoBase64 = $Material.SpkiBase64
    $Entry.subjectPublicKeyInfoSha256 = $Material.SpkiSha256
}

function Get-ContainerPublicKeyMaterial {
    param([Parameter(Mandatory)][string]$ContainerName)

    # The public half straight out of the CNG container, so the container this
    # step is about to lock can be tied to the certificate that authorised it.
    # Exporting a public key is not an export of key material and does not
    # depend on the export policy; it only needs the key to be openable, which
    # the write that follows needs anyway.
    $key = $null
    $signingKey = $null
    try {
        $key = [Security.Cryptography.CngKey]::Open(
            $ContainerName,
            [Security.Cryptography.CngProvider]::MicrosoftPlatformCryptoProvider,
            [Security.Cryptography.CngKeyOpenOptions]::MachineKey)
        $signingKey = [Security.Cryptography.ECDsaCng]::new($key)
        $key = $null   # ECDsaCng owns it from here.
        $spki = $signingKey.ExportSubjectPublicKeyInfo()
        return [pscustomobject]@{
            SpkiBase64 = [Convert]::ToBase64String($spki)
            SpkiSha256 = [Convert]::ToHexString(
                [Security.Cryptography.SHA256]::HashData($spki)).ToLowerInvariant()
        }
    }
    catch {
        return $null
    }
    finally {
        if ($null -ne $signingKey) { $signingKey.Dispose() }
        if ($null -ne $key) { $key.Dispose() }
    }
}

function Remove-ProvisionedKey {
    param([Parameter(Mandatory)][string]$ContainerName)

    # Rollback only. Mirrors DeviceIdentityProvisioner.DeleteKey:542-560 - a
    # container that cannot be removed is left for the decommission workflow
    # rather than masking the original provisioning error.
    #
    # The handler is deliberately unfiltered. This runs from inside Invoke-Mint's
    # own catch block, so anything that escapes here replaces the provisioning
    # error that caused the rollback, skips the result record, and unwinds the
    # whole script - leaving an orphaned TPM container that appears in no report.
    # CngKey::Open/Delete can raise UnauthorizedAccessException (the very type
    # Get-KeyDaclState anticipates for CNG opens) as readily as
    # CryptographicException. Returns $true when the container is known to be
    # gone, $false when it may still exist, so the caller can record the orphan.
    try {
        if ([Security.Cryptography.CngKey]::Exists(
                $ContainerName,
                [Security.Cryptography.CngProvider]::MicrosoftPlatformCryptoProvider,
                [Security.Cryptography.CngKeyOpenOptions]::MachineKey)) {
            $key = [Security.Cryptography.CngKey]::Open(
                $ContainerName,
                [Security.Cryptography.CngProvider]::MicrosoftPlatformCryptoProvider,
                [Security.Cryptography.CngKeyOpenOptions]::MachineKey)
            $key.Delete()
        }
        return $true
    }
    catch {
        Write-Warning "Rollback could not remove CNG container '$ContainerName'. Remove it before re-running the ceremony."
        return $false
    }
}

# --- Refuse to run: identity, elevation, and the host hardware gate -----------
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
$runningAsSystem = $null -ne $identity.User -and $identity.User.Value -ceq $localSystemSid
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'TPM signing-key provisioning requires an elevated session. Re-run from an elevated PowerShell 7 host.'
}

$requestedPurposes = @($Purpose | Select-Object -Unique)
$isolationPurposes = @(
    'IsolationReservationLease',
    'IsolationPreBindReservationRelease',
    'IsolationSuspendedProcessBindAcknowledgement',
    'IsolationTerminalEnforcementReceipt')
$requestedIsolation = @($requestedPurposes | Where-Object { $_ -in $isolationPurposes })
if ($IncludeIsolationPurposes -and $requestedIsolation.Count -eq 0) {
    $requestedPurposes = @($requestedPurposes + $isolationPurposes | Select-Object -Unique)
    $requestedIsolation = $isolationPurposes
}
if ($requestedIsolation.Count -gt 0 -and -not $IncludeIsolationPurposes) {
    throw ('The isolation signing purposes require the explicit -IncludeIsolationPurposes switch. ' +
        'They have nothing to bind to yet: docs\TRUSTED-ROOT.md:88-92 records that until the external ' +
        'supervisor and kernel driver exist and pass VM/ring acceptance, the rejecting isolation gate ' +
        'stays bound, so these keys would sit unused in LocalMachine\My with a service-only DACL.')
}
if ($requestedIsolation.Count -gt 0 -and $requestedIsolation.Count -ne $isolationPurposes.Count -and
    -not $VerifyOnly -and -not $ApplyRestrictedKeyDacl) {
    # CertificateStoreIsolationEvidenceSigner's constructor resolves all four
    # purposes unconditionally (IsolationEvidenceSigner.cs:51-89) and
    # PrivilegedCommandSupervisorOptions.Validate:198-214 requires four distinct
    # KeyIds, thumbprints and SPKIs. A partial isolation set is a state the
    # service rejects outright, so minting one is refused rather than recorded as
    # complete. It is not silently expanded either: this ceremony does not create
    # TPM material the operator did not name. Reading a partial set back is
    # harmless, so -VerifyOnly and the per-key DACL step are not restricted.
    throw ('Minting the isolation signing purposes is all-or-nothing. ' +
        (($isolationPurposes | Where-Object { $_ -notin $requestedIsolation }) -join ', ') +
        ' were not selected. CertificateStoreIsolationEvidenceSigner resolves all four purposes in its ' +
        'constructor, so a partial set cannot be loaded by the service that consumes it. ' +
        'Select all four, or none. Nothing was changed.')
}
if ($requestedIsolation.Count -gt 0) {
    Write-Warning ('Provisioning ' + $requestedIsolation.Count + ' isolation signing key(s) that nothing consumes today. ' +
        'The privileged-command isolation driver and external supervisor do not exist; ' +
        'WindowsKernelIsolationDriverClient installs UnavailableV3SignedDriverAttestationSource, ' +
        'which fails every attestation. These keys cannot be exercised until that acceptance lands, ' +
        'and their certificates expire on the schedule chosen here.')
}

if ($ApplyRestrictedKeyDacl -and $VerifyOnly) {
    throw '-ApplyRestrictedKeyDacl is a write. It cannot be combined with -VerifyOnly.'
}

# The prerequisite inventory is the host gate. This script calls it rather than
# reimplementing Get-Tpm / Confirm-SecureBootUEFI / DeviceGuard probing, because
# a second implementation of a hardware gate is a second thing to keep correct.
if (-not (Test-Path -LiteralPath $PrerequisiteScriptPath -PathType Leaf)) {
    throw ("The host gate Test-ProductionPrerequisites.ps1 is unavailable at '$PrerequisiteScriptPath'. " +
        'This script will not mint TPM-resident keys on an unverified host and does not carry its own ' +
        'copy of those checks. Restore the file or point -PrerequisiteScriptPath at it.')
}

$hostGate = $null
try {
    # Out-of-process by necessity, not by preference: the inventory emits its
    # report with [Console]::Out.WriteLine, which bypasses the PowerShell
    # success stream, so an in-process call would capture nothing. This is the
    # same invocation shape Test-ProductionPrerequisiteInventory.ps1 uses.
    #
    # Only the BuildHost scope is asked for, and only two of its checks are
    # consumed. The inventory's exit code is deliberately ignored: it reports
    # BLOCKED for release tooling a ceremony host is not required to carry.
    $pwshPath = (Get-Command pwsh.exe -ErrorAction Stop).Source
    $gateOutput = @(& $pwshPath -NoLogo -NoProfile -NonInteractive `
            -File $PrerequisiteScriptPath -Scope BuildHost 2>&1 |
        ForEach-Object { $_.ToString() })
    $gateJson = @($gateOutput | Where-Object {
        -not [string]::IsNullOrWhiteSpace($_) -and $_.StartsWith('{', [StringComparison]::Ordinal)
    }) | Select-Object -Last 1
    if ([string]::IsNullOrWhiteSpace($gateJson)) { throw 'no report' }
    $hostGate = $gateJson | Microsoft.PowerShell.Utility\ConvertFrom-Json -Depth 12
}
catch {
    throw ('The host gate did not produce a readable prerequisite inventory. ' +
        'TPM and platform state could not be established, so no key was created.')
}

# Read through Get-DocumentValue, not by property access. These lines are
# OUTSIDE the try/catch above, so under Set-StrictMode a gate report that parses
# as JSON but carries no 'checks' - or a check with no 'status' - would raise
# PropertyNotFoundException here and bypass the refusal wording below entirely.
$gateChecks = [ordered]@{}
foreach ($check in @(Get-DocumentValue -Document $hostGate -Name 'checks')) {
    $gateChecks[[string](Get-DocumentValue -Document $check -Name 'id')] = $check
}
foreach ($requiredCheck in @('host_windows_11_x64', 'host_tpm_2_ready')) {
    if (-not $gateChecks.Contains($requiredCheck)) {
        throw "The prerequisite inventory did not report '$requiredCheck'. The host gate cannot be evaluated."
    }
    if ([string](Get-DocumentValue -Document $gateChecks[$requiredCheck] -Name 'status') -cne 'PASS') {
        # This is the TPM-absent path. It must read as a decision, not a stack trace.
        throw ("Host gate '$requiredCheck' is BLOCKED (" +
            [string](Get-DocumentValue -Document $gateChecks[$requiredCheck] -Name 'reasonCode') +
            '). A TPM 2.0 that is present and ready on 64-bit Windows 11 is a precondition for ' +
            'non-exportable Platform Crypto Provider keys. No key, certificate, or ACL was changed.')
    }
}
Add-Narration ('Host gate satisfied: ' +
    [string](Get-DocumentValue -Document $gateChecks['host_windows_11_x64'] -Name 'reasonCode') + ', ' +
    [string](Get-DocumentValue -Document $gateChecks['host_tpm_2_ready'] -Name 'reasonCode') + '.')

# A TPM that Get-Tpm reports as ready can still lack a usable Platform Crypto
# Provider (a virtualised or policy-restricted host). Probing it here turns that
# into one clear sentence instead of a CryptographicException per purpose.
try {
    $providerProbe = @([Security.Cryptography.CngProvider]::MicrosoftPlatformCryptoProvider)
    if ($providerProbe[0].Provider -cne $requiredProvider) { throw 'unexpected provider name' }
    [void][Security.Cryptography.CngKey]::Exists(
        "$KeyContainerPrefix.probe",
        [Security.Cryptography.CngProvider]::MicrosoftPlatformCryptoProvider,
        [Security.Cryptography.CngKeyOpenOptions]::MachineKey)
}
catch {
    throw ("The '$requiredProvider' key storage provider is not usable in this session. " +
        'The consuming services accept no other provider, so provisioning was refused before any change.')
}

# --- Purpose table -----------------------------------------------------------
# DaclServiceSid is populated ONLY where a consuming service actually asserts the
# exact single-ACE descriptor. The audit-signer, update-supervisor and
# recovery-supervisor client keys have no source-pinned service SID and no
# consuming DACL predicate (HardwareBackedCertificateSigner and the two
# CreateMutualTlsHandler paths check provider, key size, export policy and
# validity only), so this script will not narrow their DACLs. Doing so on a
# guess would lock a service out of its own key with no undo.
$purposeTable = [ordered]@{
    EgressAttestation = [pscustomobject]@{
        KeyId = $EgressAttestationKeyId
        KeyIdIsFixed = $false
        Subject = 'CN=Itemba Msaidizi Egress Attestation'
        Consumer = 'CertificateStoreEgressSupervisorSigningKeys.AttestationKeyId'
        DaclServiceSid = $egressSupervisorServiceSid
        DaclServiceName = $egressSupervisorServiceName
    }
    EgressReceipt = [pscustomobject]@{
        KeyId = $EgressReceiptKeyId
        KeyIdIsFixed = $false
        Subject = 'CN=Itemba Msaidizi Egress Receipt'
        Consumer = 'CertificateStoreEgressSupervisorSigningKeys.ReceiptKeyId'
        DaclServiceSid = $egressSupervisorServiceSid
        DaclServiceName = $egressSupervisorServiceName
    }
    AuditSigner = [pscustomobject]@{
        KeyId = $AuditSignerKeyId
        KeyIdIsFixed = $false
        Subject = 'CN=Itemba Msaidizi Audit Signer'
        Consumer = 'HardwareBackedCertificateSigner.LoadFromLocalMachine'
        DaclServiceSid = $null
        DaclServiceName = 'Itemba Msaidizi Audit Signer'
    }
    UpdateSupervisorClient = [pscustomobject]@{
        KeyId = $UpdateSupervisorClientKeyId
        KeyIdIsFixed = $false
        Subject = 'CN=Itemba Msaidizi Update Supervisor Client'
        Consumer = 'Msaidizi.UpdateSupervisor CreateMutualTlsHandler'
        DaclServiceSid = $null
        DaclServiceName = 'Itemba Msaidizi Update Supervisor'
    }
    RecoverySupervisorClient = [pscustomobject]@{
        KeyId = $RecoverySupervisorClientKeyId
        KeyIdIsFixed = $false
        Subject = 'CN=Itemba Msaidizi Recovery Supervisor Client'
        Consumer = 'Msaidizi.RecoverySupervisor CreateMutualTlsHandler'
        DaclServiceSid = $null
        DaclServiceName = 'Itemba Msaidizi Recovery Supervisor'
    }
    # The four isolation KeyIds are asserted by string equality in
    # Test-ProductionPrerequisites.ps1:1100-1103. They are not operator-chosen.
    IsolationReservationLease = [pscustomobject]@{
        KeyId = 'reservation-lease-v1'
        KeyIdIsFixed = $true
        Subject = 'CN=Itemba Msaidizi Isolation Reservation Lease'
        Consumer = 'CertificateStoreIsolationEvidenceSigner.ReservationLeaseSigningKey'
        DaclServiceSid = $privilegedSupervisorServiceSid
        DaclServiceName = $privilegedSupervisorServiceName
    }
    IsolationPreBindReservationRelease = [pscustomobject]@{
        KeyId = 'pre-bind-reservation-release-v1'
        KeyIdIsFixed = $true
        Subject = 'CN=Itemba Msaidizi Isolation Pre-Bind Reservation Release'
        Consumer = 'CertificateStoreIsolationEvidenceSigner.PreBindReservationReleaseSigningKey'
        DaclServiceSid = $privilegedSupervisorServiceSid
        DaclServiceName = $privilegedSupervisorServiceName
    }
    IsolationSuspendedProcessBindAcknowledgement = [pscustomobject]@{
        KeyId = 'suspended-process-bind-acknowledgement-v1'
        KeyIdIsFixed = $true
        Subject = 'CN=Itemba Msaidizi Isolation Bind Acknowledgement'
        Consumer = 'CertificateStoreIsolationEvidenceSigner.SuspendedProcessBindAcknowledgementSigningKey'
        DaclServiceSid = $privilegedSupervisorServiceSid
        DaclServiceName = $privilegedSupervisorServiceName
    }
    IsolationTerminalEnforcementReceipt = [pscustomobject]@{
        KeyId = 'terminal-enforcement-receipt-v1'
        KeyIdIsFixed = $true
        Subject = 'CN=Itemba Msaidizi Isolation Terminal Enforcement Receipt'
        Consumer = 'CertificateStoreIsolationEvidenceSigner.TerminalEnforcementReceiptSigningKey'
        DaclServiceSid = $privilegedSupervisorServiceSid
        DaclServiceName = $privilegedSupervisorServiceName
    }
}

# The two verification KeyIds the evidence gate also asserts
# ('msaidizi-action-token-v1', 'isolation-driver-attestation-v2') are absent by
# design. PinnedActionTokenVerificationKeyResolver and
# PinnedDriverAttestationVerificationKeyResolver require a LocalMachine\
# TrustedPeople certificate with HasPrivateKey == false. Minting a private key
# for them here would produce material this host must never hold.

$selected = [Collections.Generic.List[object]]::new()
foreach ($name in $requestedPurposes) {
    $definition = $purposeTable[$name]
    $keyId = [string]$definition.KeyId
    if ($keyId -cnotmatch $keyIdPattern) {
        throw ("KeyId '$keyId' for purpose '$name' does not satisfy the evidence gate's identifier " +
            "pattern $keyIdPattern. The gate compares case-sensitively, so a key minted under a " +
            'rejected identifier would pass here and fail acceptance.')
    }
    # The reserved set is checked only for operator-supplied identifiers: the
    # four isolation purposes legitimately carry the fixed ids that are reserved
    # against everyone else. Within-run duplicate detection below cannot catch
    # this - it only compares the purposes named in THIS invocation, so
    # '-EgressAttestationKeyId reservation-lease-v1' passes it, mints, and then
    # detonates in PrivilegedCommandSupervisorOptions.Validate. The two
    # verification ids are reserved for every purpose without exception; see the
    # note above - this host must never hold a private key for them.
    if (-not $definition.KeyIdIsFixed -and $keyId -cin $reservedKeyIds) {
        throw ("KeyId '$keyId' for purpose '$name' is reserved. It belongs to a pinned verification key " +
            'or to a fixed isolation signing purpose, and the consuming services require every signing ' +
            'and verification identifier to be purpose-distinct: ' +
            'CertificateStoreEgressSupervisorSigningKeys refuses to construct when the attestation or ' +
            'receipt id equals the token verification id, and PrivilegedCommandSupervisorOptions.Validate ' +
            'refuses on any intersection with the four isolation ids. Choose a distinct identifier. ' +
            'Nothing was changed.')
    }
    $selected.Add([pscustomobject]@{
        Name = $name
        KeyId = $keyId
        Subject = [string]$definition.Subject
        Consumer = [string]$definition.Consumer
        DaclServiceSid = $definition.DaclServiceSid
        DaclServiceName = [string]$definition.DaclServiceName
        ContainerName = Get-ContainerName -Prefix $KeyContainerPrefix -KeyId $keyId
    })
}
if ($selected.Count -eq 0) {
    throw 'No purpose was selected. Nothing to provision or verify.'
}
$duplicateKeyIds = @($selected | Group-Object -Property KeyId | Where-Object { $_.Count -gt 1 })
if ($duplicateKeyIds.Count -ne 0) {
    throw ('Purposes must not share a KeyId: ' + (($duplicateKeyIds | ForEach-Object { $_.Name }) -join ', ') +
        '. Purpose separation is asserted by the supervisors and by the evidence gate.')
}

# --- Verification of the current state ---------------------------------------
function Get-PurposeState {
    param([Parameter(Mandatory)]$Selection)

    $keyExists = $false
    try {
        $keyExists = [Security.Cryptography.CngKey]::Exists(
            $Selection.ContainerName,
            [Security.Cryptography.CngProvider]::MicrosoftPlatformCryptoProvider,
            [Security.Cryptography.CngKeyOpenOptions]::MachineKey)
    }
    catch [Security.Cryptography.CryptographicException] {
        $keyExists = $false
    }
    $certificate = Get-StoreCertificate -Subject $Selection.Subject
    return [pscustomobject]@{
        KeyExists = $keyExists
        Certificate = $certificate
    }
}

function Add-VerifiedResult {
    param(
        [Parameter(Mandatory)]$Selection,
        [Parameter(Mandatory)]$State
    )

    $detail = [ordered]@{
        provider = $requiredProvider
        subject = $Selection.Subject
        consumer = $Selection.Consumer
        keyPresent = $State.KeyExists
        certificatePresent = $null -ne $State.Certificate
        daclRequiredByConsumer = $null -ne $Selection.DaclServiceSid
        daclOwningService = $Selection.DaclServiceName
        daclState = 'not_evaluated'
    }
    if (-not $State.KeyExists -and $null -eq $State.Certificate) {
        New-PurposeResult -PurposeName $Selection.Name -KeyId $Selection.KeyId `
            -ContainerName $Selection.ContainerName -Succeeded $false `
            -ReasonCode 'not_provisioned' -Detail $detail | Out-Null
        return
    }
    if (-not $State.KeyExists -or $null -eq $State.Certificate) {
        New-PurposeResult -PurposeName $Selection.Name -KeyId $Selection.KeyId `
            -ContainerName $Selection.ContainerName -Succeeded $false `
            -ReasonCode 'partially_provisioned_key_and_certificate_disagree' -Detail $detail | Out-Null
        return
    }

    # HasPrivateKey is the first thing every consumer asserts -
    # HardwareBackedCertificateSigner.LoadFromLocalMachine:47-49,
    # EgressSupervisorSigningKeys:303, IsolationEvidenceSigner:183, and both
    # CreateMutualTlsHandler paths. A container that still exists while the
    # certificate's key association has been broken satisfies every other check
    # here, so without this the entry is stamped 'provisioned' for an object no
    # service can load.
    if (-not $State.Certificate.HasPrivateKey) {
        $detail['keyPolicy'] = 'certificate_has_no_bound_private_key'
        try {
            New-PurposeResult -PurposeName $Selection.Name -KeyId $Selection.KeyId `
                -ContainerName $Selection.ContainerName -Succeeded $false `
                -ReasonCode 'certificate_has_no_bound_private_key' -Detail $detail | Out-Null
        }
        finally {
            $State.Certificate.Dispose()
        }
        return
    }

    try {
        $material = Get-PublicKeyMaterial -Certificate $State.Certificate
        $privateKey = $null
        $policyOk = $false
        $policyReason = 'certificate_private_key_not_cng'
        try {
            # Inside the try, not above it. Once the service-only DACL is in
            # place this call is what throws - the key handle can no longer be
            # acquired by this caller - and the handler below is the one that is
            # documented to absorb it. Above the try it escapes an outer try that
            # has only a finally, and with $ErrorActionPreference = 'Stop' it
            # kills the -VerifyOnly run this script tells the operator to make
            # after the DACL step.
            $privateKey = $State.Certificate.GetECDsaPrivateKey()
            if ($privateKey -is [Security.Cryptography.ECDsaCng]) {
                $policyOk = Test-KeyPolicy -Key $privateKey.Key
                $policyReason = if ($policyOk) { 'key_policy_satisfied' } else { 'key_policy_violated' }
            }
        }
        catch [Security.Cryptography.CryptographicException] {
            # Expected once the service-only DACL is in place: the key material
            # is no longer reachable from this caller.
            $policyReason = 'key_policy_unverifiable_private_key_not_accessible'
        }
        finally {
            if ($null -ne $privateKey) { $privateKey.Dispose() }
        }
        $detail['keyPolicy'] = $policyReason
        $daclState = $null
        if ($null -ne $Selection.DaclServiceSid) {
            $daclState = Get-KeyDaclState -ContainerName $Selection.ContainerName `
                -ServiceSid $Selection.DaclServiceSid
            $detail['daclState'] = $daclState.State
            $detail['daclReasonCode'] = $daclState.ReasonCode
        }
        $resolvable = Test-ConsumerResolvable -Thumbprint $material.Thumbprint
        $detail['consumerResolvableValidOnly'] = $resolvable
        if (-not $resolvable) {
            $detail['remediation'] = ('Every consumer resolves its certificate with ' +
                'Find(FindByThumbprint, ..., validOnly: true) and requires exactly one match, which ' +
                'applies a chain check. A self-signed ceremony certificate satisfies that only once its ' +
                'issuer is trusted on this host. Establish that trust, or issue these certificates from ' +
                'the deployment CA, before the services are started.')
        }

        # Every predicate the services enforce has to reach the verdict, not just
        # the detail bag. ResolvePrivateP256 and ResolvePurposeKey throw on a key
        # policy violation and on an inexact DACL, so an entry that fails either
        # one is a key the owning service will refuse - reporting it as OK, and
        # exiting 0, would put the ceremony record and reality in disagreement.
        #
        # The two are gated differently on purpose:
        #  - key policy is enforced in every mode. A freshly minted key already
        #    satisfies it (Invoke-Mint asserts the same predicate at creation),
        #    so this cannot fire spuriously on the provisioning run.
        #    'unverifiable' is NOT a violation: it is the expected answer once
        #    the DACL has been narrowed away from this caller.
        #  - the DACL is enforced only in VERIFY_ONLY. Between the mint run and
        #    the DACL run the descriptor is legitimately not yet narrowed, and
        #    blocking there would suppress the next-step narration and report the
        #    ceremony's own intended intermediate state as a failure. A
        #    verification run is a claim about the finished state, so there
        #    'mismatch' - the one outcome this script calls "the operator must
        #    act now" - is blocking. 'unreadable' stays non-blocking: it proves
        #    nothing either way, as the read-back narration says.
        $policyBlocking = $policyReason -ceq 'key_policy_violated' -or
            $policyReason -ceq 'certificate_private_key_not_cng'
        $daclBlocking = $mode -ceq 'VERIFY_ONLY' -and
            $null -ne $daclState -and $daclState.State -ceq 'mismatch'
        $succeeded = $resolvable -and -not $policyBlocking -and -not $daclBlocking
        $reasonCode = if ($policyBlocking) {
            'provisioned_but_key_policy_violated'
        }
        elseif ($daclBlocking) {
            'provisioned_but_service_only_dacl_not_exact'
        }
        elseif (-not $resolvable) {
            'provisioned_but_not_resolvable_by_consumer_validonly_lookup'
        }
        else {
            'provisioned'
        }
        $entry = New-PurposeResult -PurposeName $Selection.Name -KeyId $Selection.KeyId `
            -ContainerName $Selection.ContainerName -Succeeded $succeeded `
            -ReasonCode $reasonCode -Detail $detail
        $entry.certificateThumbprint = $material.Thumbprint
        $entry.subjectPublicKeyInfoBase64 = $material.SpkiBase64
        $entry.subjectPublicKeyInfoSha256 = $material.SpkiSha256
    }
    finally {
        $State.Certificate.Dispose()
    }
}

# --- Minting -----------------------------------------------------------------
function Invoke-Mint {
    param([Parameter(Mandatory)]$Selection)

    $detail = [ordered]@{
        provider = $requiredProvider
        subject = $Selection.Subject
        consumer = $Selection.Consumer
        certificateValidityDays = $CertificateValidityDays
        daclRequiredByConsumer = $null -ne $Selection.DaclServiceSid
        daclOwningService = $Selection.DaclServiceName
        daclState = 'not_applied'
    }
    $state = Get-PurposeState -Selection $Selection
    if ($null -ne $state.Certificate -or $state.KeyExists) {
        if ($null -ne $state.Certificate) { $state.Certificate.Dispose() }
        # Never silently reuse or replace TPM-resident material. Re-minting
        # changes the thumbprint and SPKI digest, which invalidates every
        # downstream pin, so the operator makes that call, not this script.
        $detail['remediation'] = ("Delete the existing objects deliberately before re-running: " +
            "the CNG container '$($Selection.ContainerName)' in the $requiredProvider (machine scope) " +
            "and any LocalMachine\My certificate with subject '$($Selection.Subject)'. " +
            'Re-minting produces a new thumbprint and SPKI digest and invalidates every downstream pin.')
        New-PurposeResult -PurposeName $Selection.Name -KeyId $Selection.KeyId `
            -ContainerName $Selection.ContainerName -Succeeded $false `
            -ReasonCode 'already_present_refusing_to_overwrite' -Detail $detail | Out-Null
        return
    }

    $target = ("CNG container '$($Selection.ContainerName)' in the $requiredProvider (machine scope) " +
        "and a new LocalMachine\My certificate '$($Selection.Subject)'")
    $action = ("Create a non-exportable P-256 TPM signing key and bind a self-signed " +
        "client-authentication certificate valid for $CertificateValidityDays days " +
        "(purpose '$($Selection.Name)', KeyId '$($Selection.KeyId)')")
    $approval = Test-Approved -Target $target -Action $action
    if (-not $approval.Approved) {
        New-PurposeResult -PurposeName $Selection.Name -KeyId $Selection.KeyId `
            -ContainerName $Selection.ContainerName -Succeeded $false `
            -ReasonCode $approval.ReasonCode -Detail $detail | Out-Null
        return
    }

    # Key creation and certificate binding are one gate on purpose. A key
    # without its certificate is unusable and indistinguishable from a partly
    # failed ceremony, so the certificate step rolls the key back on failure.
    $key = $null
    $signingKey = $null
    $certificate = $null
    $keyCreated = $false
    try {
        $creation = [Security.Cryptography.CngKeyCreationParameters]::new()
        $creation.ExportPolicy = [Security.Cryptography.CngExportPolicies]::None
        $creation.KeyCreationOptions = [Security.Cryptography.CngKeyCreationOptions]::MachineKey
        $creation.KeyUsage = [Security.Cryptography.CngKeyUsages]::Signing
        $creation.Provider = [Security.Cryptography.CngProvider]::MicrosoftPlatformCryptoProvider
        $key = [Security.Cryptography.CngKey]::Create(
            [Security.Cryptography.CngAlgorithm]::ECDsaP256,
            $Selection.ContainerName,
            $creation)
        $keyCreated = $true
        if (-not (Test-KeyPolicy -Key $key)) {
            throw 'The newly created CNG key does not satisfy the key policy the services enforce.'
        }

        $signingKey = [Security.Cryptography.ECDsaCng]::new($key)
        $key = $null   # ECDsaCng owns it, exactly as CreateIdentity does.
        $request = [Security.Cryptography.X509Certificates.CertificateRequest]::new(
            $Selection.Subject,
            $signingKey,
            [Security.Cryptography.HashAlgorithmName]::SHA256)
        # DeviceIdentityProvisioner.CreateIdentity:176-191, extension for extension.
        $request.CertificateExtensions.Add(
            [Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new(
                $false, $false, 0, $true))
        $request.CertificateExtensions.Add(
            [Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new(
                [Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature,
                $true))
        $enhancedKeyUsages = [Security.Cryptography.OidCollection]::new()
        [void]$enhancedKeyUsages.Add(
            [Security.Cryptography.Oid]::new($clientAuthenticationOid, 'Client Authentication'))
        $request.CertificateExtensions.Add(
            [Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new(
                $enhancedKeyUsages, $true))
        $subjectAlternativeName =
            [Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
        $subjectAlternativeName.AddUri(
            [uri]::new("urn:itemba:msaidizi:signing-purpose:$([uri]::EscapeDataString($Selection.KeyId))",
                [UriKind]::Absolute))
        $request.CertificateExtensions.Add($subjectAlternativeName.Build($false))

        $now = [DateTimeOffset]::UtcNow
        $certificate = $request.CreateSelfSigned(
            $now.AddMinutes(-5),
            $now.AddDays($CertificateValidityDays))

        $store = [Security.Cryptography.X509Certificates.X509Store]::new(
            [Security.Cryptography.X509Certificates.StoreName]::My,
            [Security.Cryptography.X509Certificates.StoreLocation]::LocalMachine)
        try {
            $store.Open([Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
            $store.Add($certificate)
        }
        finally {
            $store.Close()
        }
        $keyCreated = $false
    }
    catch {
        if ($keyCreated) {
            # An orphan reaches the report, not only the warning stream. It is
            # the operator's decommission list, and it is also what feeds the
            # wrong-container hazard the DACL step guards against.
            $detail['rollbackRemovedContainer'] =
                [bool](Remove-ProvisionedKey -ContainerName $Selection.ContainerName)
            if (-not $detail['rollbackRemovedContainer']) {
                $detail['orphanedContainer'] = $Selection.ContainerName
            }
        }
        # The type, not the message. Provider text and container or path
        # fragments end up in the emitted JSON and in the inventory file on disk;
        # the reason code above already says what failed.
        $detail['errorType'] = $_.Exception.GetType().FullName
        New-PurposeResult -PurposeName $Selection.Name -KeyId $Selection.KeyId `
            -ContainerName $Selection.ContainerName -Succeeded $false `
            -ReasonCode 'provisioning_failed_rolled_back' -Detail $detail | Out-Null
        return
    }
    finally {
        if ($null -ne $certificate) { $certificate.Dispose() }
        if ($null -ne $signingKey) { $signingKey.Dispose() }
        if ($null -ne $key) { $key.Dispose() }
    }

    # Read the object back through the same resolution path the services use, so
    # what is emitted is what a consumer would find rather than what was built.
    $verified = Get-PurposeState -Selection $Selection
    Add-VerifiedResult -Selection $Selection -State $verified
}

# --- The one-way DACL step ---------------------------------------------------
function Invoke-RestrictedDacl {
    param(
        [Parameter(Mandatory)]$Selection,
        [Parameter(Mandatory)]$RecordedEntry
    )

    $detail = [ordered]@{
        provider = $requiredProvider
        subject = $Selection.Subject
        consumer = $Selection.Consumer
        daclOwningService = $Selection.DaclServiceName
        daclOwningServiceSid = $Selection.DaclServiceSid
        sddl = "O:SYD:P(A;;GA;;;$($Selection.DaclServiceSid))"
        daclState = 'not_applied'
    }
    # The container is the thing that gets locked, so the container is what has
    # to match the record - and it is the half the previous identity check never
    # looked at. The certificate is found by Subject, a fixed per-purpose
    # constant that does not depend on the KeyId at all, while ContainerName is
    # derived from THIS invocation's KeyId and -KeyContainerPrefix. A DACL run
    # that omits -EgressAttestationKeyId after the keys were minted under a
    # different id therefore satisfies the thumbprint check against the live
    # certificate while pointing the irreversible write at a different
    # container - an orphan left behind by a failed rollback, for instance. That
    # locks the wrong key, leaves the live one open, and reports success.
    $recordedContainer = [string]$RecordedEntry.ContainerName
    $recordedKeyId = [string]$RecordedEntry.KeyId
    if ($Selection.ContainerName -cne $recordedContainer -or $Selection.KeyId -cne $recordedKeyId) {
        $detail['recordedContainerName'] = $recordedContainer
        $detail['recordedKeyId'] = $recordedKeyId
        $detail['remediation'] = ('Re-run this step with the same -KeyContainerPrefix and the same ' +
            'KeyId parameters that produced the captured inventory. Nothing was changed.')
        New-PurposeResult -PurposeName $Selection.Name -KeyId $Selection.KeyId `
            -ContainerName $Selection.ContainerName -Succeeded $false `
            -ReasonCode 'dacl_refused_container_differs_from_captured_inventory' -Detail $detail | Out-Null
        return
    }

    $material = $null
    $state = Get-PurposeState -Selection $Selection
    try {
        if (-not $state.KeyExists -or $null -eq $state.Certificate) {
            New-PurposeResult -PurposeName $Selection.Name -KeyId $Selection.KeyId `
                -ContainerName $Selection.ContainerName -Succeeded $false `
                -ReasonCode 'dacl_refused_object_missing' -Detail $detail | Out-Null
            return
        }
        if (-not $state.Certificate.HasPrivateKey) {
            $entry = New-PurposeResult -PurposeName $Selection.Name -KeyId $Selection.KeyId `
                -ContainerName $Selection.ContainerName -Succeeded $false `
                -ReasonCode 'certificate_has_no_bound_private_key' -Detail $detail
            Set-EntryMaterial -Entry $entry -Material $material
            return
        }
        $material = Get-PublicKeyMaterial -Certificate $state.Certificate
        # The captured inventory is the operator's record of what these keys
        # are. If the live object no longer matches it, the record is stale and
        # narrowing the DACL would lock down something the operator has not seen.
        if ($material.Thumbprint -cne [string]$RecordedEntry.Thumbprint -or
            $material.SpkiSha256 -cne [string]$RecordedEntry.SpkiSha256) {
            $detail['recordedThumbprint'] = [string]$RecordedEntry.Thumbprint
            $detail['liveThumbprint'] = $material.Thumbprint
            $entry = New-PurposeResult -PurposeName $Selection.Name -KeyId $Selection.KeyId `
                -ContainerName $Selection.ContainerName -Succeeded $false `
                -ReasonCode 'dacl_refused_live_object_differs_from_captured_inventory' -Detail $detail
            Set-EntryMaterial -Entry $entry -Material $material
            return
        }
    }
    finally {
        if ($null -ne $state.Certificate) { $state.Certificate.Dispose() }
    }

    # Idempotency first, and before the container is opened: once the descriptor
    # is in place this caller may no longer be able to open the key at all, and a
    # re-run of the step must still recognise its own finished work.
    $existing = Get-KeyDaclState -ContainerName $Selection.ContainerName `
        -ServiceSid $Selection.DaclServiceSid
    if ($existing.State -ceq 'exact') {
        $detail['daclState'] = 'exact'
        $entry = New-PurposeResult -PurposeName $Selection.Name -KeyId $Selection.KeyId `
            -ContainerName $Selection.ContainerName -Succeeded $true `
            -ReasonCode 'dacl_already_exact_no_change_made' -Detail $detail
        Set-EntryMaterial -Entry $entry -Material $material
        return
    }

    # Name equality is a claim about this host's naming scheme; the public key is
    # proof. Opening the container and comparing its exported SPKI to the
    # certificate's is the only check that survives an operator passing a
    # -KeyContainerPrefix the inventory was not minted under, because both the
    # container name and the recorded name would then be wrong in the same way.
    $containerMaterial = Get-ContainerPublicKeyMaterial -ContainerName $Selection.ContainerName
    if ($null -eq $containerMaterial) {
        # Not openable and not provably exact. The write would fail anyway, and
        # guessing which key this is before an irreversible step is not on offer.
        $detail['daclState'] = $existing.State
        $detail['daclReasonCode'] = $existing.ReasonCode
        $entry = New-PurposeResult -PurposeName $Selection.Name -KeyId $Selection.KeyId `
            -ContainerName $Selection.ContainerName -Succeeded $false `
            -ReasonCode 'dacl_refused_container_not_openable_by_this_caller' -Detail $detail
        Set-EntryMaterial -Entry $entry -Material $material
        return
    }
    if ($containerMaterial.SpkiSha256 -cne $material.SpkiSha256) {
        $entry = New-PurposeResult -PurposeName $Selection.Name -KeyId $Selection.KeyId `
            -ContainerName $Selection.ContainerName -Succeeded $false `
            -ReasonCode 'dacl_refused_container_public_key_does_not_match_certificate' -Detail $detail
        Set-EntryMaterial -Entry $entry -Material $material
        return
    }

    $target = "the private-key DACL of CNG container '$($Selection.ContainerName)' ($requiredProvider, machine scope)"
    $action = ("IRREVERSIBLE: replace the DACL with a protected single-ACE descriptor granting " +
        "GENERIC_ALL to '$($Selection.DaclServiceName)' ($($Selection.DaclServiceSid)) and owned by " +
        "LocalSystem. This removes YOUR access to this key. There is no undo: recovery means deleting " +
        "and re-minting the key, which changes thumbprint $($RecordedEntry.Thumbprint) and every " +
        'configuration value pinned to it')
    $approval = Test-Approved -Target $target -Action $action
    if (-not $approval.Approved) {
        $entry = New-PurposeResult -PurposeName $Selection.Name -KeyId $Selection.KeyId `
            -ContainerName $Selection.ContainerName -Succeeded $false `
            -ReasonCode $approval.ReasonCode -Detail $detail
        Set-EntryMaterial -Entry $entry -Material $material
        return
    }

    $key = $null
    try {
        $descriptor = [Security.AccessControl.RawSecurityDescriptor]::new($detail['sddl'])
        $binary = [byte[]]::new($descriptor.BinaryLength)
        $descriptor.GetBinaryForm($binary, 0)
        $key = [Security.Cryptography.CngKey]::Open(
            $Selection.ContainerName,
            [Security.Cryptography.CngProvider]::MicrosoftPlatformCryptoProvider,
            [Security.Cryptography.CngKeyOpenOptions]::MachineKey)
        # OWNER_SECURITY_INFORMATION (0x1) | DACL_SECURITY_INFORMATION (0x4).
        # The owner is written explicitly because the services require
        # descriptor.Owner == S-1-5-18. Get-KeyDaclState reads it back with the
        # same 0x5; see the divergence note there.
        $key.SetProperty([Security.Cryptography.CngProperty]::new(
            'Security Descr',
            $binary,
            [Security.Cryptography.CngPropertyOptions]5))
    }
    catch {
        # Type, not message: this record is written to disk and shipped.
        $detail['errorType'] = $_.Exception.GetType().FullName
        $detail['note'] = ('Writing the owner to LocalSystem requires the SeRestorePrivilege that an ' +
            'ordinary elevated administrator does not hold. Run this step in a SYSTEM context.')
        $entry = New-PurposeResult -PurposeName $Selection.Name -KeyId $Selection.KeyId `
            -ContainerName $Selection.ContainerName -Succeeded $false `
            -ReasonCode 'dacl_write_failed' -Detail $detail
        Set-EntryMaterial -Entry $entry -Material $material
        return
    }
    finally {
        if ($null -ne $key) { $key.Dispose() }
    }

    # Read-back. Honest accounting of the three outcomes:
    #   exact      - the descriptor now matches the services' predicate.
    #   unreadable - the narrowed DACL denies this caller. EXPECTED, and not
    #                evidence of failure; it is also not evidence of success.
    #   mismatch   - the write landed but produced a descriptor the services
    #                will reject. The operator must act now.
    $readBack = Get-KeyDaclState -ContainerName $Selection.ContainerName `
        -ServiceSid $Selection.DaclServiceSid
    $detail['daclState'] = $readBack.State
    $detail['daclReasonCode'] = $readBack.ReasonCode
    # Every outcome carries the thumbprint and SPKI of the key it is about. This
    # run does not write the captured inventory - that file is its input and must
    # stay untouched - so without these fields the only account of which keys
    # were irreversibly locked would be the reason codes and console scrollback.
    switch ($readBack.State) {
        'exact' {
            $entry = New-PurposeResult -PurposeName $Selection.Name -KeyId $Selection.KeyId `
                -ContainerName $Selection.ContainerName -Succeeded $true `
                -ReasonCode 'dacl_applied_and_verified_exact' -Detail $detail
        }
        'unreadable' {
            $detail['verificationClaim'] = ('The DACL write was accepted but this caller can no longer ' +
                'read the key, which is the intended consequence. This script does NOT claim the ' +
                'descriptor is correct. Only the owning service loading the key proves that.')
            $entry = New-PurposeResult -PurposeName $Selection.Name -KeyId $Selection.KeyId `
                -ContainerName $Selection.ContainerName -Succeeded $true `
                -ReasonCode 'dacl_applied_read_back_unavailable_to_this_caller' -Detail $detail
        }
        default {
            $entry = New-PurposeResult -PurposeName $Selection.Name -KeyId $Selection.KeyId `
                -ContainerName $Selection.ContainerName -Succeeded $false `
                -ReasonCode 'dacl_applied_but_read_back_does_not_match_service_predicate' -Detail $detail
        }
    }
    Set-EntryMaterial -Entry $entry -Material $material
}

# --- Mode dispatch -----------------------------------------------------------
$mode = 'PROVISION'
if ($VerifyOnly) { $mode = 'VERIFY_ONLY' }
elseif ($ApplyRestrictedKeyDacl) { $mode = 'APPLY_RESTRICTED_KEY_DACL' }

function Add-LoopFailure {
    # A per-purpose failure is one purpose's problem. Without this, a duplicate
    # subject in LocalMachine\My (Get-StoreCertificate throws) or a certificate
    # with no ECDSA public key (Get-PublicKeyMaterial throws) unwinds the entire
    # run under $ErrorActionPreference = 'Stop' - and because the report is the
    # last statement in the file, a PROVISION run that had already minted keys
    # for earlier purposes would exit with no record of their thumbprints at all.
    param(
        [Parameter(Mandatory)]$Selection,
        [Parameter(Mandatory)][string]$ReasonCode,
        [Parameter(Mandatory)]$ErrorRecord
    )

    New-PurposeResult -PurposeName $Selection.Name -KeyId $Selection.KeyId `
        -ContainerName $Selection.ContainerName -Succeeded $false `
        -ReasonCode $ReasonCode -Detail ([ordered]@{
            subject = $Selection.Subject
            consumer = $Selection.Consumer
            errorType = $ErrorRecord.Exception.GetType().FullName
        }) | Out-Null
}

if ($mode -ceq 'VERIFY_ONLY') {
    Add-Narration 'Verify-only: no key, certificate or ACL will be written.'
    if (-not [string]::IsNullOrWhiteSpace($InventoryPath)) {
        Add-Narration "Verify-only: the inventory at $InventoryPath is the one file this run may write."
    }
    foreach ($selection in $selected) {
        try {
            $state = Get-PurposeState -Selection $selection
            Add-VerifiedResult -Selection $selection -State $state
        }
        catch {
            Add-LoopFailure -Selection $selection -ReasonCode 'verification_failed' -ErrorRecord $_
        }
    }
}
elseif ($mode -ceq 'APPLY_RESTRICTED_KEY_DACL') {
    if (-not $AcknowledgeIrreversibleKeyDaclWrite) {
        # Not ShouldProcess, and not substitutable by it. -Confirm:$false in a
        # runbook (or a host that cannot prompt at all, which is every psexec -s
        # invocation) must not be able to authorize this write by accident.
        throw ('-ApplyRestrictedKeyDacl also requires -AcknowledgeIrreversibleKeyDaclWrite. ' +
            'Narrowing these DACLs cannot be undone: this account loses all access to the keys and ' +
            'the only recovery is delete-and-re-mint, which changes every thumbprint and SPKI digest ' +
            'that downstream configuration and evidence claims are pinned to. Nothing was changed.')
    }
    if (-not $runningAsSystem) {
        throw ('-ApplyRestrictedKeyDacl must run as LocalSystem. The descriptor the services require is ' +
            'owned by S-1-5-18, and setting another principal as owner needs SeRestorePrivilege that an ' +
            'elevated administrator does not hold. Re-run this step in a SYSTEM context. Nothing was changed.')
    }
    if ([string]::IsNullOrWhiteSpace($InventoryPath)) {
        throw ('-ApplyRestrictedKeyDacl requires -InventoryPath naming the inventory file already ' +
            'captured by a prior run. This step is not reversible, so it will not proceed against ' +
            'objects whose thumbprints and SPKI digests are not already recorded outside this process.')
    }
    if (-not (Test-CanonicalLocalFilePath -Path $InventoryPath) -or
        -not (Test-Path -LiteralPath $InventoryPath -PathType Leaf)) {
        throw ("The captured inventory '$InventoryPath' is not an existing canonical local file. " +
            'A UNC, device (\\?\) or alternate-data-stream path is refused before it is touched: the ' +
            'file that authorises an irreversible write is not fetched over the network and does not ' +
            'hide behind a stream name. Capture the inventory first, review it, then re-run this step. ' +
            'Nothing was changed.')
    }
    $captured = $null
    try {
        $captured = Get-Content -LiteralPath $InventoryPath -Raw -Encoding utf8 |
            Microsoft.PowerShell.Utility\ConvertFrom-Json -Depth 12
    }
    catch {
        throw "The captured inventory '$InventoryPath' is not readable JSON. Nothing was changed."
    }
    # Every field below is read through Get-DocumentValue. A well-formed JSON
    # document that is simply not an inventory would otherwise raise
    # PropertyNotFoundException under Set-StrictMode and defeat the refusals this
    # block is written to produce. 'objects' is accepted as the legacy spelling
    # of 'purposes' so an inventory captured before the schema was aligned with
    # Test-MsaidiziTpmSigningKeys.ps1 does not become unusable mid-ceremony.
    $capturedPurposes = Get-DocumentValue -Document $captured -Name 'purposes'
    if ($null -eq $capturedPurposes) {
        $capturedPurposes = Get-DocumentValue -Document $captured -Name 'objects'
    }
    if ($null -eq $capturedPurposes -or $capturedPurposes -is [string]) {
        throw ("The captured inventory '$InventoryPath' carries no purpose set. Nothing was changed.")
    }
    $capturedByPurpose = [ordered]@{}
    foreach ($object in @($capturedPurposes)) {
        $recordedThumbprint = Get-DocumentValue -Document $object -Name 'certificateThumbprint'
        if ($null -eq $recordedThumbprint) {
            $recordedThumbprint = Get-DocumentValue -Document $object -Name 'thumbprint'
        }
        $capturedByPurpose[[string](Get-DocumentValue -Document $object -Name 'purpose')] =
            [pscustomobject]@{
                KeyId = [string](Get-DocumentValue -Document $object -Name 'keyId')
                ContainerName = [string](Get-DocumentValue -Document $object -Name 'containerName')
                Thumbprint = [string]$recordedThumbprint
                SpkiSha256 = [string](Get-DocumentValue -Document $object -Name 'subjectPublicKeyInfoSha256')
            }
    }

    $daclSelections = @($selected | Where-Object { $null -ne $_.DaclServiceSid })
    $skipped = @($selected | Where-Object { $null -eq $_.DaclServiceSid })
    foreach ($selection in $skipped) {
        # Refusing here is the safe answer, not an omission. See the purpose
        # table comment: no consuming code asserts a DACL for these purposes and
        # no service SID for them is pinned in source, so a narrowed DACL would
        # be a guess with no undo.
        New-PurposeResult -PurposeName $selection.Name -KeyId $selection.KeyId `
            -ContainerName $selection.ContainerName -Succeeded $true `
            -ReasonCode 'dacl_not_applicable_no_consuming_predicate' -Detail ([ordered]@{
                consumer = $selection.Consumer
                rationale = ('No source-pinned service SID and no consuming DACL predicate exist for ' +
                    'this purpose. Narrowing its DACL on a guess would lock the service out of its own ' +
                    'key with no recovery short of re-minting.')
            }) | Out-Null
    }
    if ($daclSelections.Count -eq 0) {
        throw ('None of the selected purposes has a consuming DACL predicate. Select the egress or ' +
            'isolation purposes, or omit -ApplyRestrictedKeyDacl. Nothing was changed.')
    }
    foreach ($selection in $daclSelections) {
        if (-not $capturedByPurpose.Contains($selection.Name)) {
            throw ("The captured inventory does not record purpose '$($selection.Name)'. " +
                'Capture a complete inventory covering every purpose in this run first. Nothing was changed.')
        }
        $record = $capturedByPurpose[$selection.Name]
        if ($record.Thumbprint -cnotmatch '^[0-9A-F]{40}$' -or
            $record.SpkiSha256 -cnotmatch '^[0-9a-f]{64}$') {
            throw ("The captured inventory entry for '$($selection.Name)' does not carry a canonical " +
                'uppercase thumbprint and lowercase SPKI digest. Nothing was changed.')
        }
        if ([string]::IsNullOrWhiteSpace($record.ContainerName) -or
            [string]::IsNullOrWhiteSpace($record.KeyId)) {
            throw ("The captured inventory entry for '$($selection.Name)' records no container name or " +
                'KeyId, so the container this step would lock cannot be matched against it. ' +
                'Re-capture the inventory with -VerifyOnly -InventoryPath. Nothing was changed.')
        }
    }
    Write-Warning ('About to narrow the private-key DACL on ' + $daclSelections.Count + ' key(s). ' +
        'This is one-way. After it completes, this account cannot use or re-ACL these keys, and the ' +
        'only recovery is delete-and-re-mint, which changes every thumbprint and SPKI digest that ' +
        'downstream configuration and evidence claims are pinned to.')
    foreach ($selection in $daclSelections) {
        try {
            Invoke-RestrictedDacl -Selection $selection -RecordedEntry $capturedByPurpose[$selection.Name]
        }
        catch {
            # In this loop the record matters more than anywhere else in the
            # script: keys earlier in the run may already carry the one-way
            # descriptor, and an unwind here would leave that fact in no report.
            Add-LoopFailure -Selection $selection -ReasonCode 'dacl_step_failed' -ErrorRecord $_
        }
    }
}
else {
    # Provisioning and the DACL step are separate invocations by construction:
    # -ApplyRestrictedKeyDacl selects its own mode above and never mints, so the
    # inventory it reads is always one the operator captured and reviewed first.
    if (-not $runningAsSystem) {
        Write-Warning ('Not running as LocalSystem. Keys minted here will be owned by this account, and ' +
            'the exact descriptor the supervisors require is owned by S-1-5-18. Run the whole ceremony ' +
            'in a SYSTEM context if these keys are for the egress or isolation supervisors.')
    }
    foreach ($selection in $selected) {
        try {
            Invoke-Mint -Selection $selection
        }
        catch {
            Add-LoopFailure -Selection $selection -ReasonCode 'provisioning_failed' -ErrorRecord $_
        }
    }
}

# --- Distinctness -------------------------------------------------------------
# Purpose separation is asserted by CertificateStoreEgressSupervisorSigningKeys
# (ArePurposeSeparatedPublicSpkis), PrivilegedCommandSupervisorOptions.Validate,
# and the evidence gate's uniqueness counts. Two purposes sharing a thumbprint or
# SPKI digest means a key was reused, so it is caught here rather than at
# acceptance.
$materialized = @($results | Where-Object {
    -not [string]::IsNullOrWhiteSpace([string]$_.certificateThumbprint)
})
$distinctnessProblems = [Collections.Generic.List[string]]::new()
foreach ($grouping in @('certificateThumbprint', 'subjectPublicKeyInfoSha256')) {
    $collisions = @($materialized | Group-Object -Property $grouping | Where-Object { $_.Count -gt 1 })
    foreach ($collision in $collisions) {
        $distinctnessProblems.Add(
            "Purposes " + (($collision.Group | ForEach-Object { $_.purpose }) -join ', ') +
            " share a $grouping. Purpose separation forbids key reuse.")
    }
}
foreach ($problem in $distinctnessProblems) {
    Write-Warning $problem
}

# Casing is checked rather than assumed: an object that would be rejected by the
# evidence gate is reported as blocked here instead of shipping into a claim.
foreach ($entry in $materialized) {
    if ([string]$entry.certificateThumbprint -cnotmatch '^[0-9A-F]{40}$' -or
        [string]$entry.subjectPublicKeyInfoSha256 -cnotmatch '^[0-9a-f]{64}$' -or
        [string]$entry.keyId -cnotmatch $keyIdPattern) {
        $entry.status = 'BLOCKED'
        $entry.reasonCode = 'emitted_values_do_not_satisfy_the_evidence_gate_patterns'
    }
}

# state is the verifier's field, and it says one thing only: was material
# actually produced for this purpose. It is set here, after every mode has run
# and after the casing sweep, so that exactly one place in the script decides it.
# Test-MsaidiziTpmSigningKeys.ps1:1266-1268 requires a PROVISIONED entry to carry
# an uppercase thumbprint and an SPKI, and :1275 requires a DEFERRED entry to
# explain itself - the reason code is that explanation.
foreach ($entry in $results) {
    if (-not [string]::IsNullOrWhiteSpace([string]$entry.certificateThumbprint) -and
        [string]$entry.certificateThumbprint -cmatch '^[0-9A-F]{40}$' -and
        -not [string]::IsNullOrWhiteSpace([string]$entry.subjectPublicKeyInfoBase64)) {
        $entry.state = 'PROVISIONED'
        $entry.deferredReason = $null
    }
    else {
        $entry.state = 'DEFERRED'
        $entry.deferredReason = $entry.reasonCode
    }
}

$blocked = @($results | Where-Object { $_.status -ceq 'BLOCKED' })
$report = [ordered]@{
    schemaVersion = 1
    assessmentType = 'MSAIDIZI_TPM_SIGNING_KEY_PROVISIONING'
    authority = 'CEREMONY_RECORD_NOT_A_DEPLOYMENT_ATTESTATION'
    mode = $mode
    whatIf = [bool]$WhatIfPreference
    performedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    runningAsLocalSystem = $runningAsSystem
    provider = $requiredProvider
    certificateValidityDays = $CertificateValidityDays
    isolationPurposesIncluded = [bool]$IncludeIsolationPurposes
    objectCount = $results.Count
    blockedCount = $blocked.Count
    distinctnessSatisfied = $distinctnessProblems.Count -eq 0
    distinctnessProblems = @($distinctnessProblems)
    # 'purposes' is the companion verifier's contract
    # (Test-MsaidiziTpmSigningKeys.ps1:801 reads this key and refuses the whole
    # document with exit 4 when it is absent). See New-PurposeResult for the
    # per-entry field names.
    purposes = @($results)
}

$recordProblems = [Collections.Generic.List[string]]::new()

function Write-CeremonyRecord {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Label
    )

    if (-not (Test-CanonicalLocalFilePath -Path $Path)) {
        $recordProblems.Add("$Label path is not a canonical local file path. Nothing was written to it.")
        return
    }
    # An existing file is never replaced without being asked for by name. A
    # re-run that finds the objects already present records no thumbprints at
    # all, and silently overwriting the captured record with that would destroy
    # the one artifact -ApplyRestrictedKeyDacl accepts - with no supported way to
    # regenerate it beyond re-minting, which is exactly what must not happen.
    $existing = $null
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        $existing = Get-Item -LiteralPath $Path
        if (-not $ForceInventoryOverwrite) {
            $recordProblems.Add("$Label was not written: '$Path' already exists (" +
                [string]$existing.Length + ' bytes, last written ' +
                $existing.LastWriteTimeUtc.ToString('O') +
                '). Choose another path, or pass -ForceInventoryOverwrite to replace it deliberately.')
            return
        }
    }
    $target = if ($null -eq $existing) {
        $Path
    }
    else {
        "$Path (REPLACING an existing " + [string]$existing.Length + '-byte file last written ' +
            $existing.LastWriteTimeUtc.ToString('O') + ')'
    }
    $approval = Test-Approved -Target $target `
        -Action "Write the $Label (purpose, KeyId, container, thumbprint, SPKI, SPKI SHA-256)"
    if (-not $approval.Approved) {
        if ($WhatIfPreference -and $approval.ReasonCode -ceq 'skipped_no_change_made') {
            # A rehearsal writing nothing is the rehearsal working, not a problem.
            Add-Narration "$Label would be written to $Path."
            return
        }
        $recordProblems.Add("$Label was not written: $($approval.ReasonCode).")
        return
    }
    try {
        $report | Microsoft.PowerShell.Utility\ConvertTo-Json -Depth 8 |
            Set-Content -LiteralPath $Path -Encoding utf8NoBOM
    }
    catch {
        # A missing parent directory or a read-only file must not be the reason
        # a run that has already minted TPM keys ends without a report.
        $recordProblems.Add("$Label could not be written to '$Path' (" +
            $_.Exception.GetType().FullName + '). The report below is the only copy.')
        return
    }
    Add-Narration "$Label written to $Path."
}

# VERIFY_ONLY writes the inventory too. It is the only supported way to
# regenerate the record the irreversible step depends on: a PROVISION re-run
# reports 'already_present_refusing_to_overwrite' and materialises no
# thumbprints, and the report goes to [Console]::Out, which is not on the
# PowerShell success stream and so cannot be captured with a pipeline. The
# APPLY run never writes here - the captured inventory is its input, and an
# input that the step it authorises can rewrite is not a control.
if (-not [string]::IsNullOrWhiteSpace($InventoryPath) -and
    ($mode -ceq 'PROVISION' -or $mode -ceq 'VERIFY_ONLY')) {
    Write-CeremonyRecord -Path $InventoryPath -Label 'ceremony inventory'
    if ($mode -ceq 'PROVISION') {
        Add-Narration 'Review the inventory before the DACL step.'
    }
}
if (-not [string]::IsNullOrWhiteSpace($DaclReportPath) -and $mode -ceq 'APPLY_RESTRICTED_KEY_DACL') {
    Write-CeremonyRecord -Path $DaclReportPath -Label 'restricted-DACL record'
}
elseif ($mode -ceq 'APPLY_RESTRICTED_KEY_DACL') {
    Write-Warning ('No -DaclReportPath was given. The record of which keys were irreversibly locked ' +
        'exists only on this console. Capture the JSON below.')
}

if ($mode -ceq 'PROVISION' -and $blocked.Count -eq 0 -and -not $WhatIfPreference) {
    $daclEligible = @($selected | Where-Object { $null -ne $_.DaclServiceSid })
    if ($daclEligible.Count -gt 0) {
        # The exact command the operator needs next, built from this run's own
        # bound parameters so it cannot drift from what was actually minted.
        #
        # Two shapes here are load-bearing and both were got wrong before:
        #  - ONE PURPOSE PER INVOCATION. With -File, arguments bind as literal
        #    strings: '-Purpose A,B' is rejected by ValidateSet as the single
        #    value "A,B", '-Purpose A -Purpose B' is rejected as a duplicate
        #    parameter, and '-Purpose A B' silently binds A and drops B. There is
        #    no comma form that works, and the silent one is the worst outcome
        #    for a step that locks keys, so each key gets its own line. That also
        #    means each irreversible write is its own reviewable command.
        #  - -Confirm:$false IS REQUIRED, and is not the consent. This script is
        #    ConfirmImpact='High', so every ShouldProcess prompts; under
        #    -NonInteractive (psexec -s cannot prompt at all, nor can a SYSTEM
        #    scheduled task) that prompt raises instead of asking. Consent is
        #    -AcknowledgeIrreversibleKeyDaclWrite, which suppressing prompts
        #    cannot supply by accident.
        $arguments = [Collections.Generic.List[string]]::new()
        $arguments.Add('-NoProfile')
        $arguments.Add('-NonInteractive')
        $arguments.Add("-File `"$PSCommandPath`"")
        if ($IncludeIsolationPurposes) { $arguments.Add('-IncludeIsolationPurposes') }
        if (-not [string]::IsNullOrWhiteSpace($EgressAttestationKeyId)) {
            $arguments.Add("-EgressAttestationKeyId `"$EgressAttestationKeyId`"")
        }
        if (-not [string]::IsNullOrWhiteSpace($EgressReceiptKeyId)) {
            $arguments.Add("-EgressReceiptKeyId `"$EgressReceiptKeyId`"")
        }
        $arguments.Add("-KeyContainerPrefix `"$KeyContainerPrefix`"")
        $arguments.Add('-Confirm:$false')
        $pwsh = [Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
        Add-Narration ''
        Add-Narration ('Next ceremony step, in a SYSTEM context (PsExec shown; a SYSTEM scheduled task ' +
            'is equivalent). One command per key, each irreversible:')
        foreach ($eligible in $daclEligible) {
            Add-Narration ("  psexec.exe -accepteula -s `"$pwsh`" " +
                (($arguments + @("-InventoryPath `"$InventoryPath`"",
                    "-Purpose $($eligible.Name)",
                    '-ApplyRestrictedKeyDacl',
                    '-AcknowledgeIrreversibleKeyDaclWrite')) -join ' '))
        }
        Add-Narration ('Add -DaclReportPath "<new file>" to each of those to keep a durable record of ' +
            'what was locked; the captured inventory is that step''s input and is never rewritten by it.')
        Add-Narration ''
        # No -InventoryPath on the verification commands: verify-only may write
        # the inventory, and the file named above already exists, so passing it
        # here would only produce a refusal to overwrite. Point it at a NEW file
        # when the record has to be regenerated.
        Add-Narration 'After the DACL step, this caller can no longer read these keys. Verify with:'
        foreach ($eligible in $daclEligible) {
            Add-Narration ("  psexec.exe -accepteula -s `"$pwsh`" " +
                (($arguments + @("-Purpose $($eligible.Name)", '-VerifyOnly')) -join ' '))
        }
        Add-Narration ('A daclState of "unreadable" there is expected and proves nothing either way. ' +
            'The authoritative check is the owning service starting and its own exact-ACL predicate passing.')
    }
}

foreach ($problem in $recordProblems) {
    Write-Warning $problem
}
$report['recordProblems'] = @($recordProblems)
$report['narration'] = @($narration)

[Console]::Out.WriteLine(($report | Microsoft.PowerShell.Utility\ConvertTo-Json -Depth 8 -Compress))

# A -WhatIf rehearsal that declined every change is not a failed ceremony. Every
# purpose is recorded BLOCKED/'skipped_no_change_made' by construction on that
# path, and returning 2 for it trains an operator - and any CI wrapper gating on
# the exit code - to read the blocking code as noise.
$rehearsalOnly = $WhatIfPreference -and $blocked.Count -ne 0 -and
    @($blocked | Where-Object { $_.reasonCode -cne 'skipped_no_change_made' }).Count -eq 0
if ($rehearsalOnly -and $distinctnessProblems.Count -eq 0 -and $recordProblems.Count -eq 0) { exit 0 }
if ($blocked.Count -ne 0 -or $distinctnessProblems.Count -ne 0 -or $recordProblems.Count -ne 0) { exit 2 }
exit 0
