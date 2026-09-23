# ITEMBA OS app contract

`frontend/src/lib/apps.ts` is the registry for the library, dock, recents, app permissions and launch behavior. Core ERP module navigation remains in `NAV`; ITEMBA-R is one workspace app in the OS.

Every entry supplies a stable lowercase ID, internal route, label, description, category, icon, visual appearance, search keywords and launch policy. Persisted pins and recents contain IDs, never external URLs or credentials. Removing an entry or a user's permission removes it from launch surfaces without rewriting saved preferences.

Launch policies:

- `workspace`: reopen the current ERP document, or restore the last currently permitted ERP route.
- `settings`: open the OS settings panel.
- `route`: navigate to a tool implemented inside this application. Use `useGuardedRouter` for programmatic navigation and `useFormGuard` for editable work.
- `external`: open the common connection panel while keeping the ERP mounted. The service opens in a separate tab with `noopener noreferrer`; it retains its own authentication and data boundary. No ITEMBA session token is sent to that service.

## Adding an external tool

Add one `WorkspaceApp` entry to `APP_REGISTRY`. Use `/apps/<id>` for its route; the shared dynamic page already exists. Fuel Grid retains `/fuel-grid` as a compatible existing link.

```ts
{
  id: 'field-notes',
  href: '/apps/field-notes',
  label: 'Field Notes',
  description: 'Site notebooks',
  category: 'Productivity',
  icon: 'document',
  iconKey: 'grid',
  appearance: 'default',
  permission: 'field_notes.access',
  keywords: ['notes', 'sites'],
  launch: {
    kind: 'external',
    urlVariable: 'FIELD_NOTES_APP_URL',
    healthVariable: 'FIELD_NOTES_HEALTH_URL',
    authentication: 'Field Notes account',
  },
}
```

Register and assign the permission through the existing backend permission workflow. Configure the two URL variables on the server; never put credentials in a URL. The app URL must be the actual entry/login page. Health should be a readiness endpoint that checks dependencies. If no separate health URL is supplied, the entry page is checked.

The common `/api/apps/<id>/status` endpoint validates the ITEMBA session and app permission before making any service request. It only uses registry-selected server configuration, has a five-second timeout, disables response caching and requires both the launch page and health endpoint to respond successfully. This is an availability probe, not SSO or proof of a user's access inside the separate service. A launch may still be attempted when the advisory probe fails.

The shell passes resolved launch URLs to the same launcher for all external apps. Unknown or unauthorized app IDs do not launch. Adding an entry does not require editing the library, dock, shell or connection panel.

## Draft protection

Wrap editable values with `useFormGuard(values, restoreBaseline)`. Capture native input/change events with `draft.capture` or `onChangeCapture={draft.touch}`. Call `draft.change(action)` for custom pickers and add/remove controls. Route every modal dismissal through `draft.requestClose(close)`. Call `draft.markSaved()` only after successful persistence. Restore-baseline callbacks clear discarded work even when Next retains a page in its cache.

The provider handles ordinary links, guarded router actions, browser history, reload and `beforeunload`. The Navigation API protects supported browser traversals before the router handles them, with indexed history restoration as a fallback. Native browser exit prompts depend on browser support and prior user interaction; browser crashes and forced process termination cannot show a prompt. App switching uses the mounted workspace and does not discard drafts.

## Verification

Run from `frontend`:

```text
npx vitest run src/lib/apps.test.ts src/components/os/app-registration.test.tsx src/components/apps src/components/fuel-grid src/app/api/apps src/app/api/fuel-grid src/components/workspace
npx tsc --noEmit
```

The sample-tool test inserts a future registry entry and exercises library discovery, permission filtering, pinning, dock launch, the configured service URL and returning to a retained ERP draft. Keep this test alongside app-specific login/return and unavailable-state checks when adding a real service.
