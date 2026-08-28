using System.IO;
using System.Runtime.InteropServices;
using System.Security;
using System.Security.Cryptography;
using System.Text;
using Itemba.Msaidizi.Companion.Contracts.Security;

namespace Itemba.Msaidizi.Companion.Agent.SecretProvisioning;

internal sealed record SecretProvisioningSelection(
  string Operation,
  string BindingId,
  string? VaultReferenceId);

internal sealed class SecretBuffer : IDisposable
{
  private byte[]? _bytes;

  public SecretBuffer(byte[] bytes)
  {
    _bytes = bytes;
  }

  public ReadOnlyMemory<byte> Memory => _bytes
    ?? throw new ObjectDisposedException(nameof(SecretBuffer));

  public void Dispose()
  {
    var bytes = Interlocked.Exchange(ref _bytes, null);
    if (bytes is not null)
    {
      CryptographicOperations.ZeroMemory(bytes);
    }
  }
}

internal interface ISecretProvisioningUserInteraction
{
  ValueTask<SecretProvisioningSelection?> SelectAsync(
    IReadOnlyList<SecretProvisioningBindingPreview> bindings,
    CancellationToken cancellationToken);

  ValueTask<bool> ConfirmAsync(
    SecretProvisioningChallenge challenge,
    CancellationToken cancellationToken);

  ValueTask<SecretBuffer?> ReadSecretAsync(CancellationToken cancellationToken);

  ValueTask ShowResultAsync(
    SecretProvisioningResult result,
    CancellationToken cancellationToken);

  ValueTask ShowFailureAsync(string errorCode, CancellationToken cancellationToken);
}

internal sealed class SecretProvisioningWorkflow(
  ISecretProvisioningClient client,
  ISecretProvisioningUserInteraction interaction,
  ISecretProvisioningPendingStore pendingStore)
{
  public async ValueTask RunAsync(CancellationToken cancellationToken)
  {
    try
    {
      await using var session = await client.ConnectAsync(cancellationToken);
      var bindings = await session.GetCatalogAsync(cancellationToken);
      var pending = await pendingStore.LoadAsync(cancellationToken);
      var resumed = pending is not null;
      SecretProvisioningSelection selection;
      if (pending is null)
      {
        var selected = await interaction.SelectAsync(bindings, cancellationToken);
        if (selected is null)
        {
          return;
        }
        selection = selected;
        pending = new SecretProvisioningPendingRequest(
          1,
          Guid.NewGuid().ToString("D"),
          selection.Operation,
          selection.BindingId,
          selection.VaultReferenceId,
          DateTimeOffset.UtcNow);
        await pendingStore.StoreAsync(pending, cancellationToken);
      }
      else
      {
        if (!bindings.Any(binding => string.Equals(
          binding.BindingId,
          pending.BindingId,
          StringComparison.Ordinal)))
        {
          throw new SecretProvisioningClientException(
            "secret_pending_binding_unavailable");
        }
        selection = new SecretProvisioningSelection(
          pending.Operation,
          pending.BindingId,
          pending.VaultReferenceId);
      }

      var request = new SecretProvisioningBeginRequest(
        pending.RequestId,
        selection.Operation,
        selection.BindingId,
        selection.VaultReferenceId);
      var challenge = await session.BeginAsync(request, cancellationToken);
      if (!await interaction.ConfirmAsync(challenge, cancellationToken))
      {
        if (!resumed)
        {
          await pendingStore.ClearAsync(cancellationToken);
        }
        return;
      }

      SecretBuffer? secret = null;
      try
      {
        if (SecretProvisioningOperations.RequiresSecret(challenge.Operation))
        {
          secret = await interaction.ReadSecretAsync(cancellationToken);
          if (secret is null)
          {
            if (!resumed)
            {
              await pendingStore.ClearAsync(cancellationToken);
            }
            return;
          }
        }

        var result = await session.CommitAsync(
          challenge,
          secret?.Memory ?? ReadOnlyMemory<byte>.Empty,
          cancellationToken);
        await pendingStore.ClearAsync(cancellationToken);
        await interaction.ShowResultAsync(result, cancellationToken);
      }
      finally
      {
        secret?.Dispose();
      }
    }
    catch (SecretProvisioningClientException exception)
    {
      await interaction.ShowFailureAsync(exception.ErrorCode, cancellationToken);
    }
    catch (Exception exception) when (exception is IOException
      or UnauthorizedAccessException
      or CryptographicException
      or InvalidDataException
      or InvalidOperationException)
    {
      // Do not surface exception messages: OS and crypto errors can contain
      // paths or payload details. The local UI receives only a stable code.
      await interaction.ShowFailureAsync("secret_provisioning_channel_failed", cancellationToken);
    }
  }
}

