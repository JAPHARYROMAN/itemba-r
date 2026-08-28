using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.EgressSupervisor.Core;

namespace Itemba.Msaidizi.EgressSupervisor.Transport;

internal static class EgressExactHttpRequestValidator
{
  public static bool IsAuthorized(
    EgressFlowAuthorization flow,
    ReadOnlySpan<byte> request)
  {
    var separator = request.IndexOf("\r\n\r\n"u8);
    if (separator <= 0
      || separator > 65_536
      || !Ascii(request[..separator]))
    {
      return false;
    }

    var body = request[(separator + 4)..];
    if (!FixedTimeHex(Sha256Hex(body), flow.RequestBodySha256))
    {
      return false;
    }

    var lines = Encoding.ASCII.GetString(request[..separator]).Split("\r\n");
    if (lines.Length != 11)
    {
      return false;
    }

    var hostName = flow.DestinationHost.Contains(':', StringComparison.Ordinal)
      ? $"[{flow.DestinationHost}]"
      : flow.DestinationHost;
    var host = flow.DestinationPort == 443
      ? hostName
      : $"{hostName}:{flow.DestinationPort.ToString(CultureInfo.InvariantCulture)}";
    const string idempotencyPrefix = "Idempotency-Key: ";
    const string authorizationReferencePrefix = "Authorization-Reference: ";
    if (!lines[5].StartsWith(idempotencyPrefix, StringComparison.Ordinal)
      || !lines[10].StartsWith(authorizationReferencePrefix, StringComparison.Ordinal))
    {
      return false;
    }
    var idempotencyKey = lines[5][idempotencyPrefix.Length..];
    return lines[0] == $"POST {flow.DestinationPathAndQuery} HTTP/1.1"
      && lines[1] == $"Host: {host}"
      && lines[2] == "Content-Type: application/json; charset=utf-8"
      && lines[3] == $"Content-Length: {body.Length.ToString(CultureInfo.InvariantCulture)}"
      && lines[4] == "User-Agent: Itemba-Msaidizi-Companion/1.0"
      && idempotencyKey.Length is >= 1 and <= 200
      && idempotencyKey.All(character => character is >= '!' and <= '~')
      && FixedTimeHex(PayloadDigest.Sha256Hex(idempotencyKey), flow.IdempotencyKeySha256)
      && lines[6] == $"X-Itemba-Action-Id: {flow.ActionId}"
      && lines[7] == $"X-Itemba-Request-Sha256: {flow.RequestBodySha256}"
      && lines[8] == $"X-Itemba-Expected-Pre-State-Sha256: {flow.ExpectedPreStateSha256}"
      && lines[9] == "Connection: close"
      && lines[10] == $"Authorization-Reference: {flow.CredentialReferenceId}";
  }

  public static byte[] CreateAuthorizedRequest(
    EgressFlowAuthorization flow,
    ReadOnlySpan<byte> template,
    ReadOnlySpan<byte> credential)
  {
    if (!IsAuthorized(flow, template)
      || credential.Length is < 1 or > 32_768
      || !Printable(credential))
    {
      throw new InvalidDataException("The exact egress request credential is invalid.");
    }
    var separator = template.IndexOf("\r\n\r\n"u8);
    var lastLine = template[..separator].LastIndexOf("\r\nAuthorization-Reference: "u8);
    if (lastLine < 0)
    {
      throw new InvalidDataException("The exact egress authorization marker is absent.");
    }
    var retainedHeader = template[..lastLine];
    var authorization = Encoding.ASCII.GetBytes(
      $"\r\nAuthorization: {flow.CredentialPrefix}");
    var request = GC.AllocateUninitializedArray<byte>(checked(
      retainedHeader.Length + authorization.Length + credential.Length
      + template.Length - separator));
    var offset = 0;
    retainedHeader.CopyTo(request.AsSpan(offset));
    offset += retainedHeader.Length;
    authorization.CopyTo(request, offset);
    offset += authorization.Length;
    credential.CopyTo(request.AsSpan(offset));
    offset += credential.Length;
    template[separator..].CopyTo(request.AsSpan(offset));
    CryptographicOperations.ZeroMemory(authorization);
    return request;
  }

  private static bool Ascii(ReadOnlySpan<byte> value)
  {
    foreach (var item in value)
    {
      if (item > 0x7f || item == 0)
      {
        return false;
      }
    }
    return true;
  }

  private static bool Printable(ReadOnlySpan<byte> value)
  {
    foreach (var item in value)
    {
      if (item is < 0x21 or > 0x7e)
      {
        return false;
      }
    }
    return true;
  }

  private static string Sha256Hex(ReadOnlySpan<byte> value)
  {
    var digest = SHA256.HashData(value);
    try
    {
      return Convert.ToHexString(digest).ToLowerInvariant();
    }
    finally
    {
      CryptographicOperations.ZeroMemory(digest);
    }
  }

  private static bool FixedTimeHex(string left, string right)
  {
    if (!PayloadDigest.IsSha256Hex(left) || !PayloadDigest.IsSha256Hex(right))
    {
      return false;
    }
    var leftBytes = Convert.FromHexString(left);
    var rightBytes = Convert.FromHexString(right);
    try
    {
      return CryptographicOperations.FixedTimeEquals(leftBytes, rightBytes);
    }
    finally
    {
      CryptographicOperations.ZeroMemory(leftBytes);
      CryptographicOperations.ZeroMemory(rightBytes);
    }
  }
}
