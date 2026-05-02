# ITEMBA-R — UX Consolidation and Operator Efficiency Notes

## Current implementation slice

This document records the first Iteration 5 frontend pattern for API loading and shared operator states.

## Shared frontend API convention

`frontend/src/lib/api-client.ts` now provides a consistent convention for frontend-to-backend calls.

It currently provides:

- proxy-aware `backendFetch`, `backendGet`, `backendPost`, `backendPut`, `backendPatch`, and `backendDelete`
- direct backend `apiFetch` for explicit token-based server/client usage
- query-string construction that drops empty values
- consistent API error handling through `ApiError`
- envelope unwrapping for `{ success, data, timestamp }` responses
- paginated result normalization for list pages that receive either arrays or `{ data, total, page, limit, totalPages }`

## Shared list loading pattern

`frontend/src/hooks/use-api-resource.ts` introduces `useApiList` for list pages.

It standardizes:

- loading state
- error state
- reload behavior
- paginated response normalization
- query-driven refetching

## Shared operator states

The UI library now exports `PermissionDeniedState` alongside existing empty, loading, and error states.

The first adopted page is `companies`, which now uses:

- `useApiList` for list loading and search queries
- `ErrorState` with retry
- `EmptyState` with permission-aware action content
- `PermissionDeniedState` when the user lacks create access

## Next UX consolidation modules

Recommended order:

1. Migrate high-traffic list pages to `useApiList`: users, employees, journal entries, fuel shifts, sales orders.
2. Replace local response parsing with `backendGet`/mutation helpers.
3. Add a shared mutation hook for create/update/delete workflows with consistent saving/error states.
4. Add a shared page filter model for search, pagination, company, status, and date range.
5. Add smoke coverage for dashboard, company registry, finance journal entries, petroleum shifts, and HR employees.
