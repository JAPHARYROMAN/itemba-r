using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;

namespace Itemba.Msaidizi.PrivilegedCommandSupervisor.Enforcement;

internal sealed record NetworkIsolationProtocolDescriptorV3(
  byte[] BootId,
  ulong Features,
  uint MaximumFrameBytes);

internal sealed record NetworkIsolationHealthV3(
  byte[] BootId,
  uint Status,
  uint HealthFlags,
  ulong BootTimeFileTime100ns,
  ulong CurrentPolicyGeneration,
  ulong KillGeneration,
  ulong PolicyExpiresAtFileTime100ns,
  ulong LastAcceptedRequestSequence,
  byte[] CurrentPolicySha256,
  byte[] BootMeasurementSha256,
  byte[] DriverImageSha256,
  uint EnrolledProcessCount,
  uint PolicyEntryCount,
  uint CalloutIdV4,
  uint CalloutIdV6,
  IReadOnlyList<ulong> Counters,
  byte[] ChallengeResponseSha256);

internal sealed record NetworkIsolationMutationResponseV3(
  uint Status,
  uint ErrorDetail,
  ulong CurrentPolicyGeneration,
  ulong AppliedRequestSequence,
  byte[] CurrentPolicySha256);

internal sealed record NetworkIsolationPolicyEntryV3(
  byte[] ProcessIdentitySha256,
  byte EndpointKind,
  byte AddressFamily,
  byte IpProtocol,
  byte PrefixLength,
  ushort RemotePort,
  byte[] RemoteAddress,
  ulong ExpiresAtFileTime100ns);

internal sealed record NetworkIsolationProcessEnrollmentV3(
  ulong ProcessId,
  ulong ProcessCreationTime100ns,
  ulong ProcessStartKey,
  ulong ExpiresAtFileTime100ns,
  byte[] ImageSha256,
  byte[] ProcessIdentitySha256,
  string NormalizedImageNtPath,
  byte[] NormalizedAppId);

/// <summary>
/// Closed, fixed-layout managed codec for
/// msaidizi_network_isolation_protocol.h. No marshalling layout or host byte
/// order is trusted: every integer is explicitly little-endian and every
/// response is checked against its exact size, version, type, request ID, boot
/// ID, flags, and reserved fields before any value is consumed.
/// </summary>
internal static class NetworkIsolationProtocolV3
{
  public const ushort Version = 3;
  public const int MaximumFrameBytes = 262_144;
  public const int MaximumPolicyEntries = 512;
  public const int MessageHeaderSize = 64;
  public const int ProtocolResponseSize = 104;
  public const int MutationResponseSize = 120;
  public const int PolicyEntrySize = 64;
  public const int PolicyReplaceBaseSize = 112;
  public const int ProcessEnrollmentRequestSize = 2_248;
  public const int ProcessRemoveRequestSize = 104;
  public const int KillRequestSize = 80;
  public const int HealthRequestSize = 96;
  public const int HealthCountersSize = 96;
  public const int HealthResponseSize = 360;
  public const int MessageRequestSequenceOffset = 16;
  public const int MessageRequestIdOffset = 32;
  public const int MessageBootIdOffset = 48;
  public const int PolicyRemoteAddressOffset = 40;
  public const int PolicyExpiryOffset = 56;
  public const int PolicyEntriesOffset = 112;
  public const int EnrollmentImagePathOffset = 168;
  public const int EnrollmentAppIdOffset = 1_208;
  public const int MaximumImagePathChars = 520;
  public const int MaximumAppIdBytes = 1_040;

  public const uint IoctlGetProtocol = 0x0022E040;
  public const uint IoctlGetHealth = 0x0022E044;
  public const uint IoctlReplacePolicy = 0x0022E048;
  public const uint IoctlEnrollProcess = 0x0022E04C;
  public const uint IoctlRemoveProcess = 0x0022E050;
  public const uint IoctlSetKillState = 0x0022E054;

