using System.Buffers.Binary;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Execution;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Extensions.Options;
using Microsoft.Win32.SafeHandles;

namespace Itemba.Msaidizi.Companion.Service.Capabilities;

internal static class LocalUserRightCapabilitySchemas
{
  public const string TargetArguments =
    """
    {
      "type": "object",
      "properties": {
        "rightId": { "type": "string", "pattern": "^[A-Za-z0-9._-]{1,80}$" }
      },
      "required": ["rightId"],
      "additionalProperties": false
    }
    """;

  public const string SetArguments =
    """
    {
      "type": "object",
      "properties": {
        "rightId": { "type": "string", "pattern": "^[A-Za-z0-9._-]{1,80}$" },
        "assigned": { "type": "boolean" }
      },
      "required": ["rightId", "assigned"],
      "additionalProperties": false
    }
    """;

  public const string ReadResult =
    """
    {
      "type": "object",
      "properties": {
        "rightId": { "type": "string" },
        "principalId": { "type": "string" },
        "principalType": { "enum": ["account", "group"] },
        "assigned": { "type": "boolean" },
        "principalSidSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
        "stateSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
      },
      "required": ["rightId", "principalId", "principalType", "assigned", "principalSidSha256", "stateSha256"],
      "additionalProperties": false
    }
    """;

  public const string MutationResult =
    """
    {
      "type": "object",
      "properties": {
        "committed": { "const": true },
        "stateSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
      },
      "required": ["committed", "stateSha256"],
      "additionalProperties": false
    }
    """;

  public static CapabilityArgumentValidation ValidateTarget(JsonElement value) =>
    ValidateId(value, mutation: false)
      ? CapabilityArgumentValidation.Success
      : GovernedWindowsCapabilitySupport.InvalidArguments(
        "Local user-right target is invalid.");

  public static CapabilityArgumentValidation ValidateSet(JsonElement value) =>
    ValidateId(value, mutation: true)
    && GovernedWindowsCapabilitySupport.Boolean(value, "assigned")
      ? CapabilityArgumentValidation.Success
      : GovernedWindowsCapabilitySupport.InvalidArguments(
        "Local user-right mutation is invalid.");

  public static CapabilityArgumentValidation ValidateReadResult(JsonElement value) =>
    GovernedWindowsCapabilitySupport.Exact(
      value,
      "rightId",
      "principalId",
      "principalType",
      "assigned",
      "principalSidSha256",
      "stateSha256")
    && GovernedWindowsCapabilitySupport.String(value, "rightId", 1, 80)
    && GovernedWindowsCapabilitySupport.String(value, "principalId", 1, 80)
    && GovernedWindowsCapabilitySupport.String(value, "principalType", 5, 7)
    && value.GetProperty("principalType").GetString() is "account" or "group"
    && GovernedWindowsCapabilitySupport.Boolean(value, "assigned")
    && GovernedWindowsCapabilitySupport.Sha256(value, "principalSidSha256")
    && GovernedWindowsCapabilitySupport.Sha256(value, "stateSha256")
      ? CapabilityArgumentValidation.Success
      : GovernedWindowsCapabilitySupport.InvalidResult(
        "Local user-right result is invalid.");

  public static CapabilityArgumentValidation ValidateMutationResult(JsonElement value) =>
    GovernedWindowsCapabilitySupport.Exact(value, "committed", "stateSha256")
    && value.GetProperty("committed").ValueKind == JsonValueKind.True
    && GovernedWindowsCapabilitySupport.Sha256(value, "stateSha256")
      ? CapabilityArgumentValidation.Success
      : GovernedWindowsCapabilitySupport.InvalidResult(
        "Local user-right mutation result is invalid.");

  private static bool ValidateId(JsonElement value, bool mutation) =>
    (mutation
      ? GovernedWindowsCapabilitySupport.Exact(value, "rightId", "assigned")
      : GovernedWindowsCapabilitySupport.Exact(value, "rightId"))
    && GovernedWindowsCapabilitySupport.String(value, "rightId", 1, 80)
    && GovernedWindowsCapabilitySupport.IsSafeId(
      value.GetProperty("rightId").GetString()!);
}

