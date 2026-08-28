using System.Security.Cryptography;
using System.IO;
using System.ComponentModel;
using System.Runtime.ExceptionServices;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Agent.Configuration;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Microsoft.Extensions.Options;
using Microsoft.Win32.SafeHandles;

namespace Itemba.Msaidizi.Companion.Agent.Capabilities;

public sealed class BrowserFormTextSetCapabilityAdapter(
  InteractiveStaDispatcher dispatcher,
  InteractiveTargetPolicy targets) : IHostCapabilityAdapter
{
  public CapabilityDescriptor Descriptor => StandardUserCapabilityCatalog.BrowserFormTextSet;

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    StandardUserCapabilityContractValidator.ValidateArguments(Descriptor.Id, arguments);

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    StandardUserCapabilityContractValidator.ValidateResult(Descriptor.Id, result);

  public async ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    if (!PayloadDigest.IsSha256Hex(context.ExpectedPreStateSha256 ?? string.Empty))
    {
      throw new InvalidOperationException("expected_pre_state_required");
    }

    var origin = targets.ValidateBrowserOriginDigest(arguments);
    var originId = origin.OriginId;
    var originSha256 = origin.OriginSha256;
    var processId = arguments.GetProperty("processId").GetInt32();
    var automationId = arguments.GetProperty("automationId").GetString()!;
    var contentClass = arguments.GetProperty("contentClass").GetString()!;
    var value = arguments.GetProperty("text").GetString()!;
    var set = await dispatcher.InvokeAsync(
      () => UiAutomationSupport.SetValueForeground(
        targets,
        processId,
        automationId,
        context.ExpectedPreStateSha256!,
        value),
      cancellationToken).ConfigureAwait(false);
    var destinationScope = PayloadDigest.Sha256Hex(string.Join('\n',
      "itemba-browser-text-destination-v1",
      originId,
      originSha256,
      automationId,
      contentClass));
    var contentSha256 = PayloadDigest.Sha256Hex(value);
    return new CapabilityExecutionResult(
      JsonSerializer.Serialize(new
      {
        set,
        contentSha256,
        destinationScopeSha256 = destinationScope,
      }),
      MutationCommitted: set,
      // Browser fields can auto-submit, search, or trigger remote validation.
      OutcomeUncertain: true,
      Provenance:
      [
        new DataProvenance(
          "browser-ui-text-action",
          contentSha256,
          destinationScope,
          ProvenanceTrust.UntrustedContent,
          DateTimeOffset.UtcNow),
      ],
      PreStateSha256: context.ExpectedPreStateSha256);
  }
}

public sealed class BrowserFormSecretSetCapabilityAdapter(
  InteractiveStaDispatcher dispatcher,
  InteractiveTargetPolicy targets,
  SessionSecretAccessor secrets) : IHostCapabilityAdapter
{
  public CapabilityDescriptor Descriptor => StandardUserCapabilityCatalog.BrowserFormSecretSet;

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    StandardUserCapabilityContractValidator.ValidateArguments(Descriptor.Id, arguments);

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    StandardUserCapabilityContractValidator.ValidateResult(Descriptor.Id, result);

  public ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken) => BrowserSecretAction.ExecuteAsync(
      Descriptor,
      context,
      arguments,
      "value",
      dispatcher,
      targets,
      secrets,
      uploadRootId: null,
      cancellationToken);
}

