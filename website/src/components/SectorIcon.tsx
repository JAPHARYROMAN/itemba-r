import type { IconKey } from '@/content/types';
import { Icon } from '@/ui/Icon';

/**
 * Legacy API for the sector line icons. The artwork now lives in
 * src/ui/Icon.tsx; this wrapper keeps the pre-rebuild pages compiling until
 * they are replaced (WP3.1 deletes it).
 */
export type IconName = IconKey;

interface Props {
  name: IconName;
  className?: string;
}

export default function SectorIcon({ name, className }: Props) {
  // The callers size the icon with h-/w- classes, which Tailwind emits after
  // Icon's own `size-*` class, so theirs win.
  return <Icon name={name} className={className} />;
}
