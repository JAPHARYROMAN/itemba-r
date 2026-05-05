import Link from 'next/link';
import { DocumentArtifactButton, type DocumentEntityType } from './DocumentArtifactButton';
import { DocumentPrintButton } from './DocumentPrintButton';

interface DocumentActionsProps {
  backHref: string;
  backLabel?: string;
  label: string;
  entityType: DocumentEntityType;
  entityId: string;
}

export function DocumentActions({
  backHref,
  backLabel = 'Back to List',
  label,
  entityType,
  entityId,
}: DocumentActionsProps) {
  return (
    <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-sm font-medium text-slate-700">{label}</div>
      <div className="flex flex-wrap gap-2">
        <Link
          href={backHref}
          className="inline-flex items-center justify-center rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-[12px] font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
        >
          {backLabel}
        </Link>
        <DocumentArtifactButton entityType={entityType} entityId={entityId} />
        <DocumentPrintButton />
      </div>
    </div>
  );
}

export function DocumentPreviewLink({
  href,
  label = 'View / Print / PDF',
}: {
  href: string;
  label?: string;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center justify-center rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700 transition-colors hover:bg-zinc-50 hover:text-zinc-950"
    >
      {label}
    </Link>
  );
}
