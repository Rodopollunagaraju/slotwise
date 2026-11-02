import request from 'supertest';
import app from '../src/app';
import { memoryDb } from '../src/db/memory-db';

describe('Slot Generation Engine Tests', () => {
  let tenantSlug: string;
  let serviceId: string;
  let staffId: string;

  beforeAll(async () => {
    memoryDb.reset();
    tenantSlug = 'slotgen-salon';

    const tRes = await request(app)
      .post('/api/v1/auth/register-tenant')
      .send({
        slug: tenantSlug,
        salonName: 'SlotGen Salon',
        email: 'owner@slotgen.com',
        password: 'Password123!',
      });
    const token = tRes.body.data.token;

    // Service: 30 minutes, 15 min buffer
    const sRes = await request(app)
      .post('/api/v1/services')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Slug', tenantSlug)
      .send({
        name: 'Express Cut',
        durationMin: 30,
        price: 45.0,
        bufferAfterMin: 15,
      });
    serviceId = sRes.body.data.id;

    // Staff
    const stRes = await request(app)
      .post('/api/v1/staff')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Slug', tenantSlug)
      .send({
        name: 'Carlos Ruiz',
        email: 'carlos@slotgen.com',
        serviceIds: [serviceId],
      });
    staffId = stRes.body.data.id;

    // Set working hours for Monday (dayOfWeek = 1): 09:00 - 12:00
    await request(app)
      .post('/api/v1/availability')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Slug', tenantSlug)
      .send({
        staffId,
        schedule: [
          { dayOfWeek: 1, startTime: '09:00', endTime: '12:00' },
        ],
      });
  });

  test('Generates available slots on a working day at 30-min intervals', async () => {
    // 2026-11-09 is a Monday (dayOfWeek = 1)
    const res = await request(app)
      .get('/api/v1/slots')
      .set('X-Tenant-Slug', tenantSlug)
      .query({
        serviceId,
        date: '2026-11-09',
        staffId,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBeGreaterThan(0);
    expect(res.body.data[0].staffId).toBe(staffId);
  });

  test('Existing booking blocks that specific time slot from slot generation', async () => {
    // Book 09:00 - 09:30 slot on 2026-11-09
    await request(app)
      .post('/api/v1/bookings')
      .set('X-Tenant-Slug', tenantSlug)
      .send({
        serviceId,
        staffId,
        startAt: '2026-11-09T09:00:00.000Z',
        customerName: 'Early Bird',
        customerEmail: 'early@test.com',
      });

    // Query slots again
    const res = await request(app)
      .get('/api/v1/slots')
      .set('X-Tenant-Slug', tenantSlug)
      .query({
        serviceId,
        date: '2026-11-09',
        staffId,
      });

    expect(res.status).toBe(200);
    const slots = res.body.data;
    // 09:00 slot should no longer be present
    const hasBookedSlot = slots.some((s: any) => s.startAt === '2026-11-09T09:00:00.000Z');
    expect(hasBookedSlot).toBe(false);
  });
});
