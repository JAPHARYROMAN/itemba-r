import type { ReactNode } from 'react';
import type { AccentName, Tone } from '@/design/tokens';
import { Container, Section } from './layout';
import { Eyebrow, Heading, Lede, type HeadingLevel } from './text';

export type CtaBandProps = {
  /** id of the heading; the band is labelled by it. */
  titleId: string;
  title: ReactNode;
  titleAs?: HeadingLevel;
  eyebrow?: ReactNode;
  lede?: ReactNode;
  /** The Enquire pill plus WhatsApp / Call links (ButtonLink, ContactLink). */
  actions?: ReactNode;
  tone?: Tone;
  accent?: AccentName;
  /** Content under the actions (a fallback note, a small print line). */
  children?: ReactNode;
  id?: string;
};

/**
 * The closing call to action ("Let's move something together."): a centred
 * display line, a short lede and the contact actions on a quiet tile.
 */
export function CtaBand({ titleId, title, titleAs = 'h2', eyebrow, lede, actions, tone = 'alt', accent, children, id }: CtaBandProps) {
  return (
    <Section tone={tone} accent={accent} id={id} labelledBy={titleId}>
      <Container size="prose" className="text-center">
        {eyebrow ? <Eyebrow className="mb-3">{eyebrow}</Eyebrow> : null}
        <Heading as={titleAs} id={titleId} size="display">
          {title}
        </Heading>
        {lede ? (
          <Lede tone="muted" className="mx-auto mt-5 max-w-[40rem]">
            {lede}
          </Lede>
        ) : null}
        {actions ? <div className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-4">{actions}</div> : null}
        {children ? <div className="mt-8">{children}</div> : null}
      </Container>
    </Section>
  );
}
