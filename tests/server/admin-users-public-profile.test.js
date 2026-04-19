import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { resetTestDb } from '../_helpers/dbReset.js';
import { makeApp } from '../_helpers/makeApp.js';

let app;
let ownerToken;

describe('admin seller public profile management', () => {
  beforeAll(async () => {
    resetTestDb();
    app = await makeApp();

    const ownerLogin = await request(app)
      .post('/api/auth/login')
      .send({ username: 'owner', password: 'owner123' });

    ownerToken = ownerLogin.body.token;
  });

  it('creates and updates seller public name and phone through admin users API', async () => {
    const createRes = await request(app)
      .post('/api/admin/users')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        username: 'seller_public_profile',
        password: 'password123',
        role: 'seller',
        public_display_name: 'Анна Соколова',
        public_phone_e164: '+79995554433',
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body).toMatchObject({
      username: 'seller_public_profile',
      role: 'seller',
      public_display_name: 'Анна Соколова',
      public_phone_e164: '+79995554433',
      is_active: 1,
    });

    const updateRes = await request(app)
      .patch(`/api/admin/users/${createRes.body.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        public_display_name: 'Мария Петрова',
        public_phone_e164: '+79996667788',
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body).toMatchObject({
      id: createRes.body.id,
      username: 'seller_public_profile',
      role: 'seller',
      public_display_name: 'Мария Петрова',
      public_phone_e164: '+79996667788',
      is_active: 1,
    });

    const sellersRes = await request(app)
      .get('/api/admin/users?role=seller')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(sellersRes.status).toBe(200);
    expect(sellersRes.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: createRes.body.id,
          username: 'seller_public_profile',
          public_display_name: 'Мария Петрова',
          public_phone_e164: '+79996667788',
        }),
      ])
    );
  });
});