public sealed class BrowserFileUploadCapabilityAdapter(
  InteractiveStaDispatcher dispatcher,
  InteractiveTargetPolicy targets,
  SessionSecretAccessor secrets,
  BrowserArtifactQuarantine artifactQuarantine) : IHostCapabilityAdapter
{
  public CapabilityDescriptor Descriptor => StandardUserCapabilityCatalog.BrowserFileUpload;

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    StandardUserCapabilityContractValidator.ValidateArguments(Descriptor.Id, arguments);

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    StandardUserCapabilityContractValidator.ValidateResult(Descriptor.Id, result);

  public ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken) => arguments.TryGetProperty("artifact", out _)
      ? BrowserArtifactUploadAction.ExecuteAsync(
        Descriptor,
        context,
        arguments,
        dispatcher,
        targets,
        artifactQuarantine,
        cancellationToken)
      : BrowserSecretAction.ExecuteAsync(
        Descriptor,
        context,
        arguments,
        "file-path",
        dispatcher,
        targets,
        secrets,
        arguments.GetProperty("uploadRootId").GetString(),
        cancellationToken);
}

public sealed class BrowserDownloadInvokeCapabilityAdapter(
  InteractiveStaDispatcher dispatcher,
  InteractiveTargetPolicy targets) : IHostCapabilityAdapter
{
  public CapabilityDescriptor Descriptor => StandardUserCapabilityCatalog.BrowserDownloadInvoke;

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    StandardUserCapabilityContractValidator.ValidateArguments(Descriptor.Id, arguments);

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    StandardUserCapabilityContractValidator.ValidateResult(Descriptor.Id, result);

  public async ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    if (!PayloadDigest.IsSha256Hex(context.ExpectedPreStateSha256 ?? string.Empty))
    {
      throw new InvalidOperationException("expected_pre_state_required");
    }

    var origin = targets.ValidateBrowserOriginDigest(arguments);
    var originId = origin.OriginId;
    var originSha256 = origin.OriginSha256;
    var processId = arguments.GetProperty("processId").GetInt32();
    var automationId = arguments.GetProperty("automationId").GetString()!;
    var controlType = arguments.GetProperty("controlType").GetString()!;
    _ = await dispatcher.InvokeAsync(
      () => UiAutomationSupport.InvokeForeground(
        targets,
        processId,
        automationId,
        controlType,
        context.ExpectedPreStateSha256!),
      cancellationToken).ConfigureAwait(false);
    var destinationScope = PayloadDigest.Sha256Hex(string.Join('\n',
      "itemba-browser-download-destination-v1",
      originId,
      originSha256,
      automationId,
      controlType));
    return new CapabilityExecutionResult(
      JsonSerializer.Serialize(new
      {
        dispatched = true,
        destinationScopeSha256 = destinationScope,
      }),
      MutationCommitted: true,
      OutcomeUncertain: true,
      Provenance:
      [
        new DataProvenance(
          "browser-ui-download-action",
          PayloadDigest.Sha256Hex($"process:{processId}"),
          destinationScope,
          ProvenanceTrust.UntrustedContent,
          DateTimeOffset.UtcNow),
      ],
      PreStateSha256: context.ExpectedPreStateSha256);
  }
}

internal static class BrowserSecretAction
{
  private const int MaximumSecretUtf8Bytes = 32_768;

