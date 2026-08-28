using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Itemba.Msaidizi.UpdateSupervisor.Configuration;
using Itemba.Msaidizi.UpdateSupervisor.Contracts;

namespace Itemba.Msaidizi.UpdateSupervisor.Security;

public sealed partial class ManifestVerifier
{
  private static readonly HashSet<string> Operations = new(["APPLY", "ROLLBACK"], StringComparer.Ordinal);
  private static readonly HashSet<int> Rings = [0, 5, 25, 100];
  private static readonly JsonSerializerOptions StrictJson = new()
  {
    PropertyNameCaseInsensitive = false,
    UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
  };
  private readonly UpdateSupervisorOptions _options;
  private readonly TimeProvider _time;

  public ManifestVerifier(UpdateSupervisorOptions options, TimeProvider? time = null)
  {
    _options = options.Expand();
    _time = time ?? TimeProvider.System;
  }

  public TrustedUpdateManifest Verify(SignedUpdateCommand command)
    => Verify(command, allowExpiredInFlight: false);

  internal TrustedUpdateManifest VerifyPersistedInFlight(SignedUpdateCommand command)
    => Verify(command, allowExpiredInFlight: true);

  private TrustedUpdateManifest Verify(
    SignedUpdateCommand command,
    bool allowExpiredInFlight)
  {
    if (!string.Equals(command.SigningKeyId, _options.BootstrapKeyId, StringComparison.Ordinal))
      throw new CryptographicException("The update manifest key id is not pinned.");
    var manifestBytes = Encoding.UTF8.GetBytes(command.ManifestJson);
    var digest = Convert.ToHexString(SHA256.HashData(manifestBytes)).ToLowerInvariant();
    if (!FixedHexEquals(digest, command.ManifestSha256))
      throw new CryptographicException("The update manifest digest does not match its bytes.");

    using var verifier = LoadPinnedKey();
    var signature = DecodeBase64Url(command.Signature);
    if (signature.Length != 64 || !verifier.VerifyData(
          manifestBytes,
          signature,
          HashAlgorithmName.SHA256,
          DSASignatureFormat.IeeeP1363FixedFieldConcatenation))
      throw new CryptographicException("The update manifest signature is invalid.");

    var manifest = JsonSerializer.Deserialize<TrustedUpdateManifest>(command.ManifestJson, StrictJson)
      ?? throw new InvalidDataException("The signed update manifest is empty.");
    ValidateClaims(command, manifest, allowExpiredInFlight);
    return manifest;
  }

  private ECDsa LoadPinnedKey()
  {
    var path = Path.GetFullPath(_options.PinnedBootstrapPublicKeyPath);
    var supervisor = Path.TrimEndingDirectorySeparator(Path.GetFullPath(_options.SupervisorRoot));
    if (!path.StartsWith(supervisor + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
      throw new CryptographicException("The bootstrap key must remain beneath the supervisor root.");
    if (!File.Exists(path)) throw new CryptographicException("The pinned bootstrap key is missing.");
    var key = ECDsa.Create();
    key.ImportFromPem(File.ReadAllText(path));
    if (key.KeySize != 256) throw new CryptographicException("The bootstrap key must be P-256.");
    var actual = Convert.ToHexString(SHA256.HashData(key.ExportSubjectPublicKeyInfo())).ToLowerInvariant();
    if (!FixedHexEquals(actual, _options.PinnedBootstrapPublicKeySha256))
    {
      key.Dispose();
      throw new CryptographicException("The bootstrap public key does not match its pinned digest.");
    }
    return key;
  }

  private void ValidateClaims(
    SignedUpdateCommand command,
    TrustedUpdateManifest manifest,
    bool allowExpiredInFlight)
  {
    var now = _time.GetUtcNow();
    if (manifest.SchemaVersion != 2 ||
        !Guid.TryParse(manifest.DeploymentId, out _) ||
        !Guid.TryParse(manifest.CandidateId, out _) ||
        !Guid.TryParse(manifest.DeliveryLeaseId, out _) ||
        !string.Equals(manifest.DeploymentId, command.DeploymentId, StringComparison.Ordinal) ||
        !string.Equals(manifest.DeliveryLeaseId, command.DeliveryLeaseId, StringComparison.Ordinal) ||
        !string.Equals(manifest.DeviceId, _options.DeviceId, StringComparison.Ordinal) ||
        !Operations.Contains(manifest.Operation) ||
        !Rings.Contains(manifest.Ring) ||
        !SafeIdentifier().IsMatch(manifest.TargetId) ||
        !SafeVersion().IsMatch(manifest.Version) ||
        !SafeVersion().IsMatch(manifest.RollbackVersion) ||
        !Sha256Hex().IsMatch(manifest.SourceArtifactSha256) ||
        !Sha256Hex().IsMatch(manifest.RollbackArtifactSha256) ||
        !Sha256Hex().IsMatch(manifest.IdempotencyKey) ||
        manifest.DeliveryAttempt is < 1 or > 1_000_000 ||
        manifest.MinimumHealthySoakSeconds < 1 ||
        manifest.MinimumHealthySoakSeconds >= manifest.HealthTimeoutSeconds ||
        manifest.MinimumRingDwellSeconds < RequiredRingDwellSeconds(manifest.Ring) ||
        manifest.IssuedAt > now.AddMinutes(2) ||
        (!allowExpiredInFlight && manifest.ExpiresAt <= now) ||
        manifest.ExpiresAt <= manifest.IssuedAt)
      throw new InvalidDataException("The signed update manifest claims are invalid.");
  }

  private static int RequiredRingDwellSeconds(int ring) => ring switch
  {
    0 or 5 => 86_400,
    25 => 172_800,
    100 => 259_200,
    _ => int.MaxValue,
  };

  private static bool FixedHexEquals(string left, string right)
  {
    if (!Sha256Hex().IsMatch(right)) return false;
    return CryptographicOperations.FixedTimeEquals(
      Convert.FromHexString(left), Convert.FromHexString(right));
  }

  private static byte[] DecodeBase64Url(string value)
  {
    var padded = value.Replace('-', '+').Replace('_', '/');
    padded += new string('=', (4 - padded.Length % 4) % 4);
    try { return Convert.FromBase64String(padded); }
    catch (FormatException error) { throw new CryptographicException("Invalid signature encoding.", error); }
  }

  [GeneratedRegex("^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$", RegexOptions.CultureInvariant)]
  private static partial Regex SafeIdentifier();
  [GeneratedRegex("^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$", RegexOptions.CultureInvariant)]
  private static partial Regex SafeVersion();
  [GeneratedRegex("^[0-9a-f]{64}$", RegexOptions.CultureInvariant)]
  private static partial Regex Sha256Hex();
}
