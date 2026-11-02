import { db } from '../config/database';
import { config } from '../config/env';

export class BookingExpiryWorker {
  private timer: NodeJS.Timeout | null = null;

  async expireStaleBookings(): Promise<number> {
    const minutes = config.pendingBookingExpiryMinutes;

    // Fetch pending bookings that exceeded timeout
    const query = `
      SELECT id, tenant_id, customer_email, start_at
      FROM bookings
      WHERE status = 'PENDING'
        AND created_at < NOW() - INTERVAL '${minutes} minutes'
    `;

    const res = await db.query(query);
    const staleBookings = res.rows;

    if (staleBookings.length === 0) {
      return 0;
    }

    console.log(`[ExpiryWorker] Found ${staleBookings.length} stale pending booking(s) to expire.`);

    for (const booking of staleBookings) {
      await db.transaction(async (client) => {
        // Update booking status to EXPIRED -> releasing exclusion constraint!
        await client.query(
          `UPDATE bookings
           SET status = 'EXPIRED', updated_at = NOW()
           WHERE id = $1`,
          [booking.id]
        );

        // Record outbox event
        await client.query(
          `INSERT INTO outbox (tenant_id, aggregate_type, aggregate_id, event_type, payload)
           VALUES ($1, 'BOOKING', $2, 'booking.expired', $3)`,
          [
            booking.tenant_id,
            booking.id,
            JSON.stringify({
              bookingId: booking.id,
              tenantId: booking.tenant_id,
              reason: `Deposit payment not completed within ${minutes} minutes.`,
            }),
          ]
        );
      });
    }

    return staleBookings.length;
  }

  start(intervalMs = 60000) {
    if (this.timer) return;
    console.log(`[ExpiryWorker] Started booking expiry scheduler (running every ${intervalMs / 1000}s)...`);
    this.timer = setInterval(() => {
      this.expireStaleBookings().catch((err) => {
        console.error('[ExpiryWorker] Error running expiry job:', err);
      });
    }, intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

export const bookingExpiryWorker = new BookingExpiryWorker();
