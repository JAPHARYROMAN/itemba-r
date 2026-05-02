/**
 * ITEMBA-R Full Load Test Suite
 * Runs all major endpoint groups together
 */
import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate } from 'k6/metrics';

const errorRate = new Rate('errors');

export const options = {
  stages: [
    { duration: '1m', target: 20 },
    { duration: '2m', target: 20 },
    { duration: '1m', target: 50 },
    { duration: '2m', target: 50 },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000'],
    http_req_failed: ['rate<0.02'],
    errors: ['rate<0.02'],
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

  group('Auth', () => {
    const meRes = http.get(`${BASE_URL}/api/v1/auth/me`, { headers });
    errorRate.add(!check(meRes, { 'auth/me 200': (r) => r.status === 200 }));
  });

  group('Finance', () => {
    const accRes = http.get(`${BASE_URL}/api/v1/accounts?limit=10`, { headers });
    errorRate.add(!check(accRes, { 'accounts 200': (r) => r.status === 200 || r.status === 403 }));
  });

  group('HR', () => {
    const empRes = http.get(`${BASE_URL}/api/v1/employees?limit=10`, { headers });
    errorRate.add(!check(empRes, { 'employees 200': (r) => r.status === 200 || r.status === 403 }));
  });

  group('Inventory', () => {
    const prodRes = http.get(`${BASE_URL}/api/v1/products?limit=10`, { headers });
    errorRate.add(!check(prodRes, { 'products 200': (r) => r.status === 200 || r.status === 403 }));
  });

  group('Audit Logs', () => {
    const auditRes = http.get(`${BASE_URL}/api/v1/audit-logs?limit=10`, { headers });
    errorRate.add(!check(auditRes, { 'audit logs 200': (r) => r.status === 200 || r.status === 403 }));
  });

  sleep(1);
}
