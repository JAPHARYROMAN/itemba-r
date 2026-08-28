using System.Threading;
using Itemba.Msaidizi.Companion.Agent.Channel;

namespace Itemba.Msaidizi.Companion.Agent.Capabilities;

/// <summary>
/// Action-scoped access to ephemeral decrypted secrets. It is never a DTO,
/// artifact, clipboard, log field, adapter result, or persistence boundary.
/// </summary>
public sealed class SessionSecretAccessor
{
  private readonly AsyncLocal<ScopeState?> _current = new();

  public IDisposable Open(
    string actionId,
    IReadOnlyList<SessionResolvedSecret> secrets)
  {
    if (_current.Value is not null
      || secrets.GroupBy(secret => secret.BindingId, StringComparer.Ordinal)
        .Any(group => group.Count() != 1))
    {
      throw new InvalidOperationException("session_secret_scope_invalid");
    }

    var state = new ScopeState(actionId, secrets.ToDictionary(
      secret => secret.BindingId,
      StringComparer.Ordinal));
    _current.Value = state;
    return new Scope(this, state);
  }

  public ValueTask<T> UseAsync<T>(
    string actionId,
    string bindingId,
    Func<ReadOnlyMemory<byte>, CancellationToken, ValueTask<T>> consumer,
    CancellationToken cancellationToken)
  {
    var state = _current.Value;
    if (state is null
      || !string.Equals(state.ActionId, actionId, StringComparison.Ordinal)
      || !state.Secrets.TryGetValue(bindingId, out var secret))
    {
      throw new InvalidOperationException("session_secret_binding_unavailable");
    }
    return consumer(secret.Plaintext, cancellationToken);
  }

  private sealed record ScopeState(
    string ActionId,
    IReadOnlyDictionary<string, SessionResolvedSecret> Secrets);

  private sealed class Scope(SessionSecretAccessor owner, ScopeState state) : IDisposable
  {
    private bool _disposed;

    public void Dispose()
    {
      if (_disposed)
      {
        return;
      }
      _disposed = true;
      if (ReferenceEquals(owner._current.Value, state))
      {
        owner._current.Value = null;
      }
    }
  }
}
