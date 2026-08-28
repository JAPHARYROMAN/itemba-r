using System.Text.RegularExpressions;
using Itemba.Msaidizi.UpdateEvaluator.Protocol;

namespace Itemba.Msaidizi.UpdateEvaluator.Configuration;

public static class UpdateEvaluatorBootstrapValidator
{
  private static readonly Regex EnvironmentVariableName = new(
    "^[A-Z][A-Z0-9_]{2,127}$",
    RegexOptions.CultureInvariant | RegexOptions.NonBacktracking);

  public static void ValidateShape(UpdateEvaluatorOptions options)
  {
    if (!options.Enabled) return;
    if (!TryHttps(options.BrokerBaseUri, out var broker) ||
        !broker.AbsolutePath.EndsWith("/msaidizi/update-verifier/", StringComparison.Ordinal) ||
        !GeneratedManifestValidator.IsSha256(options.PinnedBrokerCertificateSha256) ||
        !GeneratedManifestValidator.IsSha256(options.PinnedBrokerSpkiSha256) ||
        string.Equals(options.PinnedBrokerCertificateSha256, options.PinnedBrokerSpkiSha256,
          StringComparison.Ordinal) ||
        string.IsNullOrWhiteSpace(options.TransportCertificateThumbprint) ||
        options.PollIntervalSeconds is < 2 or > 300 ||
        options.HeartbeatIntervalSeconds is < 5 or > 120 ||
        options.AttestationTtlSeconds is < 60 or > 3_600 ||
        options.ProtectedPolicyVersion != "msaidizi-generated-update-policy/v1" ||
        !GeneratedManifestValidator.IsSha256(options.ProtectedPolicySha256))
      throw new InvalidOperationException("Update evaluator transport or protocol configuration is invalid.");

    var root = Path.TrimEndingDirectorySeparator(Path.GetFullPath(options.EvaluatorRoot));
    var state = Path.GetFullPath(options.StatePath);
    var transfer = Path.GetFullPath(options.TransferPath);
    if (!Beneath(root, state) || !Beneath(root, transfer) ||
        !Directory.Exists(root) || !Directory.Exists(state) || !Directory.Exists(transfer))
      throw new InvalidOperationException("Update evaluator roots must be pre-created and service-owned.");
    var parent = Directory.GetParent(root)?.FullName
      ?? throw new InvalidOperationException("Update evaluator root has no parent.");
    var expectedKill = Path.GetFullPath(Path.Combine(parent, "supervisor", "DISABLED"));
    if (!string.Equals(Path.GetFullPath(options.KillSwitchPath), expectedKill,
          StringComparison.OrdinalIgnoreCase))
      throw new InvalidOperationException("Update evaluator must use the shared trusted kill switch.");

    ValidateSigner(options.ArtifactSigner);
    ValidateSigner(options.RunnerSigner);
    if (options.Reviewers.Count != 2) throw new InvalidOperationException(
      "Update evaluator requires exactly two independently configured reviewers.");
    foreach (var reviewer in options.Reviewers)
    {
      ValidateSigner(reviewer.Signer);
      if (!GeneratedManifestValidator.IsIdentifier(reviewer.ProviderId) ||
          !GeneratedManifestValidator.IsIdentifier(reviewer.ReviewerId) ||
          !GeneratedManifestValidator.IsIdentifier(reviewer.ModelId) ||
          !TryHttps(reviewer.Endpoint, out _) ||
          !GeneratedManifestValidator.IsSha256(reviewer.PinnedServerSpkiSha256) ||
          !EnvironmentVariableName.IsMatch(reviewer.ApiKeyEnvironmentVariable) ||
          reviewer.TimeoutSeconds is < 5 or > 600)
        throw new InvalidOperationException("Independent reviewer configuration is invalid.");
    }

    AssertDistinct(options.Reviewers.Select(value => value.ProviderId), "reviewer provider ids");
    AssertDistinct(options.Reviewers.Select(value => value.ReviewerId), "reviewer ids");
    AssertDistinct(options.Reviewers.Select(value => value.ModelId), "reviewer model ids");
    AssertDistinct(options.Reviewers.Select(value => value.ApiKeyEnvironmentVariable),
      "reviewer credential references");
    AssertDistinct(options.Reviewers.Select(value => Origin(value.Endpoint)),
      "reviewer HTTPS origins");
    AssertDistinct(new[] { options.ArtifactSigner.KeyId, options.RunnerSigner.KeyId }
      .Concat(options.Reviewers.Select(value => value.Signer.KeyId)), "attestation key ids");
    AssertDistinct(new[]
    {
      NormalizeThumbprint(options.TransportCertificateThumbprint),
      NormalizeThumbprint(options.ArtifactSigner.CertificateThumbprint),
      NormalizeThumbprint(options.RunnerSigner.CertificateThumbprint),
    }.Concat(options.Reviewers.Select(value =>
      NormalizeThumbprint(value.Signer.CertificateThumbprint))), "certificate thumbprints");

    var hyperV = options.HyperV;
    if (string.IsNullOrWhiteSpace(hyperV.VmName) ||
        string.IsNullOrWhiteSpace(hyperV.CleanSnapshotName) ||
        !GeneratedManifestValidator.IsIdentifier(hyperV.CleanSnapshotId) ||
        !Path.IsPathFullyQualified(hyperV.GuestCredentialPath) ||
        !Path.IsPathFullyQualified(hyperV.PowerShellExecutablePath) ||
        !Path.IsPathFullyQualified(hyperV.ProviderScriptPath) ||
        !GeneratedManifestValidator.IsSha256(hyperV.ProviderScriptSha256) ||
        hyperV.VmReadyTimeoutSeconds is < 30 or > 600 ||
        hyperV.ProviderOperationTimeoutSeconds is < 30 or > 1_800)
      throw new InvalidOperationException("Hyper-V update evaluator configuration is invalid.");

    var checks = new[] { "TESTS", "STATIC_ANALYSIS", "ADVERSARIAL" };
    if (options.Commands.Count is < 3 or > 24 ||
        checks.Any(check => !options.Commands.Any(command => command.Check == check)) ||
        options.Commands.Any(command => !checks.Contains(command.Check, StringComparer.Ordinal) ||
          string.IsNullOrWhiteSpace(command.FileName) || command.TimeoutSeconds is < 1 or > 1_800))
      throw new InvalidOperationException("Update evaluator check commands are incomplete.");
  }

