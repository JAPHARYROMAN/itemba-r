import { mapCopy, mapsDirectionsUrl } from '@/content/contact';
import { VisuallyHidden } from './a11y';
import { cn } from './cn';
import { Icon } from './Icon';

const sizes = { body: 'text-body', 'body-lg': 'text-body-lg' } as const;

/**
 * "Get directions ↗": the head office in Google Maps, in a new tab (as the
 * footer's directions link). It sits outside the map facade, so it is
 * always visible, with or without the map opened. Styled as a chevron link
 * (the tone's text-safe accent), with the outbound arrow in place of the
 * chevron; `body-lg` only beside a large pill.
 */
export function DirectionsLink({ size = 'body', className }: { size?: keyof typeof sizes; className?: string }) {
  return (
    <a
      href={mapsDirectionsUrl()}
      target="_blank"
      rel="noopener noreferrer"
      className={cn('group inline-block text-accent-fg decoration-1 underline-offset-4 hover:underline', sizes[size], className)}
    >
      {mapCopy.directions}
      <VisuallyHidden> {mapCopy.newTab}</VisuallyHidden>
      <span aria-hidden="true" className="ml-[0.25em] inline-block align-middle text-[0.7em]">
        <Icon
          name="arrow-up-right"
          size="em"
          strokeWidth={2}
          className="transition-transform duration-fast ease-apple group-hover:-translate-y-px group-hover:translate-x-px"
        />
      </span>
    </a>
  );
}
