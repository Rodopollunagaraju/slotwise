import request from 'supertest';
import app from '../src/app';
import { memoryDb } from '../src/db/memory-db';

describe('Tenant Isolation Tests (Multi-Tenancy Guardrails)', () => {
  let tenantAToken: string;
  let tenantASlug: string;
  let tenantAServiceId: string;

  let tenantBToken: string;
  let tenantBSlug: string;

  beforeAll(async () => {
    memoryDb.reset();

    // 1. Register Tenant A (Glamsalon)
    tenantASlug = 'salon-alpha';
    const resA = await request(app)
      .post('/api/v1/auth/register-tenant')
      .send({
        slug: tenantASlug,
        salonName: 'Salon Alpha',
        email: 'owner@alpha.com',
        password: 'Password123!',
      });
    tenantAToken = resA.body.data.token;

    // Create a service under Tenant A
    const serviceRes = await request(app)
      .post('/api/v1/services')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .set('X-Tenant-Slug', tenantASlug)
      .send({
        name: 'Alpha Signature Cut',
        durationMin: 45,
        price: 50.0,
      });
    tenantAServiceId = serviceRes.body.data.id;

    // 2. Register Tenant B (Barber Beta)
    tenantBSlug = 'barber-beta';
    const resB = await request(app)
      .post('/api/v1/auth/register-tenant')
      .send({
        slug: tenantBSlug,
        salonName: 'Barber Beta',
        email: 'owner@beta.com',
        password: 'Password123!',
      });
    tenantBToken = resB.body.data.token;
  });

  test("Tenant B cannot see Tenant A's services in their service catalog", async () => {
    const res = await request(app)
      .get('/api/v1/services')
      .set('X-Tenant-Slug', tenantBSlug);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(0);
  });

  test("Tenant B cannot fetch Tenant A's service by ID", async () => {
    const res = await request(app)
      .get(`/api/v1/services/${tenantAServiceId}`)
      .set('X-Tenant-Slug', tenantBSlug);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('SERVICE_NOT_FOUND');
  });

  test("Cross-Tenant Auth Token rejection: Token issued for Tenant A cannot access Tenant B workspace", async () => {
    const res = await request(app)
      .post('/api/v1/services')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .set('X-Tenant-Slug', tenantBSlug)
      .send({
        name: 'Hacked Service',
        durationMin: 30,
        price: 99.0,
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('CROSS_TENANT_ACCESS_DENIED');
  });
});
