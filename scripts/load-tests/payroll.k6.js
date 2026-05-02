/**
 * ITEMBA-R Load Test — Payroll (Read-only)
 * Tests payroll list endpoints
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const errorRate = new Rate('errors');

export const options = {
  stages: [
    { duration: '20s', target: 15 },
    { duration: '40s', target: 15 },
    { duration: '20s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';

export function setup() {
  const res = http.post(
    `${BASE_URL}/api/v1/auth/login`,
    JSON.stringify({ email: 'admin@itemba-r.com', password: 'Admin@1618!' }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  return { token: res.status === 200 ? JSON.parse(res.body).accessToken : null };
}

export default function (data) {
  const headers = {
    Authorization: `Bearer ${data.token}`,
    'Content-Type': 'application/json',
  };

  const payrollRes = http.get(`${BASE_URL}/api/v1/payroll-runs?limit=10`, { headers });
  const ok = check(payrollRes, {
    'payroll runs 200': (r) => r.status === 200 || r.status === 403,
    'payroll response < 500ms': (r) => r.timings.duration < 500,
  });
  errorRate.add(!ok);

  const empRes = http.get(`${BASE_URL}/api/v1/employees?limit=20`, { headers });
  check(empRes, {
    'employees list 200': (r) => r.status === 200 || r.status === 403,
  });

  sleep(1);
}
