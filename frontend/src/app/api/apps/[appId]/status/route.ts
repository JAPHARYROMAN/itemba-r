import { NextRequest, NextResponse } from 'next/server';
import { GET as session } from '@/app/api/auth/me/route';
import { getApp, canOpenApp } from '@/lib/apps';
import { checkAppConnection } from '@/lib/app-connections';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> },
) {
  const app = getApp((await params).appId);
  if (!app || app.launch.kind !== 'external')
    return NextResponse.json({ message: 'Unknown app' }, { status: 404, headers });
  const identity = await session(request);
  if (!identity.ok) return identity;
  const data = await identity.json();
  const permissions: unknown = data.data?.permissions;
  if (
    !Array.isArray(permissions) ||
    !canOpenApp(app, (permission) => permissions.includes(permission))
  )
    return NextResponse.json({ message: 'App access denied' }, { status: 403, headers });
  const response = NextResponse.json(await checkAppConnection(app), { headers });
  for (const cookie of identity.cookies.getAll()) response.cookies.set(cookie);
  return response;
}
