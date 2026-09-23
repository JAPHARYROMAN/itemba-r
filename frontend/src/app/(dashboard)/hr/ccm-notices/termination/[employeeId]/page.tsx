'use client';
import { useParams } from 'next/navigation';
import { CcmDocumentWorkspace } from '@/components/workspace/ccm-document-workspace';
export default function Page() {
  const params = useParams<{ employeeId: string }>();
  return <CcmDocumentWorkspace key={params.employeeId} id={params.employeeId} kind="termination" />;
}
