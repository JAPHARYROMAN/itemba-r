using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Windows.Automation;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Security;

namespace Itemba.Msaidizi.Companion.Agent.Capabilities;

public sealed class ForegroundUiInspectCapabilityAdapter(
  InteractiveStaDispatcher dispatcher,
  InteractiveTargetPolicy targets) : IHostCapabilityAdapter
{
  public CapabilityDescriptor Descriptor => StandardUserCapabilityCatalog.ForegroundInspect;

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    InteractiveJsonValidation.HasExactProperties(arguments, "maxElements", "maxDepth")
      && arguments.GetProperty("maxElements").TryGetInt32(out var maximum)
      && maximum is >= 1 and <= 500
      && arguments.GetProperty("maxDepth").TryGetInt32(out var depth)
      && depth is >= 0 and <= 12
        ? CapabilityArgumentValidation.Success
        : InteractiveJsonValidation.Invalid("UI inspection bounds are invalid.");

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    InteractiveJsonValidation.HasExactProperties(
      result,
      "processId",
      "windowStateSha256",
      "elements")
    && result.GetProperty("processId").TryGetInt32(out var processId)
    && processId > 0
    && InteractiveJsonValidation.IsSha256(result.GetProperty("windowStateSha256"))
    && result.GetProperty("elements").ValueKind == JsonValueKind.Array
    && result.GetProperty("elements").GetArrayLength() <= 500
      ? CapabilityArgumentValidation.Success
      : InteractiveJsonValidation.InvalidResult("UI inspection result is invalid.");

  public async ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    var maximum = arguments.GetProperty("maxElements").GetInt32();
    var maximumDepth = arguments.GetProperty("maxDepth").GetInt32();
    var snapshot = await dispatcher.InvokeAsync(
      () => UiAutomationSupport.InspectForeground(targets, maximum, maximumDepth),
      cancellationToken).ConfigureAwait(false);
    var output = JsonSerializer.Serialize(new
    {
      snapshot.ProcessId,
      snapshot.WindowStateSha256,
      snapshot.Elements,
    }, UiAutomationSupport.SerializerOptions);
    return new CapabilityExecutionResult(
      output,
      MutationCommitted: false,
      OutcomeUncertain: false,
      Provenance:
      [
        new DataProvenance(
          "ui-automation-tree",
          PayloadDigest.Sha256Hex($"process:{snapshot.ProcessId}"),
          PayloadDigest.Sha256Hex(output),
          ProvenanceTrust.UntrustedContent,
          DateTimeOffset.UtcNow),
      ],
      PreStateSha256: snapshot.WindowStateSha256,
      LocalBytesRead: Encoding.UTF8.GetByteCount(output));
  }
}

public sealed class UiElementInvokeCapabilityAdapter(
  InteractiveStaDispatcher dispatcher,
  InteractiveTargetPolicy targets) : IHostCapabilityAdapter
{
  public CapabilityDescriptor Descriptor => StandardUserCapabilityCatalog.ElementInvoke;

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    InteractiveJsonValidation.HasExactProperties(
      arguments,
      "processId",
      "automationId",
      "controlType")
    && arguments.GetProperty("processId").TryGetInt32(out var processId)
    && processId > 0
    && arguments.GetProperty("automationId").GetString() is { Length: >= 1 and <= 512 }
    && arguments.GetProperty("controlType").GetString() is
      "Button" or "Hyperlink" or "MenuItem" or "TabItem"
      ? CapabilityArgumentValidation.Success
      : InteractiveJsonValidation.Invalid("UI invocation arguments are invalid.");

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    InteractiveJsonValidation.HasExactProperties(
      result,
      "invoked",
      "processId",
      "automationIdSha256")
    && result.GetProperty("invoked").ValueKind == JsonValueKind.True
    && result.GetProperty("processId").TryGetInt32(out var processId)
    && processId > 0
    && InteractiveJsonValidation.IsSha256(result.GetProperty("automationIdSha256"))
      ? CapabilityArgumentValidation.Success
      : InteractiveJsonValidation.InvalidResult("UI invocation result is invalid.");

  public async ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    if (!PayloadDigest.IsSha256Hex(context.ExpectedPreStateSha256 ?? string.Empty))
    {
      throw new InvalidOperationException("expected_pre_state_required");
    }

    var processId = arguments.GetProperty("processId").GetInt32();
    var automationId = arguments.GetProperty("automationId").GetString()!;
    var controlType = arguments.GetProperty("controlType").GetString()!;
    var result = await dispatcher.InvokeAsync(
      () => UiAutomationSupport.InvokeForeground(
        targets,
        processId,
        automationId,
        controlType,
        context.ExpectedPreStateSha256!),
      cancellationToken).ConfigureAwait(false);
    var automationIdSha256 = PayloadDigest.Sha256Hex(automationId);
    var output = JsonSerializer.Serialize(new
    {
      invoked = true,
      processId,
      automationIdSha256,
    });
    return new CapabilityExecutionResult(
      output,
      MutationCommitted: result,
      OutcomeUncertain: false,
      Provenance:
      [
        new DataProvenance(
          "ui-automation-action",
          PayloadDigest.Sha256Hex($"process:{processId}"),
          PayloadDigest.Sha256Hex($"{automationId}\n{controlType}"),
          ProvenanceTrust.TrustedSystem,
          DateTimeOffset.UtcNow),
      ],
      PreStateSha256: context.ExpectedPreStateSha256);
  }
}