  public static void ValidateIdentityFingerprints(
    string transportSpkiSha256,
    string artifactSpkiSha256,
    string runnerSpkiSha256,
    IEnumerable<string> reviewerSpkiSha256)
  {
    AssertDistinct(new[] { transportSpkiSha256, artifactSpkiSha256, runnerSpkiSha256 }
      .Concat(reviewerSpkiSha256), "transport and attestation SPKI fingerprints");
  }

  private static void ValidateSigner(AttestationSignerOptions signer)
  {
    if (!GeneratedManifestValidator.IsIdentifier(signer.KeyId) ||
        string.IsNullOrWhiteSpace(signer.CertificateThumbprint) ||
        string.IsNullOrWhiteSpace(signer.HardwareKeyProvider))
      throw new InvalidOperationException("Update evaluator signer configuration is invalid.");
  }

  private static void AssertDistinct(IEnumerable<string> values, string label)
  {
    var normalized = values.Select(value => value.Trim()).ToArray();
    if (normalized.Any(string.IsNullOrWhiteSpace) ||
        normalized.Distinct(StringComparer.OrdinalIgnoreCase).Count() != normalized.Length)
      throw new InvalidOperationException($"Update evaluator reuses {label}.");
  }

  private static bool TryHttps(string value, out Uri uri)
  {
    if (!Uri.TryCreate(value, UriKind.Absolute, out var parsed) ||
        parsed.Scheme != Uri.UriSchemeHttps ||
        !string.IsNullOrEmpty(parsed.UserInfo) || !string.IsNullOrEmpty(parsed.Query) ||
        !string.IsNullOrEmpty(parsed.Fragment))
    {
      uri = null!;
      return false;
    }
    uri = parsed;
    return true;
  }

  private static string Origin(string value)
  {
    _ = TryHttps(value, out var uri);
    return uri.GetLeftPart(UriPartial.Authority);
  }

  private static bool Beneath(string root, string path) =>
    path.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);

  private static string NormalizeThumbprint(string value) =>
    value.Replace(" ", string.Empty, StringComparison.Ordinal).ToUpperInvariant();

}
