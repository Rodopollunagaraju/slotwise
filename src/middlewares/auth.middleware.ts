import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/env';

export interface JwtPayload {
  userId: string;
  email: string;
  role: 'SUPER_ADMIN' | 'OWNER' | 'STAFF' | 'CUSTOMER';
  tenantId?: string;
}

export function authenticate(req: Request, res: Response, next: NextFunction): any {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'UNAUTHORIZED',
      message: 'Authentication token is required.',
    });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as JwtPayload;
    
    // Cross-tenant verification: If request is in context of a tenant, user must belong to that tenant (unless Super Admin)
    if (req.tenant && decoded.role !== 'SUPER_ADMIN' && decoded.tenantId !== req.tenant.id) {
      return res.status(403).json({
        success: false,
        error: 'CROSS_TENANT_ACCESS_DENIED',
        message: 'Your account belongs to a different salon workspace.',
      });
    }

    req.user = {
      id: decoded.userId,
      email: decoded.email,
      role: decoded.role,
      tenantId: decoded.tenantId,
    };

    next();
  } catch (err: any) {
    return res.status(401).json({
      success: false,
      error: 'INVALID_TOKEN',
      message: 'Token is expired or invalid.',
    });
  }
}
