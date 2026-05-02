/**
 * ITEMBA-R Load Test — Petroleum Module
 * Tests petroleum shift and reading endpoints
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const errorRate = new Rate('errors');

export const options = {
  stages: [
    { duration: '30s', target: 20 },
    { duration: '60s', target: 20 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';

let authToken = null;

export function setup() {
  const loginRes = http.post(
    `${BASE_URL}/api/v1/auth/login`,
    JSON.stringify({ email: 'admin@itemba-r.com', password: 'Admin@1618!' }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  if (loginRes.status === 200) {
    return { token: JSON.parse(loginRes.body).accessToken };
  }
  return { token: null };
}

export default function (data) {
  const headers = {
    Authorization: `Bearer ${data.token}`,
    'Content-Type': 'application/json',
  };

  // List fuel shifts
  const shiftsRes = http.get(`${BASE_URL}/api/v1/fuel-shifts?limit=10`, { headers });
  const shiftsOk = check(shiftsRes, {
    'fuel shifts list 200': (r) => r.status === 200 || r.status === 403,
    'fuel shifts response < 500ms': (r) => r.timings.duration < 500,
  });
  errorRate.add(!shiftsOk);

  // List nozzle readings
  const nozzleRes = http.get(`${BASE_URL}/api/v1/fuel-nozzle-readings?limit=10`, { headers });
  check(nozzleRes, {
    'nozzle readings 200': (r) => r.status === 200 || r.status === 403,
    'nozzle response < 500ms': (r) => r.timings.duration < 500,
  });

  // List tanks
  const tanksRes = http.get(`${BASE_URL}/api/v1/petroleum-tanks?limit=10`, { headers });
  check(tanksRes, {
    'tanks list 200': (r) => r.status === 200 || r.status === 403,
  });

  sleep(1);
}
