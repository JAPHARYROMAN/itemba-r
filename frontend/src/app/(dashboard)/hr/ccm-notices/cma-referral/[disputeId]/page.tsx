'use client';
import { useParams } from 'next/navigation';
import { CcmDocumentWorkspace } from '@/components/workspace/ccm-document-workspace';
export default function Page() {
  const params = useParams<{ disputeId: string }>();
  return <CcmDocumentWorkspace key={params.disputeId} id={params.disputeId} kind="cma-referral" />;
}
