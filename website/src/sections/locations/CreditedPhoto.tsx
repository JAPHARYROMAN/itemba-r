import { getMedia, type MediaImage } from '@/content/media';
import { leadPhotoSizes } from '@/sections/company/LeadPhoto';
import { Media, MediaCredit, resolveMedia } from '@/ui';

/**
 * The photograph's credit in full, as its licence asks (title, author,
 * source, licence): "Songwe Region landscape, Richard grivas / Wikimedia
 * Commons, CC BY-SA 4.0", the licence linked. The title is the content
 * image's caption; the rest comes from the media registry. A photograph
 * without a registry credit shows its caption alone.
 */
export function PhotoCredit({ photo }: { photo: MediaImage }) {
  const entry = resolveMedia(photo);
  if (!entry?.credit) return photo.caption ? <>{photo.caption}</> : null;
  return <MediaCredit entry={entry} title={photo.caption} />;
}

/**
 * A landscape photograph for a hero frame (4:3 on phones, 2:1 from `md`,
 * in the 1068px content width, as LeadPhoto's `panorama`), with no credit
 * of its own: the hero sets <PhotoCredit> under the frame (PageHero
 * `mediaCaption`), never over the picture. Its `sizes` come from
 * LeadPhoto, so the browser picks a file sharp enough for the crop.
 */
export function PanoramaPhoto({ photo, priority = false }: { photo: MediaImage; priority?: boolean }) {
  const entry = getMedia(photo.media);
  const sizes = leadPhotoSizes('panorama', 'content', entry.width / entry.height);
  return (
    <div className="relative aspect-[4/3] md:aspect-[2/1]">
      <Media media={photo} alt={photo.alt} sizes={sizes} fill priority={priority} credit="none" />
    </div>
  );
}
