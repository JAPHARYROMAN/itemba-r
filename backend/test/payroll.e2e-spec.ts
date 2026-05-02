import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createE2eApp } from './e2e-app';

jest.setTimeout(30000);

describe('Payroll Module (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createE2eApp();
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  describe('Payroll Runs (unauthenticated)', () => {
    it('should deny GET /api/v1/hr/payroll-runs without token', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/hr/payroll-runs')
        .expect(401);
    });

    it('should deny POST /api/v1/hr/payroll-runs without token', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/hr/payroll-runs')
        .send({})
        .expect(401);
    });
  });

  describe('Employees (unauthenticated)', () => {
    it('should deny GET /api/v1/hr/employees without token', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/hr/employees')
        .expect(401);
    });
  });

  describe('Payroll Entries (unauthenticated)', () => {
    it('should deny GET /api/v1/hr/payroll-entries without token', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/hr/payroll-entries')
        .expect(401);
    });
  });
});

