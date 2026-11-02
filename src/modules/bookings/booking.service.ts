import { db } from '../../config/database';

export interface CreateBookingInput {
  serviceId: string;
  staffId: string;
  startAt: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  notes?: string;
  customerId?: string;
}

export class BookingService {
  async createBooking(tenantId: string, input: CreateBookingInput) {
    const { serviceId, staffId, startAt, customerName, customerEmail, customerPhone, notes, customerId } = input;

    // 1. Fetch service to calculate endAt, price, deposit
    const serviceRes = await db.query(
      'SELECT * FROM services WHERE tenant_id = $1 AND id = $2 AND is_active = TRUE',
      [tenantId, serviceId]
    );
    if (serviceRes.rows.length === 0) {
      const err: any = new Error('Service not found');
      err.statusCode = 404;
      err.name = 'SERVICE_NOT_FOUND';
      throw err;
    }
    const service = serviceRes.rows[0];

    // Check custom staff duration/price if assigned
    const staffServiceRes = await db.query(
      'SELECT custom_duration_min, custom_price FROM staff_services WHERE staff_id = $1 AND service_id = $2',
      [staffId, serviceId]
    );
    const custom = staffServiceRes.rows[0] || {};
    const duration = custom.custom_duration_min || service.duration_min;
    const totalPrice = custom.custom_price || service.price;
    const depositAmount = service.deposit_amount || 0;

    const startDate = new Date(startAt);
    const endDate = new Date(startDate.getTime() + duration * 60 * 1000);

    // 2. Perform transactional insertion with PostgreSQL Exclusion Constraint & Outbox row
    return db.transaction(async (client) => {
      // Insertion into bookings table:
      // If another transaction inserted an overlapping time for this staff_id,
      // PostgreSQL throws 23P01 (exclusion_violation)
      const bookingRes = await client.query(
        `INSERT INTO bookings (
          tenant_id, customer_id, staff_id, service_id, start_at, end_at,
          status, total_amount, deposit_amount, customer_name, customer_email,
          customer_phone, notes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING *`,
        [
          tenantId,
          customerId || null,
          staffId,
          serviceId,
          startDate.toISOString(),
          endDate.toISOString(),
          'PENDING',
          totalPrice,
          depositAmount,
          customerName,
          customerEmail,
          customerPhone || null,
          notes || null,
        ]
      );
      const booking = bookingRes.rows[0];

      // 3. Write event to Transactional Outbox
      await client.query(
        `INSERT INTO outbox (tenant_id, aggregate_type, aggregate_id, event_type, payload)
         VALUES ($1, 'BOOKING', $2, 'booking.created.pending', $3)`,
        [
          tenantId,
          booking.id,
          JSON.stringify({
            bookingId: booking.id,
            tenantId,
            staffId,
            serviceId,
            customerEmail,
            customerName,
            startAt: booking.start_at,
            depositAmount: booking.deposit_amount,
          }),
        ]
      );

      return booking;
    });
  }

  async getBookingById(tenantId: string, bookingId: string) {
    const res = await db.query(
      `SELECT b.*, s.name as service_name, st.display_name as staff_name
       FROM bookings b
       JOIN services s ON b.service_id = s.id
       JOIN staff st ON b.staff_id = st.id
       WHERE b.tenant_id = $1 AND b.id = $2`,
      [tenantId, bookingId]
    );
    if (res.rows.length === 0) {
      const err: any = new Error('Booking not found');
      err.statusCode = 404;
      err.name = 'BOOKING_NOT_FOUND';
      throw err;
    }
    return res.rows[0];
  }

  async listBookings(tenantId: string, filter?: { staffId?: string; status?: string; customerId?: string }) {
    let query = `
      SELECT b.*, s.name as service_name, st.display_name as staff_name
      FROM bookings b
      JOIN services s ON b.service_id = s.id
      JOIN staff st ON b.staff_id = st.id
      WHERE b.tenant_id = $1
    `;
    const params: any[] = [tenantId];

    if (filter?.staffId) {
      params.push(filter.staffId);
      query += ` AND b.staff_id = $${params.length}`;
    }
    if (filter?.status) {
      params.push(filter.status);
      query += ` AND b.status = $${params.length}`;
    }
    if (filter?.customerId) {
      params.push(filter.customerId);
      query += ` AND b.customer_id = $${params.length}`;
    }

    query += ' ORDER BY b.start_at DESC';
    const res = await db.query(query, params);
    return res.rows;
  }

