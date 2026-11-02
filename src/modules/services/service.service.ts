import { db } from '../../config/database';

export class ServiceService {
  async listServices(tenantId: string) {
    const res = await db.query(
      'SELECT * FROM services WHERE tenant_id = $1 ORDER BY name ASC',
      [tenantId]
    );
    return res.rows;
  }

  async getServiceById(tenantId: string, serviceId: string) {
    const res = await db.query(
      'SELECT * FROM services WHERE tenant_id = $1 AND id = $2',
      [tenantId, serviceId]
    );
    if (res.rows.length === 0) {
      const err: any = new Error('Service not found');
      err.statusCode = 404;
      err.name = 'SERVICE_NOT_FOUND';
      throw err;
    }
    return res.rows[0];
  }

  async createService(tenantId: string, data: {
    name: string;
    description?: string;
    durationMin: number;
    price: number;
    depositAmount?: number;
    bufferAfterMin?: number;
  }) {
    const { name, description = '', durationMin, price, depositAmount = 0, bufferAfterMin = 0 } = data;

    if (depositAmount > price) {
      const err: any = new Error('Deposit amount cannot exceed the total service price.');
      err.statusCode = 400;
      err.name = 'INVALID_DEPOSIT';
      throw err;
    }

    const res = await db.query(
      `INSERT INTO services (tenant_id, name, description, duration_min, price, deposit_amount, buffer_after_min)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [tenantId, name, description, durationMin, price, depositAmount, bufferAfterMin]
    );
    return res.rows[0];
  }

  async deleteService(tenantId: string, serviceId: string) {
    const res = await db.query(
      'DELETE FROM services WHERE id = $1 AND tenant_id = $2',
      [serviceId, tenantId]
    );
    return { success: res.rowCount > 0 };
  }
}

export const serviceService = new ServiceService();