  public const ushort MessageProtocolRequest = 1;
  public const ushort MessageProtocolResponse = 2;
  public const ushort MessageHealthRequest = 3;
  public const ushort MessageHealthResponse = 4;
  public const ushort MessagePolicyReplaceRequest = 5;
  public const ushort MessageProcessEnrollRequest = 6;
  public const ushort MessageProcessRemoveRequest = 7;
  public const ushort MessageKillRequest = 8;
  public const ushort MessageMutationResponse = 9;

  public const uint StatusOk = 0;
  public const uint StatusInvalidFrame = 1;
  public const uint StatusVersionMismatch = 2;
  public const uint StatusAccessDenied = 3;
  public const uint StatusBootMismatch = 4;
  public const uint StatusReplay = 5;
  public const uint StatusStaleGeneration = 6;
  public const uint StatusKillActive = 7;
  public const uint StatusPolicyInvalid = 8;
  public const uint StatusProcessIdentityMismatch = 9;
  public const uint StatusProcessNotFound = 10;
  public const uint StatusCapacity = 11;
  public const uint StatusInternalError = 12;
  public const uint StatusLegacyNotProvisioned = 13;

  public const ulong FeatureAleConnectV4 = 1UL << 0;
  public const ulong FeatureAleConnectV6 = 1UL << 1;
  public const ulong FeaturePidCreationBinding = 1UL << 2;
  public const ulong FeatureImagePathAppIdBinding = 1UL << 3;
  public const ulong FeatureImageSha256Binding = 1UL << 4;
  public const ulong FeatureAtomicMonotonicPolicy = 1UL << 5;
  public const ulong FeatureRequestReplayProtection = 1UL << 6;
  public const ulong FeaturePolicyExpiry = 1UL << 7;
  public const ulong FeatureLatchedKillState = 1UL << 8;
  public const ulong FeatureDynamicWfpSession = 1UL << 9;
  public const ulong FeatureProcessNotifyPidReuse = 1UL << 10;
  public const ulong FeatureHealthCounters = 1UL << 11;
  public const ulong FeatureBootMeasurementStatus = 1UL << 12;
  public const ulong RequiredFeatures = (1UL << 13) - 1;

  public const uint HealthWfpRegistered = 1U << 0;
  public const uint HealthPolicyActive = 1U << 1;
  public const uint HealthKillActive = 1U << 2;
  public const uint HealthUnloading = 1U << 3;
  public const uint HealthDriverMeasurementProvisioned = 1U << 4;
  public const uint HealthBootMeasurementProvisioned = 1U << 5;

  private static readonly byte[] ProcessIdentityDomain =
    Encoding.ASCII.GetBytes("MSAIDIZI-NETWORK-PROCESS-IDENTITY-V1\0");
  private static readonly byte[] PolicyDomain =
    Encoding.ASCII.GetBytes("MSAIDIZI-NETWORK-POLICY-V1\0");
  private static readonly byte[] HealthDomain =
    Encoding.ASCII.GetBytes("MSAIDIZI-NETWORK-DRIVER-HEALTH-V1\0");

  public static byte[] CreateProtocolRequest(Guid requestId)
  {
    var output = new byte[MessageHeaderSize];
    WriteHeader(
      output,
      MessageProtocolRequest,
      0,
      0,
      requestId,
      ReadOnlySpan<byte>.Empty);
    return output;
  }

