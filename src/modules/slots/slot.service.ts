import { db } from '../../config/database';

export interface AvailableSlot {
  staffId: string;
  staffName: string;
  serviceId: string;
  serviceName: string;
  startAt: string;
  endAt: string;
  durationMin: number;
  price: number;
}

export class SlotService {
  async getAvailableSlots(tenantId: string, params: {
    serviceId: string;
    date: string; // YYYY-MM-DD
    staffId?: string;
    slotIntervalMin?: number;
  }): Promise<AvailableSlot[]> {
    const { serviceId, date, staffId, slotIntervalMin = 30 } = params;

    // 1. Fetch service
    const serviceRes = await db.query(
      'SELECT * FROM services WHERE tenant_id = $1 AND id = $2 AND is_active = TRUE',
      [tenantId, serviceId]
    );
    if (serviceRes.rows.length === 0) {
      const err: any = new Error('Service not found or inactive');
      err.statusCode = 404;
      err.name = 'SERVICE_NOT_FOUND';
      throw err;
    }
    const service = serviceRes.rows[0];

    // 2. Identify eligible staff
    let staffQuery = `
      SELECT s.id, s.display_name, ss.custom_duration_min, ss.custom_price
      FROM staff s
      JOIN staff_services ss ON s.id = ss.staff_id
      WHERE s.tenant_id = $1 AND ss.service_id = $2 AND s.is_active = TRUE
    `;
    const queryParams: any[] = [tenantId, serviceId];

    if (staffId) {
      staffQuery += ' AND s.id = $3';
      queryParams.push(staffId);
    }

    const staffRes = await db.query(staffQuery, queryParams);
    const eligibleStaff = staffRes.rows;

    if (eligibleStaff.length === 0) {
      return [];
    }

    // Determine target day of week (0 = Sunday, 1 = Monday, ...)
    // Parse target date
    const [year, month, day] = date.split('-').map(Number);
    const targetDate = new Date(Date.UTC(year, month - 1, day));
    const dayOfWeek = targetDate.getUTCDay();

    const availableSlots: AvailableSlot[] = [];

    // 3. For each staff member, check schedule, time off, and bookings
    for (const member of eligibleStaff) {
      // Check time off
      const timeOffRes = await db.query(
        `SELECT * FROM time_off
         WHERE staff_id = $1 AND $2::date BETWEEN start_date AND end_date`,
        [member.id, date]
      );
      if (timeOffRes.rows.length > 0) {
        // Staff member is on vacation/leave today
        continue;
      }

      // Check working hours
      const availabilityRes = await db.query(
        `SELECT * FROM availability
         WHERE staff_id = $1 AND day_of_week = $2 AND is_active = TRUE`,
        [member.id, dayOfWeek]
      );
      if (availabilityRes.rows.length === 0) {
        // Staff member does not work on this day
        continue;
      }

      // Fetch existing bookings for this staff on this date
      const startOfDay = new Date(Date.UTC(year, month - 1, day, 0, 0, 0)).toISOString();
      const endOfDay = new Date(Date.UTC(year, month - 1, day, 23, 59, 59)).toISOString();

      const existingBookingsRes = await db.query(
        `SELECT id, start_at, end_at, status
         FROM bookings
         WHERE staff_id = $1
           AND status IN ('PENDING', 'CONFIRMED')
           AND start_at < $3 AND end_at > $2`,
        [member.id, startOfDay, endOfDay]
      );
      const existingBookings = existingBookingsRes.rows;

      const duration = member.custom_duration_min || service.duration_min;
      const buffer = service.buffer_after_min || 0;
      const price = member.custom_price || service.price;

      // Iterate through availability windows
      for (const window of availabilityRes.rows) {
        const [startH, startM] = window.start_time.split(':').map(Number);
        const [endH, endM] = window.end_time.split(':').map(Number);

        const windowStart = new Date(Date.UTC(year, month - 1, day, startH, startM, 0));
        const windowEnd = new Date(Date.UTC(year, month - 1, day, endH, endM, 0));

        let currentSlotStart = new Date(windowStart.getTime());

        while (true) {
          const currentSlotEnd = new Date(currentSlotStart.getTime() + duration * 60 * 1000);
          const currentSlotWithBuffer = new Date(currentSlotStart.getTime() + (duration + buffer) * 60 * 1000);

          // Check if slot exceeds working hours window
          if (currentSlotEnd.getTime() > windowEnd.getTime()) {
            break;
          }

          // Check collision with existing active bookings
          const hasConflict = existingBookings.some((b) => {
            const bStart = new Date(b.start_at).getTime();
            const bEnd = new Date(b.end_at).getTime();
            const sStart = currentSlotStart.getTime();
            const sEnd = currentSlotWithBuffer.getTime();

            // Overlap check
            return sStart < bEnd && sEnd > bStart;
          });

          if (!hasConflict) {
            availableSlots.push({
              staffId: member.id,
              staffName: member.display_name,
              serviceId: service.id,
              serviceName: service.name,
              startAt: currentSlotStart.toISOString(),
              endAt: currentSlotEnd.toISOString(),
              durationMin: duration,
              price: Number(price),
            });
          }

          // Advance to next slot interval
          currentSlotStart = new Date(currentSlotStart.getTime() + slotIntervalMin * 60 * 1000);
        }
      }
    }

    // Sort available slots chronologically
    availableSlots.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
    return availableSlots;
  }
}

export const slotService = new SlotService();
