using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Contracts.SessionBridge;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Service.Capabilities;

internal static class MsiSoftwareSchemas
{
  public static readonly JsonElement Arguments = Parse(
    """
    {
      "type": "object",
      "properties": {
        "packageId": { "type": "string", "pattern": "^[A-Za-z0-9._-]{1,80}$" }
      },
      "required": ["packageId"],
      "additionalProperties": false
    }
    """);

  public static readonly JsonElement StatusResult = Parse(
    """
    {
      "type": "object",
      "properties": {
        "installed": { "type": "boolean" },
        "version": { "type": ["string", "null"] },
        "stateSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
      },
      "required": ["installed", "version", "stateSha256"],
      "additionalProperties": false
    }
    """);

  public static readonly JsonElement MutationResult = Parse(
    """
    {
      "type": "object",
      "properties": {
        "installed": { "type": "boolean" },
        "version": { "type": ["string", "null"] },
        "rebootRequired": { "type": "boolean" },
        "stateSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
      },
      "required": ["installed", "version", "rebootRequired", "stateSha256"],
      "additionalProperties": false
    }
    """);

  public static CapabilityDescriptor Descriptor(
    string id,
    string name,
    string description,
    CapabilityEffect effect,
    RecoveryKind recovery,
    JsonElement result) => new(
      id,
      "1.0.0",
      name,
      description,
      CapabilityDataClass.Internal,
      effect,
      ConsentRequirement.SignedMandate,
      recovery,
      RequiredPrivilege.LocalSystem,
      IdempotencySemantics.Required,
      ["windows-11-x64"],
      Arguments,
      result,
      ["windows-installer", "signed-installer-package", "host-recovery-record"],
      TouchesTrustedRoot: false);

  public static CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    arguments.ValueKind == JsonValueKind.Object
    && arguments.EnumerateObject().Count() == 1
    && arguments.TryGetProperty("packageId", out var id)
    && id.ValueKind == JsonValueKind.String
    && id.GetString() is { Length: >= 1 and <= 80 }
      ? CapabilityArgumentValidation.Success
      : CapabilityArgumentValidation.Invalid(
        "arguments_schema_invalid",
        "MSI package target is invalid.");

  public static CapabilityArgumentValidation ValidateStatusResult(JsonElement result) =>
    ValidateState(result, requireReboot: false);

  public static CapabilityArgumentValidation ValidateMutationResult(JsonElement result) =>
    ValidateState(result, requireReboot: true);

  private static CapabilityArgumentValidation ValidateState(
    JsonElement result,
    bool requireReboot)
  {
    var expectedCount = requireReboot ? 4 : 3;
    if (result.ValueKind != JsonValueKind.Object
      || result.EnumerateObject().Count() != expectedCount
      || !result.TryGetProperty("installed", out var installed)
      || installed.ValueKind is not (JsonValueKind.True or JsonValueKind.False)
      || !result.TryGetProperty("version", out var version)
      || version.ValueKind is not (JsonValueKind.String or JsonValueKind.Null)
      || !result.TryGetProperty("stateSha256", out var state)
      || state.GetString() is not { } digest
      || !PayloadDigest.IsSha256Hex(digest)
      || (requireReboot
        && (!result.TryGetProperty("rebootRequired", out var reboot)
          || reboot.ValueKind is not (JsonValueKind.True or JsonValueKind.False))))
    {
      return CapabilityArgumentValidation.Invalid(
        "result_schema_invalid",
        "MSI package state result is invalid.");
    }

    return CapabilityArgumentValidation.Success;
  }

  private static JsonElement Parse(string json)
  {
    using var document = JsonDocument.Parse(json);
    return document.RootElement.Clone();
  }
}

internal sealed record AllowedMsiPackage(
  string Id,
  string Path,
  string Sha256,
  string SignerThumbprint,
  string ProductCode,
  bool AllowInstallOrUpdate,
  bool AllowUninstall);

