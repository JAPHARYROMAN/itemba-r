/**
 * The Itemba UI kit: typed server components with no copy of their own.
 * Pages pass content in from src/content; the kit supplies the design
 * (tokens, type scale, spacing, the Apple patterns).
 *
 * Client islands must not import this barrel: it pulls in Media and
 * Breadcrumbs, which read server-only content. Islands may import the
 * leaf modules that have no server-only imports: `@/ui/actions`,
 * `@/ui/Icon`, `@/ui/text`, `@/ui/layout`, `@/ui/a11y`, `@/ui/cn`.
 */
export { cn } from './cn';
export { Container, Section, Grid, Stack, Divider } from './layout';
export type { ContainerSize, SectionProps, SectionSpace, GridColumns, Gap } from './layout';
export { Eyebrow, Heading, HeadlineText, Lede, Prose } from './text';
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
export type { ButtonVariant, ButtonSize, ContactLinkProps } from './actions';
export { Card, CardLink, Bento, BentoCell } from './cards';
export type { BentoSpan } from './cards';
export { Stat, StatList, Chip, ChipList, FactList, FaqList } from './data';
export type { Fact } from './data';
export { Breadcrumbs } from './Breadcrumbs';
export type { BreadcrumbItem } from './Breadcrumbs';
export { Media, Figure, MediaCredit, resolveMedia } from './Media';
export type { MediaAspect, MediaSource } from './Media';
export { PageHero } from './PageHero';
export { CtaBand } from './CtaBand';
export { SubNav } from './SubNav';
export { Reveal } from './Reveal';
export { Icon, iconNames } from './Icon';
export type { IconName, IconSize } from './Icon';
export { VisuallyHidden, SkipLink } from './a11y';
export { StructuredData } from './StructuredData';
export type { JsonLdEntity } from './StructuredData';
