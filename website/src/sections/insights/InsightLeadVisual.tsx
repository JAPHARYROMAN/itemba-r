import { companies } from '@/content/companies';
import { isLeadPhoto, type InsightArticle, type LineupVisual } from '@/content/insights';
import { getMedia } from '@/content/media';
import { Figure, HeadlineText, Media, TypePanel, cn, keepCompounds } from '@/ui';

/**
 * The company line-up: one sentence over the companies an article names,
 * each with its accent dot and what it does, on an ink panel in a
 * photograph's place. Server markup, no motion.
 */
function CompanyLineup({
  visual,
  article,
  wide,
  className,
}: {
  visual: LineupVisual;
  article: InsightArticle;
  /** Three across from `sm` (the 680px article column); stacked in a narrower frame. */
  wide: boolean;
  className?: string;
}) {
  const named = companies.filter((company) => article.companySlugs.includes(company.slug));
  return (
    <div
      data-tone="cinema"
      data-type-panel=""
      className={cn('flex flex-col justify-between gap-10 rounded-tile bg-surface p-8 md:p-10', className)}
    >
      <p className="text-h2 font-semibold text-fg">
        <HeadlineText headline={visual.statement} variant="muted-break" breakFrom="always" />
      </p>
      <ul role="list" className={cn('grid gap-5', wide && 'sm:grid-cols-3 sm:gap-6')}>
        {named.map((company) => (
          <li key={company.slug} data-accent={company.accent} className="border-t border-line pt-4">
            <span aria-hidden="true" className="block size-2 rounded-full bg-accent" />
            <p className="mt-3 text-body-lg font-semibold text-fg">{company.shortName}</p>
            <p className="mt-1 text-caption text-fg-muted">{keepCompounds(company.eyebrow)}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export type InsightLeadVisualProps = {
  article: InsightArticle;
  /**
   * - `article`: under the article's header, in its 680px column (a
   *   1280px photograph stays sharp there), 2:1 from `md` and 4:3 on
   *   phones; the page's first image, so it is preloaded and never fades
   *   in.
   * - `feature`: the featured guide on /insights, in a 440px column
   *   beside the text (a typographic lead; a photograph would be framed
   *   the same way).
   */
  frame: 'article' | 'feature';
  className?: string;
};

/**
 * An article's lead visual (content: `article.lead`): a strong photograph
 * with its caption, or, where none exists, a typographic panel (a line
 * icon and one strong sentence) or the company line-up, on ink.
 */
export function InsightLeadVisual({ article, frame, className }: InsightLeadVisualProps) {
  const lead = article.lead;
  // The article frame is 2:1 from `md`, as the photograph leads are; on
  // phones the panel takes its text's height. An aspect ratio is only a
  // preferred size: a panel whose text needs more room grows to fit it.
  const panelShape =
    frame === 'article'
      ? 'min-h-72 md:aspect-[2/1]'
      : 'mx-auto aspect-[4/3] w-full max-w-md sm:aspect-square lg:mx-0 lg:max-w-[27.5rem]';

  if (isLeadPhoto(lead)) {
    const caption = lead.caption ? keepCompounds(lead.caption) : undefined;
    if (frame === 'feature') {
      return (
        <Figure
          media={lead}
          alt={lead.alt}
          caption={caption}
          radius="tile"
          aspect="1/1"
          sizes="(min-width: 1024px) 440px, (min-width: 492px) 448px, calc(100vw - 44px)"
          className={cn('mx-auto w-full max-w-md lg:mx-0 lg:max-w-[27.5rem]', className)}
        />
      );
    }
    // 4:3 on phones, so the subject reads at 316px; 2:1 in the 680px column
    // from `md`. `object-fit: cover` draws a wider photograph wider than its
    // frame, and `sizes` says so.
    // A registry credit (CC BY-SA) is overlaid by Media itself.
    const { width, height } = getMedia(lead.media);
    const cover = (ratio: number) => Math.max(1, Math.round((width / height / ratio) * 100) / 100);
    const phone = cover(4 / 3);
    const sizes = `(min-width: 768px) ${Math.ceil(680 * cover(2))}px, ${phone === 1 ? 'calc(100vw - 44px)' : `calc((100vw - 44px) * ${phone})`}`;
    return (
      <figure className={className}>
        <div className="relative aspect-[4/3] overflow-hidden rounded-tile md:aspect-[2/1]">
          <Media media={lead} alt={lead.alt} sizes={sizes} fill priority />
        </div>
        {caption ? <figcaption className="mt-3 text-caption text-fg-muted">{caption}</figcaption> : null}
      </figure>
    );
  }

  if (lead.kind === 'lineup') {
    return <CompanyLineup visual={lead} article={article} wide={frame === 'article'} className={cn(panelShape, className)} />;
  }

  return (
    <TypePanel
      tone="cinema"
      icon={lead.icon}
      statement={lead.statement}
      caption={lead.caption}
      className={cn(panelShape, className)}
    />
  );
}
