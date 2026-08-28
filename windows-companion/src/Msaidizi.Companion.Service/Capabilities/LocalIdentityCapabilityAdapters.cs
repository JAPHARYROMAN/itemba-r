using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Execution;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Service.Capabilities;

internal static class LocalIdentityCapabilitySchemas
{
  public const string AccountArguments =
    """
    {
      "type": "object",
      "properties": {
        "accountId": { "type": "string", "pattern": "^[A-Za-z0-9._-]{1,80}$" }
      },
      "required": ["accountId"],
      "additionalProperties": false
    }
    """;

  public const string AccountSetArguments =
    """
    {
      "type": "object",
      "properties": {
        "accountId": { "type": "string", "pattern": "^[A-Za-z0-9._-]{1,80}$" },
        "enabled": { "type": "boolean" }
      },
      "required": ["accountId", "enabled"],
      "additionalProperties": false
    }
    """;

  public const string AccountResult =
    """
    {
      "type": "object",
      "properties": {
        "accountId": { "type": "string" },
        "enabled": { "type": "boolean" },
        "lockedOut": { "type": "boolean" },
        "passwordRequired": { "type": "boolean" },
        "passwordExpires": { "type": "boolean" },
        "stateSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
      },
      "required": ["accountId", "enabled", "lockedOut", "passwordRequired", "passwordExpires", "stateSha256"],
      "additionalProperties": false
    }
    """;

  public const string MembershipArguments =
    """
    {
      "type": "object",
      "properties": {
        "groupId": { "type": "string", "pattern": "^[A-Za-z0-9._-]{1,80}$" },
        "accountId": { "type": "string", "pattern": "^[A-Za-z0-9._-]{1,80}$" }
      },
      "required": ["groupId", "accountId"],
      "additionalProperties": false
    }
    """;

  public const string MembershipSetArguments =
    """
    {
      "type": "object",
      "properties": {
        "groupId": { "type": "string", "pattern": "^[A-Za-z0-9._-]{1,80}$" },
        "accountId": { "type": "string", "pattern": "^[A-Za-z0-9._-]{1,80}$" },
        "member": { "type": "boolean" }
      },
      "required": ["groupId", "accountId", "member"],
      "additionalProperties": false
    }
    """;

