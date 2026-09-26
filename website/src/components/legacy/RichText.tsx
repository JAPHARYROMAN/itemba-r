import type { RichText as RichTextValue } from '@/content/types';

/**
 * Renders content RichText runs: plain strings as text, `{ strong }` runs as
 * <strong>. Presentation (the strong class) stays with the caller.
 */
export default function RichText({ text, strongClassName }: { text: RichTextValue; strongClassName?: string }) {
  return (
    <>
      {text.map((run, index) =>
        typeof run === 'string' ? (
          run
        ) : (
          <strong key={index} className={strongClassName}>
            {run.strong}
          </strong>
        ),
      )}
    </>
  );
}
