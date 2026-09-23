'use client';
import { useEffect, useState } from 'react';
import { backendGet } from '@/lib/api-client';
import { ITEMBA_DOCUMENT_LETTERHEAD } from '@/lib/document-letterhead';
import type { DocumentOrganization } from '@/components/documents/DocumentShell';

/** Legacy printable reports use the same resolver as downloaded documents. */
export function useDocumentLetterhead(companyId?: string, enabled = true) {
  const [result, setResult] = useState<{ companyId?: string; data: DocumentOrganization } | null>(
    null,
  );
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    backendGet<DocumentOrganization>(
      `/generated-documents/letterhead${companyId ? `?companyId=${encodeURIComponent(companyId)}` : ''}`,
    )
      .then((data) => {
        if (active) setResult({ companyId, data });
      })
      .catch(() => {
        if (active) setResult(null);
      });
    return () => {
      active = false;
    };
  }, [companyId, enabled]);
  const data = result?.companyId === companyId ? result?.data : undefined;
  return {
    groupName: data?.groupName ?? ITEMBA_DOCUMENT_LETTERHEAD.groupName,
    address: data?.address ?? ITEMBA_DOCUMENT_LETTERHEAD.address,
    telephone: data?.telephone ?? ITEMBA_DOCUMENT_LETTERHEAD.telephone,
    phone: data?.phone ?? ITEMBA_DOCUMENT_LETTERHEAD.phone,
    email: data?.email ?? ITEMBA_DOCUMENT_LETTERHEAD.email,
    website: data?.website ?? ITEMBA_DOCUMENT_LETTERHEAD.website,
    tin: data?.tin ?? '',
    vrn: data?.vrn ?? '',
    registrationNumber: data?.registrationNumber ?? '',
    logoUrl: data?.logoUrl ?? '/brand/itemba-group-logo.png',
  };
}
