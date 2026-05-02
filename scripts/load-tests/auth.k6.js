/**
 * ITEMBA-R Load Test — Authentication
 * Tests login endpoint performance under load
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const errorRate = new Rate('errors');
const loginDuration = new Trend('login_duration');

export const options = {
  stages: [
    { duration: '30s', target: 10 },   // ramp up to 10 users
    { duration: '60s', target: 10 },   // hold at 10 users
    { duration: '30s', target: 50 },   // ramp up to 50 users
    { duration: '60s', target: 50 },   // hold at 50 users
    { duration: '30s', target: 0 },    // ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    http_req_failed: ['rate<0.01'],
    errors: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';

export default function () {
  // Test 1: Login with valid credentials
  const loginRes = http.post(
    `${BASE_URL}/api/v1/auth/login`,
    JSON.stringify({
      email: 'admin@itemba-r.com',
      password: 'Admin@1618!',
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  loginDuration.add(loginRes.timings.duration);

  const loginOk = check(loginRes, {
    'login status 200': (r) => r.status === 200,
    'has accessToken': (r) => {
      try {
        return JSON.parse(r.body).accessToken !== undefined;
      } catch {
        return false;
      }
    },
    'response time < 500ms': (r) => r.timings.duration < 500,
  });

  errorRate.add(!loginOk);

  if (loginOk) {
    const token = JSON.parse(loginRes.body).accessToken;

    // Test 2: Access protected endpoint with token
    const profileRes = http.get(`${BASE_URL}/api/v1/auth/me`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    check(profileRes, {
      'profile status 200': (r) => r.status === 200,
      'profile response time < 200ms': (r) => r.timings.duration < 200,
    });
  }

  // Test 3: Login with invalid credentials (should be 401, not error)
  const badLoginRes = http.post(
    `${BASE_URL}/api/v1/auth/login`,
    JSON.stringify({ email: 'bad@example.com', password: 'badpassword' }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  check(badLoginRes, {
    'invalid login returns 401': (r) => r.status === 401,
  });

  sleep(1);
}
