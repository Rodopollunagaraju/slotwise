import { Request, Response, NextFunction } from 'express';
import { db } from '../config/database';

export interface TenantContext {
  id: string;
  slug: string;
  name: string;
  currency: string;
  cancellation_window_hours: number;
}

declare global {
  namespace Express {
    interface Request {
      tenant?: TenantContext;
      user?: {
        id: string;
        email: string;
        role: 'SUPER_ADMIN' | 'OWNER' | 'STAFF' | 'CUSTOMER';
        tenantId?: string;
      };
    }
  }
}

export async function tenantResolver(req: Request, res: Response, next: NextFunction): Promise<any> {
  // Routes that do not require tenant resolution
  if (req.path === '/api/v1/auth/register-tenant' || req.path === '/health' || req.path === '/ready') {
    return next();
  }

  // 1. Resolve slug from host / subdomain (e.g., glamsalon.slotwise.com)
  let slug: string | undefined;
  const host = (req.hostname || req.headers.host || '').split(':')[0]; // strip port

  // Do not treat numeric IPs (like 127.0.0.1) or localhost as tenant subdomains
  const isIpAddress = /^\d+\.\d+\.\d+\.\d+$/.test(host);
  const isLocal = host === 'localhost' || host === '127.0.0.1';

  if (!isIpAddress && !isLocal) {
    const hostParts = host.split('.');
    if (hostParts.length > 2 && hostParts[0] !== 'www' && hostParts[0] !== 'api') {
      slug = hostParts[0];
    }
  }

  // 2. Fall back to headers or query params
  if (!slug) {
    slug = (req.headers['x-tenant-slug'] as string) || (req.query.tenant as string);
  }

  // 3. Check for direct tenant ID header (for API integrations)
  const tenantIdHeader = req.headers['x-tenant-id'] as string;

  if (!slug && !tenantIdHeader) {
    // Some routes (e.g. super admin, health check, global auth) don't require tenant resolution
    return next();
  }

  try {
    let tenantResult;
    if (slug) {
      tenantResult = await db.query('SELECT * FROM tenants WHERE slug = $1', [slug.toLowerCase()]);
    } else if (tenantIdHeader) {
      tenantResult = await db.query('SELECT * FROM tenants WHERE id = $1', [tenantIdHeader]);
    }

    if (!tenantResult || tenantResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'TENANT_NOT_FOUND',
        message: `Tenant '${slug || tenantIdHeader}' does not exist or is inactive.`,
      });
    }

    req.tenant = tenantResult.rows[0];
    next();
  } catch (err: any) {
    return next(err);
  }
}

export function requireTenant(req: Request, res: Response, next: NextFunction) {
  if (!req.tenant) {
    return res.status(400).json({
      success: false,
      error: 'TENANT_REQUIRED',
      message: 'This endpoint requires a valid tenant slug via subdomain, X-Tenant-Slug header, or ?tenant parameter.',
    });
  }
  next();
}