  public static ValueTask<CapabilityExecutionResult> ExecuteAsync(
    CapabilityDescriptor descriptor,
    ActionExecutionContext context,
    JsonElement arguments,
    string bindingId,
    InteractiveStaDispatcher dispatcher,
    InteractiveTargetPolicy targets,
    SessionSecretAccessor secrets,
    string? uploadRootId,
    CancellationToken cancellationToken)
  {
    if (!PayloadDigest.IsSha256Hex(context.ExpectedPreStateSha256 ?? string.Empty))
    {
      throw new InvalidOperationException("expected_pre_state_required");
    }

    var requirement = BrowserSecretDestination.Resolve(descriptor.Id, arguments)
      ?? throw new InvalidOperationException("browser_secret_requirement_missing");
    if (!string.Equals(requirement.BindingId, bindingId, StringComparison.Ordinal))
    {
      throw new InvalidOperationException("browser_secret_binding_mismatch");
    }
    var origin = targets.ValidateBrowserOriginDigest(arguments);
    var processId = arguments.GetProperty("processId").GetInt32();
    var automationId = arguments.GetProperty("automationId").GetString()!;
    return secrets.UseAsync(
      context.ActionId,
      bindingId,
      async (secret, callbackCancellation) =>
      {
        if (secret.Length is <= 0 or > MaximumSecretUtf8Bytes)
        {
          throw new InvalidOperationException("browser_secret_length_invalid");
        }

        bool set;
        if (uploadRootId is null)
        {
          set = await dispatcher.InvokeAsync(
            () => SensitiveUtf8.Use(secret, value =>
              UiAutomationSupport.SetValueForeground(
                targets,
                processId,
                automationId,
                context.ExpectedPreStateSha256!,
                value)),
            callbackCancellation).ConfigureAwait(false);
        }
        else
        {
          set = await dispatcher.InvokeAsync(
            () => SensitiveUtf8.Use(secret, value =>
            {
              using var approved = targets.OpenUploadFile(uploadRootId, value);
              if (approved.Length > context.Budgets.MaxLocalBytes)
              {
                throw new InvalidOperationException("browser_upload_file_budget_exceeded");
              }
              return UiAutomationSupport.SetValueForeground(
                targets,
                processId,
                automationId,
                context.ExpectedPreStateSha256!,
                approved.Path);
            }),
            callbackCancellation).ConfigureAwait(false);
        }

        var output = JsonSerializer.Serialize(new
        {
          set,
          secretReferenceSha256 = PayloadDigest.Sha256Hex(requirement.ReferenceId),
          destinationScopeSha256 = requirement.DestinationScopeSha256,
        });
        return new CapabilityExecutionResult(
          output,
          MutationCommitted: set,
          // Browser fields may auto-submit or begin an upload immediately.
          OutcomeUncertain: true,
          Provenance:
          [
            new DataProvenance(
              descriptor.Id == "browser.file.upload"
                ? "browser-ui-file-action"
                : "browser-ui-secret-action",
              PayloadDigest.Sha256Hex($"process:{processId}"),
              requirement.DestinationScopeSha256,
              ProvenanceTrust.AuthenticatedRemote,
              DateTimeOffset.UtcNow),
          ],
          PreStateSha256: context.ExpectedPreStateSha256);
      },
      cancellationToken);
  }
}

internal static class BrowserArtifactUploadAction
{
  private const int ResultEgressReserveBytes = 1_024;