internal sealed class WinFormsSecretProvisioningInteraction : ISecretProvisioningUserInteraction
{
  public ValueTask<SecretProvisioningSelection?> SelectAsync(
    IReadOnlyList<SecretProvisioningBindingPreview> bindings,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    if (bindings.Count == 0)
    {
      MessageBox.Show(
        "No supervisor-approved secret destinations are configured.",
        "Msaidizi local secret vault",
        MessageBoxButtons.OK,
        MessageBoxIcon.Information);
      return ValueTask.FromResult<SecretProvisioningSelection?>(null);
    }

    using var dialog = new SecretOperationDialog(bindings);
    return ValueTask.FromResult(dialog.ShowDialog() == DialogResult.OK
      ? dialog.Selection
      : null);
  }

  public ValueTask<bool> ConfirmAsync(
    SecretProvisioningChallenge challenge,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    using var dialog = new SecretConfirmationDialog(challenge);
    return ValueTask.FromResult(dialog.ShowDialog() == DialogResult.OK);
  }

  public ValueTask<SecretBuffer?> ReadSecretAsync(CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    using var dialog = new SecureSecretEntryDialog();
    return ValueTask.FromResult(dialog.ShowDialog() == DialogResult.OK
      ? dialog.Export()
      : null);
  }

  public ValueTask ShowResultAsync(
    SecretProvisioningResult result,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    var reference = result.Metadata?.VaultReferenceId ?? "(none)";
    var version = result.Metadata?.Version.ToString(
      System.Globalization.CultureInfo.InvariantCulture) ?? "-";
    MessageBox.Show(
      $"Outcome: {result.Outcome}\nReference: {reference}\nVersion: {version}\n"
      + $"Replay: {(result.Replayed ? "yes" : "no")}\n"
      + $"Code: {result.ErrorCode ?? "none"}",
      "Msaidizi local secret vault",
      MessageBoxButtons.OK,
      result.Outcome == "completed" ? MessageBoxIcon.Information : MessageBoxIcon.Warning);
    return ValueTask.CompletedTask;
  }

  public ValueTask ShowFailureAsync(string errorCode, CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    MessageBox.Show(
      $"The local secret operation was refused ({errorCode}). No secret was retained by the tray.",
      "Msaidizi local secret vault",
      MessageBoxButtons.OK,
      MessageBoxIcon.Warning);
    return ValueTask.CompletedTask;
  }

  private sealed class SecretOperationDialog : Form
  {
    private readonly IReadOnlyList<SecretProvisioningBindingPreview> _bindings;
    private readonly ComboBox _binding = new() { DropDownStyle = ComboBoxStyle.DropDownList };
    private readonly ComboBox _operation = new() { DropDownStyle = ComboBoxStyle.DropDownList };
    private readonly TextBox _reference = new() { MaxLength = 36 };
    private readonly Button _continue = new() { Text = "Continue" };

