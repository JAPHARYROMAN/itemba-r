using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Service.Security;

public interface ITrustedRootGuard
{
  bool IsKillSwitchEngaged { get; }

  string? Validate(CapabilityDescriptor descriptor);
}

public sealed class TrustedRootGuard : ITrustedRootGuard
{
  private readonly string _killSwitchPath;

  public TrustedRootGuard(IOptions<CompanionOptions> options)
  {
    _killSwitchPath = Environment.ExpandEnvironmentVariables(options.Value.KillSwitchPath);
  }

  public bool IsKillSwitchEngaged => File.Exists(_killSwitchPath);

  public string? Validate(CapabilityDescriptor descriptor)
  {
    if (descriptor.TouchesTrustedRoot)
    {
      return "trusted_root_access_forbidden";
    }

    return TrustedRootComponents.IsProtectedCapabilityId(descriptor.Id)
        ? "trusted_root_namespace_forbidden"
        : null;
  }
}
