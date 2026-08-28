using System.Security.Cryptography;
using Itemba.Msaidizi.Companion.Contracts.Security;

namespace Itemba.Msaidizi.Companion.Service.Security;

/// <summary>
/// One public-only trust-store entry for exactly one isolation signature
/// purpose. SubjectPublicKeyInfo deliberately cannot carry a private key.
/// </summary>
public sealed record PrivilegedCommandIsolationPublicKeyPin(
  string KeyId,
  string SignaturePurpose,
  string SubjectPublicKeyInfoBase64);

/// <summary>
/// Immutable, purpose-separated P-256 public-key resolver. A key ID is not an
/// authorization by itself: the exact (key ID, purpose) pair must be pinned.
/// </summary>
public sealed class ExactPurposeP256PublicKeyResolver :
  IPrivilegedCommandIsolationVerificationKeyResolver
{
  private const int MaximumPins = 16;
  private const int MaximumEncodedKeyCharacters = 512;

  private static readonly HashSet<string> AllowedPurposes = new(
  [
    PrivilegedCommandIsolationSignaturePurposes.ReservationLease,
    PrivilegedCommandIsolationSignaturePurposes.PreBindReservationRelease,
    PrivilegedCommandIsolationSignaturePurposes.SuspendedProcessBindAcknowledgement,
    PrivilegedCommandIsolationSignaturePurposes.TerminalEnforcementReceipt,
  ], StringComparer.Ordinal);

  private readonly Dictionary<(string KeyId, string Purpose), byte[]> _pins;

  public ExactPurposeP256PublicKeyResolver(
    IEnumerable<PrivilegedCommandIsolationPublicKeyPin> pins)
  {
    ArgumentNullException.ThrowIfNull(pins);
    var materialized = pins.ToArray();
    if (materialized.Length > MaximumPins)
    {
      throw new ArgumentOutOfRangeException(
        nameof(pins),
        "Too many privileged-command isolation public keys were supplied.");
    }

    var parsed = new Dictionary<(string KeyId, string Purpose), byte[]>();
    try
    {
      foreach (var pin in materialized)
      {
        ArgumentNullException.ThrowIfNull(pin);
        if (!IsSafeKeyId(pin.KeyId)
          || !AllowedPurposes.Contains(pin.SignaturePurpose))
        {
          throw new CryptographicException(
            "An isolation public-key pin has an invalid identity or purpose.");
        }

        var keyBytes = DecodeCanonicalSubjectPublicKeyInfo(pin);
        if (!parsed.TryAdd((pin.KeyId, pin.SignaturePurpose), keyBytes))
        {
          CryptographicOperations.ZeroMemory(keyBytes);
          throw new CryptographicException(
            "Duplicate isolation public-key pins are not allowed.");
        }
      }

      _pins = parsed;
    }
    catch
    {
      foreach (var keyBytes in parsed.Values)
      {
        CryptographicOperations.ZeroMemory(keyBytes);
      }
      throw;
    }
  }

  public bool TryResolve(
    string keyId,
    string signaturePurpose,
    out ECDsa? publicKey)
  {
    publicKey = null;
    if (!IsSafeKeyId(keyId)
      || !AllowedPurposes.Contains(signaturePurpose)
      || !_pins.TryGetValue((keyId, signaturePurpose), out var keyBytes))
    {
      return false;
    }

    ECDsa? candidate = null;
    try
    {
      candidate = ECDsa.Create();
      candidate.ImportSubjectPublicKeyInfo(keyBytes, out var consumed);
      if (consumed != keyBytes.Length || !IsP256(candidate))
      {
        candidate.Dispose();
        return false;
      }

      publicKey = candidate;
      return true;
    }
    catch (CryptographicException)
    {
      candidate?.Dispose();
      return false;
    }
  }

  private static byte[] DecodeCanonicalSubjectPublicKeyInfo(
    PrivilegedCommandIsolationPublicKeyPin pin)
  {
    if (string.IsNullOrWhiteSpace(pin.SubjectPublicKeyInfoBase64)
      || pin.SubjectPublicKeyInfoBase64.Length > MaximumEncodedKeyCharacters)
    {
      throw new CryptographicException(
        "An isolation public key is missing or oversized.");
    }

    byte[] keyBytes;
    try
    {
      keyBytes = Convert.FromBase64String(pin.SubjectPublicKeyInfoBase64);
    }
    catch (FormatException exception)
    {
      throw new CryptographicException(
        "An isolation public key is not canonical base64.",
        exception);
    }

    try
    {
      if (!string.Equals(
          Convert.ToBase64String(keyBytes),
          pin.SubjectPublicKeyInfoBase64,
          StringComparison.Ordinal))
      {
        throw new CryptographicException(
          "An isolation public key is not canonical base64.");
      }

      using var key = ECDsa.Create();
      key.ImportSubjectPublicKeyInfo(keyBytes, out var consumed);
      if (consumed != keyBytes.Length || !IsP256(key))
      {
        throw new CryptographicException(
          "Isolation verification keys must be public P-256 keys.");
      }

      var canonical = key.ExportSubjectPublicKeyInfo();
      if (!CryptographicOperations.FixedTimeEquals(canonical, keyBytes))
      {
        CryptographicOperations.ZeroMemory(canonical);
        throw new CryptographicException(
          "An isolation public key is not canonical SubjectPublicKeyInfo.");
      }
      CryptographicOperations.ZeroMemory(canonical);
      return keyBytes;
    }
    catch
    {
      CryptographicOperations.ZeroMemory(keyBytes);
      throw;
    }
  }

  private static bool IsP256(ECDsa key)
  {
    try
    {
      var parameters = key.ExportParameters(includePrivateParameters: false);
      return key.KeySize == 256
        && string.Equals(
          parameters.Curve.Oid.Value,
          ECCurve.NamedCurves.nistP256.Oid.Value,
          StringComparison.Ordinal);
    }
    catch (Exception exception) when (exception is CryptographicException
      or InvalidOperationException
      or NotSupportedException
      or ObjectDisposedException)
    {
      return false;
    }
  }

  private static bool IsSafeKeyId(string? value) =>
    !string.IsNullOrWhiteSpace(value)
    && value.Length <= 128
    && char.IsAsciiLetterOrDigit(value[0])
    && value.All(character => char.IsAsciiLetterOrDigit(character)
      || character is '.' or '-' or '_' or ':');
}
