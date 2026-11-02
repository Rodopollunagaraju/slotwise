import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from '../../config/database';
import { config } from '../../config/env';

export class AuthService {
  async registerTenant(data: {
    slug: string;
    salonName: string;
    email: string;
    password: string;
    phone?: string;
    currency?: string;
  }) {
    const { slug, salonName, email, password, phone, currency = 'USD' } = data;

    // Verify slug uniqueness
    const existingTenant = await db.query('SELECT id FROM tenants WHERE slug = $1', [slug.toLowerCase()]);
    if (existingTenant.rows.length > 0) {
      const error: any = new Error(`Tenant slug '${slug}' is already taken.`);
      error.statusCode = 409;
      error.name = 'SLUG_ALREADY_EXISTS';
      throw error;
    }

    const passwordHash = await bcrypt.hash(password, 10);

    return db.transaction(async (client) => {
      // 1. Create tenant
      const tenantRes = await client.query(
        `INSERT INTO tenants (slug, name, email, phone, currency)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [slug.toLowerCase(), salonName, email, phone || null, currency]
      );
      const tenant = tenantRes.rows[0];

      // 2. Create Owner user
      const userRes = await client.query(
        `INSERT INTO users (tenant_id, role, email, password_hash, name, phone)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, tenant_id, role, email, name, phone, created_at`,
        [tenant.id, 'OWNER', email, passwordHash, salonName + ' Owner', phone || null]
      );
      const user = userRes.rows[0];

      // 3. Generate token
      const token = jwt.sign(
        { userId: user.id, email: user.email, role: user.role, tenantId: tenant.id },
        config.jwtSecret,
        { expiresIn: config.jwtExpiresIn as any }
      );

      return {
        tenant,
        user,
        token,
      };
    });
  }

  async registerCustomer(tenantId: string, data: { email: string; password: string; name: string; phone?: string }) {
    const { email, password, name, phone } = data;

    const existingUser = await db.query(
      'SELECT id FROM users WHERE email = $1 AND tenant_id = $2',
      [email, tenantId]
    );
    if (existingUser.rows.length > 0) {
      const error: any = new Error('A customer with this email already exists in this salon.');
      error.statusCode = 409;
      error.name = 'EMAIL_ALREADY_EXISTS';
      throw error;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const userRes = await db.query(
      `INSERT INTO users (tenant_id, role, email, password_hash, name, phone)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, tenant_id, role, email, name, phone, created_at`,
      [tenantId, 'CUSTOMER', email, passwordHash, name, phone || null]
    );

    const user = userRes.rows[0];
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role, tenantId },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn as any }
    );

    return { user, token };
  }

  async login(email: string, password: string, tenantId?: string) {
    let userRes;
    if (tenantId) {
      userRes = await db.query('SELECT * FROM users WHERE email = $1 AND tenant_id = $2', [email, tenantId]);
    } else {
      userRes = await db.query('SELECT * FROM users WHERE email = $1 AND tenant_id IS NULL', [email]);
    }

    if (userRes.rows.length === 0) {
      const error: any = new Error('Invalid email or password.');
      error.statusCode = 401;
      error.name = 'INVALID_CREDENTIALS';
      throw error;
    }

    const user = userRes.rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      const error: any = new Error('Invalid email or password.');
      error.statusCode = 401;
      error.name = 'INVALID_CREDENTIALS';
      throw error;
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role, tenantId: user.tenant_id },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn as any }
    );

    const { password_hash, ...safeUser } = user;
    return { user: safeUser, token };
  }
}

export const authService = new AuthService();