  public static NetworkIsolationProtocolDescriptorV3 ParseProtocolResponse(
    ReadOnlySpan<byte> response,
    Guid requestId)
  {
    var header = ReadAndValidateHeader(
      response,
      ProtocolResponseSize,
      MessageProtocolResponse,
      requestId,
      ReadOnlySpan<byte>.Empty,
      requireNonzeroBootId: true);
    var minimumVersion = BinaryPrimitives.ReadUInt16LittleEndian(response[64..66]);
    var maximumVersion = BinaryPrimitives.ReadUInt16LittleEndian(response[66..68]);
    var maximumFrameBytes = BinaryPrimitives.ReadUInt32LittleEndian(response[68..72]);
    var features = BinaryPrimitives.ReadUInt64LittleEndian(response[72..80]);
    if (header.RequestSequence != 0
      || header.PolicyGeneration != 0
      || minimumVersion != Version
      || maximumVersion != Version
      || maximumFrameBytes != MaximumFrameBytes
      || features != RequiredFeatures
      || BinaryPrimitives.ReadUInt32LittleEndian(response[80..84]) != MessageHeaderSize
      || BinaryPrimitives.ReadUInt32LittleEndian(response[84..88]) != PolicyEntrySize
      || BinaryPrimitives.ReadUInt32LittleEndian(response[88..92]) != PolicyReplaceBaseSize
      || BinaryPrimitives.ReadUInt32LittleEndian(response[92..96])
        != ProcessEnrollmentRequestSize
      || BinaryPrimitives.ReadUInt32LittleEndian(response[96..100]) != HealthResponseSize
      || BinaryPrimitives.ReadUInt32LittleEndian(response[100..104]) != 0)
    {
      throw new InvalidDataException(
        "The network-isolation driver protocol descriptor is not the pinned v3 ABI.");
    }
    return new NetworkIsolationProtocolDescriptorV3(
      header.BootId,
      features,
      maximumFrameBytes);
  }

  public static byte[] CreateHealthRequest(
    Guid requestId,
    ReadOnlySpan<byte> bootId,
    ReadOnlySpan<byte> challengeNonce)
  {
    RequireLength(bootId, 16, nameof(bootId));
    RequireLength(challengeNonce, 32, nameof(challengeNonce));
    RequireNonzero(challengeNonce, nameof(challengeNonce));
    var output = new byte[HealthRequestSize];
    WriteHeader(output, MessageHealthRequest, 0, 0, requestId, bootId);
    challengeNonce.CopyTo(output.AsSpan(64, 32));
    return output;
  }

  public static NetworkIsolationHealthV3 ParseHealthResponse(
    ReadOnlySpan<byte> response,
    Guid requestId,
    ReadOnlySpan<byte> bootId,
    ReadOnlySpan<byte> challengeNonce)
  {
    var header = ReadAndValidateHeader(
      response,
      HealthResponseSize,
      MessageHealthResponse,
      requestId,
      bootId,
      requireNonzeroBootId: true);
    RequireLength(challengeNonce, 32, nameof(challengeNonce));
    if (header.RequestSequence != 0
      || header.PolicyGeneration != 0
      || BinaryPrimitives.ReadUInt32LittleEndian(response[224..228]) != 0
      || response[228..232].IndexOfAnyExcept((byte)0) >= 0)
    {
      throw new InvalidDataException(
        "The network-isolation health response reserved fields are nonzero.");
    }

    var expectedChallenge = Hash(HealthDomain, challengeNonce, response[..328]);
    try
    {
      if (!CryptographicOperations.FixedTimeEquals(expectedChallenge, response[328..360]))
      {
        throw new InvalidDataException(
          "The network-isolation health challenge response is invalid.");
      }
    }
    finally
    {
      CryptographicOperations.ZeroMemory(expectedChallenge);
    }

    var counters = new ulong[12];
    for (var index = 0; index < counters.Length; index++)
    {
      counters[index] = BinaryPrimitives.ReadUInt64LittleEndian(
        response.Slice(232 + (index * sizeof(ulong)), sizeof(ulong)));
    }
    return new NetworkIsolationHealthV3(
      response[48..64].ToArray(),
      BinaryPrimitives.ReadUInt32LittleEndian(response[64..68]),
      BinaryPrimitives.ReadUInt32LittleEndian(response[68..72]),
      BinaryPrimitives.ReadUInt64LittleEndian(response[72..80]),
      BinaryPrimitives.ReadUInt64LittleEndian(response[80..88]),
      BinaryPrimitives.ReadUInt64LittleEndian(response[88..96]),
      BinaryPrimitives.ReadUInt64LittleEndian(response[96..104]),
      BinaryPrimitives.ReadUInt64LittleEndian(response[104..112]),
      response[112..144].ToArray(),
      response[144..176].ToArray(),
      response[176..208].ToArray(),
      BinaryPrimitives.ReadUInt32LittleEndian(response[208..212]),
      BinaryPrimitives.ReadUInt32LittleEndian(response[212..216]),
      BinaryPrimitives.ReadUInt32LittleEndian(response[216..220]),
      BinaryPrimitives.ReadUInt32LittleEndian(response[220..224]),
      counters,
      response[328..360].ToArray());
  }

