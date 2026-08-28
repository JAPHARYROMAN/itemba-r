using System.Text;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Tests;

public sealed class HostSecretReferenceVaultTests : IDisposable
{
  private readonly string _directory = Path.Combine(
    Path.GetTempPath(),
    $"msaidizi-secret-vault-{Guid.NewGuid():N}");

  [Fact]
  public async Task PersistsOnlyDpapiCiphertextAndUsesSecretEphemerally()
  {
    var vault = CreateVault();
    var secret = Encoding.UTF8.GetBytes("not-in-plans-logs-journals-or-results");
    var scope = PayloadDigest.Sha256Hex("https://finance.example.test");
    var metadata = await vault.ProvisionAsync(
      new TrustedSecretProvisioningRequest(
        "browser-session",
        scope,
        ["browser.form.submit"]),
      secret,
      CancellationToken.None);

    var persisted = await File.ReadAllBytesAsync(Assert.Single(Directory.GetFiles(_directory)));
    var observed = await vault.UseAsync(
      metadata.VaultReferenceId,
      "browser.form.submit",
      scope,
      (value, _) => ValueTask.FromResult(Encoding.UTF8.GetString(value.Span)),
      CancellationToken.None);

    Assert.Equal("not-in-plans-logs-journals-or-results", observed);
    Assert.DoesNotContain(observed, Encoding.UTF8.GetString(persisted));
    Assert.True(Guid.TryParseExact(metadata.VaultReferenceId, "D", out _));
  }

  [Fact]
  public async Task ReferenceIsNotBearerAuthorityAndCannotCrossCapabilityOrScope()
  {
    var vault = CreateVault();
    var scope = PayloadDigest.Sha256Hex("origin-a");
    var metadata = await vault.ProvisionAsync(
      new TrustedSecretProvisioningRequest("password", scope, ["browser.form.submit"]),
      Encoding.UTF8.GetBytes("correct horse battery staple"),
      CancellationToken.None);

    await Assert.ThrowsAsync<HostSecretReferenceException>(() => vault.UseAsync(
      metadata.VaultReferenceId,
      "process.command.execute",
      scope,
      (_, _) => ValueTask.FromResult(true),
      CancellationToken.None).AsTask());
    await Assert.ThrowsAsync<HostSecretReferenceException>(() => vault.UseAsync(
      metadata.VaultReferenceId,
      "browser.form.submit",
      PayloadDigest.Sha256Hex("origin-b"),
      (_, _) => ValueTask.FromResult(true),
      CancellationToken.None).AsTask());
  }

  [Fact]
  public async Task RotationAndDeletionRemainBoundAcrossVaultRestarts()
  {
    var scope = PayloadDigest.Sha256Hex("approved-destination");
    var request = new TrustedSecretProvisioningRequest(
      "api-token",
      scope,
      ["external.email.send"]);
    string referenceId;
    using (var first = CreateVault())
    {
      var created = await first.ProvisionAsync(
        request,
        Encoding.UTF8.GetBytes("first-value"),
        CancellationToken.None);
      Assert.Equal(1, created.Version);
      Assert.Equal(created.CreatedAt, created.UpdatedAt);
      referenceId = created.VaultReferenceId;
    }

    using (var restarted = CreateVault())
    {
      var rotated = await restarted.RotateAsync(
        referenceId,
        request,
        Encoding.UTF8.GetBytes("second-value"),
        CancellationToken.None);
      Assert.Equal(2, rotated.Version);
      Assert.True(rotated.UpdatedAt >= rotated.CreatedAt);
      var observed = await restarted.UseAsync(
        referenceId,
        "external.email.send",
        scope,
        (value, _) => ValueTask.FromResult(Encoding.UTF8.GetString(value.Span)),
        CancellationToken.None);
      Assert.Equal("second-value", observed);
    }

    using (var restartedAgain = CreateVault())
    {
      var deleted = await restartedAgain.DeleteAsync(
        referenceId,
        request,
        CancellationToken.None);
      Assert.Equal(2, deleted.Version);
      await Assert.ThrowsAsync<HostSecretReferenceException>(() => restartedAgain.UseAsync(
        referenceId,
        "external.email.send",
        scope,
        (_, _) => ValueTask.FromResult(true),
        CancellationToken.None).AsTask());
    }

    Assert.Empty(Directory.GetFiles(_directory));
  }

  private FileHostSecretReferenceVault CreateVault() => new(Options.Create(
    new HostCapabilityOptions { SecretVaultPath = _directory }));

  public void Dispose()
  {
    if (Directory.Exists(_directory)) Directory.Delete(_directory, recursive: true);
  }
}
