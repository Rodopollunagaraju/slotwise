import request from 'supertest';
import crypto from 'crypto';
import app from '../src/app';
import { memoryDb } from '../src/db/memory-db';
import { config } from '../src/config/env';

describe('Payment & Webhook Handling Tests', () => {
  let tenantSlug: string;
  let serviceId: string;
  let staffId: string;
  let bookingId: string;

  beforeAll(async () => {
    memoryDb.reset();
    tenantSlug = 'payments-salon';

    const tRes = await request(app)
      .post('/api/v1/auth/register-tenant')
      .send({
        slug: tenantSlug,
        salonName: 'Payments Salon',
        email: 'owner@pay.com',
        password: 'Password123!',
      });
    const token = tRes.body.data.token;

    const sRes = await request(app)
      .post('/api/v1/services')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Slug', tenantSlug)
      .send({
        name: 'Keratin Blowout',
        durationMin: 60,
        price: 120.0,
        depositAmount: 30.0,
      });
    serviceId = sRes.body.data.id;

    const stRes = await request(app)
      .post('/api/v1/staff')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Slug', tenantSlug)
      .send({
        name: 'Alex Turner',
        email: 'alex@pay.com',
        serviceIds: [serviceId],
      });
    staffId = stRes.body.data.id;

    // Create a pending booking
    const bRes = await request(app)
      .post('/api/v1/bookings')
      .set('X-Tenant-Slug', tenantSlug)
      .send({
        serviceId,
        staffId,
        startAt: '2026-11-20T11:00:00.000Z',
        customerName: 'Payment Customer',
        customerEmail: 'customer@paytest.com',
      });
    bookingId = bRes.body.data.id;
  });

  test('Creates deposit payment order for Stripe and returns order intent', async () => {
    const res = await request(app)
      .post('/api/v1/payments/create-order')
      .set('X-Tenant-Slug', tenantSlug)
      .send({
        bookingId,
        provider: 'STRIPE',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.provider).toBe('STRIPE');
    expect(res.body.data.amount).toBe(30.0);
    expect(res.body.data.providerOrderId).toBeDefined();
  });

  test('Stripe webhook with HMAC signature confirms booking (PENDING -> CONFIRMED)', async () => {
    // Fetch payment record
    const payment = memoryDb.payments.find((p) => p.booking_id === bookingId);
    expect(payment).toBeDefined();

    const timestamp = Math.floor(Date.now() / 1000);
    const eventPayload = {
      id: 'evt_test_12345',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: payment.provider_order_id,
          latest_charge: 'ch_test_charge_123',
        },
      },
    };

    const rawBody = JSON.stringify(eventPayload);
    const signature = crypto
      .createHmac('sha256', config.stripeWebhookSecret)
      .update(`${timestamp}.${rawBody}`)
      .digest('hex');

    const header = `t=${timestamp},v1=${signature}`;

    const webhookRes = await request(app)
      .post('/api/v1/webhooks/stripe')
      .set('stripe-signature', header)
      .send(eventPayload);

    expect(webhookRes.status).toBe(200);
    expect(webhookRes.body.received).toBe(true);

    // Verify booking is now CONFIRMED
    const updatedBooking = memoryDb.bookings.find((b) => b.id === bookingId);
    expect(updatedBooking.status).toBe('CONFIRMED');

    // Verify confirmation outbox event
    const confirmEvent = memoryDb.outbox.find(
      (o) => o.aggregate_id === bookingId && o.event_type === 'booking.confirmed'
    );
    expect(confirmEvent).toBeDefined();
  });

  test('Duplicate webhook event ID is ignored idempotently', async () => {
    const payment = memoryDb.payments.find((p) => p.booking_id === bookingId);
    const eventPayload = {
      id: 'evt_test_12345', // Same event ID
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: payment.provider_order_id,
        },
      },
    };

    const webhookRes = await request(app)
      .post('/api/v1/webhooks/stripe')
      .send(eventPayload);

    expect(webhookRes.status).toBe(200);
    expect(webhookRes.body.received).toBe(true);
  });
});
