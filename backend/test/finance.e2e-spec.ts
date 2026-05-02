import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createE2eApp } from './e2e-app';

jest.setTimeout(30000);

describe('Finance Module (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createE2eApp();
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  describe('Accounts (unauthenticated)', () => {
    it('should deny GET /api/v1/chart-of-accounts without token', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/chart-of-accounts')
        .expect(401);
    });

    it('should deny POST /api/v1/chart-of-accounts without token', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/chart-of-accounts')
        .send({ name: 'Test', code: '1000', type: 'ASSET', companyId: 'test' })
        .expect(401);
    });
  });

  describe('Journal Entries (unauthenticated)', () => {
    it('should deny GET /api/v1/journal-entries without token', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/journal-entries')
        .expect(401);
    });
  });

  describe('Financial Reports (unauthenticated)', () => {
    it('should deny accounting-engine summary without token', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/accounting-engine/summary')
        .expect(401);
    });
  });
});