internal sealed record ResolvedLocalUserRight(
  string Id,
  string PrincipalType,
  string PrincipalId,
  string PrincipalName,
  string RightName,
  bool AllowRead,
  bool AllowGrant,
  bool AllowRevoke);

internal sealed class LocalUserRightPolicy
{
  private static readonly HashSet<string> AllowedLogonRights = new(
  [
    "SeBatchLogonRight",
    "SeServiceLogonRight",
    "SeNetworkLogonRight",
    "SeInteractiveLogonRight",
    "SeRemoteInteractiveLogonRight",
    "SeDenyBatchLogonRight",
    "SeDenyServiceLogonRight",
    "SeDenyNetworkLogonRight",
    "SeDenyInteractiveLogonRight",
    "SeDenyRemoteInteractiveLogonRight",
  ],
  StringComparer.Ordinal);

  private readonly Dictionary<string, ResolvedLocalUserRight> _rights;

  public LocalUserRightPolicy(
    IOptions<HostCapabilityOptions> options,
    LocalIdentityPolicy identities)
  {
    _rights = options.Value.AllowedLocalUserRights
      .Select(configured => Parse(configured, identities))
      .ToDictionary(right => right.Id, StringComparer.Ordinal);
    if (_rights.Values
        .Select(right => $"{right.PrincipalType}\u001f{right.PrincipalId}\u001f{right.RightName}")
        .Distinct(StringComparer.OrdinalIgnoreCase).Count() != _rights.Count)
    {
      throw new InvalidOperationException(
        "Local user-right allowlist contains duplicate principal/right bindings.");
    }
  }

  public ResolvedLocalUserRight Resolve(
    string id,
    bool requireRead = false,
    bool? desiredAssigned = null)
  {
    if (!_rights.TryGetValue(id, out var right)
      || (requireRead && !right.AllowRead)
      || (desiredAssigned == true && !right.AllowGrant)
      || (desiredAssigned == false && !right.AllowRevoke))
    {
      throw new HostPreconditionException("local_user_right_not_allowed");
    }
    return right;
  }

  public ResolvedLocalUserRight ResolveRecovery(JsonElement recoveryRecord)
  {
    var id = RecoveryJson.RequiredString(recoveryRecord, "rightId", 80);
    var principalType = RecoveryJson.RequiredString(
      recoveryRecord,
      "principalType",
      7);
    var principalId = RecoveryJson.RequiredString(recoveryRecord, "principalId", 80);
    var principalName = RecoveryJson.RequiredString(
      recoveryRecord,
      "principalName",
      256);
    var rightName = RecoveryJson.RequiredString(recoveryRecord, "rightName", 64);
    var right = Resolve(id);
    return right.PrincipalType == principalType
      && right.PrincipalId == principalId
      && string.Equals(
        right.PrincipalName,
        principalName,
        StringComparison.OrdinalIgnoreCase)
      && right.RightName == rightName
        ? right
        : throw new HostRecoveryException("recovery_record_format_invalid");
  }

  private static ResolvedLocalUserRight Parse(
    AllowedLocalUserRightOptions configured,
    LocalIdentityPolicy identities)
  {
    if (!GovernedWindowsCapabilitySupport.IsSafeId(configured.Id)
      || configured.PrincipalType is not ("account" or "group")
      || !GovernedWindowsCapabilitySupport.IsSafeId(configured.PrincipalId)
      || !AllowedLogonRights.Contains(configured.RightName)
      || !(configured.AllowRead || configured.AllowGrant || configured.AllowRevoke))
    {
      throw new InvalidOperationException(
        "An allowed local user-right binding is invalid or outside the curated logon-right set.");
    }

    var principalName = configured.PrincipalType == "account"
      ? identities.ResolveAccount(configured.PrincipalId).AccountName
      : identities.ResolveGroup(configured.PrincipalId).GroupName;
    return new ResolvedLocalUserRight(
      configured.Id,
      configured.PrincipalType,
      configured.PrincipalId,
      principalName,
      configured.RightName,
      configured.AllowRead,
      configured.AllowGrant,
      configured.AllowRevoke);
  }
}