  public static byte[] CreatePolicyReplaceRequest(
    ulong sequence,
    ulong policyGeneration,
    Guid requestId,
    ReadOnlySpan<byte> bootId,
    ulong expiresAtFileTime100ns,
    IReadOnlyList<NetworkIsolationPolicyEntryV3> entries,
    out byte[] policySha256)
  {
    ArgumentNullException.ThrowIfNull(entries);
    if (entries.Count > MaximumPolicyEntries)
    {
      throw new ArgumentOutOfRangeException(
        nameof(entries),
        "The v3 policy entry ceiling was exceeded.");
    }
    var size = checked(PolicyReplaceBaseSize + (entries.Count * PolicyEntrySize));
    var output = new byte[size];
    WriteHeader(
      output,
      MessagePolicyReplaceRequest,
      sequence,
      policyGeneration,
      requestId,
      bootId);
    BinaryPrimitives.WriteUInt64LittleEndian(output.AsSpan(96, 8), expiresAtFileTime100ns);
    BinaryPrimitives.WriteUInt32LittleEndian(output.AsSpan(104, 4), checked((uint)entries.Count));
    for (var index = 0; index < entries.Count; index++)
    {
      if (entries[index].ExpiresAtFileTime100ns == 0
        || entries[index].ExpiresAtFileTime100ns > expiresAtFileTime100ns)
      {
        throw new ArgumentException(
          "A v3 policy entry expiry exceeds its policy snapshot.",
          nameof(entries));
      }
      WritePolicyEntry(output.AsSpan(112 + (index * PolicyEntrySize), PolicyEntrySize),
        entries[index]);
      if (index > 0
        && output.AsSpan(112 + ((index - 1) * PolicyEntrySize), PolicyEntrySize)
          .SequenceCompareTo(output.AsSpan(
            112 + (index * PolicyEntrySize),
            PolicyEntrySize)) >= 0)
      {
        throw new ArgumentException(
          "V3 policy entries must be strictly byte-sorted and unique.",
          nameof(entries));
      }
    }
    policySha256 = ComputePolicySha256(
      policyGeneration,
      expiresAtFileTime100ns,
      output.AsSpan(112));
    policySha256.CopyTo(output.AsSpan(64, 32));
    return output;
  }

