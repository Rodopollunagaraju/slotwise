import { Pool, PoolClient } from 'pg';
import { config } from './env';
import { memoryDb, QueryResult } from '../db/memory-db';
import { v4 as uuidv4 } from 'uuid';

let pgPool: Pool | null = null;
let useMemoryDb = process.env.NODE_ENV === 'test' || process.env.USE_MEMORY_DB === 'true';

export function getPool(): Pool | null {
  if (useMemoryDb) return null;
  if (!pgPool) {
    pgPool = new Pool({
      connectionString: config.databaseUrl,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 3000,
    });

    pgPool.on('error', (err) => {
      console.error('Unexpected error on idle PostgreSQL client:', err);
    });
  }
  return pgPool;
}

export function setUseMemoryDb(val: boolean) {
  useMemoryDb = val;
}

export function isUsingMemoryDb(): boolean {
  return useMemoryDb;
}

export interface IDbClient {
  query: (text: string, params?: any[]) => Promise<QueryResult>;
}

export class Database {
  async query<T = any>(text: string, params: any[] = []): Promise<QueryResult<T>> {
    const pool = getPool();
    if (pool && !useMemoryDb) {
      try {
        const res = await pool.query(text, params);
        return {
          rows: res.rows,
          rowCount: res.rowCount || 0,
        };
      } catch (err: any) {
        // If connection refused, fall back to memory DB in dev/test
        if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
          console.warn('[Database] PostgreSQL not reachable, switching to in-memory engine.');
          useMemoryDb = true;
          return this.queryMemory<T>(text, params);
        }
        throw err;
      }
    }

