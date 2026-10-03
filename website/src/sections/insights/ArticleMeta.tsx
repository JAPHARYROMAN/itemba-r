import type { InsightArticle } from '@/content/insights';
import { insightPageCopy } from '@/content/insights';
import { cn } from '@/ui';

const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** "2026-05-14" → "14 May 2026" (read as a UTC calendar date, so no time zone can shift it). */
export function formatDate(iso: string): string {
  return dateFormat.format(new Date(`${iso}T00:00:00Z`));
}

/**
 * An article's date line: the publication date in a <time datetime> (the
 * Article JSON-LD publishes the same date), the update date when it
 * differs, and the reading time. The dots between them are decorative.
 */
export function ArticleMeta({ article, className }: { article: InsightArticle; className?: string }) {
  const updated = article.updatedAt !== article.publishedAt;
  return (
    <p className={cn('flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-fg-muted', className)}>
      <time dateTime={article.publishedAt}>{formatDate(article.publishedAt)}</time>
      {updated ? (
        <>
          <span aria-hidden="true">·</span>
          <span>
            {insightPageCopy.meta.updated} <time dateTime={article.updatedAt}>{formatDate(article.updatedAt)}</time>
          </span>
        </>
      ) : null}
      <span aria-hidden="true">·</span>
      <span>{article.readingTime}</span>
    </p>
  );
}
