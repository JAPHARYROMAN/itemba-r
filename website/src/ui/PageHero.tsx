import type { ReactNode } from 'react';
import type { AccentName, Tone } from '@/design/tokens';
import { cn } from './cn';
import { Container, Section, type ContainerSize } from './layout';
import { Eyebrow, Heading, Lede } from './text';

export type PageHeroProps = {
  /** id of the h1 (the hero section is labelled by it). One hero per page. */
  titleId?: string;
  eyebrow?: ReactNode;
  /** Accent dot before the eyebrow (company pages). */
  eyebrowDot?: boolean;
  /** The page's h1, usually a lead line verbatim. */
  title: ReactNode;
  titleSize?: 'display-xl' | 'display' | 'h1';
  /**
   * How wide the h1 may run: `prose` (980px, with the rest of the text) or
   * `wide` (up to 1184px), so a long lead line at display-xl sets in two
   * lines on a desktop rather than four. Only for a hero without breadcrumbs
   * (the text then sits in the wide container).
   */
  titleMeasure?: 'prose' | 'wide';
  /** Extra classes for the h1 (a phone size fitted to the headline's longest word group). */
  titleClassName?: string;
  lede?: ReactNode;
  /** A primary pill and a chevron link, as siblings (ButtonLink, ChevronLink, ContactLink). */
  actions?: ReactNode;
  /**
   * The hero photograph, a <Media priority …> (or a sized frame of one) with
   * no radius of its own. Never wrap it in <Reveal>: the hero and its LCP
   * image do not animate.
   */
  media?: ReactNode;
  /**
   * - `framed`: a 20/28px-radius frame under the text, in the `mediaSize`
   *   container (light pages).
   * - `bleed`: edge to edge (use on a cinema tone).
   * - `split`: a portrait photograph beside the text from `lg`, under it on
   *   smaller screens; centred text is set flush left beside it.
   */
  mediaLayout?: 'framed' | 'bleed' | 'split';
  /**
   * The container of a `framed` photograph: `wide` (1440px) suits a 2400px
   * master; a smaller photograph stays sharp in `content` or `prose`.
   */
  mediaSize?: Exclude<ContainerSize, 'measure'>;
  tone?: Tone;
  accent?: AccentName;
  align?: 'center' | 'start';
  /** A <Breadcrumbs> trail shown above the text. */
  breadcrumbs?: ReactNode;
  /** Extra content under the actions (chips, a fact row). */
  children?: ReactNode;
  id?: string;
};

/**
 * The Apple hero: eyebrow, display headline, lede and two actions, set
 * centred with generous space, then one large photograph (or, for a
 * portrait photograph, text and photograph side by side). The text is
 * static server HTML: no entrance motion, never hidden before paint. The
 * lede steps down to 19px on phones, so the headline leads there too.
 */
export function PageHero({
  titleId = 'page-title',
  eyebrow,
  eyebrowDot = false,
  title,
  titleSize = 'display',
  titleMeasure = 'prose',
  titleClassName,
  lede,
  actions,
  media,
  mediaLayout = 'framed',
  mediaSize = 'wide',
  tone = 'light',
  accent,
  align = 'center',
  breadcrumbs,
  children,
  id,
}: PageHeroProps) {
  const split = mediaLayout === 'split' && Boolean(media);
  const centred = align === 'center';
  // A centred split hero is centred while it stacks, and flush left beside its photograph from `lg`.
  const flushFromLg = centred && split;
  const wideTitle = titleMeasure === 'wide' && !split;

  const text = (
    <div className={cn(!split && !wideTitle && 'max-w-prose', centred && 'mx-auto text-center', flushFromLg && 'lg:mx-0 lg:text-left')}>
      {eyebrow ? (
        <Eyebrow dot={eyebrowDot} className="mb-3">
          {eyebrow}
        </Eyebrow>
      ) : null}
      <Heading as="h1" id={titleId} size={titleSize} className={cn(wideTitle && 'max-w-[74rem]', wideTitle && centred && 'mx-auto', titleClassName)}>
        {title}
      </Heading>
      {lede ? (
        <Lede className={cn('mt-5 max-w-2xl max-md:text-body-lg md:mt-6', centred && 'mx-auto', flushFromLg && 'lg:mx-0')}>{lede}</Lede>
      ) : null}
      {actions ? (
        <div
          className={cn(
            'mt-8 flex flex-wrap items-center gap-x-8 gap-y-4',
            centred && 'justify-center',
            flushFromLg && 'lg:justify-start',
          )}
        >
          {actions}
        </div>
      ) : null}
      {children ? <div className="mt-8">{children}</div> : null}
    </div>
  );

  return (
    <Section tone={tone} accent={accent} id={id} labelledBy={titleId} space="none" className="pb-section-tight pt-10 md:pt-14">
      <Container size={wideTitle ? 'wide' : 'content'}>
        {breadcrumbs ? <div className="mb-8 md:mb-12">{breadcrumbs}</div> : null}
        {split ? (
          <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,27.5rem)] lg:gap-16">
            {text}
            <div className="mx-auto w-full max-w-md overflow-hidden rounded-tile lg:max-w-none">{media}</div>
          </div>
        ) : (
          text
        )}
      </Container>
      {media && !split ? (
        mediaLayout === 'framed' ? (
          <Container size={mediaSize} className="mt-10 md:mt-12">
            <div className="overflow-hidden rounded-tile">{media}</div>
          </Container>
        ) : (
          <div className="mt-10 md:mt-12">{media}</div>
        )
      ) : null}
    </Section>
  );
}
