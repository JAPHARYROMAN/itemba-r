using System.Collections;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security;

namespace Itemba.Msaidizi.Installer.Hardening;

public sealed record FirewallRuleDefinition(
  string Name,
  string ApplicationPath,
  string Description);

public static class FirewallBlueprint
{
  public static IReadOnlyList<FirewallRuleDefinition> Build(string binaryRoot)
  {
    var validatedRoot = InstallLayout.ValidateBinaryRoot(binaryRoot);
    return InstallerConstants.Executables.Select(pair =>
      new FirewallRuleDefinition(
        $"Itemba Msaidizi - Block inbound - {pair.Key}",
        Path.GetFullPath(Path.Combine(validatedRoot, pair.Value)),
        "Explicit inbound block; Itemba Msaidizi uses outbound-only channels and no local listener."))
      .ToArray();
  }
}

public static class FirewallBlockManager
{
  private const int NetFwRuleDirectionInbound = 1;
  private const int NetFwActionBlock = 0;
  private const int NetFwIpProtocolAny = 256;
  private const int NetFwProfileAll = int.MaxValue;

  public static void Install(string binaryRoot)
  {
    var definitions = FirewallBlueprint.Build(binaryRoot);
    foreach (var definition in definitions)
    {
      if (!File.Exists(definition.ApplicationPath))
        throw new FileNotFoundException(
          "A firewall rule cannot bind to a missing signed executable.",
          definition.ApplicationPath);
    }

    WithFirewallRules(rules =>
    {
      foreach (var definition in definitions)
      {
        var existing = FindByName(rules, definition.Name);
        if (existing is not null)
        {
          var existingPath = GetStringProperty(existing, "ApplicationName");
          if (!string.Equals(
                Path.GetFullPath(existingPath),
                definition.ApplicationPath,
                StringComparison.OrdinalIgnoreCase))
            throw new SecurityException(
              $"Firewall rule name collision for '{definition.Name}' was refused.");
          Invoke(rules, "Remove", definition.Name);
          ReleaseComObject(existing);
        }

        var ruleType = Type.GetTypeFromProgID("HNetCfg.FWRule", throwOnError: true)
          ?? throw new InvalidOperationException("Windows Firewall rule COM registration is missing.");
        var rule = Activator.CreateInstance(ruleType)
          ?? throw new InvalidOperationException("Could not create a Windows Firewall rule.");
        try
        {
          SetProperty(rule, "Name", definition.Name);
          SetProperty(rule, "Description", definition.Description);
          SetProperty(rule, "ApplicationName", definition.ApplicationPath);
          SetProperty(rule, "Grouping", InstallerConstants.FirewallGrouping);
          SetProperty(rule, "Direction", NetFwRuleDirectionInbound);
          SetProperty(rule, "Action", NetFwActionBlock);
          SetProperty(rule, "Protocol", NetFwIpProtocolAny);
          SetProperty(rule, "Profiles", NetFwProfileAll);
          SetProperty(rule, "Enabled", true);
          SetProperty(rule, "EdgeTraversal", false);
          SetProperty(rule, "InterfaceTypes", "All");
          Invoke(rules, "Add", rule);
        }
        finally
        {
          ReleaseComObject(rule);
        }
      }
    });
  }

  public static void RemoveOnlyExact(string binaryRoot)
  {
    var definitions = FirewallBlueprint.Build(binaryRoot);
    WithFirewallRules(rules =>
    {
      foreach (var definition in definitions)
      {
        var existing = FindByName(rules, definition.Name);
        if (existing is null)
          continue;
        try
        {
          var existingPath = GetStringProperty(existing, "ApplicationName");
          if (!string.Equals(
                Path.GetFullPath(existingPath),
                definition.ApplicationPath,
                StringComparison.OrdinalIgnoreCase))
            throw new SecurityException(
              $"Firewall rule name collision for '{definition.Name}' was refused.");
          Invoke(rules, "Remove", definition.Name);
        }
        finally
        {
          ReleaseComObject(existing);
        }
      }
    });
  }

  private static void WithFirewallRules(Action<object> action)
  {
    var policyType = Type.GetTypeFromProgID("HNetCfg.FwPolicy2", throwOnError: true)
      ?? throw new InvalidOperationException("Windows Firewall policy COM registration is missing.");
    var policy = Activator.CreateInstance(policyType)
      ?? throw new InvalidOperationException("Could not open Windows Firewall policy.");
    object? rules = null;
    try
    {
      rules = GetProperty(policy, "Rules");
      action(rules);
    }
    finally
    {
      if (rules is not null)
        ReleaseComObject(rules);
      ReleaseComObject(policy);
    }
  }

  private static object? FindByName(object rules, string expectedName)
  {
    if (rules is not IEnumerable enumerable)
      throw new InvalidOperationException("Windows Firewall returned a non-enumerable rule collection.");
    foreach (var candidate in enumerable)
    {
      if (candidate is null)
        continue;
      if (string.Equals(
            GetStringProperty(candidate, "Name"),
            expectedName,
            StringComparison.Ordinal))
        return candidate;
      ReleaseComObject(candidate);
    }
    return null;
  }

  private static object GetProperty(object instance, string propertyName) =>
    instance.GetType().InvokeMember(
      propertyName,
      BindingFlags.GetProperty,
      binder: null,
      target: instance,
      args: null,
      culture: System.Globalization.CultureInfo.InvariantCulture)
    ?? throw new InvalidOperationException($"Windows Firewall property '{propertyName}' was null.");

  private static string GetStringProperty(object instance, string propertyName) =>
    Convert.ToString(GetProperty(instance, propertyName), System.Globalization.CultureInfo.InvariantCulture)
    ?? string.Empty;

  private static void SetProperty(object instance, string propertyName, object value) =>
    instance.GetType().InvokeMember(
      propertyName,
      BindingFlags.SetProperty,
      binder: null,
      target: instance,
      args: [value],
      culture: System.Globalization.CultureInfo.InvariantCulture);

  private static void Invoke(object instance, string methodName, params object[] arguments) =>
    instance.GetType().InvokeMember(
      methodName,
      BindingFlags.InvokeMethod,
      binder: null,
      target: instance,
      args: arguments,
      culture: System.Globalization.CultureInfo.InvariantCulture);

  private static void ReleaseComObject(object instance)
  {
    if (Marshal.IsComObject(instance))
      _ = Marshal.FinalReleaseComObject(instance);
  }
}
