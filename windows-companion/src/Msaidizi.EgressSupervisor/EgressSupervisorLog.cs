using Microsoft.Extensions.Logging;

namespace Itemba.Msaidizi.EgressSupervisor;

internal static partial class EgressSupervisorLog
{
  [LoggerMessage(1000, LogLevel.Information,
    "Egress supervisor is installed in safe-off mode; no pipe or network endpoint is open.")]
  public static partial void ServiceDisabled(ILogger logger);

  [LoggerMessage(1001, LogLevel.Information,
    "Egress supervisor is safely disabled; no control pipe was opened.")]
  public static partial void ControlDisabled(ILogger logger);

  [LoggerMessage(1002, LogLevel.Information,
    "Egress supervisor is safely disabled; no data pipe was opened.")]
  public static partial void DataDisabled(ILogger logger);

  [LoggerMessage(1100, LogLevel.Warning,
    "Egress control request was refused with code {Code}.")]
  public static partial void ControlRefused(ILogger logger, string code);

  [LoggerMessage(1101, LogLevel.Warning,
    "An unauthenticated or malformed egress control request was refused.")]
  public static partial void ControlMalformed(ILogger logger);

  [LoggerMessage(1200, LogLevel.Warning,
    "Egress flow was refused with code {Code}.")]
  public static partial void FlowRefused(ILogger logger, string code);

  [LoggerMessage(1201, LogLevel.Warning,
    "An unauthenticated or malformed egress flow was refused.")]
  public static partial void FlowMalformed(ILogger logger);

  [LoggerMessage(1202, LogLevel.Critical,
    "Egress flow completion could not be durably reconciled: {Code}.")]
  public static partial void FlowReconciliationFailed(ILogger logger, string code);
}