  public static async ValueTask<CapabilityExecutionResult> ExecuteAsync(
    CapabilityDescriptor descriptor,
    ActionExecutionContext context,
    JsonElement arguments,
    InteractiveStaDispatcher dispatcher,
    InteractiveTargetPolicy targets,
    BrowserArtifactQuarantine quarantine,
    CancellationToken cancellationToken)
  {
    if (!PayloadDigest.IsSha256Hex(context.ExpectedPreStateSha256 ?? string.Empty)
      || descriptor.Id != "browser.file.upload"
      || !arguments.TryGetProperty("artifact", out var artifactValue)
      || !GovernedArtifactEnvelope.TryDecode(
        artifactValue,
        context,
        requiredKind: "SCREENSHOT",
        out var artifact,
        out var content))
    {
      throw new InvalidOperationException("browser_artifact_envelope_invalid");
    }

    try
    {
      if (content.LongLength > context.Budgets.MaxLocalBytes
        || content.LongLength > context.Budgets.MaxExternalEgressBytes
          - ResultEgressReserveBytes)
      {
        throw new InvalidOperationException("browser_artifact_upload_budget_exceeded");
      }
      var origin = targets.ValidateBrowserOriginDigest(arguments);
      var processId = arguments.GetProperty("processId").GetInt32();
      var automationId = arguments.GetProperty("automationId").GetString()!;
      var destinationScope = PayloadDigest.Sha256Hex(string.Join('\n',
        "itemba-browser-artifact-destination-v1",
        origin.OriginId,
        origin.OriginSha256,
        automationId,
        artifact.ScopeSha256));
      var use = await quarantine.UseAsync(
        context.ActionId,
        artifact,
        content,
        path => new ValueTask<bool>(dispatcher.InvokeAsync(
          () => UiAutomationSupport.SetValueForeground(
            targets,
            processId,
            automationId,
            context.ExpectedPreStateSha256!,
            path),
          cancellationToken)),
        cancellationToken).ConfigureAwait(false);
      return new CapabilityExecutionResult(
        JsonSerializer.Serialize(new
        {
          set = use.Value,
          artifactSha256 = artifact.Sha256,
          destinationScopeSha256 = destinationScope,
          quarantineCleanupConfirmed = use.CleanupConfirmed,
        }),
        MutationCommitted: use.Value,
        OutcomeUncertain: true,
        Provenance:
        [
          new DataProvenance(
            "governed-artifact-upload",
            artifact.ScopeSha256,
            artifact.Sha256,
            ProvenanceTrust.UntrustedContent,
            DateTimeOffset.UtcNow),
          new DataProvenance(
            "browser-ui-file-action",
            artifact.ScopeSha256,
            destinationScope,
            ProvenanceTrust.UntrustedContent,
            DateTimeOffset.UtcNow),
        ],
        PreStateSha256: context.ExpectedPreStateSha256,
        LocalBytesWritten: content.LongLength,
        // LocalSystem independently derives the same floor from the signed
        // artifact envelope before settling the supervisor receipt. This
        // standard-user report is measurement input, never terminal evidence.
        ExternalEgressBytes: content.LongLength);
    }
    finally
    {
      CryptographicOperations.ZeroMemory(content);
    }
  }
}

internal sealed record BrowserArtifactUseResult<T>(T Value, bool CleanupConfirmed);

public sealed class BrowserArtifactQuarantine
{
  private const uint GenericRead = 0x80000000;
  private const uint GenericWrite = 0x40000000;
  private const uint DeleteAccess = 0x00010000;
  private const uint FileReadAttributes = 0x00000080;
  private const uint ShareRead = 0x00000001;
  private const uint ShareWrite = 0x00000002;
  private const uint ShareDelete = 0x00000004;
  private const uint CreateNew = 1;
  private const uint OpenExisting = 3;
  private const uint AttributeNormal = 0x00000080;
  private const uint FlagWriteThrough = 0x80000000;
  private const uint FlagOverlapped = 0x40000000;
  private const uint FlagBackupSemantics = 0x02000000;
  private const uint FlagOpenReparsePoint = 0x00200000;
  private readonly string _root;
  private readonly bool _requireHardenedAcl;

  public BrowserArtifactQuarantine(IOptions<AgentOptions> options)
    : this(options.Value.ArtifactQuarantineRoot, requireHardenedAcl: true)
  {
  }

  internal BrowserArtifactQuarantine(string root, bool requireHardenedAcl)
  {
    if (!OperatingSystem.IsWindows())
    {
      throw new PlatformNotSupportedException("Browser artifact quarantine requires Windows.");
    }
    var expanded = Environment.ExpandEnvironmentVariables(root ?? string.Empty);
    if (string.IsNullOrWhiteSpace(expanded)
      || expanded.StartsWith("\\\\", StringComparison.Ordinal)
      || expanded.StartsWith("\\\\?\\", StringComparison.Ordinal))
    {
      throw new InvalidOperationException("browser_artifact_quarantine_root_invalid");
    }
    _root = Path.TrimEndingDirectorySeparator(Path.GetFullPath(expanded));
    _requireHardenedAcl = requireHardenedAcl;
  }

  public bool IsReady(out string statusCode)
  {
    try
    {
      using var rootHandle = OpenVerifiedDirectory(_root, includeDeleteAccess: false);
      if (_requireHardenedAcl) ValidateHardenedRootAcl(_root);
      statusCode = "READY";
      return true;
    }
    catch
    {
      statusCode = "ARTIFACT_QUARANTINE_NOT_PROVISIONED";
      return false;
    }
  }

