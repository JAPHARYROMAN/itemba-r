export type CcmHistoryItem = {
  actionNumber: string;
  type: string;
  issuedAt: string;
  reason: string;
  status: string;
};

function fmtDate(d?: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

export function CcmHistory({
  heading,
  items,
  included,
  overflowCount = 0,
  continued = false,
}: {
  heading: string;
  items: CcmHistoryItem[];
  included?: boolean;
  overflowCount?: number;
  continued?: boolean;
}) {
  return (
    <section className="ccm-history">
      <h3>{heading}</h3>
      {included === false ? (
        <p className="legal">Disciplinary history is not included for your access permissions.</p>
      ) : items.length ? (
        items.map((d) => (
          <div className="ccm-history-item" key={d.actionNumber}>
            <strong>{d.actionNumber}</strong>
            <p>
              {d.type.replace(/_/g, ' ')} · {fmtDate(d.issuedAt)} · {d.status.replace(/_/g, ' ')}
            </p>
            <p className="legal">{d.reason}</p>
          </div>
        ))
      ) : overflowCount > 0 || continued ? null : (
        <p className="legal">No disciplinary history included.</p>
      )}
      {overflowCount > 0 && (
        <p className="legal ccm-continue-note">
          {overflowCount} further disciplinary item(s) continue overleaf, with the signatures.
        </p>
      )}
    </section>
  );
}