internal sealed record LocalRightPrincipal(byte[] Sid, string SidSha256);

internal sealed record LocalUserRightState(
  bool Assigned,
  string PrincipalSidSha256,
  long BytesRead);

internal interface IWindowsLocalUserRightManager
{
  LocalRightPrincipal ResolvePrincipal(string principalName, string principalType);

  LocalUserRightState Read(LocalRightPrincipal principal, string rightName);

  void SetAssigned(LocalRightPrincipal principal, string rightName, bool assigned);
}

internal sealed class WindowsLocalUserRightManager : IWindowsLocalUserRightManager
{
  private const int ErrorInsufficientBuffer = 122;
  private const int MaximumRights = 64;
  private const int MaximumRightNameCharacters = 128;
  private const uint PolicyLookupNames = 0x00000800;
  private const int StatusObjectNameNotFound = unchecked((int)0xC0000034);
  private const int StatusNoMoreEntries = unchecked((int)0x8000001A);

  public LocalRightPrincipal ResolvePrincipal(
    string principalName,
    string principalType)
  {
    var qualified = $"{Environment.MachineName}\\{principalName}";
    uint sidLength = 0;
    uint domainLength = 0;
    _ = LookupAccountName(
      null,
      qualified,
      null,
      ref sidLength,
      null,
      ref domainLength,
      out _);
    var error = Marshal.GetLastWin32Error();
    if (error != ErrorInsufficientBuffer
      || sidLength is 0 or > 256
      || domainLength is 0 or > 256)
    {
      throw NativeFailure("local_right_principal_unavailable", error);
    }

    var sid = new byte[sidLength];
    var domain = new char[domainLength];
    if (!LookupAccountName(
        null,
        qualified,
        sid,
        ref sidLength,
        domain,
        ref domainLength,
        out var use))
    {
      throw NativeFailure(
        "local_right_principal_unavailable",
        Marshal.GetLastWin32Error());
    }

    var resolvedDomain = new string(domain).TrimEnd('\0');
    var expectedUse = principalType == "account"
      ? use == SidNameUse.User
      : use is SidNameUse.Group or SidNameUse.Alias;
    if (!expectedUse
      || !string.Equals(
        resolvedDomain,
        Environment.MachineName,
        StringComparison.OrdinalIgnoreCase)
      || !IsNonBuiltInSid(sid))
    {
      throw new HostPreconditionException("protected_local_right_principal");
    }
    return new LocalRightPrincipal(
      sid,
      Convert.ToHexString(SHA256.HashData(sid)).ToLowerInvariant());
  }

  public LocalUserRightState Read(LocalRightPrincipal principal, string rightName)
  {
    using var policy = OpenPolicy(PolicyLookupNames);
    var status = LsaEnumerateAccountRights(
      policy,
      principal.Sid,
      out var rightsBuffer,
      out var count);
    if (status is StatusObjectNameNotFound or StatusNoMoreEntries)
    {
      return new LocalUserRightState(
        false,
        principal.SidSha256,
        principal.Sid.LongLength);
    }
    if (status != 0)
    {
      throw LsaFailure("local_user_right_read_failed", status);
    }
    if (count > MaximumRights)
    {
      if (rightsBuffer != IntPtr.Zero)
      {
        _ = LsaFreeMemory(rightsBuffer);
      }
      throw new HostPreconditionException("local_user_right_inventory_limit_exceeded");
    }

    var assigned = false;
    var bytesRead = principal.Sid.LongLength;
    try
    {
      var structureSize = Marshal.SizeOf<LsaUnicodeString>();
      for (var index = 0; index < count; index++)
      {
        var native = Marshal.PtrToStructure<LsaUnicodeString>(
          IntPtr.Add(rightsBuffer, checked((int)index * structureSize)));
        if (native.Length > MaximumRightNameCharacters * sizeof(char)
          || native.Length % sizeof(char) != 0
          || native.Buffer == IntPtr.Zero)
        {
          throw new HostPreconditionException("local_user_right_inventory_invalid");
        }
        var name = Marshal.PtrToStringUni(native.Buffer, native.Length / sizeof(char))
          ?? throw new HostPreconditionException("local_user_right_inventory_invalid");
        bytesRead = checked(bytesRead + structureSize + native.Length);
        assigned |= name == rightName;
      }
    }
    finally
    {
      if (rightsBuffer != IntPtr.Zero)
      {
        _ = LsaFreeMemory(rightsBuffer);
      }
    }
    return new LocalUserRightState(
      assigned,
      principal.SidSha256,
      bytesRead);
  }