  public const string MembershipResult =
    """
    {
      "type": "object",
      "properties": {
        "groupId": { "type": "string" },
        "accountId": { "type": "string" },
        "member": { "type": "boolean" },
        "stateSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
      },
      "required": ["groupId", "accountId", "member", "stateSha256"],
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

  public static CapabilityArgumentValidation ValidateAccount(JsonElement value) =>
    GovernedWindowsCapabilitySupport.Exact(value, "accountId")
    && GovernedWindowsCapabilitySupport.String(value, "accountId", 1, 80)
    && GovernedWindowsCapabilitySupport.IsSafeId(value.GetProperty("accountId").GetString()!)
      ? CapabilityArgumentValidation.Success
      : GovernedWindowsCapabilitySupport.InvalidArguments("Local account target is invalid.");

  public static CapabilityArgumentValidation ValidateAccountSet(JsonElement value) =>
    GovernedWindowsCapabilitySupport.Exact(value, "accountId", "enabled")
    && GovernedWindowsCapabilitySupport.String(value, "accountId", 1, 80)
    && GovernedWindowsCapabilitySupport.Boolean(value, "enabled")
    && GovernedWindowsCapabilitySupport.IsSafeId(value.GetProperty("accountId").GetString()!)
      ? CapabilityArgumentValidation.Success
      : GovernedWindowsCapabilitySupport.InvalidArguments("Local account mutation is invalid.");

  public static CapabilityArgumentValidation ValidateMembership(
    JsonElement value,
    bool mutation)
  {
    var exact = mutation
      ? GovernedWindowsCapabilitySupport.Exact(value, "groupId", "accountId", "member")
      : GovernedWindowsCapabilitySupport.Exact(value, "groupId", "accountId");
    return exact
      && GovernedWindowsCapabilitySupport.String(value, "groupId", 1, 80)
      && GovernedWindowsCapabilitySupport.String(value, "accountId", 1, 80)
      && GovernedWindowsCapabilitySupport.IsSafeId(value.GetProperty("groupId").GetString()!)
      && GovernedWindowsCapabilitySupport.IsSafeId(value.GetProperty("accountId").GetString()!)
      && (!mutation || GovernedWindowsCapabilitySupport.Boolean(value, "member"))
        ? CapabilityArgumentValidation.Success
        : GovernedWindowsCapabilitySupport.InvalidArguments("Local group membership target is invalid.");
  }

  public static CapabilityArgumentValidation ValidateAccountResult(JsonElement value) =>
    GovernedWindowsCapabilitySupport.Exact(
      value,
      "accountId",
      "enabled",
      "lockedOut",
      "passwordRequired",
      "passwordExpires",
      "stateSha256")
    && GovernedWindowsCapabilitySupport.String(value, "accountId", 1, 80)
    && GovernedWindowsCapabilitySupport.Boolean(value, "enabled")
    && GovernedWindowsCapabilitySupport.Boolean(value, "lockedOut")
    && GovernedWindowsCapabilitySupport.Boolean(value, "passwordRequired")
    && GovernedWindowsCapabilitySupport.Boolean(value, "passwordExpires")
    && GovernedWindowsCapabilitySupport.Sha256(value, "stateSha256")
      ? CapabilityArgumentValidation.Success
      : GovernedWindowsCapabilitySupport.InvalidResult("Local account result is invalid.");

  public static CapabilityArgumentValidation ValidateMembershipResult(JsonElement value) =>
    GovernedWindowsCapabilitySupport.Exact(
      value,
      "groupId",
      "accountId",
      "member",
      "stateSha256")
    && GovernedWindowsCapabilitySupport.String(value, "groupId", 1, 80)
    && GovernedWindowsCapabilitySupport.String(value, "accountId", 1, 80)
    && GovernedWindowsCapabilitySupport.Boolean(value, "member")
    && GovernedWindowsCapabilitySupport.Sha256(value, "stateSha256")
      ? CapabilityArgumentValidation.Success
      : GovernedWindowsCapabilitySupport.InvalidResult("Local group membership result is invalid.");

  public static CapabilityArgumentValidation ValidateMutationResult(JsonElement value) =>
    GovernedWindowsCapabilitySupport.Exact(value, "committed", "stateSha256")
    && value.GetProperty("committed").ValueKind == JsonValueKind.True
    && GovernedWindowsCapabilitySupport.Sha256(value, "stateSha256")
      ? CapabilityArgumentValidation.Success
      : GovernedWindowsCapabilitySupport.InvalidResult("Local identity mutation result is invalid.");
}

internal sealed record ResolvedLocalAccount(
  string Id,
  string AccountName,
  bool AllowRead,
  bool AllowEnableDisable,
  bool AllowGroupMembershipChange);

internal sealed record ResolvedLocalGroup(
  string Id,
  string GroupName,
  bool AllowReadMembers,
  bool AllowMembershipChange);

internal sealed class LocalIdentityPolicy
{
  private readonly Dictionary<string, ResolvedLocalAccount> _accounts;
  private readonly Dictionary<string, ResolvedLocalGroup> _groups;

  public LocalIdentityPolicy(IOptions<HostCapabilityOptions> options)
  {
    _accounts = options.Value.AllowedLocalAccounts
      .Select(ParseAccount)
      .ToDictionary(account => account.Id, StringComparer.Ordinal);
    _groups = options.Value.AllowedLocalGroups
      .Select(ParseGroup)
      .ToDictionary(group => group.Id, StringComparer.Ordinal);
    if (_accounts.Values.Select(account => account.AccountName)
        .Distinct(StringComparer.OrdinalIgnoreCase).Count() != _accounts.Count
      || _groups.Values.Select(group => group.GroupName)
        .Distinct(StringComparer.OrdinalIgnoreCase).Count() != _groups.Count)
    {
      throw new InvalidOperationException("Local identity allowlists contain duplicate Windows names.");
    }
  }

  public ResolvedLocalAccount ResolveAccount(
    string id,
    bool requireRead = false,
    bool requireEnableDisable = false,
    bool requireMembershipChange = false)
  {
    if (!_accounts.TryGetValue(id, out var account)
      || (requireRead && !account.AllowRead)
      || (requireEnableDisable && !account.AllowEnableDisable)
      || (requireMembershipChange && !account.AllowGroupMembershipChange))
    {
      throw new HostPreconditionException("local_account_not_allowed");
    }
    return account;
  }

  public ResolvedLocalGroup ResolveGroup(
    string id,
    bool requireRead = false,
    bool requireMembershipChange = false)
  {
    if (!_groups.TryGetValue(id, out var group)
      || (requireRead && !group.AllowReadMembers)
      || (requireMembershipChange && !group.AllowMembershipChange))
    {
      throw new HostPreconditionException("local_group_not_allowed");
    }
    return group;
  }

  public ResolvedLocalAccount ResolveAccountRecovery(JsonElement recoveryRecord)
  {
    var id = RecoveryJson.RequiredString(recoveryRecord, "accountId", 80);
    var name = RecoveryJson.RequiredString(recoveryRecord, "accountName", 256);
    var account = ResolveAccount(id);
    return string.Equals(account.AccountName, name, StringComparison.OrdinalIgnoreCase)
      ? account
      : throw new HostRecoveryException("recovery_record_format_invalid");
  }

  public ResolvedLocalGroup ResolveGroupRecovery(JsonElement recoveryRecord)
  {
    var id = RecoveryJson.RequiredString(recoveryRecord, "groupId", 80);
    var name = RecoveryJson.RequiredString(recoveryRecord, "groupName", 256);
    var group = ResolveGroup(id);
    return string.Equals(group.GroupName, name, StringComparison.OrdinalIgnoreCase)
      ? group
      : throw new HostRecoveryException("recovery_record_format_invalid");
  }

  private static ResolvedLocalAccount ParseAccount(AllowedLocalAccountOptions account)
  {
    if (!GovernedWindowsCapabilitySupport.IsSafeId(account.Id)
      || !GovernedWindowsCapabilitySupport.IsSafeSamName(account.AccountName, 256)
      || IsProtectedIdentity(account.AccountName))
    {
      throw new InvalidOperationException("An allowed local account is invalid.");
    }
    return new ResolvedLocalAccount(
      account.Id,
      account.AccountName,
      account.AllowRead,
      account.AllowEnableDisable,
      account.AllowGroupMembershipChange);
  }

  private static ResolvedLocalGroup ParseGroup(AllowedLocalGroupOptions group)
  {
    if (!GovernedWindowsCapabilitySupport.IsSafeId(group.Id)
      || !GovernedWindowsCapabilitySupport.IsSafeSamName(group.GroupName, 256)
      || IsProtectedIdentity(group.GroupName))
    {
      throw new InvalidOperationException("An allowed local group is invalid.");
    }
    return new ResolvedLocalGroup(
      group.Id,
      group.GroupName,
      group.AllowReadMembers,
      group.AllowMembershipChange);
  }

  private static bool IsProtectedIdentity(string windowsName)
  {
    var canonical = string.Concat(windowsName
      .Where(char.IsAsciiLetterOrDigit)
      .Select(char.ToLowerInvariant));
    if (!canonical.StartsWith("itembamsaidizi", StringComparison.Ordinal))
    {
      return false;
    }

    var trustedRole = canonical["itembamsaidizi".Length..];
    return trustedRole.Contains("supervisor", StringComparison.Ordinal)
      || trustedRole.Contains("recovery", StringComparison.Ordinal)
      || trustedRole.Contains("emergency", StringComparison.Ordinal);
  }
}

internal sealed record LocalAccountState(
  bool Enabled,
  bool LockedOut,
  bool PasswordRequired,
  bool PasswordExpires,
  uint RawFlags)
{
  public string StateSha256 => GovernedWindowsCapabilitySupport.StateSha256(new
  {
    enabled = Enabled,
    lockedOut = LockedOut,
    passwordRequired = PasswordRequired,
    passwordExpires = PasswordExpires,
  });
}

internal interface IWindowsLocalIdentityManager
{
  LocalAccountState ReadAccount(string accountName);

  void SetAccountEnabled(string accountName, bool enabled);

  bool IsGroupMember(string groupName, string accountName);

  void SetGroupMember(string groupName, string accountName, bool member);
}

internal sealed class WindowsLocalIdentityManager : IWindowsLocalIdentityManager
{
  private const uint UserAccountDisabled = 0x00000002;
  private const uint UserPasswordNotRequired = 0x00000020;
  private const uint UserPasswordNeverExpires = 0x00010000;
  private const uint UserLockedOut = 0x00000010;
  private const int ErrorMoreData = 234;
  private const int ErrorMemberInAlias = 1378;
  private const int ErrorNoSuchMember = 1387;
  private const int MaximumGroupMembers = 4_096;
  private const int MaximumPreferredLength = 1_048_576;

  public LocalAccountState ReadAccount(string accountName)
  {
    EnsureMutableLocalUser(accountName);
    var status = NetUserGetInfo(null, accountName, 1, out var buffer);
    try
    {
      if (status != 0)
      {
        throw NativeFailure("local_account_unavailable", status);
      }
      var info = Marshal.PtrToStructure<UserInfo1>(buffer);
      return new LocalAccountState(
        Enabled: (info.Flags & UserAccountDisabled) == 0,
        LockedOut: (info.Flags & UserLockedOut) != 0,
        PasswordRequired: (info.Flags & UserPasswordNotRequired) == 0,
        PasswordExpires: (info.Flags & UserPasswordNeverExpires) == 0,
        RawFlags: info.Flags);
    }
    finally
    {
      if (buffer != IntPtr.Zero)
      {
        _ = NetApiBufferFree(buffer);
      }
    }
  }

  public void SetAccountEnabled(string accountName, bool enabled)
  {
    var before = ReadAccount(accountName);
    var flags = enabled
      ? before.RawFlags & ~UserAccountDisabled
      : before.RawFlags | UserAccountDisabled;
    var info = new UserInfo1008 { Flags = flags };
    var status = NetUserSetInfo(null, accountName, 1008, ref info, out _);
    if (status != 0)
    {
      throw NativeFailure("local_account_update_failed", status);
    }
  }

  public bool IsGroupMember(string groupName, string accountName)
  {
    EnsureMutableLocalUser(accountName);
    uint resume = 0;
    var inspected = 0;
    do
    {
      var status = NetLocalGroupGetMembers(
        null,
        groupName,
        3,
        out var buffer,
        MaximumPreferredLength,
        out var entriesRead,
        out _,
        ref resume);
      try
      {
        if (status is not 0 and not ErrorMoreData)
        {
          throw NativeFailure("local_group_unavailable", status);
        }
        if (entriesRead > MaximumGroupMembers - inspected)
        {
          throw new HostPreconditionException("local_group_membership_limit_exceeded");
        }

        var size = Marshal.SizeOf<LocalGroupMembersInfo3>();
        for (var index = 0; index < entriesRead; index++)
        {
          var info = Marshal.PtrToStructure<LocalGroupMembersInfo3>(
            IntPtr.Add(buffer, checked(index * size)));
          if (IsExactLocalAccount(info.DomainAndName, accountName))
          {
            return true;
          }
        }
        inspected += checked((int)entriesRead);
      }
      finally
      {
        if (buffer != IntPtr.Zero)
        {
          _ = NetApiBufferFree(buffer);
        }
      }

      if (status == 0)
      {
        return false;
      }
    }
    while (inspected < MaximumGroupMembers);

    throw new HostPreconditionException("local_group_membership_limit_exceeded");
  }

  public void SetGroupMember(string groupName, string accountName, bool member)
  {
    EnsureMutableLocalUser(accountName);
    EnsureNonPrivilegedLocalGroup(groupName);
    var info = new LocalGroupMembersInfo3
    {
      DomainAndName = $"{Environment.MachineName}\\{accountName}",
    };
    var status = member
      ? NetLocalGroupAddMembers(null, groupName, 3, ref info, 1)
      : NetLocalGroupDelMembers(null, groupName, 3, ref info, 1);
    if ((member && status == ErrorMemberInAlias)
      || (!member && status == ErrorNoSuchMember))
    {
      return;
    }
    if (status != 0)
    {
      throw NativeFailure("local_group_update_failed", status);
    }
  }

  private static void EnsureMutableLocalUser(string accountName)
  {
    var (sid, domain, use) = LookupLocalPrincipal(accountName);
    if (use != SidNameUse.User
      || !string.Equals(domain, Environment.MachineName, StringComparison.OrdinalIgnoreCase))
    {
      throw new HostPreconditionException("local_account_unavailable");
    }

    var subAuthorityCount = GetSidSubAuthorityCount(sid);
    if (subAuthorityCount == 0 || GetSidSubAuthority(sid, subAuthorityCount - 1) < 1_000)
    {
      throw new HostPreconditionException("protected_local_account");
    }
  }

  private static void EnsureNonPrivilegedLocalGroup(string groupName)
  {
    var (sid, domain, use) = LookupLocalPrincipal(groupName);
    if (use is not (SidNameUse.Group or SidNameUse.Alias)
      || !string.Equals(domain, Environment.MachineName, StringComparison.OrdinalIgnoreCase))
    {
      throw new HostPreconditionException("protected_local_group");
    }

    var subAuthorityCount = GetSidSubAuthorityCount(sid);
    if (subAuthorityCount == 0 || GetSidSubAuthority(sid, subAuthorityCount - 1) < 1_000)
    {
      throw new HostPreconditionException("protected_local_group");
    }
  }

  private static (byte[] Sid, string Domain, SidNameUse Use) LookupLocalPrincipal(
    string principalName)
  {
    var qualified = $"{Environment.MachineName}\\{principalName}";
    uint sidLength = 0;
    uint domainLength = 0;
    _ = LookupAccountName(null, qualified, null, ref sidLength, null, ref domainLength, out _);
    if (sidLength == 0 || sidLength > 256 || domainLength > 256)
    {
      throw new HostPreconditionException("local_account_unavailable");
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
      throw new HostPreconditionException("local_principal_unavailable");
    }
    return (sid, new string(domain).TrimEnd('\0'), use);
  }

  private static byte GetSidSubAuthorityCount(byte[] sid)
  {
    var handle = GCHandle.Alloc(sid, GCHandleType.Pinned);
    try
    {
      return Marshal.ReadByte(GetSidSubAuthorityCountNative(handle.AddrOfPinnedObject()));
    }
    finally
    {
      handle.Free();
    }
  }

  private static uint GetSidSubAuthority(byte[] sid, int index)
  {
    var handle = GCHandle.Alloc(sid, GCHandleType.Pinned);
    try
    {
      return unchecked((uint)Marshal.ReadInt32(
        GetSidSubAuthorityNative(handle.AddrOfPinnedObject(), checked((uint)index))));
    }
    finally
    {
      handle.Free();
    }
  }

  private static bool IsExactLocalAccount(string? candidate, string accountName)
  {
    if (candidate is null)
    {
      return false;
    }
    var separator = candidate.IndexOf('\\');
    return separator > 0
      && string.Equals(
        candidate[..separator],
        Environment.MachineName,
        StringComparison.OrdinalIgnoreCase)
      && string.Equals(candidate[(separator + 1)..], accountName, StringComparison.OrdinalIgnoreCase);
  }

  private static HostPreconditionException NativeFailure(string errorCode, int nativeCode) =>
    new($"{errorCode}_{new Win32Exception(nativeCode).NativeErrorCode}");

  [DllImport("netapi32.dll", CharSet = CharSet.Unicode)]
  private static extern int NetUserGetInfo(
    string? serverName,
    string userName,
    int level,
    out IntPtr buffer);

  [DllImport("netapi32.dll", CharSet = CharSet.Unicode)]
  private static extern int NetUserSetInfo(
    string? serverName,
    string userName,
    int level,
    ref UserInfo1008 buffer,
    out int parameterError);

  [DllImport("netapi32.dll", CharSet = CharSet.Unicode)]
  private static extern int NetLocalGroupGetMembers(
    string? serverName,
    string localGroupName,
    int level,
    out IntPtr buffer,
    int preferredMaximumLength,
    out uint entriesRead,
    out uint totalEntries,
    ref uint resumeHandle);

  [DllImport("netapi32.dll", CharSet = CharSet.Unicode)]
  private static extern int NetLocalGroupAddMembers(
    string? serverName,
    string groupName,
    int level,
    ref LocalGroupMembersInfo3 buffer,
    int totalEntries);

  [DllImport("netapi32.dll", CharSet = CharSet.Unicode)]
  private static extern int NetLocalGroupDelMembers(
    string? serverName,
    string groupName,
    int level,
    ref LocalGroupMembersInfo3 buffer,
    int totalEntries);

  [DllImport("netapi32.dll")]
  private static extern int NetApiBufferFree(IntPtr buffer);

  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool LookupAccountName(
    string? systemName,
    string accountName,
    byte[]? sid,
    ref uint sidSize,
    char[]? referencedDomainName,
    ref uint referencedDomainNameSize,
    out SidNameUse use);

  [DllImport("advapi32.dll", EntryPoint = "GetSidSubAuthorityCount")]
  private static extern IntPtr GetSidSubAuthorityCountNative(IntPtr sid);

  [DllImport("advapi32.dll", EntryPoint = "GetSidSubAuthority")]
  private static extern IntPtr GetSidSubAuthorityNative(IntPtr sid, uint subAuthority);

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct UserInfo1
  {
    public string Name;
    public string Password;
    public uint PasswordAge;
    public uint Privilege;
    public string HomeDirectory;
    public string Comment;
    public uint Flags;
    public string ScriptPath;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct UserInfo1008
  {
    public uint Flags;
  }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct LocalGroupMembersInfo3
  {
    [MarshalAs(UnmanagedType.LPWStr)]
    public string DomainAndName;
  }

  private enum SidNameUse
  {
    User = 1,
    Group,
    Domain,
    Alias,
    WellKnownGroup,
    DeletedAccount,
    Invalid,
    Unknown,
    Computer,
    Label,
    LogonSession,
  }
}

internal sealed class LocalAccountStatusCapabilityAdapter(
  LocalIdentityPolicy policy,
  IWindowsLocalIdentityManager identities) : IHostCapabilityAdapter
{
  public CapabilityDescriptor Descriptor { get; } = GovernedWindowsCapabilitySupport.Descriptor(
    "local-account.status.read",
    "Read approved local account status",
    "Reads non-secret status flags for one supervisor-approved local account.",
    CapabilityDataClass.Confidential,
    CapabilityEffect.LocalRead,
    RecoveryKind.NotApplicable,
    LocalIdentityCapabilitySchemas.AccountArguments,
    LocalIdentityCapabilitySchemas.AccountResult,
    ["windows-local-account"]);

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    LocalIdentityCapabilitySchemas.ValidateAccount(arguments);

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    LocalIdentityCapabilitySchemas.ValidateAccountResult(result);

  public ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    var account = policy.ResolveAccount(
      arguments.GetProperty("accountId").GetString()!,
      requireRead: true);
    var state = identities.ReadAccount(account.AccountName);
    var output = JsonSerializer.Serialize(new
    {
      accountId = account.Id,
      enabled = state.Enabled,
      lockedOut = state.LockedOut,
      passwordRequired = state.PasswordRequired,
      passwordExpires = state.PasswordExpires,
      stateSha256 = state.StateSha256,
    });
    return ValueTask.FromResult(new CapabilityExecutionResult(
      output,
      MutationCommitted: false,
      OutcomeUncertain: false,
      Provenance:
      [
        Provenance(account, state.StateSha256),
      ],
      PreStateSha256: state.StateSha256,
      LocalBytesRead: GovernedWindowsCapabilitySupport.JsonByteCount(output)));
  }

  internal static DataProvenance Provenance(
    ResolvedLocalAccount account,
    string stateSha256) => GovernedWindowsCapabilitySupport.Provenance(
      "windows-local-account",
      $"{account.Id}\n{account.AccountName}",
      stateSha256);
}

internal sealed class LocalAccountEnabledSetCapabilityAdapter(
  LocalIdentityPolicy policy,
  IWindowsLocalIdentityManager identities,
  IHostRecoveryVault recoveryVault) : IHostCapabilityAdapter
{
  public CapabilityDescriptor Descriptor { get; } = GovernedWindowsCapabilitySupport.Descriptor(
    "local-account.enabled.set",
    "Enable or disable approved local account",
    "Changes only the enabled flag of one supervisor-approved non-built-in local account.",
    CapabilityDataClass.Confidential,
    CapabilityEffect.Administrative,
    RecoveryKind.Snapshot,
    LocalIdentityCapabilitySchemas.AccountSetArguments,
    LocalIdentityCapabilitySchemas.MutationResult,
    ["windows-local-account", "host-recovery-record"]);

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    LocalIdentityCapabilitySchemas.ValidateAccountSet(arguments);

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    LocalIdentityCapabilitySchemas.ValidateMutationResult(result);

  public async ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    RegistryValueSetCapabilityAdapter.RequireExpectedState(context);
    var account = policy.ResolveAccount(
      arguments.GetProperty("accountId").GetString()!,
      requireEnableDisable: true);
    var before = identities.ReadAccount(account.AccountName);
    RegistryValueSetCapabilityAdapter.MatchExpected(context, before.StateSha256);
    var desired = arguments.GetProperty("enabled").GetBoolean();
    if (desired == before.Enabled)
    {
      throw new HostPreconditionException("local_account_already_desired");
    }
    var recovery = await recoveryVault.PrepareAsync(
      context,
      Descriptor.Id,
      before.StateSha256,
      new { accountId = account.Id, account.AccountName, enabled = before.Enabled },
      irreversible: false,
      cancellationToken).ConfigureAwait(false);
    cancellationToken.ThrowIfCancellationRequested();
    identities.SetAccountEnabled(account.AccountName, desired);
    var after = identities.ReadAccount(account.AccountName);
    if (after.Enabled != desired)
    {
      throw new HostPreconditionException("local_account_postcondition_failed");
    }
    var output = JsonSerializer.Serialize(new { committed = true, stateSha256 = after.StateSha256 });
    return new CapabilityExecutionResult(
      output,
      MutationCommitted: true,
      OutcomeUncertain: false,
      Provenance:
      [
        LocalAccountStatusCapabilityAdapter.Provenance(account, after.StateSha256),
        RegistryValueSetCapabilityAdapter.RecoveryProvenance(recovery),
      ],
      OpaqueRecoveryHandle: recovery.OpaqueHandle,
      PreStateSha256: before.StateSha256,
      RecoveryProvenanceSha256: recovery.RecordSha256,
      LocalBytesRead: 64,
      LocalBytesWritten: 64);
  }
}

internal sealed class LocalGroupMembershipReadCapabilityAdapter(
  LocalIdentityPolicy policy,
  IWindowsLocalIdentityManager identities) : IHostCapabilityAdapter
{
  public CapabilityDescriptor Descriptor { get; } = GovernedWindowsCapabilitySupport.Descriptor(
    "local-group.membership.read",
    "Read approved local group membership",
    "Checks one supervisor-approved local account against one supervisor-approved local group.",
    CapabilityDataClass.Confidential,
    CapabilityEffect.LocalRead,
    RecoveryKind.NotApplicable,
    LocalIdentityCapabilitySchemas.MembershipArguments,
    LocalIdentityCapabilitySchemas.MembershipResult,
    ["windows-local-group"]);

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    LocalIdentityCapabilitySchemas.ValidateMembership(arguments, mutation: false);

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    LocalIdentityCapabilitySchemas.ValidateMembershipResult(result);

  public ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    var group = policy.ResolveGroup(
      arguments.GetProperty("groupId").GetString()!,
      requireRead: true);
    var account = policy.ResolveAccount(
      arguments.GetProperty("accountId").GetString()!,
      requireRead: true);
    var member = identities.IsGroupMember(group.GroupName, account.AccountName);
    var stateSha256 = MembershipState(group, account, member);
    var output = JsonSerializer.Serialize(new
    {
      groupId = group.Id,
      accountId = account.Id,
      member,
      stateSha256,
    });
    return ValueTask.FromResult(new CapabilityExecutionResult(
      output,
      MutationCommitted: false,
      OutcomeUncertain: false,
      Provenance:
      [
        Provenance(group, account, stateSha256),
      ],
      PreStateSha256: stateSha256,
      LocalBytesRead: GovernedWindowsCapabilitySupport.JsonByteCount(output)));
  }

  internal static string MembershipState(
    ResolvedLocalGroup group,
    ResolvedLocalAccount account,
    bool member) => GovernedWindowsCapabilitySupport.StateSha256(new
    {
      groupId = group.Id,
      accountId = account.Id,
      member,
    });

  internal static DataProvenance Provenance(
    ResolvedLocalGroup group,
    ResolvedLocalAccount account,
    string stateSha256) => GovernedWindowsCapabilitySupport.Provenance(
      "windows-local-group",
      $"{group.Id}\n{group.GroupName}\n{account.Id}\n{account.AccountName}",
      stateSha256);
}

internal sealed class LocalGroupMembershipSetCapabilityAdapter(
  LocalIdentityPolicy policy,
  IWindowsLocalIdentityManager identities,
  IHostRecoveryVault recoveryVault) : IHostCapabilityAdapter
{
  public CapabilityDescriptor Descriptor { get; } = GovernedWindowsCapabilitySupport.Descriptor(
    "local-group.membership.set",
    "Change approved local group membership",
    "Adds or removes one supervisor-approved non-built-in local account in one approved local group.",
    CapabilityDataClass.Confidential,
    CapabilityEffect.Administrative,
    RecoveryKind.Snapshot,
    LocalIdentityCapabilitySchemas.MembershipSetArguments,
    LocalIdentityCapabilitySchemas.MutationResult,
    ["windows-local-group", "host-recovery-record"]);

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    LocalIdentityCapabilitySchemas.ValidateMembership(arguments, mutation: true);

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    LocalIdentityCapabilitySchemas.ValidateMutationResult(result);

  public async ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    RegistryValueSetCapabilityAdapter.RequireExpectedState(context);
    var group = policy.ResolveGroup(
      arguments.GetProperty("groupId").GetString()!,
      requireMembershipChange: true);
    var account = policy.ResolveAccount(
      arguments.GetProperty("accountId").GetString()!,
      requireMembershipChange: true);
    var before = identities.IsGroupMember(group.GroupName, account.AccountName);
    var beforeSha256 = LocalGroupMembershipReadCapabilityAdapter.MembershipState(
      group,
      account,
      before);
    RegistryValueSetCapabilityAdapter.MatchExpected(context, beforeSha256);
    var desired = arguments.GetProperty("member").GetBoolean();
    if (desired == before)
    {
      throw new HostPreconditionException("local_group_membership_already_desired");
    }
    var recovery = await recoveryVault.PrepareAsync(
      context,
      Descriptor.Id,
      beforeSha256,
      new
      {
        groupId = group.Id,
        group.GroupName,
        accountId = account.Id,
        account.AccountName,
        member = before,
      },
      irreversible: false,
      cancellationToken).ConfigureAwait(false);
    cancellationToken.ThrowIfCancellationRequested();
    identities.SetGroupMember(group.GroupName, account.AccountName, desired);
    var after = identities.IsGroupMember(group.GroupName, account.AccountName);
    if (after != desired)
    {
      throw new HostPreconditionException("local_group_membership_postcondition_failed");
    }
    var afterSha256 = LocalGroupMembershipReadCapabilityAdapter.MembershipState(
      group,
      account,
      after);
    var output = JsonSerializer.Serialize(new { committed = true, stateSha256 = afterSha256 });
    return new CapabilityExecutionResult(
      output,
      MutationCommitted: true,
      OutcomeUncertain: false,
      Provenance:
      [
        LocalGroupMembershipReadCapabilityAdapter.Provenance(group, account, afterSha256),
        RegistryValueSetCapabilityAdapter.RecoveryProvenance(recovery),
      ],
      OpaqueRecoveryHandle: recovery.OpaqueHandle,
      PreStateSha256: beforeSha256,
      RecoveryProvenanceSha256: recovery.RecordSha256,
      LocalBytesRead: 64,
      LocalBytesWritten: 64);
  }
}