  public static byte[] CreateEnrollmentRequest(
    ulong sequence,
    ulong policyGeneration,
    Guid requestId,
    ReadOnlySpan<byte> bootId,
    NetworkIsolationProcessEnrollmentV3 enrollment)
  {
    ArgumentNullException.ThrowIfNull(enrollment);
    RequireLength(enrollment.ImageSha256, 32, nameof(enrollment.ImageSha256));
    RequireLength(
      enrollment.ProcessIdentitySha256,
      32,
      nameof(enrollment.ProcessIdentitySha256));
    RequireNormalizedImagePath(enrollment.NormalizedImageNtPath);
    RequireNormalizedAppId(enrollment.NormalizedAppId);
    if (enrollment.ProcessId <= 4
      || enrollment.ProcessCreationTime100ns == 0
      || enrollment.ProcessStartKey == 0
      || enrollment.ExpiresAtFileTime100ns == 0
      || enrollment.ImageSha256.AsSpan().IndexOfAnyExcept((byte)0) < 0
      || enrollment.ProcessIdentitySha256.AsSpan().IndexOfAnyExcept((byte)0) < 0)
    {
      throw new ArgumentException(
        "The v3 process enrollment identity is incomplete.",
        nameof(enrollment));
    }
    var pathBytes = Encoding.Unicode.GetBytes(enrollment.NormalizedImageNtPath);
    var output = new byte[ProcessEnrollmentRequestSize];
    WriteHeader(
      output,
      MessageProcessEnrollRequest,
      sequence,
      policyGeneration,
      requestId,
      bootId);
    BinaryPrimitives.WriteUInt64LittleEndian(output.AsSpan(64, 8), enrollment.ProcessId);
    BinaryPrimitives.WriteUInt64LittleEndian(
      output.AsSpan(72, 8),
      enrollment.ProcessCreationTime100ns);
    BinaryPrimitives.WriteUInt64LittleEndian(output.AsSpan(80, 8), enrollment.ProcessStartKey);
    BinaryPrimitives.WriteUInt64LittleEndian(
      output.AsSpan(88, 8),
      enrollment.ExpiresAtFileTime100ns);
    enrollment.ImageSha256.CopyTo(output.AsSpan(96, 32));
    enrollment.ProcessIdentitySha256.CopyTo(output.AsSpan(128, 32));
    BinaryPrimitives.WriteUInt16LittleEndian(
      output.AsSpan(160, 2),
      checked((ushort)enrollment.NormalizedImageNtPath.Length));
    BinaryPrimitives.WriteUInt16LittleEndian(
      output.AsSpan(162, 2),
      checked((ushort)enrollment.NormalizedAppId.Length));
    pathBytes.CopyTo(output.AsSpan(168));
    enrollment.NormalizedAppId.CopyTo(output.AsSpan(1_208));
    CryptographicOperations.ZeroMemory(pathBytes);
    return output;
  }

  public static byte[] CreateRemovalRequest(
    ulong sequence,
    ulong policyGeneration,
    Guid requestId,
    ReadOnlySpan<byte> bootId,
    ulong processId,
    ReadOnlySpan<byte> processIdentitySha256)
  {
    RequireLength(processIdentitySha256, 32, nameof(processIdentitySha256));
    if (processId <= 4 || processIdentitySha256.IndexOfAnyExcept((byte)0) < 0)
    {
      throw new ArgumentException(
        "The v3 process removal identity is incomplete.",
        nameof(processId));
    }
    var output = new byte[ProcessRemoveRequestSize];
    WriteHeader(
      output,
      MessageProcessRemoveRequest,
      sequence,
      policyGeneration,
      requestId,
      bootId);
    BinaryPrimitives.WriteUInt64LittleEndian(output.AsSpan(64, 8), processId);
    processIdentitySha256.CopyTo(output.AsSpan(72, 32));
    return output;
  }

  public static byte[] CreateKillRequest(
    ulong sequence,
    Guid requestId,
    ReadOnlySpan<byte> bootId,
    ulong killGeneration,
    uint reasonCode)
  {
    if (killGeneration == 0 || reasonCode == 0)
    {
      throw new ArgumentOutOfRangeException(
        nameof(killGeneration),
        "Kill generation and reason must be nonzero.");
    }
    var output = new byte[KillRequestSize];
    WriteHeader(output, MessageKillRequest, sequence, 0, requestId, bootId);
    BinaryPrimitives.WriteUInt64LittleEndian(output.AsSpan(64, 8), killGeneration);
    BinaryPrimitives.WriteUInt32LittleEndian(output.AsSpan(72, 4), reasonCode);
    return output;
  }

  public static NetworkIsolationMutationResponseV3 ParseMutationResponse(
    ReadOnlySpan<byte> response,
    Guid requestId,
    ReadOnlySpan<byte> bootId,
    ulong expectedSequence,
    ulong expectedHeaderPolicyGeneration)
  {
    var header = ReadAndValidateHeader(
      response,
      MutationResponseSize,
      MessageMutationResponse,
      requestId,
      bootId,
      requireNonzeroBootId: true);
    if (header.RequestSequence != expectedSequence
      || header.PolicyGeneration != expectedHeaderPolicyGeneration)
    {
      throw new InvalidDataException(
        "The network-isolation mutation response does not bind the exact request.");
    }
    return new NetworkIsolationMutationResponseV3(
      BinaryPrimitives.ReadUInt32LittleEndian(response[64..68]),
      BinaryPrimitives.ReadUInt32LittleEndian(response[68..72]),
      BinaryPrimitives.ReadUInt64LittleEndian(response[72..80]),
      BinaryPrimitives.ReadUInt64LittleEndian(response[80..88]),
      response[88..120].ToArray());
  }

