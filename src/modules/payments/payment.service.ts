import crypto from 'crypto';
import { db } from '../../config/database';
import { config } from '../../config/env';

export class PaymentService {
  async createPaymentOrder(tenantId: string, bookingId: string, provider: 'STRIPE' | 'RAZORPAY') {
    // 1. Fetch booking
    const bookingRes = await db.query(
      'SELECT * FROM bookings WHERE id = $1 AND tenant_id = $2',
      [bookingId, tenantId]
    );

    if (bookingRes.rows.length === 0) {
      const err: any = new Error('Booking not found');
      err.statusCode = 404;
      err.name = 'BOOKING_NOT_FOUND';
      throw err;
    }

    const booking = bookingRes.rows[0];

    if (booking.status !== 'PENDING') {
      const err: any = new Error(`Cannot initiate payment for a booking with status '${booking.status}'.`);
      err.statusCode = 400;
      err.name = 'INVALID_BOOKING_STATUS';
      throw err;
    }

    const depositAmount = Number(booking.deposit_amount);
    if (depositAmount <= 0) {
      // If no deposit required, auto-confirm
      await db.query("UPDATE bookings SET status = 'CONFIRMED' WHERE id = $1", [bookingId]);
      return {
        bookingId,
        depositRequired: false,
        status: 'CONFIRMED',
      };
    }

    // 2. Generate provider-specific test mode order / intent ID
    const providerOrderId = provider === 'STRIPE'
      ? `pi_test_${crypto.randomBytes(12).toString('hex')}`
      : `order_${crypto.randomBytes(12).toString('hex')}`;

    const clientSecret = provider === 'STRIPE'
      ? `${providerOrderId}_secret_${crypto.randomBytes(10).toString('hex')}`
      : undefined;

    // 3. Insert or retrieve existing pending payment
    const paymentRes = await db.query(
      `INSERT INTO payments (tenant_id, booking_id, provider, provider_order_id, amount, currency, status, metadata)
       VALUES ($1, $2, $3, $4, $5, 'USD', 'CREATED', $6)
       RETURNING *`,
      [
        tenantId,
        bookingId,
        provider,
        providerOrderId,
        depositAmount,
        JSON.stringify({ clientSecret }),
      ]
    );

    const payment = paymentRes.rows[0];

    return {
      paymentId: payment.id,
      provider,
      providerOrderId,
      clientSecret,
      amount: depositAmount,
      currency: 'USD',
      bookingId,
    };
  }
}

export const paymentService = new PaymentService();
