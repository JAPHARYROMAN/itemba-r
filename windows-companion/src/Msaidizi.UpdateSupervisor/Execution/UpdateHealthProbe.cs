using Itemba.Msaidizi.UpdateSupervisor.Configuration;

namespace Itemba.Msaidizi.UpdateSupervisor.Execution;

public sealed record HealthProbeResult(
  bool Healthy,
  IReadOnlyDictionary<string, object?> Metrics,
  string? Reason,
  string? ObservedVersion = null);

public interface IUpdateHealthProbe
{
  Task<HealthProbeResult> WaitForHealthyAsync(
    UpdateTargetOptions target,
    string activeVersionDirectory,
    string expectedVersion,
    TimeSpan timeout,
    TimeSpan minimumHealthySoak,
    CancellationToken cancellationToken);
}

/// <summary>
/// Installer-policy health gate. A single green response is never enough: the
/// exact activated version must remain healthy for the complete configured
/// window and at least two probes. Any regression after the window begins
/// fails immediately so TrustedUpdateEngine restores the prior pointer.
/// </summary>
public sealed class ConfiguredUpdateHealthProbe : IUpdateHealthProbe
{
  private readonly HttpClient _client;
  private readonly TimeProvider _time;

  public ConfiguredUpdateHealthProbe(HttpClient client, TimeProvider? time = null)
  {
    _client = client;
    _time = time ?? TimeProvider.System;
  }

  public async Task<HealthProbeResult> WaitForHealthyAsync(
    UpdateTargetOptions target,
    string activeVersionDirectory,
    string expectedVersion,
    TimeSpan timeout,
    TimeSpan minimumHealthySoak,
    CancellationToken cancellationToken)
  {
    if (string.IsNullOrWhiteSpace(target.HealthProbeUri) &&
        string.IsNullOrWhiteSpace(target.HealthProbeRelativePath))
      return new HealthProbeResult(false, new Dictionary<string, object?>(),
        "No immutable health probe is configured.");

    var startedAt = _time.GetTimestamp();
    long? healthySinceTimestamp = null;
    DateTimeOffset? healthySinceUtc = null;
    Exception? lastError = null;
    string? lastReason = null;
    string? observedVersion = null;
    IReadOnlyDictionary<string, object?> lastMetrics = new Dictionary<string, object?>();
    var attempts = 0;
    var healthyProbes = 0;

    while (Remaining(timeout, startedAt) > TimeSpan.Zero)
    {
      cancellationToken.ThrowIfCancellationRequested();
      attempts++;
      bool healthy;
      var probeBudget = Remaining(timeout, startedAt);
      using var probeDeadline = new CancellationTokenSource();
      probeDeadline.CancelAfter(probeBudget);
      using var linked = CancellationTokenSource.CreateLinkedTokenSource(
        cancellationToken, probeDeadline.Token);
      try
      {
        (healthy, lastMetrics, lastReason, observedVersion) = await ProbeOnceAsync(
            target, activeVersionDirectory, expectedVersion, linked.Token)
          .WaitAsync(probeBudget, _time, cancellationToken);
        lastError = null;
      }
      catch (TimeoutException error)
      {
        probeDeadline.Cancel();
        healthy = false;
        lastError = error;
        lastReason ??= "The signed health deadline elapsed during a probe.";
        lastMetrics = new Dictionary<string, object?>
        {
          ["exceptionType"] = error.GetType().Name,
          ["probeDeadlineExceeded"] = true,
        };
      }
      catch (OperationCanceledException error) when (
        !cancellationToken.IsCancellationRequested && probeDeadline.IsCancellationRequested)
      {
        healthy = false;
        lastError = error;
        lastReason ??= "The signed health deadline elapsed during a probe.";
        lastMetrics = new Dictionary<string, object?>
        {
          ["exceptionType"] = error.GetType().Name,
          ["probeDeadlineExceeded"] = true,
        };
      }
      catch (Exception error) when (error is IOException or HttpRequestException)
      {
        healthy = false;
        lastError = error;
        lastReason = error.Message;
        lastMetrics = new Dictionary<string, object?>
        {
          ["exceptionType"] = error.GetType().Name,
        };
      }

      var observedTimestamp = _time.GetTimestamp();
      var observedAt = _time.GetUtcNow();
      if (healthy)
      {
        healthySinceTimestamp ??= observedTimestamp;
        healthySinceUtc ??= observedAt;
        healthyProbes++;
        var continuous = _time.GetElapsedTime(
          healthySinceTimestamp.Value, observedTimestamp);
        if (healthyProbes >= 2 &&
            continuous >= minimumHealthySoak)
          return new HealthProbeResult(true, SoakMetrics(
            lastMetrics, attempts, healthyProbes, healthySinceUtc.Value, continuous,
            minimumHealthySoak.TotalSeconds), null, observedVersion);
      }
      else if (healthySinceTimestamp is not null)
      {
        var continuous = _time.GetElapsedTime(
          healthySinceTimestamp.Value, observedTimestamp);
        return new HealthProbeResult(false, SoakMetrics(
          lastMetrics, attempts, healthyProbes, healthySinceUtc!.Value, continuous,
          minimumHealthySoak.TotalSeconds),
          $"Health regressed during the required soak: {lastReason ?? "probe rejected"}.",
          observedVersion);
      }

      var remaining = Remaining(timeout, startedAt);
      if (remaining <= TimeSpan.Zero) break;
      var delay = TimeSpan.FromSeconds(target.HealthProbeIntervalSeconds);
      await Task.Delay(delay < remaining ? delay : remaining, _time, cancellationToken);
    }

    var timeoutMetrics = new Dictionary<string, object?>(lastMetrics)
    {
      ["attempts"] = attempts,
      ["healthyProbeCount"] = healthyProbes,
      ["requiredSoakSeconds"] = minimumHealthySoak.TotalSeconds,
      ["timeoutSeconds"] = timeout.TotalSeconds,
    };
    return new HealthProbeResult(false, timeoutMetrics,
      lastReason ?? lastError?.Message ?? "Health timeout elapsed.", observedVersion);
  }

