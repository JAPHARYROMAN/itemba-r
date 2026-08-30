[CmdletBinding(DefaultParameterSetName = 'InventoryPath')]
param(
    [Parameter(Mandatory, ParameterSetName = 'InventoryPath')]
    [string]$InventoryPath,
    [Parameter(Mandatory, ParameterSetName = 'InventoryObject')]
    $Inventory,
    [ValidateSet('All', 'Host', 'SigningKeys', 'VerificationPins', 'Separation')]
    [string[]]$Scope = @('All')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# This script is STRICTLY READ-ONLY. It opens the certificate stores with
# OpenExistingOnly|ReadOnly, opens CNG keys for read, reads one CNG property,
# and writes a single JSON document to stdout. It creates nothing, deletes
# nothing, and never touches the ceremony's state. It is therefore safe to run
# at any point in the ceremony, and safe to run repeatedly.
#
# It is also NON-AUTHORITATIVE in the same sense as
# Test-ProductionPrerequisites.ps1: it re-runs, in PowerShell, the predicates the
# consuming services enforce at startup, so an operator learns now rather than at
# first service start. Only the services themselves - and the externally trusted
# signed evidence gates - may declare a deployment eligible.
#
# The predicates below mirror, and cite, the C# that enforces them:
#
#   windows-companion/src/Msaidizi.Companion.Service/Security/DeviceIdentityProvisioner.cs
#     :172-196  the certificate template this ceremony copies - CN subject,
#               SHA256 signature, BasicConstraints(CA=false, critical),
#               KeyUsage(DigitalSignature, critical), EKU(1.3.6.1.5.5.7.3.2,
#               critical), and a bounded validity window.
#     :524-540  EnsureKeyPolicy - ECDsa algorithm group, KeySize 256, exact
#               provider, non-exportable, CngKeyUsages.Signing.
#     :536-540  the non-exportable definition: ALL FOUR CngExportPolicies bits
#               (AllowExport, AllowPlaintextExport, AllowArchiving,
#               AllowPlaintextArchiving) clear.
#
#   windows-companion/src/Msaidizi.EgressSupervisor/Security/EgressSupervisorSigningKeys.cs
#     :273-297  ResolveUnique - exactly one LocalMachine\My match by thumbprint
#               with validOnly:true.
#     :299-333  ResolvePrivateP256 - HasPrivateKey, inside the validity window,
#               no CA basic constraint, ECDsaCng, KeySize 256, IsMachineKey,
#               provider "Microsoft Platform Crypto Provider",
#               ExportPolicy == CngExportPolicies.None, exact ACL.
#     :335-395  HasExactPrivateKeyAcl / IsExactPrivateKeyDescriptor - read
#               "Security Descr" with (CngPropertyOptions)0x4, then require
#               Owner == LocalSystem, DiscretionaryAclProtected, EXACTLY ONE ACE,
#               CommonAce, AccessAllowed, AceFlags == None, not a callback ACE,
#               AccessMask == GENERIC_ALL (0x10000000), SID == owning service SID.
#     :397-410  ArePurposeSeparatedPublicSpkis - the three SPKIs must differ.
#
#   windows-companion/src/Msaidizi.PrivilegedCommandSupervisor/Security/IsolationEvidenceSigner.cs
#     :151-268  the same predicate for each of the four isolation purposes, with
#               Algorithm == CngAlgorithm.ECDsaP256 asserted explicitly and the
#               pinned SPKI compared as base64.
#
#   windows-companion/src/Msaidizi.PrivilegedCommandSupervisor/Security/PinnedVerificationKeys.cs
#     :77-110   the TrustedPeople public-only pin - exactly one match by
#               thumbprint with validOnly:true, HasPrivateKey MUST be false,
#               KeySize 256, exported SPKI FixedTimeEquals the configured base64.
#   windows-companion/src/Msaidizi.EgressSupervisor/Security/EgressActionTokenTrust.cs
#     :32-59    the egress supervisor's copy of that same public-only pin.
#
#   windows-companion/src/Msaidizi.AuditSigner/Security/HardwareBackedCertificateSigner.cs
#     :33-103   exactly one valid LocalMachine\My match WITH a private key,
#               inside its validity window, client-auth EKU present, KeyUsage (if
#               present) carrying DigitalSignature, public key P-256, ECDsaCng,
#               KeySize 256, ECDsa algorithm group, none of the four exportable
#               bits set, and provider equal to the pinned hardware provider.
#
#   windows-companion/installer/scripts/Test-ProductionPrerequisites.ps1
#     :863-873  the evidence gate's CASE-SENSITIVE conventions, enforced with
#               -cmatch: key ids ^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$, certificate
#               thumbprints UPPERCASE ^[0-9A-F]{40}$, SPKI SHA-256 digests
#               lowercase ^[0-9a-f]{64}$, and pairwise distinctness across the set.
#     :1100-1105 the six isolation key ids the gate asserts by string equality.
#
# Service SIDs are compile-time pins and are NOT configuration. They are read at
# run time out of the source that declares them, never hardcoded here:
#   src/Msaidizi.EgressSupervisor/EgressSupervisorTrustIdentity.cs (ServiceSid)
#   src/Msaidizi.PrivilegedCommandSupervisor/Security/SupervisorServiceIdentity.cs
#     (RequiredServiceSid)
#
# ---------------------------------------------------------------------------
# INVENTORY
#
# The expected set comes entirely from the operator's inventory - this script
# pins no thumbprint, no SPKI and no digest of its own. Supply it either as
# -InventoryPath <path to JSON> or as -Inventory <object>. Shape:
#
#   {
#     "schemaVersion": 1,
#     "purposes": [
#       {
#         "purpose": "EgressAttestation",
#         "state": "PROVISIONED",
#         "store": "My",
#         "keyId": "<key id>",
#         "owningService": "EgressSupervisor",
#         "certificateThumbprint": "<40 uppercase hex>",
#         "subjectPublicKeyInfoBase64": "<base64 SPKI>"
#       },
#       {
#         "purpose": "IsolationReservationLease",
#         "state": "DEFERRED",
#         "deferredReason": "isolation driver not yet built",
#         "store": "My",
#         "keyId": "reservation-lease-v1",
#         "owningService": "PrivilegedCommandSupervisor"
#       },
#       {
#         "purpose": "ActionTokenVerification",
#         "state": "PROVISIONED",
#         "store": "TrustedPeople",
#         "keyId": "msaidizi-action-token-v1",
#         "certificateThumbprint": "<40 uppercase hex>",
#         "subjectPublicKeyInfoBase64": "<base64 SPKI>"
#       }
#     ]
#   }
#
# "store" is My for a private signing key and TrustedPeople for a public-only
# verification pin. "owningService" is required for My and must be one of
# EgressSupervisor, PrivilegedCommandSupervisor or NoConsumingDaclPredicate; the
# first two have their SID resolved from the compile-time source above. A
# DEFERRED entry needs no thumbprint or SPKI.
#
# NoConsumingDaclPredicate is the honest declaration for the audit-signer, the
# update-supervisor client and the recovery-supervisor client. New-MsaidiziTpm-
# SigningKeys.ps1:460-507 mints all three with DaclServiceSid = $null and
# :978-993 refuses to narrow their DACLs, because no consuming code asserts a
# descriptor for them and no service SID for them is pinned in source. Declaring
# them with either supervisor's name would make this script demand a DACL the
# ceremony deliberately did not apply; declaring them here reports
# cng_security_descriptor_exact as NOT_ENFORCED and checks everything else.
#
# ---------------------------------------------------------------------------
# STATUS VOCABULARY
#
# Test-ProductionPrerequisites.ps1 emits PASS/BLOCKED only, because everything it
# looks at is an artifact that is either there or not. Key material is not like
# that, so this script emits five:
#
#   PASS      the predicate the service enforces is satisfied.
#   FAIL      the predicate is demonstrably violated. The ceremony is wrong and
#             the service will refuse to start - or, worse, the key is exportable.
#   BLOCKED   the predicate could not be evaluated. Either the security context
#             cannot reach it - the honest answer once the ceremony has applied
#             the exact DACL, since a non-SYSTEM caller can no longer open the
#             key - or an input the verifier itself needs is missing. Only the
#             first kind carries the SYSTEM-context command, because only the
#             first kind is fixed by re-running as SYSTEM.
#   DEFERRED  the operator's inventory declares this purpose not yet
#             provisionable. Reported as DEFERRED, never as FAIL - the four
#             isolation signing purposes cannot exist until the isolation driver
#             does, and colouring that red teaches an operator to ignore red.
#   NOT_ENFORCED  the predicate was not evaluated, or was evaluated and deviates,
#             but no consuming service enforces it for this purpose. Reported so
#             a ceremony that stopped matching the template is visible, and
#             deliberately non-gating: a status that cannot fail a run must not
#             be spelled FAIL, or CEREMONY_FAILED stops meaning anything.
#
# Exit codes, so a later ceremony step can gate on this:
#   0  every provisioned purpose was examined and verified; deferrals of the four
#      driver-dependent purposes are reported, not fatal.
#   2  nothing failed, but the run is not a full attestation: a check is
#      indeterminate (BLOCKED), a selected -Scope excluded purposes the inventory
#      declares, a purpose was deferred that no driver dependency explains, or
#      the inventory declares no provisioned purpose at all. The state field says
#      which. Exit 0 is the ONLY code that means "verified"; a gate that treats
#      "not 3" as success is reading this wrong.
#   3  at least one check FAILED.
#   4  the inventory itself is unusable, so nothing was verified.

$checks = [Collections.Generic.List[object]]::new()
$purposeSummaries = [Collections.Generic.List[object]]::new()
$installerRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$companionRoot = [IO.Path]::GetFullPath((Join-Path $installerRoot '..'))
$clientAuthenticationOid = '1.3.6.1.5.5.7.3.2'
# CertificateStoreEgressAttestationKeyResolver.cs:18 pins this literal, and
# PrivilegedCommandSupervisorOptions.cs:369-370 reaches the same value through
# ECCurve.NamedCurves.nistP256. KeySize 256 is NOT a substitute for it:
# brainpoolP256r1 and secp256k1 both report KeySize 256, so a wrong-curve key
# satisfies every size check here and then fails options.Validate() at startup.
$p256CurveOid = '1.2.840.10045.3.1.7'
$maximumSpkiBase64Length = 1024
$genericAll = 0x10000000
$maximumInventoryBytes = 1048576

# The six isolation key ids Test-ProductionPrerequisites.ps1:1100-1105 asserts by
# string equality. These are protocol constants, not secrets and not operator
# choices, so an inventory that renames one has drifted from the evidence gate.
$evidenceGateKeyIds = [ordered]@{
    'reservation-lease-v1'                      = 'IsolationReservationLease'
    'pre-bind-reservation-release-v1'            = 'IsolationPreBindReservationRelease'
    'suspended-process-bind-acknowledgement-v1'  = 'IsolationSuspendedProcessBindAcknowledgement'
    'terminal-enforcement-receipt-v1'            = 'IsolationTerminalEnforcementReceipt'
    'msaidizi-action-token-v1'                   = 'ActionTokenVerification'
    'isolation-driver-attestation-v2'            = 'DriverAttestationVerification'
}

# Only these four depend on the isolation driver existing, so only these four may
# be deferred without comment. Anything else marked DEFERRED is still reported as
# DEFERRED - the operator declared it - but flagged as an unexpected deferral so
# a later gate can require unexpectedDeferralCount to be zero.
# The declaration an operator uses for a My purpose the ceremony deliberately
# leaves un-narrowed. See the INVENTORY header above.
$noConsumingDaclPredicate = 'NoConsumingDaclPredicate'
$recognisedOwningServices = @('EgressSupervisor', 'PrivilegedCommandSupervisor', $noConsumingDaclPredicate)

$driverDependentKeyIds = @(
    'reservation-lease-v1',
    'pre-bind-reservation-release-v1',
    'suspended-process-bind-acknowledgement-v1',
    'terminal-enforcement-receipt-v1'
)

$keyScopeNames = @('SigningKeys', 'VerificationPins')
$allScopeNames = @('Host', 'SigningKeys', 'VerificationPins', 'Separation')

# [ValidateSet] validates case-INSENSITIVELY but does NOT normalize what it
# bound, so "-Scope all" arrives here as the literal string "all". Every scope
# test below is ordinal, so an un-normalized value silently matches nothing: the
# run selects no scope, touches no certificate and no key, and - before the
# state derivation at the foot of this script also learned to notice that -
# reported a fully verified ceremony. Canonicalize first, and never compare the
# operator's spelling to a scope name again.
$canonicalScopeNames = [Collections.Generic.Dictionary[string, string]]::new(
    [StringComparer]::OrdinalIgnoreCase)
foreach ($canonicalScope in @('All') + $allScopeNames) {
    $canonicalScopeNames[$canonicalScope] = $canonicalScope
}

$selectedScopes = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
foreach ($requestedScope in $Scope) {
    # ValidateSet has already refused anything outside the set, so the lookup
    # cannot miss; the guard is here so a future set member added to the
    # attribute but not to $allScopeNames fails loudly instead of silently.
    if (-not $canonicalScopeNames.ContainsKey($requestedScope)) {
        throw "Scope '$requestedScope' has no canonical spelling. Nothing was verified."
    }
    $normalizedScope = $canonicalScopeNames[$requestedScope]
    if ($normalizedScope -ceq 'All') {
        foreach ($expandedScope in $allScopeNames) {
            [void]$selectedScopes.Add($expandedScope)
        }
    }
    else {
        [void]$selectedScopes.Add($normalizedScope)
    }
}

function Test-ScopeSelected {
    param([Parameter(Mandatory)][string]$Name)
    return $selectedScopes.Contains($Name)
}

function Add-KeyCheck {
    param(
        [Parameter(Mandatory)][string]$Id,
        [Parameter(Mandatory)][string]$ScopeName,
        [Parameter(Mandatory)][ValidateSet('PASS', 'FAIL', 'BLOCKED', 'DEFERRED', 'NOT_ENFORCED')][string]$Status,
        [Parameter(Mandatory)][string]$ReasonCode,
        [string]$Purpose = '',
        [Collections.IDictionary]$Evidence = ([ordered]@{})
    )

    $checks.Add([pscustomobject][ordered]@{
        id = $Id
        scope = $ScopeName
        purpose = $Purpose
        status = $Status
        reasonCode = $ReasonCode
        evidence = [pscustomobject]$Evidence
    })
}

function Add-PredicateCheck {
    param(
        [Parameter(Mandatory)][string]$Id,
        [Parameter(Mandatory)][string]$ScopeName,
        [Parameter(Mandatory)][bool]$Satisfied,
        [Parameter(Mandatory)][string]$PassReasonCode,
        [Parameter(Mandatory)][string]$FailReasonCode,
        [string]$Purpose = '',
        [Collections.IDictionary]$Evidence = ([ordered]@{})
    )

    Add-KeyCheck -Id $Id -ScopeName $ScopeName -Purpose $Purpose `
        -Status $(if ($Satisfied) { 'PASS' } else { 'FAIL' }) `
        -ReasonCode $(if ($Satisfied) { $PassReasonCode } else { $FailReasonCode }) `
        -Evidence $Evidence
}

function Get-EntryValue {
    # [AllowNull()] is load-bearing. A JSON inventory may legally contain a null
    # element in its purposes array, and a Mandatory parameter without this
    # attribute rejects an explicit $null at BIND time with a
    # ParameterBindingValidationException - which would kill the whole run before
    # the $null guard below could ever execute, emitting no JSON at all. The
    # guard is the intended behaviour; the attribute is what lets it run.
    param(
        [Parameter(Mandatory)][AllowNull()]$Entry,
        [Parameter(Mandatory)][string]$Name)

    # Set-StrictMode -Version Latest makes a missing property a terminating
    # error, and the inventory is operator-authored, so every read goes through
    # here rather than through $entry.whatever. -Inventory may also be handed a
    # hashtable rather than the pscustomobject ConvertFrom-Json produces, and a
    # hashtable does not surface its keys as PSObject properties.
    if ($null -eq $Entry) { return $null }
    if ($Entry -is [Collections.IDictionary]) {
        if (-not $Entry.Contains($Name)) { return $null }
        return $Entry[$Name]
    }
    $property = $Entry.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return $property.Value
}

function Get-Sha256Hex {
    param([Parameter(Mandatory)][byte[]]$Bytes)

    $hasher = [Security.Cryptography.SHA256]::Create()
    try {
        # Lowercase to match EgressSupervisorSigningKeys.cs:127-128 and the
        # ^[0-9a-f]{64}$ digests Test-ProductionPrerequisites.ps1 requires.
        return [Convert]::ToHexString($hasher.ComputeHash($Bytes)).ToLowerInvariant()
    }
    finally { $hasher.Dispose() }
}

function Get-NormalizedThumbprint {
    param([string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) { return '' }
    return ($Value -replace '\s', '').ToUpperInvariant()
}

function Test-P256CurveParameters {
    param($Key)

    # CertificateStoreEgressAttestationKeyResolver.cs:249-252 and
    # PrivilegedCommandSupervisorOptions.cs:369-370 both reach past KeySize to
    # the named curve itself. Reported as its own evidence so a wrong-curve key
    # names the curve it actually is instead of just failing "not P-256".
    $evidence = [ordered]@{
        curveOid = ''
        expectedCurveOid = $p256CurveOid
        qxLength = -1
        qyLength = -1
    }
    if ($null -eq $Key) {
        return [pscustomobject]@{ Satisfied = $false; Evidence = $evidence }
    }
    try {
        $parameters = $Key.ExportParameters($false)
        $evidence['curveOid'] = [string]$parameters.Curve.Oid.Value
        $evidence['qxLength'] = if ($null -ne $parameters.Q.X) { $parameters.Q.X.Length } else { -1 }
        $evidence['qyLength'] = if ($null -ne $parameters.Q.Y) { $parameters.Q.Y.Length } else { -1 }
        $satisfied = $evidence['curveOid'] -ceq $p256CurveOid -and
            $evidence['qxLength'] -eq 32 -and $evidence['qyLength'] -eq 32
        return [pscustomobject]@{ Satisfied = $satisfied; Evidence = $evidence }
    }
    catch {
        $evidence['curveOid'] = "<unreadable: $($_.Exception.GetType().Name)>"
        return [pscustomobject]@{ Satisfied = $false; Evidence = $evidence }
    }
}

function Test-CanonicalP256Spki {
    param([string]$Base64)

    # A transliteration of CanonicalP256Spki in
    # PrivilegedCommandSupervisorOptions.cs:344-384, which gates ValidSigningKey
    # and ValidVerificationKey for all four isolation signing keys and both
    # TrustedPeople verification keys. It reads only the operator's inventory
    # text, so - unlike every store and CNG predicate below - it stays
    # determinate when the caller is not on the key's ACL. An SPKI that fails
    # here throws at options.Validate() before the service reaches a resolver,
    # which is a startup refusal with no key handle anywhere in the message.
    $evidence = [ordered]@{
        supplied = -not [string]::IsNullOrWhiteSpace($Base64)
        withinLengthLimit = $false
        base64RoundTripsExactly = $false
        importedAsSubjectPublicKeyInfo = $false
        consumedEveryByte = $false
        keySize = -1
        curveOid = ''
        expectedCurveOid = $p256CurveOid
        derIsCanonical = $false
    }
    if (-not $evidence['supplied']) {
        return [pscustomobject]@{ Satisfied = $false; ReasonCode = 'inventory_spki_absent'; Evidence = $evidence }
    }
    $evidence['withinLengthLimit'] = $Base64.Length -le $maximumSpkiBase64Length
    if (-not $evidence['withinLengthLimit']) {
        return [pscustomobject]@{ Satisfied = $false; ReasonCode = 'inventory_spki_exceeds_the_configuration_length_limit'; Evidence = $evidence }
    }

    $encoded = $null
    $canonical = $null
    $key = $null
    try {
        $encoded = [Convert]::FromBase64String($Base64)
        # Ordinal, not a decode-and-hope: Convert.FromBase64String accepts
        # whitespace and non-canonical padding that the service's ordinal
        # re-encode comparison rejects.
        $evidence['base64RoundTripsExactly'] = [Convert]::ToBase64String($encoded) -ceq $Base64
        if (-not $evidence['base64RoundTripsExactly']) {
            return [pscustomobject]@{ Satisfied = $false; ReasonCode = 'inventory_spki_base64_is_not_canonical'; Evidence = $evidence }
        }
        $key = [Security.Cryptography.ECDsa]::Create()
        $consumed = 0
        $key.ImportSubjectPublicKeyInfo($encoded, [ref]$consumed)
        $evidence['importedAsSubjectPublicKeyInfo'] = $true
        $evidence['consumedEveryByte'] = $consumed -eq $encoded.Length
        $evidence['keySize'] = $key.KeySize
        $curveProbe = Test-P256CurveParameters -Key $key
        $evidence['curveOid'] = $curveProbe.Evidence['curveOid']
        $canonical = $key.ExportSubjectPublicKeyInfo()
        # base64RoundTripsExactly above already proved ToBase64String($encoded)
        # -ceq $Base64, so comparing the re-exported DER's base64 to the same
        # string is exactly the byte comparison the C# performs with
        # encoded.AsSpan().SequenceEqual(canonical).
        $evidence['derIsCanonical'] = [Convert]::ToBase64String($canonical) -ceq $Base64

        $satisfied = $evidence['consumedEveryByte'] -and $evidence['keySize'] -eq 256 -and
            $curveProbe.Satisfied -and $evidence['derIsCanonical']
        return [pscustomobject]@{
            Satisfied = $satisfied
            ReasonCode = if ($satisfied) {
                'inventory_spki_is_a_canonical_p256_subject_public_key_info'
            }
            else {
                'inventory_spki_is_not_a_canonical_p256_subject_public_key_info'
            }
            Evidence = $evidence
        }
    }
    catch {
        return [pscustomobject]@{
            Satisfied = $false
            ReasonCode = 'inventory_spki_is_not_decodable_as_a_subject_public_key_info'
            Evidence = $evidence
        }
    }
    finally {
        if ($null -ne $key) { $key.Dispose() }
        if ($null -ne $encoded) { [Array]::Clear($encoded, 0, $encoded.Length) }
        if ($null -ne $canonical) { [Array]::Clear($canonical, 0, $canonical.Length) }
    }
}

function Get-ServiceSidPin {
    param(
        [Parameter(Mandatory)][string]$SourceRelativePath,
        [Parameter(Mandatory)][string]$ConstantName
    )

    # The SID is a compile-time constant in the service's own source. Reading it
    # from there rather than restating it means this script cannot disagree with
    # the binary that will actually be asked to use the key.
    try {
        $sourcePath = Join-Path $companionRoot $SourceRelativePath
        $sourceText = Get-Content -LiteralPath $sourcePath -Raw -Encoding utf8 -ErrorAction Stop
        $pinMatch = [regex]::Match(
            $sourceText,
            'const\s+string\s+' + [regex]::Escape($ConstantName) + '\s*=\s*\r?\n?\s*"(S-1-5-80-[0-9\-]+)"')
        if (-not $pinMatch.Success) {
            return [pscustomobject]@{ Resolved = $false; Sid = $null; ReasonCode = 'service_sid_constant_not_found_in_source' }
        }
        return [pscustomobject]@{
            Resolved = $true
            Sid = [Security.Principal.SecurityIdentifier]::new($pinMatch.Groups[1].Value)
            ReasonCode = 'service_sid_read_from_compile_time_source'
        }
    }
    catch {
        return [pscustomobject]@{ Resolved = $false; Sid = $null; ReasonCode = 'service_sid_source_unreadable' }
    }
}

function Get-UniqueStoreCertificate {
    param(
        [Parameter(Mandatory)][Security.Cryptography.X509Certificates.StoreName]$StoreName,
        [Parameter(Mandatory)][string]$Thumbprint
    )

    # EgressSupervisorSigningKeys.cs:273-297, IsolationEvidenceSigner.cs:152-175,
    # PinnedVerificationKeys.cs:77-88 and HardwareBackedCertificateSigner.cs:41-49
    # all resolve the same way: LocalMachine, OpenExistingOnly|ReadOnly,
    # FindByThumbprint with validOnly:true, and exactly one match or refuse.
    $store = [Security.Cryptography.X509Certificates.X509Store]::new(
        $StoreName,
        [Security.Cryptography.X509Certificates.StoreLocation]::LocalMachine)
    try {
        $store.Open(
            [Security.Cryptography.X509Certificates.OpenFlags]::OpenExistingOnly -bor
            [Security.Cryptography.X509Certificates.OpenFlags]::ReadOnly)
        $matched = $store.Certificates.Find(
            [Security.Cryptography.X509Certificates.X509FindType]::FindByThumbprint,
            $Thumbprint,
            $true)
        $found = @($matched)
        if ($found.Count -ne 1) {
            foreach ($candidate in $found) { $candidate.Dispose() }
            return [pscustomobject]@{
                Determined = $true
                Resolved = $false
                Certificate = $null
                MatchCount = $found.Count
                ReasonCode = 'certificate_thumbprint_did_not_resolve_exactly_once'
                Exception = ''
            }
        }
        return [pscustomobject]@{
            Determined = $true
            Resolved = $true
            Certificate = $found[0]
            MatchCount = 1
            ReasonCode = 'certificate_resolved_exactly_once'
            Exception = ''
        }
    }
    catch {
        # Determined = $false, NOT a failed match. An Open() that threw on access
        # denial, or OpenExistingOnly against a LocalMachine\TrustedPeople store
        # that has never been created, means the store was never read - so the
        # count of matches in it is unknown, not zero. Reporting that as FAIL
        # would say CEREMONY_FAILED and exit 3 about the caller's security
        # context. FAIL is reserved for a store that WAS read and held the wrong
        # number of certificates.
        return [pscustomobject]@{
            Determined = $false
            Resolved = $false
            Certificate = $null
            MatchCount = -1
            ReasonCode = 'certificate_store_unreadable_by_caller'
            Exception = $_.Exception.GetType().Name
        }
    }
    finally { $store.Dispose() }
}

function Test-ExactPrivateKeyDescriptor {
    param(
        [Parameter(Mandatory)][Security.Cryptography.CngKey]$Key,
        [Parameter(Mandatory)][Security.Principal.SecurityIdentifier]$OwningServiceSid
    )

    # A transliteration of IsExactPrivateKeyDescriptor in both
    # EgressSupervisorSigningKeys.cs:359-395 and IsolationEvidenceSigner.cs:248-272.
    # Every element is reported separately so a failure names the deviation
    # instead of just saying "ACL wrong".
    $evidence = [ordered]@{
        descriptorRead = $false
        ownerIsLocalSystem = $false
        discretionaryAclProtected = $false
        aceCount = -1
        singleCommonAce = $false
        aceQualifierAccessAllowed = $false
        aceFlagsNone = $false
        aceIsNotCallback = $false
        accessMaskIsGenericAll = $false
        aceSidMatchesOwningService = $false
    }
    try {
        # NCRYPT_SECURITY_DESCR_PROPERTY with DACL_SECURITY_INFORMATION (0x4) -
        # the exact property and option the services read.
        $property = $Key.GetProperty(
            'Security Descr',
            [Enum]::ToObject([Security.Cryptography.CngPropertyOptions], 4))
        $descriptorBytes = $property.GetValue()
        if ($null -eq $descriptorBytes) {
            return [pscustomobject]@{ Determined = $true; Satisfied = $false; ReasonCode = 'cng_security_descriptor_absent'; Evidence = $evidence }
        }
        # Constructed in its own try because a malformed descriptor is a
        # DIFFERENT answer from an unreadable one. RawSecurityDescriptor throws
        # ArgumentException on bytes it cannot parse, and both
        # EgressSupervisorSigningKeys.cs:354-358 and
        # IsolationEvidenceSigner.cs:241-245 catch ArgumentException alongside
        # CryptographicException and return FALSE - the service refuses to start.
        # That is a determinate defect the operator must re-mint, so it must not
        # be reported as "re-run as SYSTEM"; SYSTEM sees the same corrupt bytes.
        try {
            $descriptor = [Security.AccessControl.RawSecurityDescriptor]::new($descriptorBytes, 0)
        }
        catch [ArgumentException] {
            return [pscustomobject]@{
                Determined = $true
                Satisfied = $false
                ReasonCode = 'cng_security_descriptor_is_malformed'
                Evidence = $evidence
            }
        }
        $evidence['descriptorRead'] = $true

        $systemSid = [Security.Principal.SecurityIdentifier]::new(
            [Security.Principal.WellKnownSidType]::LocalSystemSid, $null)
        $evidence['ownerIsLocalSystem'] = $null -ne $descriptor.Owner -and $descriptor.Owner.Equals($systemSid)
        $evidence['discretionaryAclProtected'] = $descriptor.ControlFlags.HasFlag(
            [Security.AccessControl.ControlFlags]::DiscretionaryAclProtected)
        if ($null -eq $descriptor.DiscretionaryAcl) {
            return [pscustomobject]@{ Determined = $true; Satisfied = $false; ReasonCode = 'cng_security_descriptor_has_no_dacl'; Evidence = $evidence }
        }
        $evidence['aceCount'] = $descriptor.DiscretionaryAcl.Count

        # Exactly one ACE. Rejecting every other shape is what stops an ObjectAce,
        # an inherited grant, or a second SID from being silently skipped.
        if ($descriptor.DiscretionaryAcl.Count -ne 1) {
            return [pscustomobject]@{ Determined = $true; Satisfied = $false; ReasonCode = 'cng_dacl_does_not_contain_exactly_one_ace'; Evidence = $evidence }
        }
        $ace = $descriptor.DiscretionaryAcl[0]
        $evidence['singleCommonAce'] = $ace -is [Security.AccessControl.CommonAce]
        if (-not $evidence['singleCommonAce']) {
            return [pscustomobject]@{ Determined = $true; Satisfied = $false; ReasonCode = 'cng_dacl_ace_is_not_a_common_ace'; Evidence = $evidence }
        }
        $evidence['aceQualifierAccessAllowed'] =
            $ace.AceQualifier -eq [Security.AccessControl.AceQualifier]::AccessAllowed
        $evidence['aceFlagsNone'] = $ace.AceFlags -eq [Security.AccessControl.AceFlags]::None
        $evidence['aceIsNotCallback'] = -not $ace.IsCallback
        $evidence['accessMaskIsGenericAll'] = $ace.AccessMask -eq $genericAll
        $evidence['aceSidMatchesOwningService'] =
            $null -ne $ace.SecurityIdentifier -and $ace.SecurityIdentifier.Equals($OwningServiceSid)

        $satisfied = $evidence['ownerIsLocalSystem'] -and
            $evidence['discretionaryAclProtected'] -and
            $evidence['aceQualifierAccessAllowed'] -and
            $evidence['aceFlagsNone'] -and
            $evidence['aceIsNotCallback'] -and
            $evidence['accessMaskIsGenericAll'] -and
            $evidence['aceSidMatchesOwningService']
        return [pscustomobject]@{
            Determined = $true
            Satisfied = $satisfied
            ReasonCode = if ($satisfied) { 'cng_dacl_exactly_owning_service_only' } else { 'cng_dacl_deviates_from_service_only_shape' }
            Evidence = $evidence
        }
    }
    catch {
        # The services treat a CryptographicException here as "no" because they
        # run as the owning service and so a read failure really is a defect. A
        # verification tool cannot assume that: an Administrator caller is simply
        # not on this ACL. Report indeterminate and let the caller re-run as SYSTEM.
        #
        # Unless the caller ALREADY is LOCAL SYSTEM. The descriptor's owner is
        # required to be LocalSystem and an owner always holds READ_CONTROL, so a
        # SYSTEM caller that still cannot read the descriptor has learned the same
        # thing the service learns, and the same answer the service gives - false.
        # Telling that caller to re-run as SYSTEM sends them round a loop that
        # cannot clear. This mirrors the FAIL-vs-BLOCKED choice the private-key
        # open makes in Invoke-SigningPurposeVerification.
        $evidence['readFailure'] = $_.Exception.GetType().Name
        if ($callerIsLocalSystem) {
            return [pscustomobject]@{
                Determined = $true
                Satisfied = $false
                ReasonCode = 'cng_security_descriptor_unreadable_by_local_system'
                Evidence = $evidence
            }
        }
        return [pscustomobject]@{
            Determined = $false
            Satisfied = $false
            ReasonCode = 'cng_security_descriptor_unreadable_by_caller'
            Evidence = $evidence
        }
    }
}

function Test-PrivateKeyExportRejected {
    param([Parameter(Mandatory)][Security.Cryptography.ECDsaCng]$SigningKey)

    # Reading ExportPolicy proves what the key was asked to be. Attempting an
    # export proves what it is. A TPM key that hands over private material has
    # failed the entire point of the ceremony, so every route out is tried and
    # any success is a hard failure. Nothing that comes back is retained or
    # reported - only the fact that it came back at all.
    $attempts = [ordered]@{
        cngEccPrivateBlobRejected = $false
        ecdsaParametersRejected = $false
        pkcs8PrivateKeyRejected = $false
    }
    $leaked = $false

    # $leaked is recorded on the line immediately after each Export returns, and
    # the zeroing moved into finally. With the zeroing before the assignment, a
    # throw from Array.Clear - or from anything else between the two - would land
    # in the catch and record the route as REJECTED, turning a private key that
    # demonstrably left the provider into a PASS. This is the one predicate in
    # the script whose false negative voids the entire ceremony, so the evidence
    # must be written before anything that can fail runs.
    $blob = $null
    try {
        $blob = $SigningKey.Key.Export([Security.Cryptography.CngKeyBlobFormat]::EccPrivateBlob)
        $leaked = $true
    }
    catch { $attempts['cngEccPrivateBlobRejected'] = $true }
    finally { if ($null -ne $blob) { [Array]::Clear($blob, 0, $blob.Length) } }

    try {
        [void]$SigningKey.ExportParameters($true)
        $leaked = $true
    }
    catch { $attempts['ecdsaParametersRejected'] = $true }

    $pkcs8 = $null
    try {
        $pkcs8 = $SigningKey.ExportPkcs8PrivateKey()
        $leaked = $true
    }
    catch { $attempts['pkcs8PrivateKeyRejected'] = $true }
    finally { if ($null -ne $pkcs8) { [Array]::Clear($pkcs8, 0, $pkcs8.Length) } }

    $attempts['everyExportRouteRejected'] = -not $leaked
    return [pscustomobject]@{ Satisfied = -not $leaked; Evidence = $attempts }
}

function Test-CertificateShape {
    param(
        [Parameter(Mandatory)][Security.Cryptography.X509Certificates.X509Certificate2]$Certificate,
        [Parameter(Mandatory)][string]$Purpose,
        [Parameter(Mandatory)][string]$ScopeName
    )

    $now = [DateTime]::UtcNow
    $notBefore = $Certificate.NotBefore.ToUniversalTime()
    $notAfter = $Certificate.NotAfter.ToUniversalTime()
    $withinWindow = $notBefore -le $now -and $notAfter -gt $now
    Add-PredicateCheck -Id 'certificate_validity_window' -ScopeName $ScopeName -Purpose $Purpose `
        -Satisfied $withinWindow `
        -PassReasonCode 'certificate_within_validity_window' `
        -FailReasonCode 'certificate_outside_validity_window' `
        -Evidence ([ordered]@{
            notBeforeUtc = $notBefore.ToString('O')
            notAfterUtc = $notAfter.ToString('O')
            signatureAlgorithm = [string]$Certificate.SignatureAlgorithm.FriendlyName
        })

    # HardwareBackedCertificateSigner.cs:90-95 and the template at
    # DeviceIdentityProvisioner.cs:184-186.
    $ekuExtensions = @($Certificate.Extensions | Where-Object {
        $_ -is [Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]
    })
    $ekuOids = @($ekuExtensions | ForEach-Object { $_.EnhancedKeyUsages } | ForEach-Object { [string]$_.Value })
    $hasClientAuthentication = $ekuOids -ccontains $clientAuthenticationOid
    Add-PredicateCheck -Id 'certificate_eku_client_authentication' -ScopeName $ScopeName -Purpose $Purpose `
        -Satisfied $hasClientAuthentication `
        -PassReasonCode 'certificate_carries_client_authentication_eku' `
        -FailReasonCode 'certificate_lacks_client_authentication_eku' `
        -Evidence ([ordered]@{
            enhancedKeyUsageOids = @($ekuOids)
            requiredOid = $clientAuthenticationOid
        })

    # DeviceIdentityProvisioner.cs:181-183 always emits KeyUsage critical with
    # DigitalSignature, so a certificate from this ceremony has exactly one.
    $keyUsageExtensions = @($Certificate.Extensions | Where-Object {
        $_ -is [Security.Cryptography.X509Certificates.X509KeyUsageExtension]
    })
    $hasDigitalSignature = $keyUsageExtensions.Count -eq 1 -and
        $keyUsageExtensions[0].KeyUsages.HasFlag(
            [Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature)
    Add-PredicateCheck -Id 'certificate_key_usage_digital_signature' -ScopeName $ScopeName -Purpose $Purpose `
        -Satisfied $hasDigitalSignature `
        -PassReasonCode 'certificate_key_usage_permits_digital_signature' `
        -FailReasonCode 'certificate_key_usage_missing_duplicated_or_lacks_digital_signature' `
        -Evidence ([ordered]@{
            keyUsageExtensionCount = $keyUsageExtensions.Count
            keyUsages = if ($keyUsageExtensions.Count -eq 1) { [string]$keyUsageExtensions[0].KeyUsages } else { '' }
        })

    # EgressSupervisorSigningKeys.cs:306-307 and IsolationEvidenceSigner.cs:184-185
    # both refuse a signing certificate that also claims to be a CA.
    $basicConstraints = @($Certificate.Extensions | Where-Object {
        $_ -is [Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]
    })
    $isCertificateAuthority = @($basicConstraints | Where-Object { $_.CertificateAuthority }).Count -ne 0
    Add-PredicateCheck -Id 'certificate_not_certificate_authority' -ScopeName $ScopeName -Purpose $Purpose `
        -Satisfied (-not $isCertificateAuthority) `
        -PassReasonCode 'certificate_is_an_end_entity_certificate' `
        -FailReasonCode 'certificate_asserts_certificate_authority' `
        -Evidence ([ordered]@{
            basicConstraintsExtensionCount = $basicConstraints.Count
            certificateAuthority = $isCertificateAuthority
        })

    # The template at DeviceIdentityProvisioner.cs:176-186 marks BasicConstraints,
    # KeyUsage and EKU all critical. Nothing at startup reads criticality, so this
    # is drift detection rather than a service predicate - but a ceremony that
    # stopped copying the template is worth knowing about before the next one.
    $basicConstraintsCritical = $basicConstraints.Count -eq 1 -and $basicConstraints[0].Critical
    $keyUsageCritical = $keyUsageExtensions.Count -eq 1 -and $keyUsageExtensions[0].Critical
    $ekuCritical = $ekuExtensions.Count -eq 1 -and $ekuExtensions[0].Critical
    $criticalityMatchesTemplate = $basicConstraintsCritical -and $keyUsageCritical -and $ekuCritical
    # NOT_ENFORCED, not FAIL. The comment above says it plainly - nothing at
    # startup reads criticality - and a status that no consuming service can
    # justify must not be able to set CEREMONY_FAILED and exit 3. Drift is worth
    # reporting; it is not worth telling an operator the ceremony is wrong.
    Add-KeyCheck -Id 'certificate_extension_criticality' -ScopeName $ScopeName -Purpose $Purpose `
        -Status $(if ($criticalityMatchesTemplate) { 'PASS' } else { 'NOT_ENFORCED' }) `
        -ReasonCode $(if ($criticalityMatchesTemplate) {
            'certificate_extensions_critical_per_provisioning_template'
        } else {
            'certificate_extension_criticality_deviates_from_provisioning_template_no_service_reads_it'
        }) `
        -Evidence ([ordered]@{
            basicConstraintsCritical = $basicConstraintsCritical
            keyUsageCritical = $keyUsageCritical
            enhancedKeyUsageCritical = $ekuCritical
        })

    # HardwareBackedCertificateSigner.cs:100-102 - the public key itself must be
    # P-256, independently of whatever the private key handle reports.
    $publicKeySize = -1
    $publicKeyAlgorithm = ''
    $publicKey = $null
    $curveProbe = $null
    try {
        $publicKey = [Security.Cryptography.X509Certificates.ECDsaCertificateExtensions]::GetECDsaPublicKey($Certificate)
        if ($null -ne $publicKey) {
            $publicKeySize = $publicKey.KeySize
            $publicKeyAlgorithm = [string]$publicKey.SignatureAlgorithm
            $curveProbe = Test-P256CurveParameters -Key $publicKey
        }
    }
    catch { $publicKeySize = -1 }
    finally { if ($null -ne $publicKey) { $publicKey.Dispose() } }
    if ($null -eq $curveProbe) { $curveProbe = Test-P256CurveParameters -Key $null }

    # KeySize alone is not the predicate. brainpoolP256r1 and secp256k1 both
    # report 256, so the curve itself is asserted here exactly as
    # CertificateStoreEgressAttestationKeyResolver.cs:249-252 asserts it.
    $curveEvidence = $curveProbe.Evidence
    $curveEvidence['keySize'] = $publicKeySize
    $curveEvidence['algorithm'] = $publicKeyAlgorithm
    Add-PredicateCheck -Id 'certificate_public_key_p256' -ScopeName $ScopeName -Purpose $Purpose `
        -Satisfied ($publicKeySize -eq 256 -and $curveProbe.Satisfied) `
        -PassReasonCode 'certificate_public_key_is_ecdsa_p256_on_the_nist_p256_curve' `
        -FailReasonCode 'certificate_public_key_is_not_ecdsa_p256_on_the_nist_p256_curve' `
        -Evidence $curveEvidence
}

# ---------------------------------------------------------------------------
# Inventory
# ---------------------------------------------------------------------------

$inventoryDocument = $null
$inventorySha256 = $null
$inventoryReasonCode = 'inventory_not_supplied'
try {
    if ($PSCmdlet.ParameterSetName -ceq 'InventoryPath') {
        $inventoryItem = Get-Item -LiteralPath $InventoryPath -Force -ErrorAction Stop
        if ($inventoryItem.PSIsContainer -or $inventoryItem.Length -le 0) {
            throw 'inventory is not a non-empty file'
        }
        if ($inventoryItem.Length -gt $maximumInventoryBytes) {
            throw 'inventory is larger than the reviewed maximum'
        }
        $inventorySha256 = (Microsoft.PowerShell.Utility\Get-FileHash -LiteralPath $inventoryItem.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        $inventoryDocument = Get-Content -LiteralPath $inventoryItem.FullName -Raw -Encoding utf8 -ErrorAction Stop |
            Microsoft.PowerShell.Utility\ConvertFrom-Json -Depth 32 -ErrorAction Stop
    }
    else {
        $inventoryDocument = $Inventory
    }
    $inventoryReasonCode = 'inventory_readable'
}
catch {
    $inventoryDocument = $null
    $inventoryReasonCode = 'inventory_unreadable_or_not_json'
}

$purposeEntries = @()
$inventoryUsable = $false
if ($null -ne $inventoryDocument) {
    # Inside its own try. The inventory is operator-authored, so schemaVersion
    # can be any JSON scalar, and [int]'v1' is a TERMINATING error under
    # $ErrorActionPreference = 'Stop'. Unhandled, it killed the run with a raw
    # .NET conversion message, exit 1 - a code this script does not document -
    # and no JSON at all, discarding every check gathered so far. The documented
    # answer for an inventory this script cannot use is exit 4 WITH a report.
    try {
        $declaredSchemaVersion = Get-EntryValue -Entry $inventoryDocument -Name 'schemaVersion'
        $declaredPurposes = Get-EntryValue -Entry $inventoryDocument -Name 'purposes'
        $schemaVersionIsOne = ($declaredSchemaVersion -is [int] -or $declaredSchemaVersion -is [long]) -and
            [long]$declaredSchemaVersion -eq 1

        # Refused BEFORE the shape check, not after it. New-MsaidiziTpmSigningKeys.ps1
        # writes its CEREMONY RECORD with schemaVersion 1 and a 'purposes' array, so
        # the record satisfies the usable-shape test below on every field. Deciding
        # this in the else branch made the refusal unreachable for the one document
        # it names: the ceremony's own output would have been accepted as the
        # operator's declared expectation, and the ceremony would have attested
        # itself. This script verifies a human-authored expected set AGAINST the
        # machine; a document the mint run produced is evidence, never the expectation.
        $looksLikeCeremonyRecord =
            [string](Get-EntryValue -Entry $inventoryDocument -Name 'assessmentType') -ceq
                'MSAIDIZI_TPM_SIGNING_KEY_PROVISIONING' -or
            $null -ne (Get-EntryValue -Entry $inventoryDocument -Name 'objects')

        if ($looksLikeCeremonyRecord) {
            $purposeEntries = @()
            $inventoryUsable = $false
            $inventoryReasonCode = 'inventory_is_a_ceremony_record_not_an_expected_set_inventory'
        }
        elseif ($schemaVersionIsOne -and
            $null -ne $declaredPurposes -and $declaredPurposes -isnot [string] -and
            @($declaredPurposes).Count -gt 0) {
            $purposeEntries = @($declaredPurposes)
            $inventoryUsable = $true
            $inventoryReasonCode = 'inventory_schema_v1_with_at_least_one_purpose'
        }
        else {
            $inventoryReasonCode = 'inventory_schema_version_or_purpose_set_invalid'
        }
    }
    catch {
        $purposeEntries = @()
        $inventoryUsable = $false
        $inventoryReasonCode = 'inventory_schema_version_or_purpose_set_invalid'
    }
}
Add-KeyCheck -Id 'inventory_usable' -ScopeName 'Host' `
    -Status $(if ($inventoryUsable) { 'PASS' } else { 'FAIL' }) `
    -ReasonCode $inventoryReasonCode `
    -Evidence ([ordered]@{
        source = $PSCmdlet.ParameterSetName
        sha256 = $inventorySha256
        purposeCount = @($purposeEntries).Count
    })

# ---------------------------------------------------------------------------
# Host and caller context
# ---------------------------------------------------------------------------

$callerSid = ''
$callerIsLocalSystem = $false
$callerIsAdministrator = $false
try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    try {
        $callerSid = [string]$identity.User
        $systemSid = [Security.Principal.SecurityIdentifier]::new(
            [Security.Principal.WellKnownSidType]::LocalSystemSid, $null)
        $callerIsLocalSystem = $null -ne $identity.User -and $identity.User.Equals($systemSid)
        $callerIsAdministrator = [Security.Principal.WindowsPrincipal]::new($identity).IsInRole(
            [Security.Principal.WindowsBuiltInRole]::Administrator)
    }
    finally { $identity.Dispose() }
}
catch { }

$inventoryArgument = if ($PSCmdlet.ParameterSetName -ceq 'InventoryPath') { $InventoryPath } else { '<inventory path>' }
# Offered as text for the operator to run, never executed here - this script
# writes nothing, and creating a scheduled task would be a write.
$systemContextCommand = "psexec.exe -s -accepteula pwsh.exe -NoProfile -NoLogo -File `"$PSCommandPath`" -InventoryPath `"$inventoryArgument`""

$platformProviderLiteral = [Security.Cryptography.CngProvider]::MicrosoftPlatformCryptoProvider.Provider
$tpmPresent = $false
$tpmReady = $false
$tpm20 = $false
$tpmProbed = $false

if (Test-ScopeSelected 'Host') {
    $onWindows = [Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT
    Add-PredicateCheck -Id 'host_windows_required' -ScopeName 'Host' -Satisfied $onWindows `
        -PassReasonCode 'host_is_windows' `
        -FailReasonCode 'certificate_store_and_cng_predicates_require_windows' `
        -Evidence ([ordered]@{
            platform = [string][Environment]::OSVersion.Platform
            powerShellEdition = [string]$PSVersionTable.PSEdition
            powerShellVersion = [string]$PSVersionTable.PSVersion
        })

    # The provider name is a literal in the services
    # (EgressSupervisorSigningKeys.cs:320-323). Asserting the framework constant
    # still equals that literal keeps this script honest about what it compares.
    $providerLiteralMatches = $platformProviderLiteral -ceq 'Microsoft Platform Crypto Provider'
    Add-PredicateCheck -Id 'host_platform_provider_literal' -ScopeName 'Host' -Satisfied $providerLiteralMatches `
        -PassReasonCode 'platform_provider_literal_matches_service_expectation' `
        -FailReasonCode 'platform_provider_literal_diverged_from_service_expectation' `
        -Evidence ([ordered]@{ provider = $platformProviderLiteral })

    # Same probe as Test-ProductionPrerequisites.ps1:483-497. A host with no TPM
    # is a legitimate outcome to report, not an exception to throw: every
    # hardware-backed predicate below becomes BLOCKED rather than FAIL.
    try {
        if (Get-Command Get-Tpm -ErrorAction SilentlyContinue) {
            $tpm = Get-Tpm -ErrorAction Stop
            $tpmCim = Get-CimInstance -Namespace 'root\CIMV2\Security\MicrosoftTpm' -ClassName Win32_Tpm -ErrorAction Stop
            $tpmPresent = [bool]$tpm.TpmPresent
            $tpmReady = [bool]$tpm.TpmReady
            $tpm20 = [string]$tpmCim.SpecVersion -match '(^|,)2\.0(,|$)'
            $tpmProbed = $true
        }
    }
    catch { }
    $tpmOk = $tpmPresent -and $tpmReady -and $tpm20
    Add-KeyCheck -Id 'host_tpm_2_ready' -ScopeName 'Host' `
        -Status $(if ($tpmOk) { 'PASS' } else { 'BLOCKED' }) `
        -ReasonCode $(if ($tpmOk) { 'tpm_2_present_and_ready' } elseif ($tpmProbed) { 'tpm_2_not_present_ready_or_2_0' } else { 'tpm_state_could_not_be_probed_on_this_host' }) `
        -Evidence ([ordered]@{
            probed = $tpmProbed
            present = $tpmPresent
            ready = $tpmReady
            specification20 = $tpm20
            consequence = 'hardware_backed_private_key_predicates_are_indeterminate_without_a_ready_tpm'
        })

    # An unprivileged caller cannot open LocalMachine stores or machine keys at
    # all, so nothing below it can be evaluated: that is BLOCKED, not a green
    # check printed beside the finding that the context is the wrong one. An
    # Administrator caller is the DESIGNED operator context - it evaluates every
    # certificate-shape and verification-pin predicate determinately, and each
    # private-key predicate it cannot reach reports its own BLOCKED with the
    # remedy - so it stays PASS rather than poisoning a pins-only run.
    Add-KeyCheck -Id 'caller_security_context' -ScopeName 'Host' `
        -Status $(if ($callerIsLocalSystem -or $callerIsAdministrator) { 'PASS' } else { 'BLOCKED' }) `
        -ReasonCode $(if ($callerIsLocalSystem) { 'caller_is_local_system' } elseif ($callerIsAdministrator) { 'caller_is_administrator_not_local_system' } else { 'caller_is_unprivileged' }) `
        -Evidence ([ordered]@{
            userSid = $callerSid
            isLocalSystem = $callerIsLocalSystem
            isAdministrator = $callerIsAdministrator
            consequence = if ($callerIsLocalSystem) {
                'every_predicate_in_this_script_is_evaluable_from_this_context'
            } elseif ($callerIsAdministrator) {
                'private_key_predicates_for_correctly_narrowed_keys_will_report_blocked_from_this_context'
            } else {
                'no_localmachine_store_or_machine_key_predicate_is_evaluable_from_this_context'
            }
            systemContextCommand = $systemContextCommand
        })
}

# ---------------------------------------------------------------------------
# Compile-time service SID pins
# ---------------------------------------------------------------------------

$serviceSidPins = [ordered]@{
    EgressSupervisor = Get-ServiceSidPin `
        -SourceRelativePath 'src\Msaidizi.EgressSupervisor\EgressSupervisorTrustIdentity.cs' `
        -ConstantName 'ServiceSid'
    PrivilegedCommandSupervisor = Get-ServiceSidPin `
        -SourceRelativePath 'src\Msaidizi.PrivilegedCommandSupervisor\Security\SupervisorServiceIdentity.cs' `
        -ConstantName 'RequiredServiceSid'
}
$serviceSidPinsResolved = $serviceSidPins['EgressSupervisor'].Resolved -and
    $serviceSidPins['PrivilegedCommandSupervisor'].Resolved
# No systemContextCommand here, and none on the DACL checks this blocks. The
# SIDs are read out of the service source tree, so when they are unreadable the
# cause is a deployment that shipped installer\scripts without src\ - and
# re-running under psexec as SYSTEM produces the identical answer. Name the paths
# instead; that is the remedy.
$serviceSidRemedy = 'Run this script from a checkout that contains the service source, or copy ' +
    'src\Msaidizi.EgressSupervisor\EgressSupervisorTrustIdentity.cs and ' +
    'src\Msaidizi.PrivilegedCommandSupervisor\Security\SupervisorServiceIdentity.cs ' +
    "alongside it. Searched under: $companionRoot"
Add-KeyCheck -Id 'service_sid_pins_readable' -ScopeName 'Host' `
    -Status $(if ($serviceSidPinsResolved) { 'PASS' } else { 'BLOCKED' }) `
    -ReasonCode $(if ($serviceSidPinsResolved) { 'service_sid_pins_read_from_compile_time_source' } else { 'service_sid_pins_unreadable_from_source' }) `
    -Evidence ([ordered]@{
        egressSupervisor = $serviceSidPins['EgressSupervisor'].ReasonCode
        privilegedCommandSupervisor = $serviceSidPins['PrivilegedCommandSupervisor'].ReasonCode
        consequence = 'cng_dacl_predicate_is_indeterminate_without_the_compile_time_sid'
        remedy = if ($serviceSidPinsResolved) { '' } else { $serviceSidRemedy }
    })

# ---------------------------------------------------------------------------
# Per-purpose verification
# ---------------------------------------------------------------------------

function Invoke-SigningPurposeVerification {
    param(
        [Parameter(Mandatory)][string]$Purpose,
        [Parameter(Mandatory)][string]$Thumbprint,
        [Parameter(Mandatory)][string]$ExpectedSpkiBase64,
        [Parameter(Mandatory)][string]$OwningService
    )

    $scopeName = 'SigningKeys'
    $observedSpkiDigest = $null
    $resolution = Get-UniqueStoreCertificate `
        -StoreName ([Security.Cryptography.X509Certificates.StoreName]::My) `
        -Thumbprint $Thumbprint
    $storeEvidence = [ordered]@{
        store = 'LocalMachine\My'
        validOnly = $true
        matchCount = $resolution.MatchCount
        openFailure = $resolution.Exception
    }
    if (-not $resolution.Determined) { $storeEvidence['systemContextCommand'] = $systemContextCommand }
    Add-KeyCheck -Id 'certificate_unique_valid_match' -ScopeName $scopeName -Purpose $Purpose `
        -Status $(if (-not $resolution.Determined) { 'BLOCKED' } elseif ($resolution.Resolved) { 'PASS' } else { 'FAIL' }) `
        -ReasonCode $(if ($resolution.Resolved) { 'certificate_resolved_exactly_once_in_localmachine_my' } else { $resolution.ReasonCode }) `
        -Evidence $storeEvidence
    if (-not $resolution.Resolved) {
        return [pscustomobject]@{ SpkiSha256 = $null }
    }

    $certificate = $resolution.Certificate
    $signingKey = $null
    # Declared OUTSIDE the try: the catch below reports whichever of these never
    # got to run, and Set-StrictMode would make the catch itself throw if the
    # fault arrived before the assignment.
    $privateKeyIds = @(
        'private_key_provider_platform', 'private_key_size_p256',
        'private_key_machine_scoped', 'private_key_export_policy_none',
        'private_key_algorithm_ecdsa_p256', 'private_key_usage_signing',
        'private_key_export_attempt_rejected', 'private_key_spki_matches_inventory',
        'cng_security_descriptor_exact')
    try {
        Test-CertificateShape -Certificate $certificate -Purpose $Purpose -ScopeName $scopeName

        # From here on every predicate needs the private key handle. Once the
        # ceremony has replaced the DACL with a single service-only ACE, an
        # Administrator is no longer on it, so this open legitimately fails for a
        # correctly provisioned key. That is BLOCKED, not FAIL.
        $keyOpenFailure = ''
        try {
            $signingKey = [Security.Cryptography.X509Certificates.ECDsaCertificateExtensions]::GetECDsaPrivateKey($certificate)
        }
        catch { $keyOpenFailure = $_.Exception.GetType().Name }

        if ($null -eq $signingKey -or $signingKey -isnot [Security.Cryptography.ECDsaCng]) {
            # HasPrivateKey is read off the certificate itself, not through the
            # key handle, so it is answerable from ANY security context. Both
            # consuming services reject a My-store certificate with no private
            # key outright (EgressSupervisorSigningKeys.cs:299-303,
            # IsolationEvidenceSigner.cs:183), so this is a determinate FAIL that
            # calls for a re-mint - not a BLOCKED that trains the operator to go
            # round the psexec loop and come back with the same answer.
            $hasPrivateKey = [bool]$certificate.HasPrivateKey
            $indeterminate = $hasPrivateKey -and -not $callerIsLocalSystem
            $blockedEvidence = [ordered]@{
                hasPrivateKey = $hasPrivateKey
                privateKeyOpened = $false
                openFailure = $keyOpenFailure
                callerIsLocalSystem = $callerIsLocalSystem
                callerIsAdministrator = $callerIsAdministrator
            }
            if ($indeterminate) { $blockedEvidence['systemContextCommand'] = $systemContextCommand }
            else { $blockedEvidence['remedy'] = 'Re-mint this purpose. No re-run in any security context will change this answer.' }
            $notOpenableReason = if (-not $hasPrivateKey) {
                'certificate_carries_no_private_key_and_both_services_reject_it'
            } elseif ($indeterminate) {
                'private_key_not_openable_by_caller_rerun_as_local_system'
            } else {
                'private_key_not_openable_as_ecdsa_cng_by_local_system'
            }
            foreach ($blockedId in $privateKeyIds) {
                Add-KeyCheck -Id $blockedId -ScopeName $scopeName -Purpose $Purpose `
                    -Status $(if ($indeterminate) { 'BLOCKED' } else { 'FAIL' }) `
                    -ReasonCode $notOpenableReason `
                    -Evidence $blockedEvidence
            }
            return [pscustomobject]@{ SpkiSha256 = $null }
        }

        $cngKey = $signingKey.Key
        $providerName = if ($null -ne $cngKey.Provider) { [string]$cngKey.Provider.Provider } else { '' }
        Add-PredicateCheck -Id 'private_key_provider_platform' -ScopeName $scopeName -Purpose $Purpose `
            -Satisfied ($providerName -ceq $platformProviderLiteral) `
            -PassReasonCode 'private_key_held_by_platform_crypto_provider' `
            -FailReasonCode 'private_key_not_held_by_platform_crypto_provider' `
            -Evidence ([ordered]@{ provider = $providerName; expectedProvider = $platformProviderLiteral })

        Add-PredicateCheck -Id 'private_key_size_p256' -ScopeName $scopeName -Purpose $Purpose `
            -Satisfied ($signingKey.KeySize -eq 256 -and $cngKey.KeySize -eq 256) `
            -PassReasonCode 'private_key_is_256_bit' `
            -FailReasonCode 'private_key_is_not_256_bit' `
            -Evidence ([ordered]@{ ecdsaKeySize = $signingKey.KeySize; cngKeySize = $cngKey.KeySize })

        Add-PredicateCheck -Id 'private_key_machine_scoped' -ScopeName $scopeName -Purpose $Purpose `
            -Satisfied ([bool]$cngKey.IsMachineKey) `
            -PassReasonCode 'private_key_is_machine_scoped' `
            -FailReasonCode 'private_key_is_user_scoped' `
            -Evidence ([ordered]@{ isMachineKey = [bool]$cngKey.IsMachineKey })

        # The services demand ExportPolicy == CngExportPolicies.None
        # (EgressSupervisorSigningKeys.cs:324, IsolationEvidenceSigner.cs:194).
        # DeviceIdentityProvisioner.cs:536-540 states it as "all four exportable
        # bits clear"; both are reported so a deviation names itself.
        $exportPolicy = $cngKey.ExportPolicy
        $exportableBits = [Security.Cryptography.CngExportPolicies]::AllowExport -bor
            [Security.Cryptography.CngExportPolicies]::AllowPlaintextExport -bor
            [Security.Cryptography.CngExportPolicies]::AllowArchiving -bor
            [Security.Cryptography.CngExportPolicies]::AllowPlaintextArchiving
        $policyIsNone = $exportPolicy -eq [Security.Cryptography.CngExportPolicies]::None
        $noExportableBits = ([int]$exportPolicy -band [int]$exportableBits) -eq 0
        Add-PredicateCheck -Id 'private_key_export_policy_none' -ScopeName $scopeName -Purpose $Purpose `
            -Satisfied ($policyIsNone -and $noExportableBits) `
            -PassReasonCode 'private_key_export_policy_is_none' `
            -FailReasonCode 'private_key_export_policy_permits_export_or_archiving' `
            -Evidence ([ordered]@{
                exportPolicy = [string]$exportPolicy
                policyIsNone = $policyIsNone
                allFourExportableBitsClear = $noExportableBits
            })

        $algorithmName = if ($null -ne $cngKey.Algorithm) { [string]$cngKey.Algorithm.Algorithm } else { '' }
        $algorithmGroupName = if ($null -ne $cngKey.AlgorithmGroup) { [string]$cngKey.AlgorithmGroup.AlgorithmGroup } else { '' }
        $expectedAlgorithm = [Security.Cryptography.CngAlgorithm]::ECDsaP256.Algorithm
        $expectedAlgorithmGroup = [Security.Cryptography.CngAlgorithmGroup]::ECDsa.AlgorithmGroup
        Add-PredicateCheck -Id 'private_key_algorithm_ecdsa_p256' -ScopeName $scopeName -Purpose $Purpose `
            -Satisfied ($algorithmName -ceq $expectedAlgorithm -and $algorithmGroupName -ceq $expectedAlgorithmGroup) `
            -PassReasonCode 'private_key_algorithm_is_ecdsa_p256' `
            -FailReasonCode 'private_key_algorithm_is_not_ecdsa_p256' `
            -Evidence ([ordered]@{
                algorithm = $algorithmName
                expectedAlgorithm = $expectedAlgorithm
                algorithmGroup = $algorithmGroupName
                expectedAlgorithmGroup = $expectedAlgorithmGroup
            })

        # DeviceIdentityProvisioner.cs:530 - the key must carry the signing usage.
        $signingUsage = ([int]$cngKey.KeyUsage -band
            [int][Security.Cryptography.CngKeyUsages]::Signing) -ne 0
        Add-PredicateCheck -Id 'private_key_usage_signing' -ScopeName $scopeName -Purpose $Purpose `
            -Satisfied $signingUsage `
            -PassReasonCode 'private_key_permits_signing' `
            -FailReasonCode 'private_key_does_not_permit_signing' `
            -Evidence ([ordered]@{ keyUsage = [string]$cngKey.KeyUsage })

        $exportProbe = Test-PrivateKeyExportRejected -SigningKey $signingKey
        Add-PredicateCheck -Id 'private_key_export_attempt_rejected' -ScopeName $scopeName -Purpose $Purpose `
            -Satisfied $exportProbe.Satisfied `
            -PassReasonCode 'every_private_key_export_route_rejected_by_the_provider' `
            -FailReasonCode 'private_key_material_left_the_provider_ceremony_is_void' `
            -Evidence $exportProbe.Evidence

        # The public half is exported and compared to the inventory pin exactly as
        # IsolationEvidenceSigner.cs:201-211 compares its base64, and the digest is
        # produced in the lowercase form the evidence gate requires.
        $spkiMatches = $false
        $spki = $null
        try {
            $spki = $signingKey.ExportSubjectPublicKeyInfo()
            $observedSpkiDigest = Get-Sha256Hex -Bytes $spki
            $spkiMatches = [Convert]::ToBase64String($spki) -ceq $ExpectedSpkiBase64
        }
        catch { $spkiMatches = $false }
        finally { if ($null -ne $spki) { [Array]::Clear($spki, 0, $spki.Length) } }
        Add-PredicateCheck -Id 'private_key_spki_matches_inventory' -ScopeName $scopeName -Purpose $Purpose `
            -Satisfied $spkiMatches `
            -PassReasonCode 'exported_spki_matches_the_inventory_pin' `
            -FailReasonCode 'exported_spki_does_not_match_the_inventory_pin' `
            -Evidence ([ordered]@{
                observedSpkiSha256 = $observedSpkiDigest
                comparedAgainst = 'inventory_subjectPublicKeyInfoBase64'
            })

        if ($OwningService -ceq $noConsumingDaclPredicate) {
            # New-MsaidiziTpmSigningKeys.ps1:978-993 deliberately does not narrow
            # the DACL for these purposes, and no consuming code asserts a
            # descriptor for them. Demanding one here would FAIL a ceremony that
            # did exactly what it was designed to do.
            Add-KeyCheck -Id 'cng_security_descriptor_exact' -ScopeName $scopeName -Purpose $Purpose `
                -Status 'NOT_ENFORCED' -ReasonCode 'dacl_not_applicable_no_consuming_predicate' `
                -Evidence ([ordered]@{
                    owningService = $OwningService
                    rationale = 'No source-pinned service SID and no consuming DACL predicate exist for this purpose, so the ceremony leaves its DACL as minted.'
                })
        }
        elseif (-not $serviceSidPins[$OwningService].Resolved) {
            $sidPin = $serviceSidPins[$OwningService]
            # No systemContextCommand: the SID could not be read out of the
            # service SOURCE TREE, and SYSTEM reads the same absent file.
            Add-KeyCheck -Id 'cng_security_descriptor_exact' -ScopeName $scopeName -Purpose $Purpose `
                -Status 'BLOCKED' -ReasonCode 'owning_service_sid_pin_unresolved' `
                -Evidence ([ordered]@{
                    owningService = $OwningService
                    sourceReason = $sidPin.ReasonCode
                    remedy = $serviceSidRemedy
                })
        }
        else {
            $sidPin = $serviceSidPins[$OwningService]
            $daclProbe = Test-ExactPrivateKeyDescriptor -Key $cngKey -OwningServiceSid $sidPin.Sid
            $daclEvidence = $daclProbe.Evidence
            $daclEvidence['owningService'] = $OwningService
            $daclEvidence['owningServiceSid'] = [string]$sidPin.Sid
            $daclEvidence['callerIsLocalSystem'] = $callerIsLocalSystem
            if (-not $daclProbe.Determined) {
                $daclEvidence['systemContextCommand'] = $systemContextCommand
            }
            Add-KeyCheck -Id 'cng_security_descriptor_exact' -ScopeName $scopeName -Purpose $Purpose `
                -Status $(if (-not $daclProbe.Determined) { 'BLOCKED' } elseif ($daclProbe.Satisfied) { 'PASS' } else { 'FAIL' }) `
                -ReasonCode $daclProbe.ReasonCode -Evidence $daclEvidence
        }
    }
    catch {
        # Every property read above - Provider, KeySize, IsMachineKey,
        # ExportPolicy, Algorithm, AlgorithmGroup, KeyUsage - is an
        # NCryptGetProperty round-trip that throws CryptographicException when
        # the provider does not carry the property. CngKey.KeyUsage in particular
        # has no fallback. Unguarded, one such throw on an oddly-provisioned key
        # killed the run with a raw exception and no JSON - on precisely the
        # malformed key this tool exists to find. Report the predicates that
        # never got to run, and let the report be written.
        $alreadyEmitted = [Collections.Generic.HashSet[string]]::new(
            [string[]]@($checks |
                Where-Object { $_.scope -ceq $scopeName -and $_.purpose -ceq $Purpose } |
                ForEach-Object { [string]$_.id }),
            [StringComparer]::Ordinal)
        $unreadableEvidence = [ordered]@{
            privateKeyOpened = $true
            propertyReadFailure = $_.Exception.GetType().Name
            callerIsLocalSystem = $callerIsLocalSystem
            systemContextCommand = $systemContextCommand
        }
        foreach ($pendingId in $privateKeyIds) {
            if ($alreadyEmitted.Contains($pendingId)) { continue }
            Add-KeyCheck -Id $pendingId -ScopeName $scopeName -Purpose $Purpose `
                -Status 'BLOCKED' -ReasonCode 'private_key_property_unreadable' `
                -Evidence $unreadableEvidence
        }
    }
    finally {
        if ($null -ne $signingKey) { $signingKey.Dispose() }
        $certificate.Dispose()
    }

    return [pscustomobject]@{ SpkiSha256 = $observedSpkiDigest }
}

function Invoke-VerificationPinVerification {
    param(
        [Parameter(Mandatory)][string]$Purpose,
        [Parameter(Mandatory)][string]$Thumbprint,
        [Parameter(Mandatory)][string]$ExpectedSpkiBase64
    )

    $scopeName = 'VerificationPins'
    $observedSpkiDigest = $null
    $resolution = Get-UniqueStoreCertificate `
        -StoreName ([Security.Cryptography.X509Certificates.StoreName]::TrustedPeople) `
        -Thumbprint $Thumbprint
    # LocalMachine\TrustedPeople is the store most likely never to have been
    # created on a fresh host, and OpenExistingOnly throws rather than inventing
    # it. That is BLOCKED - the store was never read - not a FAIL that would say
    # CEREMONY_FAILED about a store nobody has looked in yet.
    $storeEvidence = [ordered]@{
        store = 'LocalMachine\TrustedPeople'
        validOnly = $true
        matchCount = $resolution.MatchCount
        openFailure = $resolution.Exception
    }
    if (-not $resolution.Determined) { $storeEvidence['systemContextCommand'] = $systemContextCommand }
    Add-KeyCheck -Id 'pin_unique_valid_match' -ScopeName $scopeName -Purpose $Purpose `
        -Status $(if (-not $resolution.Determined) { 'BLOCKED' } elseif ($resolution.Resolved) { 'PASS' } else { 'FAIL' }) `
        -ReasonCode $(if ($resolution.Resolved) { 'pin_resolved_exactly_once_in_localmachine_trustedpeople' } else { $resolution.ReasonCode }) `
        -Evidence $storeEvidence
    if (-not $resolution.Resolved) {
        return [pscustomobject]@{ SpkiSha256 = $null }
    }

    $certificate = $resolution.Certificate
    try {
        # PinnedVerificationKeys.cs:85 and EgressActionTokenTrust.cs:40 both return
        # false - silently - when the pinned certificate carries a private key. No
        # exception, no log line: TryResolve simply says "no such key", so every
        # broker action token is rejected for a reason nothing on the box explains.
        # An hour of that is why this one gets a loud, standalone failure.
        $publicOnly = -not $certificate.HasPrivateKey
        Add-PredicateCheck -Id 'pin_certificate_public_only' -ScopeName $scopeName -Purpose $Purpose `
            -Satisfied $publicOnly `
            -PassReasonCode 'pinned_certificate_carries_no_private_key' `
            -FailReasonCode 'pinned_certificate_has_a_private_key_and_silently_disables_the_verifier' `
            -Evidence ([ordered]@{
                hasPrivateKey = [bool]$certificate.HasPrivateKey
                failureMode = 'TryResolve returns false with no exception and no log; every token verified by this key id is rejected with no visible cause'
                remedy = 'reimport the public certificate only, then delete the private-key-bearing copy from LocalMachine\TrustedPeople'
            })

        $now = [DateTime]::UtcNow
        $notBefore = $certificate.NotBefore.ToUniversalTime()
        $notAfter = $certificate.NotAfter.ToUniversalTime()
        Add-PredicateCheck -Id 'pin_certificate_validity_window' -ScopeName $scopeName -Purpose $Purpose `
            -Satisfied ($notBefore -le $now -and $notAfter -gt $now) `
            -PassReasonCode 'pinned_certificate_within_validity_window' `
            -FailReasonCode 'pinned_certificate_outside_validity_window' `
            -Evidence ([ordered]@{ notBeforeUtc = $notBefore.ToString('O'); notAfterUtc = $notAfter.ToString('O') })

        $keySize = -1
        $spkiMatches = $false
        $publicKey = $null
        $curveProbe = $null
        try {
            $publicKey = [Security.Cryptography.X509Certificates.ECDsaCertificateExtensions]::GetECDsaPublicKey($certificate)
            if ($null -ne $publicKey) {
                $keySize = $publicKey.KeySize
                $curveProbe = Test-P256CurveParameters -Key $publicKey
                $spki = $publicKey.ExportSubjectPublicKeyInfo()
                try {
                    $observedSpkiDigest = Get-Sha256Hex -Bytes $spki
                    $spkiMatches = [Convert]::ToBase64String($spki) -ceq $ExpectedSpkiBase64
                }
                finally { [Array]::Clear($spki, 0, $spki.Length) }
            }
        }
        catch { $keySize = -1 }
        finally { if ($null -ne $publicKey) { $publicKey.Dispose() } }
        if ($null -eq $curveProbe) { $curveProbe = Test-P256CurveParameters -Key $null }

        # The private-key path gets the curve for free from the ECDSA_P256
        # ALGORITHM check, which a CNG key either carries or does not. A
        # TrustedPeople pin has no such backstop: KeySize 256 is all that was
        # ever asserted here, and brainpoolP256r1 and secp256k1 both report 256.
        # A wrong-curve pin therefore satisfied every check in this function and
        # then threw at PrivilegedCommandSupervisorOptions.Validate(), before the
        # service reached a resolver that could name the key.
        $curveEvidence = $curveProbe.Evidence
        $curveEvidence['keySize'] = $keySize
        Add-PredicateCheck -Id 'pin_key_size_p256' -ScopeName $scopeName -Purpose $Purpose `
            -Satisfied ($keySize -eq 256 -and $curveProbe.Satisfied) `
            -PassReasonCode 'pinned_public_key_is_ecdsa_p256_on_the_nist_p256_curve' `
            -FailReasonCode 'pinned_public_key_is_not_ecdsa_p256_on_the_nist_p256_curve' `
            -Evidence $curveEvidence

        # PinnedVerificationKeys.cs:94-103 compares the exported SPKI to the
        # configured base64 with FixedTimeEquals before it will hand back a key.
        Add-PredicateCheck -Id 'pin_spki_matches_inventory' -ScopeName $scopeName -Purpose $Purpose `
            -Satisfied $spkiMatches `
            -PassReasonCode 'pinned_spki_matches_the_inventory_pin' `
            -FailReasonCode 'pinned_spki_does_not_match_the_inventory_pin' `
            -Evidence ([ordered]@{
                observedSpkiSha256 = $observedSpkiDigest
                comparedAgainst = 'inventory_subjectPublicKeyInfoBase64'
            })
    }
    finally { $certificate.Dispose() }

    return [pscustomobject]@{ SpkiSha256 = $observedSpkiDigest }
}

$seenPurposeNames = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
$provisionedKeyIds = [Collections.Generic.List[string]]::new()
$provisionedThumbprints = [Collections.Generic.List[string]]::new()
$provisionedSpkiDigests = [Collections.Generic.List[string]]::new()
$unexpectedDeferralCount = 0
# A purpose counts as EXAMINED only where one of the two Invoke-*Verification
# functions actually ran against it. Recording that separately from
# $provisionedKeyIds is what stops a scope-narrowed run from reporting purposes
# it never touched as verified.
$examinedKeyIds = [Collections.Generic.List[string]]::new()
$scopeExcludedPurposeCount = 0
$entryFaultCount = 0

foreach ($entry in $purposeEntries) {
    # The whole body is guarded. Every value below comes from an operator-authored
    # document, and the report is written in one call at the very end, so any
    # unexpected throw in here used to destroy every check already gathered and
    # exit 1 with empty stdout. One malformed entry degrades to one FAIL.
    # Assigned before the try so the catch below can always name the entry, even
    # when the throw came from the very first read of it.
    $purposeName = ''
    try {
        $purposeName = [string](Get-EntryValue -Entry $entry -Name 'purpose')
        $entryState = [string](Get-EntryValue -Entry $entry -Name 'state')
        $entryStore = [string](Get-EntryValue -Entry $entry -Name 'store')
        $entryKeyId = [string](Get-EntryValue -Entry $entry -Name 'keyId')
        $entryOwningService = [string](Get-EntryValue -Entry $entry -Name 'owningService')
        $entryThumbprintRaw = [string](Get-EntryValue -Entry $entry -Name 'certificateThumbprint')
        $entrySpki = [string](Get-EntryValue -Entry $entry -Name 'subjectPublicKeyInfoBase64')
        $entryDeferredReason = [string](Get-EntryValue -Entry $entry -Name 'deferredReason')
        $entryThumbprint = Get-NormalizedThumbprint -Value $entryThumbprintRaw
        if ([string]::IsNullOrWhiteSpace($purposeName)) { $purposeName = "<unnamed:$($seenPurposeNames.Count)>" }

        $purposeUnique = $seenPurposeNames.Add($purposeName)
        $stateValid = $entryState -ceq 'PROVISIONED' -or $entryState -ceq 'DEFERRED'
        $storeValid = $entryStore -ceq 'My' -or $entryStore -ceq 'TrustedPeople'
        # Test-ProductionPrerequisites.ps1:863 - key ids are matched case-sensitively.
        #
        # \A and \z, NOT ^ and $. In .NET, `$` also matches immediately BEFORE a
        # trailing newline, so "reservation-lease-v1`n" satisfied the key-id
        # pattern and a 40-hex thumbprint with a trailing newline satisfied the
        # thumbprint pattern. Both values are rejected by the C# that consumes
        # them - SafeKeyId (PrivilegedCommandSupervisorOptions.cs:273-278) demands
        # every character be alphanumeric or . - _ :, and CanonicalThumbprint
        # (:322-325) demands Length == 40 - and Get-NormalizedThumbprint strips
        # whitespace before the store lookup, so the certificate still resolved
        # and every downstream check PASSED while the supervisor threw
        # "configuration is invalid" at options.Validate(). \z is the only anchor
        # that means end-of-string.
        $keyIdValid = $entryKeyId -cmatch '\A[A-Za-z0-9][A-Za-z0-9._:-]{0,127}\z'
        $owningServiceValid = $entryStore -cne 'My' -or
            $entryOwningService -cin $recognisedOwningServices
        # Test-ProductionPrerequisites.ps1:866 - thumbprints are UPPERCASE hex, and
        # the -cmatch means a lowercase thumbprint fails the gate later even though
        # the certificate store would have found it. Assert the raw inventory text,
        # not the normalized form, or this check would paper over exactly that.
        $thumbprintCaseValid = $entryState -cne 'PROVISIONED' -or
            ($entryThumbprintRaw.Length -eq 40 -and $entryThumbprintRaw -cmatch '\A[0-9A-F]{40}\z')
        $spkiSupplied = $entryState -cne 'PROVISIONED' -or -not [string]::IsNullOrWhiteSpace($entrySpki)
        $deferralExplained = $entryState -cne 'DEFERRED' -or -not [string]::IsNullOrWhiteSpace($entryDeferredReason)
        # An entry using one of the six protocol key ids must be the purpose that key
        # id belongs to (Test-ProductionPrerequisites.ps1:1100-1105 asserts them by
        # string equality, so a swapped pair passes here and detonates there).
        $evidenceGateBound = $true
        if ($evidenceGateKeyIds.Contains($entryKeyId)) {
            $evidenceGateBound = $purposeName -ceq [string]$evidenceGateKeyIds[$entryKeyId]
        }

        $entryValid = $purposeUnique -and $stateValid -and $storeValid -and $keyIdValid -and
            $owningServiceValid -and $thumbprintCaseValid -and $spkiSupplied -and
            $deferralExplained -and $evidenceGateBound
        Add-PredicateCheck -Id 'inventory_entry_valid' -ScopeName 'Host' -Purpose $purposeName `
            -Satisfied $entryValid `
            -PassReasonCode 'inventory_entry_well_formed' `
            -FailReasonCode 'inventory_entry_malformed_or_inconsistent' `
            -Evidence ([ordered]@{
                purposeNameUnique = $purposeUnique
                stateRecognised = $stateValid
                storeRecognised = $storeValid
                keyIdMatchesEvidenceGatePattern = $keyIdValid
                owningServiceRecognised = $owningServiceValid
                thumbprintIsUppercaseHex = $thumbprintCaseValid
                spkiSupplied = $spkiSupplied
                deferralExplained = $deferralExplained
                evidenceGateKeyIdBoundToItsPurpose = $evidenceGateBound
                keyId = $entryKeyId
                store = $entryStore
                state = $entryState
            })

        if (-not $entryValid) {
            $purposeSummaries.Add([pscustomobject][ordered]@{
                purpose = $purposeName
                keyId = $entryKeyId
                store = $entryStore
                state = 'INVALID'
                spkiSha256 = $null
            })
            continue
        }

        # Store-free, and therefore determinate from ANY security context - this
        # is the only P-256 assertion that survives a caller who is not on the
        # key's ACL. PrivilegedCommandSupervisorOptions.CanonicalP256Spki gates
        # all four isolation signing keys and both TrustedPeople verification
        # keys, and an SPKI that fails it throws at options.Validate() before the
        # service ever reaches a resolver, so nothing on the box names the key.
        if ($entryState -ceq 'PROVISIONED') {
            $spkiProbe = Test-CanonicalP256Spki -Base64 $entrySpki
            Add-PredicateCheck -Id 'inventory_spki_canonical_p256' -ScopeName 'Host' -Purpose $purposeName `
                -Satisfied $spkiProbe.Satisfied `
                -PassReasonCode $spkiProbe.ReasonCode `
                -FailReasonCode $spkiProbe.ReasonCode `
                -Evidence $spkiProbe.Evidence
        }

        if ($entryState -ceq 'DEFERRED') {
            # Requirement of the ceremony, not an accident: the four isolation signing
            # purposes cannot be provisioned until the isolation driver exists. They
            # are reported as DEFERRED so that red on this report always means red.
            $deferralExpected = $entryKeyId -cin $driverDependentKeyIds
            if (-not $deferralExpected) { $unexpectedDeferralCount++ }
            Add-KeyCheck -Id 'purpose_deferred' -ScopeName 'Host' -Purpose $purposeName -Status 'DEFERRED' `
                -ReasonCode $(if ($deferralExpected) { 'purpose_deferred_pending_isolation_driver' } else { 'purpose_deferred_by_operator_declaration' }) `
                -Evidence ([ordered]@{
                    keyId = $entryKeyId
                    store = $entryStore
                    deferralExpected = $deferralExpected
                    deferredReason = $entryDeferredReason
                })
            $purposeSummaries.Add([pscustomobject][ordered]@{
                purpose = $purposeName
                keyId = $entryKeyId
                store = $entryStore
                state = 'DEFERRED'
                spkiSha256 = $null
            })
            continue
        }

        $result = $null
        $requiredScope = if ($entryStore -ceq 'My') { 'SigningKeys' } else { 'VerificationPins' }
        $examined = Test-ScopeSelected $requiredScope
        if ($examined) {
            if ($entryStore -ceq 'My') {
                $result = Invoke-SigningPurposeVerification -Purpose $purposeName `
                    -Thumbprint $entryThumbprint -ExpectedSpkiBase64 $entrySpki `
                    -OwningService $entryOwningService
            }
            else {
                $result = Invoke-VerificationPinVerification -Purpose $purposeName `
                    -Thumbprint $entryThumbprint -ExpectedSpkiBase64 $entrySpki
            }
            $examinedKeyIds.Add($entryKeyId)
        }
        else {
            # The gap this closes: control used to fall straight through to the
            # summary below, which recorded the purpose as PROVISIONED with no
            # check object of any kind behind it. With the verdict derived purely
            # from FAIL and BLOCKED counts, a purpose nobody looked at contributed
            # nothing to either, so `-Scope VerificationPins` against an inventory
            # of private signing keys opened no store, probed no key, and reported
            # ceremonyVerified with exit 0. A purpose is verified only when its
            # predicates were evaluated; silence is not a pass.
            $scopeExcludedPurposeCount++
            Add-KeyCheck -Id 'purpose_not_examined_scope_excluded' -ScopeName $requiredScope `
                -Purpose $purposeName -Status 'BLOCKED' `
                -ReasonCode 'purpose_not_examined_because_its_scope_was_not_selected' `
                -Evidence ([ordered]@{
                    keyId = $entryKeyId
                    store = $entryStore
                    requiredScope = $requiredScope
                    selectedScopes = @($selectedScopes | Sort-Object)
                    remedy = "Re-run with -Scope All, or with -Scope $requiredScope, to verify this purpose."
                })
        }

        $provisionedKeyIds.Add($entryKeyId)
        $provisionedThumbprints.Add($entryThumbprintRaw)
        $observedDigest = if ($null -ne $result) { [string]$result.SpkiSha256 } else { $null }
        if (-not [string]::IsNullOrWhiteSpace($observedDigest)) {
            $provisionedSpkiDigests.Add($observedDigest)
        }
        $purposeSummaries.Add([pscustomobject][ordered]@{
            purpose = $purposeName
            keyId = $entryKeyId
            store = $entryStore
            state = if ($examined) { 'PROVISIONED' } else { 'NOT_VERIFIED_SCOPE_EXCLUDED' }
            spkiSha256 = $observedDigest
        })
    }
    catch {
        $entryFaultCount++
        Add-KeyCheck -Id 'inventory_entry_verification_faulted' -ScopeName 'Host' `
            -Purpose $(if ([string]::IsNullOrWhiteSpace($purposeName)) { '<unreadable>' } else { $purposeName }) `
            -Status 'FAIL' -ReasonCode 'inventory_entry_verification_threw_and_was_not_completed' `
            -Evidence ([ordered]@{
                failure = $_.Exception.GetType().Name
                message = [string]$_.Exception.Message
                consequence = 'this_purpose_was_not_verified_the_remaining_entries_still_were'
            })
    }
}

# ---------------------------------------------------------------------------
# Purpose separation
# ---------------------------------------------------------------------------

if (Test-ScopeSelected 'Separation') {
    # EgressSupervisorSigningKeys.cs:62-75 refuses to start when any two key ids
    # or thumbprints coincide, and :397-410 refuses when any two public SPKIs do.
    # Test-ProductionPrerequisites.ps1:871-873 and :1049-1051 assert the same
    # distinctness over the evidence claim.
    $keyIdCount = $provisionedKeyIds.Count
    $keyIdsDistinct = @($provisionedKeyIds | Select-Object -Unique).Count -eq $keyIdCount
    Add-PredicateCheck -Id 'purpose_key_ids_distinct' -ScopeName 'Separation' `
        -Satisfied $keyIdsDistinct `
        -PassReasonCode 'provisioned_key_ids_are_pairwise_distinct' `
        -FailReasonCode 'provisioned_key_ids_are_reused_across_purposes' `
        -Evidence ([ordered]@{ provisionedPurposeCount = $keyIdCount })

    $thumbprintsDistinct = @($provisionedThumbprints | Select-Object -Unique).Count -eq $provisionedThumbprints.Count
    Add-PredicateCheck -Id 'purpose_certificate_thumbprints_distinct' -ScopeName 'Separation' `
        -Satisfied $thumbprintsDistinct `
        -PassReasonCode 'provisioned_certificate_thumbprints_are_pairwise_distinct' `
        -FailReasonCode 'provisioned_certificate_thumbprints_are_reused_across_purposes' `
        -Evidence ([ordered]@{ provisionedPurposeCount = $provisionedThumbprints.Count })

    # Distinct thumbprints do not imply distinct keys: two certificates can carry
    # the same public key. Only comparing the SPKIs proves purpose separation,
    # which is exactly why ArePurposeSeparatedPublicSpkis exists.
    $digestCount = $provisionedSpkiDigests.Count
    $digestsObservedForEveryPurpose = $digestCount -eq $keyIdCount
    $digestsDistinct = @($provisionedSpkiDigests | Select-Object -Unique).Count -eq $digestCount
    # A missing digest has two quite different causes, and only one of them is
    # about privilege. $provisionedSpkiDigests is filled from the two
    # Invoke-*Verification functions, which do not run at all when their scope
    # was not selected - so `-Scope Separation` alone reported "rerun as local
    # system" about a scope the operator simply did not ask for, and re-running
    # under psexec with the same -Scope produced the identical output.
    $keyScopesSelected = @($keyScopeNames | Where-Object { Test-ScopeSelected $_ }).Count -ne 0
    $digestEvidence = [ordered]@{
        provisionedPurposeCount = $keyIdCount
        observedSpkiCount = $digestCount
        keyScopesSelected = $keyScopesSelected
    }
    if (-not $digestsObservedForEveryPurpose -and $keyScopesSelected) {
        $digestEvidence['systemContextCommand'] = $systemContextCommand
    }
    Add-KeyCheck -Id 'purpose_spki_digests_distinct' -ScopeName 'Separation' `
        -Status $(if (-not $digestsObservedForEveryPurpose) { 'BLOCKED' } elseif ($digestsDistinct) { 'PASS' } else { 'FAIL' }) `
        -ReasonCode $(if (-not $digestsObservedForEveryPurpose -and -not $keyScopesSelected) {
            'spki_not_observed_because_the_key_scopes_were_not_selected'
        } elseif (-not $digestsObservedForEveryPurpose) {
            'spki_not_observable_for_every_provisioned_purpose_rerun_as_local_system'
        } elseif ($digestsDistinct) {
            'provisioned_public_spkis_are_pairwise_distinct'
        } else {
            'two_purposes_share_a_public_key'
        }) `
        -Evidence $digestEvidence

    # The gate's case conventions, restated here so a ceremony that produced
    # correct material in the wrong case is caught now rather than at the gate.
    # \A\z again, and an explicit Length alongside it. These two restatements are
    # the last place a trailing newline could slip past into an evidence claim.
    $thumbprintCaseOk = $provisionedThumbprints.Count -eq 0 -or
        @($provisionedThumbprints | Where-Object {
            $_.Length -ne 40 -or $_ -cnotmatch '\A[0-9A-F]{40}\z'
        }).Count -eq 0
    Add-PredicateCheck -Id 'purpose_thumbprint_case_convention' -ScopeName 'Separation' `
        -Satisfied $thumbprintCaseOk `
        -PassReasonCode 'thumbprints_are_uppercase_40_hex_as_the_evidence_gate_requires' `
        -FailReasonCode 'thumbprint_case_or_shape_will_be_rejected_by_the_evidence_gate' `
        -Evidence ([ordered]@{ requiredPattern = '\A[0-9A-F]{40}\z'; comparison = 'case_sensitive' })

    $digestCaseOk = $digestCount -eq 0 -or
        @($provisionedSpkiDigests | Where-Object {
            $_.Length -ne 64 -or $_ -cnotmatch '\A[0-9a-f]{64}\z'
        }).Count -eq 0
    Add-PredicateCheck -Id 'purpose_spki_digest_case_convention' -ScopeName 'Separation' `
        -Satisfied $digestCaseOk `
        -PassReasonCode 'spki_digests_are_lowercase_64_hex_as_the_evidence_gate_requires' `
        -FailReasonCode 'spki_digest_case_or_shape_will_be_rejected_by_the_evidence_gate' `
        -Evidence ([ordered]@{ requiredPattern = '\A[0-9a-f]{64}\z'; comparison = 'case_sensitive' })

    # Every one of the six protocol key ids must be accounted for by the
    # inventory, in one state or the other. Silence is not deferral.
    $inventoryKeyIds = @($purposeEntries | ForEach-Object { [string](Get-EntryValue -Entry $_ -Name 'keyId') })
    $missingEvidenceGateKeyIds = @($evidenceGateKeyIds.Keys | Where-Object { $_ -cnotin $inventoryKeyIds })
    Add-PredicateCheck -Id 'purpose_evidence_gate_key_ids_present' -ScopeName 'Separation' `
        -Satisfied ($missingEvidenceGateKeyIds.Count -eq 0) `
        -PassReasonCode 'every_evidence_gate_key_id_is_accounted_for_by_the_inventory' `
        -FailReasonCode 'inventory_omits_an_evidence_gate_key_id_entirely' `
        -Evidence ([ordered]@{
            requiredKeyIds = @($evidenceGateKeyIds.Keys)
            missingKeyIds = $missingEvidenceGateKeyIds
        })
}

# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------

$failed = @($checks | Where-Object { $_.status -ceq 'FAIL' })
$blocked = @($checks | Where-Object { $_.status -ceq 'BLOCKED' })
$deferred = @($checks | Where-Object { $_.status -ceq 'DEFERRED' })
$passed = @($checks | Where-Object { $_.status -ceq 'PASS' })
$notEnforced = @($checks | Where-Object { $_.status -ceq 'NOT_ENFORCED' })

# Only these BLOCKED causes are fixed by re-running as LOCAL SYSTEM. Every other
# cause - a source tree that was never deployed, a TPM that could not be probed,
# a scope the operator did not select - produces the identical output under
# psexec, so a state string that says RERUN_AS_LOCAL_SYSTEM about them sends the
# operator round a loop that cannot clear. The state is derived from the reason
# codes, not from the count.
$localSystemFixableReasonCodes = [Collections.Generic.HashSet[string]]::new(
    [string[]]@(
        'private_key_not_openable_by_caller_rerun_as_local_system',
        'private_key_property_unreadable',
        'cng_security_descriptor_unreadable_by_caller',
        'certificate_store_unreadable_by_caller',
        'spki_not_observable_for_every_provisioned_purpose_rerun_as_local_system',
        'caller_is_unprivileged'),
    [StringComparer]::Ordinal)
$localSystemFixableBlocked = @($blocked | Where-Object {
    $localSystemFixableReasonCodes.Contains([string]$_.reasonCode)
})

# A purpose is verified only where its predicates were EVALUATED. Deriving the
# verdict from FAIL and BLOCKED counts alone made silence indistinguishable from
# success: a narrow -Scope, or an inventory whose every purpose was DEFERRED,
# contributed nothing to either count and so reported a fully verified ceremony
# with exit 0. unexpectedDeferralCount was computed for exactly this and then
# never consulted, though the header promised a gate could require it to be zero.
$everyProvisionedPurposeExamined = $examinedKeyIds.Count -eq $provisionedKeyIds.Count
$state = if (-not $inventoryUsable) {
    'INVENTORY_UNUSABLE_NOTHING_VERIFIED'
}
elseif ($failed.Count -ne 0) {
    'CEREMONY_FAILED'
}
elseif ($provisionedKeyIds.Count -eq 0) {
    'NO_PROVISIONED_PURPOSE_DECLARED_NOTHING_ATTESTED'
}
elseif (-not $everyProvisionedPurposeExamined) {
    'SCOPE_LIMITED_NOT_EVERY_PROVISIONED_PURPOSE_EXAMINED'
}
elseif ($localSystemFixableBlocked.Count -ne 0) {
    'INDETERMINATE_RERUN_AS_LOCAL_SYSTEM'
}
elseif ($blocked.Count -ne 0) {
    'INDETERMINATE_VERIFIER_INPUTS_MISSING'
}
elseif ($unexpectedDeferralCount -ne 0) {
    'DEFERRED_BEYOND_THE_ISOLATION_DRIVER_DEPENDENCY'
}
else {
    'PROVISIONED_PURPOSES_VERIFIED'
}
$ceremonyVerified = $state -ceq 'PROVISIONED_PURPOSES_VERIFIED'

$report = [ordered]@{
    schemaVersion = 1
    assessmentType = 'MSAIDIZI_TPM_SIGNING_KEY_CEREMONY_VERIFICATION'
    authority = 'NON_AUTHORITATIVE_READ_ONLY_VERIFICATION'
    assessedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    scopes = @($selectedScopes | Sort-Object)
    inventorySha256 = $inventorySha256
    callerContext = [pscustomobject][ordered]@{
        userSid = $callerSid
        isLocalSystem = $callerIsLocalSystem
        isAdministrator = $callerIsAdministrator
        systemContextCommand = $systemContextCommand
    }
    state = $state
    ceremonyVerified = $ceremonyVerified
    productionDeploymentEligible = $false
    provisionedPurposeCount = $provisionedKeyIds.Count
    examinedPurposeCount = $examinedKeyIds.Count
    scopeExcludedPurposeCount = $scopeExcludedPurposeCount
    everyProvisionedPurposeExamined = $everyProvisionedPurposeExamined
    deferredPurposeCount = @($purposeSummaries | Where-Object { $_.state -ceq 'DEFERRED' }).Count
    unexpectedDeferralCount = $unexpectedDeferralCount
    entryFaultCount = $entryFaultCount
    failedCheckCount = $failed.Count
    blockedCheckCount = $blocked.Count
    blockedFixableByLocalSystemCount = $localSystemFixableBlocked.Count
    deferredCheckCount = $deferred.Count
    passedCheckCount = $passed.Count
    notEnforcedCheckCount = $notEnforced.Count
    totalCheckCount = $checks.Count
    nextAuthority = 'The consuming services at startup, and the externally trusted signed deployment evidence gates'
    purposes = @($purposeSummaries)
    checks = @($checks)
}

[Console]::Out.WriteLine(($report | Microsoft.PowerShell.Utility\ConvertTo-Json -Depth 12 -Compress))
if (-not $inventoryUsable) { exit 4 }
if ($failed.Count -ne 0) { exit 3 }
# Exit 0 is reserved for a run that examined every provisioned purpose the
# inventory declares and found nothing wrong. Everything short of that - a
# BLOCKED check, a scope that excluded declared purposes, an inventory with no
# provisioned purpose at all, or a deferral no driver dependency explains - is
# exit 2. $state names which; do not collapse them back into a count.
if (-not $ceremonyVerified) { exit 2 }
exit 0
