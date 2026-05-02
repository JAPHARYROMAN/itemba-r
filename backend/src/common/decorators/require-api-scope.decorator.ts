import { SetMetadata } from '@nestjs/common';

export const API_SCOPE_KEY = 'apiScope';

/**
 * Marks a route as requiring one or more API-key scopes. Works with the
 * ApiKeyAuthGuard: when a request authenticates via x-api-key, every scope
 * declared here must be present on the key (AND semantics).
 *
 * Usage: `@RequireApiScope('payments.read', 'payments.write')`
 */
export const RequireApiScope = (...scopes: string[]) => SetMetadata(API_SCOPE_KEY, scopes);