internal sealed class MsiPackagePolicy
{
  private readonly Dictionary<string, AllowedMsiPackage> _packages;

  public MsiPackagePolicy(IOptions<HostCapabilityOptions> options)
  {
    _packages = options.Value.AllowedMsiPackages
      .Select(Validate)
      .ToDictionary(package => package.Id, StringComparer.Ordinal);
  }

  public AllowedMsiPackage Resolve(
    JsonElement arguments,
    bool requireInstall = false,
    bool requireUninstall = false)
  {
    var id = arguments.GetProperty("packageId").GetString()!;
    if (!_packages.TryGetValue(id, out var package)
      || (requireInstall && !package.AllowInstallOrUpdate)
      || (requireUninstall && !package.AllowUninstall))
    {
      throw new HostPreconditionException("msi_package_not_allowed");
    }

    return package;
  }

  private static AllowedMsiPackage Validate(AllowedMsiPackageOptions package)
  {
    var path = Path.GetFullPath(Environment.ExpandEnvironmentVariables(package.InstallerPath));
    if (string.IsNullOrWhiteSpace(package.Id)
      || package.Id.Length > 80
      || package.Id.Any(character => !(char.IsAsciiLetterOrDigit(character)
        || character is '.' or '-' or '_'))
      || !Path.IsPathFullyQualified(path)
      || !string.Equals(Path.GetExtension(path), ".msi", StringComparison.OrdinalIgnoreCase)
      || !PayloadDigest.IsSha256Hex(package.Sha256)
      || NormalizeThumbprint(package.SignerCertificateThumbprint).Length != 40
      || !Guid.TryParseExact(package.ProductCode, "B", out var productCode))
    {
      throw new InvalidOperationException("An allowed MSI package is invalid.");
    }

    return new AllowedMsiPackage(
      package.Id,
      path,
      package.Sha256.ToLowerInvariant(),
      NormalizeThumbprint(package.SignerCertificateThumbprint),
      productCode.ToString("B").ToUpperInvariant(),
      package.AllowInstallOrUpdate,
      package.AllowUninstall);
  }

  private static string NormalizeThumbprint(string value) => value
    .Replace(":", string.Empty, StringComparison.Ordinal)
    .Replace(" ", string.Empty, StringComparison.Ordinal)
    .ToUpperInvariant();
}

internal sealed record MsiProductState(
  bool Installed,
  string? Version,
  string StateSha256);

internal static class MsiSoftwareSupport
{
  private const int InstallStateDefault = 5;
  private const uint ErrorSuccess = 0;
  private const uint ErrorMoreData = 234;

  public static MsiProductState Query(AllowedMsiPackage package)
  {
    var state = MsiQueryProductState(package.ProductCode);
    var installed = state == InstallStateDefault;
    var version = installed ? GetProductInfo(package.ProductCode, "VersionString") : null;
    var canonical = JsonSerializer.Serialize(new { installed, version });
    return new MsiProductState(installed, version, PayloadDigest.Sha256Hex(canonical));
  }

  public static async ValueTask<(MsiProductState State, bool RebootRequired)> InstallAsync(
    GovernedSystemToolRunner runner,
    AllowedMsiPackage package,
    CancellationToken cancellationToken)
  {
    using var packageLock = VerifyAndLockPackage(package);
    var result = await runner.RunAsync(
      GovernedSystemTool.WindowsInstaller,
      ["/i", package.Path, "/qn", "/norestart", "REBOOT=ReallySuppress"],
      65_536,
      cancellationToken).ConfigureAwait(false);
    if (result.ExitCode is not (0 or 3010))
    {
      throw new InvalidOperationException("msi_install_outcome_unknown");
    }

    var state = Query(package);
    if (!state.Installed)
    {
      throw new InvalidOperationException("msi_install_not_observed");
    }

    return (state, result.ExitCode == 3010);
  }