  public static byte[] ComputeProcessIdentitySha256(
    ulong processId,
    ulong processCreationTime100ns,
    ulong processStartKey,
    ReadOnlySpan<byte> imageSha256,
    string normalizedImageNtPath,
    ReadOnlySpan<byte> normalizedAppId)
  {
    RequireLength(imageSha256, 32, nameof(imageSha256));
    RequireNormalizedImagePath(normalizedImageNtPath);
    RequireNormalizedAppId(normalizedAppId);
    var scalar = new byte[26];
    BinaryPrimitives.WriteUInt64LittleEndian(scalar.AsSpan(0, 8), processId);
    BinaryPrimitives.WriteUInt64LittleEndian(
      scalar.AsSpan(8, 8),
      processCreationTime100ns);
    BinaryPrimitives.WriteUInt64LittleEndian(scalar.AsSpan(16, 8), processStartKey);
    BinaryPrimitives.WriteUInt16LittleEndian(
      scalar.AsSpan(24, 2),
      checked((ushort)normalizedImageNtPath.Length));
    var appLength = new byte[2];
    BinaryPrimitives.WriteUInt16LittleEndian(
      appLength,
      checked((ushort)normalizedAppId.Length));
    var path = Encoding.Unicode.GetBytes(normalizedImageNtPath);
    try
    {
      return Hash(
        ProcessIdentityDomain,
        scalar.AsSpan(0, 24),
        imageSha256,
        scalar.AsSpan(24, 2),
        path,
        appLength,
        normalizedAppId);
    }
    finally
    {
      CryptographicOperations.ZeroMemory(scalar);
      CryptographicOperations.ZeroMemory(appLength);
      CryptographicOperations.ZeroMemory(path);
    }
  }

  public static Guid DeriveRequestId(string purpose, string idempotencyKey)
  {
    ArgumentException.ThrowIfNullOrWhiteSpace(purpose);
    ArgumentException.ThrowIfNullOrWhiteSpace(idempotencyKey);
    var bytes = Encoding.UTF8.GetBytes($"MSAIDIZI-NETWORK-V3-REQUEST\0{purpose}\0{idempotencyKey}");
    var digest = SHA256.HashData(bytes);
    try
    {
      return new Guid(digest.AsSpan(0, 16));
    }
    finally
    {
      CryptographicOperations.ZeroMemory(bytes);
      CryptographicOperations.ZeroMemory(digest);
    }
  }

  public static string Sha256Hex(params ReadOnlyMemory<byte>[] values)
  {
    using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
    foreach (var value in values)
    {
      hash.AppendData(value.Span);
    }
    return Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant();
  }

  private static byte[] ComputePolicySha256(
    ulong policyGeneration,
    ulong expiresAtFileTime100ns,
    ReadOnlySpan<byte> entries)
  {
    if (entries.Length % PolicyEntrySize != 0)
    {
      throw new ArgumentException("Policy entries are not exactly framed.", nameof(entries));
    }
    var scalar = new byte[20];
    BinaryPrimitives.WriteUInt64LittleEndian(scalar.AsSpan(0, 8), policyGeneration);
    BinaryPrimitives.WriteUInt64LittleEndian(scalar.AsSpan(8, 8), expiresAtFileTime100ns);
    BinaryPrimitives.WriteUInt32LittleEndian(
      scalar.AsSpan(16, 4),
      checked((uint)(entries.Length / PolicyEntrySize)));
    try
    {
      return Hash(PolicyDomain, scalar, entries);
    }
    finally
    {
      CryptographicOperations.ZeroMemory(scalar);
    }
  }

