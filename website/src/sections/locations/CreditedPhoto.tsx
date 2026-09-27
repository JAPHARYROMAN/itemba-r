import { getMedia, type MediaImage } from '@/content/media';
import { leadPhotoSizes } from '@/sections/company/LeadPhoto';
import { Media } from '@/ui';

/**
 * The photograph's credit in full, as its licence asks (title, author,
 * source, licence): "Songwe Region landscape, Richard grivas / Wikimedia
 * Commons, CC BY-SA 4.0", the licence linked. The title is the content
 * image's caption; the rest comes from the media registry. A photograph
 * without a registry credit shows its caption alone.
 */
export function PhotoCredit({ photo }: { photo: MediaImage }) {
  const entry = getMedia(photo.media);
  const parts = [photo.caption, entry.credit].filter(Boolean).join(', ');
  if (!entry.licence) return <>{parts}</>;
  return (
    <>
      {parts ? `${parts}, ` : null}
      {entry.licenceUrl ? (
        <a href={entry.licenceUrl} rel="license noopener" className="underline decoration-1 underline-offset-2 hover:text-fg">
          {entry.licence}
        </a>
      ) : (
        entry.licence
      )}
    </>
  );
}

/**
 * A landscape photograph in the hero frame (4:3 on phones, 2:1 from `md`,
 * in the 1068px content width, as LeadPhoto's `panorama`), with its credit
 * set under the frame as a small caption, never over the picture and never
 * cropped away. The frame's `sizes` come from LeadPhoto, so the browser
 * picks a file sharp enough for the crop.
 */
export function CreditedPhoto({ photo, priority = false, className }: { photo: MediaImage; priority?: boolean; className?: string }) {
  const entry = getMedia(photo.media);
  const sizes = leadPhotoSizes('panorama', 'content', entry.width / entry.height);
  return (
    <figure className={className}>
      <div className="relative aspect-[4/3] overflow-hidden rounded-tile md:aspect-[2/1]">
        <Media media={photo} alt={photo.alt} sizes={sizes} fill priority={priority} credit="none" />
      </div>
      <figcaption className="mt-3 text-legal text-fg-muted md:text-right">
        <PhotoCredit photo={photo} />
      </figcaption>
    </figure>
  );
}
