using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Itemba.Msaidizi.RecoverySupervisor.Configuration;
using Itemba.Msaidizi.RecoverySupervisor.Contracts;

namespace Itemba.Msaidizi.RecoverySupervisor.Security;

public sealed partial class RecoveryManifestVerifier
{
  private static readonly JsonSerializerOptions StrictJson = new()
  {
    PropertyNameCaseInsensitive = false,
    UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
  };
  private readonly RecoverySupervisorOptions _options;
  private readonly TimeProvider _time;

  public RecoveryManifestVerifier(
    RecoverySupervisorOptions options,
    TimeProvider? time = null)
  {
    _options = options.Expand();
    _time = time ?? TimeProvider.System;
  }

  public TrustedRecoveryManifest Verify(SignedRecoveryCommand command)
  {
    if (!string.Equals(command.SigningKeyId, _options.RecoveryKeyId, StringComparison.Ordinal))
      throw new CryptographicException("The recovery manifest key id is not pinned.");
    var manifestBytes = Encoding.UTF8.GetBytes(command.ManifestJson);
    var digest = Convert.ToHexString(SHA256.HashData(manifestBytes)).ToLowerInvariant();
    if (!FixedHexEquals(digest, command.ManifestSha256))
      throw new CryptographicException("The recovery manifest digest does not match its bytes.");

    using var verifier = LoadPinnedKey();
    var signature = DecodeBase64Url(command.Signature);
    if (signature.Length != 64 || !verifier.VerifyData(
          manifestBytes,
          signature,
          HashAlgorithmName.SHA256,
          DSASignatureFormat.IeeeP1363FixedFieldConcatenation))
      throw new CryptographicException("The recovery manifest signature is invalid.");

    var manifest = JsonSerializer.Deserialize<TrustedRecoveryManifest>(
      command.ManifestJson,
      StrictJson) ?? throw new InvalidDataException("The signed recovery manifest is empty.");
    ValidateClaims(command, manifest);
    return manifest;
  }

  private ECDsa LoadPinnedKey()
  {
    var path = Path.GetFullPath(_options.PinnedRecoveryPublicKeyPath);
    var supervisor = Path.TrimEndingDirectorySeparator(Path.GetFullPath(_options.SupervisorRoot));
    if (!path.StartsWith(supervisor + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
      throw new CryptographicException("The recovery key must remain beneath the recovery supervisor root.");
    if (!File.Exists(path)) throw new CryptographicException("The pinned recovery key is missing.");
    var key = ECDsa.Create();
    key.ImportFromPem(File.ReadAllText(path));
    if (key.KeySize != 256) throw new CryptographicException("The recovery key must be P-256.");
    var actual = Convert.ToHexString(SHA256.HashData(key.ExportSubjectPublicKeyInfo()))
      .ToLowerInvariant();
    if (!FixedHexEquals(actual, _options.PinnedRecoveryPublicKeySha256))
    {
      key.Dispose();
      throw new CryptographicException("The recovery public key does not match its pinned digest.");
    }
    return key;
  }

  private void ValidateClaims(
    SignedRecoveryCommand command,
    TrustedRecoveryManifest manifest)
  {
    var now = _time.GetUtcNow();
    if (manifest.SchemaVersion != 2 ||
        !Guid.TryParse(manifest.RecoveryId, out _) ||
        !string.Equals(manifest.RecoveryId, command.RecoveryId, StringComparison.Ordinal) ||
        !string.Equals(manifest.DeviceId, _options.DeviceId, StringComparison.Ordinal) ||
        !Guid.TryParse(manifest.DeviceId, out _) ||
        !Guid.TryParse(manifest.OriginalActionId, out _) ||
        !Sha256Hex().IsMatch(manifest.RecoveryRecordSha256) ||
        !Sha256Hex().IsMatch(manifest.ExpectedCurrentStateSha256) ||
        !Sha256Hex().IsMatch(manifest.ExpectedRestoredStateSha256) ||
        !Sha256Hex().IsMatch(manifest.IdempotencyKey) ||
        manifest.IssuedAt > now.AddMinutes(2) ||
        manifest.ExpiresAt <= now ||
        manifest.ExpiresAt <= manifest.IssuedAt ||
        manifest.ExpiresAt - manifest.IssuedAt > TimeSpan.FromHours(1))
      throw new InvalidDataException("The signed recovery manifest claims are invalid.");
  }

  private static bool FixedHexEquals(string left, string right)
  {
    if (!Sha256Hex().IsMatch(left) || !Sha256Hex().IsMatch(right)) return false;
    return CryptographicOperations.FixedTimeEquals(
      Convert.FromHexString(left),
      Convert.FromHexString(right));
  }

  private static byte[] DecodeBase64Url(string value)
  {
    var padded = value.Replace('-', '+').Replace('_', '/');
    padded += new string('=', (4 - padded.Length % 4) % 4);
    try { return Convert.FromBase64String(padded); }
    catch (FormatException error)
    {
      throw new CryptographicException("Invalid recovery signature encoding.", error);
    }
  }

  [GeneratedRegex("^[0-9a-f]{64}$", RegexOptions.CultureInvariant)]
  private static partial Regex Sha256Hex();
}