  public static async ValueTask<(MsiProductState State, bool RebootRequired)> UninstallAsync(
    GovernedSystemToolRunner runner,
    AllowedMsiPackage package,
    CancellationToken cancellationToken)
  {
    var result = await runner.RunAsync(
      GovernedSystemTool.WindowsInstaller,
      ["/x", package.ProductCode, "/qn", "/norestart", "REBOOT=ReallySuppress"],
      65_536,
      cancellationToken).ConfigureAwait(false);
    if (result.ExitCode is not (0 or 3010))
    {
      throw new InvalidOperationException("msi_uninstall_outcome_unknown");
    }

    var state = Query(package);
    if (state.Installed)
    {
      throw new InvalidOperationException("msi_uninstall_not_observed");
    }

    return (state, result.ExitCode == 3010);
  }

  private static FileStream VerifyAndLockPackage(AllowedMsiPackage package)
  {
    if (!File.Exists(package.Path)
      || File.GetAttributes(package.Path).HasFlag(FileAttributes.ReparsePoint))
    {
      throw new HostPreconditionException("msi_package_unavailable");
    }

    var stream = new FileStream(
      package.Path,
      FileMode.Open,
      FileAccess.Read,
      FileShare.Read);
    try
    {
      var digest = Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
      if (!SessionBridgeAuthentication.FixedTimeEqualsHex(package.Sha256, digest))
      {
        throw new HostPreconditionException("msi_package_hash_mismatch");
      }

      VerifyAuthenticode(package);
      stream.Position = 0;
      return stream;
    }
    catch
    {
      stream.Dispose();
      throw;
    }
  }

  private static void VerifyAuthenticode(AllowedMsiPackage package)
  {
    var action = new Guid("00AAC56B-CD44-11D0-8CC2-00C04FC295EE");
    var fileInfo = new WinTrustFileInfo(package.Path);
    var data = new WinTrustData(fileInfo);
    try
    {
      if (WinVerifyTrust(IntPtr.Zero, ref action, ref data) != 0)
      {
        throw new HostPreconditionException("msi_authenticode_invalid");
      }

      using var signer = new X509Certificate2(X509Certificate.CreateFromSignedFile(package.Path));
      var thumbprint = signer.Thumbprint
        .Replace(":", string.Empty, StringComparison.Ordinal)
        .Replace(" ", string.Empty, StringComparison.Ordinal)
        .ToUpperInvariant();
      if (!CryptographicOperations.FixedTimeEquals(
        Convert.FromHexString(package.SignerThumbprint),
        Convert.FromHexString(thumbprint)))
      {
        throw new HostPreconditionException("msi_signer_not_allowed");
      }
    }
    finally
    {
      data.Dispose();
      fileInfo.Dispose();
    }
  }

  private static string? GetProductInfo(string productCode, string property)
  {
    var capacity = 0;
    var first = MsiGetProductInfo(productCode, property, null, ref capacity);
    if (first is not (ErrorSuccess or ErrorMoreData))
    {
      return null;
    }

    var buffer = new char[checked(capacity + 1)];
    var result = MsiGetProductInfo(productCode, property, buffer, ref capacity);
    return result == ErrorSuccess
      ? new string(buffer, 0, Math.Min(capacity, buffer.Length))
      : null;
  }

  [DllImport("msi.dll", CharSet = CharSet.Unicode)]
  private static extern int MsiQueryProductState(string productCode);

  [DllImport("msi.dll", CharSet = CharSet.Unicode)]
  private static extern uint MsiGetProductInfo(
    string productCode,
    string property,
    [Out] char[]? valueBuffer,
    ref int valueBufferSize);

