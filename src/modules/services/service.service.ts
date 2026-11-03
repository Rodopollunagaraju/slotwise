/**
 * ============================================================================
 * SlotWise — Service Catalogue Service (with Redis Cache-Aside & Invalidation)
 * ============================================================================
 * 
 * ARCHITECTURAL ROLE:
 * Handles CRUD operations for salon services (haircuts, styling, coloring, etc.).
 * 
 * CACHING STRATEGY (Week 5):
 * - `listServices()` uses Cache-Aside with a 60-second TTL. The services list is
 *   the most frequently requested endpoint by customers visiting the salon website.
 * - `createService()` and `deleteService()` trigger event-driven cache invalidation,
 *   purging `tenant:{id}:services` and `tenant:{id}:slots:*` so newly added or
 *   removed services immediately reflect in client catalogs.
 */

import { db } from '../../config/database';
import { cacheService } from '../../services/cache.service';

export class ServiceService {
  /**
   * Retrieves the active service list for a salon tenant.
   * Utilizes Redis cache-aside to achieve sub-5ms response times.
   */
  async listServices(tenantId: string) {
    const cacheKey = cacheService.buildKey(tenantId, 'services');

    return await cacheService.getOrSet(cacheKey, 60, async () => {
      const res = await db.query(
        'SELECT * FROM services WHERE tenant_id = $1 ORDER BY name ASC',
        [tenantId]
      );
      return res.rows;
    });
  }

  /**
   * Fetches an individual service by ID.
   */
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

  /**
   * Creates a new service offering under the active tenant.
   * Invalidates tenant services cache and computed slot caches.
   */
  async createService(tenantId: string, data: {
    name: string;
    description?: string;
    durationMin: number;
    price: number;
    depositAmount?: number;
    bufferAfterMin?: number;
  }) {
    const { name, description = '', durationMin, price, depositAmount = 0, bufferAfterMin = 0 } = data;

    // Guardrail: deposit cannot exceed total service price
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

    // Invalidate caches so clients see the new service immediately
    await cacheService.del(cacheService.buildKey(tenantId, 'services'));
    await cacheService.delPattern(cacheService.buildKey(tenantId, 'slots', '*'));

    return res.rows[0];
  }

  /**
   * Deletes a service offering and purges associated caches.
   */
  async deleteService(tenantId: string, serviceId: string) {
    const res = await db.query(
      'DELETE FROM services WHERE id = $1 AND tenant_id = $2',
      [serviceId, tenantId]
    );

    // Invalidate cache
    await cacheService.del(cacheService.buildKey(tenantId, 'services'));
    await cacheService.delPattern(cacheService.buildKey(tenantId, 'slots', '*'));

    return { success: res.rowCount > 0 };
  }
}

export const serviceService = new ServiceService();
