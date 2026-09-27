import { cn } from './cn';
import { Icon } from './Icon';
import { keepCompounds } from './text';

/**
 * A checklist as hairline rows, each marked with a check in the tone's
 * graphic accent (the key-strengths pattern of the company pages). `lg`
 * sets the lines large (a cinema tile's list); `md` at body size (beside a
 * form).
 */
export function CheckList({
  items,
  size = 'lg',
  className,
}: {
  items: readonly string[];
  size?: 'lg' | 'md';
  className?: string;
}) {
  const large = size === 'lg';
  return (
    <ul role="list" className={cn('border-b border-line', className)}>
      {items.map((item) => (
        <li key={item} className={cn('flex items-start border-t border-line', large ? 'gap-4 py-4 md:py-5' : 'gap-3 py-3')}>
          <Icon name="check" size={large ? 'md' : 'sm'} strokeWidth={1.8} className={cn('text-accent', large ? 'mt-0.5' : 'mt-[3px]')} />
          <span className={large ? 'text-body-lg text-fg md:text-lede' : 'text-body text-fg'}>{keepCompounds(item)}</span>
        </li>
      ))}
    </ul>
  );
}
