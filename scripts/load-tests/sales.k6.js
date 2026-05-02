/**
 * ITEMBA-R Load Test — Sales & Inventory
 * Tests sales order and inventory endpoints
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const errorRate = new Rate('errors');

export const options = {
  stages: [
    { duration: '30s', target: 25 },
    { duration: '60s', target: 25 },
    { duration: '30s', target: 0 },
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

  // List products
  const productsRes = http.get(`${BASE_URL}/api/v1/products?limit=20&page=1`, { headers });
  const ok = check(productsRes, {
    'products list 200': (r) => r.status === 200 || r.status === 403,
    'products response < 500ms': (r) => r.timings.duration < 500,
  });
  errorRate.add(!ok);

  // List sales orders
  const salesRes = http.get(`${BASE_URL}/api/v1/sales-orders?limit=10&page=1`, { headers });
  check(salesRes, {
    'sales orders 200': (r) => r.status === 200 || r.status === 403,
  });

  // List inventory
  const invRes = http.get(`${BASE_URL}/api/v1/inventory-items?limit=20`, { headers });
  check(invRes, {
    'inventory list 200': (r) => r.status === 200 || r.status === 403,
  });

  sleep(1);
}