  private async Task<(bool Healthy, IReadOnlyDictionary<string, object?> Metrics,
    string? Reason, string? ObservedVersion)> ProbeOnceAsync(
      UpdateTargetOptions target,
      string activeVersionDirectory,
      string expectedVersion,
      CancellationToken cancellationToken)
  {
    if (!string.IsNullOrWhiteSpace(target.HealthProbeUri))
    {
      using var request = new HttpRequestMessage(HttpMethod.Get, target.HealthProbeUri);
      using var response = await _client.SendAsync(request, cancellationToken);
      var versions = response.Headers.TryGetValues(
        target.ObservedVersionHeaderName, out var values) ? values.ToArray() : [];
      var observedVersion = versions.Length == 1 ? versions[0] : null;
      var versionMatches = !target.RequireObservedVersion ||
        string.Equals(observedVersion, expectedVersion, StringComparison.Ordinal);
      return (response.IsSuccessStatusCode && versionMatches,
        new Dictionary<string, object?>
        {
          ["kind"] = "http",
          ["statusCode"] = (int)response.StatusCode,
          ["observedVersion"] = observedVersion,
        },
        !response.IsSuccessStatusCode
          ? $"HTTP health returned {(int)response.StatusCode}"
          : versionMatches ? null : "Observed version did not match the signed version",
        observedVersion);
    }

    var probe = SafeChild(activeVersionDirectory, target.HealthProbeRelativePath!);
    if (!File.Exists(probe))
      return (false, new Dictionary<string, object?>
      {
        ["kind"] = "file",
        ["path"] = target.HealthProbeRelativePath,
      }, "Health file is absent", null);
    var content = await File.ReadAllTextAsync(probe, cancellationToken);
    var matches = target.ExpectedHealthContent is null ||
      string.Equals(content.Trim(), target.ExpectedHealthContent, StringComparison.Ordinal);
    return (matches, new Dictionary<string, object?>
    {
      ["kind"] = "file",
      ["path"] = target.HealthProbeRelativePath,
    }, matches ? null : "Health file content did not match policy", expectedVersion);
  }

  private static Dictionary<string, object?> SoakMetrics(
    IReadOnlyDictionary<string, object?> probe,
    int attempts,
    int healthyProbes,
    DateTimeOffset healthySince,
    TimeSpan continuous,
    double requiredSoakSeconds)
  {
    var metrics = new Dictionary<string, object?>(probe)
    {
      ["attempts"] = attempts,
      ["healthyProbeCount"] = healthyProbes,
      ["healthySince"] = CanonicalUtcTimestamp(healthySince),
      ["healthyThrough"] = CanonicalUtcTimestamp(healthySince.Add(continuous)),
      ["continuousHealthySeconds"] = continuous.TotalSeconds,
      ["requiredSoakSeconds"] = requiredSoakSeconds,
    };
    return metrics;
  }

  private static string CanonicalUtcTimestamp(DateTimeOffset value) =>
    value.ToUniversalTime().ToString(
      "yyyy-MM-dd'T'HH:mm:ss.fff'Z'", System.Globalization.CultureInfo.InvariantCulture);

  private TimeSpan Remaining(TimeSpan timeout, long startedAt)
  {
    var remaining = timeout - _time.GetElapsedTime(startedAt, _time.GetTimestamp());
    return remaining > TimeSpan.Zero ? remaining : TimeSpan.Zero;
  }

  private static string SafeChild(string root, string relative)
  {
    if (Path.IsPathFullyQualified(relative) || relative.Contains(':'))
      throw new InvalidDataException("Health probe path must be relative.");
    var fullRoot = Path.TrimEndingDirectorySeparator(Path.GetFullPath(root));
    var result = Path.GetFullPath(relative, fullRoot);
    if (!result.StartsWith(fullRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
      throw new InvalidDataException("Health probe escapes the active version.");
    return result;
  }
}