  internal async ValueTask<BrowserArtifactUseResult<T>> UseAsync<T>(
    string actionId,
    GovernedArtifactDescriptor artifact,
    ReadOnlyMemory<byte> content,
    Func<string, ValueTask<T>> consumer,
    CancellationToken cancellationToken)
  {
    if (!Guid.TryParseExact(actionId, "D", out _)
      || artifact.Kind != "SCREENSHOT"
      || artifact.MimeType != "image/png"
      || content.Length != artifact.ByteSize)
    {
      throw new InvalidOperationException("browser_artifact_quarantine_binding_invalid");
    }
    using var rootHandle = OpenVerifiedDirectory(_root, includeDeleteAccess: false);
    if (_requireHardenedAcl) ValidateHardenedRootAcl(_root);

    var actionDirectory = Path.GetFullPath(Path.Combine(_root, Guid.NewGuid().ToString("N")));
    var file = Path.GetFullPath(Path.Combine(actionDirectory, $"{artifact.ArtifactId}.png"));
    if (!actionDirectory.StartsWith(_root + Path.DirectorySeparatorChar,
        StringComparison.OrdinalIgnoreCase)
      || !file.StartsWith(actionDirectory + Path.DirectorySeparatorChar,
        StringComparison.OrdinalIgnoreCase))
    {
      throw new InvalidOperationException("browser_artifact_quarantine_path_invalid");
    }

    Directory.CreateDirectory(actionDirectory);
    using var actionDirectoryHandle = OpenVerifiedDirectory(
      actionDirectory,
      includeDeleteAccess: true);
    FileStream? stream = null;
    FileIdentity identity = default;
    T value = default!;
    ExceptionDispatchInfo? failure = null;
    var consumerCompleted = false;
    var cleanupConfirmed = false;
    try
    {
      stream = CreateBoundFile(file);
      identity = ReadIdentity(stream.SafeFileHandle);
      await stream.WriteAsync(content, cancellationToken).ConfigureAwait(false);
      await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
      stream.Flush(flushToDisk: true);
      try
      {
        value = await consumer(file).ConfigureAwait(false);
        consumerCompleted = true;
      }
      catch (Exception error)
      {
        failure = ExceptionDispatchInfo.Capture(error);
      }
    }
    catch (Exception error)
    {
      failure ??= ExceptionDispatchInfo.Capture(error);
    }
    finally
    {
      cleanupConfirmed = await TrySecureDeleteBoundFileAsync(
        stream,
        file,
        identity,
        content.Length).ConfigureAwait(false);
      if (cleanupConfirmed)
      {
        cleanupConfirmed = TryMarkDeleteOnClose(actionDirectoryHandle);
      }
    }
    failure?.Throw();
    if (!consumerCompleted)
      throw new InvalidOperationException("browser_artifact_consumer_did_not_complete");
    return new BrowserArtifactUseResult<T>(value, cleanupConfirmed);
  }

  private static FileStream CreateBoundFile(string path)
  {
    var handle = CreateFileW(
      path,
      GenericRead | GenericWrite,
      ShareRead,
      IntPtr.Zero,
      CreateNew,
      AttributeNormal | FlagWriteThrough | FlagOverlapped | FlagOpenReparsePoint,
      IntPtr.Zero);
    if (handle.IsInvalid)
    {
      var error = Marshal.GetLastWin32Error();
      handle.Dispose();
      throw new Win32Exception(error, "browser_artifact_quarantine_create_failed");
    }
    var info = ReadHandleInfo(handle);
    if ((info.FileAttributes & FileAttributes.ReparsePoint) != 0
      || (info.FileAttributes & FileAttributes.Directory) != 0)
    {
      handle.Dispose();
      throw new InvalidOperationException("browser_artifact_quarantine_cleanup_reparse_forbidden");
    }
    return new FileStream(handle, FileAccess.ReadWrite, 16 * 1024, isAsync: true);
  }