  public void SetAssigned(
    LocalRightPrincipal principal,
    string rightName,
    bool assigned)
  {
    using var policy = OpenPolicy(PolicyLookupNames);
    using var nativeRight = NativeRightName.Create(rightName);
    var value = nativeRight.Value;
    var status = assigned
      ? LsaAddAccountRights(policy, principal.Sid, ref value, 1)
      : LsaRemoveAccountRights(
        policy,
        principal.Sid,
        allRights: false,
        ref value,
        1);
    if (status != 0)
    {
      throw LsaFailure("local_user_right_update_failed", status);
    }
  }

  private static SafeLsaPolicyHandle OpenPolicy(uint desiredAccess)
  {
    var attributes = new LsaObjectAttributes
    {
      Length = checked((uint)Marshal.SizeOf<LsaObjectAttributes>()),
    };
    var status = LsaOpenPolicy(
      IntPtr.Zero,
      ref attributes,
      desiredAccess,
      out var policy);
    if (status != 0 || policy.IsInvalid)
    {
      policy.Dispose();
      throw LsaFailure("local_security_policy_unavailable", status);
    }
    return policy;
  }

  private static bool IsNonBuiltInSid(byte[] sid)
  {
    if (sid.Length < 12 || sid[0] != 1 || sid[1] == 0)
    {
      return false;
    }
    var subAuthorityCount = sid[1];
    var requiredLength = checked(8 + subAuthorityCount * sizeof(uint));
    if (sid.Length != requiredLength)
    {
      return false;
    }
    var ridOffset = checked(8 + (subAuthorityCount - 1) * sizeof(uint));
    return BinaryPrimitives.ReadUInt32LittleEndian(sid.AsSpan(ridOffset, 4)) >= 1_000;
  }

  private static HostPreconditionException NativeFailure(string errorCode, int error) =>
    new($"{errorCode}_{new Win32Exception(error).NativeErrorCode}");

  private static HostPreconditionException LsaFailure(string errorCode, int status)
  {
    var error = LsaNtStatusToWinError(status);
    return NativeFailure(errorCode, checked((int)error));
  }

  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool LookupAccountName(
    string? systemName,
    string accountName,
    [Out] byte[]? sid,
    ref uint sidSize,
    [Out] char[]? referencedDomainName,
    ref uint referencedDomainNameSize,
    out SidNameUse use);

  [DllImport("advapi32.dll")]
  private static extern int LsaOpenPolicy(
    IntPtr systemName,
    ref LsaObjectAttributes objectAttributes,
    uint desiredAccess,
    out SafeLsaPolicyHandle policyHandle);

  [DllImport("advapi32.dll")]
  private static extern int LsaEnumerateAccountRights(
    SafeLsaPolicyHandle policyHandle,
    [In] byte[] accountSid,
    out IntPtr userRights,
    out uint countOfRights);

  [DllImport("advapi32.dll")]
  private static extern int LsaAddAccountRights(
    SafeLsaPolicyHandle policyHandle,
    [In] byte[] accountSid,
    ref LsaUnicodeString userRights,
    uint countOfRights);

  [DllImport("advapi32.dll")]
  private static extern int LsaRemoveAccountRights(
    SafeLsaPolicyHandle policyHandle,
    [In] byte[] accountSid,
    [MarshalAs(UnmanagedType.Bool)] bool allRights,
    ref LsaUnicodeString userRights,
    uint countOfRights);

  [DllImport("advapi32.dll")]
  private static extern int LsaFreeMemory(IntPtr buffer);

  [DllImport("advapi32.dll")]
  private static extern int LsaClose(IntPtr objectHandle);

