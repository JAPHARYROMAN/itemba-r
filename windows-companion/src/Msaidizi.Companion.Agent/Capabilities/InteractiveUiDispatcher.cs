namespace Itemba.Msaidizi.Companion.Agent.Capabilities;

/// <summary>
/// Owns a hidden WinForms control created by the Agent's primary STA thread.
/// Camera consent and first MediaCapture initialization are dispatched here;
/// no LocalSystem process can prompt for or inherit interactive-device access.
/// </summary>
internal sealed class InteractiveUiDispatcher : IDisposable
{
  private readonly Control _control;
  private bool _disposed;

  public InteractiveUiDispatcher()
  {
    if (Thread.CurrentThread.GetApartmentState() != ApartmentState.STA)
    {
      throw new InvalidOperationException("interactive_ui_dispatcher_requires_sta");
    }
    _control = new Control();
    _control.CreateControl();
  }

  public Task<T> InvokeAsync<T>(
    Func<CancellationToken, Task<T>> operation,
    CancellationToken cancellationToken)
  {
    ObjectDisposedException.ThrowIf(_disposed, this);
    var completion = new TaskCompletionSource<T>(
      TaskCreationOptions.RunContinuationsAsynchronously);
    var registration = cancellationToken.Register(
      () => completion.TrySetCanceled(cancellationToken));
    try
    {
      _control.BeginInvoke((Action)(async () =>
      {
        if (completion.Task.IsCompleted)
        {
          registration.Dispose();
          return;
        }
        try
        {
          var result = await operation(cancellationToken).ConfigureAwait(true);
          if (!completion.TrySetResult(result) && result is IDisposable disposable)
          {
            disposable.Dispose();
          }
        }
        catch (Exception exception)
        {
          completion.TrySetException(exception);
        }
        finally
        {
          registration.Dispose();
        }
      }));
    }
    catch
    {
      registration.Dispose();
      throw;
    }
    return completion.Task;
  }

  public void Dispose()
  {
    if (_disposed)
    {
      return;
    }
    _disposed = true;
    _control.Dispose();
  }
}
