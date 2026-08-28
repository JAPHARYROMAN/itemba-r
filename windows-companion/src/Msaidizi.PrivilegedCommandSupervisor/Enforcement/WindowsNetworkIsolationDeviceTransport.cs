using System.ComponentModel;
using System.Diagnostics.CodeAnalysis;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using Microsoft.Win32.SafeHandles;

namespace Itemba.Msaidizi.PrivilegedCommandSupervisor.Enforcement;

/// <summary>
/// Exclusive, overlapped DeviceIoControl transport. Any timeout, cancellation
/// after dispatch, malformed transfer length, or native error destroys the
/// sole handle; the v3 driver cleanup path then latches its network kill state.
/// </summary>
internal sealed class WindowsNetworkIsolationDeviceTransport :
  INetworkIsolationDeviceTransport
{
  private readonly SafeFileHandle _device;
  private readonly TimeSpan _operationTimeout;
  private int _unavailable;
  private int _disposed;

  public WindowsNetworkIsolationDeviceTransport(
    string devicePath,
    TimeSpan operationTimeout)
  {
    ArgumentException.ThrowIfNullOrWhiteSpace(devicePath);
    if (!OperatingSystem.IsWindows())
    {
      throw new PlatformNotSupportedException(
        "The network-isolation device exists only on Windows.");
    }
    _operationTimeout = operationTimeout;
    _device = CreateFile(
      devicePath,
      GenericRead | GenericWrite,
      0,
      IntPtr.Zero,
      OpenExisting,
      FileAttributeNormal | FileFlagOverlapped,
      IntPtr.Zero);
    if (_device.IsInvalid)
    {
      var error = Marshal.GetLastWin32Error();
      _device.Dispose();
      throw new Win32Exception(
        error,
        "The v3 network-isolation driver device is unavailable.");
    }
  }

  public async ValueTask<byte[]> ExchangeAsync(
    uint controlCode,
    ReadOnlyMemory<byte> input,
    int expectedOutputBytes,
    CancellationToken cancellationToken)
  {
    ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
    if (Volatile.Read(ref _unavailable) != 0)
    {
      throw new IOException("The v3 network-isolation device handle is unavailable.");
    }
    if (input.IsEmpty
      || input.Length > NetworkIsolationProtocolV3.MaximumFrameBytes
      || expectedOutputBytes <= 0
      || expectedOutputBytes > NetworkIsolationProtocolV3.MaximumFrameBytes)
    {
      throw new ArgumentOutOfRangeException(
        nameof(input),
        "The v3 device-control frame is outside the closed ABI ceiling.");
    }

    cancellationToken.ThrowIfCancellationRequested();
    var inputBytes = input.ToArray();
    var output = new byte[expectedOutputBytes];
    var deferredCleanup = false;
    try
    {
      using var timeout = CancellationTokenSource.CreateLinkedTokenSource(
        cancellationToken);
      timeout.CancelAfter(_operationTimeout);
      var operation = new PendingDeviceControl(
        _device,
        controlCode,
        inputBytes,
        output);
      int transferred;
      try
      {
        transferred = await operation.Completion.WaitAsync(timeout.Token)
          .ConfigureAwait(false);
      }
      catch (OperationCanceledException exception)
      {
        Interlocked.Exchange(ref _unavailable, 1);
        operation.Cancel();
        _device.Dispose();
        deferredCleanup = true;
        _ = operation.Completion.ContinueWith(
          completed =>
          {
            _ = completed.Exception;
            CryptographicOperations.ZeroMemory(inputBytes);
            CryptographicOperations.ZeroMemory(output);
          },
          CancellationToken.None,
          TaskContinuationOptions.ExecuteSynchronously,
          TaskScheduler.Default);
        if (cancellationToken.IsCancellationRequested)
        {
          throw new OperationCanceledException(
            "The v3 IOCTL was cancelled after dispatch; the device lease was destroyed.",
            exception,
            cancellationToken);
        }
        throw new TimeoutException(
          "The v3 network-isolation driver operation timed out.",
          exception);
      }
      if (transferred != expectedOutputBytes)
      {
        throw new InvalidDataException(
          "The v3 network-isolation driver returned a noncanonical frame length.");
      }
      var result = output.ToArray();
      return result;
    }
    catch
    {
      Interlocked.Exchange(ref _unavailable, 1);
      _device.Dispose();
      throw;
    }
    finally
    {
      if (!deferredCleanup)
      {
        CryptographicOperations.ZeroMemory(inputBytes);
        CryptographicOperations.ZeroMemory(output);
      }
    }
  }

  public ValueTask DisposeAsync()
  {
    if (Interlocked.Exchange(ref _disposed, 1) == 0)
    {
      Interlocked.Exchange(ref _unavailable, 1);
      _device.Dispose();
    }
    return ValueTask.CompletedTask;
  }

  private const uint GenericRead = 0x80000000;
  private const uint GenericWrite = 0x40000000;
  private const uint OpenExisting = 3;
  private const uint FileAttributeNormal = 0x00000080;
  private const uint FileFlagOverlapped = 0x40000000;

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern SafeFileHandle CreateFile(
    string fileName,
    uint desiredAccess,
    uint shareMode,
    IntPtr securityAttributes,
    uint creationDisposition,
    uint flagsAndAttributes,
    IntPtr templateFile);

  [DllImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool DeviceIoControl(
    SafeFileHandle device,
    uint ioControlCode,
    IntPtr inputBuffer,
    uint inputBufferSize,
    IntPtr outputBuffer,
    uint outputBufferSize,
    IntPtr bytesReturned,
    IntPtr overlapped);

  [DllImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool GetOverlappedResult(
    SafeFileHandle device,
    IntPtr overlapped,
    out uint bytesTransferred,
    [MarshalAs(UnmanagedType.Bool)] bool wait);

  [DllImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool CancelIoEx(
    SafeFileHandle device,
    IntPtr overlapped);

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern uint WaitForSingleObject(
    SafeWaitHandle handle,
    uint milliseconds);

  [SuppressMessage(
    "Design",
    "CA1001:Types that own disposable fields should be disposable",
    Justification = "Completion owns native cleanup; cancellation cannot free an in-flight OVERLAPPED structure.")]
  private sealed class PendingDeviceControl
  {
    private readonly SafeFileHandle _device;
    private readonly object _lifecycleGate = new();
    private EventWaitHandle? _completedEvent;
    private GCHandle _inputPin;
    private GCHandle _outputPin;
    private IntPtr _overlapped;
    private int _cleaned;

    public PendingDeviceControl(
      SafeFileHandle device,
      uint controlCode,
      byte[] input,
      byte[] output)
    {
      _device = device;
      try
      {
        _inputPin = GCHandle.Alloc(input, GCHandleType.Pinned);
        _outputPin = GCHandle.Alloc(output, GCHandleType.Pinned);
        _completedEvent = new EventWaitHandle(false, EventResetMode.ManualReset);
        _overlapped = Marshal.AllocHGlobal(Marshal.SizeOf<OverlappedData>());
        Marshal.StructureToPtr(
          new OverlappedData
          {
            EventHandle = _completedEvent.SafeWaitHandle.DangerousGetHandle(),
          },
          _overlapped,
          fDeleteOld: false);

        var started = DeviceIoControl(
          device,
          controlCode,
          _inputPin.AddrOfPinnedObject(),
          checked((uint)input.Length),
          _outputPin.AddrOfPinnedObject(),
          checked((uint)output.Length),
          IntPtr.Zero,
          _overlapped);
        if (started)
        {
          Completion = Task.FromResult(GetResult());
          Cleanup();
          return;
        }
        var error = Marshal.GetLastWin32Error();
        if (error != ErrorIoPending)
        {
          throw new Win32Exception(error);
        }
        Completion = Task.Run(WaitAndGetResult, CancellationToken.None);
      }
      catch
      {
        Cleanup();
        throw;
      }
    }

    public Task<int> Completion { get; }

    public void Cancel()
    {
      lock (_lifecycleGate)
      {
        if (_overlapped == IntPtr.Zero || _device.IsClosed)
        {
          return;
        }
        try
        {
          _ = CancelIoEx(_device, _overlapped);
        }
        catch (ObjectDisposedException)
        {
          // Closing the sole device handle is the stronger fail-closed action.
        }
      }
    }

    private int WaitAndGetResult()
    {
      try
      {
        var completedEvent = _completedEvent
          ?? throw new ObjectDisposedException(nameof(PendingDeviceControl));
        var wait = WaitForSingleObject(completedEvent.SafeWaitHandle, Infinite);
        if (wait != WaitObject0)
        {
          throw new Win32Exception(
            wait == WaitFailed
              ? Marshal.GetLastWin32Error()
              : unchecked((int)wait),
            "The v3 network-isolation driver wait failed.");
        }
        return GetResult();
      }
      finally
      {
        Cleanup();
      }
    }

    private int GetResult()
    {
      if (!GetOverlappedResult(
        _device,
        _overlapped,
        out var transferred,
        wait: false))
      {
        throw new Win32Exception(Marshal.GetLastWin32Error());
      }
      return checked((int)transferred);
    }

    private void Cleanup()
    {
      lock (_lifecycleGate)
      {
        if (Interlocked.Exchange(ref _cleaned, 1) != 0)
        {
          return;
        }
        var overlapped = _overlapped;
        _overlapped = IntPtr.Zero;
        if (overlapped != IntPtr.Zero)
        {
          Marshal.FreeHGlobal(overlapped);
        }
        if (_outputPin.IsAllocated)
        {
          _outputPin.Free();
        }
        if (_inputPin.IsAllocated)
        {
          _inputPin.Free();
        }
        _completedEvent?.Dispose();
        _completedEvent = null;
      }
    }

    private const int ErrorIoPending = 997;
    private const uint Infinite = 0xFFFFFFFF;
    private const uint WaitObject0 = 0;
    private const uint WaitFailed = 0xFFFFFFFF;

    [StructLayout(LayoutKind.Sequential)]
    private struct OverlappedData
    {
      public IntPtr Internal;
      public IntPtr InternalHigh;
      public uint Offset;
      public uint OffsetHigh;
      public IntPtr EventHandle;
    }
  }
}