internal static class UiAutomationSupport
{
  public static JsonSerializerOptions SerializerOptions { get; } =
    new(JsonSerializerDefaults.Web);

  public static UiSnapshot InspectForeground(
    InteractiveTargetPolicy targets,
    int maximumElements,
    int maximumDepth)
  {
    var (window, processId, root) = ResolveForeground(targets);
    var elements = new List<UiElementSnapshot>(maximumElements);
    var pending = new Queue<(AutomationElement Element, int Depth)>();
    pending.Enqueue((root, 0));
    while (pending.Count > 0 && elements.Count < maximumElements)
    {
      var current = pending.Dequeue();
      elements.Add(ToSnapshot(current.Element, current.Depth));
      if (current.Depth >= maximumDepth)
      {
        continue;
      }

      var child = TreeWalker.RawViewWalker.GetFirstChild(current.Element);
      while (child is not null && pending.Count + elements.Count < maximumElements)
      {
        pending.Enqueue((child, current.Depth + 1));
        child = TreeWalker.RawViewWalker.GetNextSibling(child);
      }
    }

    return new UiSnapshot(
      processId,
      ComputeWindowState(window, processId, root),
      elements);
  }

  public static bool InvokeForeground(
    InteractiveTargetPolicy targets,
    int expectedProcessId,
    string automationId,
    string controlTypeName,
    string expectedStateSha256)
  {
    var (window, processId, root) = ResolveForeground(targets);
    if (processId != expectedProcessId
      || !PayloadDigest.FixedTimeEqualsHex(
        expectedStateSha256,
        ComputeWindowState(window, processId, root)))
    {
      throw new InvalidOperationException("ui_pre_state_mismatch");
    }

    var controlType = ResolveControlType(controlTypeName);
    var condition = new AndCondition(
      new PropertyCondition(AutomationElement.AutomationIdProperty, automationId),
      new PropertyCondition(AutomationElement.ControlTypeProperty, controlType));
    var matches = root.FindAll(TreeScope.Descendants, condition);
    if (matches.Count != 1)
    {
      throw new InvalidOperationException("ui_element_not_unique");
    }

    var element = matches[0];
    if (!element.Current.IsEnabled
      || element.Current.IsOffscreen
      || !element.TryGetCurrentPattern(InvokePattern.Pattern, out var pattern)
      || pattern is not InvokePattern invokePattern)
    {
      throw new InvalidOperationException("ui_element_not_invokable");
    }

    // Recheck the foreground handle and approved executable immediately before
    // committing the invocation to narrow the window/process replacement race.
    if (GetForegroundWindow() != window)
    {
      throw new InvalidOperationException("ui_foreground_changed");
    }

    _ = targets.ValidateUiProcess(processId);
    invokePattern.Invoke();
    return true;
  }

  public static bool SetValueForeground(
    InteractiveTargetPolicy targets,
    int expectedProcessId,
    string automationId,
    string expectedStateSha256,
    string value)
  {
    var (window, processId, root) = ResolveForeground(targets);
    if (processId != expectedProcessId
      || !PayloadDigest.FixedTimeEqualsHex(
        expectedStateSha256,
        ComputeWindowState(window, processId, root)))
    {
      throw new InvalidOperationException("ui_pre_state_mismatch");
    }

    var condition = new AndCondition(
      new PropertyCondition(AutomationElement.AutomationIdProperty, automationId),
      new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit));
    var matches = root.FindAll(TreeScope.Descendants, condition);
    if (matches.Count != 1)
    {
      throw new InvalidOperationException("ui_element_not_unique");
    }

