'use client';
import Link from 'next/link';
import { Btn, PageHeader, PageSpinner, PermissionDeniedState } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { CmaReferralDocument, type CmaForm } from './cma-referral-document';
import { TerminationDocument, type Form1Payload } from './termination-document';
import './workspace.css';
import './ccm-document.css';

export function CcmDocumentWorkspace({
  id,
  kind,
}: {
  id: string;
  kind: 'termination' | 'cma-referral';
}) {
  const { hasPermission } = useAuth();
  const canRead = hasPermission('employees.view');
  const result = useWorkspaceResource<CmaForm | Form1Payload>(
    `/hr/ccm-notices/${kind}/${id}`,
    {},
    canRead && !!id,
  );
  const referral = kind === 'cma-referral';
  const title = referral ? 'CMA referral draft' : 'Termination notice draft';
  const parent = referral ? `/hr/disputes/${id}` : `/hr/employees/${id}`;
  if (!canRead)
    return <PermissionDeniedState description="Your role cannot view employment documents." />;
  // Hide related history even if an older server response includes it.
  const data =
    result.data &&
    (hasPermission('disciplinary_actions.view')
      ? result.data
      : {
          ...result.data,
          disciplinaryHistory: [],
          disciplinaryHistoryIncluded: false,
        });
  return (
    <div className="business-workspace ccm-workspace">
      <PageHeader
        title={title}
        subtitle={
          data
            ? `${data.employee.fullName} · ${data.employer.name}`
            : 'Review the document before printing.'
        }
        breadcrumbs={[
          { label: 'People', href: '/hr' },
          {
            label: referral ? 'Disputes' : 'Employees',
            href: referral ? '/hr/disputes' : '/hr/employees',
          },
          { label: title },
        ]}
        actions={
          <>
            <Link href={parent} className="workspace-secondary-link">
              {referral ? 'Back to dispute' : 'Back to employee'}
            </Link>
            {data && !result.loading && !result.error && (
              <Btn onClick={() => window.print()}>Print / Save as PDF</Btn>
            )}
          </>
        }
      />
      {result.loading ? (
        <PageSpinner />
      ) : result.error || !data ? (
        <div className="workspace-notice" role="alert">
          <p>{result.error || 'Document not found.'}</p>
          <Btn variant="secondary" onClick={result.reload}>
            Try again
          </Btn>
        </div>
      ) : (
        <>
          <div className="ccm-draft-note">
            <strong>Draft for review</strong>
            <p>
              {referral
                ? 'Review the recorded details before printing. Opening or printing this draft does not file a referral with CMA.'
                : 'Review the recorded details and complete the blank notice fields before use. Opening or printing this draft does not terminate employment or notify the employee.'}
            </p>
          </div>
          {referral && 'dispute' in data ? (
            <CmaReferralDocument data={data} />
          ) : !referral && 'employment' in data ? (
            <TerminationDocument data={data} />
          ) : (
            <div role="alert" className="workspace-notice">
              The document response does not match this view.
            </div>
          )}
        </>
      )}
    </div>
  );
}
