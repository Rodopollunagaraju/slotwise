import request from 'supertest';
import app from '../src/app';
import { memoryDb } from '../src/db/memory-db';

describe('API Idempotency Key Tests', () => {
  let tenantSlug: string;
  let serviceId: string;
  let staffId: string;

  beforeAll(async () => {
    memoryDb.reset();
    tenantSlug = 'idem-salon';

    const tRes = await request(app)
      .post('/api/v1/auth/register-tenant')
      .send({
        slug: tenantSlug,
        salonName: 'Idem Salon',
        email: 'owner@idem.com',
        password: 'Password123!',
      });
    const token = tRes.body.data.token;

    const sRes = await request(app)
      .post('/api/v1/services')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Slug', tenantSlug)
      .send({
        name: 'Classic Trim',
        durationMin: 30,
        price: 35.0,
      });
    serviceId = sRes.body.data.id;

    const stRes = await request(app)
      .post('/api/v1/staff')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Slug', tenantSlug)
      .send({
        name: 'Sam Stylist',
        email: 'sam@idem.com',
        serviceIds: [serviceId],
      });
    staffId = stRes.body.data.id;
  });

  test('Submitting identical request with same Idempotency-Key returns cached response without creating duplicate bookings', async () => {
    const idempotencyKey = 'idem-test-key-999';
    const payload = {
      serviceId,
      staffId,
      startAt: '2026-11-25T15:00:00.000Z',
      customerName: 'Idem Customer',
      customerEmail: 'idem@test.com',
    };

    // First request
    const firstRes = await request(app)
      .post('/api/v1/bookings')
      .set('X-Tenant-Slug', tenantSlug)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload);

    expect(firstRes.status).toBe(201);
    const createdBookingId = firstRes.body.data.id;

    // Second request with same idempotency key
    const secondRes = await request(app)
      .post('/api/v1/bookings')
      .set('X-Tenant-Slug', tenantSlug)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload);

    expect(secondRes.status).toBe(201);
    expect(secondRes.headers['x-cache-lookup']).toBe('HIT');
    expect(secondRes.body.data.id).toBe(createdBookingId);

    // Verify only 1 booking was created in the database
    const matchingBookings = memoryDb.bookings.filter((b) => b.customer_email === 'idem@test.com');
    expect(matchingBookings.length).toBe(1);
  });
});
