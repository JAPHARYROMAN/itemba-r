import { NextResponse } from 'next/server';
import { getFuelGridConfig, type FuelGridStatus } from '@/lib/fuel-grid';

export const dynamic = 'force-dynamic';

const RESPONSE_HEADERS = { 'Cache-Control': 'no-store' };

export async function GET() {
  const config = getFuelGridConfig();
  const checkedAt = new Date().toISOString();

  if (!config.appUrl || !config.healthUrl) {
    return NextResponse.json<FuelGridStatus>(
      { configured: false, available: false, checkedAt, latencyMs: null },
      { headers: RESPONSE_HEADERS },
    );
  }

  const startedAt = Date.now();
  try {
    const response = await fetch(config.healthUrl, {
      method: 'GET',
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(5_000),
      headers: { Accept: 'text/html,application/json;q=0.9,*/*;q=0.8' },
    });

    return NextResponse.json<FuelGridStatus>(
      {
        configured: true,
        available: response.status >= 200 && response.status < 400,
        checkedAt,
        latencyMs: Date.now() - startedAt,
      },
      { headers: RESPONSE_HEADERS },
    );
  } catch {
    return NextResponse.json<FuelGridStatus>(
      {
        configured: true,
        available: false,
        checkedAt,
        latencyMs: Date.now() - startedAt,
      },
      { headers: RESPONSE_HEADERS },
    );
  }
}