  [DllImport("advapi32.dll")]
  private static extern uint LsaNtStatusToWinError(int status);

  private enum SidNameUse
  {
    User = 1,
    Group = 2,
    Domain = 3,
    Alias = 4,
    WellKnownGroup = 5,
    DeletedAccount = 6,
    Invalid = 7,
    Unknown = 8,
    Computer = 9,
    Label = 10,
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct LsaObjectAttributes
  {
    public uint Length;
    public IntPtr RootDirectory;
    public IntPtr ObjectName;
    public uint Attributes;
    public IntPtr SecurityDescriptor;
    public IntPtr SecurityQualityOfService;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct LsaUnicodeString
  {
    public ushort Length;
    public ushort MaximumLength;
    public IntPtr Buffer;
  }

  private sealed class NativeRightName : IDisposable
  {
    private IntPtr _buffer;

    private NativeRightName(IntPtr buffer, LsaUnicodeString value)
    {
      _buffer = buffer;
      Value = value;
    }

    public LsaUnicodeString Value { get; }

    public static NativeRightName Create(string value)
    {
      var length = checked(value.Length * sizeof(char));
      var buffer = Marshal.StringToHGlobalUni(value);
      return new NativeRightName(buffer, new LsaUnicodeString
      {
        Length = checked((ushort)length),
        MaximumLength = checked((ushort)(length + sizeof(char))),
        Buffer = buffer,
      });
    }

    public void Dispose()
    {
      if (_buffer == IntPtr.Zero)
      {
        return;
      }
      Marshal.FreeHGlobal(_buffer);
      _buffer = IntPtr.Zero;
    }
  }

  private sealed class SafeLsaPolicyHandle : SafeHandleZeroOrMinusOneIsInvalid
  {
    private SafeLsaPolicyHandle() : base(ownsHandle: true)
    {
    }

    protected override bool ReleaseHandle() => LsaClose(handle) == 0;
  }
}

internal sealed class LocalUserRightReadCapabilityAdapter(
  LocalUserRightPolicy policy,
  IWindowsLocalUserRightManager rights) : IHostCapabilityAdapter
{
  public CapabilityDescriptor Descriptor { get; } = GovernedWindowsCapabilitySupport.Descriptor(
    "local-principal.right.read",
    "Read approved local principal logon right",
    "Reads one curated Windows logon-right assignment for one supervisor-approved non-built-in local principal.",
    CapabilityDataClass.Confidential,
    CapabilityEffect.LocalRead,
    RecoveryKind.NotApplicable,
    LocalUserRightCapabilitySchemas.TargetArguments,
    LocalUserRightCapabilitySchemas.ReadResult,
    ["windows-local-user-right"]);

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    LocalUserRightCapabilitySchemas.ValidateTarget(arguments);

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    LocalUserRightCapabilitySchemas.ValidateReadResult(result);

  public ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    var right = policy.Resolve(
      arguments.GetProperty("rightId").GetString()!,
      requireRead: true);
    var principal = rights.ResolvePrincipal(right.PrincipalName, right.PrincipalType);
    var state = rights.Read(principal, right.RightName);
    var stateSha256 = State(right, state);
    var output = JsonSerializer.Serialize(new
    {
      rightId = right.Id,
      principalId = right.PrincipalId,
      principalType = right.PrincipalType,
      assigned = state.Assigned,
      principalSidSha256 = state.PrincipalSidSha256,
      stateSha256,
    });
    return ValueTask.FromResult(new CapabilityExecutionResult(
      output,
      MutationCommitted: false,
      OutcomeUncertain: false,
      Provenance:
      [
        Provenance(right, state.PrincipalSidSha256, stateSha256),
      ],
      PreStateSha256: stateSha256,
      LocalBytesRead: Math.Max(
        state.BytesRead,
        GovernedWindowsCapabilitySupport.JsonByteCount(output))));
  }

  internal static string State(
    ResolvedLocalUserRight right,
    LocalUserRightState state) => GovernedWindowsCapabilitySupport.StateSha256(new
    {
      rightId = right.Id,
      principalType = right.PrincipalType,
      principalId = right.PrincipalId,
      principalSidSha256 = state.PrincipalSidSha256,
      assigned = state.Assigned,
    });

