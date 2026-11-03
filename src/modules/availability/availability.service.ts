/**
 * ============================================================================
 * SlotWise — Staff Availability & Vacation Management Service
 * ============================================================================
 * 
 * ARCHITECTURAL ROLE:
 * Manages weekly recurring working shifts (day of week, start time, end time)
 * and ad-hoc vacation / leave dates for salon stylists.
 * 
 * CACHE INVALIDATION (Week 5):
 * Any modification to working hours or time-off instantly purges cached slots:
 * `cacheService.delPattern("tenant:{tenantId}:slots:*")`.
 */

import { db } from '../../config/database';
import { cacheService } from '../../services/cache.service';

export class AvailabilityService {
  /**
   * Overwrites the weekly working schedule for a staff member.
   */
  async setWorkingHours(tenantId: string, staffId: string, schedule: Array<{
    dayOfWeek: number;
    startTime: string;
    endTime: string;
  }>) {
    const result = await db.transaction(async (client) => {
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

    // Invalidate cached slots so updated staff working hours take effect immediately
    await cacheService.delPattern(cacheService.buildKey(tenantId, 'slots', '*'));

    return result;
  }

  async getStaffSchedule(tenantId: string, staffId: string) {
    const res = await db.query(
      'SELECT * FROM availability WHERE tenant_id = $1 AND staff_id = $2 ORDER BY day_of_week, start_time',
      [tenantId, staffId]
    );
    return res.rows;
  }

  /**
   * Records planned vacation or leave for a staff member.
   */
  async addTimeOff(tenantId: string, staffId: string, startDate: string, endDate: string, reason?: string) {
    const res = await db.query(
      `INSERT INTO time_off (tenant_id, staff_id, start_date, end_date, reason)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [tenantId, staffId, startDate, endDate, reason || null]
    );

    // Invalidate cached slots
    await cacheService.delPattern(cacheService.buildKey(tenantId, 'slots', '*'));

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
