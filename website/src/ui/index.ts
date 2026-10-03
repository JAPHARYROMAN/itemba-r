/**
 * The Itemba UI kit: typed server components with no copy of their own.
 * Pages pass content in from src/content; the kit supplies the design
 * (tokens, type scale, spacing, the Apple patterns).
 *
 * Client islands must not import this barrel: it pulls in Media and
 * Breadcrumbs, which read server-only content. Islands may import the
 * leaf modules that have no server-only imports: `@/ui/button` (a pill's
 * classes), `@/ui/Chevron`, `@/ui/cn`, `@/ui/Icon`, `@/ui/text`,
 * `@/ui/layout`, `@/ui/a11y` and `@/ui/actions`. Code that every page
 * loads (the layout's islands, the error boundaries) keeps to the first
 * three: `@/ui/actions` brings the icon set and the contact helpers.
 */
export { cn } from './cn';
export { Container, Section, Grid, Stack, Divider } from './layout';
export type { ContainerSize, SectionProps, SectionSpace, GridColumns, Gap } from './layout';
export { Eyebrow, Heading, HeadlineText, Lede, Prose, keepCompounds } from './text';
export type { HeadingLevel, HeadingSize } from './text';
export {
  Button,
  ButtonLink,
  ChevronLink,
  Chevron,
  ContactLink,
  SmartLink,
  buttonClasses,
  contactHref,
  isInternalHref,
} from './actions';
export type { ButtonVariant, ButtonSize, ChevronSize, ContactLinkProps } from './actions';
export { Card, CardLink, Bento, BentoCell } from './cards';
export type { BentoSpan } from './cards';
export { Stat, StatList, Chip, ChipList, FactList, FaqList } from './data';
export { CheckList } from './CheckList';
export { Shortcuts } from './Shortcuts';
export type { Shortcut } from './Shortcuts';
export { DirectionsLink } from './DirectionsLink';
export { MapFacade } from './MapFacade';
export type { MapFacadeProps } from './MapFacade';
export type { Fact } from './data';
export { Breadcrumbs } from './Breadcrumbs';
export type { BreadcrumbItem } from './Breadcrumbs';
export { Media, Figure, MediaCredit, resolveMedia } from './Media';
export type { MediaAspect, MediaSource } from './Media';
export { PageHero } from './PageHero';
export { TypePanel } from './TypePanel';
export type { TypePanelProps } from './TypePanel';
export { CtaBand } from './CtaBand';
export { SubNav } from './SubNav';
export { Reveal } from './Reveal';
export { Icon, iconNames } from './Icon';
export type { IconName, IconSize } from './Icon';
export { VisuallyHidden, SkipLink } from './a11y';
export { StructuredData } from './StructuredData';
export type { JsonLdEntity } from './StructuredData';
