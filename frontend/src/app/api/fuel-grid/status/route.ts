import { NextRequest } from 'next/server';
import { GET as appStatus } from '@/app/api/apps/[appId]/status/route';

export const dynamic = 'force-dynamic';
/** Preserve existing bookmarks and clients under the same authorization policy. */
export function GET(request: NextRequest) {
  return appStatus(request, { params: Promise.resolve({ appId: 'fuel-grid' }) });
}