  private static void WritePolicyEntry(
    Span<byte> output,
    NetworkIsolationPolicyEntryV3 entry)
  {
    ArgumentNullException.ThrowIfNull(entry);
    RequireLength(entry.ProcessIdentitySha256, 32, nameof(entry.ProcessIdentitySha256));
    RequireLength(entry.RemoteAddress, 16, nameof(entry.RemoteAddress));
    if (entry.EndpointKind is not (1 or 2)
      || entry.AddressFamily is not (4 or 6)
      || entry.IpProtocol is not (6 or 17)
      || entry.RemotePort == 0
      || (entry.AddressFamily == 4 && entry.PrefixLength > 32)
      || (entry.AddressFamily == 6 && entry.PrefixLength > 128))
    {
      throw new ArgumentException("The v3 policy entry is outside the closed ABI.", nameof(entry));
    }
    var addressBytes = entry.AddressFamily == 4 ? 4 : 16;
    if (entry.RemoteAddress.AsSpan(addressBytes).IndexOfAnyExcept((byte)0) >= 0
      || !AddressHasZeroHostBits(
        entry.RemoteAddress.AsSpan(0, addressBytes),
        entry.PrefixLength))
    {
      throw new ArgumentException(
        "The v3 policy address is not a canonical network prefix.",
        nameof(entry));
    }
    entry.ProcessIdentitySha256.CopyTo(output[..32]);
    output[32] = entry.EndpointKind;
    output[33] = entry.AddressFamily;
    output[34] = entry.IpProtocol;
    output[35] = entry.PrefixLength;
    BinaryPrimitives.WriteUInt16LittleEndian(output[36..38], entry.RemotePort);
    entry.RemoteAddress.CopyTo(output[40..56]);
    BinaryPrimitives.WriteUInt64LittleEndian(output[56..64], entry.ExpiresAtFileTime100ns);
  }

  private static void WriteHeader(
    Span<byte> output,
    ushort messageType,
    ulong requestSequence,
    ulong policyGeneration,
    Guid requestId,
    ReadOnlySpan<byte> bootId)
  {
    if (output.Length < MessageHeaderSize || requestId == Guid.Empty)
    {
      throw new ArgumentException("The v3 message header is invalid.", nameof(output));
    }
    output[..MessageHeaderSize].Clear();
    BinaryPrimitives.WriteUInt32LittleEndian(output[0..4], checked((uint)output.Length));
    BinaryPrimitives.WriteUInt16LittleEndian(output[4..6], Version);
    BinaryPrimitives.WriteUInt16LittleEndian(output[6..8], messageType);
    BinaryPrimitives.WriteUInt64LittleEndian(output[16..24], requestSequence);
    BinaryPrimitives.WriteUInt64LittleEndian(output[24..32], policyGeneration);
    if (!requestId.TryWriteBytes(output[32..48]))
    {
      throw new InvalidOperationException("The v3 request ID could not be encoded.");
    }
    if (!bootId.IsEmpty)
    {
      RequireLength(bootId, 16, nameof(bootId));
      RequireNonzero(bootId, nameof(bootId));
      bootId.CopyTo(output[48..64]);
    }
  }

  private static Header ReadAndValidateHeader(
    ReadOnlySpan<byte> response,
    int expectedSize,
    ushort expectedMessageType,
    Guid expectedRequestId,
    ReadOnlySpan<byte> expectedBootId,
    bool requireNonzeroBootId)
  {
    if (response.Length != expectedSize
      || BinaryPrimitives.ReadUInt32LittleEndian(response[0..4]) != expectedSize
      || BinaryPrimitives.ReadUInt16LittleEndian(response[4..6]) != Version
      || BinaryPrimitives.ReadUInt16LittleEndian(response[6..8]) != expectedMessageType
      || BinaryPrimitives.ReadUInt32LittleEndian(response[8..12]) != 0
      || BinaryPrimitives.ReadUInt32LittleEndian(response[12..16]) != 0)
    {
      throw new InvalidDataException(
        "The network-isolation driver response header is malformed.");
    }
    Span<byte> requestId = stackalloc byte[16];
    _ = expectedRequestId.TryWriteBytes(requestId);
    if (!CryptographicOperations.FixedTimeEquals(requestId, response[32..48]))
    {
      throw new InvalidDataException(
        "The network-isolation driver response request ID is mismatched.");
    }
    if ((!expectedBootId.IsEmpty
        && !CryptographicOperations.FixedTimeEquals(expectedBootId, response[48..64]))
      || (requireNonzeroBootId && response[48..64].IndexOfAnyExcept((byte)0) < 0))
    {
      throw new InvalidDataException(
        "The network-isolation driver response boot identity is mismatched.");
    }
    return new Header(
      BinaryPrimitives.ReadUInt64LittleEndian(response[16..24]),
      BinaryPrimitives.ReadUInt64LittleEndian(response[24..32]),
      response[48..64].ToArray());
  }

