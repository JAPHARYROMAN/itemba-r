namespace Itemba.Msaidizi.PrivilegedCommandSupervisor.Security;

/// <summary>
/// Immutable SCM trust identity. The SID is the Windows service SID derived
/// from the uppercase UTF-16 service name (the same value as `sc.exe showsid`).
/// It is deliberately not configuration-controlled.
/// </summary>
public static class SupervisorServiceIdentity
{
  public const string ServiceName =
    "Itemba Msaidizi Privileged Command Supervisor";

  public const string RequiredServiceSid =
    "S-1-5-80-1792805186-3282615177-1795010573-3676175622-4117989893";

  public const string CompanionServiceName = "Itemba Msaidizi Companion";

  public const string RequiredCompanionServiceSid =
    "S-1-5-80-341263411-3719254221-1864525750-3877438856-2718495063";
}