  internal static DataProvenance Provenance(
    ResolvedLocalUserRight right,
    string principalSidSha256,
    string stateSha256) => GovernedWindowsCapabilitySupport.Provenance(
      "windows-local-user-right",
      $"{right.Id}\n{right.PrincipalType}\n{right.PrincipalId}\n{right.PrincipalName}\n{right.RightName}\n{principalSidSha256}",
      stateSha256);
}

internal sealed class LocalUserRightSetCapabilityAdapter(
  LocalUserRightPolicy policy,
  IWindowsLocalUserRightManager rights,
  IHostRecoveryVault recoveryVault) : IHostCapabilityAdapter
{
  private const long MaximumStateReadBytes = 32_768;

  public CapabilityDescriptor Descriptor { get; } = GovernedWindowsCapabilitySupport.Descriptor(
    "local-principal.right.set",
    "Change approved local principal logon right",
    "Grants or revokes one curated Windows logon right for one supervisor-approved non-built-in local principal.",
    CapabilityDataClass.Confidential,
    CapabilityEffect.Administrative,
    RecoveryKind.Snapshot,
    LocalUserRightCapabilitySchemas.SetArguments,
    LocalUserRightCapabilitySchemas.MutationResult,
    ["windows-local-user-right", "host-recovery-record"]);

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    LocalUserRightCapabilitySchemas.ValidateSet(arguments);

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    LocalUserRightCapabilitySchemas.ValidateMutationResult(result);

  public async ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    RegistryValueSetCapabilityAdapter.RequireExpectedState(context);
    var desired = arguments.GetProperty("assigned").GetBoolean();
    var right = policy.Resolve(
      arguments.GetProperty("rightId").GetString()!,
      desiredAssigned: desired);
    var principal = rights.ResolvePrincipal(right.PrincipalName, right.PrincipalType);
    var before = rights.Read(principal, right.RightName);
    var beforeSha256 = LocalUserRightReadCapabilityAdapter.State(right, before);
    RegistryValueSetCapabilityAdapter.MatchExpected(context, beforeSha256);
    if (before.Assigned == desired)
    {
      throw new HostPreconditionException("local_user_right_already_desired");
    }

    var bytesWritten = checked(
      principal.Sid.LongLength + Encoding.Unicode.GetByteCount(right.RightName));
    if (before.BytesRead > context.Budgets.MaxLocalBytes
      || bytesWritten > context.Budgets.MaxLocalBytes - before.BytesRead
      || MaximumStateReadBytes
        > context.Budgets.MaxLocalBytes - before.BytesRead - bytesWritten
      || MaximumStateReadBytes
        > context.Budgets.MaxLocalBytes
          - before.BytesRead
          - bytesWritten
          - MaximumStateReadBytes)
    {
      throw new HostPreconditionException("local_user_right_budget_required");
    }
    var recovery = await recoveryVault.PrepareAsync(
      context,
      Descriptor.Id,
      beforeSha256,
      new
      {
        rightId = right.Id,
        right.PrincipalType,
        right.PrincipalId,
        right.PrincipalName,
        right.RightName,
        principalSidBase64 = Convert.ToBase64String(principal.Sid),
        principal.SidSha256,
        assigned = before.Assigned,
      },
      irreversible: false,
      cancellationToken).ConfigureAwait(false);
    cancellationToken.ThrowIfCancellationRequested();

    var immediate = rights.ResolvePrincipal(right.PrincipalName, right.PrincipalType);
    if (!principal.Sid.AsSpan().SequenceEqual(immediate.Sid))
    {
      throw new HostPreconditionException("local_user_right_principal_changed");
    }
    var immediateState = rights.Read(immediate, right.RightName);
    if (LocalUserRightReadCapabilityAdapter.State(right, immediateState) != beforeSha256)
    {
      throw new HostPreconditionException("local_user_right_state_changed");
    }

    rights.SetAssigned(immediate, right.RightName, desired);
    var after = rights.Read(immediate, right.RightName);
    if (after.Assigned != desired
      || after.PrincipalSidSha256 != principal.SidSha256)
    {
      throw new InvalidOperationException("local_user_right_postcondition_failed");
    }
    try
    {
      var current = rights.ResolvePrincipal(right.PrincipalName, right.PrincipalType);
      if (!principal.Sid.AsSpan().SequenceEqual(current.Sid))
      {
        throw new InvalidOperationException("local_user_right_principal_changed_after_update");
      }
    }
    catch (HostPreconditionException exception)
    {
      throw new InvalidOperationException(
        "local_user_right_principal_unavailable_after_update",
        exception);
    }

    var afterSha256 = LocalUserRightReadCapabilityAdapter.State(right, after);
    var output = JsonSerializer.Serialize(new
    {
      committed = true,
      stateSha256 = afterSha256,
    });
    return new CapabilityExecutionResult(
      output,
      MutationCommitted: true,
      OutcomeUncertain: false,
      Provenance:
      [
        LocalUserRightReadCapabilityAdapter.Provenance(
          right,
          after.PrincipalSidSha256,
          afterSha256),
        RegistryValueSetCapabilityAdapter.RecoveryProvenance(recovery),
      ],
      OpaqueRecoveryHandle: recovery.OpaqueHandle,
      PreStateSha256: beforeSha256,
      RecoveryProvenanceSha256: recovery.RecordSha256,
      LocalBytesRead: checked(
        before.BytesRead + immediateState.BytesRead + after.BytesRead),
      LocalBytesWritten: bytesWritten);
  }
}

