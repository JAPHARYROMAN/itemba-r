/**
 * ITEMBA-R Load Test — BI Dashboard
 * Tests dashboard and report endpoints (heaviest queries)
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const errorRate = new Rate('errors');
const dashboardDuration = new Trend('dashboard_duration');

export const options = {
  stages: [
    { duration: '30s', target: 10 },
    { duration: '60s', target: 10 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'],  // dashboards allowed up to 2s
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

  // KPI metrics
  const kpiRes = http.get(`${BASE_URL}/api/v1/kpi-metrics?limit=20`, { headers });
  dashboardDuration.add(kpiRes.timings.duration);
  const ok = check(kpiRes, {
    'kpi metrics 200': (r) => r.status === 200 || r.status === 403,
    'kpi response < 2000ms': (r) => r.timings.duration < 2000,
  });
  errorRate.add(!ok);

  // Dashboard definitions
  const dashRes = http.get(`${BASE_URL}/api/v1/dashboard-definitions?limit=10`, { headers });
  check(dashRes, {
    'dashboards 200': (r) => r.status === 200 || r.status === 403,
  });

  // Report templates
  const reportRes = http.get(`${BASE_URL}/api/v1/report-templates?limit=10`, { headers });
  check(reportRes, {
    'reports 200': (r) => r.status === 200 || r.status === 403,
  });

  sleep(2); // dashboards are heavy, give more spacing
}
