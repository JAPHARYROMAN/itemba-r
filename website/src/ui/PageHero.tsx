import type { ReactNode } from 'react';
import type { AccentName, Tone } from '@/design/tokens';
import { cn } from './cn';
import { Container, Section } from './layout';
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
  lede?: ReactNode;
  /** A primary pill and a chevron link, as siblings (ButtonLink, ChevronLink, ContactLink). */
  actions?: ReactNode;
  /**
   * The hero photograph, a <Media priority …> with no radius of its own.
   * Never wrap it in <Reveal>: the hero and its LCP image do not animate.
   */
  media?: ReactNode;
  /**
   * `framed`: a 20/28px-radius frame in the wide container (light pages).
   * `bleed`: edge to edge (use on a cinema tone).
   */
  mediaLayout?: 'framed' | 'bleed';
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
 * centred with generous space, then one large photograph. The text is
 * static server HTML: no entrance motion, never hidden before paint.
 */
export function PageHero({
  titleId = 'page-title',
  eyebrow,
  eyebrowDot = false,
  title,
  titleSize = 'display',
  lede,
  actions,
  media,
  mediaLayout = 'framed',
  tone = 'light',
  accent,
  align = 'center',
  breadcrumbs,
  children,
  id,
}: PageHeroProps) {
  const centred = align === 'center';
  return (
    <Section tone={tone} accent={accent} id={id} labelledBy={titleId} space="none" className="pb-section-tight pt-10 md:pt-16">
      <Container size="content">
        {breadcrumbs ? <div className="mb-8 md:mb-12">{breadcrumbs}</div> : null}
        <div className={cn('max-w-prose', centred && 'mx-auto text-center')}>
          {eyebrow ? (
            <Eyebrow dot={eyebrowDot} className="mb-3 md:mb-4">
              {eyebrow}
            </Eyebrow>
          ) : null}
          <Heading as="h1" id={titleId} size={titleSize}>
            {title}
          </Heading>
          {lede ? <Lede className={cn('mt-5 max-w-2xl md:mt-6', centred && 'mx-auto')}>{lede}</Lede> : null}
          {actions ? (
            <div className={cn('mt-8 flex flex-wrap items-center gap-x-8 gap-y-4 md:mt-10', centred && 'justify-center')}>{actions}</div>
          ) : null}
          {children ? <div className="mt-8">{children}</div> : null}
        </div>
      </Container>
      {media ? (
        mediaLayout === 'framed' ? (
          <Container size="wide" className="mt-12 md:mt-16">
            <div className="overflow-hidden rounded-tile">{media}</div>
          </Container>
        ) : (
          <div className="mt-12 md:mt-16">{media}</div>
        )
      ) : null}
    </Section>
  );
}