internal sealed class LocalUserRightAdministrativeRecoveryOperation(
  LocalUserRightPolicy policy,
  IWindowsLocalUserRightManager rights) : IAdministrativeRecoveryOperation
{
  public bool Supports(string operation) => operation == "local-principal.right.set";

  public ValueTask<string> ReadStateAsync(
    TrustedHostRecoveryRecord record,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    var (right, principal) = Resolve(record.RecoveryRecord);
    var state = rights.Read(principal, right.RightName);
    return ValueTask.FromResult(LocalUserRightReadCapabilityAdapter.State(right, state));
  }

  public ValueTask RestoreAsync(
    TrustedHostRecoveryRecord record,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    var (right, principal) = Resolve(record.RecoveryRecord);
    rights.SetAssigned(
      principal,
      right.RightName,
      LocalAccountAdministrativeRecoveryOperation.RequiredBoolean(
        record.RecoveryRecord,
        "assigned"));
    return ValueTask.CompletedTask;
  }

  private (ResolvedLocalUserRight Right, LocalRightPrincipal Principal) Resolve(
    JsonElement recoveryRecord)
  {
    var right = policy.ResolveRecovery(recoveryRecord);
    var expectedHash = RecoveryJson.RequiredString(
      recoveryRecord,
      "sidSha256",
      64);
    if (!PayloadDigest.IsSha256Hex(expectedHash))
    {
      throw new HostRecoveryException("recovery_record_format_invalid");
    }
    var encoded = RecoveryJson.RequiredString(
      recoveryRecord,
      "principalSidBase64",
      344);
    byte[] recordedSid;
    try
    {
      recordedSid = Convert.FromBase64String(encoded);
    }
    catch (FormatException)
    {
      throw new HostRecoveryException("recovery_record_format_invalid");
    }
    if (recordedSid.Length is 0 or > 256
      || !string.Equals(
        Convert.ToHexString(SHA256.HashData(recordedSid)).ToLowerInvariant(),
        expectedHash,
        StringComparison.Ordinal))
    {
      throw new HostRecoveryException("recovery_record_format_invalid");
    }

    LocalRightPrincipal current;
    try
    {
      current = rights.ResolvePrincipal(right.PrincipalName, right.PrincipalType);
    }
    catch (HostPreconditionException)
    {
      throw new HostRecoveryException("recovery_target_unavailable");
    }
    if (!current.Sid.AsSpan().SequenceEqual(recordedSid))
    {
      throw new HostRecoveryException("recovery_target_identity_changed");
    }
    return (right, current);
  }
}
