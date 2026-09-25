# ITEMBA Originals wallpaper collection — 25 September 2026

Five new images generated with the built-in image-generation tool: Dune Light, Tidal Glass, Aurora Veil, Pearl Fold and Midnight Rift. Original PNGs, optimised WebP backgrounds, picker thumbnails, manifest and a downloadable ZIP are installed in `frontend/public/brand/wallpapers/itemba-originals-v1/`.

## Verification

- Frontend and backend production builds passed.
- Six focused frontend tests and five backend tests passed. Changed frontend components passed ESLint.
- Backend tests preserve owner checks for private uploads, reject unknown bundled identifiers and stale profile revisions, and check the public manifest matches the allowlist.
- Asset tests verify all five originals, PNG dimensions, display-image SHA-256 checksums, thumbnails and the ZIP. Original output is 1672 × 941, without upscaling or a 4K claim.
- All five desktop image URLs return HTTP 200 with `image/webp`. Manifest returns JSON. The ZIP is served through the existing public brand-assets route as `application/zip`; a full HTTP download matched the installed archive byte for byte.
- In the running app, selected Tidal Glass using the keyboard, observed its desktop background, refreshed, and confirmed selection persisted with “Synced to your account”.
- Selected Pearl Fold and visually checked dark text on the bright background, shortcut labels, dark-themed widgets and window chrome. Selected wallpaper and colour theme are independent.
- Checked the thumbnail picker at the normal 635 px pane width and at 390 px. It switches from two columns to one without clipped controls. Original browser dimensions were restored.
- Restored the user's original theme wallpaper after verification and left Appearance Studio open at the collection. No business records were changed during this task.
- Local services restarted on frontend 3009 and backend 3014; health returned 200. No database migration is required.
