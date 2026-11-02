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

      // Write confirmation outbox event
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
          }),
        ]
      );

      return { success: true, bookingId: payment.booking_id };
    });
  }
}

export const webhookService = new WebhookService();
