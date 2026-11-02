import request from 'supertest';
import app from '../src/app';
import { memoryDb } from '../src/db/memory-db';

describe('Booking Lifecycle & State Machine Tests', () => {
  let tenantSlug: string;
  let serviceId: string;
  let staffId: string;

  beforeAll(async () => {
    memoryDb.reset();
    tenantSlug = 'lifecycle-salon';

    const tenantRes = await request(app)
      .post('/api/v1/auth/register-tenant')
      .send({
        slug: tenantSlug,
        salonName: 'Lifecycle Salon',
        email: 'owner@lifecycle.com',
        password: 'Password123!',
      });
    const token = tenantRes.body.data.token;

    const sRes = await request(app)
      .post('/api/v1/services')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Slug', tenantSlug)
      .send({
        name: 'Hair Spa',
        durationMin: 60,
        price: 80.0,
        depositAmount: 25.0,
      });
    serviceId = sRes.body.data.id;

    const stRes = await request(app)
      .post('/api/v1/staff')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Slug', tenantSlug)
      .send({
        name: 'Rachel Green',
        email: 'rachel@lifecycle.com',
        serviceIds: [serviceId],
      });
    staffId = stRes.body.data.id;
  });

  test('New booking enters PENDING status and records an event in Outbox', async () => {
    const slot = '2026-11-15T14:00:00.000Z';
    const res = await request(app)
      .post('/api/v1/bookings')
      .set('X-Tenant-Slug', tenantSlug)
      .send({
        serviceId,
        staffId,
        startAt: slot,
        customerName: 'Monica Geller',
        customerEmail: 'monica@example.com',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('PENDING');
    expect(res.body.data.deposit_amount).toBe(25.0);

    // Verify outbox entry
    const outboxEvents = memoryDb.outbox.filter(
      (o) => o.aggregate_id === res.body.data.id && o.event_type === 'booking.created.pending'
    );
    expect(outboxEvents.length).toBe(1);
  });

  test('Cancellation releases the slot and handles cancellation window rule', async () => {
    // Appointment far in the future (> 24 hours)
    const futureSlot = '2026-12-01T10:00:00.000Z';
    const createRes = await request(app)
      .post('/api/v1/bookings')
      .set('X-Tenant-Slug', tenantSlug)
      .send({
        serviceId,
        staffId,
        startAt: futureSlot,
        customerName: 'Phoebe Buffay',
        customerEmail: 'phoebe@example.com',
      });

    const bookingId = createRes.body.data.id;

    // Cancel booking
    const cancelRes = await request(app)
      .post(`/api/v1/bookings/${bookingId}/cancel`)
      .set('X-Tenant-Slug', tenantSlug)
      .send({ reason: 'Schedule conflict' });

    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.data.booking.status).toBe('CANCELLED');
    expect(cancelRes.body.data.isEligibleForRefund).toBe(true);

    // Verify slot is now released: another customer can book the exact same slot!
    const rebookRes = await request(app)
      .post('/api/v1/bookings')
      .set('X-Tenant-Slug', tenantSlug)
      .send({
        serviceId,
        staffId,
        startAt: futureSlot,
        customerName: 'Chandler Bing',
        customerEmail: 'chandler@example.com',
      });

    expect(rebookRes.status).toBe(201);
    expect(rebookRes.body.data.status).toBe('PENDING');
  });
});
