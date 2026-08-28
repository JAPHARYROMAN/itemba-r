import { UnauthorizedException } from '@nestjs/common';
import { MsaidiziDeviceStatus } from '@prisma/client';
import type { Request } from 'express';
import { TLSSocket } from 'node:tls';
import { pairingCodeDigest, pairingMarker } from './device-security';
import { directMtlsPeer } from './direct-mtls-peer';
import { MsaidiziDevicesService } from './msaidizi-devices.service';

const DEVICE_CERTIFICATE_DER = Buffer.from(
  'MIIBSDCB7qADAgECAghgalo12Dhb7zAKBggqhkjOPQQDAjAgMR4wHAYDVQQDExVUZXN0IFVudHJ1c3RlZCBEZXZpY2UwIBcNMjAwMTAxMDAwMDAwWhgPMjEyMDAxMDEwMDAwMDBaMCAxHjAcBgNVBAMTFVRlc3QgVW50cnVzdGVkIERldmljZTBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABDJgMrOIOaxdtj4Z18V4Vwpkqz8DNNCi2niSubITXL4sabpdkiWVHJFYJxeVISIQYgvDoo6vnB0CgckOjTcmTyOjEDAOMAwGA1UdEwEB/wQCMAAwCgYIKoZIzj0EAwIDSQAwRgIhAKgQBq2n0gCxK/vBZpvOpUKKQHcMOZTk7SHjXgy33UDCAiEAi4j7RpG378LnCzz9/Zcf+BBvD9SwQTqtMRpWU1aSLdA=',
  'base64',
);

function directRequest(options: { proof?: boolean; authorized?: boolean } = {}): Request {
  const socket = Object.create(TLSSocket.prototype) as TLSSocket;
  Object.defineProperties(socket, {
    encrypted: { value: true },
    authorized: { value: options.authorized ?? false },
    getProtocol: { value: () => 'TLSv1.3' },
    getPeerFinished: {
      value: () => (options.proof === false ? undefined : Buffer.from('tls-finished-proof')),
    },
    getPeerCertificate: { value: () => ({ raw: DEVICE_CERTIFICATE_DER }) },
  });
  return { socket, headers: {} } as unknown as Request;
}

describe('Msaidizi first-trust device pairing', () => {
  it('accepts a directly presented self-signed P-256 peer with TLS Finished proof', () => {
    const peer = directMtlsPeer(directRequest({ authorized: false }));

    expect(peer.chainAuthorized).toBe(false);
    expect(peer.certificateSha256).toMatch(/^[0-9A-F]{64}$/);
    expect(peer.publicKeySha256).toMatch(/^[0-9A-F]{64}$/);
    expect(peer.publicKeyPem).toContain('BEGIN PUBLIC KEY');
  });

  it('rejects a certificate-shaped request without direct handshake proof', () => {
    expect(() => directMtlsPeer(directRequest({ proof: false }))).toThrow(UnauthorizedException);
  });

  it('atomically binds the exact certificate fingerprint and SPKI to the one-time code', async () => {
    const pairingCode = 'ABCD-EF12-3456';
    const pairingPepper = 'p'.repeat(64);
    const peer = directMtlsPeer(directRequest());
    const pending = {
      id: 'device-1',
      principalId: 'principal-1',
      status: MsaidiziDeviceStatus.PENDING,
      publicKey: pairingMarker(pairingCodeDigest(pairingPepper, 'device-1', pairingCode)),
      certificateThumbprint: null,
      capabilityManifest: {
        pairing: {
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          initiatedByUserId: 'operator-1',
        },
      },
    };
    const prisma = {
      msaidiziDevice: {
        findUnique: jest.fn().mockResolvedValue(pending),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const service = new MsaidiziDevicesService(
      prisma as never,
      {
        pairingReady: () => true,
        pairingPepper,
      } as never,
      {} as never,
      audit as never,
    );
    const manifest = {
      deviceId: 'device-1',
      manifestSha256: 'A'.repeat(64),
      capabilities: [],
      generatedAt: new Date().toISOString(),
    };

    await expect(
      service.completePairing(
        {
          deviceId: 'device-1',
          pairingCode,
          platform: 'windows',
          osVersion: 'Windows 11',
          architecture: 'x64',
          capabilityManifest: manifest,
        },
        directRequest(),
      ),
    ).resolves.toEqual({ deviceId: 'device-1', status: MsaidiziDeviceStatus.ACTIVE });
    expect(prisma.msaidiziDevice.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          certificateThumbprint: peer.certificateSha256,
          publicKey: peer.publicKeyPem,
          status: MsaidiziDeviceStatus.ACTIVE,
        }),
      }),
    );
  });

  it('rejects a valid direct certificate that has not been paired', async () => {
    const prisma = {
      msaidiziDevice: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const service = new MsaidiziDevicesService(
      prisma as never,
      { channelEnabled: true } as never,
      {} as never,
      {} as never,
    );
    const authenticate = service as unknown as {
      authenticateDevice(request: Request, deviceId: string): Promise<unknown>;
    };

    await expect(authenticate.authenticateDevice(directRequest(), 'device-1')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(prisma.msaidiziDevice.findUnique).toHaveBeenCalledWith({
      where: { certificateThumbprint: directMtlsPeer(directRequest()).certificateSha256 },
    });
  });
});
