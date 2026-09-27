import Link from 'next/link';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import {
  contact,
  mailtoHref,
  mailtoWithSubject,
  telHref,
  whatsappWithMessage,
  type ContactKind,
} from '@/content/contact';
import { cn } from './cn';
import { Icon, type IconName } from './Icon';
import { VisuallyHidden } from './a11y';

/**
 * Actions: Apple-style pills and chevron links.
 * - `primary`: the tone's solid pill (ink with white text on light tones,
 *   white with ink text on cinema).
 * - `secondary`: an outlined pill in the tone's text colour; it fills on
 *   hover.
 * - `inverse`: the cinema pill (white, ink text) whatever the section tone,
 *   for use over photography or on a cinema card inside a light tile.
 * - ChevronLink: "Learn more ›", in the tone's text-safe accent.
 * Every pairing is covered by tests/unit/design-tokens.test.ts.
 *
 * This module has no server-only imports, so client islands may use it
 * (import from `@/ui/actions`, not the `@/ui` barrel).
 */

export type ButtonVariant = 'primary' | 'secondary' | 'inverse';
export type ButtonSize = 'sm' | 'md' | 'lg';

const base =
  'relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-pill text-center transition-colors duration-fast ease-apple disabled:cursor-not-allowed disabled:opacity-50';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-btn text-btn-fg hover:bg-btn-hover',
  secondary: 'border border-fg text-fg hover:bg-fg hover:text-surface',
  inverse: 'bg-btn text-btn-fg hover:bg-btn-hover',
};

/**
 * `sm` is 32px tall with an invisible hit area that reaches 44px; `md` is
 * 44px; `lg` is 52px.
 */
const sizes: Record<ButtonSize, string> = {
  sm: "min-h-8 px-4 text-caption after:absolute after:-inset-x-1 after:-inset-y-1.5 after:content-['']",
  md: 'min-h-11 px-[22px] text-body',
  lg: 'min-h-[52px] px-8 text-body-lg',
};

const iconSizes: Record<ButtonSize, 'xs' | 'sm'> = { sm: 'xs', md: 'sm', lg: 'sm' };

/** Class list for a pill, for islands that render their own element. */
export function buttonClasses({ variant = 'primary', size = 'md' }: { variant?: ButtonVariant; size?: ButtonSize } = {}) {
  return cn(base, variants[variant], sizes[size]);
}

/**
 * `inverse` borrows the cinema tone's button colours by re-mapping the tone
 * variables on the element itself. The utility classes win over the
 * `[data-tone]` surface paint in base.css (same specificity, later sheet).
 */
const toneFor = (variant: ButtonVariant) => (variant === 'inverse' ? 'cinema' : undefined);

type PillContentProps = { icon?: IconName; iconPosition?: 'start' | 'end'; size: ButtonSize; children: ReactNode };

function PillContent({ icon, iconPosition = 'start', size, children }: PillContentProps) {
  const glyph = icon ? <Icon name={icon} size={iconSizes[size]} /> : null;
  return (
    <>
      {iconPosition === 'start' ? glyph : null}
      <span>{children}</span>
      {iconPosition === 'end' ? glyph : null}
    </>
  );
}

type CommonPillProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconPosition?: 'start' | 'end';
  className?: string;
  children: ReactNode;
};

export type ButtonProps = CommonPillProps & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'>;

export function Button({ variant = 'primary', size = 'md', icon, iconPosition, className, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} data-tone={toneFor(variant)} className={cn(buttonClasses({ variant, size }), className)} {...rest}>
      <PillContent icon={icon} iconPosition={iconPosition} size={size}>
        {children}
      </PillContent>
    </button>
  );
}

/** Same-site paths and fragments use next/link; everything else is a plain anchor. */
export function isInternalHref(href: string) {
  return (href.startsWith('/') && !href.startsWith('//')) || href.startsWith('#');
}

type AnchorProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'className' | 'children' | 'href'>;

/** An anchor that routes internal paths through next/link. */
export function SmartLink({ href, className, children, ...rest }: AnchorProps & { href: string; className?: string; children: ReactNode }) {
  if (isInternalHref(href) && !rest.download) {
    return (
      <Link href={href} className={className} {...rest}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} className={className} {...rest}>
      {children}
    </a>
  );
}

export type ButtonLinkProps = CommonPillProps & AnchorProps & { href: string };

export function ButtonLink({ href, variant = 'primary', size = 'md', icon, iconPosition, className, children, ...rest }: ButtonLinkProps) {
  return (
    <SmartLink href={href} data-tone={toneFor(variant)} className={cn(buttonClasses({ variant, size }), className)} {...rest}>
      <PillContent icon={icon} iconPosition={iconPosition} size={size}>
        {children}
      </PillContent>
    </SmartLink>
  );
}

/* ── Chevron link ─────────────────────────────────────────────────────── */

const chevronSizes = {
  caption: 'text-caption',
  body: 'text-body',
  lede: 'text-lede',
} as const;