  async cancelBooking(tenantId: string, bookingId: string, cancellationReason?: string) {
    const booking = await this.getBookingById(tenantId, bookingId);

    if (booking.status === 'CANCELLED' || booking.status === 'EXPIRED') {
      const err: any = new Error(`Cannot cancel a booking with status '${booking.status}'.`);
      err.statusCode = 400;
      err.name = 'INVALID_STATE_TRANSITION';
      throw err;
    }

    // Cancellation window rule
    const tenantRes = await db.query('SELECT cancellation_window_hours FROM tenants WHERE id = $1', [tenantId]);
    const windowHours = tenantRes.rows[0]?.cancellation_window_hours || 24;

    const bookingStartTime = new Date(booking.start_at).getTime();
    const now = Date.now();
    const hoursUntilBooking = (bookingStartTime - now) / (1000 * 60 * 60);

    const isEligibleForRefund = hoursUntilBooking >= windowHours;

    return db.transaction(async (client) => {
      const res = await client.query(
        `UPDATE bookings
         SET status = 'CANCELLED', cancellation_reason = $1, updated_at = NOW()
         WHERE id = $2 AND tenant_id = $3
         RETURNING *`,
        [cancellationReason || 'Customer requested cancellation', bookingId, tenantId]
      );

      // Write outbox event for cancellation & refund processing
      await client.query(
        `INSERT INTO outbox (tenant_id, aggregate_type, aggregate_id, event_type, payload)
         VALUES ($1, 'BOOKING', $2, 'booking.cancelled', $3)`,
        [
          tenantId,
          bookingId,
          JSON.stringify({
            bookingId,
            tenantId,
            isEligibleForRefund,
            hoursUntilBooking,
            cancellationReason,
          }),
        ]
      );

      return {
        booking: res.rows[0],
        isEligibleForRefund,
        refundNotice: isEligibleForRefund
          ? 'Cancelled outside the penalty window; deposit eligible for refund.'
          : `Cancelled within ${windowHours} hours of appointment; deposit forfeited as per salon policy.`,
      };
    });
  }

  async rescheduleBooking(tenantId: string, bookingId: string, newStartAt: string) {
    const booking = await this.getBookingById(tenantId, bookingId);

    if (booking.status !== 'PENDING' && booking.status !== 'CONFIRMED') {
      const err: any = new Error(`Cannot reschedule a booking with status '${booking.status}'.`);
      err.statusCode = 400;
      err.name = 'INVALID_STATE_TRANSITION';
      throw err;
    }

    const durationMs = new Date(booking.end_at).getTime() - new Date(booking.start_at).getTime();
    const newStart = new Date(newStartAt);
    const newEnd = new Date(newStart.getTime() + durationMs);

    return db.transaction(async (client) => {
      // PostgreSQL Exclusion Constraint will check the updated slot against active bookings!
      const res = await client.query(
        `UPDATE bookings
         SET start_at = $1, end_at = $2, updated_at = NOW()
         WHERE id = $3 AND tenant_id = $4
         RETURNING *`,
        [newStart.toISOString(), newEnd.toISOString(), bookingId, tenantId]
      );

      await client.query(
        `INSERT INTO outbox (tenant_id, aggregate_type, aggregate_id, event_type, payload)
         VALUES ($1, 'BOOKING', $2, 'booking.rescheduled', $3)`,
        [
          tenantId,
          bookingId,
          JSON.stringify({
            bookingId,
            tenantId,
            oldStartAt: booking.start_at,
            newStartAt: newStart.toISOString(),
          }),
        ]
      );

      return res.rows[0];
    });
  }
}

export const bookingService = new BookingService();