  private static async ValueTask<bool> TrySecureDeleteBoundFileAsync(
    FileStream? stream,
    string path,
    FileIdentity identity,
    int expectedBytes)
  {
    if (stream is null) return false;
    var overwritten = false;
    try
    {
      if (stream.Length != expectedBytes)
      {
        return false;
      }
      var zeros = new byte[Math.Min(16 * 1024, Math.Max(1, expectedBytes))];
      try
      {
        stream.Position = 0;
        var remaining = expectedBytes;
        while (remaining > 0)
        {
          var length = Math.Min(remaining, zeros.Length);
          await stream.WriteAsync(zeros.AsMemory(0, length)).ConfigureAwait(false);
          remaining -= length;
        }
        stream.SetLength(expectedBytes);
        await stream.FlushAsync().ConfigureAwait(false);
        stream.Flush(flushToDisk: true);
        overwritten = true;
      }
      finally
      {
        CryptographicOperations.ZeroMemory(zeros);
      }
    }
    catch
    {
      overwritten = false;
    }
    finally
    {
      await stream.DisposeAsync().ConfigureAwait(false);
    }
    if (!overwritten) return false;

    SafeFileHandle? deleteHandle = null;
    try
    {
      deleteHandle = CreateFileW(
        path,
        FileReadAttributes | DeleteAccess,
        ShareRead | ShareWrite | ShareDelete,
        IntPtr.Zero,
        OpenExisting,
        AttributeNormal | FlagOpenReparsePoint,
        IntPtr.Zero);
      if (deleteHandle.IsInvalid) return false;
      var info = ReadHandleInfo(deleteHandle);
      return (info.FileAttributes & FileAttributes.ReparsePoint) == 0
        && ReadIdentity(info) == identity
        && TryMarkDeleteOnClose(deleteHandle);
    }
    catch
    {
      return false;
    }
    finally
    {
      deleteHandle?.Dispose();
    }
  }

  private static SafeFileHandle OpenVerifiedDirectory(string path, bool includeDeleteAccess)
  {
    var handle = CreateFileW(
      path,
      FileReadAttributes | (includeDeleteAccess ? DeleteAccess : 0),
      ShareRead | ShareWrite,
      IntPtr.Zero,
      OpenExisting,
      FlagBackupSemantics | FlagOpenReparsePoint,
      IntPtr.Zero);
    if (handle.IsInvalid)
    {
      var error = Marshal.GetLastWin32Error();
      handle.Dispose();
      throw new Win32Exception(error, "browser_artifact_quarantine_directory_open_failed");
    }
    var info = ReadHandleInfo(handle);
    if ((info.FileAttributes & FileAttributes.Directory) == 0
      || (info.FileAttributes & FileAttributes.ReparsePoint) != 0)
    {
      handle.Dispose();
      throw new InvalidOperationException("browser_artifact_quarantine_reparse_forbidden");
    }
    return handle;
  }

