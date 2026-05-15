import { NextResponse } from 'next/server';

export function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'itemba-r-frontend',
    timestamp: new Date().toISOString(),
  });
}