  private static byte[] Hash(
    ReadOnlySpan<byte> first,
    ReadOnlySpan<byte> second,
    ReadOnlySpan<byte> third)
  {
    using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
    hash.AppendData(first);
    hash.AppendData(second);
    hash.AppendData(third);
    return hash.GetHashAndReset();
  }

  private static byte[] Hash(
    ReadOnlySpan<byte> first,
    ReadOnlySpan<byte> second,
    ReadOnlySpan<byte> third,
    ReadOnlySpan<byte> fourth,
    ReadOnlySpan<byte> fifth,
    ReadOnlySpan<byte> sixth,
    ReadOnlySpan<byte> seventh)
  {
    using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
    hash.AppendData(first);
    hash.AppendData(second);
    hash.AppendData(third);
    hash.AppendData(fourth);
    hash.AppendData(fifth);
    hash.AppendData(sixth);
    hash.AppendData(seventh);
    return hash.GetHashAndReset();
  }

  private static void RequireNormalizedImagePath(string value)
  {
    ArgumentException.ThrowIfNullOrWhiteSpace(value);
    if (value.Length is < 9 or >= MaximumImagePathChars
      || value[0] != '\\'
      || value.Any(character => character < 0x20
        || character == '/'
        || char.ToUpperInvariant(character) != character))
    {
      throw new ArgumentException(
        "The v3 image NT path is not canonical uppercase UTF-16.",
        nameof(value));
    }
  }

  private static bool AddressHasZeroHostBits(
    ReadOnlySpan<byte> address,
    int prefixLength)
  {
    for (var index = 0; index < address.Length; index++)
    {
      var bitsBefore = index * 8;
      if (prefixLength >= bitsBefore + 8)
      {
        continue;
      }
      if (prefixLength <= bitsBefore)
      {
        if (address[index] != 0)
        {
          return false;
        }
      }
      else
      {
        var hostBits = 8 - (prefixLength - bitsBefore);
        var hostMask = (1 << hostBits) - 1;
        if ((address[index] & hostMask) != 0)
        {
          return false;
        }
      }
    }
    return true;
  }

  private static void RequireNormalizedAppId(ReadOnlySpan<byte> value)
  {
    if (value.Length < 2
      || value.Length > MaximumAppIdBytes
      || value.Length % 2 != 0)
    {
      throw new ArgumentException("The v3 WFP application ID is invalid.", nameof(value));
    }
    for (var offset = 0; offset < value.Length; offset += 2)
    {
      var character = BinaryPrimitives.ReadUInt16LittleEndian(value[offset..(offset + 2)]);
      if ((character == 0 && offset + 2 != value.Length)
        || (character != 0 && character < 0x20))
      {
        throw new ArgumentException("The v3 WFP application ID is invalid.", nameof(value));
      }
    }
  }

  private static void RequireLength(ReadOnlySpan<byte> value, int length, string name)
  {
    if (value.Length != length)
    {
      throw new ArgumentException($"{name} must contain exactly {length} bytes.", name);
    }
  }

  private static void RequireNonzero(ReadOnlySpan<byte> value, string name)
  {
    if (value.IndexOfAnyExcept((byte)0) < 0)
    {
      throw new ArgumentException($"{name} must not be all zero.", name);
    }
  }

  private sealed record Header(
    ulong RequestSequence,
    ulong PolicyGeneration,
    byte[] BootId);
}