    return this.queryMemory<T>(text, params);
  }

  async transaction<T>(callback: (client: IDbClient) => Promise<T>): Promise<T> {
    const pool = getPool();
    if (pool && !useMemoryDb) {
      let client: PoolClient | null = null;
      try {
        client = await pool.connect();
        await client.query('BEGIN');
        const dbClient: IDbClient = {
          query: (t, p) => client!.query(t, p).then(r => ({ rows: r.rows, rowCount: r.rowCount || 0 }))
        };
        const result = await callback(dbClient);
        await client.query('COMMIT');
        return result;
      } catch (err: any) {
        if (client) {
          await client.query('ROLLBACK');
        }
        if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
          console.warn('[Database] PostgreSQL not reachable, switching transaction to in-memory engine.');
          useMemoryDb = true;
          return this.transactionMemory<T>(callback);
        }
        throw err;
      } finally {
        if (client) {
          client.release();
        }
      }
    }

    return this.transactionMemory<T>(callback);
  }

  private async transactionMemory<T>(callback: (client: IDbClient) => Promise<T>): Promise<T> {
    const release = await memoryDb.acquireLock();
    try {
      const client: IDbClient = {
        query: (t, p) => this.queryMemory(t, p)
      };
      return await callback(client);
    } finally {
      release();
    }
  }

  private async queryMemory<T = any>(text: string, params: any[] = []): Promise<QueryResult<T>> {
    const cleanSql = text.trim();
    const upper = cleanSql.toUpperCase();

    // 1. SELECT queries
    if (upper.startsWith('SELECT')) {
      if (upper.includes('FROM TENANTS')) {
        let results = [...memoryDb.tenants];
        if (upper.includes('WHERE SLUG = $1')) {
          results = results.filter(t => t.slug === params[0]);
        } else if (upper.includes('WHERE ID = $1')) {
          results = results.filter(t => t.id === params[0]);
        }
        return { rows: results as any[], rowCount: results.length };
      }

      if (upper.includes('FROM USERS')) {
        let results = [...memoryDb.users];
        if (upper.includes('WHERE EMAIL = $1 AND TENANT_ID = $2')) {
          results = results.filter(u => u.email === params[0] && u.tenant_id === params[1]);
        } else if (upper.includes('WHERE EMAIL = $1 AND TENANT_ID IS NULL')) {
          results = results.filter(u => u.email === params[0] && !u.tenant_id);
        } else if (upper.includes('WHERE ID = $1')) {
          results = results.filter(u => u.id === params[0]);
        }
        return { rows: results as any[], rowCount: results.length };
      }

      if (upper.includes('FROM SERVICES')) {
        let results = [...memoryDb.services];
        if (upper.includes('WHERE TENANT_ID = $1')) {
          results = results.filter(s => s.tenant_id === params[0]);
        }
        if (upper.includes('AND ID = $2')) {
          results = results.filter(s => s.id === params[1]);
        }
        if (upper.includes('WHERE ID = $1')) {
          results = results.filter(s => s.id === params[0]);
        }
        return { rows: results as any[], rowCount: results.length };
      }

      if (upper.includes('FROM STAFF_SERVICES')) {
        let results = [...memoryDb.staffServices];
        if (upper.includes('WHERE SERVICE_ID = $1')) {
          results = results.filter(ss => ss.service_id === params[0]);
        }
        if (upper.includes('WHERE STAFF_ID = $1 AND SERVICE_ID = $2')) {
          results = results.filter(ss => ss.staff_id === params[0] && ss.service_id === params[1]);
        }
        return { rows: results as any[], rowCount: results.length };
      }

      if (upper.includes('FROM STAFF')) {
        let results = [...memoryDb.staff];
        if (upper.includes('WHERE TENANT_ID = $1')) {
          results = results.filter(st => st.tenant_id === params[0]);
        }
        if (upper.includes('AND ID = $2')) {
          results = results.filter(st => st.id === params[1]);
        }
        if (upper.includes('WHERE ID = $1')) {
          results = results.filter(st => st.id === params[0]);
        }
        return { rows: results as any[], rowCount: results.length };
      }

      if (upper.includes('FROM AVAILABILITY')) {
        let results = [...memoryDb.availability];
        if (upper.includes('WHERE STAFF_ID = $1')) {
          results = results.filter(a => a.staff_id === params[0]);
        }
        if (upper.includes('AND DAY_OF_WEEK = $2')) {
          results = results.filter(a => a.day_of_week === params[1]);
        }
        if (upper.includes('WHERE TENANT_ID = $1')) {
          results = results.filter(a => a.tenant_id === params[0]);
        }
        return { rows: results as any[], rowCount: results.length };
      }

      if (upper.includes('FROM TIME_OFF')) {
        let results = [...memoryDb.timeOff];
        if (upper.includes('WHERE STAFF_ID = $1')) {
          results = results.filter(to => to.staff_id === params[0]);
        }
        if (upper.includes('WHERE TENANT_ID = $1')) {
          results = results.filter(to => to.tenant_id === params[0]);
        }
        return { rows: results as any[], rowCount: results.length };
      }

      if (upper.includes('FROM BOOKINGS')) {
        let results = [...memoryDb.bookings];
        if (upper.includes('WHERE ID = $1')) {
          results = results.filter(b => b.id === params[0]);
          if (upper.includes('AND TENANT_ID = $2')) {
            results = results.filter(b => b.tenant_id === params[1]);
          }
        } else if (upper.includes('WHERE TENANT_ID = $1')) {
          results = results.filter(b => b.tenant_id === params[0]);
          if (upper.includes('AND STAFF_ID = $2')) {
            results = results.filter(b => b.staff_id === params[1]);
          }
        } else if (upper.includes("STATUS = 'PENDING'") && upper.includes('INTERVAL')) {
          // Expiry query
          const cutoff = new Date(Date.now() - config.pendingBookingExpiryMinutes * 60 * 1000);
          results = results.filter(b => b.status === 'PENDING' && new Date(b.created_at) < cutoff);
        }
        return { rows: results as any[], rowCount: results.length };
      }

      if (upper.includes('FROM PAYMENTS')) {
        let results = [...memoryDb.payments];
        if (upper.includes('WHERE BOOKING_ID = $1')) {
          results = results.filter(p => p.booking_id === params[0]);
        }
        if (upper.includes('WHERE PROVIDER_ORDER_ID = $1')) {
          results = results.filter(p => p.provider_order_id === params[0]);
        }
        return { rows: results as any[], rowCount: results.length };
      }

      if (upper.includes('FROM IDEMPOTENCY_KEYS')) {
        let results = memoryDb.idempotencyKeys.filter(k => k.key === params[0]);
        return { rows: results as any[], rowCount: results.length };
      }

      if (upper.includes('FROM OUTBOX')) {
        let results = memoryDb.outbox.filter(o => o.status === 'PENDING');
        return { rows: results as any[], rowCount: results.length };
      }
    }

    // 2. INSERT queries
    if (upper.startsWith('INSERT INTO TENANTS')) {
      const tenant = {
        id: uuidv4(),
        slug: params[0],
        name: params[1],
        email: params[2],
        phone: params[3] || null,
        currency: params[4] || 'USD',
        cancellation_window_hours: params[5] || 24,
        settings: params[6] || {},
        created_at: new Date(),
        updated_at: new Date(),
      };
      memoryDb.tenants.push(tenant);
      return { rows: [tenant] as any[], rowCount: 1 };
    }

    if (upper.startsWith('INSERT INTO USERS')) {
      const user = {
        id: uuidv4(),
        tenant_id: params[0] || null,
        role: params[1],
        email: params[2],
        password_hash: params[3],
        name: params[4],
        phone: params[5] || null,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      };
      memoryDb.users.push(user);
      return { rows: [user] as any[], rowCount: 1 };
    }

    if (upper.startsWith('INSERT INTO SERVICES')) {
      const service = {
        id: uuidv4(),
        tenant_id: params[0],
        name: params[1],
        description: params[2] || '',
        duration_min: params[3],
        price: params[4],
        deposit_amount: params[5] || 0.00,
        buffer_after_min: params[6] || 0,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      };
      memoryDb.services.push(service);
      return { rows: [service] as any[], rowCount: 1 };
    }

    if (upper.startsWith('INSERT INTO STAFF (')) {
      const staff = {
        id: uuidv4(),
        tenant_id: params[0],
        user_id: params[1],
        display_name: params[2],
        bio: params[3] || '',
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      };
      memoryDb.staff.push(staff);
      return { rows: [staff] as any[], rowCount: 1 };
    }

    if (upper.startsWith('INSERT INTO STAFF_SERVICES')) {
      const ss = {
        id: uuidv4(),
        tenant_id: params[0],
        staff_id: params[1],
        service_id: params[2],
        custom_duration_min: params[3] || null,
        custom_price: params[4] || null,
        created_at: new Date(),
      };
      memoryDb.staffServices.push(ss);
      return { rows: [ss] as any[], rowCount: 1 };
    }

    if (upper.startsWith('INSERT INTO AVAILABILITY')) {
      const a = {
        id: uuidv4(),
        tenant_id: params[0],
        staff_id: params[1],
        day_of_week: params[2],
        start_time: params[3],
        end_time: params[4],
        is_active: true,
        created_at: new Date(),
      };
      memoryDb.availability.push(a);
      return { rows: [a] as any[], rowCount: 1 };
    }

    if (upper.startsWith('INSERT INTO TIME_OFF')) {
      const to = {
        id: uuidv4(),
        tenant_id: params[0],
        staff_id: params[1],
        start_date: params[2],
        end_date: params[3],
        reason: params[4] || '',
        created_at: new Date(),
      };
      memoryDb.timeOff.push(to);
      return { rows: [to] as any[], rowCount: 1 };
    }

    if (upper.startsWith('INSERT INTO BOOKINGS')) {
      // params: tenant_id, customer_id, staff_id, service_id, start_at, end_at, status, total_amount, deposit_amount, customer_name, customer_email, customer_phone, notes
      const tenantId = params[0];
      const customerId = params[1];
      const staffId = params[2];
      const serviceId = params[3];
      const startAt = new Date(params[4]);
      const endAt = new Date(params[5]);
      const status = params[6] || 'PENDING';
      const totalAmount = params[7];
      const depositAmount = params[8] || 0.00;
      const customerName = params[9];
      const customerEmail = params[10];
      const customerPhone = params[11] || null;
      const notes = params[12] || null;

      // EXCLUSION CONSTRAINT CHECK:
      if (status === 'PENDING' || status === 'CONFIRMED') {
        const hasConflict = memoryDb.checkExclusionConstraint(staffId, startAt, endAt);
        if (hasConflict) {
          const err: any = new Error('conflicting key value violates exclusion constraint "no_overlapping_staff_bookings"');
          err.code = '23P01'; // Standard PostgreSQL exclusion_violation error code
          throw err;
        }
      }

      const booking = {
        id: uuidv4(),
        tenant_id: tenantId,
        customer_id: customerId,
        staff_id: staffId,
        service_id: serviceId,
        start_at: startAt.toISOString(),
        end_at: endAt.toISOString(),
        status,
        total_amount: totalAmount,
        deposit_amount: depositAmount,
        customer_name: customerName,
        customer_email: customerEmail,
        customer_phone: customerPhone,
        notes,
        cancellation_reason: null,
        created_at: new Date(),
        updated_at: new Date(),
      };
      memoryDb.bookings.push(booking);
      return { rows: [booking] as any[], rowCount: 1 };
    }

    if (upper.startsWith('INSERT INTO PAYMENTS')) {
      const payment = {
        id: uuidv4(),
        tenant_id: params[0],
        booking_id: params[1],
        provider: params[2],
        provider_order_id: params[3],
        provider_payment_id: null,
        amount: params[4],
        currency: 'USD',
        status: 'CREATED',
        metadata: params[5] ? (typeof params[5] === 'string' ? JSON.parse(params[5]) : params[5]) : {},
        created_at: new Date(),
        updated_at: new Date(),
      };
      memoryDb.payments.push(payment);
      return { rows: [payment] as any[], rowCount: 1 };
    }

    if (upper.startsWith('INSERT INTO OUTBOX')) {
      let aggregateType = 'BOOKING';
      let aggregateId = params[1];
      let eventType = 'booking.created';
      let payload = params[2];

      if (params.length >= 5) {
        aggregateType = params[1];
        aggregateId = params[2];
        eventType = params[3];
        payload = params[4];
      } else {
        // Extract literal event_type from SQL if present
        const match = cleanSql.match(/'(booking\.[a-z\.]+)'/i);
        if (match) {
          eventType = match[1];
        }
      }

      const outbox = {
        id: uuidv4(),
        tenant_id: params[0],
        aggregate_type: aggregateType,
        aggregate_id: aggregateId,
        event_type: eventType,
        payload: typeof payload === 'string' ? JSON.parse(payload) : payload,
        status: 'PENDING',
        retry_count: 0,
        last_error: null,
        created_at: new Date(),
        published_at: null,
      };
      memoryDb.outbox.push(outbox);
      return { rows: [outbox] as any[], rowCount: 1 };
    }

    if (upper.startsWith('INSERT INTO IDEMPOTENCY_KEYS')) {
      const existing = memoryDb.idempotencyKeys.find(k => k.key === params[0]);
      if (existing) {
        const err: any = new Error('duplicate key value violates unique constraint "idempotency_keys_pkey"');
        err.code = '23505';
        throw err;
      }
      const idem = {
        key: params[0],
        tenant_id: params[1],
        user_id: params[2] || null,
        request_hash: params[3],
        response_status: params[4] || null,
        response_body: params[5] || null,
        status: params[6] || 'PROCESSING',
        created_at: new Date(),
        expires_at: params[7] || new Date(Date.now() + 24 * 60 * 60 * 1000),
      };
      memoryDb.idempotencyKeys.push(idem);
      return { rows: [idem] as any[], rowCount: 1 };
    }

    // 3. UPDATE queries
    if (upper.startsWith('UPDATE BOOKINGS')) {
      // Find booking by matching any param with an existing booking ID
      const booking = memoryDb.bookings.find(b => params.includes(b.id));
      if (booking) {
        if (upper.includes("STATUS = 'CANCELLED'")) {
          booking.status = 'CANCELLED';
          booking.cancellation_reason = params[0];
        } else if (upper.includes("STATUS = 'EXPIRED'")) {
          booking.status = 'EXPIRED';
        } else if (upper.includes("STATUS = 'CONFIRMED'")) {
          booking.status = 'CONFIRMED';
        } else if (upper.includes('STATUS = $1')) {
          booking.status = params[0];
          if (upper.includes('CANCELLATION_REASON = $2')) {
            booking.cancellation_reason = params[1];
          }
        }

        if (upper.includes('START_AT = $1') && upper.includes('END_AT = $2')) {
          const newStart = new Date(params[0]);
          const newEnd = new Date(params[1]);
          const hasConflict = memoryDb.checkExclusionConstraint(booking.staff_id, newStart, newEnd, booking.id);
          if (hasConflict) {
            const err: any = new Error('conflicting key value violates exclusion constraint "no_overlapping_staff_bookings"');
            err.code = '23P01';
            throw err;
          }
          booking.start_at = newStart.toISOString();
          booking.end_at = newEnd.toISOString();
        }
        booking.updated_at = new Date();
        return { rows: [booking] as any[], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    if (upper.startsWith('UPDATE PAYMENTS')) {
      const payment = memoryDb.payments.find(p => params.includes(p.id) || params.includes(p.provider_order_id));
      if (payment) {
        if (upper.includes("STATUS = 'SUCCEEDED'")) {
          payment.status = 'SUCCEEDED';
          payment.provider_payment_id = params[0];
        } else if (upper.includes('STATUS = $1')) {
          payment.status = params[0];
          if (upper.includes('PROVIDER_PAYMENT_ID = $2')) {
            payment.provider_payment_id = params[1];
          }
        }
        payment.updated_at = new Date();
        return { rows: [payment] as any[], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    if (upper.startsWith('UPDATE IDEMPOTENCY_KEYS')) {
      const key = params[params.length - 1];
      const item = memoryDb.idempotencyKeys.find(k => k.key === key);
      if (item) {
        item.status = 'COMPLETED';
        item.response_status = params[0];
        item.response_body = typeof params[1] === 'string' ? JSON.parse(params[1]) : params[1];
        return { rows: [item] as any[], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    if (upper.startsWith('UPDATE OUTBOX')) {
      const id = params[params.length - 1];
      const item = memoryDb.outbox.find(o => o.id === id);
      if (item) {
        item.status = params[0];
        item.published_at = new Date();
        return { rows: [item] as any[], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    // 4. DELETE queries
    if (upper.startsWith('DELETE FROM SERVICES WHERE ID = $1 AND TENANT_ID = $2')) {
      const initial = memoryDb.services.length;
      memoryDb.services = memoryDb.services.filter(s => !(s.id === params[0] && s.tenant_id === params[1]));
      return { rows: [], rowCount: initial - memoryDb.services.length };
    }

    return { rows: [], rowCount: 0 };
  }
}

export const db = new Database();
