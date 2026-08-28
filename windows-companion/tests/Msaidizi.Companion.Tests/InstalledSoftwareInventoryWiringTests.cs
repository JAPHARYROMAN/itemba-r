using System.Text.Json;
using Itemba.Msaidizi.Companion.Service.Capabilities;
using Itemba.Msaidizi.Companion.Service.Configuration;

namespace Itemba.Msaidizi.Companion.Tests;

public sealed class InstalledSoftwareInventoryWiringTests
{
  [Fact]
  public void PackagedPostureKeepsInventoryInsideTheDefaultOffHostPack()
  {
    var path = Path.Combine(
      AppContext.BaseDirectory,
      "test-assets",
      "service-appsettings.json");
    using var document = JsonDocument.Parse(File.ReadAllText(path));
    var host = document.RootElement.GetProperty(HostCapabilityOptions.SectionName);

    Assert.False(host.GetProperty("Enabled").GetBoolean());
    Assert.Equal(
      512,
      host.GetProperty("MaximumInstalledSoftwareInventoryEntries").GetInt32());
  }

  [Fact]
  public void DeploymentMaximumIsPassedWithoutClamping()
  {
    var adapter = new InstalledSoftwareInventoryReadCapabilityAdapter(
      new EmptyInventory(),
      maximumEntries: 37);
    using var allowed = JsonDocument.Parse("""{"maxEntries":37}""");
    using var denied = JsonDocument.Parse("""{"maxEntries":38}""");

    Assert.True(adapter.ValidateArguments(allowed.RootElement).IsValid);
    Assert.False(adapter.ValidateArguments(denied.RootElement).IsValid);
  }

  private sealed class EmptyInventory : IInstalledSoftwareInventory
  {
    public IReadOnlyList<InstalledSoftwareRegistryEntry> Read(
      CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      return [];
    }
  }
}
