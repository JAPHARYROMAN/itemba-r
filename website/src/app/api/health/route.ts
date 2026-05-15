import { NextResponse } from 'next/server';

export function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'itemba-group-website',
    timestamp: new Date().toISOString(),
  });
}
