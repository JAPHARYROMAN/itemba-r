using System.Text.RegularExpressions;
using Itemba.Msaidizi.UpdateSupervisor.Configuration;

namespace Itemba.Msaidizi.UpdateSupervisor.Security;

/// <summary>
/// Resolves only exact, installer-owned target IDs. Path overlap is checked in
/// both directions so a candidate cannot replace a parent of the trusted root.
/// </summary>
public sealed partial class ImmutableTargetPolicy
{
  private readonly UpdateSupervisorOptions _options;
  private readonly Dictionary<string, UpdateTargetOptions> _targets;
  private readonly string[] _protectedRoots;

  public ImmutableTargetPolicy(UpdateSupervisorOptions options)
  {
    _options = options.Expand();
    _protectedRoots = new[]
      {
        _options.SupervisorRoot,
        AppContext.BaseDirectory,
        Environment.SystemDirectory,
      }
      .Concat(_options.ProtectedRoots)
      .Select(CanonicalDirectory)
      .Distinct(StringComparer.OrdinalIgnoreCase)
      .ToArray();
    _targets = _options.Targets.ToDictionary(target => target.TargetId, StringComparer.Ordinal);
    if (_targets.Count != _options.Targets.Count)
      throw new InvalidOperationException("Update target IDs must be unique.");
    foreach (var target in _targets.Values) ValidateTarget(target);
  }

  public UpdateTargetOptions Resolve(
    string targetId,
    int requestedHealthTimeoutSeconds,
    int requestedMinimumHealthySoakSeconds)
  {
    var target = ResolveForRecovery(targetId);
    if (requestedHealthTimeoutSeconds is < 5 ||
        requestedHealthTimeoutSeconds > target.MaxHealthTimeoutSeconds ||
        requestedMinimumHealthySoakSeconds < target.MinimumHealthySoakSeconds ||
        requestedMinimumHealthySoakSeconds + target.HealthProbeIntervalSeconds >
          requestedHealthTimeoutSeconds)
      throw new UnauthorizedAccessException(
        "The signed health timeout or soak conflicts with immutable supervisor policy.");
    return target;
  }

  public UpdateTargetOptions ResolveForRecovery(string targetId)
  {
    if (!_targets.TryGetValue(targetId, out var target))
      throw new UnauthorizedAccessException("The signed target is not in the immutable allowlist.");
    ValidateTarget(target);
    return target;
  }

  private void ValidateTarget(UpdateTargetOptions target)
  {
    if (!SafeTargetId().IsMatch(target.TargetId))
      throw new InvalidOperationException("An update target ID is invalid.");
    if (target.MaxPackageBytes is < 1 or > 1_073_741_824 ||
        target.MaxExpandedBytes < target.MaxPackageBytes ||
        target.MaxExpandedBytes > 10_737_418_240 ||
        target.MaxFileCount is < 1 or > 250_000)
      throw new InvalidOperationException("An update target package budget is invalid.");
    if (target.MaxHealthTimeoutSeconds is < 5 or > 3_600 ||
        target.MinimumHealthySoakSeconds is < 1 or > 3_599 ||
        target.HealthProbeIntervalSeconds is < 1 or > 60 ||
        target.MinimumHealthySoakSeconds + target.HealthProbeIntervalSeconds >
          target.MaxHealthTimeoutSeconds)
      throw new InvalidOperationException("An update target health-soak policy is invalid.");
    if (target.ActivationMode is not ("ExternalPointerWatcher" or "WindowsServiceRestart") ||
        (target.ActivationMode == "WindowsServiceRestart" &&
         (string.IsNullOrWhiteSpace(target.WindowsServiceName) ||
          !SafeServiceName().IsMatch(target.WindowsServiceName))))
      throw new InvalidOperationException("An update target activation policy is invalid.");
    if (target.RequireObservedVersion &&
        (string.IsNullOrWhiteSpace(target.HealthProbeUri) ||
         !SafeHeaderName().IsMatch(target.ObservedVersionHeaderName)))
      throw new InvalidOperationException(
        "Version-observing update targets require an immutable HTTP health probe and header.");
    var versions = CanonicalDirectory(target.VersionsRoot);
    var pointer = Path.GetFullPath(target.ActivePointerPath);
    if (!Path.IsPathFullyQualified(versions) || !Path.IsPathFullyQualified(pointer))
      throw new InvalidOperationException("Update targets require absolute paths.");
    foreach (var protectedRoot in _protectedRoots)
    {
      if (Overlaps(versions, protectedRoot) || Overlaps(pointer, protectedRoot))
        throw new UnauthorizedAccessException("An update target overlaps a protected supervisor root.");
    }
    if (IsAtOrInside(pointer, versions))
      throw new InvalidOperationException("The active pointer must be outside the version directory.");
  }

  private static string CanonicalDirectory(string path) =>
    Path.TrimEndingDirectorySeparator(Path.GetFullPath(path));

  private static bool Overlaps(string left, string right)
  {
    var a = Path.TrimEndingDirectorySeparator(Path.GetFullPath(left));
    var b = Path.TrimEndingDirectorySeparator(Path.GetFullPath(right));
    return string.Equals(a, b, StringComparison.OrdinalIgnoreCase) ||
           a.StartsWith(b + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) ||
           b.StartsWith(a + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
  }

  private static bool IsAtOrInside(string candidate, string root)
  {
    var value = Path.TrimEndingDirectorySeparator(Path.GetFullPath(candidate));
    var parent = Path.TrimEndingDirectorySeparator(Path.GetFullPath(root));
    return string.Equals(value, parent, StringComparison.OrdinalIgnoreCase) ||
           value.StartsWith(parent + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
  }

  [GeneratedRegex("^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$", RegexOptions.CultureInvariant)]
  private static partial Regex SafeTargetId();
  [GeneratedRegex("^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$", RegexOptions.CultureInvariant)]
  private static partial Regex SafeServiceName();
  [GeneratedRegex("^[A-Za-z0-9-]{1,64}$", RegexOptions.CultureInvariant)]
  private static partial Regex SafeHeaderName();
}
