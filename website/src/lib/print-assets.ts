/**
 * Loading the company-profile print documents' photos only when a profile is
 * about to print.
 *
 * The four print documents (src/print/ProfileDocuments.tsx) are hidden on
 * screen, and their photos are plain `<img src="/images/…" loading="lazy">`
 * (the frozen PDF script needs that shape), so a screen visitor downloads
 * none of them. When a profile is chosen for printing, these helpers switch
 * that document's photos to `loading="eager"` (which starts the downloads)
 * and can wait for them to decode:
 *
 * - PrintAssetLoader (src/islands) does it whenever `printing-company-profile`
 *   appears on <body>, which is how both PrintProfileButton and
 *   scripts/generate-profile-pdfs.mjs pick a profile; the script's own
 *   decode() wait then covers the loads;
 * - PrintProfileButton waits (4 s at most) before calling window.print().
 *
 * Browser-only: every function touches `document`.
 */

/** The class PrintProfileButton and the PDF script put on <body> to print one profile. */
export const PRINTING_CLASS = 'printing-company-profile';

/** The profile a print without an explicit choice shows (print.css defaults to it). */
export const DEFAULT_PRINT_PROFILE = 'group';

/** How long the print button waits for photos before printing anyway. */
export const PRINT_IMAGE_WAIT_MS = 4000;

/** The profile the page would print now: body[data-print-profile], or the group profile. */
export function activePrintProfile(): string {
  return document.body.dataset.printProfile || DEFAULT_PRINT_PROFILE;
}

/** The photos (and logos) of one print document; none when the page has no such document. */
export function printDocumentImages(profileId: string): HTMLImageElement[] {
  const selector = `.print-profile-document[data-profile="${CSS.escape(profileId)}"]`;
  const article = document.querySelector(selector);
  return article ? Array.from(article.querySelectorAll('img')) : [];
}

/** Starts loading one print document's images now; returns them. */
export function loadPrintImages(profileId: string): HTMLImageElement[] {
  const images = printDocumentImages(profileId);
  for (const image of images) {
    if (image.loading !== 'eager') image.loading = 'eager';
  }
  return images;
}

/**
 * Resolves once every image has loaded and decoded, or failed, or after
 * `timeoutMs`, whichever is first. True when all settled in time.
 */
export async function waitForImages(images: readonly HTMLImageElement[], timeoutMs: number): Promise<boolean> {
  if (!images.length) return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settled = Promise.all(images.map((image) => image.decode().catch(() => undefined))).then(() => true);
  const timedOut = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    return await Promise.race([settled, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

/** Loads one profile's images and waits for them (capped). True when all were ready in time. */
export function preparePrintImages(profileId: string, timeoutMs: number = PRINT_IMAGE_WAIT_MS): Promise<boolean> {
  return waitForImages(loadPrintImages(profileId), timeoutMs);
}
