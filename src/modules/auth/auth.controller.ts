import { Request, Response, NextFunction } from 'express';
import { authService } from './auth.service';

export class AuthController {
  async registerTenant(req: Request, res: Response, next: NextFunction): Promise<any> {
    try {
      const { slug, salonName, email, password, phone, currency } = req.body;
      if (!slug || !salonName || !email || !password) {
        return res.status(400).json({
          success: false,
          error: 'VALIDATION_ERROR',
          message: 'slug, salonName, email, and password are required fields.',
        });
      }

      const result = await authService.registerTenant({
        slug,
        salonName,
        email,
        password,
        phone,
        currency,
      });

      return res.status(201).json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  async registerCustomer(req: Request, res: Response, next: NextFunction): Promise<any> {
    try {
      if (!req.tenant) {
        return res.status(400).json({
          success: false,
          error: 'TENANT_REQUIRED',
          message: 'Tenant context required for customer registration.',
        });
      }

      const { email, password, name, phone } = req.body;
      if (!email || !password || !name) {
        return res.status(400).json({
          success: false,
          error: 'VALIDATION_ERROR',
          message: 'email, password, and name are required.',
        });
      }

      const result = await authService.registerCustomer(req.tenant.id, {
        email,
        password,
        name,
        phone,
      });

      return res.status(201).json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  async login(req: Request, res: Response, next: NextFunction): Promise<any> {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({
          success: false,
          error: 'VALIDATION_ERROR',
          message: 'email and password are required.',
        });
      }

      // Check tenant ID from req.tenant (if accessing tenant domain) or null (for super admin)
      const tenantId = req.tenant?.id;
      const result = await authService.login(email, password, tenantId);

      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  async me(req: Request, res: Response): Promise<any> {
    return res.status(200).json({
      success: true,
      data: {
        user: req.user,
        tenant: req.tenant,
      },
    });
  }
}

export const authController = new AuthController();
