import { SetMetadata } from '@nestjs/common';

/** Marks a route as authenticated by a directly verified client TLS socket. */
export const DIRECT_MTLS_DEVICE_KEY = 'direct_mtls_device';

export const DirectMtlsDevice = () => SetMetadata(DIRECT_MTLS_DEVICE_KEY, true);