  [DllImport("wintrust.dll", ExactSpelling = true, PreserveSig = true)]
  private static extern int WinVerifyTrust(
    IntPtr window,
    ref Guid actionId,
    ref WinTrustData data);

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private sealed class WinTrustFileInfo : IDisposable
  {
    private readonly IntPtr _filePath;
    public uint StructSize = checked((uint)Marshal.SizeOf<WinTrustFileInfo>());
    public IntPtr FilePath;
    public IntPtr FileHandle = IntPtr.Zero;
    public IntPtr KnownSubject = IntPtr.Zero;

    public WinTrustFileInfo(string filePath)
    {
      _filePath = Marshal.StringToCoTaskMemUni(filePath);
      FilePath = _filePath;
    }

    public void Dispose() => Marshal.FreeCoTaskMem(_filePath);
  }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct WinTrustData : IDisposable
  {
    public uint StructSize;
    public IntPtr PolicyCallbackData;
    public IntPtr SipClientData;
    public uint UiChoice;
    public uint RevocationChecks;
    public uint UnionChoice;
    public IntPtr FileInfo;
    public uint StateAction;
    public IntPtr StateData;
    public IntPtr UrlReference;
    public uint ProviderFlags;
    public uint UiContext;

    public WinTrustData(WinTrustFileInfo fileInfo)
    {
      StructSize = checked((uint)Marshal.SizeOf<WinTrustData>());
      PolicyCallbackData = IntPtr.Zero;
      SipClientData = IntPtr.Zero;
      UiChoice = 2;
      RevocationChecks = 0;
      UnionChoice = 1;
      FileInfo = Marshal.AllocCoTaskMem(Marshal.SizeOf<WinTrustFileInfo>());
      Marshal.StructureToPtr(fileInfo, FileInfo, fDeleteOld: false);
      StateAction = 0;
      StateData = IntPtr.Zero;
      UrlReference = IntPtr.Zero;
      ProviderFlags = 0x00001000;
      UiContext = 0;
    }

    public void Dispose()
    {
      if (FileInfo != IntPtr.Zero)
      {
        Marshal.DestroyStructure<WinTrustFileInfo>(FileInfo);
        Marshal.FreeCoTaskMem(FileInfo);
        FileInfo = IntPtr.Zero;
      }
    }
  }
}

internal sealed class MsiSoftwareStatusCapabilityAdapter(
  MsiPackagePolicy policy) : IHostCapabilityAdapter
{
  public CapabilityDescriptor Descriptor { get; } = MsiSoftwareSchemas.Descriptor(
    "software.msi.status",
    "Read approved MSI product status",
    "Reads installed state and version for one supervisor-approved MSI product code.",
    CapabilityEffect.LocalRead,
    RecoveryKind.NotApplicable,
    MsiSoftwareSchemas.StatusResult);

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    MsiSoftwareSchemas.ValidateArguments(arguments);

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    MsiSoftwareSchemas.ValidateStatusResult(result);

  public ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    var package = policy.Resolve(arguments);
    var state = MsiSoftwareSupport.Query(package);
    return ValueTask.FromResult(Result(package, state, mutation: false));
  }

  internal static CapabilityExecutionResult Result(
    AllowedMsiPackage package,
    MsiProductState state,
    bool mutation,
    bool rebootRequired = false,
    HostRecoveryReceipt? recovery = null,
    string? preState = null)
  {
    var output = mutation
      ? JsonSerializer.Serialize(new
      {
        installed = state.Installed,
        version = state.Version,
        rebootRequired,
        stateSha256 = state.StateSha256,
      })
      : JsonSerializer.Serialize(new
      {
        installed = state.Installed,
        version = state.Version,
        stateSha256 = state.StateSha256,
      });
    var provenance = new List<DataProvenance>
    {
      new(
        "windows-installer",
        PayloadDigest.Sha256Hex(package.ProductCode),
        state.StateSha256,
        ProvenanceTrust.TrustedSystem,
        DateTimeOffset.UtcNow),
    };
    if (mutation)
    {
      provenance.Add(new DataProvenance(
        "signed-installer-package",
        PayloadDigest.Sha256Hex(package.Id),
        package.Sha256,
        ProvenanceTrust.TrustedSystem,
        DateTimeOffset.UtcNow));
    }

    if (recovery is not null)
    {
      provenance.Add(RegistryValueSetCapabilityAdapter.RecoveryProvenance(recovery));
    }

    return new CapabilityExecutionResult(
      output,
      MutationCommitted: mutation,
      OutcomeUncertain: false,
      Provenance: provenance,
      OpaqueRecoveryHandle: recovery?.OpaqueHandle,
      PreStateSha256: preState ?? state.StateSha256,
      RecoveryProvenanceSha256: recovery?.RecordSha256);
  }
}

