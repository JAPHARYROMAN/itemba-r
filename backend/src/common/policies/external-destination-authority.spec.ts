import {
  DYNAMIC_EXTERNAL_DESTINATION_AUTHORITY,
  grantAllowsExternalDestinationAuthority,
  requestedExternalDestinationAuthority,
  STATIC_EXTERNAL_DESTINATION_AUTHORITY,
} from './external-destination-authority';

describe('external destination authority', () => {
  it('keeps static endpoints compatible without requiring a destination grant', () => {
    expect(
      requestedExternalDestinationAuthority('external.email.send', {
        endpointId: 'mail-primary',
      }),
    ).toBe(STATIC_EXTERNAL_DESTINATION_AUTHORITY);
    expect(grantAllowsExternalDestinationAuthority({}, STATIC_EXTERNAL_DESTINATION_AUTHORITY)).toBe(
      true,
    );
  });

  it('accepts only a closed, duplicate-free authority grant from persisted mandate JSON', () => {
    const allows = (externalDestinationAuthorities: unknown) =>
      grantAllowsExternalDestinationAuthority(
        { externalDestinationAuthorities },
        DYNAMIC_EXTERNAL_DESTINATION_AUTHORITY,
      );

    expect(allows([DYNAMIC_EXTERNAL_DESTINATION_AUTHORITY])).toBe(true);
    expect(
      allows([STATIC_EXTERNAL_DESTINATION_AUTHORITY, DYNAMIC_EXTERNAL_DESTINATION_AUTHORITY]),
    ).toBe(true);
    expect(allows([])).toBe(false);
    expect(
      allows([DYNAMIC_EXTERNAL_DESTINATION_AUTHORITY, DYNAMIC_EXTERNAL_DESTINATION_AUTHORITY]),
    ).toBe(false);
    expect(allows([DYNAMIC_EXTERNAL_DESTINATION_AUTHORITY, 'legacy_unrestricted_v0'])).toBe(false);
    expect(allows([DYNAMIC_EXTERNAL_DESTINATION_AUTHORITY, 7])).toBe(false);
  });

  it('requires the complete dynamic destination envelope at every plan boundary', () => {
    const complete = {
      endpointId: 'mail-dynamic',
      destinationAuthority: DYNAMIC_EXTERNAL_DESTINATION_AUTHORITY,
      destinationUri: 'https://api.itemba.com/v1/email/send',
      serverCertificateSha256: 'a'.repeat(64),
      vaultReferenceId: '78ad31e5-b7d8-48f4-b606-bc6cd0e82c0f',
      vaultRecordSha256: 'b'.repeat(64),
      headerPrefix: 'Bearer ',
    };

    expect(requestedExternalDestinationAuthority('external.email.send', complete)).toBe(
      DYNAMIC_EXTERNAL_DESTINATION_AUTHORITY,
    );
    for (const field of [
      'endpointId',
      'destinationUri',
      'serverCertificateSha256',
      'vaultReferenceId',
      'vaultRecordSha256',
      'headerPrefix',
    ]) {
      const partial = { ...complete } as Record<string, unknown>;
      delete partial[field];
      expect(requestedExternalDestinationAuthority('external.email.send', partial)).toBe('invalid');
    }
    expect(
      requestedExternalDestinationAuthority('external.email.send', {
        ...complete,
        serverCertificateSha256: 'A'.repeat(64),
      }),
    ).toBe('invalid');
    expect(
      requestedExternalDestinationAuthority('external.email.send', {
        ...complete,
        endpointId: 'mail:dynamic',
      }),
    ).toBe('invalid');
  });

  it('rejects dynamic browser authority until an independent live-origin boundary exists', () => {
    expect(
      requestedExternalDestinationAuthority('browser.uri.open', {
        originId: 'reports',
        relativePath: '/approved',
        destinationAuthority: DYNAMIC_EXTERNAL_DESTINATION_AUTHORITY,
        origin: 'https://reports.example.net/',
      }),
    ).toBe('invalid');
    expect(
      requestedExternalDestinationAuthority('browser.form.text.set', {
        originId: 'reports',
        origin: 'https://reports.example.net/',
      }),
    ).toBe('invalid');
  });
});