  private static void ValidateHardenedRootAcl(string root)
  {
    using var identity = WindowsIdentity.GetCurrent(TokenAccessLevels.Query);
    var currentSid = identity.User
      ?? throw new InvalidOperationException("browser_artifact_quarantine_identity_unavailable");
    var systemSid = new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null);
    var administratorsSid = new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null);
    var security = new DirectoryInfo(root).GetAccessControl(
      AccessControlSections.Access | AccessControlSections.Owner);
    var owner = security.GetOwner(typeof(SecurityIdentifier)) as SecurityIdentifier;
    if (!security.AreAccessRulesProtected
      || owner is null
      || (owner != currentSid && owner != systemSid && owner != administratorsSid))
    {
      throw new InvalidOperationException("browser_artifact_quarantine_acl_invalid");
    }
    var allowed = new HashSet<string>(StringComparer.Ordinal)
    {
      currentSid.Value,
      systemSid.Value,
      administratorsSid.Value,
    };
    var currentCanWrite = false;
    foreach (FileSystemAccessRule rule in security.GetAccessRules(
      includeExplicit: true,
      includeInherited: true,
      typeof(SecurityIdentifier)))
    {
      var sid = (SecurityIdentifier)rule.IdentityReference;
      if (rule.IsInherited || !allowed.Contains(sid.Value))
        throw new InvalidOperationException("browser_artifact_quarantine_acl_invalid");
      if (sid == currentSid
        && rule.AccessControlType == AccessControlType.Allow
        && (rule.FileSystemRights & (FileSystemRights.CreateFiles | FileSystemRights.WriteData)) != 0)
      {
        currentCanWrite = true;
      }
    }
    if (!currentCanWrite)
      throw new InvalidOperationException("browser_artifact_quarantine_acl_invalid");
  }

  private static bool TryMarkDeleteOnClose(SafeFileHandle handle)
  {
    var disposition = new FileDispositionInfo { DeleteFile = true };
    return SetFileInformationByHandle(
      handle,
      FileInfoByHandleClass.FileDispositionInfo,
      ref disposition,
      (uint)Marshal.SizeOf<FileDispositionInfo>());
  }

  private static ByHandleFileInformation ReadHandleInfo(SafeFileHandle handle)
  {
    if (!GetFileInformationByHandle(handle, out var info))
      throw new Win32Exception(Marshal.GetLastWin32Error());
    return info;
  }

  private static FileIdentity ReadIdentity(SafeFileHandle handle) => ReadIdentity(ReadHandleInfo(handle));

  private static FileIdentity ReadIdentity(ByHandleFileInformation info) => new(
    info.VolumeSerialNumber,
    ((ulong)info.FileIndexHigh << 32) | info.FileIndexLow);

  private readonly record struct FileIdentity(uint VolumeSerialNumber, ulong FileIndex);

  private enum FileInfoByHandleClass
  {
    FileDispositionInfo = 4,
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct FileDispositionInfo
  {
    [MarshalAs(UnmanagedType.Bool)]
    public bool DeleteFile;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct ByHandleFileInformation
  {
    public FileAttributes FileAttributes;
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

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern SafeFileHandle CreateFileW(
    string fileName,
    uint desiredAccess,
    uint shareMode,
    IntPtr securityAttributes,
    uint creationDisposition,
    uint flagsAndAttributes,
    IntPtr templateFile);

  [DllImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool GetFileInformationByHandle(
    SafeFileHandle file,
    out ByHandleFileInformation fileInformation);

  [DllImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool SetFileInformationByHandle(
    SafeFileHandle file,
    FileInfoByHandleClass fileInformationClass,
    ref FileDispositionInfo fileInformation,
    uint bufferSize);
}

internal static class SensitiveUtf8
{
  private static readonly UTF8Encoding StrictUtf8 = new(
    encoderShouldEmitUTF8Identifier: false,
    throwOnInvalidBytes: true);

  public static T Use<T>(ReadOnlyMemory<byte> secret, Func<string, T> consumer)
  {
    string value;
    try
    {
      value = StrictUtf8.GetString(secret.Span);
    }
    catch (DecoderFallbackException exception)
    {
      throw new InvalidOperationException("browser_secret_utf8_invalid", exception);
    }
    if (value.Contains('\0'))
    {
      ZeroString(value);
      throw new InvalidOperationException("browser_secret_contains_null");
    }

    try
    {
      return consumer(value);
    }
    finally
    {
      ZeroString(value);
    }
  }

  internal static unsafe void ZeroString(string value)
  {
    fixed (char* pointer = value)
    {
      CryptographicOperations.ZeroMemory(new Span<byte>(
        pointer,
        checked(value.Length * sizeof(char))));
    }
  }
}
