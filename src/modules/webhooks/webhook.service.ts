/**
 * ============================================================================
 * SlotWise — Payment Webhook Processing & Idempotent Confirmation
 * ============================================================================
 * 
 * ARCHITECTURAL INVARIANTS:
 * 
 * 1. HMAC-SHA256 SIGNATURE VALIDATION:
 *    Guarantees the webhook payload originated genuinely from Stripe or Razorpay
 *    and was not tampered with in transit. Uses constant-time buffer comparison
 *    (`crypto.timingSafeEqual`) to prevent timing side-channel attacks.
 * 
 * 2. WEBHOOK IDEMPOTENCY:
 *    Payment providers guarantee *at-least-once* delivery, which means network
 *    timeouts or retries can deliver the exact same event 2 or 3 times.
 *    SlotWise checks `idempotency_keys` table for `webhook:{provider}:{eventId}`.
 *    If already processed, returns immediately with `{ duplicate: true }`.
 * 
 * 3. TRANSACTIONAL OUTBOX PUBLISHING:
 *    When deposit payment succeeds, we update payment to 'SUCCEEDED', booking
 *    to 'CONFIRMED', and insert a `booking.confirmed` event into the `outbox`
 *    table in the SAME database transaction.
 */

import crypto from 'crypto';
import { db } from '../../config/database';
import { config } from '../../config/env';

export class WebhookService {
  verifyStripeSignature(rawBody: string, signatureHeader?: string): boolean {
    if (!signatureHeader) return false;

    // Header format: t=1492774577,v1=5257a869e7ecebeda32affa62cd...
    const parts = signatureHeader.split(',').reduce((acc: any, part) => {
      const [key, val] = part.split('=');
      acc[key.trim()] = val?.trim();
      return acc;
    }, {});

    if (!parts.t || !parts.v1) return false;

    const signedPayload = `${parts.t}.${rawBody}`;
    const expectedSignature = crypto
      .createHmac('sha256', config.stripeWebhookSecret)
      .update(signedPayload)
      .digest('hex');

    return crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(parts.v1));
  }

  verifyRazorpaySignature(rawBody: string, signatureHeader?: string): boolean {
    if (!signatureHeader) return false;

    const expectedSignature = crypto
      .createHmac('sha256', config.razorpayWebhookSecret)
      .update(rawBody)
      .digest('hex');

    return crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(signatureHeader));
  }

  async handlePaymentSuccess(provider: 'STRIPE' | 'RAZORPAY', eventId: string, orderId: string, paymentId: string) {
    // 1. Webhook Idempotency Check
    const existingKey = await db.query(
      'SELECT * FROM idempotency_keys WHERE key = $1',
      [`webhook:${provider}:${eventId}`]
    );
    if (existingKey.rows.length > 0) {
      console.log(`[Webhook] Duplicate webhook event ${eventId} ignored.`);
      return { duplicate: true };
    }

    // 2. Fetch payment record
    const paymentRes = await db.query(
      'SELECT * FROM payments WHERE provider_order_id = $1',
      [orderId]
    );

    if (paymentRes.rows.length === 0) {
      console.warn(`[Webhook] No payment found for provider order ID ${orderId}`);
      return { notFound: true };
    }

    const payment = paymentRes.rows[0];

    // Fetch booking details for the confirmation email
    const bookingRes = await db.query(
      `SELECT b.*, s.name as service_name, st.display_name as staff_name
       FROM bookings b
       JOIN services s ON b.service_id = s.id
       JOIN staff st ON b.staff_id = st.id
       WHERE b.id = $1`,
      [payment.booking_id]
    );
    const booking = bookingRes.rows[0] || {};

    // 3. Atomically update payment to SUCCEEDED and booking to CONFIRMED
    return db.transaction(async (client) => {
      // Mark idempotency key to prevent duplicate processing
      await client.query(
        `INSERT INTO idempotency_keys (key, tenant_id, request_hash, status, expires_at)
         VALUES ($1, $2, $3, 'COMPLETED', NOW() + INTERVAL '7 days')
         ON CONFLICT (key) DO NOTHING`,
        [`webhook:${provider}:${eventId}`, payment.tenant_id, eventId]
      );

      // Update payment
      await client.query(
        `UPDATE payments
         SET status = 'SUCCEEDED', provider_payment_id = $1, updated_at = NOW()
         WHERE id = $2`,
        [paymentId, payment.id]
      );

      // Update booking
      await client.query(
        `UPDATE bookings
         SET status = 'CONFIRMED', updated_at = NOW()
         WHERE id = $1`,
        [payment.booking_id]
      );

      // Write enriched confirmation outbox event for queue worker
      await client.query(
        `INSERT INTO outbox (tenant_id, aggregate_type, aggregate_id, event_type, payload)
         VALUES ($1, 'BOOKING', $2, 'booking.confirmed', $3)`,
        [
          payment.tenant_id,
          payment.booking_id,
          JSON.stringify({
            bookingId: payment.booking_id,
            paymentId,
            provider,
            amount: payment.amount,
            customerName: booking.customer_name,
            customerEmail: booking.customer_email,
            serviceName: booking.service_name,
            staffName: booking.staff_name,
            startAt: booking.start_at,
            depositAmount: payment.amount,
          }),
        ]
      );

      return { success: true, bookingId: payment.booking_id };
    });
  }
}

export const webhookService = new WebhookService();