    public SecretOperationDialog(IReadOnlyList<SecretProvisioningBindingPreview> bindings)
    {
      _bindings = bindings;
      Text = "Manage Msaidizi local secret vault";
      Width = 650;
      Height = 275;
      StartPosition = FormStartPosition.CenterScreen;
      FormBorderStyle = FormBorderStyle.FixedDialog;
      MaximizeBox = false;
      MinimizeBox = false;

      _binding.Items.AddRange(bindings.Select(value =>
        $"{value.DisplayName} — {value.Destination}").ToArray<object>());
      _binding.SelectedIndex = 0;
      _operation.Items.AddRange(["Create", "Rotate", "Delete"]);
      _operation.SelectedIndex = 0;
      _operation.SelectedIndexChanged += (_, _) => RefreshState();
      _reference.TextChanged += (_, _) => RefreshState();
      _continue.Click += (_, _) =>
      {
        DialogResult = DialogResult.OK;
        Close();
      };

      var cancel = new Button { Text = "Cancel", DialogResult = DialogResult.Cancel };
      var layout = new TableLayoutPanel
      {
        Dock = DockStyle.Fill,
        Padding = new Padding(16),
        ColumnCount = 2,
        RowCount = 4,
      };
      layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 145));
      layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
      layout.Controls.Add(new Label { Text = "Approved destination", AutoSize = true }, 0, 0);
      layout.Controls.Add(_binding, 1, 0);
      layout.Controls.Add(new Label { Text = "Operation", AutoSize = true }, 0, 1);
      layout.Controls.Add(_operation, 1, 1);
      layout.Controls.Add(new Label { Text = "Existing reference ID", AutoSize = true }, 0, 2);
      layout.Controls.Add(_reference, 1, 2);
      var buttons = new FlowLayoutPanel
      {
        Dock = DockStyle.Fill,
        FlowDirection = FlowDirection.RightToLeft,
      };
      buttons.Controls.Add(cancel);
      buttons.Controls.Add(_continue);
      layout.Controls.Add(buttons, 1, 3);
      Controls.Add(layout);
      AcceptButton = _continue;
      CancelButton = cancel;
      RefreshState();
    }

    public SecretProvisioningSelection Selection
    {
      get
      {
        var operation = _operation.SelectedIndex switch
        {
          0 => SecretProvisioningOperations.Create,
          1 => SecretProvisioningOperations.Rotate,
          _ => SecretProvisioningOperations.Delete,
        };
        return new SecretProvisioningSelection(
          operation,
          _bindings[_binding.SelectedIndex].BindingId,
          operation == SecretProvisioningOperations.Create ? null : _reference.Text);
      }
    }

    private void RefreshState()
    {
      var create = _operation.SelectedIndex == 0;
      _reference.Enabled = !create;
      _continue.Enabled = create || Guid.TryParseExact(_reference.Text, "D", out _);
    }
  }

  private sealed class SecretConfirmationDialog : Form
  {
    private readonly CheckBox _confirm = new()
    {
      AutoSize = true,
      Text = "I confirm this exact local operation and destination.",
    };
    private readonly Button _commit = new() { Text = "Confirm locally", Enabled = false };

    public SecretConfirmationDialog(SecretProvisioningChallenge challenge)
    {
      Text = "Confirm exact secret-vault scope";
      Width = 760;
      Height = 500;
      StartPosition = FormStartPosition.CenterScreen;
      FormBorderStyle = FormBorderStyle.FixedDialog;
      MaximizeBox = false;
      MinimizeBox = false;
      var preview = new TextBox
      {
        Dock = DockStyle.Fill,
        Multiline = true,
        ReadOnly = true,
        ScrollBars = ScrollBars.Vertical,
        Text = $"Operation: {challenge.Operation}\r\n"
          + $"Name: {challenge.Binding.DisplayName}\r\n"
          + $"Kind: {challenge.Binding.Kind}\r\n"
          + $"Destination: {challenge.Binding.Destination}\r\n"
          + $"Destination SHA-256: {challenge.Binding.DestinationScopeSha256}\r\n"
          + $"Reference: {challenge.VaultReferenceId ?? "(new)"}\r\n\r\n"
          + "Capabilities:\r\n"
          + string.Join("\r\n", challenge.Binding.AllowedCapabilities.Select(value => $"• {value}")),
      };
      _confirm.CheckedChanged += (_, _) => _commit.Enabled = _confirm.Checked;
      _commit.Click += (_, _) =>
      {
        DialogResult = DialogResult.OK;
        Close();
      };
      var cancel = new Button { Text = "Cancel", DialogResult = DialogResult.Cancel };
      var bottom = new FlowLayoutPanel
      {
        Dock = DockStyle.Bottom,
        Height = 75,
        Padding = new Padding(10),
        FlowDirection = FlowDirection.RightToLeft,
      };
      bottom.Controls.Add(cancel);
      bottom.Controls.Add(_commit);
      bottom.Controls.Add(_confirm);
      Controls.Add(preview);
      Controls.Add(bottom);
      CancelButton = cancel;
    }
  }

  private sealed class SecureSecretEntryDialog : Form
  {
    private const int MaximumCharacters = 65_536;
    private readonly SecureString _secret = new();
    private readonly Label _length = new() { AutoSize = true };
    private readonly Button _save = new() { Text = "Encrypt and save", Enabled = false };

    public SecureSecretEntryDialog()
    {
      Text = "Enter secret locally";
      Width = 560;
      Height = 230;
      StartPosition = FormStartPosition.CenterScreen;
      FormBorderStyle = FormBorderStyle.FixedDialog;
      MaximizeBox = false;
      MinimizeBox = false;
      KeyPreview = true;
      KeyPress += CaptureKeyPress;

      _save.Click += (_, _) =>
      {
        DialogResult = DialogResult.OK;
        Close();
      };
      var cancel = new Button { Text = "Cancel", DialogResult = DialogResult.Cancel };
      var panel = new FlowLayoutPanel
      {
        Dock = DockStyle.Fill,
        Padding = new Padding(18),
        FlowDirection = FlowDirection.TopDown,
        WrapContents = false,
      };
      panel.Controls.Add(new Label
      {
        AutoSize = true,
        Text = "Type the secret. Clipboard paste is disabled; plaintext is never placed in a TextBox.",
      });
      panel.Controls.Add(_length);
      var buttons = new FlowLayoutPanel
      {
        AutoSize = true,
        FlowDirection = FlowDirection.LeftToRight,
      };
      buttons.Controls.Add(_save);
      buttons.Controls.Add(cancel);
      panel.Controls.Add(buttons);
      Controls.Add(panel);
      AcceptButton = _save;
      CancelButton = cancel;
      RefreshLength();
    }

    public unsafe SecretBuffer Export()
    {
      _secret.MakeReadOnly();
      var pointer = Marshal.SecureStringToGlobalAllocUnicode(_secret);
      try
      {
        var characters = new ReadOnlySpan<char>((void*)pointer, _secret.Length);
        var bytes = new byte[Encoding.UTF8.GetByteCount(characters)];
        try
        {
          Encoding.UTF8.GetBytes(characters, bytes);
          return new SecretBuffer(bytes);
        }
        catch
        {
          CryptographicOperations.ZeroMemory(bytes);
          throw;
        }
      }
      finally
      {
        Marshal.ZeroFreeGlobalAllocUnicode(pointer);
      }
    }

    protected override void Dispose(bool disposing)
    {
      if (disposing)
      {
        _secret.Dispose();
      }
      base.Dispose(disposing);
    }

    private void CaptureKeyPress(object? sender, KeyPressEventArgs eventArgs)
    {
      eventArgs.Handled = true;
      if (eventArgs.KeyChar == '\b')
      {
        if (_secret.Length > 0) _secret.RemoveAt(_secret.Length - 1);
      }
      else if (!char.IsControl(eventArgs.KeyChar) && _secret.Length < MaximumCharacters)
      {
        _secret.AppendChar(eventArgs.KeyChar);
      }
      RefreshLength();
    }

    private void RefreshLength()
    {
      _length.Text = $"Captured locally: {_secret.Length} character(s) "
        + new string('•', Math.Min(_secret.Length, 40));
      _save.Enabled = _secret.Length > 0;
    }
  }
}
