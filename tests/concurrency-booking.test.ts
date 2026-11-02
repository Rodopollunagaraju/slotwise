import request from 'supertest';
import app from '../src/app';
import { memoryDb } from '../src/db/memory-db';

describe('Concurrency & Double-Booking Prevention (Exclusion Constraint Proof)', () => {
  let tenantSlug: string;
  let serviceId: string;
  let staffId: string;
  const targetSlot = '2026-11-10T10:00:00.000Z';

  beforeAll(async () => {
    memoryDb.reset();

    tenantSlug = 'rush-salon';
    const tenantRes = await request(app)
      .post('/api/v1/auth/register-tenant')
      .send({
        slug: tenantSlug,
        salonName: 'Rush Salon',
        email: 'rush@salon.com',
        password: 'Password123!',
      });
    const token = tenantRes.body.data.token;

    // Create Service
    const serviceRes = await request(app)
      .post('/api/v1/services')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Slug', tenantSlug)
      .send({
        name: 'Express Blowout',
        durationMin: 30,
        price: 40.0,
        depositAmount: 10.0,
      });
    serviceId = serviceRes.body.data.id;

    // Create Staff
    const staffRes = await request(app)
      .post('/api/v1/staff')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Slug', tenantSlug)
      .send({
        name: 'Jessica Star',
        email: 'jessica@salon.com',
        serviceIds: [serviceId],
      });
    staffId = staffRes.body.data.id;
  });

  test('High concurrency barrage (50 concurrent requests for the exact same staff and slot): Exactly 1 succeeds, 49 rejected with 409 Conflict', async () => {
    const CONCURRENT_REQUESTS = 50;

    // Dispatch all requests concurrently via Promise.all
    const promises = Array.from({ length: CONCURRENT_REQUESTS }).map((_, index) =>
      request(app)
        .post('/api/v1/bookings')
        .set('X-Tenant-Slug', tenantSlug)
        .send({
          serviceId,
          staffId,
          startAt: targetSlot,
          customerName: `Customer #${index + 1}`,
          customerEmail: `customer${index + 1}@example.com`,
          notes: `Concurrency attempt ${index + 1}`,
        })
    );

    const responses = await Promise.all(promises);

    const successes = responses.filter((r) => r.status === 201);
    const conflicts = responses.filter((r) => r.status === 409);

    console.log(`[Concurrency Proof] Results: ${successes.length} Created (201), ${conflicts.length} Conflicts (409)`);

    // EXACTLY 1 booking succeeded
    expect(successes.length).toBe(1);

    // All remaining requests were cleanly rejected with 409 Conflict
    expect(conflicts.length).toBe(CONCURRENT_REQUESTS - 1);

    // Conflict responses include the standard error code
    conflicts.forEach((res) => {
      expect(res.body.error).toBe('SLOT_ALREADY_BOOKED');
    });

    // Database verification: strictly 1 booking saved
    const activeBookings = memoryDb.bookings.filter(
      (b) => b.staff_id === staffId && b.start_at === targetSlot
    );
    expect(activeBookings.length).toBe(1);
  });
});