internal sealed class MsiSoftwareInstallCapabilityAdapter(
  MsiPackagePolicy policy,
  IHostRecoveryVault recoveryVault,
  GovernedSystemToolRunner runner) : IHostCapabilityAdapter
{
  internal const string CapabilityId = "software.msi.install-or-update";

  public CapabilityDescriptor Descriptor { get; } = MsiSoftwareSchemas.Descriptor(
    CapabilityId,
    "Install or update approved MSI package",
    "Installs or updates one exact hash- and signer-pinned MSI package without rebooting.",
    CapabilityEffect.Irreversible,
    RecoveryKind.Irreversible,
    MsiSoftwareSchemas.MutationResult);

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    MsiSoftwareSchemas.ValidateArguments(arguments);

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    MsiSoftwareSchemas.ValidateMutationResult(result);

  public async ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    RegistryValueSetCapabilityAdapter.RequireExpectedState(context);
    var package = policy.Resolve(arguments, requireInstall: true);
    var before = MsiSoftwareSupport.Query(package);
    RegistryValueSetCapabilityAdapter.MatchExpected(context, before.StateSha256);
    var recovery = await recoveryVault.PrepareAsync(
      context,
      Descriptor.Id,
      before.StateSha256,
      new { package.Id, package.ProductCode, before.Installed, before.Version },
      irreversible: true,
      cancellationToken).ConfigureAwait(false);
    var installed = await MsiSoftwareSupport.InstallAsync(runner, package, cancellationToken)
      .ConfigureAwait(false);
    return MsiSoftwareStatusCapabilityAdapter.Result(
      package,
      installed.State,
      mutation: true,
      installed.RebootRequired,
      recovery,
      before.StateSha256);
  }
}

internal sealed class MsiSoftwareUninstallCapabilityAdapter(
  MsiPackagePolicy policy,
  IHostRecoveryVault recoveryVault,
  GovernedSystemToolRunner runner) : IHostCapabilityAdapter
{
  internal const string CapabilityId = "software.msi.uninstall";

  public CapabilityDescriptor Descriptor { get; } = MsiSoftwareSchemas.Descriptor(
    CapabilityId,
    "Uninstall approved MSI package",
    "Uninstalls one supervisor-approved MSI product code without rebooting.",
    CapabilityEffect.Irreversible,
    RecoveryKind.Irreversible,
    MsiSoftwareSchemas.MutationResult);

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    MsiSoftwareSchemas.ValidateArguments(arguments);

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    MsiSoftwareSchemas.ValidateMutationResult(result);

  public async ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    RegistryValueSetCapabilityAdapter.RequireExpectedState(context);
    var package = policy.Resolve(arguments, requireUninstall: true);
    var before = MsiSoftwareSupport.Query(package);
    if (!before.Installed)
    {
      throw new HostPreconditionException("msi_product_not_installed");
    }

    RegistryValueSetCapabilityAdapter.MatchExpected(context, before.StateSha256);
    var recovery = await recoveryVault.PrepareAsync(
      context,
      Descriptor.Id,
      before.StateSha256,
      new { package.Id, package.ProductCode, before.Version },
      irreversible: true,
      cancellationToken).ConfigureAwait(false);
    var uninstalled = await MsiSoftwareSupport.UninstallAsync(
      runner,
      package,
      cancellationToken)
      .ConfigureAwait(false);
    return MsiSoftwareStatusCapabilityAdapter.Result(
      package,
      uninstalled.State,
      mutation: true,
      uninstalled.RebootRequired,
      recovery,
      before.StateSha256);
  }
}