export type ChevronLinkProps = AnchorProps & {
  href: string;
  /** Type size: `body` (17px) by default, `lede` in heroes, `caption` in dense rows. */
  size?: keyof typeof chevronSizes;
  /** `accent` (default) uses the tone's text-safe accent; `default` the text colour. */
  tone?: 'accent' | 'default';
  /**
   * Words appended for screen readers only, so a generic "Learn more" link
   * has a unique name ("Learn more about Westsides").
   */
  context?: string;
  className?: string;
  children: ReactNode;
};

/**
 * A plain-text label as [everything before the last word, the last word],
 * so the last word and the chevron can be kept on one line. Labels that are
 * not plain text come back whole, as `[null, children]`.
 */
function splitLastWord(children: ReactNode): [string | null, ReactNode] {
  const parts = Array.isArray(children) ? children : [children];
  if (!parts.every((part) => typeof part === 'string' || typeof part === 'number')) return [null, children];
  const text = parts.join('');
  const cut = text.lastIndexOf(' ');
  return cut < 0 ? ['', text] : [text.slice(0, cut + 1), text.slice(cut + 1)];
}

/**
 * "Learn more ›": a text link with a trailing chevron. When a long label
 * wraps, its last word and the chevron move to the next line together, so
 * the chevron never sits alone or drifts to the far edge.
 */
export function ChevronLink({ href, size = 'body', tone = 'accent', context, className, children, ...rest }: ChevronLinkProps) {
  const [head, tail] = splitLastWord(children);
  const hidden = context ? <VisuallyHidden> {context}</VisuallyHidden> : null;
  const chevron = <Chevron className="ml-[0.3em] inline-block align-middle" />;
  return (
    <SmartLink
      href={href}
      className={cn(
        'group inline-block decoration-1 underline-offset-4 hover:underline',
        chevronSizes[size],
        tone === 'accent' ? 'text-accent-fg' : 'text-fg',
        className,
      )}
      {...rest}
    >
      {head === null ? (
        <>
          {children}
          {hidden}
          {chevron}
        </>
      ) : (
        <>
          {head}
          <span className="whitespace-nowrap">
            {tail}
            {hidden}
            {chevron}
          </span>
        </>
      )}
    </SmartLink>
  );
}

/** The chevron glyph used by chevron links and breadcrumbs (decorative). */
export function Chevron({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={cn('size-[0.62em] shrink-0 transition-transform duration-fast ease-apple group-hover:translate-x-0.5', className)}
    >
      <path d="M4.25 1.75L8.5 6l-4.25 4.25" />
    </svg>
  );
}

/* ── Contact links ────────────────────────────────────────────────────── */

type ContactTarget =
  | { kind: 'tel'; /** E.164; defaults to the group's primary line. */ phone?: string }
  | { kind: 'mailto'; subject?: string; body?: string }
  | { kind: 'whatsapp'; /** Prepared message; defaults to the general enquiry message. */ message?: string };

/**
 * The href for a contact action, in exactly the forms ConversionTracker
 * classifies: `tel:` (phone_click), `mailto:` (email_click) and a `wa.me/`
 * URL (whatsapp_click).
 */
export function contactHref(target: ContactTarget): string {
  switch (target.kind) {
    case 'tel':
      return telHref(target.phone ?? contact.primaryPhone);
    case 'mailto':
      return target.subject ? mailtoWithSubject(target.subject, target.body) : mailtoHref();
    case 'whatsapp':
      return target.message ? whatsappWithMessage(target.message) : contact.whatsapp;
  }
}

const contactIcons: Record<ContactKind, IconName> = { tel: 'phone', mailto: 'mail', whatsapp: 'whatsapp' };

const chevronSizeFor: Record<ButtonSize, keyof typeof chevronSizes> = { sm: 'caption', md: 'body', lg: 'lede' };

export type ContactLinkProps = ContactTarget & {
  /** `chevron` renders a chevron link; `plain` an unstyled anchor; the rest are pills. */
  appearance?: ButtonVariant | 'chevron' | 'plain';
  /** Pill size; for `chevron`, the type size (sm: caption, md: body, lg: lede, to sit beside a pill of that size). */
  size?: ButtonSize;
  /** Show the contact icon (pills only). Defaults to true. */
  withIcon?: boolean;
  className?: string;
  'aria-label'?: string;
  children: ReactNode;
};

/**
 * A phone, email or WhatsApp action. The visible label comes from content;
 * the href always comes from src/content/contact.ts. WhatsApp links open in
 * the same tab, as on origin/main (wa.me hands off to the app on phones).
 */
export function ContactLink(props: ContactLinkProps) {
  const { appearance = 'primary', size = 'md', withIcon = true, className, children } = props;
  const href = contactHref(props);
  const common = { 'data-contact': props.kind, 'aria-label': props['aria-label'] } as const;

  if (appearance === 'plain') {
    return (
      <a href={href} className={className} {...common}>
        {children}
      </a>
    );
  }
  if (appearance === 'chevron') {
    return (
      <ChevronLink href={href} size={chevronSizeFor[size]} className={className} {...common}>
        {children}
      </ChevronLink>
    );
  }
  return (
    <ButtonLink
      href={href}
      variant={appearance}
      size={size}
      icon={withIcon ? contactIcons[props.kind] : undefined}
      className={className}
      {...common}
    >
      {children}
    </ButtonLink>
  );
}
