import bcrypt from 'bcryptjs';
import { db } from '../../config/database';

export class StaffService {
  async listStaff(tenantId: string) {
    const res = await db.query(
      `SELECT s.*, u.email, u.name, u.phone
       FROM staff s
       JOIN users u ON s.user_id = u.id
       WHERE s.tenant_id = $1 AND s.is_active = TRUE`,
      [tenantId]
    );
    return res.rows;
  }

  async getStaffById(tenantId: string, staffId: string) {
    const res = await db.query(
      `SELECT s.*, u.email, u.name, u.phone
       FROM staff s
       JOIN users u ON s.user_id = u.id
       WHERE s.tenant_id = $1 AND s.id = $2`,
      [tenantId, staffId]
    );
    if (res.rows.length === 0) {
      const err: any = new Error('Staff member not found');
      err.statusCode = 404;
      err.name = 'STAFF_NOT_FOUND';
      throw err;
    }
    return res.rows[0];
  }

  async createStaff(tenantId: string, data: {
    name: string;
    email: string;
    password?: string;
    phone?: string;
    bio?: string;
    serviceIds?: string[];
  }) {
    const { name, email, password = 'TempPassword123!', phone, bio, serviceIds = [] } = data;
    const passwordHash = await bcrypt.hash(password, 10);

    return db.transaction(async (client) => {
      // 1. Create user with STAFF role
      const userRes = await client.query(
        `INSERT INTO users (tenant_id, role, email, password_hash, name, phone)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, tenant_id, role, email, name, phone`,
        [tenantId, 'STAFF', email, passwordHash, name, phone || null]
      );
      const user = userRes.rows[0];

      // 2. Create staff record
      const staffRes = await client.query(
        `INSERT INTO staff (tenant_id, user_id, display_name, bio)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [tenantId, user.id, name, bio || '']
      );
      const staff = staffRes.rows[0];

      // 3. Link services
      for (const serviceId of serviceIds) {
        await client.query(
          `INSERT INTO staff_services (tenant_id, staff_id, service_id)
           VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [tenantId, staff.id, serviceId]
        );
      }

      return {
        ...staff,
        user,
        serviceIds,
      };
    });
  }

  async assignService(tenantId: string, staffId: string, serviceId: string, customDurationMin?: number, customPrice?: number) {
    const res = await db.query(
      `INSERT INTO staff_services (tenant_id, staff_id, service_id, custom_duration_min, custom_price)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (staff_id, service_id)
       DO UPDATE SET custom_duration_min = EXCLUDED.custom_duration_min, custom_price = EXCLUDED.custom_price
       RETURNING *`,
      [tenantId, staffId, serviceId, customDurationMin || null, customPrice || null]
    );
    return res.rows[0];
  }
}

export const staffService = new StaffService();
