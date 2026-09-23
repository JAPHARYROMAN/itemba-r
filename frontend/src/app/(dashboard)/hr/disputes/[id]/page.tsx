'use client';
import { useParams } from 'next/navigation';
import { DisputeDetailWorkspace } from '@/components/workspace/dispute-detail';
export default function DisputeDetailPage() {
  const { id } = useParams<{ id: string }>();
  return <DisputeDetailWorkspace key={id} id={id} />;
}