    var element = matches[0];
    if (!element.Current.IsEnabled
      || element.Current.IsOffscreen
      || !element.TryGetCurrentPattern(ValuePattern.Pattern, out var pattern)
      || pattern is not ValuePattern valuePattern
      || valuePattern.Current.IsReadOnly)
    {
      throw new InvalidOperationException("ui_element_not_settable");
    }

    if (GetForegroundWindow() != window)
    {
      throw new InvalidOperationException("ui_foreground_changed");
    }
    _ = targets.ValidateUiProcess(processId);
    valuePattern.SetValue(value);
    return true;
  }

  public static string ComputeWindowState(
    IntPtr window,
    int processId,
    AutomationElement root)
  {
    var current = root.Current;
    var rectangle = current.BoundingRectangle;
    return PayloadDigest.Sha256Hex(string.Join('\n',
      "itemba-ui-window-state-v1",
      window.ToInt64().ToString(System.Globalization.CultureInfo.InvariantCulture),
      processId.ToString(System.Globalization.CultureInfo.InvariantCulture),
      current.AutomationId ?? string.Empty,
      current.ControlType?.Id.ToString(System.Globalization.CultureInfo.InvariantCulture)
        ?? string.Empty,
      PayloadDigest.Sha256Hex(Bound(current.Name, 1_024)),
      rectangle.Left.ToString("R", System.Globalization.CultureInfo.InvariantCulture),
      rectangle.Top.ToString("R", System.Globalization.CultureInfo.InvariantCulture),
      rectangle.Width.ToString("R", System.Globalization.CultureInfo.InvariantCulture),
      rectangle.Height.ToString("R", System.Globalization.CultureInfo.InvariantCulture)));
  }

  private static (IntPtr Window, int ProcessId, AutomationElement Root) ResolveForeground(
    InteractiveTargetPolicy targets)
  {
    var window = GetForegroundWindow();
    if (window == IntPtr.Zero)
    {
      throw new InvalidOperationException("foreground_window_unavailable");
    }

    _ = GetWindowThreadProcessId(window, out var processIdValue);
    var processId = checked((int)processIdValue);
    if (processId <= 0)
    {
      throw new InvalidOperationException("foreground_process_unavailable");
    }

    _ = targets.ValidateUiProcess(processId);
    var root = AutomationElement.FromHandle(window)
      ?? throw new InvalidOperationException("foreground_automation_unavailable");
    return (window, processId, root);
  }

  private static UiElementSnapshot ToSnapshot(AutomationElement element, int depth)
  {
    var current = element.Current;
    var rectangle = current.BoundingRectangle;
    return new UiElementSnapshot(
      depth,
      Bound(current.AutomationId, 512),
      Bound(current.Name, 1_024),
      current.ControlType?.ProgrammaticName?.Replace("ControlType.", string.Empty,
        StringComparison.Ordinal) ?? "Unknown",
      current.IsEnabled,
      current.IsOffscreen,
      new UiRectangle(rectangle.Left, rectangle.Top, rectangle.Width, rectangle.Height));
  }

  private static ControlType ResolveControlType(string name) => name switch
  {
    "Button" => ControlType.Button,
    "Hyperlink" => ControlType.Hyperlink,
    "MenuItem" => ControlType.MenuItem,
    "TabItem" => ControlType.TabItem,
    _ => throw new InvalidOperationException("ui_control_type_not_allowed"),
  };

  private static string Bound(string? value, int maximum) =>
    string.IsNullOrEmpty(value) ? string.Empty : value[..Math.Min(value.Length, maximum)];

  [DllImport("user32.dll")]
  private static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll", SetLastError = true)]
  private static extern uint GetWindowThreadProcessId(
    IntPtr window,
    out uint processId);
}

public sealed record UiSnapshot(
  int ProcessId,
  string WindowStateSha256,
  IReadOnlyList<UiElementSnapshot> Elements);

public sealed record UiElementSnapshot(
  int Depth,
  string AutomationId,
  string Name,
  string ControlType,
  bool IsEnabled,
  bool IsOffscreen,
  UiRectangle Bounds);

public sealed record UiRectangle(double Left, double Top, double Width, double Height);
