import { NextRequest, NextResponse } from 'next/server';
import { getBackendInternalUrl } from '@/lib/backend-url';

const BACKEND = getBackendInternalUrl();

function backendUnavailableResponse() {
  return NextResponse.json({ message: 'Backend service unavailable' }, { status: 502 });
}

export async function GET(req: NextRequest) {
  const accessToken = req.cookies.get('itemba_access')?.value;

  if (!accessToken) {
    return NextResponse.json({ message: 'Not authenticated' }, { status: 401 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${BACKEND}/auth/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    return backendUnavailableResponse();
  }

  const data = await upstream
    .json()
    .catch(() => ({ message: 'Backend returned an empty response' }));
  return NextResponse.json(data, { status: upstream.status });
}
