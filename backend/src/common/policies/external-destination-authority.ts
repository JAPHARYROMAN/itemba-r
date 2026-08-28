export const STATIC_EXTERNAL_DESTINATION_AUTHORITY = 'static_endpoint_v1' as const;
export const DYNAMIC_EXTERNAL_DESTINATION_AUTHORITY = 'mandate_dynamic_https_v1' as const;

export type ExternalDestinationAuthority =
  | typeof STATIC_EXTERNAL_DESTINATION_AUTHORITY
  | typeof DYNAMIC_EXTERNAL_DESTINATION_AUTHORITY;

const DYNAMIC_ONLY_FIELDS = new Set([
  'destinationUri',
  'serverCertificateSha256',
  'vaultReferenceId',
  'vaultRecordSha256',
  'headerPrefix',
  'origin',
]);
const DYNAMIC_REQUIRED_FIELDS = [
  'endpointId',
  'destinationUri',
  'serverCertificateSha256',
  'vaultReferenceId',
  'vaultRecordSha256',
  'headerPrefix',
] as const;
const EXTERNAL_DESTINATION_AUTHORITIES = new Set<ExternalDestinationAuthority>([
  STATIC_EXTERNAL_DESTINATION_AUTHORITY,
  DYNAMIC_EXTERNAL_DESTINATION_AUTHORITY,
]);

export function requestedExternalDestinationAuthority(
  capability: string,
  argumentsValue: unknown,
): ExternalDestinationAuthority | 'invalid' {
  if (!isDestinationGovernedCapability(capability) && !isBrowserCapability(capability)) {
    return STATIC_EXTERNAL_DESTINATION_AUTHORITY;
  }
  if (!argumentsValue || typeof argumentsValue !== 'object' || Array.isArray(argumentsValue)) {
    return 'invalid';
  }
  const argumentsObject = argumentsValue as Record<string, unknown>;
  const authority = argumentsObject.destinationAuthority;
  if (isBrowserCapability(capability)) {
    return authority !== undefined ||
      Object.keys(argumentsObject).some((key) => DYNAMIC_ONLY_FIELDS.has(key))
      ? 'invalid'
      : STATIC_EXTERNAL_DESTINATION_AUTHORITY;
  }
  if (authority === DYNAMIC_EXTERNAL_DESTINATION_AUTHORITY) {
    return hasCompleteDynamicEnvelope(argumentsObject) ? authority : 'invalid';
  }
  if (
    authority !== undefined ||
    Object.keys(argumentsObject).some((key) => DYNAMIC_ONLY_FIELDS.has(key))
  ) {
    return 'invalid';
  }
  return STATIC_EXTERNAL_DESTINATION_AUTHORITY;
}

export function grantAllowsExternalDestinationAuthority(
  grant: Record<string, unknown>,
  authority: ExternalDestinationAuthority,
): boolean {
  if (authority === STATIC_EXTERNAL_DESTINATION_AUTHORITY) return true;
  const values = grant.externalDestinationAuthorities;
  return (
    Array.isArray(values) &&
    values.length > 0 &&
    values.every(
      (value): value is ExternalDestinationAuthority =>
        typeof value === 'string' &&
        EXTERNAL_DESTINATION_AUTHORITIES.has(value as ExternalDestinationAuthority),
    ) &&
    new Set(values).size === values.length &&
    values.includes(authority)
  );
}

function isDestinationGovernedCapability(capability: string): boolean {
  return capability.startsWith('external.');
}

function hasCompleteDynamicEnvelope(value: Record<string, unknown>): boolean {
  if (
    !DYNAMIC_REQUIRED_FIELDS.every((field) => Object.prototype.hasOwnProperty.call(value, field))
  ) {
    return false;
  }
  return (
    typeof value.endpointId === 'string' &&
    /^[A-Za-z0-9._-]{1,80}$/.test(value.endpointId) &&
    typeof value.destinationUri === 'string' &&
    value.destinationUri.length >= 1 &&
    value.destinationUri.length <= 2_048 &&
    typeof value.serverCertificateSha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(value.serverCertificateSha256) &&
    typeof value.vaultReferenceId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      value.vaultReferenceId,
    ) &&
    typeof value.vaultRecordSha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(value.vaultRecordSha256) &&
    typeof value.headerPrefix === 'string' &&
    value.headerPrefix.length <= 64 &&
    /^[\x20-\x7e]*$/.test(value.headerPrefix)
  );
}

function isBrowserCapability(capability: string): boolean {
  return capability.startsWith('browser.');
}
