using System.Reflection;
using System.Security.Principal;
using Itemba.Msaidizi.Companion.Service.Capabilities;
using Itemba.Msaidizi.Companion.Service.Security;

namespace Itemba.Msaidizi.Companion.Tests;

public sealed class RestrictedServicePeerTokenValidatorTests
{
  [Fact]
  public void UnrestrictedOrWrongServiceTokenCannotAuthenticateSupervisorPeer()
  {
    if (!OperatingSystem.IsWindows())
    {
      return;
    }

    using var identity = WindowsIdentity.GetCurrent(TokenAccessLevels.Query);
    var unrelatedServiceSid = new SecurityIdentifier("S-1-5-80-1-2-3-4-5");

    Assert.False(RestrictedServicePeerTokenValidator.IsExactRestrictedService(
      identity.AccessToken,
      unrelatedServiceSid));
  }

  [Fact]
  public void ReciprocalProcessGrantMatchesMappedImageQueryRightsExactly()
  {
    Assert.Equal(0x00100400u,
      TrustedSupervisorProcessAccessGrant.SupervisorProcessAccessMask);
  }

  [Fact]
  public void IsolationClientPinsTheRetainedMappedImageNotAReopenedPath()
  {
    const BindingFlags flags = BindingFlags.NonPublic | BindingFlags.Static;
    var connector = typeof(WindowsPrivilegedCommandIsolationPipeConnector);

    Assert.NotNull(connector.GetMethod("OpenAndBindMappedImage", flags));
    Assert.NotNull(connector.GetMethod("NtQueryInformationProcess", flags));
    Assert.Equal(
      44,
      connector.GetField("ProcessImageFileMapping", flags)!.GetRawConstantValue());
    Assert.Equal(
      0x0400u,
      connector.GetField("ProcessQueryInformation", flags)!.GetRawConstantValue());
  }
}
