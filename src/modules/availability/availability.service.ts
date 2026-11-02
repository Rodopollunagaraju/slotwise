import { db } from '../../config/database';

export class AvailabilityService {
  async setWorkingHours(tenantId: string, staffId: string, schedule: Array<{
    dayOfWeek: number;
    startTime: string;
    endTime: string;
  }>) {
    return db.transaction(async (client) => {
      // Clear existing availability for this staff
      await client.query('DELETE FROM availability WHERE staff_id = $1 AND tenant_id = $2', [staffId, tenantId]);

      const inserted = [];
      for (const slot of schedule) {
        const res = await client.query(
          `INSERT INTO availability (tenant_id, staff_id, day_of_week, start_time, end_time)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [tenantId, staffId, slot.dayOfWeek, slot.startTime, slot.endTime]
        );
        inserted.push(res.rows[0]);
      }
      return inserted;
    });
  }

  async getStaffSchedule(tenantId: string, staffId: string) {
    const res = await db.query(
      'SELECT * FROM availability WHERE tenant_id = $1 AND staff_id = $2 ORDER BY day_of_week, start_time',
      [tenantId, staffId]
    );
    return res.rows;
  }

  async addTimeOff(tenantId: string, staffId: string, startDate: string, endDate: string, reason?: string) {
    const res = await db.query(
      `INSERT INTO time_off (tenant_id, staff_id, start_date, end_date, reason)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [tenantId, staffId, startDate, endDate, reason || null]
    );
    return res.rows[0];
  }

  async getStaffTimeOff(tenantId: string, staffId: string) {
    const res = await db.query(
      'SELECT * FROM time_off WHERE tenant_id = $1 AND staff_id = $2 ORDER BY start_date ASC',
      [tenantId, staffId]
    );
    return res.rows;
  }
}

export const availabilityService = new AvailabilityService();
