import type { ReactNode } from 'react';
import type { IconKey } from '@/content/types';
import { cn } from './cn';

/**
 * Line icons on a 24px grid, drawn with `currentColor`.
 * - The sector set (IconKey) is the legacy SectorIcon artwork; SectorIcon now
 *   renders through this component, so the paths live in one place.
 * - Contact icons (phone, mail, whatsapp) are the ones the footer, quick
 *   contact and enquiry fallbacks use.
 * - Interface glyphs (chevrons, plus, close…) complete the kit. No emoji.
 *
 * Icons are decorative by default (`aria-hidden`). Pass `title` only when the
 * icon is the sole content of a control and carries meaning on its own.
 */
export type ContactIconName = 'phone' | 'mail' | 'whatsapp';
export type InterfaceIconName =
  | 'chevron-right'
  | 'chevron-down'
  | 'arrow-right'
  | 'arrow-up-right'
  | 'plus'
  | 'minus'
  | 'check'
  | 'close'
  | 'menu'
  | 'map-pin'
  | 'download'
  | 'document'
  | 'droplet'
  | 'clock'
  | 'globe';
export type IconName = IconKey | ContactIconName | InterfaceIconName;

type Glyph = { body: ReactNode; filled?: boolean };

const round = { strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const glyphs: Record<IconName, Glyph> = {
  // ── Sectors (legacy SectorIcon set) ──
  energy: { body: <path d="M13 2L4.5 14h7L11 22l8.5-12h-7L13 2z" {...round} /> },
  trade: {
    body: (
      <>
        <path d="M3 7l9-4 9 4-9 4-9-4z" {...round} />
        <path d="M3 7v10l9 4 9-4V7" {...round} />
        <path d="M12 11v10" {...round} />
      </>
    ),
  },
  manufacturing: { body: <path d="M4 21h16M4 21V10l5 3V10l5 3V10l5 3v8M9 17h2M14 17h2" {...round} /> },
  construction: { body: <path d="M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6M10 11h4" {...round} /> },
  hospitality: {
    body: <path d="M5 21V5a2 2 0 012-2h10a2 2 0 012 2v16M3 21h18M9 8h1M14 8h1M9 12h1M14 12h1M10 17h4v4h-4z" {...round} />,
  },
  realestate: { body: <path d="M3 12l9-9 9 9M5 10v11h5v-7h4v7h5V10" {...round} /> },
  logistics: {
    body: (
      <path
        d="M3 7h11v9H3zM14 10h4l3 3v3h-7zM7.5 19a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM17.5 19a1.5 1.5 0 100-3 1.5 1.5 0 000 3z"
        {...round}
      />
    ),
  },

  // ── Contact ──
  phone: {
    body: (
      <path
        d="M3 5a2 2 0 012-2h2.2a1 1 0 01.95.68l1.1 3.3a1 1 0 01-.45 1.2l-1.5.82a12.5 12.5 0 005.7 5.7l.82-1.5a1 1 0 011.2-.45l3.3 1.1a1 1 0 01.68.95V19a2 2 0 01-2 2h-1C8.82 21 3 15.18 3 8V5z"
        {...round}
      />
    ),
  },
  mail: { body: <path d="M3 8l7.9 5.26a2 2 0 002.2 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" {...round} /> },
  whatsapp: {
    filled: true,
    body: (
      <path d="M12.04 2a9.83 9.83 0 00-8.46 14.82L2.4 22l5.29-1.12A9.83 9.83 0 1012.04 2zm0 1.78a8.05 8.05 0 014.07 14.99 8.06 8.06 0 01-7.85.36l-.33-.17-3.05.65.67-2.95-.2-.34A8.05 8.05 0 0112.04 3.78zm-3.5 4.15c-.18 0-.47.07-.72.34-.25.27-.95.93-.95 2.27 0 1.34.97 2.63 1.1 2.81.14.18 1.88 3.02 4.63 4.12 2.28.91 2.75.73 3.24.69.5-.05 1.61-.66 1.84-1.3.23-.64.23-1.19.16-1.3-.07-.12-.25-.18-.52-.32-.27-.13-1.6-.79-1.85-.88-.25-.09-.43-.14-.61.14-.18.27-.7.88-.86 1.06-.16.18-.32.2-.59.07-.27-.14-1.14-.42-2.17-1.34-.8-.71-1.34-1.59-1.5-1.86-.16-.27-.02-.42.12-.55.12-.12.27-.32.41-.48.14-.16.18-.27.27-.45.09-.18.05-.34-.02-.48-.07-.13-.61-1.48-.84-2.02-.22-.53-.44-.45-.61-.46h-.52z" />
    ),
  },

  // ── Interface ──
  'chevron-right': { body: <path d="M9 5l7 7-7 7" {...round} /> },
  'chevron-down': { body: <path d="M5 9l7 7 7-7" {...round} /> },
  'arrow-right': { body: <path d="M4 12h16M14 6l6 6-6 6" {...round} /> },
  'arrow-up-right': { body: <path d="M7 17L17 7M8 7h9v9" {...round} /> },
  plus: { body: <path d="M12 5v14M5 12h14" {...round} /> },
  minus: { body: <path d="M5 12h14" {...round} /> },
  check: { body: <path d="M5 12.5l4.5 4.5L19 7.5" {...round} /> },
  close: { body: <path d="M6 6l12 12M18 6L6 18" {...round} /> },
  menu: { body: <path d="M4 8.5h16M4 15.5h16" {...round} /> },
  'map-pin': {
    body: (
      <>
        <path d="M12 21s7-5.2 7-11a7 7 0 10-14 0c0 5.8 7 11 7 11z" {...round} />
        <path d="M12 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" {...round} />
      </>
    ),
  },
  download: { body: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" {...round} /> },
  document: { body: <path d="M14 3H7a1 1 0 00-1 1v16a1 1 0 001 1h10a1 1 0 001-1V7l-4-4zM14 3v4h4M9 13h6M9 17h6" {...round} /> },
  /** A drop of oil: lubricants. */
  droplet: { body: <path d="M12 3.5s-6 6.4-6 10.7a6 6 0 0012 0C18 9.9 12 3.5 12 3.5z" {...round} /> },
  clock: {
    body: (
      <>
        <path d="M12 21a9 9 0 100-18 9 9 0 000 18z" {...round} />
        <path d="M12 7v5l3 2" {...round} />
      </>
    ),
  },
  globe: {
    body: (
      <>
        <path d="M12 21a9 9 0 100-18 9 9 0 000 18z" {...round} />
        <path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" {...round} />
      </>
    ),
  },
};

export const iconNames = Object.keys(glyphs) as IconName[];

/** Rendered size: 16, 20, 24, 32 or 40px, or `em` to follow the text size. */
export type IconSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'em';

const sizeClasses: Record<IconSize, string> = {
  xs: 'size-4',
  sm: 'size-5',
  md: 'size-6',
  lg: 'size-8',
  xl: 'size-10',
  em: 'size-[1em]',
};

export type IconProps = {
  name: IconName;
  size?: IconSize;
  /** Colour and layout classes (not size: use `size`). */
  className?: string;
  /** Accessible name. Omit for decorative icons (the default). */
  title?: string;
  /** Stroke width for line icons, in grid units. */
  strokeWidth?: number;
};

export function Icon({ name, size = 'md', className, title, strokeWidth = 1.5 }: IconProps) {
  const glyph = glyphs[name];
  const labelled = title !== undefined && title !== '';
  return (
    <svg
      viewBox="0 0 24 24"
      fill={glyph.filled ? 'currentColor' : 'none'}
      stroke={glyph.filled ? 'none' : 'currentColor'}
      strokeWidth={glyph.filled ? undefined : strokeWidth}
      className={cn(sizeClasses[size], 'shrink-0', className)}
      focusable="false"
      {...(labelled ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true })}
    >
      {labelled ? <title>{title}</title> : null}
      {glyph.body}
    </svg>
  );
}
