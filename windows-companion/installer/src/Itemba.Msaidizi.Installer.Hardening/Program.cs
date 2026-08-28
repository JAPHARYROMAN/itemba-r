namespace Itemba.Msaidizi.Installer.Hardening;

internal static class Program
{
  private static int Main(string[] args)
  {
    try
    {
      var command = InstallerCommand.Parse(args);
      if (command.Operation == InstallerOperation.Install)
      {
        var layout = InstallLayout.ValidateForInstall(command.BinaryRoot, command.DataRoot!);
        PlatformPrerequisiteValidator.Validate(layout);
        var recoveryOperators = LocalGroupManager.EnsureRecoveryOperatorsGroup();
        var aclHardener = new AclHardener(layout, recoveryOperators);
        aclHardener.Apply();
        ServiceDaclHardener.Apply(recoveryOperators);
        FirewallBlockManager.Install(layout.BinaryRoot);
        aclHardener.CommitConfigurationProvenance();
      }
      else
      {
        FirewallBlockManager.RemoveOnlyExact(
          InstallLayout.ValidateBinaryRoot(command.BinaryRoot));
      }
      return 0;
    }
    catch (Exception error)
    {
      Console.Error.WriteLine($"Itemba Msaidizi installer hardening failed closed: {error.Message}");
      return 1;
    }
  }
}

public enum InstallerOperation
{
  Install,
  RemoveFirewall,
}

public sealed record InstallerCommand(
  InstallerOperation Operation,
  string BinaryRoot,
  string? DataRoot)
{
  public static InstallerCommand Parse(IReadOnlyList<string> args)
  {
    if (args.Count == 0)
      throw new ArgumentException("An exact installer operation is required.");

    var operation = args[0] switch
    {
      "install" => InstallerOperation.Install,
      "remove-firewall" => InstallerOperation.RemoveFirewall,
      _ => throw new ArgumentException("The installer operation is not allowlisted."),
    };
    var values = new Dictionary<string, string>(StringComparer.Ordinal);
    for (var index = 1; index < args.Count; index += 2)
    {
      if (index + 1 >= args.Count || args[index] is not ("--binary-root" or "--data-root"))
        throw new ArgumentException("Installer arguments must be exact name/value pairs.");
      if (!values.TryAdd(args[index], args[index + 1]) || string.IsNullOrWhiteSpace(args[index + 1]))
        throw new ArgumentException("Installer arguments cannot be duplicated or empty.");
    }

    if (!values.TryGetValue("--binary-root", out var binaryRoot))
      throw new ArgumentException("The exact binary root is required.");
    values.TryGetValue("--data-root", out var dataRoot);
    if (operation == InstallerOperation.Install && dataRoot is null)
      throw new ArgumentException("The exact data root is required for installation.");
    if (operation == InstallerOperation.RemoveFirewall && dataRoot is not null)
      throw new ArgumentException("Firewall-only removal does not accept a data root.");

    return new InstallerCommand(operation, binaryRoot, dataRoot);
  }
}
